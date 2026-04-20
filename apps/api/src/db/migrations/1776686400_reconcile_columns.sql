-- Control plane: declarative user intent and durable reconcile backoff.
-- Added for the K8s-style reconciler. All nullable / default 0 so existing
-- rows are valid without backfill.

ALTER TABLE "tasks" ADD COLUMN "control_intent" text;
ALTER TABLE "tasks" ADD COLUMN "reconcile_backoff_until" timestamptz;
ALTER TABLE "tasks" ADD COLUMN "reconcile_attempts" integer NOT NULL DEFAULT 0;

ALTER TABLE "workflow_runs" ADD COLUMN "control_intent" text;
ALTER TABLE "workflow_runs" ADD COLUMN "reconcile_backoff_until" timestamptz;
ALTER TABLE "workflow_runs" ADD COLUMN "reconcile_attempts" integer NOT NULL DEFAULT 0;
