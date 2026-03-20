/** Raw NDJSON event from Claude Code's stream-json output */
export interface ClaudeStreamEvent {
  type: string;
  session_id?: string;
  uuid?: string;
  event?: {
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
    };
    type?: string;
  };
  subtype?: string;
  // For message type
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
    content?: string;
  }>;
  // For system type
  attempt?: number;
  error?: string;
  error_status?: number;
}

/** Parsed, normalized event for Optio's log storage and UI */
export interface AgentLogEntry {
  taskId: string;
  timestamp: string;
  sessionId?: string;
  type: "text" | "tool_use" | "tool_result" | "thinking" | "system" | "error" | "info";
  content: string;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    isPartial?: boolean;
    exitCode?: number;
    [key: string]: unknown;
  };
}
