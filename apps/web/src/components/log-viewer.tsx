"use client";

import { useEffect, useRef, useState } from "react";
import { useLogs } from "@/hooks/use-logs";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  Wifi,
  WifiOff,
  Trash2,
  Terminal,
  FileEdit,
  Search,
  AlertCircle,
  Info,
  Wrench,
} from "lucide-react";

const TYPE_CONFIG: Record<string, { icon: typeof Terminal; color: string; label: string }> = {
  text: { icon: Terminal, color: "text-text/80", label: "Output" },
  tool_use: { icon: Wrench, color: "text-primary", label: "Tool" },
  tool_result: { icon: FileEdit, color: "text-text-muted", label: "Result" },
  thinking: { icon: Search, color: "text-text-muted/50", label: "Thinking" },
  system: { icon: Info, color: "text-info", label: "System" },
  error: { icon: AlertCircle, color: "text-error", label: "Error" },
  info: { icon: Info, color: "text-success", label: "Info" },
};

export function LogViewer({ taskId }: { taskId: string }) {
  const { logs, connected, clear } = useLogs(taskId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTools, setShowTools] = useState(true);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const filteredLogs = showTools ? logs : logs.filter((l) => l.logType !== "tool_use" && l.logType !== "tool_result");

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-bg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-card">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {connected ? (
            <><Wifi className="w-3 h-3 text-success" /> Live</>
          ) : (
            <><WifiOff className="w-3 h-3 text-error" /> Disconnected</>
          )}
          <span className="opacity-50">·</span>
          <span>{logs.length} events</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowTools(!showTools)}
            className={cn("px-2 py-0.5 rounded text-xs transition-colors", showTools ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-bg-hover")}
          >
            Tools
          </button>
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
              }}
              className="p-1 rounded hover:bg-bg-hover text-text-muted"
              title="Scroll to bottom"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={clear} className="p-1 rounded hover:bg-bg-hover text-text-muted" title="Clear">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-auto p-2 font-mono text-xs leading-relaxed">
        {filteredLogs.length === 0 ? (
          <div className="text-text-muted text-center py-8">Waiting for output...</div>
        ) : (
          filteredLogs.map((log, i) => {
            const config = TYPE_CONFIG[log.logType ?? "text"] ?? TYPE_CONFIG.text;
            const Icon = config.icon;
            return (
              <div key={i} className={cn("flex gap-2 py-0.5 group", config.color)}>
                <Icon className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
                <div className="min-w-0 flex-1">
                  {log.logType === "tool_use" && log.metadata?.toolName ? (
                    <div>
                      <span className="font-medium">{log.metadata.toolName as string}</span>
                      {log.metadata.toolInput ? (
                        <pre className="text-text-muted/50 mt-0.5 whitespace-pre-wrap break-all text-[10px]">
                          {JSON.stringify(log.metadata.toolInput, null, 2).slice(0, 200)}
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
    </div>
  );
}
