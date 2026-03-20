import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TaskState } from "@optio/shared";
import * as taskService from "../services/task-service.js";
import { taskQueue } from "../workers/task-worker.js";

const resumeSchema = z.object({
  prompt: z.string().min(1).optional(),
});

export async function resumeRoutes(app: FastifyInstance) {
  // Resume a task that's in needs_attention or failed state
  app.post("/api/tasks/:id/resume", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = resumeSchema.parse(req.body ?? {});

    const task = await taskService.getTask(id);
    if (!task) return reply.status(404).send({ error: "Task not found" });

    if (!["needs_attention", "failed"].includes(task.state)) {
      return reply.status(409).send({
        error: `Cannot resume task in ${task.state} state`,
      });
    }

    // Transition back to queued
    await taskService.transitionTask(id, TaskState.QUEUED, "user_resume", body.prompt);

    // Enqueue with resume metadata
    await taskQueue.add(
      "process-task",
      {
        taskId: id,
        resumeSessionId: task.sessionId,
        resumePrompt: body.prompt ?? "Continue working on this task.",
      },
      {
        jobId: `${id}-resume-${Date.now()}`,
        attempts: 1,
      },
    );

    const updated = await taskService.getTask(id);
    reply.send({ task: updated });
  });
}
