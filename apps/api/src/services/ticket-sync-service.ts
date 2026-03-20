import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ticketProviders } from "../db/schema.js";
import { getTicketProvider } from "@optio/ticket-providers";
import type { TicketSource } from "@optio/shared";
import { TaskState } from "@optio/shared";
import * as taskService from "./task-service.js";
import { taskQueue } from "../workers/task-worker.js";
import { logger } from "../logger.js";

export async function syncAllTickets(): Promise<number> {
  const providers = await db
    .select()
    .from(ticketProviders)
    .where(eq(ticketProviders.enabled, true));

  let totalSynced = 0;

  for (const providerConfig of providers) {
    try {
      const provider = getTicketProvider(providerConfig.source as TicketSource);
      const tickets = await provider.fetchActionableTickets(providerConfig.config);

      for (const ticket of tickets) {
        // Check if task already exists for this ticket
        const existingTasks = await taskService.listTasks({ limit: 500 });
        const alreadyExists = existingTasks.some(
          (t: any) =>
            t.ticketSource === ticket.source &&
            t.ticketExternalId === ticket.externalId,
        );

        if (alreadyExists) continue;

        const agentType = ticket.labels.includes("codex") ? "codex" : "claude-code";

        const repoUrl = ticket.repo
          ? `https://github.com/${ticket.repo}.git`
          : (providerConfig.config as any).repoUrl;

        if (!repoUrl) {
          logger.warn({ ticketId: ticket.externalId }, "No repo URL found for ticket, skipping");
          continue;
        }

        const task = await taskService.createTask({
          title: ticket.title,
          prompt: `${ticket.title}\n\n${ticket.body}`,
          repoUrl,
          agentType,
          ticketSource: ticket.source,
          ticketExternalId: ticket.externalId,
          metadata: { ticketUrl: ticket.url },
        });

        await taskService.transitionTask(task.id, TaskState.QUEUED, "ticket_sync");
        await taskQueue.add("process-task", { taskId: task.id }, {
          jobId: task.id,
          attempts: task.maxRetries + 1,
          backoff: { type: "exponential", delay: 5000 },
        });

        // Comment on the ticket
        try {
          await provider.addComment(
            ticket.externalId,
            `🤖 **Optio** is working on this issue.\n\nTask ID: \`${task.id}\`\nAgent: ${agentType}`,
            providerConfig.config,
          );
        } catch (commentErr) {
          logger.warn({ err: commentErr, ticketId: ticket.externalId }, "Failed to comment on ticket");
        }

        totalSynced++;
      }
    } catch (err) {
      logger.error({ err, provider: providerConfig.source }, "Failed to sync tickets from provider");
    }
  }

  return totalSynced;
}
