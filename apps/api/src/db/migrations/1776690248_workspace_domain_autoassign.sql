-- Workspace domain-based auto-assignment
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "allowed_domains" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "auto_assign_enabled" boolean NOT NULL DEFAULT false;
