"use client";

import { useState, useEffect, Suspense } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { TaskList } from "@/components/task-list";
import { StandaloneList } from "@/components/standalone-list";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Plus,
  RotateCcw,
  XCircle,
  Loader2,
  Zap,
  GitBranch,
  CircleDot,
  Check,
  Clock,
} from "lucide-react";
import { PrBrowser } from "@/components/pr-browser";

type TabKey = "repo" | "standalone" | "issues" | "prs";

export default function TasksPage() {
  usePageTitle("Tasks");
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTab = ((): TabKey => {
    const q = searchParams.get("tab");
    if (q === "standalone" || q === "issues" || q === "prs" || q === "repo") return q;
    return "repo";
  })();
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const [bulkLoading, setBulkLoading] = useState(false);

  const setTab = (next: TabKey) => {
    setTabState(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "repo") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "", { scroll: false });
  };

  const handleRetryFailed = async () => {
    if (!confirm("Retry all failed tasks?")) return;
    setBulkLoading(true);
    try {
      const res = await api.bulkRetryFailed();
      toast.success(`Retried ${res.retried} of ${res.total} failed tasks`);
    } catch {
      toast.error("Failed to retry tasks");
    }
    setBulkLoading(false);
  };

  const handleCancelActive = async () => {
    if (!confirm("Cancel all running and queued tasks?")) return;
    setBulkLoading(true);
    try {
      const res = await api.bulkCancelActive();
      toast.success(`Cancelled ${res.cancelled} of ${res.total} active tasks`);
    } catch {
      toast.error("Failed to cancel tasks");
    }
    setBulkLoading(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 mb-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === "repo" && (
            <>
              <button
                onClick={handleRetryFailed}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-bg-card border border-border text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Retry Failed
              </button>
              <button
                onClick={handleCancelActive}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-bg-card border border-border text-text-muted hover:text-error hover:bg-error/5 disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-3 h-3" />
                Cancel Active
              </button>
            </>
          )}
          <Link
            href="/tasks/scheduled"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-bg-card border border-border text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            <Clock className="w-4 h-4" />
            Scheduled
          </Link>
          <Link
            href="/tasks/new"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Task
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border mb-6">
        {(
          [
            { key: "repo", label: "Repo Tasks" },
            { key: "standalone", label: "Standalone" },
            { key: "issues", label: "Issues" },
            { key: "prs", label: "Pull Requests" },
          ] as { key: TabKey; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-5 py-3 text-[13px] font-medium border-b-2 transition-colors",
              tab === key
                ? "border-primary text-text"
                : "border-transparent text-text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "repo" && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading tasks...
            </div>
          }
        >
          <TaskList />
        </Suspense>
      )}
      {tab === "standalone" && <StandaloneList />}
      {tab === "issues" && <IssuesBrowser />}
      {tab === "prs" && <PrBrowser />}
    </div>
  );
}

function IssuesBrowser() {
  const [issues, setIssues] = useState<any[]>([]);
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [assigning, setAssigning] = useState<number | null>(null);
  const [bulkAssigning, setBulkAssigning] = useState(false);

  useEffect(() => {
    api
      .listRepos()
      .then((res) => setRepos(res.repos))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .listIssues({ repoId: selectedRepo || undefined })
      .then((res) => setIssues(res.issues))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedRepo]);

  const unassignedIssues = issues.filter((i: any) => !i.optioTask);

  const handleAssignAll = async () => {
    if (!confirm(`Assign ${unassignedIssues.length} issues to Optio?`)) return;
    setBulkAssigning(true);
    let assigned = 0;
    for (const issue of unassignedIssues) {
      try {
        const res = await api.assignIssue({
          issueNumber: issue.number,
          repoId: issue.repo.id,
          title: issue.title,
          body: issue.body,
        });
        setIssues((prev) =>
          prev.map((i) =>
            i.number === issue.number && i.repo.fullName === issue.repo.fullName
              ? {
                  ...i,
                  optioTask: { taskId: res.task?.id, state: "queued" },
                  labels: [...(i.labels || []), "optio"],
                }
              : i,
          ),
        );
        assigned++;
      } catch {
        // Continue with remaining issues
      }
    }
    toast.success(`Assigned ${assigned} of ${unassignedIssues.length} issues`);
    setBulkAssigning(false);
  };

  const handleAssign = async (issue: any) => {
    setAssigning(issue.number);
    try {
      const res = await api.assignIssue({
        issueNumber: issue.number,
        repoId: issue.repo.id,
        title: issue.title,
        body: issue.body,
      });
      toast.success(`Assigned #${issue.number} to Optio`);
      // Update in place — don't re-fetch (avoids list reorder)
      setIssues((prev) =>
        prev.map((i) =>
          i.number === issue.number && i.repo.fullName === issue.repo.fullName
            ? {
                ...i,
                optioTask: { taskId: res.task?.id, state: "queued" },
                labels: [...(i.labels || []), "optio"],
              }
            : i,
        ),
      );
    } catch {
      toast.error("Failed to assign issue");
    }
    setAssigning(null);
  };

  return (
    <div>
      {/* Repo filter */}
      {repos.length > 1 && (
        <div className="mb-4">
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-bg-card border border-border text-sm focus:outline-none focus:border-primary"
          >
            <option value="">All repos</option>
            {repos.map((r: any) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Bulk assign */}
      {!loading && unassignedIssues.length > 0 && (
        <div className="mb-4">
          <button
            onClick={handleAssignAll}
            disabled={bulkAssigning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {bulkAssigning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {bulkAssigning ? "Assigning..." : `Assign All (${unassignedIssues.length})`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading issues...
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <CircleDot className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No open issues found</p>
          <p className="text-xs mt-1">
            {repos.length === 0
              ? "Add a repo first in the Repos settings."
              : "Issues will appear here from your configured repos."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((issue: any) => (
            <div
              key={`${issue.repo.fullName}-${issue.number}`}
              className="p-3 rounded-lg border border-border bg-bg-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={issue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium hover:text-primary transition-colors truncate"
                    >
                      {issue.title}
                    </a>
                    <span className="text-xs text-text-muted shrink-0">#{issue.number}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {issue.repo.fullName}
                    </span>
                    {issue.author && <span>@{issue.author}</span>}
                    {issue.assignee && <span>assignee: @{issue.assignee}</span>}
                    <span>{formatRelativeTime(issue.updatedAt)}</span>
                  </div>
                  {/* Labels */}
                  {issue.labels.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5">
                      {issue.labels.map((label: string) => (
                        <span
                          key={label}
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full border",
                            label === "optio"
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-bg text-text-muted",
                          )}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action button */}
                <div className="shrink-0">
                  {issue.optioTask ? (
                    <Link
                      href={`/tasks/${issue.optioTask.taskId}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs hover:bg-success/20"
                    >
                      <Check className="w-3 h-3" />
                      {issue.optioTask.state === "completed"
                        ? "Done"
                        : issue.optioTask.state === "pr_opened"
                          ? "PR"
                          : "Running"}
                    </Link>
                  ) : (
                    <button
                      onClick={() => handleAssign(issue)}
                      disabled={assigning === issue.number}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-white text-xs hover:bg-primary-hover disabled:opacity-50"
                    >
                      {assigning === issue.number ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3" />
                      )}
                      Assign to Optio
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
