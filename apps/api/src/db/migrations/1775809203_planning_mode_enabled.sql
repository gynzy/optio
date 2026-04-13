ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "planning_mode_enabled" boolean DEFAULT false NOT NULL;
