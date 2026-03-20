ALTER TABLE "task_logs" ADD COLUMN "log_type" text;--> statement-breakpoint
ALTER TABLE "task_logs" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "session_id" text;