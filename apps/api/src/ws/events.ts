import type { FastifyInstance } from "fastify";
import { createSubscriber } from "../services/event-bus.js";

export async function eventsWs(app: FastifyInstance) {
  app.get("/ws/events", { websocket: true }, (socket, _req) => {
    const subscriber = createSubscriber();
    const channel = "optio:events";
    subscriber.subscribe(channel);

    subscriber.on("message", (_ch: string, message: string) => {
      socket.send(message);
    });

    socket.on("close", () => {
      subscriber.unsubscribe(channel);
      subscriber.disconnect();
    });
  });
}
