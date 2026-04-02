import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockGetConfigStatus = vi.fn();
const mockTestConnection = vi.fn();
const mockGetRegistration = vi.fn();
const mockSaveRegistration = vi.fn();
const mockDeleteRegistration = vi.fn();

vi.mock("../services/linear-registration-service.js", () => ({
  getConfigStatus: (...args: unknown[]) => mockGetConfigStatus(...args),
  testConnection: (...args: unknown[]) => mockTestConnection(...args),
  getRegistration: (...args: unknown[]) => mockGetRegistration(...args),
  saveRegistration: (...args: unknown[]) => mockSaveRegistration(...args),
  deleteRegistration: (...args: unknown[]) => mockDeleteRegistration(...args),
}));

import { linearConfigRoutes } from "./linear-config.js";

// ─── Helpers ───

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest("user", undefined as any);
  app.addHook("preHandler", (req, _reply, done) => {
    (req as any).user = { id: "user-1", workspaceId: "ws-1" };
    done();
  });
  await linearConfigRoutes(app);
  await app.ready();
  return app;
}

// ─── Tests ───

describe("GET /api/linear/config", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns config status", async () => {
    mockGetConfigStatus.mockResolvedValue({
      tokenConfigured: true,
      connected: true,
      webhookUrl: "https://example.com/api/linear/webhook",
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/config" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status.tokenConfigured).toBe(true);
    expect(body.status.connected).toBe(true);
    expect(mockGetConfigStatus).toHaveBeenCalledWith(
      expect.stringContaining("/api/linear/webhook"),
    );
  });

  it("returns status when token is not configured", async () => {
    mockGetConfigStatus.mockResolvedValue({
      tokenConfigured: false,
      connected: false,
      webhookUrl: "https://example.com/api/linear/webhook",
    });

    const res = await app.inject({ method: "GET", url: "/api/linear/config" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status.tokenConfigured).toBe(false);
  });
});

describe("POST /api/linear/config/test", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns success when connection works", async () => {
    mockTestConnection.mockResolvedValue(true);

    const res = await app.inject({ method: "POST", url: "/api/linear/config/test" });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("returns failure when connection fails", async () => {
    mockTestConnection.mockResolvedValue(false);

    const res = await app.inject({ method: "POST", url: "/api/linear/config/test" });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
  });
});

describe("GET /api/linear/registration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns the registration when it exists", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", name: "My Agent", enabled: true });

    const res = await app.inject({ method: "GET", url: "/api/linear/registration" });

    expect(res.statusCode).toBe(200);
    expect(res.json().registration.id).toBe("reg-1");
    expect(mockGetRegistration).toHaveBeenCalledWith("ws-1");
  });

  it("returns null when no registration exists", async () => {
    mockGetRegistration.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/linear/registration" });

    expect(res.statusCode).toBe(200);
    expect(res.json().registration).toBeNull();
  });
});

describe("PUT /api/linear/registration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("creates or updates the registration", async () => {
    mockSaveRegistration.mockResolvedValue({ id: "reg-1", name: "My Agent", enabled: true });

    const res = await app.inject({
      method: "PUT",
      url: "/api/linear/registration",
      payload: {
        name: "My Agent",
        oauthClientId: "client-abc",
        webhookSecret: "secret-xyz",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().registration.id).toBe("reg-1");
    expect(mockSaveRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Agent",
        oauthClientId: "client-abc",
        webhookSecret: "secret-xyz",
      }),
      "ws-1",
    );
  });

  it("returns 500 when name is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/linear/registration",
      payload: { oauthClientId: "client-abc", webhookSecret: "secret-xyz" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when oauthClientId is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/linear/registration",
      payload: { name: "My Agent", webhookSecret: "secret-xyz" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 500 when webhookSecret is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/linear/registration",
      payload: { name: "My Agent", oauthClientId: "client-abc" },
    });

    expect(res.statusCode).toBe(500);
  });
});

describe("DELETE /api/linear/registration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("deletes the registration and returns 204", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-1" });
    mockDeleteRegistration.mockResolvedValue(true);

    const res = await app.inject({ method: "DELETE", url: "/api/linear/registration" });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteRegistration).toHaveBeenCalledWith("reg-1");
  });

  it("returns 404 when no registration exists", async () => {
    mockGetRegistration.mockResolvedValue(null);

    const res = await app.inject({ method: "DELETE", url: "/api/linear/registration" });

    expect(res.statusCode).toBe(404);
  });
});
