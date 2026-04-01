export enum LinearSessionStatus {
  ACTIVE = "active",
  WAITING_FOR_USER = "waiting_for_user",
  INTERRUPTED = "interrupted",
  FAILED = "failed",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum LinearActivityType {
  THOUGHT = "thought",
  ELICITATION = "elicitation",
  RESPONSE = "response",
  ERROR = "error",
  ACTION = "action",
}

export enum LinearPlanTodoStatus {
  PENDING = "pending",
  IN_PROGRESS = "inProgress",
  COMPLETED = "completed",
  CANCELED = "canceled",
}

export interface LinearPlanTodo {
  content: string;
  status: LinearPlanTodoStatus;
}

export interface LinearEnrichedContext {
  issue?: {
    labels: Array<{ id: string; name: string }>;
    children: Array<{ identifier: string; title: string; url: string }>;
    attachments: Array<{ id: string; title: string; url: string }>;
  };
}

export interface LinearAgentSession {
  id: string;
  linearSessionId: string;
  linearIssueId: string | null;
  status: LinearSessionStatus;
  conversationMessages: unknown[];
  enrichedContext: LinearEnrichedContext | null;
  spawnedTaskIds: string[];
  lockedBy: string | null;
  lockedAt: Date | null;
  lastActiveAt: Date;
  costUsd: string | null;
  inputTokens: number;
  outputTokens: number;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function normalizeLinearTodoStatus(status: string): LinearPlanTodoStatus {
  const map: Record<string, LinearPlanTodoStatus> = {
    pending: LinearPlanTodoStatus.PENDING,
    queued: LinearPlanTodoStatus.PENDING,
    in_progress: LinearPlanTodoStatus.IN_PROGRESS,
    provisioning: LinearPlanTodoStatus.IN_PROGRESS,
    running: LinearPlanTodoStatus.IN_PROGRESS,
    pr_opened: LinearPlanTodoStatus.IN_PROGRESS,
    completed: LinearPlanTodoStatus.COMPLETED,
    failed: LinearPlanTodoStatus.CANCELED,
    cancelled: LinearPlanTodoStatus.CANCELED,
    canceled: LinearPlanTodoStatus.CANCELED,
  };
  return map[status] ?? LinearPlanTodoStatus.PENDING;
}
