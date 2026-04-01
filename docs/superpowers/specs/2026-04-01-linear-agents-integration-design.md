# Linear Agents Integration — Design Spec

## Overview

Full Linear Agents protocol integration for Optio. An AI coordinator agent receives webhooks from Linear, clarifies scope via conversation, decides which repo(s) to route work to, creates Optio worker tasks, and streams progress back to Linear's agent panel.

## Goals

- Start Optio tasks from the Linear interface via the native Agent panel
- Bidirectional communication: user converses with the coordinator in Linear
- Smart routing: coordinator uses AI to decide which repo(s) and task type(s)
- Task decomposition: break large issues into sub-tasks when it adds value
- Hierarchical plan/todo: coordinator steps + worker tasks visible as todos in Linear's agent panel
- Progress tracking: worker milestones streamed back to Linear as plan/todo updates
- Scope clarification: coordinator asks questions until scope is clear before acting
- Plan-first: coordinator completes the full plan before starting worker tasks (configurable via prompt)
- **Future:** Agent team communication (workers asking coordinator or each other for clarification) — deferred to a follow-up project

## Architecture

### Approach: Monolithic Coordinator Service (in-process)

The coordinator runs inside the API server using the same Anthropic Messages API + tool-use loop pattern as Ask Optio. No separate pod or worker queue — it's a lightweight reasoning + orchestration agent.

```
Linear UI
  |
  +-- User creates/messages agent session
  |
  v
POST /api/webhooks/linear
  |  (HMAC validation, fire-and-forget)
  |
  v
LinearCoordinatorService.handleWebhook()
  |
  +-- Stop signal? -> cancel coordinator + worker tasks -> done
  |
  +-- New session?
  |    +-- Enrich context (Linear SDK: labels, children, attachments)
  |    +-- Load repo list, skills, MCP tools
  |    +-- Initialize conversation in DB
  |    +-- Post greeting to Linear
  |
  +-- Existing session?
  |    +-- Load conversation from DB, append user message
  |
  v
Tool-use loop (Ask Optio pattern)
  |
  +-- Clarify scope -> ELICITATION activity -> pause (waiting_for_user)
  |
  +-- Decide repos/decomposition -> update plan in Linear
  |
  +-- Create worker tasks -> create_task tool
  |    +-- LinearTaskMonitor subscribes to Redis pub/sub
  |
  +-- Stream to Linear:
  |    +-- Text -> RESPONSE activity
  |    +-- Tool calls -> ACTION activity
  |    +-- Thinking -> THOUGHT activity
  |
  v
LinearTaskMonitor
  |  (Redis pub/sub for each spawned task)
  |
  +-- Task started -> update plan todo: IN_PROGRESS
  +-- PR opened -> update plan todo + RESPONSE with PR link
  +-- Task completed -> update plan todo: COMPLETED
  +-- Task failed -> update plan todo: CANCELED + ERROR activity
```

### Why in-process?

- Reuses Ask Optio's proven tool-use loop and Anthropic streaming
- No pod startup latency — coordinator responds in seconds
- Direct access to internal services (task creation, repo list, skills, MCP)
- Follows the same pattern as backend-nest's Linear agents

## Webhook Reception & Routing

### Route: `POST /api/webhooks/linear`

- Receives `AgentSessionEventWebhookPayload` from Linear SDK
- Validates HMAC-SHA256 signature using `linear-signature` header against `LINEAR_WEBHOOK_SECRET` (from secrets store)
- Returns `200 OK` immediately, processes async (fire-and-forget)
- Routes by event type:
  - New session / user message -> `LinearCoordinatorService.handleWebhook(payload)`
  - Stop signal (`payload.agentActivity.signal === 'stop'`) -> `LinearCoordinatorService.stop(sessionId)`

### Configuration

Single global Optio agent registration in Linear. Secrets stored in the existing encrypted secrets table:

- `LINEAR_API_TOKEN` — for Linear SDK calls
- `LINEAR_WEBHOOK_SECRET` — for webhook signature validation

Configurable from the Optio web UI settings page (not env vars).

## Linear Coordinator Service

### `apps/api/src/services/linear-coordinator-service.ts`

Core service managing the full agent lifecycle.

### Session State

All state persisted to `linear_agent_sessions` table (DB is source of truth, not memory). In-memory map used only as a processing lock to prevent concurrent handling of the same session.

### `handleWebhook(payload)` flow

1. Extract `sessionId`, `issueId`, user message from payload
2. Check for stop signal -> cancel everything
3. Acquire lock (atomic, with 30-minute TTL)
4. If locked by another process -> post "already working" message to Linear
5. If new session:
   - Enrich context from Linear SDK (labels, children, attachments)
   - Load repo list, global skills, global MCP server tools
   - Read agent prompt from Linear webhook payload
   - Initialize conversation in DB
   - Post greeting to Linear
6. If existing session:
   - Load conversation history from DB
   - Append user message
7. Run tool-use loop (Ask Optio pattern):
   - System prompt: base coordinator instructions + Linear-configured prompt + repo list + skills
   - Tools: Optio built-in tools + MCP server tools
   - No write confirmation (user is in Linear, not Optio UI)
8. Stream activities to Linear:
   - Text responses -> RESPONSE activities
   - Tool calls -> ACTION activities (formatted by personality layer)
   - Clarifying questions -> ELICITATION activities (session pauses in `waiting_for_user`)
9. Persist conversation state to DB after each tool-use iteration
10. Release lock when done

### `stop(sessionId)` flow

1. Abort the active Anthropic API call
2. Query all tasks created by this session (`spawnedTaskIds`)
3. Cancel each worker task via `taskService.transitionTask()`
4. Post stop confirmation to Linear
5. Clean up session state, release lock

### Default Behavior (configurable via prompt)

The coordinator completes its full analysis and plan before creating any worker tasks. This is part of the base system prompt but can be overridden by the agent configuration prompt in Linear. Examples:

- Default: "Complete the full plan before starting any tasks"
- Aggressive: "Start tasks as soon as individual items are clear"
- Approval: "Present the plan and wait for user confirmation before starting"

## Database Schema

### New table: `linear_agent_sessions`

| Column                 | Type      | Description                                                                     |
| ---------------------- | --------- | ------------------------------------------------------------------------------- |
| `id`                   | uuid      | Primary key                                                                     |
| `linearSessionId`      | text      | Linear agent session ID (unique)                                                |
| `linearIssueId`        | text      | Linear issue ID                                                                 |
| `status`               | text      | `active`, `waiting_for_user`, `interrupted`, `failed`, `completed`, `cancelled` |
| `conversationMessages` | jsonb     | Full Anthropic messages array                                                   |
| `enrichedContext`      | jsonb     | Cached Linear issue data (labels, children, attachments)                        |
| `spawnedTaskIds`       | jsonb     | Array of Optio task IDs created by this session                                 |
| `lockedBy`             | text      | Pod/instance ID holding the processing lock                                     |
| `lockedAt`             | timestamp | When lock was acquired (30-min TTL)                                             |
| `lastActiveAt`         | timestamp | For stale session cleanup                                                       |
| `costUsd`              | text      | Accumulated coordinator cost                                                    |
| `inputTokens`          | integer   | Total input tokens                                                              |
| `outputTokens`         | integer   | Total output tokens                                                             |
| `workspaceId`          | uuid      | Workspace scope                                                                 |
| `createdAt`            | timestamp |                                                                                 |
| `updatedAt`            | timestamp |                                                                                 |

Indexes: unique on `linearSessionId`, index on `status`.

## Linear API Service

### `apps/api/src/services/linear-api-service.ts`

Thin wrapper around `@linear/sdk`. Follows backend-nest's `LinearApiService` pattern.

**Activity streaming:**

- `createTextActivity(sessionId, type, body, ephemeral?)` — post THOUGHT, RESPONSE, ELICITATION, or ERROR
- `createActionActivity(sessionId, action, parameter?, result?)` — post ACTION (tool calls)
- `updateSessionPlan(sessionId, plan)` — update todo/plan items in the Linear agent panel

**Context enrichment:**

- `enrichContext(issueId)` — fetch issue details, labels, children, attachments via SDK
- Returns structured context injected into coordinator's system prompt

**Initialization:**

- `LinearClient` created with `LINEAR_API_TOKEN` from secrets store
- Lazy-loaded and cached
- Clear error if token is missing/invalid

## Personality / Formatting Layer

### `apps/api/src/services/linear-personality.ts`

Default personality for the Optio coordinator. Exported as an interface for future customization.

**Action formatting:**

- `formatActionForLinear(toolName, input)` — maps Optio tool names to readable descriptions (e.g., `create_task` -> "Creating coding task", `list_repos` -> "Checking repositories")
- `formatResultForLinear(toolName, result, isError?)` — summarizes results, truncates to 500 chars
- `formatTerminationError(reason)` — human-readable error for budget/turns/crash

**User-facing messages:**

- `formatGreeting(payload)` — welcome message
- `getBusyMessage()` — when session is locked
- `getAlreadyLockedMessage()` — concurrent request
- `getStopConfirmation()` — after stop signal
- `getInterruptionNotice()` — after restart recovery
- `getResumeGreeting()` — resuming after interruption

## Hierarchical Plan / Todo in Linear

The coordinator maintains a hierarchical plan in Linear's agent panel that shows both coordinator steps and worker task progress:

```
[x] Analyze issue scope
[x] Identify affected repos and decompose into tasks
[ ] Set up auth backend (repo: backend-api)        -> in_progress, PR #42
[ ] Add login UI (repo: frontend-app)               -> pending
[ ] Configure 2FA (repo: backend-api)               -> pending
[ ] Verify all tasks complete and report summary
```

**How it works:**

1. Coordinator creates an initial plan via `updateSessionPlan()` with its own analysis steps
2. As it decides on worker tasks, it adds them to the plan as additional todos
3. When worker tasks are created, their plan items update based on task state
4. Coordinator's own steps (analyze, decompose, verify) are managed by the tool-use loop
5. The full plan is persisted in the session's `conversationMessages` so the coordinator can reason about it

## Task Monitoring & Worker Milestones

### `apps/api/src/services/linear-task-monitor.ts`

Subscribes to Redis pub/sub for spawned worker tasks and pushes milestone updates to Linear.

**On task state changes:**

| Task State                 | Linear Todo Status | Additional Action                              |
| -------------------------- | ------------------ | ---------------------------------------------- |
| `queued` / `pending`       | `PENDING`          |                                                |
| `provisioning` / `running` | `IN_PROGRESS`      |                                                |
| `pr_opened`                | `IN_PROGRESS`      | RESPONSE with PR link, update todo description |
| `completed`                | `COMPLETED`        |                                                |
| `failed`                   | `CANCELED`         | ERROR activity with classified error           |
| `cancelled`                | `CANCELED`         |                                                |

**Lifecycle:**

- Created per session when worker tasks are spawned
- Subscribes to Redis channels for each task ID
- Automatically unsubscribes when all tasks reach terminal state or session is stopped

## Coordinator System Prompt

```
You are the Optio coordinator agent, operating through Linear.

## Your Role
- Receive tasks from Linear issues
- Ask clarifying questions until the scope is fully clear
- Decide what type of task(s) this requires and which repo(s) to use
- Break work into sub-tasks IF it adds value (don't force it)
- Create Optio worker tasks and track their progress
- Report back to the user in Linear

## Default Behavior
- Complete your full analysis and plan before creating any worker tasks
- Present the plan to the user first
- This behavior can be overridden by the agent configuration below

## Available Repos
{{REPO_LIST}}

## Custom Skills
{{SKILLS}}

## Agent Configuration
{{LINEAR_AGENT_PROMPT}}
```

The `{{LINEAR_AGENT_PROMPT}}` is read from the Linear webhook payload. This allows each Linear agent registration to have different behavior without changing Optio code.

## Coordinator Tool Set

1. **Optio built-in tools** — same as Ask Optio: `create_task`, `list_repos`, `list_tasks`, `get_task_details`, `cancel_task`, `retry_task`, `resume_task`, etc.
2. **MCP server tools** — global MCP servers resolved at session start, loaded as Anthropic tools
3. **No write confirmation** — coordinator auto-executes since the user is in Linear, not the Optio UI

## Session Recovery & Cleanup

### On API server startup

1. Query `linear_agent_sessions` where `status = 'active'`
2. Mark as `interrupted`
3. Post THOUGHT to Linear: "Session recovered after restart"
4. Sessions resume on next user message (webhook loads conversation from DB)

### On graceful shutdown (SIGTERM/SIGINT)

1. Mark all sessions locked by this instance as `interrupted`
2. Abort active Anthropic API calls
3. Cancel task monitoring subscriptions

### Stale session cleanup (in repo-cleanup-worker)

- Sessions with `lastActiveAt` older than 28 days -> delete
- Sessions in `waiting_for_user` longer than 7 days -> mark `completed`, post expiry message to Linear

### Lock TTL

- 30 minutes
- If coordinator crashes without releasing lock, next webhook can acquire after TTL

## Settings UI

New section on the settings/config page: "Linear Agents"

- API token field (masked input)
- Webhook secret field (masked input)
- Webhook URL display: `{PUBLIC_URL}/api/webhooks/linear` (copy button)
- Connection test button (validates token via Linear SDK)
- Status indicator: connected/disconnected

## New Files

- `apps/api/src/routes/linear-webhook.ts` — webhook route with HMAC validation
- `apps/api/src/services/linear-coordinator-service.ts` — core orchestration service
- `apps/api/src/services/linear-api-service.ts` — Linear SDK wrapper
- `apps/api/src/services/linear-personality.ts` — formatting for Linear UI
- `apps/api/src/services/linear-task-monitor.ts` — Redis pub/sub worker milestone tracking
- DB migration for `linear_agent_sessions` table
- Shared types for Linear agent sessions

## Modified Files

- `apps/api/src/index.ts` — register webhook route, startup recovery, shutdown hooks
- `apps/api/src/workers/repo-cleanup-worker.ts` — stale session cleanup
- `packages/shared/src/types/` — new Linear agent types
- `apps/web/` — settings page Linear configuration section

## Future Work (deferred)

- **Agent team communication** — MCP server in worker pods for inter-agent messaging, coordinator as message broker, Claude Agent SDK for mid-turn message injection
- **Linear session views in Optio** — dedicated pages showing session timeline and cross-task communication
- **Task comment source tagging** — metadata on comments to distinguish coordinator/worker/system messages
