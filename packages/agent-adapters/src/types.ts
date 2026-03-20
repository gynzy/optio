import type { AgentTaskInput, AgentContainerConfig, AgentResult } from "@optio/shared";

export interface AgentAdapter {
  readonly type: string;
  readonly displayName: string;

  /** Validate that required secrets are available */
  validateSecrets(availableSecrets: string[]): { valid: boolean; missing: string[] };

  /** Build the container configuration for running this agent */
  buildContainerConfig(input: AgentTaskInput): AgentContainerConfig;

  /** Parse agent output to determine the result */
  parseResult(exitCode: number, logs: string): AgentResult;
}
