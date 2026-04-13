import { z } from "zod";

/**
 * Integration domain schemas — repos, webhooks, skills, MCP servers,
 * prompt templates, shared directories, ticket providers, Slack.
 *
 * These types are intentionally loose (`z.record(z.unknown())`) for
 * response bodies so the serializer doesn't reject the many enrichment
 * fields services layer onto Drizzle rows (aggregate stats, run history,
 * derived flags). The per-route documentation covers the important
 * fields via `.describe()` on request schemas; response shapes are
 * illustrated in prose.
 *
 * This is a deliberate trade-off: loose schemas here avoid the rabbit
 * hole of reverse-engineering every service's exact return shape while
 * still delivering typed inputs, full path/query/body docs, tags, and
 * operation metadata.
 */

export const RepoSchema = z
  .unknown()
  .describe("Repository configuration row (see `repos` table + service enrichment)");

export const WebhookSchema = z.unknown().describe("Outbound webhook configuration");

export const WebhookDeliverySchema = z.unknown().describe("Single webhook delivery attempt record");

export const McpServerSchema = z.unknown().describe("MCP server registration");

export const SkillSchema = z.unknown().describe("Skill catalog entry");

export const PromptTemplateSchema = z.unknown().describe("Prompt template row");

export const SharedDirectorySchema = z
  .unknown()
  .describe("Shared directory (persistent cache) configuration");

export const TicketProviderSchema = z.unknown().describe("Ticket provider connection config");

export const SlackConfigSchema = z.unknown().describe("Per-repo Slack notification configuration");

export const ConnectionProviderSchema = z.unknown().describe("Connection provider catalog entry");

export const ConnectionSchema = z.unknown().describe("Configured connection instance");

export const ConnectionAssignmentSchema = z.unknown().describe("Connection-to-repo assignment");
