import { Queue, Worker } from "bullmq";
import { logger } from "../logger.js";

const connectionOpts = { url: process.env.REDIS_URL ?? "redis://localhost:6379", maxRetriesPerRequest: null };

export const ticketSyncQueue = new Queue("ticket-sync", { connection: connectionOpts });

export function startTicketSyncWorker(syncFn: () => Promise<unknown>) {
  // Add repeatable job for periodic sync
  ticketSyncQueue.add(
    "sync",
    {},
    {
      repeat: {
        every: parseInt(process.env.OPTIO_TICKET_SYNC_INTERVAL ?? "60000", 10), // default: 60s
      },
    },
  );

  const worker = new Worker(
    "ticket-sync",
    async () => {
      logger.info("Running periodic ticket sync");
      await syncFn();
    },
    {
      connection: connectionOpts,
      concurrency: 1,
    },
  );

  worker.on("failed", (_job, err) => {
    logger.error({ err }, "Ticket sync failed");
  });

  return worker;
}
