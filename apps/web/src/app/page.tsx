"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { TaskCard } from "@/components/task-card";
import Link from "next/link";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Loader2,
  Activity,
  CheckCircle,
  AlertTriangle,
  GitPullRequest,
  Server,
  Circle,
  Cpu,
  HardDrive,
  RefreshCw,
  Container,
  Database,
  Network,
  ChevronRight,
  Plus,
} from "lucide-react";
import { StateBadge } from "@/components/state-badge";

const STATUS_COLORS: Record<string, string> = {
  Running: "text-success", Ready: "text-success", ready: "text-success",
  Succeeded: "text-text-muted", Pending: "text-warning", provisioning: "text-warning",
  ImagePullBackOff: "text-error", ErrImagePull: "text-error", CrashLoopBackOff: "text-error",
  Error: "text-error", error: "text-error", Failed: "text-error", failed: "text-error",
  NotReady: "text-error", Unknown: "text-text-muted",
};

function formatK8sResource(value: string | undefined): string {
  if (!value) return "—";
  const kiMatch = value.match(/^(\d+)Ki$/);
  if (kiMatch) {
    const ki = parseInt(kiMatch[1], 10);
    if (ki >= 1048576) return `${(ki / 1048576).toFixed(1)} Gi`;
    if (ki >= 1024) return `${(ki / 1024).toFixed(0)} Mi`;
    return `${ki} Ki`;
  }
  const miMatch = value.match(/^(\d+)Mi$/);
  if (miMatch) {
    const mi = parseInt(miMatch[1], 10);
    if (mi >= 1024) return `${(mi / 1024).toFixed(1)} Gi`;
    return `${mi} Mi`;
  }
  const giMatch = value.match(/^(\d+)Gi$/);
  if (giMatch) return `${giMatch[1]} Gi`;
  const bytes = parseInt(value, 10);
  if (!isNaN(bytes)) {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} Gi`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} Mi`;
  }
  return value;
}

interface TaskStats {
  total: number;
  running: number;
  needsAttention: number;
  prOpened: number;
  completed: number;
  failed: number;
}

export default function OverviewPage() {
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    Promise.all([
      api.listTasks({ limit: 100 }),
      api.getClusterOverview().catch(() => null),
    ]).then(([tasksRes, clusterRes]) => {
      const tasks = tasksRes.tasks;
      setTaskStats({
        total: tasks.length,
        running: tasks.filter((t: any) => t.state === "running").length,
        needsAttention: tasks.filter((t: any) => t.state === "needs_attention").length,
        prOpened: tasks.filter((t: any) => t.state === "pr_opened").length,
        completed: tasks.filter((t: any) => t.state === "completed").length,
        failed: tasks.filter((t: any) => t.state === "failed").length,
      });
      setRecentTasks(tasks.slice(0, 5));
      if (clusterRes) setCluster(clusterRes);
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  const { nodes, pods, services, events, summary } = cluster ?? {
    nodes: [], pods: [], services: [], events: [],
    summary: { totalPods: 0, runningPods: 0, agentPods: 0, infraPods: 0, totalNodes: 0, readyNodes: 0 },
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Overview</h1>
        <button onClick={refresh} className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Top stats row: tasks + cluster combined */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Activity} label="Running Tasks" value={taskStats?.running ?? 0} color="text-primary" />
        <StatCard icon={AlertTriangle} label="Needs Attention" value={taskStats?.needsAttention ?? 0} color="text-warning" />
        <StatCard icon={GitPullRequest} label="PRs Open" value={taskStats?.prOpened ?? 0} color="text-success" />
        <StatCard icon={CheckCircle} label="Completed" value={taskStats?.completed ?? 0} color="text-success" />
      </div>

      {/* Cluster health bar */}
      <div className="p-3 rounded-lg border border-border bg-bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <Circle className={cn("w-2 h-2 fill-current", summary.readyNodes > 0 ? "text-success" : "text-error")} />
              <span className="text-text-muted">Nodes</span>
              <span className="font-medium">{summary.readyNodes}/{summary.totalNodes}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Container className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Pods</span>
              <span className="font-medium">{summary.runningPods}/{summary.totalPods}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Agents</span>
              <span className="font-medium">{summary.agentPods}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Infra</span>
              <span className="font-medium">{summary.infraPods}</span>
            </span>
          </div>
          {nodes[0] && (
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="font-mono">{nodes[0].name}</span>
              <span className="flex items-center gap-1"><Cpu className="w-3 h-3" />{nodes[0].cpu} cores</span>
              <span className="flex items-center gap-1"><HardDrive className="w-3 h-3" />{formatK8sResource(nodes[0].memory)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Recent tasks + Pods */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent tasks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-muted">Recent Tasks</h2>
            <div className="flex items-center gap-2">
              <Link href="/tasks/new" className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3 h-3" /> New
              </Link>
              <Link href="/tasks" className="text-xs text-primary hover:underline">All →</Link>
            </div>
          </div>
          {recentTasks.length === 0 ? (
            <div className="text-center py-8 text-text-muted border border-dashed border-border rounded-lg text-sm">
              No tasks yet. <Link href="/tasks/new" className="text-primary hover:underline">Create one →</Link>
            </div>
          ) : (
            <div className="grid gap-2">
              {recentTasks.map((task: any) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* Pods */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-muted">Pods</h2>
          </div>
          {pods.length === 0 ? (
            <div className="text-center py-8 text-text-muted border border-dashed border-border rounded-lg text-sm">
              No pods running
            </div>
          ) : (
            <div className="space-y-1.5">
              {pods.map((pod: any) => {
                const color = STATUS_COLORS[pod.status] ?? "text-text-muted";
                return (
                  <div key={pod.name} className="p-2.5 rounded-md border border-border bg-bg-card">
                    <div className="flex items-center gap-2">
                      <Circle className={cn("w-2 h-2 fill-current shrink-0", color)} />
                      <span className="font-mono text-xs font-medium truncate">{pod.name}</span>
                      {pod.isOptioManaged && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">agent</span>
                      )}
                      {pod.isInfra && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-info/10 text-info">infra</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-text-muted mt-1 ml-4">
                      <span className={color}>{pod.status}</span>
                      {pod.restarts > 0 && <span className="text-warning">{pod.restarts} restarts</span>}
                      <span className="font-mono">{pod.image?.split("/").pop()}</span>
                      {pod.startedAt && <span>{formatRelativeTime(pod.startedAt)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent events (compact) */}
          {events.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-medium text-text-muted mb-2">Recent Events</h3>
              <div className="space-y-1">
                {events.slice(0, 5).map((event: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-[10px] text-text-muted">
                    <AlertTriangle className={cn("w-3 h-3 shrink-0 mt-0.5", event.type === "Warning" ? "text-warning" : "text-info")} />
                    <div className="min-w-0">
                      <span className="font-medium text-text/70">{event.reason}</span>
                      <span className="ml-1">{event.message?.slice(0, 80)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-bg-card">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("w-4 h-4", color)} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );
}
