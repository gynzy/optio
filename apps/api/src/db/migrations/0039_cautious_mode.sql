ALTER TABLE "repos" ADD COLUMN IF NOT EXISTS "cautious_mode" boolean NOT NULL DEFAULT false;
