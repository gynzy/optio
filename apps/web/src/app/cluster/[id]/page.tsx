"use client";

import { use, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import Link from "next/link";
import { cn, formatRelativeTime } from "@/lib/utils";
import { StateBadge } from "@/components/state-badge";
import {
  Loader2,
  ArrowLeft,
  Server,
  Circle,
  GitBranch,
  Clock,
  Activity,
  ExternalLink,
} from "lucide-react";

export default function PodDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pod, setPod] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getClusterPod(id)
      .then((res) => setPod(res.pod))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (!pod) {
    return (
      <div className="flex items-center justify-center h-full text-error">Pod not found</div>
    );
  }

  const runtimeState = pod.runtimeStatus?.state ?? pod.state;
  const repoName = pod.repoUrl?.replace(/.*github\.com[/:]/, "").replace(/\.git$/, "") ?? pod.repoUrl;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/cluster" className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Server className="w-5 h-5 text-text-muted" />
        <h1 className="text-xl font-bold font-mono">{pod.podName ?? "Pod"}</h1>
        <Circle className={cn(
          "w-3 h-3 fill-current",
          runtimeState === "running" ? "text-success" : runtimeState === "failed" || runtimeState === "error" ? "text-error" : "text-text-muted"
        )} />
      </div>

      {/* Pod info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg border border-border bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">State</div>
          <div className="text-sm capitalize">{runtimeState}</div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Repo</div>
          <div className="text-sm flex items-center gap-1">
            <GitBranch className="w-3 h-3" />
            {repoName}
          </div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Active Tasks</div>
          <div className="text-sm flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {pod.activeTaskCount}
          </div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-bg-card">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Created</div>
          <div className="text-sm flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(pod.createdAt)}
          </div>
        </div>
      </div>

      {pod.runtimeStatus?.startedAt && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-border bg-bg-card">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Started</div>
            <div className="text-xs">{new Date(pod.runtimeStatus.startedAt).toLocaleString()}</div>
          </div>
          {pod.lastTaskAt && (
            <div className="p-3 rounded-lg border border-border bg-bg-card">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Last Task</div>
              <div className="text-xs">{formatRelativeTime(pod.lastTaskAt)}</div>
            </div>
          )}
        </div>
      )}

      {pod.errorMessage && (
        <div className="p-3 rounded-lg border border-error/20 bg-error/5 text-error text-sm">
          {pod.errorMessage}
        </div>
      )}

      {/* Tasks on this pod */}
      <div>
        <h2 className="text-sm font-medium text-text-muted mb-3">Tasks ({pod.tasks?.length ?? 0})</h2>
        {pod.tasks?.length > 0 ? (
          <div className="space-y-1.5">
            {pod.tasks.map((task: any) => (
              <Link
                key={task.id}
                href={`/tasks/${task.id}`}
                className="flex items-center justify-between p-3 rounded-md border border-border bg-bg-card hover:bg-bg-hover transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StateBadge state={task.state} />
                  <span className="text-sm truncate">{task.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-text-muted shrink-0">
                  <span className="capitalize">{task.agentType?.replace("-", " ")}</span>
                  <span>{formatRelativeTime(task.createdAt)}</span>
                  <ExternalLink className="w-3 h-3" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted text-sm border border-dashed border-border rounded-lg">
            No tasks have run on this pod yet.
          </div>
        )}
      </div>
    </div>
  );
}
