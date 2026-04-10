import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { checkRuntimeHealth } from "../services/container-service.js";
import { sql } from "drizzle-orm";
import { isOtelEnabled } from "../telemetry.js";

// Cache runtime health to avoid slow k8s API calls on every health check.
// The UI polls this frequently — a 30s TTL is sufficient.
let cachedRuntimeHealth: boolean | null = null;
let cachedRuntimeHealthAt = 0;
const RUNTIME_HEALTH_TTL_MS = 30_000;

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_req, reply) => {
    const checks: Record<string, boolean> = {};

    // Database check
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = true;
    } catch {
      checks.database = false;
    }

    // Container runtime check (cached to avoid blocking on slow k8s API)
    if (
      cachedRuntimeHealth !== null &&
      Date.now() - cachedRuntimeHealthAt < RUNTIME_HEALTH_TTL_MS
    ) {
      checks.containerRuntime = cachedRuntimeHealth;
    } else {
      try {
        checks.containerRuntime = await checkRuntimeHealth();
      } catch {
        checks.containerRuntime = false;
      }
      cachedRuntimeHealth = checks.containerRuntime;
      cachedRuntimeHealthAt = Date.now();
    }

    const healthy = Object.values(checks).every(Boolean);
    const maxConcurrent = parseInt(process.env.OPTIO_MAX_CONCURRENT ?? "5", 10);
    reply
      .status(healthy ? 200 : 503)
      .send({ healthy, checks, maxConcurrent, otelEnabled: isOtelEnabled() });
  });
}
