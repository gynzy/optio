-- Phase 1: task_configs — reusable task blueprints that triggers instantiate
-- into concrete tasks. Sibling to `workflows`; both plug into the generic
-- trigger table via (target_type, target_id).

CREATE TABLE "task_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "prompt" text NOT NULL,
  "prompt_template_id" uuid REFERENCES "prompt_templates"("id") ON DELETE SET NULL,
  "repo_url" text NOT NULL,
  "repo_branch" text NOT NULL DEFAULT 'main',
  "agent_type" text,
  "max_retries" integer NOT NULL DEFAULT 3,
  "priority" integer NOT NULL DEFAULT 100,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "task_configs_workspace_name_key" UNIQUE ("workspace_id", "name")
);

CREATE INDEX "task_configs_workspace_id_idx" ON "task_configs" ("workspace_id");
CREATE INDEX "task_configs_enabled_idx" ON "task_configs" ("enabled");
