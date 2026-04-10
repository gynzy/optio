/**
 * Whitelisted attribute keys for OpenTelemetry spans and metrics.
 *
 * Only attributes listed here may be attached to spans. This prevents
 * accidental leakage of prompts, secrets, agent output, or user PII.
 */

// ── Task lifecycle span attributes ──────────────────────────────────────────

export const TASK_ID = "task.id";
export const TASK_REPO_URL = "task.repo_url";
export const TASK_AGENT_TYPE = "task.agent_type";
export const TASK_MODEL = "task.model";
export const TASK_PRIORITY = "task.priority";
export const TASK_PARENT_ID = "task.parent_id";
export const TASK_TYPE = "task.type";
export const TASK_RETRY_COUNT = "task.retry_count";
export const TASK_WORKSPACE_ID = "task.workspace_id";
export const TASK_TERMINAL_STATE = "task.terminal_state";
export const TASK_COST_USD = "task.cost_usd";
export const TASK_INPUT_TOKENS = "task.input_tokens";
export const TASK_OUTPUT_TOKENS = "task.output_tokens";
export const TASK_DURATION_MS = "task.duration_ms";
export const TASK_SESSION_ID = "task.session_id";

// ── PR watcher span attributes ──────────────────────────────────────────────

export const WATCH_TASK_COUNT = "watch.task_count";
export const PR_NUMBER = "pr.number";
export const PR_STATE = "pr.state";
export const PR_CHECKS_STATUS = "pr.checks_status";
export const PR_REVIEW_STATUS = "pr.review_status";
export const PR_ACTION = "pr.action";

// ── K8s pod operation attributes ────────────────────────────────────────────

export const K8S_POD_NAME = "k8s.pod.name";
export const K8S_POD_STATE = "k8s.pod.state";
export const K8S_NAMESPACE = "k8s.namespace";
export const K8S_REPO_URL = "k8s.repo_url";
export const K8S_INSTANCE_INDEX = "k8s.instance_index";

// ── Worker attributes ───────────────────────────────────────────────────────

export const WORKER_NAME = "worker.name";
export const WORKER_JOB_ID = "worker.job_id";
export const WORKER_JOB_NAME = "worker.job_name";
export const WORKER_ATTEMPTS = "worker.attempts_made";

// ── Webhook attributes ──────────────────────────────────────────────────────

export const WEBHOOK_EVENT = "webhook.event";
export const WEBHOOK_SUCCESS = "webhook.success";

// ── State transition attributes ─────────────────────────────────────────────

export const TRANSITION_FROM = "transition.from";
export const TRANSITION_TO = "transition.to";
export const TRANSITION_TRIGGER = "transition.trigger";

// ── Schedule attributes ─────────────────────────────────────────────────────

export const SCHEDULE_ID = "schedule.id";
export const SCHEDULE_NAME = "schedule.name";

// ── Pod health event attributes ─────────────────────────────────────────────

export const HEALTH_EVENT_TYPE = "health.event_type";
export const HEALTH_REPO_URL = "health.repo_url";

// ── Metric names ────────────────────────────────────────────────────────────

export const METRIC_TASKS_TOTAL = "optio_tasks_total";
export const METRIC_TASK_DURATION = "optio_task_duration_seconds";
export const METRIC_TASK_COST = "optio_task_cost_usd";
export const METRIC_TASK_TOKENS = "optio_task_tokens";
export const METRIC_QUEUE_DEPTH = "optio_queue_depth";
export const METRIC_ACTIVE_TASKS = "optio_active_tasks";
export const METRIC_POD_COUNT = "optio_pod_count";
export const METRIC_PR_WATCH_DURATION = "optio_pr_watch_cycle_duration_seconds";
export const METRIC_STATE_TRANSITIONS = "optio_state_transitions_total";
export const METRIC_WORKER_JOB_DURATION = "optio_worker_job_duration_seconds";
export const METRIC_POD_HEALTH_EVENTS = "optio_pod_health_events_total";
export const METRIC_WEBHOOK_DELIVERIES = "optio_webhook_deliveries_total";
