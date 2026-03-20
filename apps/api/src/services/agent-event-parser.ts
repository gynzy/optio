import type { ClaudeStreamEvent, AgentLogEntry } from "@optio/shared";

/**
 * Parse a single NDJSON line from Claude Code's stream-json output
 * into a normalized AgentLogEntry.
 */
export function parseClaudeEvent(
  line: string,
  taskId: string,
): { entry: AgentLogEntry | null; sessionId?: string } {
  let event: ClaudeStreamEvent;
  try {
    event = JSON.parse(line);
  } catch {
    // Not valid JSON — treat as raw text
    return {
      entry: {
        taskId,
        timestamp: new Date().toISOString(),
        type: "text",
        content: line,
      },
    };
  }

  const sessionId = event.session_id;
  const timestamp = new Date().toISOString();

  // Stream event (token-level deltas)
  if (event.type === "stream_event" && event.event?.delta) {
    const delta = event.event.delta;
    if (delta.type === "text_delta" && delta.text) {
      return {
        sessionId,
        entry: {
          taskId,
          timestamp,
          sessionId,
          type: "text",
          content: delta.text,
          metadata: { isPartial: true },
        },
      };
    }
    // Other delta types (input_json_delta, etc.) — skip for now
    return { sessionId, entry: null };
  }

  // Complete message
  if (event.type === "message" && event.content) {
    for (const block of event.content) {
      if (block.type === "text" && block.text) {
        return {
          sessionId,
          entry: {
            taskId,
            timestamp,
            sessionId,
            type: "text",
            content: block.text,
          },
        };
      }
      if (block.type === "tool_use" && block.name) {
        return {
          sessionId,
          entry: {
            taskId,
            timestamp,
            sessionId,
            type: "tool_use",
            content: `${block.name}`,
            metadata: {
              toolName: block.name,
              toolInput: block.input,
            },
          },
        };
      }
      if (block.type === "tool_result") {
        return {
          sessionId,
          entry: {
            taskId,
            timestamp,
            sessionId,
            type: "tool_result",
            content: block.content ?? "",
            metadata: {
              toolName: block.name,
            },
          },
        };
      }
    }
    return { sessionId, entry: null };
  }

  // System event
  if (event.type === "system") {
    return {
      sessionId,
      entry: {
        taskId,
        timestamp,
        sessionId,
        type: "system",
        content: event.subtype
          ? `[${event.subtype}] ${event.error ?? ""}`
          : JSON.stringify(event),
        metadata: {
          subtype: event.subtype,
          attempt: event.attempt,
          errorStatus: event.error_status,
        },
      },
    };
  }

  // Result event (final output from --output-format json, sometimes appears in stream)
  const eventRecord = event as unknown as Record<string, unknown>;
  if (event.type === "result" || eventRecord.result) {
    return {
      sessionId: sessionId ?? (eventRecord.session_id as string | undefined),
      entry: {
        taskId,
        timestamp,
        sessionId,
        type: "info",
        content: (eventRecord.result as string) ?? JSON.stringify(event),
      },
    };
  }

  // Unknown event type — log raw
  return {
    sessionId,
    entry: {
      taskId,
      timestamp,
      sessionId,
      type: "system",
      content: line,
    },
  };
}

/**
 * Parse multiple NDJSON lines, returning all entries and the session ID.
 */
export function parseClaudeOutput(
  output: string,
  taskId: string,
): { entries: AgentLogEntry[]; sessionId?: string } {
  const entries: AgentLogEntry[] = [];
  let sessionId: string | undefined;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const result = parseClaudeEvent(line, taskId);
    if (result.sessionId) sessionId = result.sessionId;
    if (result.entry) entries.push(result.entry);
  }

  return { entries, sessionId };
}
