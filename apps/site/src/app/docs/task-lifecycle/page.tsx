import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "Task Lifecycle",
  description:
    "Understand the Optio task state machine — from pending to merged. Covers transitions, the autonomous feedback loop, PR monitoring, and auto-resume.",
};

export default function TaskLifecyclePage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-text-heading">Task Lifecycle</h1>
      <p className="mt-4 text-text-muted leading-relaxed">
        Every task in Optio flows through a state machine. Understanding the states and transitions
        is key to understanding how Optio drives tasks to completion.
      </p>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">States</h2>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-bg-subtle">
              <th className="px-4 py-3 text-left font-semibold text-text-heading">State</th>
              <th className="px-4 py-3 text-left font-semibold text-text-heading">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {[
              ["pending", "Task created, not yet queued"],
              ["waiting_on_deps", "Blocked by dependency tasks"],
              ["queued", "In the job queue, waiting for capacity"],
              ["provisioning", "Finding or creating a repo pod"],
              ["running", "Agent is actively writing code"],
              ["needs_attention", "CI failed or review requested changes — agent will be resumed"],
              ["pr_opened", "PR is open, being monitored by the PR watcher"],
              ["completed", "PR merged and issue closed"],
              ["failed", "Task failed (can be retried)"],
              ["cancelled", "Manually cancelled"],
            ].map(([state, desc]) => (
              <tr key={state}>
                <td className="px-4 py-3 font-mono text-text-heading">{state}</td>
                <td className="px-4 py-3 text-text-muted">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">The Feedback Loop</h2>
      <p className="mt-3 text-text-muted leading-relaxed">
        The feedback loop is what makes Optio more than a simple agent runner. Once a PR is opened,
        the PR watcher polls every 30 seconds and automatically responds to events:
      </p>
      <div className="mt-4 space-y-3">
        {[
          {
            trigger: "CI fails",
            response:
              "Task transitions to needs_attention, then is re-queued. The agent is resumed with the CI failure output as context.",
            color: "var(--color-error)",
          },
          {
            trigger: "Review requests changes",
            response:
              "If autoResumeOnReview is enabled, the review comments become the agent's next prompt. The agent pushes a fix.",
            color: "var(--color-info)",
          },
          {
            trigger: "Merge conflicts",
            response: "The agent is resumed to rebase and resolve conflicts.",
            color: "var(--color-warning)",
          },
          {
            trigger: "CI passes + review approved",
            response:
              "If autoMerge is enabled, the PR is squash-merged and the linked issue is closed.",
            color: "var(--color-success)",
          },
          {
            trigger: "PR closed without merge",
            response: "Task transitions to failed.",
            color: "var(--color-text-muted)",
          },
          {
            trigger: "PR merged externally",
            response: "Task transitions to completed.",
            color: "var(--color-success)",
          },
        ].map((item) => (
          <div
            key={item.trigger}
            className="flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4"
          >
            <div
              className="mt-1 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <div>
              <p className="text-[14px] font-medium text-text-heading">{item.trigger}</p>
              <p className="mt-1 text-[13px] text-text-muted">{item.response}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">How a Task Runs</h2>
      <p className="mt-3 text-text-muted leading-relaxed">
        Here&apos;s the detailed flow when a task is processed:
      </p>
      <ol className="mt-4 list-decimal pl-5 space-y-2 text-[14px] text-text-muted">
        <li>
          User creates a task via the UI, GitHub Issue assignment, Linear, Jira, or Notion ticket
        </li>
        <li>
          Task is inserted and transitions{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            pending &rarr; queued
          </code>
          , added to BullMQ with priority
        </li>
        <li>Task worker picks up the job and checks concurrency limits (global + per-repo)</li>
        <li>
          Prompt template is rendered with task variables (
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            {"{{TASK_FILE}}"}
          </code>
          ,{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            {"{{BRANCH_NAME}}"}
          </code>
          , etc.)
        </li>
        <li>Repo pod is found or created via the repo pool service</li>
        <li>
          Worker execs into the pod:{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            git worktree add
          </code>
          , writes task file, runs the agent
        </li>
        <li>Structured logs (NDJSON) are streamed back and parsed in real time</li>
        <li>
          Agent opens a PR, cost is recorded, task transitions to{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">pr_opened</code>
        </li>
        <li>PR watcher takes over — polling CI, reviews, and merge status</li>
        <li>
          On merge:{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">completed</code>
          . On failure:{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            needs_attention &rarr; queued
          </code>{" "}
          (retry)
        </li>
      </ol>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">Priority Queue & Concurrency</h2>
      <p className="mt-3 text-text-muted leading-relaxed">
        Tasks have an integer priority (lower = higher priority). The task worker enforces two
        concurrency limits:
      </p>
      <ul className="mt-3 list-disc pl-5 space-y-1 text-[14px] text-text-muted">
        <li>
          <strong className="text-text-heading">Global limit</strong> —{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            OPTIO_MAX_CONCURRENT
          </code>{" "}
          (default 5) — total running tasks across all repos
        </li>
        <li>
          <strong className="text-text-heading">Per-repo limit</strong> —{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            maxConcurrentTasks
          </code>{" "}
          (default 2) — tasks per repo pod
        </li>
      </ul>
      <p className="mt-3 text-text-muted leading-relaxed">
        When a limit is hit, the task is re-queued with a 10-second delay. Task ordering can be
        changed via the dashboard or the reorder API.
      </p>

      <Callout type="tip">
        You can retry all failed tasks at once with{" "}
        <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
          POST /api/tasks/bulk/retry-failed
        </code>{" "}
        or cancel all active tasks with{" "}
        <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
          POST /api/tasks/bulk/cancel-active
        </code>
        .
      </Callout>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">Code Review Agent</h2>
      <p className="mt-3 text-text-muted leading-relaxed">
        Optio can automatically launch a review agent as a subtask of the original coding task:
      </p>
      <ul className="mt-3 list-disc pl-5 space-y-1 text-[14px] text-text-muted">
        <li>Triggered by the PR watcher (on CI pass or PR open) or manually</li>
        <li>Runs with a separate review-specific prompt and model (often a cheaper model)</li>
        <li>The parent task waits for the review subtask to complete before advancing</li>
        <li>
          Configurable per repo via{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            reviewEnabled
          </code>
          ,{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            reviewTrigger
          </code>
          , and{" "}
          <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">
            reviewModel
          </code>
        </li>
      </ul>

      <h2 className="mt-10 text-2xl font-bold text-text-heading">Worktree Lifecycle</h2>
      <p className="mt-3 text-text-muted leading-relaxed">
        Each task tracks its worktree state for cleanup and retry decisions:
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-bg-subtle">
              <th className="px-4 py-3 text-left font-semibold text-text-heading">State</th>
              <th className="px-4 py-3 text-left font-semibold text-text-heading">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {[
              ["active", "Worktree is in use by a running agent"],
              ["dirty", "Agent finished but worktree not yet cleaned up"],
              ["reset", "Worktree was reset for a retry on the same pod"],
              ["preserved", "Kept for manual inspection or resume"],
              ["removed", "Worktree has been cleaned up"],
            ].map(([state, meaning]) => (
              <tr key={state}>
                <td className="px-4 py-3 font-mono text-text-heading">{state}</td>
                <td className="px-4 py-3 text-text-muted">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-text-muted leading-relaxed">
        Retries reuse the existing worktree on the same pod (reset instead of recreate) for faster
        restarts, enabled by{" "}
        <code className="rounded bg-bg-hover px-1.5 py-0.5 text-[13px] font-mono">lastPodId</code>{" "}
        affinity tracking.
      </p>
    </>
  );
}
