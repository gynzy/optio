import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { ticketProviders } from "../db/schema.js";
import { TaskState } from "@optio/shared";
import * as taskService from "../services/task-service.js";
import { syncAllTickets } from "../services/ticket-sync-service.js";
import { logger } from "../logger.js";

export async function ticketRoutes(app: FastifyInstance) {
  // List configured ticket providers
  app.get("/api/tickets/providers", async (_req, reply) => {
    const providers = await db.select().from(ticketProviders);
    reply.send({ providers });
  });

  // Sync tickets from all enabled providers
  app.post("/api/tickets/sync", async (_req, reply) => {
    const synced = await syncAllTickets();
    reply.send({ synced });
  });

  // Configure a ticket provider
  app.post("/api/tickets/providers", async (req, reply) => {
    const body = req.body as { source: string; config: Record<string, unknown>; enabled?: boolean };
    const [provider] = await db
      .insert(ticketProviders)
      .values({
        source: body.source,
        config: body.config,
        enabled: body.enabled ?? true,
      })
      .returning();
    reply.status(201).send({ provider });
  });

  // Delete a ticket provider
  app.delete("/api/tickets/providers/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(ticketProviders).where(eq(ticketProviders.id, id));
    reply.status(204).send();
  });

  // GitHub webhook endpoint for real-time ticket events
  app.post("/api/webhooks/github", async (req, reply) => {
    const event = req.headers["x-github-event"];
    const payload = req.body as any;

    if (event === "issues" && payload.action === "labeled") {
      const label = payload.label?.name;
      if (label === "optio") {
        logger.info({ issue: payload.issue?.number }, "GitHub issue labeled with optio");
        // Trigger a sync — handles deduplication
        await syncAllTickets();
      }
    }

    if (event === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) {
      const prUrl = payload.pull_request.html_url;
      const allTasks = await taskService.listTasks({ limit: 500 });
      const matchingTask = allTasks.find((t: any) => t.prUrl === prUrl);

      if (matchingTask) {
        try {
          await taskService.transitionTask(matchingTask.id, TaskState.COMPLETED, "pr_merged", prUrl);
          logger.info({ taskId: matchingTask.id, prUrl }, "Task completed via PR merge");
        } catch {
          // May already be completed
        }
      }
    }

    reply.status(200).send({ ok: true });
  });
}
