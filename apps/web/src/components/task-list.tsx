"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useStore } from "@/hooks/use-store";
import { TaskCard } from "./task-card";
import { Loader2 } from "lucide-react";

const STATE_FILTERS = [
  { value: "", label: "All" },
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

  useEffect(() => {
    api.listTasks({ state: filter || undefined, limit: 100 })
      .then((res) => {
        setTasks(res.tasks);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, setTasks]);

  const filteredTasks = filter
    ? tasks.filter((t) => t.state === filter)
    : tasks;

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {STATE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded-md text-xs transition-colors ${
              filter === f.value
                ? "bg-primary text-white"
                : "bg-bg-card text-text-muted hover:bg-bg-hover"
            }`}
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
        <div className="grid gap-2">
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
