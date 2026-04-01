import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearTaskMonitor } from "./linear-task-monitor.js";
import type { LinearApiService } from "./linear-api-service.js";
import { LinearPlanTodoStatus, type LinearPlanTodo } from "@optio/shared";

describe("LinearTaskMonitor", () => {
  let mockLinearApi: LinearApiService;
  let planUpdates: LinearPlanTodo[][];

  beforeEach(() => {
    planUpdates = [];
    mockLinearApi = {
      initialize: vi.fn(),
      createTextActivity: vi.fn().mockResolvedValue("activity-1"),
      createActionActivity: vi.fn().mockResolvedValue("activity-1"),
      updateSessionPlan: vi.fn(async (_sid: string, plan: LinearPlanTodo[]) => {
        planUpdates.push(plan);
      }),
      enrichContext: vi.fn().mockResolvedValue({}),
    };
  });

  it("builds initial plan from task list", () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend (repo: backend-api)");
    monitor.addTask("task-2", "Add login UI (repo: frontend-app)");

    const plan = monitor.getPlan();
    expect(plan).toHaveLength(2);
    expect(plan[0].content).toBe("Set up auth backend (repo: backend-api)");
    expect(plan[0].status).toBe(LinearPlanTodoStatus.PENDING);
    expect(plan[1].content).toBe("Add login UI (repo: frontend-app)");
  });

  it("updates plan item when task state changes", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "running");

    const plan = monitor.getPlan();
    expect(plan[0].status).toBe(LinearPlanTodoStatus.IN_PROGRESS);
    expect(mockLinearApi.updateSessionPlan).toHaveBeenCalledWith("session-1", plan);
  });

  it("marks task as completed", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "completed");

    expect(monitor.getPlan()[0].status).toBe(LinearPlanTodoStatus.COMPLETED);
  });

  it("marks task as canceled on failure", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "failed");

    expect(monitor.getPlan()[0].status).toBe(LinearPlanTodoStatus.CANCELED);
    expect(mockLinearApi.createTextActivity).toHaveBeenCalledWith(
      "session-1",
      "error",
      expect.stringContaining("Set up auth backend"),
    );
  });

  it("updates description with PR link on pr_opened", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onPrOpened("task-1", "https://github.com/org/repo/pull/42");

    const plan = monitor.getPlan();
    expect(plan[0].content).toContain("PR #42");
    expect(plan[0].status).toBe(LinearPlanTodoStatus.IN_PROGRESS);
    expect(mockLinearApi.createTextActivity).toHaveBeenCalledWith(
      "session-1",
      "response",
      expect.stringContaining("https://github.com/org/repo/pull/42"),
    );
  });

  it("reports allTerminal when all tasks are done", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Task A");
    monitor.addTask("task-2", "Task B");

    expect(monitor.allTerminal()).toBe(false);

    await monitor.onTaskStateChange("task-1", "completed");
    expect(monitor.allTerminal()).toBe(false);

    await monitor.onTaskStateChange("task-2", "failed");
    expect(monitor.allTerminal()).toBe(true);
  });

  it("ignores unknown task IDs", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    await monitor.onTaskStateChange("unknown-id", "running");
    expect(mockLinearApi.updateSessionPlan).not.toHaveBeenCalled();
  });
});
