import type { AgentTaskInput, AgentContainerConfig, AgentResult } from "@optio/shared";
import { TASK_BRANCH_PREFIX } from "@optio/shared";
import type { AgentAdapter } from "./types.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly type = "claude-code";
  readonly displayName = "Claude Code";

  validateSecrets(availableSecrets: string[]): { valid: boolean; missing: string[] } {
    // GITHUB_TOKEN is always required
    // ANTHROPIC_API_KEY is only required in api-key mode (checked at runtime)
    const required = ["GITHUB_TOKEN"];
    const missing = required.filter((s) => !availableSecrets.includes(s));
    return { valid: missing.length === 0, missing };
  }

  buildContainerConfig(input: AgentTaskInput): AgentContainerConfig {
    // Use the pre-rendered prompt from the template system, or fall back to raw prompt
    const prompt = input.renderedPrompt ?? input.prompt;
    const authMode = input.claudeAuthMode ?? "api-key";

    const env: Record<string, string> = {
      OPTIO_TASK_ID: input.taskId,
      OPTIO_REPO_URL: input.repoUrl,
      OPTIO_REPO_BRANCH: input.repoBranch,
      OPTIO_PROMPT: prompt,
      OPTIO_AGENT_TYPE: "claude-code",
      OPTIO_BRANCH_NAME: `${TASK_BRANCH_PREFIX}${input.taskId}`,
      OPTIO_AUTH_MODE: authMode,
    };

    const requiredSecrets = ["GITHUB_TOKEN"];
    const setupFiles: AgentContainerConfig["setupFiles"] = [];

    // Write the task file into the worktree
    if (input.taskFileContent && input.taskFilePath) {
      setupFiles.push({
        path: input.taskFilePath,
        content: input.taskFileContent,
      });
    }

    if (authMode === "api-key") {
      requiredSecrets.push("ANTHROPIC_API_KEY");
    } else if (authMode === "max-subscription") {
      const apiUrl = input.optioApiUrl ?? "http://host.docker.internal:4000";
      env.OPTIO_API_URL = apiUrl;

      setupFiles.push({
        path: "/opt/optio/claude-key-helper.sh",
        content: [
          "#!/bin/bash",
          `TOKEN=$(curl -sf "${apiUrl}/api/auth/claude-token" 2>/dev/null)`,
          'if [ -z "$TOKEN" ]; then',
          '  echo "Failed to get token from Optio API" >&2',
          "  exit 1",
          "fi",
          'echo "$TOKEN"',
        ].join("\n"),
        executable: true,
      });

      setupFiles.push({
        path: "/home/agent/.claude/settings.json",
        content: JSON.stringify({
          apiKeyHelper: "/opt/optio/claude-key-helper.sh",
        }),
      });
    }

    return {
      command: ["/opt/optio/entrypoint.sh"],
      env,
      requiredSecrets,
      setupFiles,
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
}
