import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as sharedDirService from "../services/shared-directory-service.js";

const repoIdParamsSchema = z.object({ id: z.string() });
const dirIdParamsSchema = z.object({ id: z.string(), dirId: z.string() });

const createSharedDirectorySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9](-?[a-z0-9])*$/, "lowercase alphanumeric with optional hyphens"),
  description: z.string().optional(),
  mountLocation: z.enum(["workspace", "home"]),
  mountSubPath: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9._/-]+$/, "alphanumeric with . _ / - only")
    .refine((p) => !p.startsWith("/"), "must not start with /")
    .refine((p) => !p.includes(".."), "must not contain path traversal"),
  sizeGi: z.number().int().min(1).max(100).default(10),
  scope: z.enum(["per-pod"]).default("per-pod"),
});

const updateSharedDirectorySchema = z.object({
  description: z.string().nullable().optional(),
  sizeGi: z.number().int().min(1).max(100).optional(),
});

export async function sharedDirectoryRoutes(app: FastifyInstance) {
  // List shared directories for a repo
  app.get("/api/repos/:id/shared-directories", async (req, reply) => {
    const { id } = repoIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const directories = await sharedDirService.listSharedDirectories(id);
    reply.send({ directories });
  });

  // Create a shared directory
  app.post("/api/repos/:id/shared-directories", async (req, reply) => {
    const { id } = repoIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const input = createSharedDirectorySchema.parse(req.body);

    // Additional validation
    const validationError = sharedDirService.validateSharedDirectoryInput(input);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    try {
      const directory = await sharedDirService.createSharedDirectory({
        repoId: id,
        workspaceId: repo.workspaceId,
        name: input.name,
        description: input.description,
        mountLocation: input.mountLocation,
        mountSubPath: input.mountSubPath,
        sizeGi: input.sizeGi,
        scope: input.scope,
        createdBy: req.user?.id,
      });
      reply.status(201).send({ directory });
    } catch (err: any) {
      if (err?.message?.includes("unique") || err?.code === "23505") {
        return reply.status(409).send({
          error: `A shared directory named '${input.name}' already exists for this repo`,
        });
      }
      if (err?.message?.includes("total cache size")) {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // Update a shared directory
  app.patch("/api/repos/:id/shared-directories/:dirId", async (req, reply) => {
    const { id, dirId } = dirIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const existing = await sharedDirService.getSharedDirectory(dirId);
    if (!existing || existing.repoId !== id) {
      return reply.status(404).send({ error: "Shared directory not found" });
    }

    const input = updateSharedDirectorySchema.parse(req.body);
    const directory = await sharedDirService.updateSharedDirectory(dirId, input);
    reply.send({ directory });
  });

  // Delete a shared directory
  app.delete("/api/repos/:id/shared-directories/:dirId", async (req, reply) => {
    const { id, dirId } = dirIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const existing = await sharedDirService.getSharedDirectory(dirId);
    if (!existing || existing.repoId !== id) {
      return reply.status(404).send({ error: "Shared directory not found" });
    }

    await sharedDirService.deleteSharedDirectory(dirId);
    reply.status(204).send();
  });

  // Clear a shared directory's contents
  app.post("/api/repos/:id/shared-directories/:dirId/clear", async (req, reply) => {
    const { id, dirId } = dirIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const existing = await sharedDirService.getSharedDirectory(dirId);
    if (!existing || existing.repoId !== id) {
      return reply.status(404).send({ error: "Shared directory not found" });
    }

    await sharedDirService.clearSharedDirectory(existing, repo.repoUrl);
    reply.send({ ok: true });
  });

  // Get usage of a shared directory
  app.post("/api/repos/:id/shared-directories/:dirId/usage", async (req, reply) => {
    const { id, dirId } = dirIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const existing = await sharedDirService.getSharedDirectory(dirId);
    if (!existing || existing.repoId !== id) {
      return reply.status(404).send({ error: "Shared directory not found" });
    }

    const usage = await sharedDirService.getSharedDirectoryUsage(existing, repo.repoUrl);
    reply.send({ usage });
  });

  // Recycle (destroy) all ready pods for a repo so they get recreated with new mounts
  app.post("/api/repos/:id/pods/recycle", async (req, reply) => {
    const { id } = repoIdParamsSchema.parse(req.params);
    const { getRepo } = await import("../services/repo-service.js");
    const repo = await getRepo(id);
    if (!repo) return reply.status(404).send({ error: "Repo not found" });

    const wsId = req.user?.workspaceId;
    if (wsId && repo.workspaceId && repo.workspaceId !== wsId) {
      return reply.status(404).send({ error: "Repo not found" });
    }

    const { listRepoPodsForRepo } = await import("../services/repo-pool-service.js");
    const { getRuntime } = await import("../services/container-service.js");
    const { deleteNetworkPolicy, deleteEnvoyConfigMap } =
      await import("../services/repo-pool-service.js");
    const { db: dbClient } = await import("../db/client.js");
    const { repoPods: repoPodsTable } = await import("../db/schema.js");
    const { eq: eqOp } = await import("drizzle-orm");

    const pods = await listRepoPodsForRepo(repo.repoUrl);
    const rt = getRuntime();
    let recycled = 0;

    for (const pod of pods) {
      if (pod.state !== "ready" || pod.activeTaskCount > 0) continue;
      try {
        if (pod.podName) {
          await deleteNetworkPolicy(pod.podName).catch(() => {});
          await deleteEnvoyConfigMap(pod.podName).catch(() => {});
          await rt.destroy({ id: pod.podId ?? pod.podName, name: pod.podName });
        }
        await dbClient.delete(repoPodsTable).where(eqOp(repoPodsTable.id, pod.id));
        recycled++;
      } catch {
        // Skip pods that can't be recycled
      }
    }

    reply.send({ ok: true, recycled });
  });
}
