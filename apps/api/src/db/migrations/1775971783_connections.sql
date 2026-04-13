-- Connection Providers (catalog of available connection types)
DO $$ BEGIN
  CREATE TYPE "public"."connection_status" AS ENUM('healthy', 'error', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "connection_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "icon" text,
  "category" text DEFAULT 'custom' NOT NULL,
  "type" text DEFAULT 'mcp' NOT NULL,
  "config_schema" jsonb,
  "required_secrets" jsonb DEFAULT '[]'::jsonb,
  "mcp_config" jsonb,
  "capabilities" jsonb DEFAULT '[]'::jsonb,
  "docs_url" text,
  "built_in" boolean DEFAULT false NOT NULL,
  "workspace_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connection_providers_slug_ws_key" UNIQUE("slug", "workspace_id")
);

CREATE INDEX IF NOT EXISTS "connection_providers_category_idx" ON "connection_providers" USING btree ("category");
CREATE INDEX IF NOT EXISTS "connection_providers_workspace_id_idx" ON "connection_providers" USING btree ("workspace_id");

-- Connections (configured instances of providers)
CREATE TABLE IF NOT EXISTS "connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "provider_id" uuid NOT NULL REFERENCES "connection_providers"("id") ON DELETE CASCADE,
  "config" jsonb,
  "scope" text DEFAULT 'global' NOT NULL,
  "repo_url" text,
  "workspace_id" uuid,
  "enabled" boolean DEFAULT true NOT NULL,
  "status" "connection_status" DEFAULT 'unknown' NOT NULL,
  "status_message" text,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "connections_provider_id_idx" ON "connections" USING btree ("provider_id");
CREATE INDEX IF NOT EXISTS "connections_workspace_id_idx" ON "connections" USING btree ("workspace_id");
CREATE INDEX IF NOT EXISTS "connections_scope_idx" ON "connections" USING btree ("scope");

-- Connection Assignments (which repos get which connections)
CREATE TABLE IF NOT EXISTS "connection_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL REFERENCES "connections"("id") ON DELETE CASCADE,
  "repo_id" uuid REFERENCES "repos"("id") ON DELETE CASCADE,
  "agent_types" jsonb DEFAULT '[]'::jsonb,
  "permission" text DEFAULT 'read' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "connection_assignments_conn_repo_key" UNIQUE("connection_id", "repo_id")
);

CREATE INDEX IF NOT EXISTS "connection_assignments_connection_id_idx" ON "connection_assignments" USING btree ("connection_id");
CREATE INDEX IF NOT EXISTS "connection_assignments_repo_id_idx" ON "connection_assignments" USING btree ("repo_id");
