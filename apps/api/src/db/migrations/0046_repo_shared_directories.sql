CREATE TABLE IF NOT EXISTS "repo_shared_directories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "repo_id" uuid NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "workspace_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "mount_location" text NOT NULL,
  "mount_sub_path" text NOT NULL,
  "size_gi" integer NOT NULL DEFAULT 10,
  "scope" text NOT NULL DEFAULT 'per-pod',
  "created_by" uuid,
  "last_cleared_at" timestamp with time zone,
  "last_mounted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "repo_shared_dirs_repo_name_key" ON "repo_shared_directories" ("repo_id", "name");
CREATE INDEX IF NOT EXISTS "repo_shared_dirs_repo_id_idx" ON "repo_shared_directories" ("repo_id");
CREATE INDEX IF NOT EXISTS "repo_shared_dirs_workspace_idx" ON "repo_shared_directories" ("workspace_id");

ALTER TABLE "repo_pods"
  ADD COLUMN IF NOT EXISTS "cache_pvc_name" text,
  ADD COLUMN IF NOT EXISTS "cache_pvc_state" text;
