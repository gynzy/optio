import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { tasks, taskEvents, taskLogs } from "../db/schema.js";
import { TaskState, transition, type CreateTaskInput } from "@optio/shared";
import { publishEvent } from "./event-bus.js";

export async function createTask(input: CreateTaskInput) {
  const [task] = await db
    .insert(tasks)
    .values({
      title: input.title,
      prompt: input.prompt,
      repoUrl: input.repoUrl,
      repoBranch: input.repoBranch ?? "main",
      agentType: input.agentType,
      ticketSource: input.ticketSource,
      ticketExternalId: input.ticketExternalId,
      metadata: input.metadata,
      maxRetries: input.maxRetries ?? 3,
    })
    .returning();

  await publishEvent({
    type: "task:created",
    taskId: task.id,
    title: task.title,
    timestamp: new Date().toISOString(),
  });

  return task;
}

export async function getTask(id: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task ?? null;
}

export async function listTasks(opts?: { state?: string; limit?: number; offset?: number }) {
  let query = db.select().from(tasks).orderBy(desc(tasks.createdAt));
  if (opts?.state) {
    query = query.where(eq(tasks.state, opts.state as any)) as typeof query;
  }
  if (opts?.limit) {
    query = query.limit(opts.limit) as typeof query;
  }
  if (opts?.offset) {
    query = query.offset(opts.offset) as typeof query;
  }
  return query;
}

export async function transitionTask(
  id: string,
  toState: TaskState,
  trigger: string,
  message?: string,
) {
  const task = await getTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);

  const currentState = task.state as TaskState;
  transition(currentState, toState); // throws if invalid

  const updateFields: Record<string, unknown> = {
    state: toState,
    updatedAt: new Date(),
  };

  if (toState === TaskState.RUNNING && !task.startedAt) {
    updateFields.startedAt = new Date();
  }
  if (toState === TaskState.COMPLETED || toState === TaskState.FAILED || toState === TaskState.CANCELLED) {
    updateFields.completedAt = new Date();
  }
  // Reset fields when retrying/re-queuing
  if (toState === TaskState.QUEUED) {
    updateFields.errorMessage = null;
    updateFields.resultSummary = null;
    updateFields.completedAt = null;
    updateFields.startedAt = null;
    updateFields.containerId = null;
  }

  await db.update(tasks).set(updateFields).where(eq(tasks.id, id));

  await db.insert(taskEvents).values({
    taskId: id,
    fromState: currentState,
    toState,
    trigger,
    message,
  });

  await publishEvent({
    type: "task:state_changed",
    taskId: id,
    fromState: currentState,
    toState,
    timestamp: new Date().toISOString(),
  });

  return { ...task, ...updateFields };
}

export async function updateTaskContainer(id: string, containerId: string) {
  await db.update(tasks).set({ containerId, updatedAt: new Date() }).where(eq(tasks.id, id));
}

export async function updateTaskPr(id: string, prUrl: string) {
  await db.update(tasks).set({ prUrl, updatedAt: new Date() }).where(eq(tasks.id, id));
}

export async function updateTaskSession(id: string, sessionId: string) {
  await db.update(tasks).set({ sessionId, updatedAt: new Date() }).where(eq(tasks.id, id));
}

export async function updateTaskResult(id: string, resultSummary?: string, errorMessage?: string) {
  await db
    .update(tasks)
    .set({ resultSummary, errorMessage, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function appendTaskLog(
  taskId: string,
  content: string,
  stream = "stdout",
  logType?: string,
  metadata?: Record<string, unknown>,
) {
  await db.insert(taskLogs).values({ taskId, content, stream, logType, metadata });

  await publishEvent({
    type: "task:log",
    taskId,
    stream: stream as "stdout" | "stderr",
    content,
    timestamp: new Date().toISOString(),
  });
}

export async function getTaskLogs(taskId: string, opts?: { limit?: number; offset?: number }) {
  let query = db
    .select()
    .from(taskLogs)
    .where(eq(taskLogs.taskId, taskId))
    .orderBy(taskLogs.timestamp);
  if (opts?.limit) query = query.limit(opts.limit) as typeof query;
  if (opts?.offset) query = query.offset(opts.offset) as typeof query;
  return query;
}

export async function getTaskEvents(taskId: string) {
  return db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.createdAt);
}
