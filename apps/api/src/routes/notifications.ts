import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as notificationService from "../services/notification-service.js";
import { ErrorResponseSchema } from "../schemas/common.js";
import {
  NotificationSubscriptionSchema,
  NotificationPreferencesSchema,
} from "../schemas/workspace.js";

const subscribeSchema = z
  .object({
    endpoint: z.string().url().describe("Push service endpoint URL"),
    keys: z
      .object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      })
      .describe("Web push keys"),
    userAgent: z.string().optional(),
  })
  .describe("Body for registering a push subscription");

const unsubscribeSchema = z
  .object({
    endpoint: z.string().url().describe("Push service endpoint URL to unregister"),
  })
  .describe("Body for removing a push subscription");

const preferencesSchema = z
  .record(z.string(), z.object({ push: z.boolean() }))
  .describe("Map of event-type → { push: boolean }");

const VapidKeyResponseSchema = z.object({ publicKey: z.string() });
const OkResponseSchema = z.object({ ok: z.boolean() });
const SubscriptionsResponseSchema = z.object({
  subscriptions: z.array(NotificationSubscriptionSchema),
});
const PreferencesResponseSchema = z.object({ preferences: NotificationPreferencesSchema });
const TestResponseSchema = z.object({ sent: z.number().int() });

export async function notificationRoutes(rawApp: FastifyInstance) {
  const app = rawApp.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/notifications/vapid-public-key",
    {
      schema: {
        operationId: "getVapidPublicKey",
        summary: "Get the VAPID public key",
        description:
          "Return the server's VAPID public key so browsers can subscribe to " +
          "web push notifications. Returns 503 if VAPID keys are not configured. " +
          "This endpoint is public — no authentication required.",
        tags: ["Workspaces"],
        security: [],
        response: { 200: VapidKeyResponseSchema, 503: ErrorResponseSchema },
      },
    },
    async (_req, reply) => {
      const publicKey = notificationService.getVapidPublicKey();
      if (!publicKey) {
        return reply.status(503).send({ error: "Push notifications not configured" });
      }
      return reply.send({ publicKey });
    },
  );

  app.post(
    "/api/notifications/subscribe",
    {
      schema: {
        operationId: "subscribeToPushNotifications",
        summary: "Register a push subscription",
        description: "Register a browser's push subscription for the authenticated user.",
        tags: ["Workspaces"],
        body: subscribeSchema,
        response: { 201: OkResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      await notificationService.subscribe(userId, req.body, req.body.userAgent);
      return reply.status(201).send({ ok: true });
    },
  );

  app.delete(
    "/api/notifications/subscribe",
    {
      schema: {
        operationId: "unsubscribeFromPushNotifications",
        summary: "Remove a push subscription",
        description: "Remove a previously-registered push subscription. Returns 204 on success.",
        tags: ["Workspaces"],
        body: unsubscribeSchema,
        response: { 204: z.null(), 401: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      await notificationService.unsubscribe(userId, req.body.endpoint);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/api/notifications/subscriptions",
    {
      schema: {
        operationId: "listPushSubscriptions",
        summary: "List my push subscriptions",
        description: "Return all push subscriptions for the authenticated user.",
        tags: ["Workspaces"],
        response: { 200: SubscriptionsResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      const subscriptions = await notificationService.listSubscriptions(userId);
      return reply.send({ subscriptions });
    },
  );

  app.get(
    "/api/notifications/preferences",
    {
      schema: {
        operationId: "getNotificationPreferences",
        summary: "Get notification preferences",
        description: "Return the authenticated user's per-event-type notification preferences.",
        tags: ["Workspaces"],
        response: { 200: PreferencesResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      const preferences = await notificationService.getPreferences(userId);
      return reply.send({ preferences });
    },
  );

  app.put(
    "/api/notifications/preferences",
    {
      schema: {
        operationId: "updateNotificationPreferences",
        summary: "Update notification preferences",
        description: "Update the authenticated user's notification preferences.",
        tags: ["Workspaces"],
        body: preferencesSchema,
        response: { 200: PreferencesResponseSchema, 401: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      const preferences = await notificationService.updatePreferences(userId, req.body);
      return reply.send({ preferences });
    },
  );

  app.post(
    "/api/notifications/test",
    {
      schema: {
        operationId: "sendTestNotification",
        summary: "Send a test push notification",
        description:
          "Deliver a test push notification to every subscription registered " +
          "by the caller. Returns 503 if VAPID is not configured.",
        tags: ["Workspaces"],
        response: {
          200: TestResponseSchema,
          401: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const userId = req.user?.id;
      if (!userId) return reply.status(401).send({ error: "Authentication required" });

      if (!notificationService.isVapidConfigured()) {
        return reply.status(503).send({ error: "Push notifications not configured" });
      }

      const sent = await notificationService.sendTestNotification(userId);
      return reply.send({ sent });
    },
  );
}
