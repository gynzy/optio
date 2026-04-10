ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "allow_docker_in_docker" boolean NOT NULL DEFAULT false;
