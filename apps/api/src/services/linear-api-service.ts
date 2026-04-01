import { LinearClient, type IssueLabel, type Issue, type Attachment } from "@linear/sdk";
import type { LinearEnrichedContext, LinearPlanTodo } from "@optio/shared";
import { logger } from "../logger.js";

const log = logger.child({ service: "linear-api" });

export interface LinearApiService {
  initialize(): Promise<void>;
  createTextActivity(
    sessionId: string,
    type: string,
    body: string,
    ephemeral?: boolean,
  ): Promise<string | undefined>;
  createActionActivity(
    sessionId: string,
    action: string,
    parameter?: string,
    result?: string,
  ): Promise<string | undefined>;
  updateSessionPlan(sessionId: string, plan: LinearPlanTodo[]): Promise<void>;
  enrichContext(issueId: string): Promise<LinearEnrichedContext>;
}

export function createLinearApiService(): LinearApiService {
  let client: LinearClient | null = null;

  async function getClient(): Promise<LinearClient> {
    if (client) return client;
    const { retrieveSecret } = await import("./secret-service.js");
    const token = (await retrieveSecret("LINEAR_API_TOKEN")) as string;
    client = new LinearClient({ apiKey: token });
    return client;
  }

  return {
    async initialize() {
      await getClient();
    },

    async createTextActivity(sessionId, type, body, ephemeral) {
      const c = await getClient();
      try {
        const result = await c.createAgentActivity({
          agentSessionId: sessionId,
          content: { type: type as any, body },
          ephemeral: ephemeral || undefined,
        });
        if (result.success) {
          const activity = await result.agentActivity;
          log.info({ sessionId, type }, "Sent activity to Linear");
          return activity?.id;
        }
        log.error({ sessionId, type }, "Failed to create activity");
        return undefined;
      } catch (err) {
        log.error({ err, sessionId, type }, "Failed to create activity");
        throw err;
      }
    },

    async createActionActivity(sessionId, action, parameter, result) {
      const c = await getClient();
      try {
        const res = await c.createAgentActivity({
          agentSessionId: sessionId,
          content: { type: "action" as any, action, parameter, result },
          ephemeral: undefined,
        });
        if (res.success) {
          const activity = await res.agentActivity;
          log.info({ sessionId, action }, "Sent action activity to Linear");
          return activity?.id;
        }
        return undefined;
      } catch (err) {
        log.error({ err, sessionId, action }, "Failed to create action activity");
        throw err;
      }
    },

    async updateSessionPlan(sessionId, plan) {
      const c = await getClient();
      try {
        const result = await c.updateAgentSession(sessionId, {
          plan: plan.map((todo) => ({
            content: todo.content,
            status: todo.status as any,
          })),
        });
        if (result.success) {
          log.info({ sessionId, count: plan.length }, "Updated plan in Linear");
        } else {
          log.error({ sessionId }, "Failed to update plan");
        }
      } catch (err) {
        log.error({ err, sessionId }, "Failed to update plan");
        throw err;
      }
    },

    async enrichContext(issueId) {
      const c = await getClient();
      const context: LinearEnrichedContext = {};
      try {
        const issue = await c.issue(issueId);
        const [labels, children, attachments] = await Promise.all([
          issue.labels(),
          issue.children(),
          issue.attachments(),
        ]);
        context.issue = {
          labels: labels.nodes.map((l: IssueLabel) => ({ id: l.id, name: l.name })),
          children: children.nodes.map((ch: Issue) => ({
            identifier: ch.identifier,
            title: ch.title,
            url: ch.url,
          })),
          attachments: attachments.nodes.map((a: Attachment) => ({
            id: a.id,
            title: a.title,
            url: a.url,
          })),
        };
        log.info(
          {
            issueId,
            labels: context.issue.labels.length,
            children: context.issue.children.length,
            attachments: context.issue.attachments.length,
          },
          "Enriched context from Linear",
        );
      } catch (err) {
        log.error({ err, issueId }, "Failed to enrich context");
      }
      return context;
    },
  };
}
