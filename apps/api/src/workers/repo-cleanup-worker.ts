import { Queue, Worker } from "bullmq";
import { cleanupIdleRepoPods } from "../services/repo-pool-service.js";
import { logger } from "../logger.js";

const connectionOpts = { url: process.env.REDIS_URL ?? "redis://localhost:6379", maxRetriesPerRequest: null };

export const repoCleanupQueue = new Queue("repo-cleanup", { connection: connectionOpts });

export function startRepoCleanupWorker() {
  // Run cleanup every 2 minutes
  repoCleanupQueue.add(
    "cleanup",
    {},
    {
      repeat: {
        every: parseInt(process.env.OPTIO_REPO_CLEANUP_INTERVAL ?? "120000", 10),
      },
    },
  );

  const worker = new Worker(
    "repo-cleanup",
    async () => {
      const cleaned = await cleanupIdleRepoPods();
      if (cleaned > 0) {
        logger.info({ cleaned }, "Cleaned up idle repo pods");
      }
    },
    {
      connection: connectionOpts,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.error({ err }, "Repo cleanup failed");
  });

  return worker;
}
