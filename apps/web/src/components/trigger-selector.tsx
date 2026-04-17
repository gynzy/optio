"use client";

/**
 * Shared trigger configuration UI — used by Task create flows (both Repo and Standalone)
 * and any detail page that manages triggers on a task_config or workflow.
 *
 * Callers pass the current config and get back an onChange with the next
 * shape. Webhook paths are auto-generated if the user doesn't supply one.
 */

import { useMemo } from "react";
import { Clock, Play, Webhook } from "lucide-react";

export type TriggerType = "manual" | "schedule" | "webhook";

export interface TriggerConfig {
  type: TriggerType;
  cronExpression?: string;
  webhookPath?: string;
}

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: "Every hour", expr: "0 * * * *" },
  { label: "Every 6h", expr: "0 */6 * * *" },
  { label: "Daily 09:00 UTC", expr: "0 9 * * *" },
  { label: "Weekdays 09:00 UTC", expr: "0 9 * * 1-5" },
  { label: "Mon 09:00 UTC", expr: "0 9 * * 1" },
];

export function cronIsValid(expr: string | undefined | null): boolean {
  if (!expr) return false;
  return expr.trim().split(/\s+/).length === 5;
}

export function describeCronPreset(expr: string): string | null {
  const preset = CRON_PRESETS.find((p) => p.expr === expr);
  return preset ? preset.label : null;
}

interface Props {
  value: TriggerConfig;
  onChange: (next: TriggerConfig) => void;
  /** When true, hide the "manual" option (e.g. on pages where manual is implicit). */
  hideManual?: boolean;
  /** Optional label shown above the type pills. */
  label?: string;
}

export function TriggerSelector({ value, onChange, hideManual = false, label }: Props) {
  const hint = useMemo(() => {
    if (value.type !== "schedule") return null;
    if (!cronIsValid(value.cronExpression)) return "Expected five space-separated fields.";
    const preset = describeCronPreset(value.cronExpression!);
    return preset ? `Runs: ${preset} (UTC)` : "Five-field cron expression (UTC).";
  }, [value.type, value.cronExpression]);

  const setType = (t: TriggerType) => {
    const next: TriggerConfig = { type: t };
    if (t === "schedule") next.cronExpression = value.cronExpression ?? "0 9 * * *";
    if (t === "webhook")
      next.webhookPath = value.webhookPath ?? `hook-${Math.random().toString(36).slice(2, 10)}`;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {label && <label className="block text-sm text-text-muted">{label}</label>}
      <div className="flex gap-2 p-1 rounded-lg bg-bg-card border border-border w-fit">
        {!hideManual && (
          <TriggerTypeButton
            icon={<Play className="w-3.5 h-3.5" />}
            label="Manual"
            active={value.type === "manual"}
            onClick={() => setType("manual")}
          />
        )}
        <TriggerTypeButton
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Schedule"
          active={value.type === "schedule"}
          onClick={() => setType("schedule")}
        />
        <TriggerTypeButton
          icon={<Webhook className="w-3.5 h-3.5" />}
          label="Webhook"
          active={value.type === "webhook"}
          onClick={() => setType("webhook")}
        />
      </div>

      {value.type === "schedule" && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
          <label className="block text-xs text-text-muted">Cron expression</label>
          <input
            type="text"
            value={value.cronExpression ?? ""}
            onChange={(e) => onChange({ ...value, cronExpression: e.target.value })}
            className="w-full px-3 py-2 rounded bg-bg border border-border font-mono text-sm focus:outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.expr}
                type="button"
                onClick={() => onChange({ ...value, cronExpression: p.expr })}
                className="px-2 py-1 text-xs rounded bg-bg border border-border hover:border-primary/60 text-text-muted hover:text-text transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          {hint && <p className="text-xs text-text-muted/60">{hint}</p>}
        </div>
      )}

      {value.type === "webhook" && (
        <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
          <label className="block text-xs text-text-muted">Webhook path</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">/api/hooks/</span>
            <input
              type="text"
              value={value.webhookPath ?? ""}
              onChange={(e) => onChange({ ...value, webhookPath: e.target.value })}
              className="flex-1 px-3 py-2 rounded bg-bg border border-border font-mono text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <p className="text-xs text-text-muted/60">
            POST to this path to trigger a run. Path must be unique across the workspace.
          </p>
        </div>
      )}
    </div>
  );
}

function TriggerTypeButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
        active ? "bg-primary text-white" : "text-text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
