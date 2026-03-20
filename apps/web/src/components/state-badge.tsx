import { cn } from "@/lib/utils";

const STATE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "text-text-muted", bg: "bg-text-muted/10" },
  queued: { label: "Queued", color: "text-info", bg: "bg-info/10" },
  provisioning: { label: "Provisioning", color: "text-info", bg: "bg-info/10" },
  running: { label: "Running", color: "text-primary", bg: "bg-primary/10" },
  needs_attention: { label: "Needs Attention", color: "text-warning", bg: "bg-warning/10" },
  pr_opened: { label: "PR Opened", color: "text-success", bg: "bg-success/10" },
  completed: { label: "Completed", color: "text-success", bg: "bg-success/10" },
  failed: { label: "Failed", color: "text-error", bg: "bg-error/10" },
  cancelled: { label: "Cancelled", color: "text-text-muted", bg: "bg-text-muted/10" },
};

export function StateBadge({ state }: { state: string }) {
  const config = STATE_CONFIG[state] ?? { label: state, color: "text-text-muted", bg: "bg-text-muted/10" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", config.color, config.bg)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.color.replace("text-", "bg-"))} />
      {config.label}
    </span>
  );
}
