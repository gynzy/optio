import { describe, it, expect, vi, beforeEach } from "vitest";

const { MockLinearClient } = vi.hoisted(() => {
  const MockLinearClient = vi.fn().mockImplementation(() => ({
    viewer: Promise.resolve({ id: "user-1", name: "Test User" }),
  }));
  return { MockLinearClient };
});

vi.mock("../db/client.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  linearAgentRegistrations: {
    id: "linear_agent_registrations.id",
    oauthClientId: "linear_agent_registrations.oauth_client_id",
    workspaceId: "linear_agent_registrations.workspace_id",
  },
  customSkills: { scope: "custom_skills.scope" },
  mcpServers: { scope: "mcp_servers.scope" },
}));

vi.mock("./secret-service.js", () => ({
  encrypt: vi.fn(() => ({
    encrypted: Buffer.from("enc"),
    iv: Buffer.from("iv"),
    authTag: Buffer.from("tag"),
  })),
  decrypt: vi.fn(() => "plain-secret"),
  retrieveSecret: vi.fn(async (name: string) => {
    if (name === "LINEAR_API_TOKEN") return "test-linear-token";
    throw new Error(`Secret not found: ${name}`);
  }),
}));

vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("@linear/sdk", () => ({
  LinearClient: MockLinearClient,
}));

import { db } from "../db/client.js";
import { encrypt, decrypt, retrieveSecret } from "./secret-service.js";
import {
  getRegistration,
  getRegistrationByClientId,
  saveRegistration,
  deleteRegistration,
  testConnection,
  getConfigStatus,
} from "./linear-registration-service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseRow = {
  id: "reg-1",
  name: "My App",
  oauthClientId: "client-abc",
  encryptedWebhookSecret: Buffer.from("enc"),
  secretIv: Buffer.from("iv"),
  secretAuthTag: Buffer.from("tag"),
  systemPrompt: "You are a helpful agent.",
  selectedSkillIds: [] as string[],
  selectedMcpServerIds: [] as string[],
  marketplacePlugins: [] as string[],
  enabled: true,
  workspaceId: "ws-1",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();

  // Re-apply default mock implementations after clearAllMocks
  (encrypt as ReturnType<typeof vi.fn>).mockReturnValue({
    encrypted: Buffer.from("enc"),
    iv: Buffer.from("iv"),
    authTag: Buffer.from("tag"),
  });
  (decrypt as ReturnType<typeof vi.fn>).mockReturnValue("plain-secret");
  (retrieveSecret as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => {
    if (name === "LINEAR_API_TOKEN") return "test-linear-token";
    throw new Error(`Secret not found: ${name}`);
  });
  MockLinearClient.mockImplementation(() => ({
    viewer: Promise.resolve({ id: "user-1", name: "Test User" }),
  }));
});

// ── getRegistration ─────────────────────────────────────────────────────────

describe("getRegistration", () => {
  it("returns null when no registration exists", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await getRegistration();
    expect(result).toBeNull();
  });

  it("returns the single registration without webhook secret", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([baseRow]),
        }),
      }),
    });

    const result = await getRegistration();
    expect(result).not.toBeNull();
    expect(result!.id).toBe("reg-1");
    expect(result!.name).toBe("My App");
    expect(result).not.toHaveProperty("webhookSecret");
    expect(result).not.toHaveProperty("encryptedWebhookSecret");
  });

  it("filters by workspaceId when provided", async () => {
    const mockLimit = vi.fn().mockResolvedValue([baseRow]);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const result = await getRegistration("ws-1");
    expect(result).not.toBeNull();
    expect(mockWhere).toHaveBeenCalled();
  });
});

// ── getRegistrationByClientId ───────────────────────────────────────────────

describe("getRegistrationByClientId", () => {
  it("returns null when not found", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await getRegistrationByClientId("unknown-client");
    expect(result).toBeNull();
  });

  it("decrypts and returns webhook secret when found", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([baseRow]),
      }),
    });

    const result = await getRegistrationByClientId("client-abc");

    expect(result).not.toBeNull();
    expect(result!.webhookSecret).toBe("plain-secret");
    expect(decrypt).toHaveBeenCalledWith(Buffer.from("enc"), Buffer.from("iv"), Buffer.from("tag"));
  });
});

// ── saveRegistration ────────────────────────────────────────────────────────

describe("saveRegistration", () => {
  function mockSelectChain(rows: any[]) {
    const mockLimit = vi.fn().mockResolvedValue(rows);
    const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        orderBy: mockOrderBy,
      }),
    });
  }

  it("creates a new registration when none exists", async () => {
    mockSelectChain([]);

    (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseRow]),
      }),
    });

    const result = await saveRegistration(
      {
        name: "My App",
        oauthClientId: "client-abc",
        webhookSecret: "plain-secret",
        systemPrompt: "You are a helpful agent.",
      },
      "ws-1",
    );

    expect(encrypt).toHaveBeenCalledWith("plain-secret");
    expect(db.insert).toHaveBeenCalled();
    expect(result).toMatchObject({ id: "reg-1", name: "My App" });
    expect(result).not.toHaveProperty("webhookSecret");
  });

  it("updates the existing registration when one exists", async () => {
    mockSelectChain([baseRow]);

    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...baseRow, name: "Updated App" }]),
        }),
      }),
    });

    const result = await saveRegistration(
      {
        name: "Updated App",
        oauthClientId: "client-abc",
        webhookSecret: "new-secret",
      },
      "ws-1",
    );

    expect(encrypt).toHaveBeenCalledWith("new-secret");
    expect(db.update).toHaveBeenCalled();
    expect(result.name).toBe("Updated App");
  });
});

// ── deleteRegistration ──────────────────────────────────────────────────────

describe("deleteRegistration", () => {
  it("deletes agent-scoped skills, MCP servers, and the registration", async () => {
    (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([baseRow]),
      }),
    });

    const deleted = await deleteRegistration("reg-1");

    // delete called three times: skills, mcp servers, registration
    expect(db.delete).toHaveBeenCalledTimes(3);
    expect(deleted).toBe(true);
  });

  it("returns false when registration not found", async () => {
    let callCount = 0;
    (db.delete as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(callCount++ < 2 ? [] : []),
      }),
    }));

    const deleted = await deleteRegistration("missing");
    expect(deleted).toBe(false);
  });
});

// ── testConnection ──────────────────────────────────────────────────────────

describe("testConnection", () => {
  it("returns true when LINEAR_API_TOKEN is valid and viewer resolves", async () => {
    const result = await testConnection();

    expect(retrieveSecret).toHaveBeenCalledWith("LINEAR_API_TOKEN");
    expect(MockLinearClient).toHaveBeenCalledWith({ apiKey: "test-linear-token" });
    expect(result).toBe(true);
  });

  it("returns false when LINEAR_API_TOKEN is not configured", async () => {
    (retrieveSecret as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Secret not found: LINEAR_API_TOKEN"),
    );

    const result = await testConnection();
    expect(result).toBe(false);
  });

  it("returns false when the Linear API call fails", async () => {
    MockLinearClient.mockImplementationOnce(() => ({
      viewer: Promise.reject(new Error("Unauthorized")),
    }));

    const result = await testConnection();
    expect(result).toBe(false);
  });

  it("returns false when retrieveSecret returns null", async () => {
    (retrieveSecret as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await testConnection();
    expect(result).toBe(false);
  });
});

// ── getConfigStatus ─────────────────────────────────────────────────────────

describe("getConfigStatus", () => {
  it("returns all true when token is set and connection works", async () => {
    const status = await getConfigStatus("https://example.com/webhooks/linear");

    expect(status.tokenConfigured).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.webhookUrl).toBe("https://example.com/webhooks/linear");
  });

  it("returns tokenConfigured=false and connected=false when token retrieval throws", async () => {
    (retrieveSecret as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

    const status = await getConfigStatus("https://example.com/webhooks/linear");

    expect(status.tokenConfigured).toBe(false);
    expect(status.connected).toBe(false);
  });

  it("returns tokenConfigured=true and connected=false when Linear API rejects", async () => {
    MockLinearClient.mockImplementationOnce(() => ({
      viewer: Promise.reject(new Error("Unauthorized")),
    }));

    const status = await getConfigStatus("https://example.com/webhooks/linear");

    expect(status.tokenConfigured).toBe(true);
    expect(status.connected).toBe(false);
  });
});
