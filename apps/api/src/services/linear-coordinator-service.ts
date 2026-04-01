/**
 * Linear Coordinator Service
 *
 * Orchestrates the Linear agent: manages sessions, acquires processing locks,
 * runs the Anthropic tool-use loop, and streams activities back to Linear.
 */

import { randomUUID } from "node:crypto";
import { eq, and, or, lt, isNull } from "drizzle-orm";
import { OPTIO_TOOL_SCHEMAS, type LinearEnrichedContext } from "@optio/shared";
import { logger } from "../logger.js";
import { db } from "../db/client.js";
import { linearAgentSessions, repos, customSkills } from "../db/schema.js";
import { createLinearApiService, type LinearApiService } from "./linear-api-service.js";
import {
  formatActionForLinear,
  formatResultForLinear,
  formatGreeting,
  getAlreadyLockedMessage,
  getStopConfirmation,
  formatTerminationError,
  getResumeGreeting,
} from "./linear-personality.js";
import { LinearTaskMonitor } from "./linear-task-monitor.js";
import { createSubscriber } from "./event-bus.js";
import { executeToolCall, truncateToolResult } from "./optio-tool-executor.js";
import {
  toAnthropicTools,
  streamAnthropicResponse,
  type AnthropicContentBlock,
} from "../ws/optio-chat.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_BASE_URL ?? "https://api.anthropic.com";
const POD_ID =
  process.env.HOSTNAME ?? process.env.POD_NAME ?? `coordinator-${randomUUID().slice(0, 8)}`;
const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS = 25;
const MODEL = "claude-sonnet-4-6";

const log = logger.child({ service: "linear-coordinator" });

// ─── In-memory state for active sessions ─────────────────────────────────────

interface ActiveSession {
  abortController: AbortController;
  taskMonitor: LinearTaskMonitor;
  redisSubscriber: ReturnType<typeof createSubscriber> | null;
}

const activeSessions = new Map<string, ActiveSession>();

// ─── Auth helpers (same pattern as optio-chat.ts) ────────────────────────────

async function getAnthropicAuth(): Promise<{ apiKey?: string; oauthToken?: string }> {
  try {
    const { retrieveSecret } = await import("./secret-service.js");
    const authMode = (await retrieveSecret("CLAUDE_AUTH_MODE").catch(() => null)) as string | null;

    if (authMode === "api-key") {
      const apiKey = await retrieveSecret("ANTHROPIC_API_KEY").catch(() => null);
      return apiKey ? { apiKey: apiKey as string } : {};
    } else if (authMode === "oauth-token") {
      const token = await retrieveSecret("CLAUDE_CODE_OAUTH_TOKEN").catch(() => null);
      return token ? { oauthToken: token as string } : {};
    } else if (authMode === "max-subscription") {
      const { getClaudeAuthToken } = await import("./auth-service.js");
      const result = getClaudeAuthToken();
      return result.available && result.token ? { oauthToken: result.token } : {};
    }
  } catch (err) {
    log.warn({ err }, "Failed to get Anthropic auth");
  }
  return {};
}

function buildAnthropicHeaders(auth: {
  apiKey?: string;
  oauthToken?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (auth.apiKey) {
    headers["x-api-key"] = auth.apiKey;
  } else if (auth.oauthToken) {
    headers["authorization"] = `Bearer ${auth.oauthToken}`;
  }
  return headers;
}

// ─── System prompt builder ───────────────────────────────────────────────────

export interface CoordinatorPromptContext {
  repos: Array<{ repoUrl: string; fullName: string | null }>;
  skills: Array<{ name: string; description: string | null }>;
  agentPrompt?: string;
  issueTitle?: string;
  issueDescription?: string;
  issueIdentifier?: string;
  enrichedContext?: LinearEnrichedContext | null;
}

export function buildCoordinatorSystemPrompt(ctx: CoordinatorPromptContext): string {
  const parts: string[] = [
    `You are a Linear agent powered by Optio. Users interact with you from Linear issues.`,
    `Your job is to understand what the user needs, figure out which repository and approach to use, and spawn coding tasks in Optio to get the work done.`,
    ``,
    `## How you work`,
    `- You receive messages from a Linear issue thread.`,
    `- You can use tools to interact with Optio: create tasks, check status, list repos, etc.`,
    `- When you create a task, it runs an AI coding agent that opens a PR.`,
    `- You monitor task progress and report back to the user in the Linear thread.`,
    `- Be concise and action-oriented. The user sees your messages as Linear comments.`,
    ``,
    `## Guidelines`,
    `- Always identify the correct repository before creating a task.`,
    `- Write clear, specific task prompts that include the issue context.`,
    `- If you need more information from the user, ask directly.`,
    `- Report task status updates and PR links when available.`,
    `- If a task fails, explain what went wrong and offer to retry.`,
  ];

  if (ctx.repos.length > 0) {
    parts.push(``, `## Available Repositories`);
    for (const r of ctx.repos) {
      parts.push(`- ${r.fullName ?? r.repoUrl}`);
    }
  }

  if (ctx.skills.length > 0) {
    parts.push(``, `## Custom Skills`);
    for (const s of ctx.skills) {
      parts.push(`- **${s.name}**: ${s.description ?? "(no description)"}`);
    }
  }

  if (ctx.agentPrompt) {
    parts.push(``, `## Additional Instructions`, ctx.agentPrompt);
  }

  if (ctx.issueIdentifier || ctx.issueTitle) {
    parts.push(``, `## Current Issue`);
    if (ctx.issueIdentifier) parts.push(`Identifier: ${ctx.issueIdentifier}`);
    if (ctx.issueTitle) parts.push(`Title: ${ctx.issueTitle}`);
    if (ctx.issueDescription) parts.push(`Description: ${ctx.issueDescription}`);
  }

  if (ctx.enrichedContext?.issue) {
    const ic = ctx.enrichedContext.issue;
    if (ic.labels.length > 0) {
      parts.push(`Labels: ${ic.labels.map((l) => l.name).join(", ")}`);
    }
    if (ic.children.length > 0) {
      parts.push(`Sub-issues:`);
      for (const ch of ic.children) {
        parts.push(`  - ${ch.identifier}: ${ch.title}`);
      }
    }
  }

  return parts.join("\n");
}

// ─── Session lock ────────────────────────────────────────────────────────────

export async function acquireLock(linearSessionId: string): Promise<boolean> {
  const now = new Date();
  const expiry = new Date(now.getTime() - LOCK_TTL_MS);

  // Atomic UPDATE: only acquire if unlocked or lock expired
  const result = await db
    .update(linearAgentSessions)
    .set({
      lockedBy: POD_ID,
      lockedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(linearAgentSessions.linearSessionId, linearSessionId),
        or(isNull(linearAgentSessions.lockedBy), lt(linearAgentSessions.lockedAt, expiry)),
      ),
    )
    .returning({ id: linearAgentSessions.id });

  return result.length > 0;
}

async function releaseLock(linearSessionId: string): Promise<void> {
  await db
    .update(linearAgentSessions)
    .set({
      lockedBy: null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(linearAgentSessions.linearSessionId, linearSessionId),
        eq(linearAgentSessions.lockedBy, POD_ID),
      ),
    );
}

// ─── Session persistence ─────────────────────────────────────────────────────

async function upsertSession(
  linearSessionId: string,
  linearIssueId: string | null,
): Promise<typeof linearAgentSessions.$inferSelect | null> {
  // Try to find existing session
  const existing = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.linearSessionId, linearSessionId))
    .limit(1);

  if (existing.length > 0) return existing[0]!;

  // Insert new session
  const inserted = await db
    .insert(linearAgentSessions)
    .values({
      linearSessionId,
      linearIssueId,
      status: "active",
      conversationMessages: [],
      spawnedTaskIds: [],
    })
    .returning();

  return inserted[0] ?? null;
}

async function persistSession(
  linearSessionId: string,
  updates: {
    conversationMessages?: unknown[];
    spawnedTaskIds?: string[];
    status?: string;
    enrichedContext?: LinearEnrichedContext | null;
    costUsd?: string;
    inputTokens?: number;
    outputTokens?: number;
  },
): Promise<void> {
  await db
    .update(linearAgentSessions)
    .set({
      ...updates,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(linearAgentSessions.linearSessionId, linearSessionId));
}

// ─── Context loading ─────────────────────────────────────────────────────────

async function loadCoordinatorContext(): Promise<{
  repoList: Array<{ repoUrl: string; fullName: string | null }>;
  skillList: Array<{ name: string; description: string | null }>;
}> {
  const repoList = await db
    .select({ repoUrl: repos.repoUrl, fullName: repos.fullName })
    .from(repos);

  const skillList = await db
    .select({ name: customSkills.name, description: customSkills.description })
    .from(customSkills)
    .where(eq(customSkills.enabled, true));

  return { repoList, skillList };
}

// ─── Redis task event subscription ───────────────────────────────────────────

function subscribeToTaskEvents(
  linearSessionId: string,
  taskMonitor: LinearTaskMonitor,
): ReturnType<typeof createSubscriber> {
  const subscriber = createSubscriber();

  subscriber.on("message", (_channel: string, message: string) => {
    try {
      const event = JSON.parse(message);
      if (event.type === "task:state" && event.taskId) {
        taskMonitor.onTaskStateChange(event.taskId, event.state).catch((err) => {
          log.error({ err, taskId: event.taskId }, "Failed to handle task state change");
        });
      }
      if (event.type === "task:pr" && event.taskId && event.prUrl) {
        taskMonitor.onPrOpened(event.taskId, event.prUrl).catch((err) => {
          log.error({ err, taskId: event.taskId }, "Failed to handle PR opened");
        });
      }
    } catch {
      // ignore parse errors
    }
  });

  subscriber.subscribe("optio:events").catch((err) => {
    log.error({ err, linearSessionId }, "Failed to subscribe to task events");
  });

  return subscriber;
}

// ─── Tool-use loop ───────────────────────────────────────────────────────────

async function runToolLoop(
  linearSessionId: string,
  linearApi: LinearApiService,
  conversationMessages: Array<{
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }>,
  systemPrompt: string,
  auth: { apiKey?: string; oauthToken?: string },
  abortController: AbortController,
  taskMonitor: LinearTaskMonitor,
): Promise<{
  messages: Array<{ role: "user" | "assistant"; content: string | AnthropicContentBlock[] }>;
  totalInputTokens: number;
  totalOutputTokens: number;
}> {
  const headers = buildAnthropicHeaders(auth);
  const tools = toAnthropicTools(OPTIO_TOOL_SCHEMAS, []);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Get Fastify app for tool execution
  const { getApp } = await import("../server.js");
  const app = getApp();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (abortController.signal.aborted) break;

    const body = {
      model: MODEL,
      system: systemPrompt,
      messages: conversationMessages,
      ...(tools.length > 0 ? { tools } : {}),
      max_tokens: 4096,
      stream: true,
    };

    let response: Response;
    try {
      response = await fetch(`${ANTHROPIC_API_URL}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        log.info({ linearSessionId }, "API call aborted");
        break;
      }
      throw err;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.error(
        { status: response.status, body: errorBody, linearSessionId },
        "Anthropic API error",
      );
      await linearApi.createTextActivity(
        linearSessionId,
        "error",
        `API error (${response.status}): ${errorBody.slice(0, 200)}`,
      );
      break;
    }

    // Stream response — collect blocks (we don't send deltas to Linear, just final text)
    const { content, stopReason, inputTokens, outputTokens } = await streamAnthropicResponse(
      response,
      () => {}, // no real-time streaming to Linear
    );

    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    conversationMessages.push({ role: "assistant", content });

    // Send any text blocks to Linear as activities
    for (const block of content) {
      if (block.type === "text" && block.text?.trim()) {
        await linearApi.createTextActivity(linearSessionId, "response", block.text);
      }
    }

    // If no tool calls, we're done
    if (stopReason !== "tool_use") break;

    // Execute tool calls
    const toolCalls = content.filter((b) => b.type === "tool_use");
    const toolResults: AnthropicContentBlock[] = [];

    for (const tc of toolCalls) {
      const toolName = tc.name!;
      const toolInput = (tc.input ?? {}) as Record<string, unknown>;

      // Send action activity to Linear
      const { action, parameter } = formatActionForLinear(toolName, toolInput);
      await linearApi.createActionActivity(linearSessionId, action, parameter);

      // Execute the tool
      const result = await executeToolCall(
        app,
        toolName,
        toolInput,
        "", // No user session token — coordinator runs with system-level access
      );

      // Send result activity to Linear
      const resultText = formatResultForLinear(toolName, result.result, !result.success);
      if (resultText) {
        await linearApi.createActionActivity(linearSessionId, action, parameter, resultText);
      }

      // Track spawned tasks
      if (toolName === "create_task" && result.success) {
        try {
          const parsed = JSON.parse(result.result);
          if (parsed.id) {
            taskMonitor.addTask(parsed.id, parsed.title ?? "Spawned task");
          }
        } catch {
          // ignore parse errors
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id!,
        content: truncateToolResult(result.result),
        is_error: !result.success,
      });
    }

    conversationMessages.push({ role: "user", content: toolResults });
  }

  return { messages: conversationMessages, totalInputTokens, totalOutputTokens };
}

// ─── Main webhook handler ────────────────────────────────────────────────────

export async function handleWebhook(payload: any): Promise<void> {
  const linearSessionId = payload.agentSession?.id as string;
  const linearIssueId = payload.agentSession?.issueId as string | undefined;
  const userMessage = payload.agentActivity?.body as string | undefined;
  const userName = payload.agentActivity?.user?.name as string | undefined;
  const issueTitle = payload.agentSession?.issue?.title as string | undefined;
  const issueDescription = payload.agentSession?.issue?.description as string | undefined;
  const issueIdentifier = payload.agentSession?.issue?.identifier as string | undefined;

  log.info({ linearSessionId, linearIssueId }, "Processing webhook");

  const linearApi = createLinearApiService();

  // Upsert session
  const session = await upsertSession(linearSessionId, linearIssueId ?? null);
  if (!session) {
    log.error({ linearSessionId }, "Failed to upsert session");
    return;
  }

  // Acquire processing lock
  const locked = await acquireLock(linearSessionId);
  if (!locked) {
    log.warn({ linearSessionId }, "Session is locked by another processor");
    await linearApi.createTextActivity(linearSessionId, "thought", getAlreadyLockedMessage(), true);
    return;
  }

  try {
    // Get auth
    const auth = await getAnthropicAuth();
    if (!auth.apiKey && !auth.oauthToken) {
      log.error({ linearSessionId }, "No Anthropic credentials configured");
      await linearApi.createTextActivity(
        linearSessionId,
        "error",
        "No Anthropic credentials configured. Please set up an API key or OAuth token.",
      );
      return;
    }

    // Enrich context if not already cached
    let enrichedContext = session.enrichedContext as LinearEnrichedContext | null;
    if (!enrichedContext && linearIssueId) {
      try {
        enrichedContext = await linearApi.enrichContext(linearIssueId);
        await persistSession(linearSessionId, { enrichedContext });
      } catch (err) {
        log.warn({ err, linearSessionId }, "Failed to enrich context");
      }
    }

    // Load coordinator context
    const { repoList, skillList } = await loadCoordinatorContext();

    // Build system prompt
    const systemPrompt = buildCoordinatorSystemPrompt({
      repos: repoList,
      skills: skillList,
      issueTitle,
      issueDescription,
      issueIdentifier,
      enrichedContext,
    });

    // Build conversation messages from stored state
    const conversationMessages: Array<{
      role: "user" | "assistant";
      content: string | AnthropicContentBlock[];
    }> = (session.conversationMessages as any[]) ?? [];

    // If this is a fresh session, send greeting
    const isNewSession = conversationMessages.length === 0;
    if (isNewSession && userName) {
      await linearApi.createTextActivity(
        linearSessionId,
        "thought",
        formatGreeting(userName),
        true,
      );
    }

    // If session was interrupted, note the resume
    if (session.status === "interrupted") {
      await linearApi.createTextActivity(linearSessionId, "thought", getResumeGreeting(), true);
    }

    // Add the user message
    if (userMessage?.trim()) {
      conversationMessages.push({ role: "user", content: userMessage });
    } else if (isNewSession) {
      // For new sessions without explicit message, use the issue context as the prompt
      const prompt = issueTitle
        ? `I've been assigned to this issue: ${issueIdentifier ?? ""} ${issueTitle}. ${issueDescription ?? ""}`
        : "Hello, I'm ready to help. What would you like me to work on?";
      conversationMessages.push({ role: "user", content: prompt });
    }

    // Set up task monitor and event subscription
    const abortController = new AbortController();
    const taskMonitor = new LinearTaskMonitor(linearSessionId, linearApi);
    const subscriber = subscribeToTaskEvents(linearSessionId, taskMonitor);

    // Track active session
    activeSessions.set(linearSessionId, {
      abortController,
      taskMonitor,
      redisSubscriber: subscriber,
    });

    // Restore previously tracked tasks
    for (const taskId of session.spawnedTaskIds ?? []) {
      taskMonitor.addTask(taskId, `Previously spawned task ${taskId}`);
    }

    // Run the tool-use loop
    const { messages, totalInputTokens, totalOutputTokens } = await runToolLoop(
      linearSessionId,
      linearApi,
      conversationMessages,
      systemPrompt,
      auth,
      abortController,
      taskMonitor,
    );

    // Gather spawned task IDs from the monitor
    const plan = taskMonitor.getPlan();
    const spawnedTaskIds = [
      ...(session.spawnedTaskIds ?? []),
      ...plan.map((p) => p.content).filter((c): c is string => typeof c === "string"),
    ];

    // Compute cumulative cost
    const prevInputTokens = session.inputTokens ?? 0;
    const prevOutputTokens = session.outputTokens ?? 0;

    // Persist session state
    await persistSession(linearSessionId, {
      conversationMessages: messages,
      spawnedTaskIds,
      status: taskMonitor.allTerminal() ? "completed" : "waiting_for_user",
      inputTokens: prevInputTokens + totalInputTokens,
      outputTokens: prevOutputTokens + totalOutputTokens,
    });

    // Sync plan to Linear
    if (plan.length > 0) {
      await linearApi.updateSessionPlan(linearSessionId, plan).catch((err) => {
        log.warn({ err, linearSessionId }, "Failed to sync plan to Linear");
      });
    }

    // Clean up subscription
    subscriber.unsubscribe().catch(() => {});
    subscriber.disconnect();
    activeSessions.delete(linearSessionId);
  } catch (err) {
    log.error({ err, linearSessionId }, "Coordinator error");
    await linearApi
      .createTextActivity(linearSessionId, "error", formatTerminationError("execution_error"))
      .catch(() => {});

    await persistSession(linearSessionId, { status: "failed" });

    // Clean up active session
    const active = activeSessions.get(linearSessionId);
    if (active?.redisSubscriber) {
      active.redisSubscriber.unsubscribe().catch(() => {});
      active.redisSubscriber.disconnect();
    }
    activeSessions.delete(linearSessionId);
  } finally {
    await releaseLock(linearSessionId);
  }
}

// ─── Stop session ────────────────────────────────────────────────────────────

export async function stopSession(linearSessionId: string): Promise<void> {
  log.info({ linearSessionId }, "Stopping session");

  // Abort any in-flight API call
  const active = activeSessions.get(linearSessionId);
  if (active) {
    active.abortController.abort();
    if (active.redisSubscriber) {
      active.redisSubscriber.unsubscribe().catch(() => {});
      active.redisSubscriber.disconnect();
    }
    activeSessions.delete(linearSessionId);
  }

  // Load session to cancel spawned tasks
  const sessions = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.linearSessionId, linearSessionId))
    .limit(1);

  const session = sessions[0];
  if (session?.spawnedTaskIds?.length) {
    const { getApp } = await import("../server.js");
    const app = getApp();

    for (const taskId of session.spawnedTaskIds) {
      try {
        await app.inject({
          method: "POST",
          url: `/api/tasks/${taskId}/cancel`,
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        log.warn({ err, taskId, linearSessionId }, "Failed to cancel spawned task");
      }
    }
  }

  // Update session status
  await persistSession(linearSessionId, { status: "cancelled" });

  // Send stop confirmation to Linear
  const linearApi = createLinearApiService();
  await linearApi
    .createTextActivity(linearSessionId, "response", getStopConfirmation())
    .catch(() => {});

  // Release lock if we hold it
  await releaseLock(linearSessionId);
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

export async function markSessionsInterrupted(): Promise<number> {
  const result = await db
    .update(linearAgentSessions)
    .set({
      status: "interrupted",
      lockedBy: null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(linearAgentSessions.lockedBy, POD_ID),
        or(
          eq(linearAgentSessions.status, "active"),
          eq(linearAgentSessions.status, "waiting_for_user"),
        ),
      ),
    )
    .returning({ id: linearAgentSessions.id });

  // Abort all active sessions on this pod
  for (const [id, active] of activeSessions) {
    active.abortController.abort();
    if (active.redisSubscriber) {
      active.redisSubscriber.unsubscribe().catch(() => {});
      active.redisSubscriber.disconnect();
    }
    activeSessions.delete(id);
  }

  log.info({ count: result.length }, "Marked sessions as interrupted");
  return result.length;
}

// ─── Startup recovery ────────────────────────────────────────────────────────

export async function recoverInterruptedSessions(): Promise<void> {
  const interrupted = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.status, "interrupted"));

  if (interrupted.length === 0) return;

  log.info({ count: interrupted.length }, "Found interrupted sessions to recover");

  for (const session of interrupted) {
    try {
      // Mark as waiting_for_user so the next webhook re-engages
      await persistSession(session.linearSessionId, { status: "waiting_for_user" });
      log.info({ linearSessionId: session.linearSessionId }, "Recovered interrupted session");
    } catch (err) {
      log.error({ err, linearSessionId: session.linearSessionId }, "Failed to recover session");
    }
  }
}
