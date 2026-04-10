-- Repair migration: idempotently create any objects that may be missing on
-- clusters affected by duplicate-numbered migration files.
--
-- Six pairs of migrations shared numeric prefixes (0016, 0018, 0019, 0026,
-- 0039, 0042). Depending on merge order and journal state, some clusters may
-- have recorded a migration as applied without actually executing the SQL.
-- This migration uses IF NOT EXISTS / IF EXISTS guards so it is safe to run
-- on any cluster regardless of current state.

-- === From 0016_notification_webhooks.sql ===
DO $$ BEGIN
  CREATE TYPE "public"."webhook_event" AS ENUM('task.completed', 'task.failed', 'task.needs_attention', 'task.pr_opened', 'review.completed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "url" text NOT NULL,
  "events" jsonb NOT NULL,
  "secret" text,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "webhook_id" uuid NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status_code" integer,
  "response_body" text,
  "success" boolean NOT NULL DEFAULT false,
  "attempt" integer NOT NULL DEFAULT 1,
  "error" text,
  "delivered_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk"
    FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- === From 0018_interactive_sessions.sql ===
DO $$ BEGIN
  CREATE TYPE "interactive_session_state" AS ENUM('active', 'ended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "interactive_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo_url" text NOT NULL,
  "user_id" uuid,
  "worktree_path" text,
  "branch" text NOT NULL,
  "state" "interactive_session_state" DEFAULT 'active' NOT NULL,
  "pod_id" uuid,
  "cost_usd" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "interactive_sessions_repo_url_idx" ON "interactive_sessions" ("repo_url");
CREATE INDEX IF NOT EXISTS "interactive_sessions_state_idx" ON "interactive_sessions" ("state");
CREATE INDEX IF NOT EXISTS "interactive_sessions_user_id_idx" ON "interactive_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "session_prs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "pr_url" text NOT NULL,
  "pr_number" integer NOT NULL,
  "pr_state" text,
  "pr_checks_status" text,
  "pr_review_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "session_prs" ADD CONSTRAINT "session_prs_session_id_interactive_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "interactive_sessions"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "session_prs_session_id_idx" ON "session_prs" ("session_id");

-- === From 0019_task_comments_activity.sql ===
CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "user_id" uuid,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");

ALTER TABLE "task_events" ADD COLUMN IF NOT EXISTS "user_id" uuid;

DO $$ BEGIN
  ALTER TABLE "task_events" ADD CONSTRAINT "task_events_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- === From 0026_pod_resource_requests.sql ===
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cpu_request" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cpu_limit" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "memory_request" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "memory_limit" text;

-- === From 0039_add_git_platform.sql ===
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "git_platform" text NOT NULL DEFAULT 'github';

-- === From 0039_cautious_mode.sql ===
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cautious_mode" boolean NOT NULL DEFAULT false;

-- === From 0042_opencode_repo_columns.sql ===
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "opencode_model" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "opencode_agent" text;
ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "opencode_provider" text;

-- === From 0042_task_messages.sql ===
DO $$ BEGIN
  CREATE TYPE "task_message_mode" AS ENUM ('soft', 'interrupt');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "task_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL,
  "user_id" uuid,
  "content" text NOT NULL,
  "mode" "task_message_mode" NOT NULL DEFAULT 'soft',
  "workspace_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "acked_at" timestamp with time zone,
  "delivery_error" text
);

DO $$ BEGIN
  ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "task_messages_task_id_idx" ON "task_messages" ("task_id");
CREATE INDEX IF NOT EXISTS "task_messages_task_created_idx" ON "task_messages" ("task_id", "created_at");

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "last_message_at" timestamp with time zone;

-- Backfill git_platform for gitlab repos (safe to re-run)
UPDATE "repos" SET "git_platform" = 'gitlab' WHERE "repo_url" LIKE '%gitlab%' AND "git_platform" = 'github';
