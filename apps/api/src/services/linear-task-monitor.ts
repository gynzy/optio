import {
  LinearPlanTodoStatus,
  normalizeLinearTodoStatus,
  type LinearPlanTodo,
} from "@optio/shared";
import type { LinearApiService } from "./linear-api-service.js";
import { logger } from "../logger.js";

const log = logger.child({ service: "linear-task-monitor" });

interface TrackedTask {
  taskId: string;
  description: string;
  status: LinearPlanTodoStatus;
}

export class LinearTaskMonitor {
  private readonly linearSessionId: string;
  private readonly linearApi: LinearApiService;
  private readonly trackedTasks: Map<string, TrackedTask> = new Map();

  constructor(linearSessionId: string, linearApi: LinearApiService) {
    this.linearSessionId = linearSessionId;
    this.linearApi = linearApi;
  }

  addTask(taskId: string, description: string): void {
    this.trackedTasks.set(taskId, {
      taskId,
      description,
      status: LinearPlanTodoStatus.PENDING,
    });
  }

  getPlan(): LinearPlanTodo[] {
    return Array.from(this.trackedTasks.values()).map((t) => ({
      content: t.description,
      status: t.status,
    }));
  }

  allTerminal(): boolean {
    if (this.trackedTasks.size === 0) return false;
    return Array.from(this.trackedTasks.values()).every((t) =>
      [LinearPlanTodoStatus.COMPLETED, LinearPlanTodoStatus.CANCELED].includes(t.status),
    );
  }

  async onTaskStateChange(taskId: string, newState: string): Promise<void> {
    const task = this.trackedTasks.get(taskId);
    if (!task) return;

    task.status = normalizeLinearTodoStatus(newState);
    await this.linearApi.updateSessionPlan(this.linearSessionId, this.getPlan());

    if (newState === "failed") {
      await this.linearApi.createTextActivity(
        this.linearSessionId,
        "error",
        `Task failed: ${task.description}`,
      );
    }

    log.info(
      { taskId, newState, linearSessionId: this.linearSessionId },
      "Task state updated in plan",
    );
  }

  async onPrOpened(taskId: string, prUrl: string): Promise<void> {
    const task = this.trackedTasks.get(taskId);
    if (!task) return;

    const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1] ?? "?";
    task.description = `${task.description} — PR #${prNumber}`;
    task.status = LinearPlanTodoStatus.IN_PROGRESS;

    await this.linearApi.updateSessionPlan(this.linearSessionId, this.getPlan());
    await this.linearApi.createTextActivity(
      this.linearSessionId,
      "response",
      `PR opened: ${prUrl}`,
    );

    log.info({ taskId, prUrl, linearSessionId: this.linearSessionId }, "PR opened — updated plan");
  }
}
