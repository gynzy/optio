-- Phase 0: generalize workflow_triggers into a polymorphic trigger table.
-- Adds (target_type, target_id) so future task_config triggers can live here
-- alongside existing job (workflow) triggers without a table rename.

-- Allow task_config triggers to have no workflow.
ALTER TABLE "workflow_triggers" ALTER COLUMN "workflow_id" DROP NOT NULL;

-- Discriminator: "job" (existing workflow triggers) or "task_config" (new).
ALTER TABLE "workflow_triggers" ADD COLUMN "target_type" text NOT NULL DEFAULT 'job';

-- Polymorphic target id. Backfill from workflow_id for existing rows, then
-- promote to NOT NULL.
ALTER TABLE "workflow_triggers" ADD COLUMN "target_id" uuid;
UPDATE "workflow_triggers" SET "target_id" = "workflow_id" WHERE "target_id" IS NULL;
ALTER TABLE "workflow_triggers" ALTER COLUMN "target_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "workflow_triggers_target_idx"
  ON "workflow_triggers" ("target_type", "target_id");
