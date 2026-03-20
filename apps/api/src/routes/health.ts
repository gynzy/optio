import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { checkRuntimeHealth } from "../services/container-service.js";
import { sql } from "drizzle-orm";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_req, reply) => {
    const checks: Record<string, boolean> = {};

    // Database check
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = true;
    } catch {
      checks.database = false;
    }

    // Container runtime check
    try {
      checks.containerRuntime = await checkRuntimeHealth();
    } catch {
      checks.containerRuntime = false;
    }

    const healthy = Object.values(checks).every(Boolean);
    reply.status(healthy ? 200 : 503).send({ healthy, checks });
  });
}
