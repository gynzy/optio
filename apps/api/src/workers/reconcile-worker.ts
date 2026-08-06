import { Queue, Worker } from "bullmq";
import { parseIntEnv, reconcileRepo, reconcileStandalone, runKey } from "@optio/shared";
import type { RunRef, Action } from "@optio/shared";
import { getBullMQConnectionOptions } from "../services/redis-config.js";
import { buildWorldSnapshot } from "../services/reconcile-snapshot.js";
import { executeAction, type ExecuteOutcome } from "../services/reconcile-executor.js";
import { reconcileQueue, enqueueReconcile } from "../services/reconcile-queue.js";
import { logger } from "../logger.js";
import { instrumentWorkerProcessor } from "../telemetry/instrument-worker.js";

const connectionOpts = getBullMQConnectionOptions();

/**
 * Consecutive `stale` outcomes per run, so a decision that keeps losing its CAS
 * backs off instead of re-enqueueing every 500 ms. Kept in-process rather than
 * in `tasks.reconcile_attempts`: that column drives the world-read backoff
 * curve (reconcile-repo.ts), and inflating it would lengthen unrelated waits.
 */
const staleRetries = new Map<string, { attempts: number; at: number }>();
const STALE_RETRY_TTL_MS = 10 * 60 * 1000;

function nextStaleAttempt(ref: RunRef): number {
  const key = runKey(ref);
  const now = Date.now();
  const prev = staleRetries.get(key);
  const attempts = prev && now - prev.at < STALE_RETRY_TTL_MS ? prev.attempts + 1 : 1;
  staleRetries.set(key, { attempts, at: now });

  // Opportunistic prune so an idle entry can't pin the map forever.
  if (staleRetries.size > 1000) {
    for (const [k, v] of staleRetries) {
      if (now - v.at >= STALE_RETRY_TTL_MS) staleRetries.delete(k);
    }
  }
  return attempts;
}

/** 1s, 2s, 4s … capped at 5 min, with jitter to spread concurrent losers. */
function staleRetryDelay(attempts: number): number {
  const capped = Math.min(1000 * 2 ** (attempts - 1), 5 * 60 * 1000);
  return capped + Math.floor(Math.random() * 500);
}

/**
 * The reconcile worker pops keys off the `reconcile` queue, builds a fresh
 * WorldSnapshot for each, runs the pure decision function, and executes the
 * resulting action via the CAS-gated executor.
 */
export function startReconcileWorker() {
  const concurrency = parseIntEnv("OPTIO_RECONCILE_CONCURRENCY", 4);
  const maxStaleRetries = parseIntEnv("OPTIO_MAX_STALE_RECONCILE_RETRIES", 10);

  logger.info({ concurrency, maxStaleRetries }, "Starting reconcile worker");

  const worker = new Worker(
    "reconcile",
    instrumentWorkerProcessor("reconcile-worker", async (job) => {
      const { ref, reason } = job.data as { ref: RunRef; reason: string };
      const log = logger.child({ ref, reason });

      const snapshot = await buildWorldSnapshot(ref);
      if (!snapshot) {
        log.debug("Run not found; dropping reconcile job");
        return;
      }

      const action: Action =
        snapshot.run.kind === "repo" ? reconcileRepo(snapshot) : reconcileStandalone(snapshot);

      const outcome: ExecuteOutcome = await executeAction(action, snapshot);

      log.info(
        {
          decision: action.kind,
          decisionReason: action.reason,
          outcome: outcome.status,
          outcomeReason: outcome.reason,
        },
        "reconcile.decision",
      );

      // Requeue-soon actions re-enqueue themselves with a delay so the
      // reconciler can try again when capacity frees up.
      if (action.kind === "requeueSoon") {
        await enqueueReconcile(ref, {
          reason: `requeue_soon:${action.reason}`,
          delayMs: action.delayMs,
        });
      }

      // An invalid decision can never be applied. Re-enqueueing would spin
      // forever, and each pass rebuilds the snapshot from GitHub. Log loudly
      // and leave the run for the next resync or a real event.
      if (outcome.status === "invalid") {
        log.error(
          { decision: action.kind, decisionReason: action.reason, outcomeReason: outcome.reason },
          "reconcile.invalid_decision",
        );
      }

      // Stale outcomes re-enqueue so another worker (or this one) re-reads
      // truth — but with escalating backoff and a hard cap, so a decision that
      // keeps losing its CAS cannot turn into a hot loop.
      if (outcome.status === "stale") {
        const attempts = nextStaleAttempt(ref);
        if (attempts > maxStaleRetries) {
          log.error(
            { attempts, outcomeReason: outcome.reason },
            "reconcile.stale_retries_exhausted",
          );
        } else {
          await enqueueReconcile(ref, {
            reason: `stale_retry:${outcome.reason}`,
            delayMs: staleRetryDelay(attempts),
          });
        }
      } else {
        staleRetries.delete(runKey(ref));
      }

      // Errors get a longer backoff.
      if (outcome.status === "error") {
        await enqueueReconcile(ref, {
          reason: `error_retry:${outcome.reason}`,
          delayMs: 5000 + Math.floor(Math.random() * 2500),
        });
      }
    }),
    {
      connection: connectionOpts,
      concurrency,
      // Each reconcile tick should complete quickly. Hard-kill runaway jobs.
      lockDuration: parseIntEnv("OPTIO_RECONCILE_LOCK_MS", 30_000),
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "Reconcile job failed");
  });

  return worker;
}

// ── Resync worker ───────────────────────────────────────────────────────────

export const resyncQueue = new Queue("reconcile-resync", { connection: connectionOpts });

/**
 * Periodic resync: every N minutes, walk all non-terminal runs in both tables
 * and enqueue a reconcile key for each. Catches drift from lost events.
 */
export function startReconcileResyncWorker() {
  const worker = new Worker(
    "reconcile-resync",
    instrumentWorkerProcessor("reconcile-resync", async () => {
      const { db } = await import("../db/client.js");
      const { tasks, workflowRuns } = await import("../db/schema.js");
      const { TaskState, WorkflowRunState } = await import("@optio/shared");
      const { sql } = await import("drizzle-orm");

      const nonTerminalTasks = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(sql`${tasks.state} NOT IN ('completed', 'cancelled', 'failed')`);

      const nonTerminalRuns = await db
        .select({ id: workflowRuns.id })
        .from(workflowRuns)
        .where(sql`${workflowRuns.state} NOT IN ('completed')`);

      void TaskState;
      void WorkflowRunState;

      logger.info(
        { tasks: nonTerminalTasks.length, runs: nonTerminalRuns.length },
        "reconcile.resync.sweep",
      );

      for (const r of nonTerminalTasks) {
        await enqueueReconcile({ kind: "repo", id: r.id }, { reason: "resync" });
      }
      for (const r of nonTerminalRuns) {
        await enqueueReconcile({ kind: "standalone", id: r.id }, { reason: "resync" });
      }
    }),
    {
      connection: connectionOpts,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.error({ err }, "Reconcile resync failed");
  });

  return worker;
}

export { reconcileQueue };
