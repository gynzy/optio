import { parseIntEnv } from "@optio/shared";

/**
 * How long a task may go without activity before Optio stops spending GitHub
 * API calls on its PR.
 *
 * Age is measured on `tasks.last_activity_at`, not `updated_at`: the PR watcher
 * used to bump `updated_at` on every poll, so a watched task could never age
 * out. Abandoned tasks kept their PRs polled indefinitely — including PRs that
 * had been deleted — which is what exhausted the shared GitHub App installation
 * rate limit.
 */
export const PR_WATCH_MAX_AGE_MS = parseIntEnv("OPTIO_PR_WATCH_MAX_AGE_DAYS", 5) * 86_400_000;

/** True when the task has been idle long enough that its PR is no longer watched. */
export function isPrWatchStale(lastActivityAt: Date | null, now = new Date()): boolean {
  if (!lastActivityAt) return true;
  return now.getTime() - lastActivityAt.getTime() > PR_WATCH_MAX_AGE_MS;
}
