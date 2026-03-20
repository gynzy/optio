import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as secretService from "../services/secret-service.js";

const createSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  scope: z.string().optional(),
});

export async function secretRoutes(app: FastifyInstance) {
  // List secrets (names only)
  app.get("/api/secrets", async (req, reply) => {
    const query = req.query as { scope?: string };
    const secrets = await secretService.listSecrets(query.scope);
    reply.send({ secrets });
  });

  // Create/update secret
  app.post("/api/secrets", async (req, reply) => {
    const input = createSecretSchema.parse(req.body);
    await secretService.storeSecret(input.name, input.value, input.scope);
    reply.status(201).send({ name: input.name, scope: input.scope ?? "global" });
  });

  // Delete secret
  app.delete("/api/secrets/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const query = req.query as { scope?: string };
    await secretService.deleteSecret(name, query.scope);
    reply.status(204).send();
  });
}
