import { TaskState } from "../types/task.js";

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  [TaskState.PENDING]: [TaskState.QUEUED],
  [TaskState.QUEUED]: [TaskState.PROVISIONING],
  [TaskState.PROVISIONING]: [TaskState.RUNNING, TaskState.FAILED],
  [TaskState.RUNNING]: [
    TaskState.PR_OPENED,
    TaskState.NEEDS_ATTENTION,
    TaskState.FAILED,
    TaskState.CANCELLED,
  ],
  [TaskState.NEEDS_ATTENTION]: [TaskState.RUNNING, TaskState.CANCELLED],
  [TaskState.PR_OPENED]: [
    TaskState.COMPLETED,
    TaskState.NEEDS_ATTENTION,
    TaskState.CANCELLED,
  ],
  [TaskState.FAILED]: [TaskState.QUEUED],
  [TaskState.CANCELLED]: [TaskState.QUEUED],
  [TaskState.COMPLETED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Invalid state transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(from: TaskState, to: TaskState): TaskState {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  return to;
}

export function isTerminal(state: TaskState): boolean {
  return VALID_TRANSITIONS[state]?.length === 0;
}

export function getValidTransitions(state: TaskState): TaskState[] {
  return VALID_TRANSITIONS[state] ?? [];
}
