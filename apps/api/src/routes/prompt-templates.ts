import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getPromptTemplate,
  saveDefaultPromptTemplate,
  saveRepoPromptTemplate,
  listPromptTemplates,
} from "../services/prompt-template-service.js";
import { DEFAULT_PROMPT_TEMPLATE } from "@optio/shared";

const saveTemplateSchema = z.object({
  template: z.string().min(1),
  autoMerge: z.boolean().optional(),
  repoUrl: z.string().optional(),
});

export async function promptTemplateRoutes(app: FastifyInstance) {
  // Get the effective template for a repo (or global default)
  app.get("/api/prompt-templates/effective", async (req, reply) => {
    const query = req.query as { repoUrl?: string };
    const result = await getPromptTemplate(query.repoUrl);
    reply.send(result);
  });

  // Get the hardcoded default (for reset)
  app.get("/api/prompt-templates/builtin-default", async (_req, reply) => {
    reply.send({ template: DEFAULT_PROMPT_TEMPLATE });
  });

  // List all templates
  app.get("/api/prompt-templates", async (_req, reply) => {
    const templates = await listPromptTemplates();
    reply.send({ templates });
  });

  // Save template
  app.post("/api/prompt-templates", async (req, reply) => {
    const body = saveTemplateSchema.parse(req.body);
    if (body.repoUrl) {
      await saveRepoPromptTemplate(body.repoUrl, body.template, body.autoMerge ?? false);
    } else {
      await saveDefaultPromptTemplate(body.template, body.autoMerge ?? false);
    }
    reply.status(201).send({ ok: true });
  });
}
