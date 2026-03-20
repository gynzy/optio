"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api-client";
import { createLogClient, type WsClient } from "@/lib/ws-client";

export interface LogEntry {
  content: string;
  stream: string;
  timestamp: string;
  logType?: string;
  metadata?: Record<string, unknown>;
}

export function useLogs(taskId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<WsClient | null>(null);

  // Load historical logs
  useEffect(() => {
    api.getTaskLogs(taskId, { limit: 500 }).then((res) => {
      setLogs(res.logs.map((l: any) => ({
        content: l.content,
        stream: l.stream,
        timestamp: l.timestamp,
        logType: l.logType ?? undefined,
        metadata: l.metadata ?? undefined,
      })));
    }).catch(() => {});
  }, [taskId]);

  // Live stream
  useEffect(() => {
    const client = createLogClient(taskId);
    clientRef.current = client;
    client.connect();
    setConnected(true);

    client.on("task:log", (event) => {
      setLogs((prev) => [...prev, {
        content: event.content,
        stream: event.stream,
        timestamp: event.timestamp,
        logType: event.logType,
        metadata: event.metadata,
      }]);
    });

    return () => {
      client.disconnect();
      setConnected(false);
    };
  }, [taskId]);

  const clear = useCallback(() => setLogs([]), []);

  return { logs, connected, clear };
}
