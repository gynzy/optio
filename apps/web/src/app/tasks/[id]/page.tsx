"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import { useTask } from "@/hooks/use-task";
import { useLogs, type LogEntry } from "@/hooks/use-logs";
import { EventTimeline } from "@/components/event-timeline";
import { StateBadge } from "@/components/state-badge";
import { api } from "@/lib/api-client";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Loader2,
  RefreshCw,
  XCircle,
  RotateCcw,
  ExternalLink,
  GitBranch,
  Terminal,
  FileEdit,
  Search,
  Clock,
  Send,
  AlertCircle,
  Info,
  Wrench,
  ArrowDown,
  ChevronRight,
} from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof Terminal; color: string }> = {
  text: { icon: Terminal, color: "text-text/80" },
  tool_use: { icon: Wrench, color: "text-primary" },
  tool_result: { icon: FileEdit, color: "text-text-muted" },
  thinking: { icon: Search, color: "text-text-muted/50" },
  system: { icon: Info, color: "text-info" },
  error: { icon: AlertCircle, color: "text-error" },
  info: { icon: Info, color: "text-success" },
};

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { task, events, loading, error, refresh } = useTask(id);
  const { logs, connected } = useLogs(id);
  const [actionLoading, setActionLoading] = useState(false);
  const [resumePrompt, setResumePrompt] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  // Auto-refresh task state periodically when active
  useEffect(() => {
    if (!task) return;
    const isActive = ["running", "provisioning", "queued"].includes(task.state);
    if (!isActive) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [task?.state, refresh]);

  const handleCancel = async () => {
    setActionLoading(true);
    try { await api.cancelTask(id); await refresh(); } catch {}
    setActionLoading(false);
  };

  const handleRetry = async () => {
    setActionLoading(true);
    try { await api.retryTask(id); await refresh(); } catch {}
    setActionLoading(false);
  };

  const handleResume = async () => {
    if (!resumePrompt.trim()) return;
    setActionLoading(true);
    try {
      await api.resumeTask(id, resumePrompt);
      setResumePrompt("");
      await refresh();
    } catch {}
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading task...
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        {error ?? "Task not found"}
      </div>
    );
  }

  const repoName = task.repoUrl.replace(/.*\/\/[^/]+\//, "").replace(/\.git$/, "");
  const isActive = ["running", "provisioning", "queued"].includes(task.state);
  const isTerminal = ["completed", "failed", "cancelled"].includes(task.state);
  const canCancel = ["running", "queued", "provisioning", "needs_attention"].includes(task.state);
  const canRetry = ["failed", "cancelled"].includes(task.state);
  const canResume = ["needs_attention", "failed"].includes(task.state) && !!task.sessionId;

  const filteredLogs = showTools ? logs : logs.filter((l) => l.logType !== "tool_use" && l.logType !== "tool_result");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 p-4 border-b border-border bg-bg-card">
        <div className="flex items-start justify-between gap-4 max-w-5xl mx-auto">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold truncate">{task.title}</h1>
              <StateBadge state={task.state} />
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                {repoName}
              </span>
              <span className="flex items-center gap-1 capitalize">
                {task.agentType === "claude-code" ? (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg>
                )}
                {task.agentType.replace("-", " ")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(task.createdAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task.prUrl && (
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs hover:bg-success/20 transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                View PR
              </a>
            )}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-error/10 text-error text-xs hover:bg-error/20 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-3 h-3" />
                Cancel
              </button>
            )}
            {canRetry && (
              <button
                onClick={handleRetry}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            )}
            <button
              onClick={refresh}
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {task.errorMessage && isTerminal && (
        <div className="shrink-0 px-4 py-2.5 border-b border-error/20 bg-error/5">
          <div className="flex items-start gap-2 max-w-5xl mx-auto text-sm">
            <AlertCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="text-error font-medium">Task failed: </span>
              <span className="text-error/80">{task.errorMessage}</span>
            </div>
          </div>
        </div>
      )}

      {/* Main content: logs + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Log panel */}
        <div className="flex-1 flex flex-col">
          {/* Log toolbar */}
          <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-border bg-bg">
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  isActive && connected ? "bg-success" : "bg-text-muted/30"
                )} />
                {isActive ? (connected ? "Live" : "Connecting...") : "Ended"}
              </span>
              <span>{logs.length} events</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowTools(!showTools)}
                className={cn("px-2 py-0.5 rounded text-xs transition-colors", showTools ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-bg-hover")}
              >
                Tools
              </button>
              <button
                onClick={() => setShowEvents(!showEvents)}
                className={cn("px-2 py-0.5 rounded text-xs transition-colors", showEvents ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-bg-hover")}
              >
                Events
              </button>
              {!autoScroll && (
                <button
                  onClick={() => {
                    setAutoScroll(true);
                    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
                  }}
                  className="p-1 rounded hover:bg-bg-hover text-text-muted"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Log content */}
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="flex-1 overflow-auto px-4 py-2 font-mono text-xs leading-relaxed"
          >
            {filteredLogs.length === 0 ? (
              <div className="py-6 space-y-4">
                {isActive && (
                  <div className="flex items-center justify-center gap-2 text-text-muted text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Waiting for agent output...</span>
                  </div>
                )}
                {!isActive && !task.errorMessage && (
                  <div className="text-center text-text-muted text-sm">No output captured.</div>
                )}
                {/* Show task context */}
                <div className="space-y-3 max-w-2xl mx-auto">
                  <div className="p-3 rounded-md border border-border bg-bg-card">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Task Prompt</div>
                    <pre className="text-xs text-text/70 whitespace-pre-wrap">{task.prompt}</pre>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-md border border-border bg-bg-card">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Agent</div>
                      <div className="text-xs">{task.agentType === "claude-code" ? "Claude Code" : "OpenAI Codex"}</div>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-bg-card">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Branch</div>
                      <div className="text-xs font-mono">optio/task-{task.id.slice(0, 8)}</div>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-bg-card">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Container</div>
                      <div className="text-xs font-mono">{task.containerId ? task.containerId.slice(0, 20) : "pending"}</div>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-bg-card">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">State</div>
                      <div className="text-xs capitalize">{task.state.replace("_", " ")}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              filteredLogs.map((log, i) => {
                const config = TYPE_CONFIG[log.logType ?? "text"] ?? TYPE_CONFIG.text;
                const Icon = config.icon;
                return (
                  <div key={i} className={cn("flex gap-2 py-0.5", config.color)}>
                    <Icon className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
                    <div className="min-w-0 flex-1">
                      {log.logType === "tool_use" && log.metadata?.toolName ? (
                        <div>
                          <span className="font-medium">{log.metadata.toolName as string}</span>
                          {log.metadata.toolInput ? (
                            <pre className="text-text-muted/50 mt-0.5 whitespace-pre-wrap break-all text-[10px]">
                              {JSON.stringify(log.metadata.toolInput as Record<string, unknown>, null, 2).slice(0, 200)}
                            </pre>
                          ) : null}
                        </div>
                      ) : (
                        <span className="whitespace-pre-wrap break-all">{log.content}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Resume / interact bar */}
          <div className="shrink-0 border-t border-border bg-bg-card px-4 py-2.5">
            <div className="flex gap-2 items-center">
              <input
                value={resumePrompt}
                onChange={(e) => setResumePrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleResume()}
                placeholder={
                  canResume
                    ? "Send follow-up instructions to the agent..."
                    : isActive
                      ? "Agent is running..."
                      : "Task has ended"
                }
                disabled={!canResume}
                className="flex-1 px-3 py-2 rounded-md bg-bg border border-border text-sm focus:outline-none focus:border-primary disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleResume}
                disabled={!canResume || !resumePrompt.trim() || actionLoading}
                title={
                  !task.sessionId && isTerminal
                    ? "No session to resume — the agent didn't produce a session ID"
                    : canResume
                      ? "Resume the agent with these instructions"
                      : "Task must be in a resumable state"
                }
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                  canResume
                    ? "bg-primary text-white hover:bg-primary-hover"
                    : "bg-bg-hover text-text-muted"
                )}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            {isTerminal && !task.sessionId && (
              <p className="text-[10px] text-text-muted/50 mt-1">
                Resume unavailable — no session was captured for this task.
              </p>
            )}
          </div>
        </div>

        {/* Events sidebar (togglable) */}
        {showEvents && (
          <div className="w-72 shrink-0 border-l border-border overflow-auto p-3 bg-bg-card">
            <h3 className="text-xs font-medium text-text-muted mb-3">State Timeline</h3>
            <EventTimeline events={events} />
          </div>
        )}
      </div>
    </div>
  );
}
