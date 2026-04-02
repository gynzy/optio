import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLinearApiService, type LinearApiService } from "./linear-api-service.js";

vi.mock("./secret-service.js", () => ({
  retrieveSecret: vi.fn(async (name: string) => {
    if (name === "LINEAR_API_TOKEN") return "test-token";
    throw new Error(`Secret not found: ${name}`);
  }),
}));

const mockCreateAgentActivity = vi.fn().mockResolvedValue({
  success: true,
  agentActivity: Promise.resolve({ id: "activity-1" }),
});
const mockUpdateAgentSession = vi.fn().mockResolvedValue({ success: true });
const mockIssue = vi.fn();

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    createAgentActivity: mockCreateAgentActivity,
    updateAgentSession: mockUpdateAgentSession,
    issue: mockIssue,
  })),
}));

describe("LinearApiService", () => {
  let service: LinearApiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createLinearApiService();
  });

  describe("createTextActivity", () => {
    it("posts a text activity to Linear", async () => {
      await service.initialize();
      const result = await service.createTextActivity("session-1", "response", "Hello");
      expect(mockCreateAgentActivity).toHaveBeenCalledWith({
        agentSessionId: "session-1",
        content: { type: "response", body: "Hello" },
        ephemeral: undefined,
      });
      expect(result).toBe("activity-1");
    });
  });

  describe("createActionActivity", () => {
    it("posts an action activity to Linear", async () => {
      await service.initialize();
      await service.createActionActivity("session-1", "Creating task", "repo: frontend", "success");
      expect(mockCreateAgentActivity).toHaveBeenCalledWith({
        agentSessionId: "session-1",
        content: {
          type: "action",
          action: "Creating task",
          parameter: "repo: frontend",
          result: "success",
        },
        ephemeral: undefined,
      });
    });
  });

  describe("updateSessionPlan", () => {
    it("updates plan todos on a Linear session", async () => {
      await service.initialize();
      await service.updateSessionPlan("session-1", [
        { content: "Analyze scope", status: "completed" as any },
        { content: "Create backend task", status: "pending" as any },
      ]);
      expect(mockUpdateAgentSession).toHaveBeenCalledWith("session-1", {
        plan: [
          { content: "Analyze scope", status: "completed" },
          { content: "Create backend task", status: "pending" },
        ],
      });
    });
  });

  describe("enrichContext", () => {
    it("fetches labels, children, and attachments for an issue", async () => {
      mockIssue.mockResolvedValue({
        labels: vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] }),
        children: vi.fn().mockResolvedValue({
          nodes: [{ identifier: "ENG-2", title: "Sub-issue", url: "https://linear.app/..." }],
        }),
        attachments: vi.fn().mockResolvedValue({
          nodes: [{ id: "a1", title: "Design", url: "https://figma.com/..." }],
        }),
      });
      await service.initialize();
      const context = await service.enrichContext("issue-1");
      expect(context.issue).toEqual({
        labels: [{ id: "l1", name: "bug" }],
        children: [{ identifier: "ENG-2", title: "Sub-issue", url: "https://linear.app/..." }],
        attachments: [{ id: "a1", title: "Design", url: "https://figma.com/..." }],
      });
    });

    it("returns empty context on failure", async () => {
      mockIssue.mockRejectedValue(new Error("Not found"));
      await service.initialize();
      const context = await service.enrichContext("bad-id");
      expect(context).toEqual({});
    });
  });
});
