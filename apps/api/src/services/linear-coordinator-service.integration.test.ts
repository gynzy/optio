import { describe, it, expect } from "vitest";
import { buildCoordinatorSystemPrompt } from "./linear-coordinator-service.js";

describe("linear-coordinator integration", () => {
  it("builds a complete system prompt with all context", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [
        { fullName: "org/backend", repoUrl: "https://github.com/org/backend" },
        { fullName: "org/frontend", repoUrl: "https://github.com/org/frontend" },
      ],
      skills: [{ name: "deploy", description: "Run deployment pipeline" }],
      agentPrompt: "You specialize in full-stack web development.",
    });

    // Core instructions present
    expect(prompt).toContain("Linear agent powered by Optio");
    expect(prompt).toContain("identify the correct repository");
    expect(prompt).toContain("ask directly");

    // Repos listed
    expect(prompt).toContain("org/backend");
    expect(prompt).toContain("org/frontend");
    expect(prompt).toContain("Available Repositories");

    // Skills included
    expect(prompt).toContain("deploy");
    expect(prompt).toContain("Run deployment pipeline");
    expect(prompt).toContain("Custom Skills");

    // Agent prompt included under Additional Instructions
    expect(prompt).toContain("full-stack web development");
    expect(prompt).toContain("Additional Instructions");
  });

  it("works with empty context", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [],
    });

    expect(prompt).toContain("Linear agent powered by Optio");
    expect(prompt).not.toContain("Available Repositories");
    expect(prompt).not.toContain("Custom Skills");
    expect(prompt).not.toContain("Additional Instructions");
  });

  it("includes issue context when provided", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [],
      issueIdentifier: "ENG-123",
      issueTitle: "Fix login bug",
      issueDescription: "Users cannot log in after the recent deployment.",
    });

    expect(prompt).toContain("Current Issue");
    expect(prompt).toContain("ENG-123");
    expect(prompt).toContain("Fix login bug");
    expect(prompt).toContain("Users cannot log in after the recent deployment.");
  });

  it("omits issue section when no issue fields are provided", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [],
    });

    expect(prompt).not.toContain("Current Issue");
  });

  it("uses repoUrl as fallback when fullName is null", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [{ fullName: null, repoUrl: "https://github.com/org/myrepo" }],
      skills: [],
    });

    expect(prompt).toContain("https://github.com/org/myrepo");
  });

  it("shows (no description) for skills with null description", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [{ name: "test-skill", description: null }],
    });

    expect(prompt).toContain("test-skill");
    expect(prompt).toContain("(no description)");
  });

  it("includes enriched context labels and sub-issues when present", () => {
    const prompt = buildCoordinatorSystemPrompt({
      repos: [],
      skills: [],
      issueTitle: "Some issue",
      enrichedContext: {
        issue: {
          labels: [
            { id: "lbl-1", name: "bug" },
            { id: "lbl-2", name: "urgent" },
          ],
          children: [
            { identifier: "ENG-43", title: "Sub-task one", url: "https://linear.app/t/ENG-43" },
            { identifier: "ENG-44", title: "Sub-task two", url: "https://linear.app/t/ENG-44" },
          ],
          attachments: [],
        },
      },
    });

    expect(prompt).toContain("bug");
    expect(prompt).toContain("urgent");
    expect(prompt).toContain("ENG-43");
    expect(prompt).toContain("Sub-task one");
    expect(prompt).toContain("ENG-44");
    expect(prompt).toContain("Sub-task two");
  });
});
