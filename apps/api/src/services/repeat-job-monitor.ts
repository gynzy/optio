import { Redis } from "ioredis";
import { logger } from "../logger.js";
import { redisConnectionUrl, redisTlsOptions } from "./redis-config.js";
import { ensureRepeatJobs } from "./repeatable-jobs.js";

const DEBOUNCE_MS = 2000;

let connection: Redis | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let seenReady = false;

/**
 * Watch a dedicated Redis connection and re-register the repeatable jobs after
 * a reconnect. A Redis restart drops the TCP connection, which wipes the repeat
 * schedulers; ioredis fires "ready" again once it reconnects, and we re-add them.
 *
 * The very first "ready" is the initial connect — boot already registered the
 * jobs, so we skip it. Every later "ready" is a reconnect.
 */
export function startRepeatJobMonitor(): void {
  if (connection) return;

  connection = new Redis(redisConnectionUrl, {
    ...(redisTlsOptions ? { tls: redisTlsOptions } : {}),
    maxRetriesPerRequest: null,
  });

  connection.on("error", (err) => {
    logger.debug({ err: err.message }, "Repeat-job monitor connection error");
  });

  connection.on("ready", () => {
    if (!seenReady) {
      seenReady = true;
      return;
    }
    logger.info("Redis reconnected — re-registering repeatable jobs");
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      ensureRepeatJobs().catch((err) => {
        logger.warn({ err }, "Failed to re-register repeatable jobs after reconnect");
      });
    }, DEBOUNCE_MS);
  });
}

export async function stopRepeatJobMonitor(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (connection) {
    await connection.quit().catch(() => {});
    connection = null;
  }
  seenReady = false;
}
