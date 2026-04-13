import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRouteTestApp } from "../test-utils/build-route-test-app.js";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockListActions = vi.fn();

const mockListNamespacedPod = vi.fn().mockResolvedValue({ items: [] });

vi.mock("@kubernetes/client-node", () => ({
  KubeConfig: vi.fn().mockImplementation(() => ({
    loadFromDefault: vi.fn(),
    makeApiClient: vi.fn(() => ({
      listNamespacedPod: mockListNamespacedPod,
    })),
  })),
  CoreV1Api: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/optio-action-service.js", () => ({
  listActions: (...args: unknown[]) => mockListActions(...args),
}));

import { optioRoutes } from "./optio.js";

// ─── Helpers ───

async function buildTestApp(): Promise<FastifyInstance> {
  return buildRouteTestApp(optioRoutes);
}

describe("GET /api/optio/actions", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns paginated actions", async () => {
    const actions = [
      {
        id: "a1",
        userId: "u1",
        action: "retry_task",
        params: { id: "task-1" },
        result: { retried: true },
        success: true,
        conversationSnippet: "retry task-1",
        createdAt: "2026-03-28T10:00:00.000Z",
        user: { id: "u1", displayName: "Alice", avatarUrl: null },
      },
    ];
    mockListActions.mockResolvedValue({ actions, total: 1 });

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
      query: { limit: "10", offset: "0" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actions).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.actions[0].action).toBe("retry_task");
    expect(body.actions[0].user.displayName).toBe("Alice");
  });

  it("passes filters to the service", async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0 });

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
      query: {
        userId: "550e8400-e29b-41d4-a716-446655440000",
        action: "cancel_task",
        success: "false",
        limit: "25",
        offset: "10",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockListActions).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "550e8400-e29b-41d4-a716-446655440000",
        action: "cancel_task",
        success: false,
        limit: 25,
        offset: 10,
      }),
    );
  });

  it("applies default pagination values", async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0 });

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
    });

    expect(res.statusCode).toBe(200);
    expect(mockListActions).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("returns 400 for invalid userId format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
      query: { userId: "not-a-uuid" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeDefined();
  });

  it("returns 500 when service throws", async () => {
    mockListActions.mockRejectedValue(new Error("DB connection failed"));

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("Failed to fetch optio actions");
  });

  it("supports date range filtering", async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0 });

    const res = await app.inject({
      method: "GET",
      url: "/api/optio/actions",
      query: {
        after: "2026-03-01T00:00:00Z",
        before: "2026-03-28T23:59:59Z",
      },
    });

    expect(res.statusCode).toBe(200);
    const call = mockListActions.mock.calls[0][0];
    expect(call.after).toBeInstanceOf(Date);
    expect(call.before).toBeInstanceOf(Date);
  });
});
