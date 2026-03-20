"use client";

import { useEffect, useRef } from "react";
import { createEventsClient, type WsClient } from "@/lib/ws-client";
import { useStore } from "./use-store";

export function useGlobalWebSocket() {
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const client = createEventsClient();
    clientRef.current = client;
    client.connect();

    client.on("task:state_changed", (event) => {
      useStore.getState().updateTask(event.taskId, { state: event.toState, updatedAt: event.timestamp });

      if (["needs_attention", "pr_opened", "completed", "failed"].includes(event.toState)) {
        useStore.getState().addNotification({
          id: crypto.randomUUID(),
          type: event.toState === "completed" || event.toState === "pr_opened" ? "success"
            : event.toState === "failed" ? "error"
            : "warning",
          title: `Task ${event.toState.replace("_", " ")}`,
          message: `Task moved to ${event.toState}`,
          taskId: event.taskId,
          timestamp: event.timestamp,
        });

        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`Optio: Task ${event.toState.replace("_", " ")}`, {
            body: `Task moved to ${event.toState}`,
          });
        }
      }
    });

    client.on("task:created", (event) => {
      useStore.getState().addTask({
        id: event.taskId,
        title: event.title,
        state: "pending",
        agentType: "",
        repoUrl: "",
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      });
    });

    return () => {
      client.disconnect();
    };
  }, []); // stable — uses getState() instead of hook selectors
}
