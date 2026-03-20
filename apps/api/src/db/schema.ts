import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  boolean,
  customType,
  unique,
} from "drizzle-orm/pg-core";

export const taskStateEnum = pgEnum("task_state", [
  "pending",
  "queued",
  "provisioning",
  "running",
  "needs_attention",
  "pr_opened",
  "completed",
  "failed",
  "cancelled",
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  repoUrl: text("repo_url").notNull(),
  repoBranch: text("repo_branch").notNull().default("main"),
  state: taskStateEnum("state").notNull().default("pending"),
  agentType: text("agent_type").notNull(),
  containerId: text("container_id"),
  sessionId: text("session_id"),
  prUrl: text("pr_url"),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  ticketSource: text("ticket_source"),
  ticketExternalId: text("ticket_external_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const taskEvents = pgTable("task_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  fromState: taskStateEnum("from_state"),
  toState: taskStateEnum("to_state").notNull(),
  trigger: text("trigger").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskLogs = pgTable("task_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  stream: text("stream").notNull().default("stdout"),
  content: text("content").notNull(),
  logType: text("log_type"),  // "text" | "tool_use" | "tool_result" | "thinking" | "system" | "error" | "info"
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    scope: text("scope").notNull().default("global"),
    encryptedValue: bytea("encrypted_value").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("secrets_name_scope_key").on(table.name, table.scope)],
);

export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoUrl: text("repo_url").notNull().unique(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  isPrivate: boolean("is_private").notNull().default(false),
  imagePreset: text("image_preset").default("base"),
  extraPackages: text("extra_packages"),  // comma-separated
  autoMerge: boolean("auto_merge").notNull().default(false),
  promptTemplateOverride: text("prompt_template_override"),  // null = use global default
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketProviders = pgTable("ticket_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const repoPodStateEnum = pgEnum("repo_pod_state", [
  "provisioning",
  "ready",
  "error",
  "terminating",
]);

export const repoPods = pgTable("repo_pods", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoUrl: text("repo_url").notNull().unique(),
  repoBranch: text("repo_branch").notNull().default("main"),
  podName: text("pod_name"),
  podId: text("pod_id"),
  state: repoPodStateEnum("state").notNull().default("provisioning"),
  activeTaskCount: integer("active_task_count").notNull().default(0),
  lastTaskAt: timestamp("last_task_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  template: text("template").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  repoUrl: text("repo_url"),  // null = global default, set = repo-specific
  autoMerge: boolean("auto_merge").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
