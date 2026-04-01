CREATE TABLE IF NOT EXISTS "linear_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"linear_session_id" text NOT NULL,
	"linear_issue_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"conversation_messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enriched_context" jsonb,
	"spawned_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cost_usd" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linear_agent_sessions_linear_session_id_idx" ON "linear_agent_sessions" USING btree ("linear_session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linear_agent_sessions_status_idx" ON "linear_agent_sessions" USING btree ("status");
