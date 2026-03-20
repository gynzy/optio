"use client";

import { useGlobalWebSocket } from "@/hooks/use-websocket";

export function GlobalWebSocketProvider() {
  useGlobalWebSocket();
  return null;
}
