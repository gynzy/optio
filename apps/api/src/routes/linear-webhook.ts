import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { logger } from "../logger.js";
import type { RegistrationRecord } from "../services/linear-registration-service.js";

const log = logger.child({ route: "linear-webhook" });

export function verifyLinearSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function linearWebhookRoutes(app: FastifyInstance) {
  app.post("/api/webhooks/linear", {
    preParsing: async (req, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
      }
      const rawBody = Buffer.concat(chunks);
      (req as any).rawBody = rawBody;
      return Readable.from(rawBody);
    },
    handler: async (req, reply) => {
      const body = req.body as any;

      // Try to look up a per-registration webhook secret via oauthClientId
      let webhookSecret: string | undefined;
      let registration: RegistrationRecord | undefined;

      const oauthClientId = body?.oauthClientId as string | undefined;
      if (oauthClientId) {
        try {
          const { getRegistrationByClientId } =
            await import("../services/linear-registration-service.js");
          const result = await getRegistrationByClientId(oauthClientId);
          if (result) {
            const { webhookSecret: regSecret, ...reg } = result;
            webhookSecret = regSecret;
            registration = reg;
            log.debug({ oauthClientId }, "Using per-registration webhook secret");
          }
        } catch (err) {
          log.warn({ err, oauthClientId }, "Failed to look up registration by oauthClientId");
        }
      }

      // Fall back to global LINEAR_WEBHOOK_SECRET if no registration matched
      if (!webhookSecret) {
        try {
          const { retrieveSecret } = await import("../services/secret-service.js");
          webhookSecret = (await retrieveSecret("LINEAR_WEBHOOK_SECRET")) as string;
        } catch {
          log.error("LINEAR_WEBHOOK_SECRET not configured");
          return reply.status(401).send({ error: "Webhook secret not configured" });
        }
      }

      const signature = req.headers["linear-signature"] as string | undefined;
      if (!signature) {
        log.warn("Missing linear-signature header");
        return reply.status(401).send({ error: "Missing signature" });
      }

      const rawBody = ((req as any).rawBody as Buffer).toString("utf-8");
      if (!verifyLinearSignature(rawBody, signature, webhookSecret)) {
        log.warn("Invalid Linear webhook signature");
        return reply.status(401).send({ error: "Invalid signature" });
      }

      const payload = body;
      const sessionId = payload.agentSession?.id;

      if (!sessionId) {
        log.warn("Webhook payload missing agentSession.id");
        return reply.status(400).send({ error: "Missing session ID" });
      }

      const signal = payload.agentActivity?.signal;
      if (signal === "stop") {
        log.info({ sessionId }, "Received stop signal from Linear");
        import("../services/linear-coordinator-service.js")
          .then(({ stopSession }) => stopSession(sessionId))
          .catch((err) => log.error({ err, sessionId }, "Failed to stop session"));
        return reply.status(200).send({ ok: true });
      }

      log.info({ sessionId }, "Received Linear agent webhook");
      import("../services/linear-coordinator-service.js")
        .then(({ handleWebhook }) => (handleWebhook as any)(payload, registration))
        .catch((err) => log.error({ err, sessionId }, "Failed to handle webhook"));

      return reply.status(200).send({ ok: true });
    },
  });
}
