import type { FastifyInstance } from "fastify";
import {
  getClaudeAuthToken,
  isSubscriptionAvailable,
  invalidateCredentialsCache,
} from "../services/auth-service.js";

export async function authRoutes(app: FastifyInstance) {
  // Get the current Claude auth token (called by agent containers via apiKeyHelper)
  // Returns just the token string for easy consumption by shell scripts
  app.get("/api/auth/claude-token", async (_req, reply) => {
    const result = getClaudeAuthToken();
    if (!result.available || !result.token) {
      return reply.status(503).send({ error: result.error ?? "Token not available" });
    }
    // Return plain text token for easy consumption by apiKeyHelper script
    reply.type("text/plain").send(result.token);
  });

  // Get detailed auth status (for the setup wizard)
  app.get("/api/auth/status", async (_req, reply) => {
    const result = getClaudeAuthToken();
    reply.send({
      subscription: {
        available: result.available,
        expiresAt: result.expiresAt,
        error: result.error,
      },
    });
  });

  // Force refresh the cached credentials
  app.post("/api/auth/refresh", async (_req, reply) => {
    invalidateCredentialsCache();
    const result = getClaudeAuthToken();
    reply.send({
      subscription: {
        available: result.available,
        expiresAt: result.expiresAt,
        error: result.error,
      },
    });
  });
}
