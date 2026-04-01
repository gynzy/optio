import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as registrationService from "../services/linear-registration-service.js";

const createRegistrationSchema = z.object({
  name: z.string().min(1),
  oauthClientId: z.string().min(1),
  webhookSecret: z.string().min(1),
  systemPrompt: z.string().optional(),
  selectedSkillIds: z.array(z.string()).optional(),
  selectedMcpServerIds: z.array(z.string()).optional(),
  marketplacePlugins: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateRegistrationSchema = z.object({
  name: z.string().min(1).optional(),
  oauthClientId: z.string().min(1).optional(),
  webhookSecret: z.string().min(1).optional(),
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

  // List registrations — scoped to workspace
  app.get("/api/linear/registrations", async (req, reply) => {
    const workspaceId = req.user?.workspaceId ?? null;
    const registrations = await registrationService.listRegistrations(workspaceId);
    reply.send({ registrations });
  });

  // Get a single registration — verify workspace ownership
  app.get("/api/linear/registrations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const registration = await registrationService.getRegistration(id);
    if (!registration) return reply.status(404).send({ error: "Registration not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && registration.workspaceId && registration.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Registration not found" });
    }
    reply.send({ registration });
  });

  // Create a registration — assign to workspace
  app.post("/api/linear/registrations", async (req, reply) => {
    const input = createRegistrationSchema.parse(req.body);
    const workspaceId = req.user?.workspaceId ?? null;
    const registration = await registrationService.createRegistration(input, workspaceId);
    reply.status(201).send({ registration });
  });

  // Update a registration — verify workspace ownership
  app.patch("/api/linear/registrations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await registrationService.getRegistration(id);
    if (!existing) return reply.status(404).send({ error: "Registration not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && existing.workspaceId && existing.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Registration not found" });
    }
    const input = updateRegistrationSchema.parse(req.body);
    const registration = await registrationService.updateRegistration(id, input);
    reply.send({ registration });
  });

  // Delete a registration — verify workspace ownership
  app.delete("/api/linear/registrations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await registrationService.getRegistration(id);
    if (!existing) return reply.status(404).send({ error: "Registration not found" });
    const wsId = req.user?.workspaceId;
    if (wsId && existing.workspaceId && existing.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Registration not found" });
    }
    await registrationService.deleteRegistration(id);
    reply.status(204).send();
  });
}
