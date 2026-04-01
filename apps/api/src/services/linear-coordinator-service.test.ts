import { describe, it, expect } from "vitest";
import {
  buildCoordinatorSystemPrompt,
  type CoordinatorPromptContext,
} from "./linear-coordinator-service.js";

describe("buildCoordinatorSystemPrompt", () => {
  it("returns base prompt with no context", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [],
      skills: [],
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("You are a Linear agent powered by Optio");
    expect(prompt).toContain("## How you work");
    expect(prompt).toContain("## Guidelines");
    expect(prompt).not.toContain("## Available Repositories");
    expect(prompt).not.toContain("## Custom Skills");
    expect(prompt).not.toContain("## Additional Instructions");
    expect(prompt).not.toContain("## Current Issue");
  });

  it("includes repos when provided", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [
        { repoUrl: "https://github.com/acme/web", fullName: "acme/web" },
        { repoUrl: "https://github.com/acme/api", fullName: null },
      ],
      skills: [],
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("## Available Repositories");
    expect(prompt).toContain("acme/web");
    expect(prompt).toContain("https://github.com/acme/api");
  });

  it("includes skills when provided", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [],
      skills: [
        { name: "deploy", description: "Deploy to production" },
        { name: "lint", description: null },
      ],
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("## Custom Skills");
    expect(prompt).toContain("**deploy**: Deploy to production");
    expect(prompt).toContain("**lint**: (no description)");
  });

  it("includes agent prompt when provided", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [],
      skills: [],
      agentPrompt: "Always use TypeScript.",
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("## Additional Instructions");
    expect(prompt).toContain("Always use TypeScript.");
  });

  it("includes issue context when provided", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [],
      skills: [],
      issueTitle: "Fix the login bug",
      issueDescription: "Users cannot log in with SSO",
      issueIdentifier: "ENG-123",
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("## Current Issue");
    expect(prompt).toContain("ENG-123");
    expect(prompt).toContain("Fix the login bug");
    expect(prompt).toContain("Users cannot log in with SSO");
  });

  it("includes enriched context labels and children", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [],
      skills: [],
      issueTitle: "Parent issue",
      enrichedContext: {
        issue: {
          labels: [
            { id: "1", name: "bug" },
            { id: "2", name: "urgent" },
          ],
          children: [{ identifier: "ENG-124", title: "Sub-task A", url: "https://linear.app/..." }],
          attachments: [],
        },
      },
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("Labels: bug, urgent");
    expect(prompt).toContain("ENG-124: Sub-task A");
  });

  it("combines all sections correctly", () => {
    const ctx: CoordinatorPromptContext = {
      repos: [{ repoUrl: "https://github.com/acme/web", fullName: "acme/web" }],
      skills: [{ name: "deploy", description: "Deploy" }],
      agentPrompt: "Be thorough.",
      issueTitle: "Improve perf",
      issueIdentifier: "ENG-100",
    };
    const prompt = buildCoordinatorSystemPrompt(ctx);
    expect(prompt).toContain("## Available Repositories");
    expect(prompt).toContain("## Custom Skills");
    expect(prompt).toContain("## Additional Instructions");
    expect(prompt).toContain("## Current Issue");
  });
});

describe("acquireLock", () => {
  it("is exported as a function", async () => {
    const { acquireLock } = await import("./linear-coordinator-service.js");
    expect(typeof acquireLock).toBe("function");
  });
});

describe("handleWebhook", () => {
  it("is exported as a function", async () => {
    const { handleWebhook } = await import("./linear-coordinator-service.js");
    expect(typeof handleWebhook).toBe("function");
  });
});

describe("stopSession", () => {
  it("is exported as a function", async () => {
    const { stopSession } = await import("./linear-coordinator-service.js");
    expect(typeof stopSession).toBe("function");
  });
});

describe("markSessionsInterrupted", () => {
  it("is exported as a function", async () => {
    const { markSessionsInterrupted } = await import("./linear-coordinator-service.js");
    expect(typeof markSessionsInterrupted).toBe("function");
  });
});

describe("recoverInterruptedSessions", () => {
  it("is exported as a function", async () => {
    const { recoverInterruptedSessions } = await import("./linear-coordinator-service.js");
    expect(typeof recoverInterruptedSessions).toBe("function");
  });
});
