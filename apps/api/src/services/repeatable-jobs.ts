import { Queue } from "bullmq";
import { parseIntEnv } from "@optio/shared";
import { logger } from "../logger.js";
import { getBullMQConnectionOptions } from "./redis-config.js";

export interface RepeatableJob {
  queueName: string;
  jobName: string;
  every: number;
}

/**
 * Single source of truth for every repeatable BullMQ job. Used both at boot and
 * when re-registering after a Redis reconnect, so the two paths can never drift.
 */
export const REPEATABLE_JOBS: RepeatableJob[] = [
  {
    queueName: "pr-watcher",
    jobName: "check-prs",
    every: parseIntEnv("OPTIO_PR_WATCH_INTERVAL", 30000),
  },
  {
    queueName: "repo-cleanup",
    jobName: "health-check",
    every: parseIntEnv("OPTIO_HEALTH_CHECK_INTERVAL", 60000),
  },
  {
    queueName: "repo-cleanup",
    jobName: "stall-check",
    every: parseIntEnv("OPTIO_STALL_CHECK_INTERVAL", 30000),
  },
  {
    queueName: "ticket-sync",
    jobName: "sync",
    every: parseIntEnv("OPTIO_TICKET_SYNC_INTERVAL", 60000),
  },
  {
    queueName: "workflow-trigger-checker",
    jobName: "check-workflow-triggers",
    every: parseIntEnv("OPTIO_WORKFLOW_TRIGGER_INTERVAL", 60000),
  },
  {
    queueName: "token-validation",
    jobName: "validate-token",
    every: parseIntEnv("OPTIO_TOKEN_VALIDATION_INTERVAL", 300000),
  },
  {
    queueName: "reconcile-resync",
    jobName: "resync",
    every: parseIntEnv("OPTIO_RECONCILE_RESYNC_INTERVAL", 300000),
  },
];

let inFlight: Promise<void> | null = null;

/**
 * Register every repeatable job. Adding a repeat job is idempotent — BullMQ
 * upserts the scheduler by repeat key — so this is safe to call repeatedly.
 * Concurrent calls share a single in-flight run. Never throws.
 */
export function ensureRepeatJobs(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = registerAll().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function registerAll(): Promise<void> {
  const connection = getBullMQConnectionOptions();
  for (const job of REPEATABLE_JOBS) {
    const queue = new Queue(job.queueName, { connection });
    try {
      await queue.add(job.jobName, {}, { repeat: { every: job.every } });
    } catch (err) {
      logger.warn(
        { err, queue: job.queueName, job: job.jobName },
        "Failed to register repeatable job",
      );
    } finally {
      await queue.close();
    }
  }
  logger.info({ count: REPEATABLE_JOBS.length }, "Ensured repeatable jobs");
}
