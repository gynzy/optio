/**
 * Builds the Fastify app, calls `app.swagger()` to get the finished spec,
 * writes it to `apps/api/openapi.generated.json`, and exits.
 *
 * Called from `pnpm --filter @optio/api run openapi:dump`. The output is
 * `.gitignore`'d — it's a build artifact, not a source of truth.
 *
 * Used by:
 * - The `openapi:lint` script (redocly CLI)
 * - The `openapi-lint` CI job
 * - Local verification after route migrations (`cat apps/api/openapi.generated.json | jq`)
 *
 * Intentionally avoids `@optio/api`'s real startup path (no telemetry, no
 * DB, no Redis, no workers). Environment variables that unlock mock behavior:
 * - OPTIO_SKIP_DB_HEALTH=1 skips the DB ping during buildServer (not
 *   currently honored; buildServer is a pure route registration.) The health
 *   route executes only at request time, so we're fine with no DB.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// BullMQ queues and service-level Redis clients are constructed at import
// time. When dumping the OpenAPI spec we don't care about Redis at all —
// swallow the expected ECONNREFUSED so CI logs stay clean. Any other
// unhandled rejection still surfaces.
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("ECONNREFUSED") && message.includes("6379")) return;
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});
// ioredis emits connection errors as "error" events on the client instance.
// They bubble up as "Unhandled error event" logs via pino. Silence stderr
// chatter from that path by intercepting process.stderr writes that match.
const origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
  const text = typeof chunk === "string" ? chunk : chunk.toString();
  if (
    text.includes("ECONNREFUSED") ||
    text.includes("Unhandled error event") ||
    text.includes("ioredis")
  ) {
    return true;
  }

  return origStderrWrite(chunk, ...(args as any));
}) as any;

/**
 * zod-to-json-schema emits nullable unions as `{ anyOf: [X], nullable: true }`,
 * which is invalid OpenAPI 3.0 — the `type` field is required alongside
 * `nullable`. Walk the spec and rewrite single-item anyOf-with-nullable into
 * the inlined item + nullable. Also rewrites `{ type: ["null"], nullable: true }`
 * (which the Zod `.null()` output produces for our 204 responses) into
 * `{ type: "null", nullable: true }`.
 *
 * Both openapi-typescript and Redocly accept the rewritten forms.
 */
function normalizeNullable(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeNullable);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const obj = { ...(node as Record<string, unknown>) };

  // Case 1: { anyOf: [X, ...rest], nullable: true } → { ...X, nullable: true }
  // If there's only one item, inline it. If multiple, pick the first — the
  // openapi-typescript generator otherwise errors on missing sibling `type`.
  // This is a lossy but pragmatic mapping for our Zod unions (commonly
  // `z.union([z.date(), z.string()])` where both sides map to strings).
  if (
    Array.isArray(obj.anyOf) &&
    obj.anyOf.length >= 1 &&
    obj.nullable === true &&
    typeof obj.anyOf[0] === "object" &&
    obj.anyOf[0] !== null
  ) {
    const inner = obj.anyOf[0] as Record<string, unknown>;
    delete obj.anyOf;
    for (const [k, v] of Object.entries(inner)) {
      if (!(k in obj)) obj[k] = v;
    }
  }

  // Case 2: { enum: ["null"] | [null], nullable: true } — produced by z.null()
  // for DELETE 204 responses. Replace with a nullable string; OpenAPI 3.0
  // doesn't have a cleaner "always null" representation, and the actual
  // 204 response has no body so the schema is cosmetic.
  if (
    Array.isArray(obj.enum) &&
    obj.enum.every((v) => v === null || v === "null") &&
    obj.nullable === true
  ) {
    delete obj.enum;
    obj.type = "string";
  }

  // Case 3: { type: ["null"], nullable: true } → { type: "null", nullable: true }
  if (Array.isArray(obj.type) && obj.type.every((t) => t === "null")) {
    obj.type = "null";
  }

  // Recurse
  for (const [k, v] of Object.entries(obj)) {
    obj[k] = normalizeNullable(v);
  }
  return obj;
}

// Lazily import so that `dotenv/config` has already run before any module
// that reads env vars at import time (e.g. redis-config).
async function main() {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  // Avoid the real encryption key check — dump-openapi only needs the spec,
  // not the ability to decrypt secrets.
  process.env.OPTIO_ENCRYPTION_KEY = process.env.OPTIO_ENCRYPTION_KEY ?? "0".repeat(64);
  // Skip Redis-backed rate limit init; dump doesn't serve traffic.
  process.env.OPTIO_SKIP_RATE_LIMIT_REDIS = "1";

  const { buildServer } = await import("../src/server.js");
  const app = await buildServer();
  await app.ready();

  // `@fastify/swagger` exposes the current spec via `app.swagger()`.
  const swagger = (app as unknown as { swagger: () => unknown }).swagger;
  if (typeof swagger !== "function") {
    throw new Error("app.swagger() is not a function — is @fastify/swagger registered?");
  }
  const rawSpec = (app as unknown as { swagger: () => unknown }).swagger();
  const spec = normalizeNullable(rawSpec);

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "openapi.generated.json");
  await writeFile(outPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
