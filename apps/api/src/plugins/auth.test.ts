import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ─── Mocks ───

let authDisabled = false;
vi.mock("../services/oauth/index.js", () => ({
  isAuthDisabled: () => authDisabled,
  getEnabledProviders: () => [],
  getOAuthProvider: () => undefined,
}));

vi.mock("../services/session-service.js", () => ({
  validateSession: () => null,
}));

vi.mock("../services/workspace-service.js", () => ({
  getUserRole: () => null,
  ensureUserHasWorkspace: () => "ws-1",
}));

const mockListSecrets = vi.fn();
vi.mock("../services/secret-service.js", () => ({
  listSecrets: (...args: unknown[]) => mockListSecrets(...args),
}));

import { requireRole, isSetupComplete, resetSetupCompleteCache, isPublicRoute } from "./auth.js";

// ─── Helpers ───

function makeUser(role: string | null) {
  return {
    id: "user-1",
    provider: "github",
    email: "test@example.com",
    displayName: "Test",
    avatarUrl: null,
    workspaceId: "ws-1",
    workspaceRole: role,
  };
}

/**
 * Build a Fastify app with a test route protected by requireRole.
 * The `userRole` param sets the workspace role on req.user before the guard runs.
 * Pass `null` to simulate a user with no role.
 * Pass `undefined` to simulate no user at all (auth disabled scenario).
 */
async function buildApp(
  minimumRole: "admin" | "member" | "viewer",
  userRole?: string | null,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Set req.user before the requireRole preHandler
  if (userRole !== undefined) {
    app.addHook("onRequest", async (req) => {
      (req as any).user = makeUser(userRole);
    });
  }

  app.get("/test", { preHandler: [requireRole(minimumRole)] }, async (_req, reply) => {
    reply.send({ ok: true });
  });

  await app.ready();
  return app;
}

function inject(app: FastifyInstance) {
  return app.inject({ method: "GET", url: "/test" });
}

// ─── Tests ───

describe("requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authDisabled = false;
  });

  describe("when auth is disabled", () => {
    it("allows any request regardless of role", async () => {
      authDisabled = true;
      const app = await buildApp("admin"); // no user set
      const res = await inject(app);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });

  describe("requireRole('admin')", () => {
    it("allows admin", async () => {
      const res = await inject(await buildApp("admin", "admin"));
      expect(res.statusCode).toBe(200);
    });

    it("rejects member", async () => {
      const res = await inject(await buildApp("admin", "member"));
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("admin");
    });

    it("rejects viewer", async () => {
      const res = await inject(await buildApp("admin", "viewer"));
      expect(res.statusCode).toBe(403);
    });

    it("rejects null role", async () => {
      const res = await inject(await buildApp("admin", null));
      expect(res.statusCode).toBe(403);
    });
  });

  describe("requireRole('member')", () => {
    it("allows admin", async () => {
      const res = await inject(await buildApp("member", "admin"));
      expect(res.statusCode).toBe(200);
    });

    it("allows member", async () => {
      const res = await inject(await buildApp("member", "member"));
      expect(res.statusCode).toBe(200);
    });

    it("rejects viewer", async () => {
      const res = await inject(await buildApp("member", "viewer"));
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("member");
    });

    it("rejects null role", async () => {
      const res = await inject(await buildApp("member", null));
      expect(res.statusCode).toBe(403);
    });
  });

  describe("requireRole('viewer')", () => {
    it("allows admin", async () => {
      const res = await inject(await buildApp("viewer", "admin"));
      expect(res.statusCode).toBe(200);
    });

    it("allows member", async () => {
      const res = await inject(await buildApp("viewer", "member"));
      expect(res.statusCode).toBe(200);
    });

    it("allows viewer", async () => {
      const res = await inject(await buildApp("viewer", "viewer"));
      expect(res.statusCode).toBe(200);
    });

    it("rejects null role", async () => {
      const res = await inject(await buildApp("viewer", null));
      expect(res.statusCode).toBe(403);
    });
  });
});

describe("isPublicRoute", () => {
  // ─── Non-auth public routes ───

  it("allows /api/health", () => {
    expect(isPublicRoute("/api/health")).toBe(true);
  });

  it("allows /api/setup/status", () => {
    expect(isPublicRoute("/api/setup/status")).toBe(true);
  });

  it("allows /api/webhooks/ prefix", () => {
    expect(isPublicRoute("/api/webhooks/some-id")).toBe(true);
  });

  it("allows /ws/ prefix", () => {
    expect(isPublicRoute("/ws/events")).toBe(true);
  });

  it("allows /api/internal/git-credentials", () => {
    expect(isPublicRoute("/api/internal/git-credentials")).toBe(true);
  });

  // ─── Public auth routes (OAuth flow) ───

  it("allows /api/auth/providers", () => {
    expect(isPublicRoute("/api/auth/providers")).toBe(true);
  });

  it("allows /api/auth/exchange-code", () => {
    expect(isPublicRoute("/api/auth/exchange-code")).toBe(true);
  });

  it("allows /api/auth/github/login", () => {
    expect(isPublicRoute("/api/auth/github/login")).toBe(true);
  });

  it("allows /api/auth/github/callback", () => {
    expect(isPublicRoute("/api/auth/github/callback")).toBe(true);
  });

  it("allows /api/auth/google/login", () => {
    expect(isPublicRoute("/api/auth/google/login")).toBe(true);
  });

  it("allows /api/auth/google/callback", () => {
    expect(isPublicRoute("/api/auth/google/callback")).toBe(true);
  });

  it("allows /api/auth/gitlab/login", () => {
    expect(isPublicRoute("/api/auth/gitlab/login")).toBe(true);
  });

  it("allows /api/auth/gitlab/callback", () => {
    expect(isPublicRoute("/api/auth/gitlab/callback")).toBe(true);
  });

  // ─── Sensitive auth routes that must NOT be public ───

  it("blocks /api/auth/claude-token", () => {
    expect(isPublicRoute("/api/auth/claude-token")).toBe(false);
  });

  it("blocks /api/auth/status", () => {
    expect(isPublicRoute("/api/auth/status")).toBe(false);
  });

  it("blocks /api/auth/usage", () => {
    expect(isPublicRoute("/api/auth/usage")).toBe(false);
  });

  it("blocks /api/auth/me", () => {
    expect(isPublicRoute("/api/auth/me")).toBe(false);
  });

  it("blocks /api/auth/ws-token", () => {
    expect(isPublicRoute("/api/auth/ws-token")).toBe(false);
  });

  it("blocks /api/auth/refresh", () => {
    expect(isPublicRoute("/api/auth/refresh")).toBe(false);
  });

  it("blocks /api/auth/logout", () => {
    expect(isPublicRoute("/api/auth/logout")).toBe(false);
  });

  // ─── Edge cases ───

  it("strips query parameters before matching", () => {
    expect(isPublicRoute("/api/auth/providers?foo=bar")).toBe(true);
    expect(isPublicRoute("/api/auth/claude-token?foo=bar")).toBe(false);
  });

  it("blocks unknown /api/auth/ subpaths", () => {
    expect(isPublicRoute("/api/auth/something-new")).toBe(false);
  });
});

describe("isSetupComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSetupCompleteCache();
  });

  it("returns true when an agent key secret exists", async () => {
    mockListSecrets.mockResolvedValue([{ name: "ANTHROPIC_API_KEY" }]);
    expect(await isSetupComplete()).toBe(true);
  });

  it("returns true for OPENAI_API_KEY", async () => {
    mockListSecrets.mockResolvedValue([{ name: "OPENAI_API_KEY" }]);
    expect(await isSetupComplete()).toBe(true);
  });

  it("returns true for CLAUDE_CODE_OAUTH_TOKEN", async () => {
    mockListSecrets.mockResolvedValue([{ name: "CLAUDE_CODE_OAUTH_TOKEN" }]);
    expect(await isSetupComplete()).toBe(true);
  });

  it("returns true for COPILOT_GITHUB_TOKEN", async () => {
    mockListSecrets.mockResolvedValue([{ name: "COPILOT_GITHUB_TOKEN" }]);
    expect(await isSetupComplete()).toBe(true);
  });

  it("returns false when no agent key secrets exist", async () => {
    mockListSecrets.mockResolvedValue([{ name: "GITHUB_TOKEN" }]);
    expect(await isSetupComplete()).toBe(false);
  });

  it("returns false when secrets list is empty", async () => {
    mockListSecrets.mockResolvedValue([]);
    expect(await isSetupComplete()).toBe(false);
  });

  it("returns false when listSecrets throws", async () => {
    mockListSecrets.mockRejectedValue(new Error("db error"));
    expect(await isSetupComplete()).toBe(false);
  });

  it("caches the result across calls", async () => {
    mockListSecrets.mockResolvedValue([{ name: "ANTHROPIC_API_KEY" }]);
    await isSetupComplete();
    await isSetupComplete();
    expect(mockListSecrets).toHaveBeenCalledTimes(1);
  });

  it("refreshes after cache reset", async () => {
    mockListSecrets.mockResolvedValue([{ name: "ANTHROPIC_API_KEY" }]);
    await isSetupComplete();
    resetSetupCompleteCache();
    mockListSecrets.mockResolvedValue([]);
    expect(await isSetupComplete()).toBe(false);
    expect(mockListSecrets).toHaveBeenCalledTimes(2);
  });
});
