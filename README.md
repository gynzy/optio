# Optio

AI Agent Workflow Orchestration — run coding agents (Claude Code, OpenAI Codex) on tasks from your repositories.

Optio manages the full lifecycle: task intake → container provisioning → agent execution → PR creation → CI monitoring → merge. Agents run in isolated Kubernetes pods with git worktrees for efficient multi-task concurrency.

## Features

- **Multi-agent support** — Claude Code and OpenAI Codex, with Max subscription or API key auth
- **Pod-per-repo architecture** — one long-lived pod per repository, tasks run in git worktrees
- **Real-time UI** — live log streaming, structured event viewer, task state timeline
- **Ticket integration** — auto-import GitHub Issues labeled `optio`, comment back with PR links
- **Configurable prompts** — template system with per-repo overrides, auto-merge toggle
- **Container image presets** — base, node, python, go, rust, full — or bring your own
- **Session resume** — capture Claude session IDs, resume interrupted work with follow-up prompts
- **Setup wizard** — guided onboarding with credential validation and repo auto-detection

## Quick Start

### Prerequisites

- **Docker Desktop** with Kubernetes enabled (Settings → Kubernetes → Enable)
- **Node.js 22+** and **pnpm 10+**

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/optio.git && cd optio
pnpm install

# Bootstrap infrastructure (Postgres + Redis in K8s, migrations, .env)
./scripts/setup-local.sh

# Start dev servers
pnpm dev
# API → http://localhost:4000
# Web → http://localhost:3000
```

The setup wizard will guide you through configuring GitHub access, agent credentials, and repositories.

### Build the Agent Image

```bash
docker build -t optio-agent:latest -f Dockerfile.agent .
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│   Web UI    │────→│  API Server  │────→│   K8s Pods          │
│  Next.js    │     │   Fastify    │     │                     │
│  :3000      │     │   :4000      │     │  ┌─ Repo Pod A ──┐  │
│             │←ws──│              │     │  │ clone + sleep  │  │
│ - Overview  │     │ - BullMQ     │     │  │ ├─ worktree 1  │  │
│ - Tasks     │     │ - Drizzle    │     │  │ ├─ worktree 2  │  │
│ - Repos     │     │ - WebSocket  │     │  │ └─ worktree N  │  │
│ - Settings  │     │              │     │  └────────────────┘  │
└─────────────┘     └──────┬───────┘     └─────────────────────┘
                           │
                    ┌──────┴───────┐
                    │  Postgres    │  State, logs, secrets, config
                    │  Redis       │  Job queue, pub/sub
                    └──────────────┘
```

## Project Structure

```
apps/
  api/          Fastify API, BullMQ workers, WebSocket endpoints
  web/          Next.js dashboard with real-time streaming

packages/
  shared/             Types, task state machine, prompt templates
  container-runtime/  Kubernetes pod lifecycle, exec, log streaming
  agent-adapters/     Claude Code + Codex prompt/auth adapters
  ticket-providers/   GitHub Issues (+ Linear/Notion stubs)

images/               Dockerfiles: base, node, python, go, rust, full
k8s/                  Kubernetes manifests for local infrastructure
scripts/              Setup, init, and entrypoint scripts
```

## Configuration

### Per-Repo Settings

Each repository can be configured with:
- **Container image** — preset (base/node/python/go/rust/full) or custom
- **Extra packages** — apt packages installed at pod startup
- **Prompt template override** — custom agent instructions for this repo
- **Auto-merge** — whether agents should merge PRs after CI passes
- **Setup script** — `.optio/setup.sh` in the repo runs after clone

### Prompt Templates

Agents receive a system prompt with these variables:
- `{{TASK_FILE}}` — path to the task description file
- `{{BRANCH_NAME}}` — the working branch
- `{{TASK_ID}}` — unique task identifier
- `{{TASK_TITLE}}` — task title
- `{{REPO_NAME}}` — repository name (owner/repo)
- `{{AUTO_MERGE}}` — for conditional merge instructions

### Authentication

Claude Code supports two auth modes:
- **API Key** — `ANTHROPIC_API_KEY` injected into the container
- **Max Subscription** — token proxy reads from host's Keychain, containers call back via `apiKeyHelper`

## Teardown

```bash
pkill -f 'kubectl port-forward.*optio'
kubectl delete namespace optio
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | Turborepo + pnpm |
| API | Fastify 5, Drizzle ORM, BullMQ |
| Web | Next.js 15, Tailwind CSS 4, Zustand |
| Database | PostgreSQL 16 |
| Queue | Redis 7 + BullMQ |
| Runtime | Kubernetes (Docker Desktop for local) |
| Agents | Claude Code, OpenAI Codex |
