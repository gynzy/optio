/**
 * Custom metrics for Optio. All metric emission goes through these helpers.
 * When OTel is disabled, every call is a no-op with zero overhead.
 */

import type { Counter, Histogram, ObservableGauge, Attributes } from "@opentelemetry/api";
import { metrics as otelMetrics } from "@opentelemetry/api";
import {
  METRIC_TASKS_TOTAL,
  METRIC_TASK_DURATION,
  METRIC_TASK_COST,
  METRIC_TASK_TOKENS,
  METRIC_QUEUE_DEPTH,
  METRIC_ACTIVE_TASKS,
  METRIC_POD_COUNT,
  METRIC_PR_WATCH_DURATION,
  METRIC_STATE_TRANSITIONS,
  METRIC_WORKER_JOB_DURATION,
  METRIC_POD_HEALTH_EVENTS,
  METRIC_WEBHOOK_DELIVERIES,
} from "./attributes.js";

let enabled = false;

// Metric instruments (lazily initialized when enabled)
let tasksTotal: Counter | null = null;
let taskDuration: Histogram | null = null;
let taskCost: Histogram | null = null;
let taskTokens: Histogram | null = null;
let queueDepth: ObservableGauge | null = null;
let activeTasks: ObservableGauge | null = null;
let podCount: ObservableGauge | null = null;
let prWatchDuration: Histogram | null = null;
let stateTransitions: Counter | null = null;
let workerJobDuration: Histogram | null = null;
let podHealthEvents: Counter | null = null;
let webhookDeliveries: Counter | null = null;

/** Enable metrics emission. Called once by initTelemetry(). */
export function enableMetrics(): void {
  enabled = true;
}

/** Check if telemetry metrics are enabled. */
export function isMetricsEnabled(): boolean {
  return enabled;
}

/**
 * Initialize all metric instruments. Called after SDK start.
 */
export function initMetrics(observableCallbacks?: {
  queueDepth?: (attrs: Attributes) => number;
  activeTasks?: () => number;
  podCount?: (attrs: Attributes) => number;
}): void {
  const meter = otelMetrics.getMeter("optio-api");

  tasksTotal = meter.createCounter(METRIC_TASKS_TOTAL, {
    description: "Total number of tasks by terminal state",
  });

  taskDuration = meter.createHistogram(METRIC_TASK_DURATION, {
    description: "Task duration in seconds from start to terminal state",
    unit: "s",
  });

  taskCost = meter.createHistogram(METRIC_TASK_COST, {
    description: "Task cost in USD",
    unit: "usd",
  });

  taskTokens = meter.createHistogram(METRIC_TASK_TOKENS, {
    description: "Token counts per task",
  });

  prWatchDuration = meter.createHistogram(METRIC_PR_WATCH_DURATION, {
    description: "Duration of a PR watcher cycle in seconds",
    unit: "s",
  });

  stateTransitions = meter.createCounter(METRIC_STATE_TRANSITIONS, {
    description: "Total state transitions by from/to/trigger",
  });

  workerJobDuration = meter.createHistogram(METRIC_WORKER_JOB_DURATION, {
    description: "Duration of a worker job in seconds",
    unit: "s",
  });

  podHealthEvents = meter.createCounter(METRIC_POD_HEALTH_EVENTS, {
    description: "Pod health events by type and repo",
  });

  webhookDeliveries = meter.createCounter(METRIC_WEBHOOK_DELIVERIES, {
    description: "Webhook delivery attempts by event and success status",
  });

  // Observable gauges with callbacks
  if (observableCallbacks?.queueDepth) {
    const cb = observableCallbacks.queueDepth;
    queueDepth = meter.createObservableGauge(METRIC_QUEUE_DEPTH, {
      description: "Current queue depth by state",
    });
    queueDepth.addCallback((result) => {
      for (const state of ["queued", "provisioning", "running"]) {
        const value = cb({ state });
        result.observe(value, { state });
      }
    });
  }

  if (observableCallbacks?.activeTasks) {
    const cb = observableCallbacks.activeTasks;
    activeTasks = meter.createObservableGauge(METRIC_ACTIVE_TASKS, {
      description: "Number of currently active (running + provisioning) tasks",
    });
    activeTasks.addCallback((result) => {
      result.observe(cb());
    });
  }

  if (observableCallbacks?.podCount) {
    const cb = observableCallbacks.podCount;
    podCount = meter.createObservableGauge(METRIC_POD_COUNT, {
      description: "Number of repo pods by state",
    });
    podCount.addCallback((result) => {
      for (const state of ["provisioning", "ready", "error"]) {
        result.observe(cb({ state }), { state });
      }
    });
  }
}

// ── Metric recording functions ──────────────────────────────────────────────

export function recordTaskComplete(attrs: Attributes): void {
  if (!enabled || !tasksTotal) return;
  tasksTotal.add(1, attrs);
}

export function recordTaskDuration(seconds: number, attrs: Attributes): void {
  if (!enabled || !taskDuration) return;
  taskDuration.record(seconds, attrs);
}

export function recordTaskCost(usd: number, attrs: Attributes): void {
  if (!enabled || !taskCost) return;
  taskCost.record(usd, attrs);
}

export function recordTaskTokens(count: number, attrs: Attributes): void {
  if (!enabled || !taskTokens) return;
  taskTokens.record(count, attrs);
}

export function recordPrWatchCycleDuration(seconds: number): void {
  if (!enabled || !prWatchDuration) return;
  prWatchDuration.record(seconds);
}

export function recordStateTransition(from: string, to: string, trigger: string): void {
  if (!enabled || !stateTransitions) return;
  stateTransitions.add(1, { from, to, trigger });
}

export function recordWorkerJobDuration(seconds: number, worker: string, success: boolean): void {
  if (!enabled || !workerJobDuration) return;
  workerJobDuration.record(seconds, { worker, success: String(success) });
}

export function recordPodHealthEvent(eventType: string, repo: string): void {
  if (!enabled || !podHealthEvents) return;
  podHealthEvents.add(1, { event_type: eventType, repo });
}

export function recordWebhookDelivery(event: string, success: boolean): void {
  if (!enabled || !webhookDeliveries) return;
  webhookDeliveries.add(1, { event, success: String(success) });
}
