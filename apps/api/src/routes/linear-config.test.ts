import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

const mockGetConfigStatus = vi.fn();
const mockTestConnection = vi.fn();
const mockListRegistrations = vi.fn();
const mockGetRegistration = vi.fn();
const mockCreateRegistration = vi.fn();
const mockUpdateRegistration = vi.fn();
const mockDeleteRegistration = vi.fn();

vi.mock("../services/linear-registration-service.js", () => ({
  getConfigStatus: (...args: unknown[]) => mockGetConfigStatus(...args),
  testConnection: (...args: unknown[]) => mockTestConnection(...args),
  listRegistrations: (...args: unknown[]) => mockListRegistrations(...args),
  getRegistration: (...args: unknown[]) => mockGetRegistration(...args),
  createRegistration: (...args: unknown[]) => mockCreateRegistration(...args),
  updateRegistration: (...args: unknown[]) => mockUpdateRegistration(...args),
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

describe("GET /api/linear/registrations", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns list of registrations", async () => {
    mockListRegistrations.mockResolvedValue([
      { id: "reg-1", name: "My Agent", enabled: true },
      { id: "reg-2", name: "Another Agent", enabled: false },
    ]);

    const res = await app.inject({ method: "GET", url: "/api/linear/registrations" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.registrations).toHaveLength(2);
    expect(mockListRegistrations).toHaveBeenCalledWith("ws-1");
  });

  it("returns empty list when no registrations exist", async () => {
    mockListRegistrations.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/linear/registrations" });

    expect(res.statusCode).toBe(200);
    expect(res.json().registrations).toHaveLength(0);
  });
});

describe("GET /api/linear/registrations/:id", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("returns a single registration", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", name: "My Agent", workspaceId: "ws-1" });

    const res = await app.inject({ method: "GET", url: "/api/linear/registrations/reg-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().registration.id).toBe("reg-1");
  });

  it("returns 404 for nonexistent registration", async () => {
    mockGetRegistration.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/linear/registrations/nonexistent" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for registration from another workspace", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-other" });

    const res = await app.inject({ method: "GET", url: "/api/linear/registrations/reg-1" });

    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/linear/registrations", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("creates a registration", async () => {
    mockCreateRegistration.mockResolvedValue({ id: "reg-1", name: "My Agent", enabled: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/linear/registrations",
      payload: {
        name: "My Agent",
        oauthClientId: "client-abc",
        webhookSecret: "secret-xyz",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().registration.id).toBe("reg-1");
    expect(mockCreateRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Agent",
        oauthClientId: "client-abc",
        webhookSecret: "secret-xyz",
      }),
      "ws-1",
    );
  });

  it("returns 400 when name is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/linear/registrations",
      payload: { oauthClientId: "client-abc", webhookSecret: "secret-xyz" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 400 when oauthClientId is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/linear/registrations",
      payload: { name: "My Agent", webhookSecret: "secret-xyz" },
    });

    expect(res.statusCode).toBe(500);
  });

  it("returns 400 when webhookSecret is missing (Zod throws)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/linear/registrations",
      payload: { name: "My Agent", oauthClientId: "client-abc" },
    });

    expect(res.statusCode).toBe(500);
  });
});

describe("PATCH /api/linear/registrations/:id", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("updates a registration", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-1" });
    mockUpdateRegistration.mockResolvedValue({ id: "reg-1", enabled: false });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/linear/registrations/reg-1",
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().registration.enabled).toBe(false);
  });

  it("returns 404 for nonexistent registration", async () => {
    mockGetRegistration.mockResolvedValue(null);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/linear/registrations/nonexistent",
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for registration from another workspace", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-other" });

    const res = await app.inject({
      method: "PATCH",
      url: "/api/linear/registrations/reg-1",
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/linear/registrations/:id", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it("deletes a registration and returns 204", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-1" });
    mockDeleteRegistration.mockResolvedValue(true);

    const res = await app.inject({ method: "DELETE", url: "/api/linear/registrations/reg-1" });

    expect(res.statusCode).toBe(204);
    expect(mockDeleteRegistration).toHaveBeenCalledWith("reg-1");
  });

  it("returns 404 for nonexistent registration", async () => {
    mockGetRegistration.mockResolvedValue(null);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/linear/registrations/nonexistent",
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for registration from another workspace", async () => {
    mockGetRegistration.mockResolvedValue({ id: "reg-1", workspaceId: "ws-other" });

    const res = await app.inject({ method: "DELETE", url: "/api/linear/registrations/reg-1" });

    expect(res.statusCode).toBe(404);
  });
});
