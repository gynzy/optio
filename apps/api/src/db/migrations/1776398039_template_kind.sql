-- Phase 3: extend prompt_templates into a unified templates library.
-- Adds kind discriminator + params schema + optional agent hint + description.
-- Existing rows default to kind='prompt' (coding templates), preserving behavior.

ALTER TABLE "prompt_templates" ADD COLUMN "kind" text NOT NULL DEFAULT 'prompt';
ALTER TABLE "prompt_templates" ADD COLUMN "params_schema" jsonb;
ALTER TABLE "prompt_templates" ADD COLUMN "default_agent_type" text;
ALTER TABLE "prompt_templates" ADD COLUMN "description" text;

CREATE INDEX IF NOT EXISTS "prompt_templates_kind_idx"
  ON "prompt_templates" ("kind");
