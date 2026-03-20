import type { AgentTaskInput, AgentContainerConfig, AgentResult } from "@optio/shared";
import { TASK_BRANCH_PREFIX } from "@optio/shared";
import type { AgentAdapter } from "./types.js";

export class CodexAdapter implements AgentAdapter {
  readonly type = "codex";
  readonly displayName = "OpenAI Codex";

  validateSecrets(availableSecrets: string[]): { valid: boolean; missing: string[] } {
    const required = ["OPENAI_API_KEY", "GITHUB_TOKEN"];
    const missing = required.filter((s) => !availableSecrets.includes(s));
    return { valid: missing.length === 0, missing };
  }

  buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
    const prompt = this.buildPrompt(input);
    return {
      command: ["/opt/optio/entrypoint.sh"],
      env: {
        OPTIO_TASK_ID: input.taskId,
        OPTIO_REPO_URL: input.repoUrl,
        OPTIO_REPO_BRANCH: input.repoBranch,
        OPTIO_PROMPT: prompt,
        OPTIO_AGENT_TYPE: "codex",
        OPTIO_BRANCH_NAME: `${TASK_BRANCH_PREFIX}${input.taskId}`,
      },
      requiredSecrets: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    };
  }

  parseResult(exitCode: number, logs: string): AgentResult {
    const prMatch = logs.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    return {
      success: exitCode === 0,
      prUrl: prMatch?.[0],
      summary: exitCode === 0
        ? "Agent completed successfully"
        : `Agent exited with code ${exitCode}`,
      error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
    };
  }

  private buildPrompt(input: AgentTaskInput): string {
    const parts = [
      input.prompt,
      "",
      "Instructions:",
      "- Work on the task described above.",
      "- When you are done, create a pull request using the gh CLI.",
      `- Use branch name: ${TASK_BRANCH_PREFIX}${input.taskId}`,
      "- Write a clear PR title and description summarizing your changes.",
    ];
    if (input.additionalContext) {
      parts.push("", "Additional context:", input.additionalContext);
    }
    return parts.join("\n");
  }
}
