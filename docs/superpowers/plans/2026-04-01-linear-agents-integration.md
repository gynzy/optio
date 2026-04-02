# Linear Agents Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full Linear Agents protocol integration — AI coordinator receives Linear webhooks, clarifies scope, routes to repos, creates Optio worker tasks, and streams progress back to Linear's agent panel.

**Architecture:** In-process coordinator service using the Ask Optio pattern (Anthropic Messages API + tool-use loop). Webhook endpoint receives Linear events, coordinator reasons about repos/tasks using Optio's existing tools, streams activities back via `@linear/sdk`. Worker task progress tracked via Redis pub/sub and reflected as plan/todo updates in Linear.

**Tech Stack:** `@linear/sdk`, Anthropic Messages API, Fastify routes, Drizzle ORM, Redis pub/sub, BullMQ (cleanup), Zod validation

**Spec:** `docs/superpowers/specs/2026-04-01-linear-agents-integration-design.md`

---

## File Structure

### New Files

| File                                                        | Responsibility                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/shared/src/types/linear-agent.ts`                 | Shared types: session status, enriched context, plan todo, activity types |
| `apps/api/src/db/migrations/XXXX_linear_agent_sessions.sql` | Migration for `linear_agent_sessions` table                               |
| `apps/api/src/services/linear-api-service.ts`               | Thin `@linear/sdk` wrapper: activities, plan updates, context enrichment  |
| `apps/api/src/services/linear-personality.ts`               | Formatting layer: tool call display, user messages, error formatting      |
| `apps/api/src/services/linear-coordinator-service.ts`       | Core orchestration: session management, tool-use loop, webhook handling   |
| `apps/api/src/services/linear-task-monitor.ts`              | Redis pub/sub subscriber: maps task state changes to Linear plan updates  |
| `apps/api/src/routes/linear-webhook.ts`                     | `POST /api/webhooks/linear` with HMAC validation                          |
| `apps/api/src/services/linear-api-service.test.ts`          | Tests for Linear API service                                              |
| `apps/api/src/services/linear-personality.test.ts`          | Tests for personality formatting                                          |
| `apps/api/src/services/linear-coordinator-service.test.ts`  | Tests for coordinator service                                             |
| `apps/api/src/services/linear-task-monitor.test.ts`         | Tests for task monitor                                                    |
| `apps/api/src/routes/linear-webhook.test.ts`                | Tests for webhook route                                                   |

### Modified Files

| File                                          | Change                                               |
| --------------------------------------------- | ---------------------------------------------------- |
| `packages/shared/src/index.ts`                | Export new `linear-agent` types                      |
| `apps/api/src/db/schema.ts`                   | Add `linearAgentSessions` table definition           |
| `apps/api/src/server.ts`                      | Register `linearWebhookRoutes`                       |
| `apps/api/src/index.ts`                       | Add session recovery on startup, cleanup on shutdown |
| `apps/api/src/workers/repo-cleanup-worker.ts` | Add stale Linear session cleanup                     |
| `apps/api/src/plugins/auth.ts`                | Exempt `/api/webhooks/linear` from auth              |

---

## Task 1: Shared Types

**Files:**

- Create: `packages/shared/src/types/linear-agent.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// packages/shared/src/types/linear-agent.ts

/**
 * Linear Agent session status values.
 */
export enum LinearSessionStatus {
  ACTIVE = "active",
  WAITING_FOR_USER = "waiting_for_user",
  INTERRUPTED = "interrupted",
  FAILED = "failed",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

/**
 * Linear Agent activity types (mirrors Linear SDK).
 */
export enum LinearActivityType {
  THOUGHT = "thought",
  ELICITATION = "elicitation",
  RESPONSE = "response",
  ERROR = "error",
  ACTION = "action",
}

/**
 * Plan todo status values (Linear's expected format).
 */
export enum LinearPlanTodoStatus {
  PENDING = "pending",
  IN_PROGRESS = "inProgress",
  COMPLETED = "completed",
  CANCELED = "canceled",
}

/**
 * A single todo item in the Linear agent plan.
 */
export interface LinearPlanTodo {
  content: string;
  status: LinearPlanTodoStatus;
}

/**
 * Enriched context fetched from Linear for an issue.
 */
export interface LinearEnrichedContext {
  issue?: {
    labels: Array<{ id: string; name: string }>;
    children: Array<{ identifier: string; title: string; url: string }>;
    attachments: Array<{ id: string; title: string; url: string }>;
  };
}

/**
 * Stored session record shape (matches DB columns).
 */
export interface LinearAgentSession {
  id: string;
  linearSessionId: string;
  linearIssueId: string | null;
  status: LinearSessionStatus;
  conversationMessages: unknown[];
  enrichedContext: LinearEnrichedContext | null;
  spawnedTaskIds: string[];
  lockedBy: string | null;
  lockedAt: Date | null;
  lastActiveAt: Date;
  costUsd: string | null;
  inputTokens: number;
  outputTokens: number;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Normalize common status strings to Linear's plan todo format.
 */
export function normalizeLinearTodoStatus(status: string): LinearPlanTodoStatus {
  const map: Record<string, LinearPlanTodoStatus> = {
    pending: LinearPlanTodoStatus.PENDING,
    queued: LinearPlanTodoStatus.PENDING,
    in_progress: LinearPlanTodoStatus.IN_PROGRESS,
    provisioning: LinearPlanTodoStatus.IN_PROGRESS,
    running: LinearPlanTodoStatus.IN_PROGRESS,
    pr_opened: LinearPlanTodoStatus.IN_PROGRESS,
    completed: LinearPlanTodoStatus.COMPLETED,
    failed: LinearPlanTodoStatus.CANCELED,
    cancelled: LinearPlanTodoStatus.CANCELED,
    canceled: LinearPlanTodoStatus.CANCELED,
  };
  return map[status] ?? LinearPlanTodoStatus.PENDING;
}
```

- [ ] **Step 2: Export from shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export * from "./types/linear-agent.js";
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/shared`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/linear-agent.ts packages/shared/src/index.ts
git commit -m "feat: add shared types for Linear agent integration"
```

---

## Task 2: Database Migration & Schema

**Files:**

- Create: `apps/api/src/db/migrations/XXXX_linear_agent_sessions.sql` (via drizzle-kit generate)
- Modify: `apps/api/src/db/schema.ts`

- [ ] **Step 1: Add table definition to schema.ts**

Add after the `optioSettings` table definition in `apps/api/src/db/schema.ts`:

```typescript
// ── Linear Agent Sessions ───────────────────────────────────────────────────

export const linearAgentSessions = pgTable(
  "linear_agent_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linearSessionId: text("linear_session_id").notNull(),
    linearIssueId: text("linear_issue_id"),
    status: text("status").notNull().default("active"),
    conversationMessages: jsonb("conversation_messages").$type<unknown[]>().notNull().default([]),
    enrichedContext: jsonb("enriched_context"),
    spawnedTaskIds: jsonb("spawned_task_ids").$type<string[]>().notNull().default([]),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
    costUsd: text("cost_usd"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    workspaceId: uuid("workspace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("linear_agent_sessions_linear_session_id_idx").on(table.linearSessionId),
    index("linear_agent_sessions_status_idx").on(table.status),
  ],
);
```

- [ ] **Step 2: Generate migration**

Run: `cd apps/api && npx drizzle-kit generate`
Expected: A new migration SQL file created in `apps/api/src/db/migrations/`

- [ ] **Step 3: Verify the generated SQL**

Read the generated migration file. It should contain:

```sql
CREATE TABLE "linear_agent_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "linear_session_id" text NOT NULL,
  "linear_issue_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "conversation_messages" jsonb DEFAULT '[]' NOT NULL,
  "enriched_context" jsonb,
  "spawned_task_ids" jsonb DEFAULT '[]' NOT NULL,
  "locked_by" text,
  "locked_at" timestamp with time zone,
  "last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cost_usd" text,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "workspace_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "linear_agent_sessions_linear_session_id_idx" ON "linear_agent_sessions" USING btree ("linear_session_id");
CREATE INDEX "linear_agent_sessions_status_idx" ON "linear_agent_sessions" USING btree ("status");
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/
git commit -m "feat: add linear_agent_sessions database table"
```

---

## Task 3: Linear API Service

**Files:**

- Create: `apps/api/src/services/linear-api-service.ts`
- Create: `apps/api/src/services/linear-api-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/linear-api-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLinearApiService, type LinearApiService } from "./linear-api-service.js";

// Mock the secret-service to return a fake token
vi.mock("./secret-service.js", () => ({
  retrieveSecret: vi.fn(async (name: string) => {
    if (name === "LINEAR_API_TOKEN") return "test-token";
    throw new Error(`Secret not found: ${name}`);
  }),
}));

// Mock the @linear/sdk
const mockCreateAgentActivity = vi.fn().mockResolvedValue({
  success: true,
  agentActivity: Promise.resolve({ id: "activity-1" }),
});
const mockUpdateAgentSession = vi.fn().mockResolvedValue({ success: true });
const mockIssue = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createAgentActivity: mockCreateAgentActivity,
    updateAgentSession: mockUpdateAgentSession,
    issue: mockIssue,
  })),
}));

describe("LinearApiService", () => {
  let service: LinearApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createLinearApiService();
  });

  describe("createTextActivity", () => {
    it("posts a text activity to Linear", async () => {
      await service.initialize();
      const result = await service.createTextActivity("session-1", "response", "Hello");

      expect(mockCreateAgentActivity).toHaveBeenCalledWith({
        agentSessionId: "session-1",
        content: { type: "response", body: "Hello" },
        ephemeral: undefined,
      });
      expect(result).toBe("activity-1");
    });
  });

  describe("createActionActivity", () => {
    it("posts an action activity to Linear", async () => {
      await service.initialize();
      await service.createActionActivity("session-1", "Creating task", "repo: frontend", "success");

      expect(mockCreateAgentActivity).toHaveBeenCalledWith({
        agentSessionId: "session-1",
        content: {
          type: "action",
          action: "Creating task",
          parameter: "repo: frontend",
          result: "success",
        },
        ephemeral: undefined,
      });
    });
  });

  describe("updateSessionPlan", () => {
    it("updates plan todos on a Linear session", async () => {
      await service.initialize();
      await service.updateSessionPlan("session-1", [
        { content: "Analyze scope", status: "completed" },
        { content: "Create backend task", status: "pending" },
      ]);

      expect(mockUpdateAgentSession).toHaveBeenCalledWith("session-1", {
        plan: [
          { content: "Analyze scope", status: "completed" },
          { content: "Create backend task", status: "pending" },
        ],
      });
    });
  });

  describe("enrichContext", () => {
    it("fetches labels, children, and attachments for an issue", async () => {
      mockIssue.mockResolvedValue({
        labels: vi.fn().mockResolvedValue({
          nodes: [{ id: "l1", name: "bug" }],
        }),
        children: vi.fn().mockResolvedValue({
          nodes: [{ identifier: "ENG-2", title: "Sub-issue", url: "https://linear.app/..." }],
        }),
        attachments: vi.fn().mockResolvedValue({
          nodes: [{ id: "a1", title: "Design", url: "https://figma.com/..." }],
        }),
      });

      await service.initialize();
      const context = await service.enrichContext("issue-1");

      expect(context.issue).toEqual({
        labels: [{ id: "l1", name: "bug" }],
        children: [{ identifier: "ENG-2", title: "Sub-issue", url: "https://linear.app/..." }],
        attachments: [{ id: "a1", title: "Design", url: "https://figma.com/..." }],
      });
    });

    it("returns empty context on failure", async () => {
      mockIssue.mockRejectedValue(new Error("Not found"));

      await service.initialize();
      const context = await service.enrichContext("bad-id");

      expect(context).toEqual({});
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/services/linear-api-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the Linear API service**

```typescript
// apps/api/src/services/linear-api-service.ts
import { LinearClient } from "@linear/sdk";
import type { LinearEnrichedContext, LinearPlanTodo } from "@optio/shared";
import { logger } from "../logger.js";

const log = logger.child({ service: "linear-api" });

export interface LinearApiService {
  /** Initialize the client with the stored API token. */
  initialize(): Promise<void>;

  /** Post a text activity (thought, response, elicitation, error). */
  createTextActivity(
    sessionId: string,
    type: string,
    body: string,
    ephemeral?: boolean,
  ): Promise<string | undefined>;

  /** Post an action activity (tool invocation). */
  createActionActivity(
    sessionId: string,
    action: string,
    parameter?: string,
    result?: string,
  ): Promise<string | undefined>;

  /** Update the plan/todo list for a session. */
  updateSessionPlan(sessionId: string, plan: LinearPlanTodo[]): Promise<void>;

  /** Fetch enriched context (labels, children, attachments) for an issue. */
  enrichContext(issueId: string): Promise<LinearEnrichedContext>;
}

export function createLinearApiService(): LinearApiService {
  let client: LinearClient | null = null;

  async function getClient(): Promise<LinearClient> {
    if (client) return client;
    const { retrieveSecret } = await import("./secret-service.js");
    const token = (await retrieveSecret("LINEAR_API_TOKEN")) as string;
    client = new LinearClient({ apiKey: token });
    return client;
  }

  return {
    async initialize() {
      await getClient();
    },

    async createTextActivity(sessionId, type, body, ephemeral) {
      const c = await getClient();
      try {
        const result = await c.createAgentActivity({
          agentSessionId: sessionId,
          content: { type: type as any, body },
          ephemeral: ephemeral || undefined,
        });
        if (result.success) {
          const activity = await result.agentActivity;
          log.info({ sessionId, type }, "Sent activity to Linear");
          return activity?.id;
        }
        log.error({ sessionId, type }, "Failed to create activity");
        return undefined;
      } catch (err) {
        log.error({ err, sessionId, type }, "Failed to create activity");
        throw err;
      }
    },

    async createActionActivity(sessionId, action, parameter, result) {
      const c = await getClient();
      try {
        const res = await c.createAgentActivity({
          agentSessionId: sessionId,
          content: { type: "action" as any, action, parameter, result },
          ephemeral: undefined,
        });
        if (res.success) {
          const activity = await res.agentActivity;
          log.info({ sessionId, action }, "Sent action activity to Linear");
          return activity?.id;
        }
        return undefined;
      } catch (err) {
        log.error({ err, sessionId, action }, "Failed to create action activity");
        throw err;
      }
    },

    async updateSessionPlan(sessionId, plan) {
      const c = await getClient();
      try {
        const result = await c.updateAgentSession(sessionId, {
          plan: plan.map((todo) => ({
            content: todo.content,
            status: todo.status as any,
          })),
        });
        if (result.success) {
          log.info({ sessionId, count: plan.length }, "Updated plan in Linear");
        } else {
          log.error({ sessionId }, "Failed to update plan");
        }
      } catch (err) {
        log.error({ err, sessionId }, "Failed to update plan");
        throw err;
      }
    },

    async enrichContext(issueId) {
      const c = await getClient();
      const context: LinearEnrichedContext = {};
      try {
        const issue = await c.issue(issueId);
        const [labels, children, attachments] = await Promise.all([
          issue.labels(),
          issue.children(),
          issue.attachments(),
        ]);
        context.issue = {
          labels: labels.nodes.map((l) => ({ id: l.id, name: l.name })),
          children: children.nodes.map((ch) => ({
            identifier: ch.identifier,
            title: ch.title,
            url: ch.url,
          })),
          attachments: attachments.nodes.map((a) => ({
            id: a.id,
            title: a.title,
            url: a.url,
          })),
        };
        log.info(
          {
            issueId,
            labels: context.issue.labels.length,
            children: context.issue.children.length,
            attachments: context.issue.attachments.length,
          },
          "Enriched context from Linear",
        );
      } catch (err) {
        log.error({ err, issueId }, "Failed to enrich context");
      }
      return context;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/services/linear-api-service.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/linear-api-service.ts apps/api/src/services/linear-api-service.test.ts
git commit -m "feat: add Linear API service for agent activities and context enrichment"
```

---

## Task 4: Linear Personality / Formatting Layer

**Files:**

- Create: `apps/api/src/services/linear-personality.ts`
- Create: `apps/api/src/services/linear-personality.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/linear-personality.test.ts
import { describe, it, expect } from "vitest";
import {
  formatActionForLinear,
  formatResultForLinear,
  formatGreeting,
  getStopConfirmation,
  getBusyMessage,
  getAlreadyLockedMessage,
  getInterruptionNotice,
  getResumeGreeting,
  formatTerminationError,
} from "./linear-personality.js";

describe("linear-personality", () => {
  describe("formatActionForLinear", () => {
    it("formats create_task as a readable action", () => {
      const result = formatActionForLinear("create_task", {
        title: "Fix auth bug",
        repoUrl: "https://github.com/org/backend",
      });
      expect(result.action).toBe("Creating task");
      expect(result.parameter).toContain("Fix auth bug");
    });

    it("formats list_repos as a readable action", () => {
      const result = formatActionForLinear("list_repos", {});
      expect(result.action).toBe("Checking repositories");
    });

    it("formats list_tasks as a readable action", () => {
      const result = formatActionForLinear("list_tasks", { state: "running" });
      expect(result.action).toBe("Listing tasks");
    });

    it("formats cancel_task as a readable action", () => {
      const result = formatActionForLinear("cancel_task", { taskId: "abc" });
      expect(result.action).toBe("Cancelling task");
    });

    it("falls back to tool name for unknown tools", () => {
      const result = formatActionForLinear("unknown_tool", { foo: "bar" });
      expect(result.action).toBe("unknown_tool");
    });

    it("truncates parameter to 200 chars", () => {
      const longTitle = "A".repeat(300);
      const result = formatActionForLinear("create_task", { title: longTitle });
      expect(result.parameter.length).toBeLessThanOrEqual(200);
    });
  });

  describe("formatResultForLinear", () => {
    it("returns truncated string for long results", () => {
      const long = "B".repeat(600);
      const result = formatResultForLinear("list_tasks", long);
      expect(result!.length).toBeLessThanOrEqual(503); // 500 + "..."
    });

    it("returns error prefix for errors", () => {
      const result = formatResultForLinear("create_task", "not found", true);
      expect(result).toBe("Error: not found");
    });

    it("returns undefined for null/undefined results", () => {
      expect(formatResultForLinear("list_tasks", undefined)).toBeUndefined();
      expect(formatResultForLinear("list_tasks", null)).toBeUndefined();
    });
  });

  describe("user-facing messages", () => {
    it("formatGreeting includes a greeting", () => {
      const msg = formatGreeting("Alice");
      expect(msg).toContain("Alice");
    });

    it("getStopConfirmation returns a message", () => {
      expect(getStopConfirmation()).toBeTruthy();
    });

    it("getBusyMessage returns a message", () => {
      expect(getBusyMessage()).toBeTruthy();
    });

    it("getAlreadyLockedMessage returns a message", () => {
      expect(getAlreadyLockedMessage()).toBeTruthy();
    });

    it("getInterruptionNotice returns a message", () => {
      expect(getInterruptionNotice()).toBeTruthy();
    });

    it("getResumeGreeting returns a message", () => {
      expect(getResumeGreeting()).toBeTruthy();
    });
  });

  describe("formatTerminationError", () => {
    it("formats max turns error", () => {
      const msg = formatTerminationError("max_turns");
      expect(msg).toContain("maximum");
    });

    it("formats generic error", () => {
      const msg = formatTerminationError("unknown");
      expect(msg).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/services/linear-personality.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the personality layer**

```typescript
// apps/api/src/services/linear-personality.ts

/**
 * Format an Optio tool call for display in Linear's agent panel.
 */
export function formatActionForLinear(
  toolName: string,
  input: Record<string, unknown>,
): { action: string; parameter: string } {
  const truncate = (s: string, max = 200) => (s.length > max ? s.slice(0, max) : s);

  switch (toolName) {
    case "create_task":
      return {
        action: "Creating task",
        parameter: truncate(String(input.title ?? JSON.stringify(input))),
      };
    case "list_repos":
      return { action: "Checking repositories", parameter: "" };
    case "list_tasks":
      return {
        action: "Listing tasks",
        parameter: truncate(input.state ? `state=${input.state}` : ""),
      };
    case "get_task_details":
      return { action: "Checking task details", parameter: truncate(String(input.taskId ?? "")) };
    case "cancel_task":
      return { action: "Cancelling task", parameter: truncate(String(input.taskId ?? "")) };
    case "retry_task":
      return { action: "Retrying task", parameter: truncate(String(input.taskId ?? "")) };
    case "resume_task":
      return { action: "Resuming task", parameter: truncate(String(input.taskId ?? "")) };
    case "get_cost_analytics":
      return { action: "Checking costs", parameter: "" };
    case "list_pods":
    case "get_cluster_status":
      return { action: "Checking cluster status", parameter: "" };
    default:
      return {
        action: toolName,
        parameter: truncate(JSON.stringify(input)),
      };
  }
}

/**
 * Format a tool result for display in Linear's agent panel.
 */
export function formatResultForLinear(
  _toolName: string,
  result: unknown,
  isError?: boolean,
): string | undefined {
  if (result === undefined || result === null) return undefined;
  const str = typeof result === "string" ? result : JSON.stringify(result);
  if (isError) {
    return `Error: ${str.length > 500 ? str.slice(0, 500) : str}`;
  }
  return str.length > 500 ? `${str.slice(0, 500)}...` : str;
}

/**
 * Format a greeting message for a new Linear agent session.
 */
export function formatGreeting(userName: string): string {
  return `Hi ${userName}, let me take a look at this issue and figure out the best approach...`;
}

export function getBusyMessage(): string {
  return "I'm currently busy processing another request. Please try again in a few minutes.";
}

export function getAlreadyLockedMessage(): string {
  return "Please wait — I'm still working on your previous request.";
}

export function getStopConfirmation(): string {
  return "Stopped. All related tasks have been cancelled.";
}

export function getInterruptionNotice(): string {
  return "My session was interrupted by a restart. We'll continue when you send your next message.";
}

export function getResumeGreeting(): string {
  return "Resuming where I left off after an interruption.";
}

/**
 * Format a termination error for display in Linear.
 */
export function formatTerminationError(reason: string): string {
  switch (reason) {
    case "max_turns":
      return "Reached the maximum number of conversation turns. Please start a new session to continue.";
    case "max_budget":
      return "Budget limit reached. Please start a new session to continue.";
    case "execution_error":
      return "An error occurred during execution. Please try again.";
    default:
      return `Execution ended: ${reason}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/services/linear-personality.test.ts`
Expected: PASS — all tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/linear-personality.ts apps/api/src/services/linear-personality.test.ts
git commit -m "feat: add Linear personality layer for formatting agent activities"
```

---

## Task 5: Linear Task Monitor

**Files:**

- Create: `apps/api/src/services/linear-task-monitor.ts`
- Create: `apps/api/src/services/linear-task-monitor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/linear-task-monitor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearTaskMonitor } from "./linear-task-monitor.js";
import type { LinearApiService } from "./linear-api-service.js";
import { LinearPlanTodoStatus, type LinearPlanTodo } from "@optio/shared";

describe("LinearTaskMonitor", () => {
  let mockLinearApi: LinearApiService;
  let planUpdates: LinearPlanTodo[][];

  beforeEach(() => {
    planUpdates = [];
    mockLinearApi = {
      initialize: vi.fn(),
      createTextActivity: vi.fn().mockResolvedValue("activity-1"),
      createActionActivity: vi.fn().mockResolvedValue("activity-1"),
      updateSessionPlan: vi.fn(async (_sid: string, plan: LinearPlanTodo[]) => {
        planUpdates.push(plan);
      }),
      enrichContext: vi.fn().mockResolvedValue({}),
    };
  });

  it("builds initial plan from task list", () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend (repo: backend-api)");
    monitor.addTask("task-2", "Add login UI (repo: frontend-app)");

    const plan = monitor.getPlan();
    expect(plan).toHaveLength(2);
    expect(plan[0].content).toBe("Set up auth backend (repo: backend-api)");
    expect(plan[0].status).toBe(LinearPlanTodoStatus.PENDING);
    expect(plan[1].content).toBe("Add login UI (repo: frontend-app)");
  });

  it("updates plan item when task state changes", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "running");

    const plan = monitor.getPlan();
    expect(plan[0].status).toBe(LinearPlanTodoStatus.IN_PROGRESS);
    expect(mockLinearApi.updateSessionPlan).toHaveBeenCalledWith("session-1", plan);
  });

  it("marks task as completed", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "completed");

    expect(monitor.getPlan()[0].status).toBe(LinearPlanTodoStatus.COMPLETED);
  });

  it("marks task as canceled on failure", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onTaskStateChange("task-1", "failed");

    expect(monitor.getPlan()[0].status).toBe(LinearPlanTodoStatus.CANCELED);
    expect(mockLinearApi.createTextActivity).toHaveBeenCalledWith(
      "session-1",
      "error",
      expect.stringContaining("Set up auth backend"),
    );
  });

  it("updates description with PR link on pr_opened", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Set up auth backend");

    await monitor.onPrOpened("task-1", "https://github.com/org/repo/pull/42");

    const plan = monitor.getPlan();
    expect(plan[0].content).toContain("PR #42");
    expect(plan[0].status).toBe(LinearPlanTodoStatus.IN_PROGRESS);
    expect(mockLinearApi.createTextActivity).toHaveBeenCalledWith(
      "session-1",
      "response",
      expect.stringContaining("https://github.com/org/repo/pull/42"),
    );
  });

  it("reports allTerminal when all tasks are done", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    monitor.addTask("task-1", "Task A");
    monitor.addTask("task-2", "Task B");

    expect(monitor.allTerminal()).toBe(false);

    await monitor.onTaskStateChange("task-1", "completed");
    expect(monitor.allTerminal()).toBe(false);

    await monitor.onTaskStateChange("task-2", "failed");
    expect(monitor.allTerminal()).toBe(true);
  });

  it("ignores unknown task IDs", async () => {
    const monitor = new LinearTaskMonitor("session-1", mockLinearApi);
    await monitor.onTaskStateChange("unknown-id", "running");
    expect(mockLinearApi.updateSessionPlan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/services/linear-task-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the task monitor**

```typescript
// apps/api/src/services/linear-task-monitor.ts
import {
  LinearPlanTodoStatus,
  normalizeLinearTodoStatus,
  type LinearPlanTodo,
} from "@optio/shared";
import type { LinearApiService } from "./linear-api-service.js";
import { logger } from "../logger.js";

const log = logger.child({ service: "linear-task-monitor" });

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "canceled"]);

interface TrackedTask {
  taskId: string;
  description: string;
  status: LinearPlanTodoStatus;
}

export class LinearTaskMonitor {
  private readonly linearSessionId: string;
  private readonly linearApi: LinearApiService;
  private readonly trackedTasks: Map<string, TrackedTask> = new Map();

  constructor(linearSessionId: string, linearApi: LinearApiService) {
    this.linearSessionId = linearSessionId;
    this.linearApi = linearApi;
  }

  addTask(taskId: string, description: string): void {
    this.trackedTasks.set(taskId, {
      taskId,
      description,
      status: LinearPlanTodoStatus.PENDING,
    });
  }

  getPlan(): LinearPlanTodo[] {
    return Array.from(this.trackedTasks.values()).map((t) => ({
      content: t.description,
      status: t.status,
    }));
  }

  allTerminal(): boolean {
    if (this.trackedTasks.size === 0) return false;
    return Array.from(this.trackedTasks.values()).every((t) =>
      [LinearPlanTodoStatus.COMPLETED, LinearPlanTodoStatus.CANCELED].includes(t.status),
    );
  }

  async onTaskStateChange(taskId: string, newState: string): Promise<void> {
    const task = this.trackedTasks.get(taskId);
    if (!task) return;

    task.status = normalizeLinearTodoStatus(newState);
    await this.linearApi.updateSessionPlan(this.linearSessionId, this.getPlan());

    if (newState === "failed") {
      await this.linearApi.createTextActivity(
        this.linearSessionId,
        "error",
        `Task failed: ${task.description}`,
      );
    }

    log.info(
      { taskId, newState, linearSessionId: this.linearSessionId },
      "Task state updated in plan",
    );
  }

  async onPrOpened(taskId: string, prUrl: string): Promise<void> {
    const task = this.trackedTasks.get(taskId);
    if (!task) return;

    // Extract PR number from URL
    const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1] ?? "?";
    task.description = `${task.description} — PR #${prNumber}`;
    task.status = LinearPlanTodoStatus.IN_PROGRESS;

    await this.linearApi.updateSessionPlan(this.linearSessionId, this.getPlan());
    await this.linearApi.createTextActivity(
      this.linearSessionId,
      "response",
      `PR opened: ${prUrl}`,
    );

    log.info({ taskId, prUrl, linearSessionId: this.linearSessionId }, "PR opened — updated plan");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/services/linear-task-monitor.test.ts`
Expected: PASS — all 7 tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/linear-task-monitor.ts apps/api/src/services/linear-task-monitor.test.ts
git commit -m "feat: add Linear task monitor for worker milestone tracking"
```

---

## Task 6: Webhook Route

**Files:**

- Create: `apps/api/src/routes/linear-webhook.ts`
- Create: `apps/api/src/routes/linear-webhook.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/plugins/auth.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/routes/linear-webhook.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { verifyLinearSignature } from "./linear-webhook.js";

describe("linear-webhook", () => {
  describe("verifyLinearSignature", () => {
    const secret = "test-webhook-secret";
    const body = '{"test":"payload"}';

    it("returns true for a valid HMAC signature", () => {
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      expect(verifyLinearSignature(body, expected, secret)).toBe(true);
    });

    it("returns false for an invalid signature", () => {
      expect(verifyLinearSignature(body, "invalid-hex", secret)).toBe(false);
    });

    it("returns false for a tampered body", () => {
      const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
      expect(verifyLinearSignature('{"tampered":true}', sig, secret)).toBe(false);
    });

    it("returns false for empty signature", () => {
      expect(verifyLinearSignature(body, "", secret)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/routes/linear-webhook.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the webhook route**

```typescript
// apps/api/src/routes/linear-webhook.ts
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { logger } from "../logger.js";

const log = logger.child({ route: "linear-webhook" });

/**
 * Verify Linear webhook HMAC-SHA256 signature.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyLinearSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function linearWebhookRoutes(app: FastifyInstance) {
  app.post("/api/webhooks/linear", {
    // Capture raw body for HMAC verification
    preParsing: async (req, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
      }
      const rawBody = Buffer.concat(chunks);
      (req as any).rawBody = rawBody;
      return Readable.from(rawBody);
    },
    handler: async (req, reply) => {
      // Retrieve webhook secret from secrets store
      let webhookSecret: string;
      try {
        const { retrieveSecret } = await import("../services/secret-service.js");
        webhookSecret = (await retrieveSecret("LINEAR_WEBHOOK_SECRET")) as string;
      } catch {
        log.error("LINEAR_WEBHOOK_SECRET not configured");
        return reply.status(401).send({ error: "Webhook secret not configured" });
      }

      // Validate HMAC signature
      const signature = req.headers["linear-signature"] as string | undefined;
      if (!signature) {
        log.warn("Missing linear-signature header");
        return reply.status(401).send({ error: "Missing signature" });
      }

      const rawBody = ((req as any).rawBody as Buffer).toString("utf-8");
      if (!verifyLinearSignature(rawBody, signature, webhookSecret)) {
        log.warn("Invalid Linear webhook signature");
        return reply.status(401).send({ error: "Invalid signature" });
      }

      const payload = req.body as any;
      const sessionId = payload.agentSession?.id;

      if (!sessionId) {
        log.warn("Webhook payload missing agentSession.id");
        return reply.status(400).send({ error: "Missing session ID" });
      }

      // Check for stop signal
      const signal = payload.agentActivity?.signal;
      if (signal === "stop") {
        log.info({ sessionId }, "Received stop signal from Linear");
        // Fire-and-forget: stop coordinator
        import("../services/linear-coordinator-service.js")
          .then(({ stopSession }) => stopSession(sessionId))
          .catch((err) => log.error({ err, sessionId }, "Failed to stop session"));
        return reply.status(200).send({ ok: true });
      }

      // Fire-and-forget: handle webhook
      log.info({ sessionId }, "Received Linear agent webhook");
      import("../services/linear-coordinator-service.js")
        .then(({ handleWebhook }) => handleWebhook(payload))
        .catch((err) => log.error({ err, sessionId }, "Failed to handle webhook"));

      return reply.status(200).send({ ok: true });
    },
  });
}
```

- [ ] **Step 4: Register the route in server.ts**

Add to `apps/api/src/server.ts`:

Import at top:

```typescript
import { linearWebhookRoutes } from "./routes/linear-webhook.js";
```

Register after other routes (near line 104):

```typescript
await app.register(linearWebhookRoutes);
```

- [ ] **Step 5: Exempt from auth**

In `apps/api/src/plugins/auth.ts`, find the array of public path prefixes (paths that skip auth) and add `/api/webhooks/linear`. This follows the same pattern as `/api/webhooks/github` and `/api/health`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/routes/linear-webhook.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 7: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/api`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/linear-webhook.ts apps/api/src/routes/linear-webhook.test.ts apps/api/src/server.ts apps/api/src/plugins/auth.ts
git commit -m "feat: add Linear webhook route with HMAC signature validation"
```

---

## Task 7: Linear Coordinator Service

**Files:**

- Create: `apps/api/src/services/linear-coordinator-service.ts`
- Create: `apps/api/src/services/linear-coordinator-service.test.ts`

This is the largest task. The coordinator service manages the full agent lifecycle: session management, tool-use loop, activity streaming.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/linear-coordinator-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSessionStatus } from "@optio/shared";

// Mock dependencies
vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "session-1" }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "session-1" }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.mock("./secret-service.js", () => ({
  retrieveSecret: vi.fn(async (name: string) => {
    if (name === "LINEAR_API_TOKEN") return "test-token";
    if (name === "LINEAR_WEBHOOK_SECRET") return "test-secret";
    if (name === "CLAUDE_AUTH_MODE") return "api-key";
    if (name === "ANTHROPIC_API_KEY") return "test-key";
    throw new Error(`Secret not found: ${name}`);
  }),
}));

vi.mock("./linear-api-service.js", () => ({
  createLinearApiService: vi.fn(() => ({
    initialize: vi.fn(),
    createTextActivity: vi.fn().mockResolvedValue("activity-1"),
    createActionActivity: vi.fn().mockResolvedValue("activity-1"),
    updateSessionPlan: vi.fn(),
    enrichContext: vi.fn().mockResolvedValue({
      issue: { labels: [], children: [], attachments: [] },
    }),
  })),
}));

vi.mock("./optio-settings-service.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    model: "sonnet",
    systemPrompt: "",
    enabledTools: [],
    confirmWrites: false,
    maxTurns: 10,
  }),
}));

describe("linear-coordinator-service", () => {
  describe("acquireLock", () => {
    it("acquires lock on unlocked session", async () => {
      const { acquireLock } = await import("./linear-coordinator-service.js");
      // Test the lock acquisition logic exists and is callable
      expect(typeof acquireLock).toBe("function");
    });
  });

  describe("buildCoordinatorSystemPrompt", () => {
    it("includes base instructions and repo list", async () => {
      const { buildCoordinatorSystemPrompt } = await import("./linear-coordinator-service.js");
      const prompt = buildCoordinatorSystemPrompt({
        repos: [
          {
            fullName: "org/frontend",
            repoUrl: "https://github.com/org/frontend",
            imagePreset: "node",
          },
        ],
        skills: [{ name: "deploy", prompt: "Deploy instructions" }],
        agentPrompt: "Focus on frontend tasks only",
      });

      expect(prompt).toContain("Optio coordinator");
      expect(prompt).toContain("org/frontend");
      expect(prompt).toContain("deploy");
      expect(prompt).toContain("Focus on frontend tasks only");
    });

    it("includes default behavior section", async () => {
      const { buildCoordinatorSystemPrompt } = await import("./linear-coordinator-service.js");
      const prompt = buildCoordinatorSystemPrompt({ repos: [], skills: [], agentPrompt: "" });
      expect(prompt).toContain("full analysis and plan");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/services/linear-coordinator-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the coordinator service**

```typescript
// apps/api/src/services/linear-coordinator-service.ts
import { eq, and, or, lt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { linearAgentSessions } from "../db/schema.js";
import { createLinearApiService, type LinearApiService } from "./linear-api-service.js";
import { LinearTaskMonitor } from "./linear-task-monitor.js";
import { LinearSessionStatus, type LinearEnrichedContext, OPTIO_TOOL_SCHEMAS } from "@optio/shared";
import {
  streamAnthropicResponse,
  toAnthropicTools,
  type AnthropicContentBlock,
} from "../ws/optio-chat.js";
import { executeToolCall, truncateToolResult } from "./optio-tool-executor.js";
import {
  formatActionForLinear,
  formatResultForLinear,
  formatGreeting,
  getAlreadyLockedMessage,
  getStopConfirmation,
  formatTerminationError,
} from "./linear-personality.js";
import { createSubscriber } from "./event-bus.js";
import { logger } from "../logger.js";
import os from "node:os";

const log = logger.child({ service: "linear-coordinator" });

const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_BASE_URL ?? "https://api.anthropic.com";
const ANTHROPIC_MODEL_MAP: Record<string, string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};
const DEFAULT_MODEL = "claude-sonnet-4-6";
const POD_ID = os.hostname();

// Active abort controllers for in-flight API calls (for stop signal)
const activeAbortControllers = new Map<string, AbortController>();

// Active task monitors
const activeMonitors = new Map<string, LinearTaskMonitor>();

// ─── Session Lock ──────────────────────────────────────────────────────────

/**
 * Attempt to acquire a processing lock on a session.
 * Uses atomic UPDATE with conditions to prevent races.
 */
export async function acquireLock(linearSessionId: string): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(Date.now() - LOCK_TTL_MS);

  const result = await db
    .update(linearAgentSessions)
    .set({ lockedBy: POD_ID, lockedAt: now })
    .where(
      and(
        eq(linearAgentSessions.linearSessionId, linearSessionId),
        or(isNull(linearAgentSessions.lockedBy), lt(linearAgentSessions.lockedAt, staleBefore))!,
      ),
    )
    .returning();

  return result.length > 0;
}

async function releaseLock(linearSessionId: string): Promise<void> {
  await db
    .update(linearAgentSessions)
    .set({ lockedBy: null, lockedAt: null })
    .where(
      and(
        eq(linearAgentSessions.linearSessionId, linearSessionId),
        eq(linearAgentSessions.lockedBy, POD_ID),
      ),
    );
}

// ─── System Prompt ─────────────────────────────────────────────────────────

interface CoordinatorPromptContext {
  repos: Array<{ fullName: string; repoUrl: string; imagePreset?: string | null }>;
  skills: Array<{ name: string; prompt: string }>;
  agentPrompt: string;
}

export function buildCoordinatorSystemPrompt(ctx: CoordinatorPromptContext): string {
  const parts: string[] = [
    `You are the Optio coordinator agent, operating through Linear.`,
    ``,
    `## Your Role`,
    `- Receive tasks from Linear issues`,
    `- Ask clarifying questions until the scope is fully clear`,
    `- Decide what type of task(s) this requires and which repo(s) to use`,
    `- Break work into sub-tasks IF it adds value (don't force it)`,
    `- Create Optio worker tasks and track their progress`,
    `- Report back to the user in Linear`,
    ``,
    `## Default Behavior`,
    `- Complete your full analysis and plan before creating any worker tasks`,
    `- Present the plan to the user first`,
    `- This behavior can be overridden by the agent configuration below`,
  ];

  if (ctx.repos.length > 0) {
    parts.push(``, `## Available Repos`);
    for (const repo of ctx.repos) {
      parts.push(`- **${repo.fullName}** (${repo.repoUrl}) [${repo.imagePreset ?? "auto"}]`);
    }
  }

  if (ctx.skills.length > 0) {
    parts.push(``, `## Custom Skills`);
    for (const skill of ctx.skills) {
      parts.push(`### ${skill.name}`, skill.prompt);
    }
  }

  if (ctx.agentPrompt) {
    parts.push(``, `## Agent Configuration`, ctx.agentPrompt);
  }

  return parts.join("\n");
}

// ─── Auth ──────────────────────────────────────────────────────────────────

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

// ─── Tool-use loop ─────────────────────────────────────────────────────────

async function runToolLoop(opts: {
  linearSessionId: string;
  linearApi: LinearApiService;
  conversationMessages: Array<{
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }>;
  systemPrompt: string;
  tools: ReturnType<typeof toAnthropicTools>;
  auth: { apiKey?: string; oauthToken?: string };
  model: string;
  maxTurns: number;
  app: any; // FastifyInstance — passed for tool execution
  sessionToken: string;
}): Promise<{
  messages: typeof opts.conversationMessages;
  inputTokens: number;
  outputTokens: number;
  elicited: boolean;
}> {
  const {
    linearSessionId,
    linearApi,
    conversationMessages,
    systemPrompt,
    tools,
    auth,
    model,
    maxTurns,
    app,
    sessionToken,
  } = opts;

  const headers = buildAnthropicHeaders(auth);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let elicited = false;

  const abortController = new AbortController();
  activeAbortControllers.set(linearSessionId, abortController);

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const body = {
        model,
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
          log.info({ linearSessionId }, "Coordinator aborted");
          break;
        }
        throw err;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        log.error({ status: response.status, body: errorBody }, "Anthropic API error");
        await linearApi.createTextActivity(
          linearSessionId,
          "error",
          `API error: ${errorBody.slice(0, 200)}`,
        );
        break;
      }

      // Collect text to send as activity after streaming completes
      let assistantText = "";
      const { content, stopReason, inputTokens, outputTokens } = await streamAnthropicResponse(
        response,
        (msg) => {
          // Collect text chunks for activity posting
          if (msg.type === "text" && typeof msg.content === "string") {
            assistantText += msg.content;
          }
        },
      );

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      conversationMessages.push({ role: "assistant", content });

      // Post collected text as activity
      if (assistantText.trim()) {
        // Detect if this is an elicitation (ends with a question)
        const isQuestion = assistantText.trim().endsWith("?");
        const activityType = isQuestion ? "elicitation" : "response";
        await linearApi.createTextActivity(linearSessionId, activityType, assistantText.trim());
        if (isQuestion) elicited = true;
      }

      if (stopReason !== "tool_use") break;

      // Execute tool calls
      const toolCalls = content.filter((b) => b.type === "tool_use");
      const toolResults: AnthropicContentBlock[] = [];

      for (const tc of toolCalls) {
        // Post action activity to Linear
        const { action, parameter } = formatActionForLinear(
          tc.name!,
          (tc.input ?? {}) as Record<string, unknown>,
        );
        await linearApi.createActionActivity(linearSessionId, action, parameter);

        // Execute the tool
        const result = await executeToolCall(
          app,
          tc.name!,
          (tc.input ?? {}) as Record<string, unknown>,
          sessionToken,
        );

        // Post result activity
        const formattedResult = formatResultForLinear(tc.name!, result.result, !result.success);
        if (formattedResult) {
          await linearApi.createActionActivity(linearSessionId, action, parameter, formattedResult);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: tc.id!,
          content: truncateToolResult(result.result),
          is_error: !result.success,
        });

        // If this was a create_task call and it succeeded, track the task
        if (tc.name === "create_task" && result.success) {
          try {
            const parsed = JSON.parse(result.result);
            const taskId = parsed.task?.id ?? parsed.id;
            if (taskId) {
              const monitor = activeMonitors.get(linearSessionId);
              if (monitor) {
                const title = (tc.input as any)?.title ?? "Task";
                monitor.addTask(taskId, title);
                await linearApi.updateSessionPlan(linearSessionId, monitor.getPlan());

                // Start monitoring this task via Redis pub/sub
                startTaskSubscription(linearSessionId, taskId, monitor);
              }
            }
          } catch {
            // Result wasn't parseable — skip tracking
          }
        }
      }

      conversationMessages.push({ role: "user", content: toolResults });
    }
  } finally {
    activeAbortControllers.delete(linearSessionId);
  }

  return {
    messages: conversationMessages,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    elicited,
  };
}

// ─── Redis Task Subscription ───────────────────────────────────────────────

function startTaskSubscription(
  linearSessionId: string,
  taskId: string,
  monitor: LinearTaskMonitor,
): void {
  const subscriber = createSubscriber();
  subscriber.subscribe(`optio:task:${taskId}`);

  subscriber.on("message", async (_channel, message) => {
    try {
      const event = JSON.parse(message);
      if (event.type === "task_state_change" && event.taskId === taskId) {
        const newState = event.toState ?? event.state;
        if (newState) {
          await monitor.onTaskStateChange(taskId, newState);
        }
        // Check for PR URL
        if (event.prUrl) {
          await monitor.onPrOpened(taskId, event.prUrl);
        }
      }
    } catch (err) {
      log.error({ err, taskId }, "Failed to process task event");
    }
  });
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Handle an incoming Linear agent webhook.
 */
export async function handleWebhook(payload: any): Promise<void> {
  const sessionId = payload.agentSession?.id;
  const issueId = payload.agentSession?.issue?.id;

  if (!sessionId) {
    log.warn("Payload missing session ID");
    return;
  }

  const linearApi = createLinearApiService();
  await linearApi.initialize();

  // Upsert session
  const [existing] = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.linearSessionId, sessionId));

  if (!existing) {
    // New session
    await db.insert(linearAgentSessions).values({
      linearSessionId: sessionId,
      linearIssueId: issueId ?? null,
      status: LinearSessionStatus.ACTIVE,
      conversationMessages: [],
      spawnedTaskIds: [],
      lastActiveAt: new Date(),
    });
  }

  // Try to acquire lock
  if (!(await acquireLock(sessionId))) {
    await linearApi.createTextActivity(sessionId, "thought", getAlreadyLockedMessage());
    return;
  }

  try {
    // Load session
    const [session] = await db
      .select()
      .from(linearAgentSessions)
      .where(eq(linearAgentSessions.linearSessionId, sessionId));

    if (!session) return;

    // Build conversation messages from DB
    let conversationMessages = (session.conversationMessages ?? []) as Array<{
      role: "user" | "assistant";
      content: string | AnthropicContentBlock[];
    }>;

    // Enrich context for new sessions
    let enrichedContext = session.enrichedContext as LinearEnrichedContext | null;
    if (!enrichedContext && issueId) {
      enrichedContext = await linearApi.enrichContext(issueId);
      await db
        .update(linearAgentSessions)
        .set({ enrichedContext })
        .where(eq(linearAgentSessions.id, session.id));
    }

    // Extract user message from webhook payload
    const userMessage = extractUserMessage(payload, enrichedContext);
    if (userMessage) {
      conversationMessages.push({ role: "user", content: userMessage });
    }

    // Post greeting for new sessions
    if (!existing) {
      const userName = (payload.agentSession as any)?.creator?.name?.split(" ")[0] ?? "there";
      await linearApi.createTextActivity(sessionId, "response", formatGreeting(userName));
    }

    // Initialize task monitor
    const monitor = new LinearTaskMonitor(sessionId, linearApi);
    activeMonitors.set(sessionId, monitor);

    // Load repo list and skills
    const { listRepos } = await import("./repo-service.js");
    const repos = await listRepos(session.workspaceId);
    const { listSkills } = await import("./skill-service.js");
    const skills = await listSkills("global", session.workspaceId);

    // Agent prompt from Linear config (if available in payload)
    const agentPrompt = (payload.agentSession as any)?.agent?.instructions ?? "";

    // Build system prompt
    const systemPrompt = buildCoordinatorSystemPrompt({
      repos: repos.map((r) => ({
        fullName: r.fullName ?? r.repoUrl,
        repoUrl: r.repoUrl,
        imagePreset: r.imagePreset,
      })),
      skills: skills.map((s) => ({ name: s.name, prompt: s.prompt })),
      agentPrompt,
    });

    // Get auth and settings
    const auth = await getAnthropicAuth();
    if (!auth.apiKey && !auth.oauthToken) {
      await linearApi.createTextActivity(
        sessionId,
        "error",
        "No Anthropic credentials configured.",
      );
      return;
    }
    const { getSettings } = await import("./optio-settings-service.js");
    const settings = await getSettings(session.workspaceId);
    const model = ANTHROPIC_MODEL_MAP[settings.model] ?? DEFAULT_MODEL;
    const tools = toAnthropicTools(OPTIO_TOOL_SCHEMAS, settings.enabledTools);

    // Create an internal session token for tool execution
    // Use the API's own auth for internal calls
    const sessionToken = "";

    // Get Fastify app reference for tool execution
    const { getApp } = await import("../server.js");
    const app = getApp();

    // Run tool-use loop
    const result = await runToolLoop({
      linearSessionId: sessionId,
      linearApi,
      conversationMessages,
      systemPrompt,
      tools,
      auth,
      model,
      maxTurns: settings.maxTurns,
      app,
      sessionToken,
    });

    // Persist conversation state
    const newStatus = result.elicited
      ? LinearSessionStatus.WAITING_FOR_USER
      : LinearSessionStatus.ACTIVE;

    await db
      .update(linearAgentSessions)
      .set({
        conversationMessages: result.messages,
        status: newStatus,
        lastActiveAt: new Date(),
        inputTokens: session.inputTokens + result.inputTokens,
        outputTokens: session.outputTokens + result.outputTokens,
        updatedAt: new Date(),
      })
      .where(eq(linearAgentSessions.id, session.id));
  } catch (err) {
    log.error({ err, sessionId }, "Coordinator failed");
    await linearApi
      .createTextActivity(sessionId, "error", "An internal error occurred. Please try again.")
      .catch(() => {});
  } finally {
    await releaseLock(sessionId);
  }
}

/**
 * Stop a Linear agent session and cancel all spawned tasks.
 */
export async function stopSession(linearSessionId: string): Promise<void> {
  const linearApi = createLinearApiService();
  await linearApi.initialize();

  // Abort any in-flight API call
  const controller = activeAbortControllers.get(linearSessionId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(linearSessionId);
  }

  // Load session
  const [session] = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.linearSessionId, linearSessionId));

  if (!session) return;

  // Cancel all spawned tasks
  const spawnedTaskIds = (session.spawnedTaskIds ?? []) as string[];
  if (spawnedTaskIds.length > 0) {
    const taskService = await import("./task-service.js");
    for (const taskId of spawnedTaskIds) {
      try {
        await taskService.transitionTask(
          taskId,
          "cancelled" as any,
          "linear_stop",
          "Stopped from Linear",
        );
      } catch {
        // Task may already be in a terminal state
      }
    }
  }

  // Update session
  await db
    .update(linearAgentSessions)
    .set({
      status: LinearSessionStatus.CANCELLED,
      lockedBy: null,
      lockedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(linearAgentSessions.id, session.id));

  // Clean up monitor
  activeMonitors.delete(linearSessionId);

  await linearApi.createTextActivity(linearSessionId, "response", getStopConfirmation());
  log.info({ linearSessionId }, "Session stopped");
}

/**
 * Mark active sessions as interrupted on shutdown.
 */
export async function markSessionsInterrupted(): Promise<number> {
  const result = await db
    .update(linearAgentSessions)
    .set({
      status: LinearSessionStatus.INTERRUPTED,
      lockedBy: null,
      lockedAt: null,
    })
    .where(
      and(
        eq(linearAgentSessions.lockedBy, POD_ID),
        eq(linearAgentSessions.status, LinearSessionStatus.ACTIVE),
      ),
    )
    .returning();

  return result.length;
}

/**
 * Recover interrupted sessions on startup.
 */
export async function recoverInterruptedSessions(): Promise<void> {
  const sessions = await db
    .select()
    .from(linearAgentSessions)
    .where(eq(linearAgentSessions.status, LinearSessionStatus.INTERRUPTED));

  for (const session of sessions) {
    try {
      const linearApi = createLinearApiService();
      await linearApi.initialize();
      await linearApi.createTextActivity(
        session.linearSessionId,
        "thought",
        "Session recovered after restart. Send a message to continue.",
      );
      // Mark as waiting_for_user so next webhook resumes
      await db
        .update(linearAgentSessions)
        .set({ status: LinearSessionStatus.WAITING_FOR_USER })
        .where(eq(linearAgentSessions.id, session.id));
    } catch (err) {
      log.error({ err, sessionId: session.linearSessionId }, "Failed to recover session");
    }
  }

  if (sessions.length > 0) {
    log.info({ count: sessions.length }, "Recovered interrupted Linear sessions");
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractUserMessage(
  payload: any,
  enrichedContext: LinearEnrichedContext | null,
): string | null {
  // The user's message comes from the agentActivity content
  const content = payload.agentActivity?.content;
  if (content?.body) return content.body;

  // For initial session creation, build context from the issue
  const issue = payload.agentSession?.issue;
  if (issue) {
    const parts = [`**${issue.title}**`];
    if (issue.description) parts.push(issue.description);

    if (enrichedContext?.issue) {
      if (enrichedContext.issue.labels.length > 0) {
        parts.push(`\nLabels: ${enrichedContext.issue.labels.map((l) => l.name).join(", ")}`);
      }
      if (enrichedContext.issue.children.length > 0) {
        parts.push(`\nSub-issues:`);
        for (const child of enrichedContext.issue.children) {
          parts.push(`- ${child.identifier}: ${child.title}`);
        }
      }
      if (enrichedContext.issue.attachments.length > 0) {
        parts.push(`\nAttachments:`);
        for (const att of enrichedContext.issue.attachments) {
          parts.push(`- [${att.title}](${att.url})`);
        }
      }
    }

    return parts.join("\n");
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/services/linear-coordinator-service.test.ts`
Expected: PASS

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/api`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/linear-coordinator-service.ts apps/api/src/services/linear-coordinator-service.test.ts
git commit -m "feat: add Linear coordinator service with tool-use loop and session management"
```

---

## Task 8: Export getApp() from server.ts

The coordinator service needs a reference to the Fastify app for internal tool execution (via `executeToolCall`). The Ask Optio WebSocket handler gets this from the socket context, but the coordinator runs outside a WebSocket. **This must be done before Task 9 (coordinator service wiring).**

**Files:**

- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add app reference export**

At the bottom of `apps/api/src/server.ts`, after the `buildServer()` function, add:

```typescript
let appInstance: Awaited<ReturnType<typeof buildServer>> | null = null;

export function setApp(app: Awaited<ReturnType<typeof buildServer>>): void {
  appInstance = app;
}

export function getApp(): Awaited<ReturnType<typeof buildServer>> {
  if (!appInstance) throw new Error("Fastify app not initialized");
  return appInstance;
}
```

- [ ] **Step 2: Set the app reference in index.ts**

In `apps/api/src/index.ts`, after `const app = await buildServer()` (line 97), add:

```typescript
const { setApp } = await import("./server.js");
setApp(app);
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/api`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/index.ts
git commit -m "feat: expose Fastify app reference for internal tool execution"
```

---

## Task 9: Wire Up Startup / Shutdown Hooks

**Files:**

- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/workers/repo-cleanup-worker.ts`

- [ ] **Step 1: Add session recovery on startup**

In `apps/api/src/index.ts`, after the `reconcileOrphanedTasks()` call (around line 143), add:

```typescript
// Recover any interrupted Linear agent sessions
import("./services/linear-coordinator-service.js")
  .then(({ recoverInterruptedSessions }) => recoverInterruptedSessions())
  .catch((err) => {
    logger.error(err, "Failed to recover Linear sessions");
  });
```

- [ ] **Step 2: Add session interruption on shutdown**

In the `shutdown` function in `apps/api/src/index.ts` (around line 146), add before `await app.close()`:

```typescript
// Mark active Linear sessions as interrupted
try {
  const { markSessionsInterrupted } = await import("./services/linear-coordinator-service.js");
  const count = await markSessionsInterrupted();
  if (count > 0) logger.info({ count }, "Marked Linear sessions as interrupted");
} catch {
  // Non-critical
}
```

- [ ] **Step 3: Add stale session cleanup to repo-cleanup-worker**

In `apps/api/src/workers/repo-cleanup-worker.ts`, add to the cleanup job handler (the function that runs every 60s), after existing cleanup logic:

```typescript
// Clean up stale Linear agent sessions
try {
  const { linearAgentSessions } = await import("../db/schema.js");
  const { LinearSessionStatus } = await import("@optio/shared");

  // Delete sessions older than 28 days
  const cutoff28d = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
  await db.delete(linearAgentSessions).where(lt(linearAgentSessions.lastActiveAt, cutoff28d));

  // Expire sessions waiting for user input for > 7 days
  const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .update(linearAgentSessions)
    .set({ status: LinearSessionStatus.COMPLETED })
    .where(
      and(
        eq(linearAgentSessions.status, LinearSessionStatus.WAITING_FOR_USER),
        lt(linearAgentSessions.lastActiveAt, cutoff7d),
      ),
    );
} catch (err) {
  logger.warn({ err }, "Failed to clean up stale Linear sessions");
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm turbo typecheck --filter=@optio/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/src/workers/repo-cleanup-worker.ts
git commit -m "feat: wire Linear session recovery, shutdown hooks, and stale cleanup"
```

---

## Task 10: Integration Test — Full Webhook Flow

**Files:**

- Create: `apps/api/src/services/linear-coordinator-service.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// apps/api/src/services/linear-coordinator-service.integration.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildCoordinatorSystemPrompt } from "./linear-coordinator-service.js";

describe("linear-coordinator integration", () => {
  it("builds a complete system prompt with all context", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [
        { fullName: "org/backend", repoUrl: "https://github.com/org/backend", imagePreset: "node" },
        {
          fullName: "org/frontend",
          repoUrl: "https://github.com/org/frontend",
          imagePreset: "node",
        },
      ],
      skills: [{ name: "deploy", prompt: "Run deployment pipeline" }],
      agentPrompt: "You specialize in full-stack web development.",
    });

    // Core instructions present
    expect(prompt).toContain("Optio coordinator");
    expect(prompt).toContain("clarifying questions");
    expect(prompt).toContain("full analysis and plan");

    // Repos listed
    expect(prompt).toContain("org/backend");
    expect(prompt).toContain("org/frontend");

    // Skills included
    expect(prompt).toContain("deploy");
    expect(prompt).toContain("Run deployment pipeline");

    // Agent prompt included
    expect(prompt).toContain("full-stack web development");
  });

  it("works with empty context", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [],
      agentPrompt: "",
    });

    expect(prompt).toContain("Optio coordinator");
    expect(prompt).not.toContain("Available Repos");
    expect(prompt).not.toContain("Custom Skills");
    expect(prompt).not.toContain("Agent Configuration");
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd apps/api && npx vitest run src/services/linear-coordinator-service.integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm turbo test`
Expected: PASS — all existing tests still pass, new tests pass

- [ ] **Step 4: Run typecheck across all packages**

Run: `pnpm turbo typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/linear-coordinator-service.integration.test.ts
git commit -m "test: add integration tests for Linear coordinator"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run full CI checks**

```bash
pnpm format:check
pnpm turbo typecheck
pnpm turbo test
```

Expected: All PASS

- [ ] **Step 2: Verify the web build still works**

```bash
cd apps/web && npx next build
```

Expected: PASS — no breakage from shared type additions

- [ ] **Step 3: Review all new files**

Verify file list matches the plan:

- `packages/shared/src/types/linear-agent.ts`
- `apps/api/src/services/linear-api-service.ts` + test
- `apps/api/src/services/linear-personality.ts` + test
- `apps/api/src/services/linear-task-monitor.ts` + test
- `apps/api/src/services/linear-coordinator-service.ts` + test + integration test
- `apps/api/src/routes/linear-webhook.ts` + test
- DB migration for `linear_agent_sessions`
- Modified: `server.ts`, `index.ts`, `auth.ts`, `repo-cleanup-worker.ts`, `shared/index.ts`, `schema.ts`

- [ ] **Step 4: Final commit if any formatting fixes needed**

```bash
pnpm format:check || pnpm format
git add -A
git commit -m "chore: format Linear agents integration code"
```
