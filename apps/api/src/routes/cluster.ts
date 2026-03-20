import type { FastifyInstance } from "fastify";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { db } from "../db/client.js";
import { repoPods, tasks } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

function getK8sApi() {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc.makeApiClient(CoreV1Api);
}

const NAMESPACE = "optio";

export async function clusterRoutes(app: FastifyInstance) {
  // Cluster overview: nodes, all pods, services, resource summary
  app.get("/api/cluster/overview", async (_req, reply) => {
    try {
      const api = getK8sApi();

      const [nodeList, podList, serviceList, eventList] = await Promise.all([
        api.listNode({ limit: 50 }),
        api.listNamespacedPod({ namespace: NAMESPACE }),
        api.listNamespacedService({ namespace: NAMESPACE }),
        api.listNamespacedEvent({ namespace: NAMESPACE, limit: 30 }),
      ]);

      const nodes = (nodeList.items ?? []).map((n) => ({
        name: n.metadata?.name,
        status: n.status?.conditions?.find((c) => c.type === "Ready")?.status === "True" ? "Ready" : "NotReady",
        kubeletVersion: n.status?.nodeInfo?.kubeletVersion,
        os: n.status?.nodeInfo?.osImage,
        arch: n.status?.nodeInfo?.architecture,
        cpu: n.status?.capacity?.["cpu"],
        memory: n.status?.capacity?.["memory"],
        containerRuntime: n.status?.nodeInfo?.containerRuntimeVersion,
      }));

      const pods = (podList.items ?? []).map((p) => {
        const containerStatus = p.status?.containerStatuses?.[0];
        const waiting = containerStatus?.state?.waiting;
        const running = containerStatus?.state?.running;
        const terminated = containerStatus?.state?.terminated;

        return {
          name: p.metadata?.name,
          phase: p.status?.phase,
          status: waiting?.reason ?? (running ? "Running" : terminated?.reason ?? p.status?.phase ?? "Unknown"),
          ready: containerStatus?.ready ?? false,
          restarts: containerStatus?.restartCount ?? 0,
          image: containerStatus?.image ?? p.spec?.containers?.[0]?.image,
          nodeName: p.spec?.nodeName,
          ip: p.status?.podIP,
          startedAt: running?.startedAt ?? p.status?.startTime,
          labels: p.metadata?.labels ?? {},
          isOptioManaged: p.metadata?.labels?.["managed-by"] === "optio",
          isInfra: !!(p.metadata?.labels?.["app"] && ["postgres", "redis"].includes(p.metadata.labels["app"])),
        };
      });

      const services = (serviceList.items ?? []).map((s) => ({
        name: s.metadata?.name,
        type: s.spec?.type,
        clusterIP: s.spec?.clusterIP,
        ports: s.spec?.ports?.map((p) => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
        })),
      }));

      const events = (eventList.items ?? [])
        .sort((a, b) => {
          const aTime = a.lastTimestamp ?? a.metadata?.creationTimestamp ?? "";
          const bTime = b.lastTimestamp ?? b.metadata?.creationTimestamp ?? "";
          return String(bTime).localeCompare(String(aTime));
        })
        .slice(0, 20)
        .map((e) => ({
          type: e.type,
          reason: e.reason,
          message: e.message,
          involvedObject: e.involvedObject?.name,
          count: e.count,
          lastTimestamp: e.lastTimestamp ?? e.metadata?.creationTimestamp,
        }));

      // Get Optio-specific data
      const repoPodRecords = await db.select().from(repoPods);

      reply.send({
        nodes,
        pods,
        services,
        events,
        repoPods: repoPodRecords,
        summary: {
          totalPods: pods.length,
          runningPods: pods.filter((p) => p.status === "Running").length,
          agentPods: pods.filter((p) => p.isOptioManaged).length,
          infraPods: pods.filter((p) => p.isInfra).length,
          totalNodes: nodes.length,
          readyNodes: nodes.filter((n) => n.status === "Ready").length,
        },
      });
    } catch (err) {
      reply.status(500).send({ error: String(err) });
    }
  });

  // Keep the existing pod detail endpoints
  app.get("/api/cluster/pods", async (_req, reply) => {
    try {
      const pods = await db.select().from(repoPods);
      const podStatuses = await Promise.all(
        pods.map(async (pod) => {
          const recentTasks = await db
            .select({
              id: tasks.id,
              title: tasks.title,
              state: tasks.state,
              agentType: tasks.agentType,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(eq(tasks.repoUrl, pod.repoUrl))
            .orderBy(desc(tasks.createdAt))
            .limit(10);

          return { ...pod, recentTasks };
        }),
      );
      reply.send({ pods: podStatuses });
    } catch (err) {
      reply.status(500).send({ error: String(err) });
    }
  });

  app.get("/api/cluster/pods/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const [pod] = await db.select().from(repoPods).where(eq(repoPods.id, id));
    if (!pod) return reply.status(404).send({ error: "Pod not found" });

    const podTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.repoUrl, pod.repoUrl))
      .orderBy(desc(tasks.createdAt))
      .limit(20);

    // Get K8s pod info if we have a pod name
    let k8sPod = null;
    if (pod.podName) {
      try {
        const api = getK8sApi();
        const p = await api.readNamespacedPod({ name: pod.podName, namespace: NAMESPACE });
        const cs = p.status?.containerStatuses?.[0];
        k8sPod = {
          phase: p.status?.phase,
          status: cs?.state?.waiting?.reason ?? (cs?.state?.running ? "Running" : p.status?.phase),
          ready: cs?.ready,
          restarts: cs?.restartCount,
          image: cs?.image ?? p.spec?.containers?.[0]?.image,
          ip: p.status?.podIP,
          nodeName: p.spec?.nodeName,
          startedAt: cs?.state?.running?.startedAt ?? p.status?.startTime,
          resources: p.spec?.containers?.[0]?.resources,
        };
      } catch {
        k8sPod = null;
      }
    }

    reply.send({ pod: { ...pod, tasks: podTasks, k8sPod } });
  });
}
