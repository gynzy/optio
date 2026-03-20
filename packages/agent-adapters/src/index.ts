export type { AgentAdapter } from "./types.js";
export { ClaudeCodeAdapter } from "./claude-code.js";
export { CodexAdapter } from "./codex.js";

import type { AgentAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";

const adapters: Record<string, AgentAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  codex: new CodexAdapter(),
};

export function getAdapter(type: string): AgentAdapter {
  const adapter = adapters[type];
  if (!adapter) {
    throw new Error(`Unknown agent type: ${type}. Available: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter;
}

export function getAvailableAdapters(): AgentAdapter[] {
  return Object.values(adapters);
}
