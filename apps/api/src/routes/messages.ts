import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as taskService from "../services/task-service.js";
import * as messageService from "../services/task-message-service.js";
import { publishTaskMessage } from "../services/task-message-bus.js";
import { publishEvent } from "../services/event-bus.js";
import { getRedisClient } from "../services/event-bus.js";
import { ErrorResponseSchema, IdParamsSchema } from "../schemas/common.js";
import { TaskMessageSchema } from "../schemas/task.js";

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(8000).describe("Message body to deliver to the agent"),
    mode: z
      .enum(["soft", "interrupt"])
      .default("soft")
      .describe(
        "`soft` queues the message for the next turn; `interrupt` attempts " +
          "to preempt the running turn (claude-code only for now)",
      ),
  })
  .describe("Body for sending a message to a running task");

const MessageAcceptedResponseSchema = z
  .object({
    message: TaskMessageSchema,
  })
  .describe("Message accepted and queued for delivery");

const MessagesListResponseSchema = z
  .object({
    messages: z.array(TaskMessageSchema),
  })
  .describe("All messages sent to a task");

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export async function messageRoutes(rawApp: FastifyInstance) {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/api/tasks/:id/message",
    {
      schema: {
        operationId: "sendTaskMessage",
        summary: "Send a message to a running task",
        description:
          "Deliver a mid-run user message to a running task. The message is " +
          "inserted in the database, published on the per-task Redis channel " +
          "so the worker can pick it up, and broadcast via the WebSocket " +
          "events channel. Rate limited to 10 messages per user per task " +
          "per minute. Currently only the claude-code agent supports " +
          "mid-task messaging — other agents return 501.",
        tags: ["Tasks"],
        params: IdParamsSchema,
        body: sendMessageSchema,
        response: {
          202: MessageAcceptedResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          429: ErrorResponseSchema,
          501: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { content, mode } = req.body;

      const task = await taskService.getTask(id);
      if (!task) return reply.status(404).send({ error: "Task not found" });

      const wsId = req.user?.workspaceId;
      if (wsId && task.workspaceId !== wsId) {
        return reply.status(404).send({ error: "Task not found" });
      }

      if (req.user?.id) {
        const allowed = await messageService.canMessageTask(req.user.id, task);
        if (!allowed) {
          return reply.status(403).send({ error: "Not authorized to message this task" });
        }
      }

      if (task.state !== "running") {
        return reply.status(409).send({
          error: `Task is in '${task.state}' state. Messages can only be sent to running tasks.`,
        });
      }

      if (task.agentType !== "claude-code") {
        return reply.status(501).send({
          error:
            "Mid-task messaging is currently only supported for Claude Code. Other agents will be supported via tmux wrapping in a follow-up.",
        });
      }

      if (req.user?.id) {
        const redis = getRedisClient();
        const rateLimitKey = `optio:msg-rate:${id}:${req.user.id}`;
        const count = await redis.incr(rateLimitKey);
        if (count === 1) {
          await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
        }
        if (count > RATE_LIMIT_MAX) {
          return reply.status(429).send({
            error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX} messages per minute per task.`,
          });
        }
      }

      const message = await messageService.sendMessage({
        taskId: id,
        content,
        mode,
        userId: req.user?.id,
        workspaceId: task.workspaceId ?? undefined,
      });

      const trigger = mode === "interrupt" ? "user_interrupt" : "user_message";
      await taskService.recordTaskEvent(
        id,
        task.state,
        trigger,
        content.slice(0, 200),
        req.user?.id,
      );

      const userDisplayName = req.user?.displayName ?? null;
      await publishEvent({
        type: "task:message",
        taskId: id,
        messageId: message.id,
        userId: req.user?.id ?? null,
        userDisplayName,
        content,
        mode,
        createdAt: message.createdAt.toISOString(),
      });

      await publishTaskMessage(id, {
        messageId: message.id,
        content,
        mode,
        userDisplayName,
      });

      app.log.info(
        {
          taskId: id,
          messageId: message.id,
          userId: req.user?.id,
          contentPreview: content.slice(0, 200),
        },
        "Task message sent",
      );

      reply.status(202).send({
        message: {
          id: message.id,
          taskId: message.taskId,
          userId: message.userId,
          content: message.content,
          mode: message.mode,
          createdAt: message.createdAt.toISOString(),
          deliveredAt: null,
          ackedAt: null,
        },
      });
    },
  );

  app.get(
    "/api/tasks/:id/messages",
    {
      schema: {
        operationId: "listTaskMessages",
        summary: "List messages sent to a task",
        description:
          "Return all messages ever sent to a task, including their delivery " +
          "state. The returned list is ordered chronologically.",
        tags: ["Tasks"],
        params: IdParamsSchema,
        response: {
          200: MessagesListResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;

      const task = await taskService.getTask(id);
      if (!task) return reply.status(404).send({ error: "Task not found" });

      const wsId = req.user?.workspaceId;
      if (wsId && task.workspaceId !== wsId) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const messages = await messageService.listMessages(id);
      reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          taskId: m.taskId,
          userId: m.userId,
          content: m.content,
          mode: m.mode,
          createdAt: m.createdAt,
          deliveredAt: m.deliveredAt,
          ackedAt: m.ackedAt,
          deliveryError: m.deliveryError,
          user: m.user,
        })),
      });
    },
  );
}
