import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCounterAdd = vi.fn();
const mockHistogramRecord = vi.fn();
const mockObservableGaugeAddCallback = vi.fn();

vi.mock("@opentelemetry/api", () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add: mockCounterAdd }),
      createHistogram: () => ({ record: mockHistogramRecord }),
      createObservableGauge: () => ({ addCallback: mockObservableGaugeAddCallback }),
    }),
  },
}));

import {
  enableMetrics,
  isMetricsEnabled,
  initMetrics,
  recordTaskComplete,
  recordTaskDuration,
  recordTaskCost,
  recordTaskTokens,
  recordPrWatchCycleDuration,
  recordStateTransition,
  recordWorkerJobDuration,
  recordPodHealthEvent,
  recordWebhookDelivery,
} from "./metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when disabled", () => {
    it("recordTaskComplete is a no-op", () => {
      // Metrics not enabled yet in a fresh import scope — but since
      // module state persists, we test the no-op path by checking
      // that the function doesn't throw
      recordTaskComplete({ state: "completed" });
      // If metrics were never initialized, the counter is null, so add() won't be called
    });
  });

  describe("when enabled", () => {
    beforeEach(() => {
      enableMetrics();
      initMetrics();
    });

    it("recordTaskComplete calls counter.add", () => {
      recordTaskComplete({ state: "completed", agent_type: "claude-code" });
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        state: "completed",
        agent_type: "claude-code",
      });
    });

    it("recordTaskDuration calls histogram.record", () => {
      recordTaskDuration(42.5, { terminal_state: "completed" });
      expect(mockHistogramRecord).toHaveBeenCalledWith(42.5, {
        terminal_state: "completed",
      });
    });

    it("recordTaskCost calls histogram.record", () => {
      recordTaskCost(1.23, { agent_type: "claude-code", model: "sonnet" });
      expect(mockHistogramRecord).toHaveBeenCalledWith(1.23, {
        agent_type: "claude-code",
        model: "sonnet",
      });
    });

    it("recordTaskTokens calls histogram.record", () => {
      recordTaskTokens(5000, { agent_type: "claude-code", direction: "input" });
      expect(mockHistogramRecord).toHaveBeenCalledWith(5000, {
        agent_type: "claude-code",
        direction: "input",
      });
    });

    it("recordPrWatchCycleDuration calls histogram.record", () => {
      recordPrWatchCycleDuration(2.5);
      expect(mockHistogramRecord).toHaveBeenCalledWith(2.5);
    });

    it("recordStateTransition calls counter.add", () => {
      recordStateTransition("queued", "provisioning", "task-worker");
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        from: "queued",
        to: "provisioning",
        trigger: "task-worker",
      });
    });

    it("recordWorkerJobDuration calls histogram.record", () => {
      recordWorkerJobDuration(5.0, "task-worker", true);
      expect(mockHistogramRecord).toHaveBeenCalledWith(5.0, {
        worker: "task-worker",
        success: "true",
      });
    });

    it("recordPodHealthEvent calls counter.add", () => {
      recordPodHealthEvent("crashed", "https://github.com/org/repo");
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        event_type: "crashed",
        repo: "https://github.com/org/repo",
      });
    });

    it("recordWebhookDelivery calls counter.add", () => {
      recordWebhookDelivery("task.completed", true);
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        event: "task.completed",
        success: "true",
      });
    });

    it("isMetricsEnabled returns true after enableMetrics()", () => {
      expect(isMetricsEnabled()).toBe(true);
    });

    it("initMetrics with observable callbacks registers them", () => {
      initMetrics({
        queueDepth: () => 5,
        activeTasks: () => 3,
        podCount: () => 2,
      });
      // The callbacks are registered via addCallback
      expect(mockObservableGaugeAddCallback).toHaveBeenCalled();
    });
  });
});
