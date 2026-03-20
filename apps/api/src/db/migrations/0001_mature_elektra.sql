CREATE TYPE "public"."repo_pod_state" AS ENUM('provisioning', 'ready', 'error', 'terminating');--> statement-breakpoint
CREATE TABLE "repo_pods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_url" text NOT NULL,
	"repo_branch" text DEFAULT 'main' NOT NULL,
	"pod_name" text,
	"pod_id" text,
	"state" "repo_pod_state" DEFAULT 'provisioning' NOT NULL,
	"active_task_count" integer DEFAULT 0 NOT NULL,
	"last_task_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_pods_repo_url_unique" UNIQUE("repo_url")
);
