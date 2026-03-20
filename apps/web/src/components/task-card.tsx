import Link from "next/link";
import { StateBadge } from "./state-badge";
import { formatRelativeTime, truncate } from "@/lib/utils";
import { GitBranch, ExternalLink } from "lucide-react";

interface TaskCardProps {
  task: {
    id: string;
    title: string;
    state: string;
    agentType: string;
    repoUrl: string;
    prUrl?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export function TaskCard({ task }: TaskCardProps) {
  const repoName = task.repoUrl.replace(/.*\/\/[^/]+\//, "").replace(/\.git$/, "");

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block p-4 rounded-lg border border-border bg-bg-card hover:bg-bg-hover transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{task.title}</h3>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-text-muted">
            <GitBranch className="w-3 h-3" />
            <span>{truncate(repoName, 30)}</span>
            <span className="opacity-50">·</span>
            <span className="capitalize">{task.agentType.replace("-", " ")}</span>
          </div>
        </div>
        <StateBadge state={task.state} />
      </div>
      <div className="flex items-center justify-between mt-3 text-xs text-text-muted">
        <span>{formatRelativeTime(task.createdAt)}</span>
        {task.prUrl && (
          <span className="flex items-center gap-1 text-success">
            <ExternalLink className="w-3 h-3" />
            PR
          </span>
        )}
      </div>
    </Link>
  );
}
