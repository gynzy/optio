"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api-client";

export function useTask(id: string) {
  const [task, setTask] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [taskRes, eventsRes] = await Promise.all([
        api.getTask(id),
        api.getTaskEvents(id),
      ]);
      setTask(taskRes.task);
      setEvents(eventsRes.events);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { task, events, loading, error, refresh };
}
