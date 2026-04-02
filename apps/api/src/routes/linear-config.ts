import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as registrationService from "../services/linear-registration-service.js";

const saveRegistrationSchema = z.object({
  name: z.string().min(1),
  oauthClientId: z.string().min(1),
  webhookSecret: z.string().min(1),
  systemPrompt: z.string().optional(),
  selectedSkillIds: z.array(z.string()).optional(),
  selectedMcpServerIds: z.array(z.string()).optional(),
  marketplacePlugins: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function linearConfigRoutes(app: FastifyInstance) {
  // Get Linear integration config status
  app.get("/api/linear/config", async (req, reply) => {
    const publicUrl = process.env.PUBLIC_URL ?? `${req.protocol}://${req.hostname}`;
    const webhookUrl = `${publicUrl}/api/linear/webhook`;
    const status = await registrationService.getConfigStatus(webhookUrl);
    reply.send({ status });
  });

  // Test Linear connection
  app.post("/api/linear/config/test", async (req, reply) => {
    const success = await registrationService.testConnection();
    reply.send({ success });
  });

  // Get the single registration
  app.get("/api/linear/registration", async (req, reply) => {
    const workspaceId = req.user?.workspaceId ?? null;
    const registration = await registrationService.getRegistration(workspaceId);
    reply.send({ registration });
  });

  // Create or update the single registration
  app.put("/api/linear/registration", async (req, reply) => {
    const input = saveRegistrationSchema.parse(req.body);
    const workspaceId = req.user?.workspaceId ?? null;
    const registration = await registrationService.saveRegistration(input, workspaceId);
    reply.send({ registration });
  });

  // Delete the single registration
  app.delete("/api/linear/registration", async (req, reply) => {
    const workspaceId = req.user?.workspaceId ?? null;
    const existing = await registrationService.getRegistration(workspaceId);
    if (!existing) return reply.status(404).send({ error: "No registration found" });
    await registrationService.deleteRegistration(existing.id);
    reply.status(204).send();
  });
}
