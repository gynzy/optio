"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useStore, type TaskSummary } from "@/hooks/use-store";
import { TaskCard } from "./task-card";
import { StateBadge } from "./state-badge";
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Bot,
  Clock,
  Play,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const STATE_FILTERS = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "pr_opened", label: "PR Opened" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export function TaskList() {
  const { tasks, setTasks } = useStore();
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    api
      .listTasks({ state: filter || undefined, limit: 100 })
      .then((res) => setTasks(res.tasks))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, setTasks]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filteredTasks = filter ? tasks.filter((t) => t.state === filter) : tasks;

  // Build parent→review map
  const reviewMap = new Map<string, TaskSummary[]>();
  const topLevelTasks: TaskSummary[] = [];

  for (const t of filteredTasks) {
    if (t.taskType === "review" && t.parentTaskId) {
      const existing = reviewMap.get(t.parentTaskId) ?? [];
      existing.push(t);
      reviewMap.set(t.parentTaskId, existing);
    } else if (t.parentTaskId) {
      // Other subtasks — also nest under parent
      const existing = reviewMap.get(t.parentTaskId) ?? [];
      existing.push(t);
      reviewMap.set(t.parentTaskId, existing);
    } else {
      topLevelTasks.push(t);
    }
  }

  // Determine if a pr_opened task has subtasks still in progress (bot working, not human-blocked)
  const hasActiveSubtasks = (taskId: string) => {
    const subs = reviewMap.get(taskId) ?? [];
    return subs.some((s) => ["queued", "running", "provisioning", "pending"].includes(s.state));
  };

  // Split into clear sections
  // "Running" includes actively executing + pr_opened with bot reviews still running
  const running = topLevelTasks.filter(
    (t) =>
      ["running", "provisioning"].includes(t.state) ||
      (t.state === "pr_opened" && hasActiveSubtasks(t.id)),
  );
  const queued = topLevelTasks.filter((t) => ["queued", "pending"].includes(t.state));
  // "Awaiting Action" = only tasks that genuinely need human input
  const awaitingAction = topLevelTasks.filter(
    (t) => t.state === "needs_attention" || (t.state === "pr_opened" && !hasActiveSubtasks(t.id)),
  );
  const done = topLevelTasks.filter((t) => ["completed", "failed", "cancelled"].includes(t.state));

  const moveTask = async (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= queued.length) return;

    const reordered = [...queued];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);

    const newTasks = [...running, ...reordered, ...awaitingAction, ...done];
    setTasks(newTasks);

    try {
      await api.reorderTasks(reordered.map((t) => t.id));
    } catch {
      toast.error("Failed to reorder");
      refresh();
    }
  };

  const renderSubtasks = (parentId: string) => {
    const subs = reviewMap.get(parentId);
    if (!subs || subs.length === 0) return null;
    return (
      <div className="ml-6 mt-1 space-y-1">
        {subs.map((sub) => (
          <Link
            key={sub.id}
            href={`/tasks/${sub.id}`}
            className={cn(
              "flex items-center gap-2 p-2 rounded-md border text-xs transition-colors hover:bg-bg-hover",
              sub.taskType === "review" ? "border-info/20 bg-info/5" : "border-border bg-bg-card",
            )}
          >
            {sub.taskType === "review" ? (
              <Bot className="w-3.5 h-3.5 text-info shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 text-text-muted shrink-0 text-center">•</span>
            )}
            <span className="truncate flex-1">{sub.title}</span>
            <StateBadge state={sub.state} />
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {STATE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              "px-3 py-1 rounded-md text-xs transition-colors",
              filter === f.value
                ? "bg-primary text-white"
                : "bg-bg-card text-text-muted hover:bg-bg-hover",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading tasks...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <p>No tasks found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Running */}
          {running.length > 0 && (
            <Section icon={Play} label="Running" count={running.length} color="text-primary">
              {running.map((task) => (
                <div key={task.id}>
                  <TaskCard task={task} />
                  {renderSubtasks(task.id)}
                </div>
              ))}
            </Section>
          )}

          {/* Needs human input */}
          {awaitingAction.length > 0 && (
            <Section
              icon={AlertTriangle}
              label="Needs Your Input"
              count={awaitingAction.length}
              color="text-warning"
            >
              {awaitingAction.map((task) => (
                <div key={task.id}>
                  <TaskCard task={task} />
                  {renderSubtasks(task.id)}
                </div>
              ))}
            </Section>
          )}

          {/* Queue */}
          {queued.length > 0 && (
            <Section icon={Clock} label="Queue" count={queued.length} color="text-text-muted">
              {queued.length > 1 && (
                <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
                  <GripVertical className="w-3 h-3" />
                  Use arrows to reprioritize
                </div>
              )}
              {queued.map((task, i) => (
                <div key={task.id} className="flex items-center gap-1">
                  {queued.length > 1 && (
                    <div className="flex flex-col shrink-0">
                      <button
                        onClick={() => moveTask(i, "up")}
                        disabled={i === 0}
                        className="p-0.5 text-text-muted hover:text-text disabled:opacity-20"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveTask(i, "down")}
                        disabled={i === queued.length - 1}
                        className="p-0.5 text-text-muted hover:text-text disabled:opacity-20"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <TaskCard task={task} />
                    {renderSubtasks(task.id)}
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Completed / Failed */}
          {done.length > 0 && (
            <Section
              icon={CheckCircle2}
              label="Completed"
              count={done.length}
              color="text-text-muted"
            >
              {done.map((task) => (
                <div key={task.id}>
                  <TaskCard task={task} />
                  {renderSubtasks(task.id)}
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  label,
  count,
  color,
  children,
}: {
  icon: any;
  label: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", color)} />
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-text-muted">({count})</span>
      </div>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}
