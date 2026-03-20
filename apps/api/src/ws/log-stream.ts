import type { FastifyInstance } from "fastify";
import { createSubscriber } from "../services/event-bus.js";

export async function logStreamWs(app: FastifyInstance) {
  app.get("/ws/logs/:taskId", { websocket: true }, (socket, req) => {
    const { taskId } = req.params as { taskId: string };
    const subscriber = createSubscriber();

    const channel = `optio:task:${taskId}`;
    subscriber.subscribe(channel);

    subscriber.on("message", (_ch: string, message: string) => {
      try {
        const event = JSON.parse(message);
        if (event.type === "task:log" || event.type === "task:state_changed") {
          socket.send(message);
        }
      } catch {
        // ignore parse errors
      }
    });

    socket.on("close", () => {
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    });
  });
}
