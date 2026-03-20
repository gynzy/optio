# CLAUDE.md

Project conventions and context for AI assistants working on this codebase.

## Project Overview

Optio is an AI agent workflow orchestration system. It runs coding agents (Claude Code, OpenAI Codex) in Kubernetes pods against user repositories.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **API**: Fastify 5, TypeScript, Drizzle ORM (Postgres), BullMQ (Redis)
- **Web**: Next.js 15 App Router, Tailwind CSS v4, Zustand, Lucide icons
- **Runtime**: Kubernetes (via `@kubernetes/client-node`)
- **All TypeScript**, ESM modules (`"type": "module"`)

## Key Architecture Decisions

- **Pod-per-repo**: Long-lived K8s pods clone a repo once, tasks run in git worktrees
- **Agent adapters**: Agents don't run directly — adapters produce `ContainerSpec` objects
- **Prompt templates**: System prompt is configurable with `{{VARIABLE}}` syntax and `{{#if}}` conditionals
- **Auth proxy**: Max subscription users get a token proxy endpoint; containers call back via `apiKeyHelper`
- **Structured logging**: Claude Code's `stream-json` output is parsed into typed events

## Commands

```bash
pnpm dev              # Start API (:4000) + Web (:3000)
pnpm turbo typecheck  # Typecheck all packages
pnpm turbo test       # Run tests
pnpm turbo build      # Build all packages
```

## Directory Layout

- `apps/api/src/routes/` — Fastify route handlers
- `apps/api/src/services/` — Business logic (task, repo-pool, secrets, auth, etc.)
- `apps/api/src/workers/` — BullMQ job processors
- `apps/api/src/db/` — Drizzle schema + migrations
- `apps/web/src/app/` — Next.js pages (App Router)
- `apps/web/src/components/` — React components
- `apps/web/src/hooks/` — Custom hooks (WebSocket, store, logs)
- `packages/shared/src/` — Shared types, state machine, constants
- `packages/container-runtime/src/` — K8s pod lifecycle
- `packages/agent-adapters/src/` — Claude Code + Codex adapters

## Conventions

- Use `Edit` over `Write` for existing files
- All packages use ESM (`"type": "module"`) with `.js` extensions in imports
- Tailwind v4: use `@import "tailwindcss"` and `@theme` in CSS, no config file
- Drizzle ORM for database, generate migrations with `drizzle-kit generate`
- Zod for API request validation
- Zustand for client state (use `getState()` in callbacks, not hook selectors)
- WebSocket events go through Redis pub/sub
