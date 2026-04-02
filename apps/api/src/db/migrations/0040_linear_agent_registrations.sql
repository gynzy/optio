CREATE TABLE IF NOT EXISTS "linear_agent_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"oauth_client_id" text NOT NULL,
	"encrypted_webhook_secret" "bytea" NOT NULL,
	"secret_iv" "bytea" NOT NULL,
	"secret_auth_tag" "bytea" NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"selected_skill_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_mcp_server_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"marketplace_plugins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linear_agent_registrations_oauth_client_id_idx" ON "linear_agent_registrations" USING btree ("oauth_client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_agent_registrations_workspace_id_idx" ON "linear_agent_registrations" USING btree ("workspace_id");
