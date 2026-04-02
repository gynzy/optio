import { describe, it, expect } from "vitest";
import {
  formatActionForLinear,
  formatResultForLinear,
  formatGreeting,
  getStopConfirmation,
  getBusyMessage,
  getAlreadyLockedMessage,
  getInterruptionNotice,
  getResumeGreeting,
  formatTerminationError,
} from "./linear-personality.js";

describe("linear-personality", () => {
  describe("formatActionForLinear", () => {
    it("formats create_task as a readable action", () => {
      const result = formatActionForLinear("create_task", {
        title: "Fix auth bug",
        repoUrl: "https://github.com/org/backend",
      });
      expect(result.action).toBe("Creating task");
      expect(result.parameter).toContain("Fix auth bug");
    });

    it("formats list_repos as a readable action", () => {
      const result = formatActionForLinear("list_repos", {});
      expect(result.action).toBe("Checking repositories");
    });

    it("formats list_tasks as a readable action", () => {
      const result = formatActionForLinear("list_tasks", { state: "running" });
      expect(result.action).toBe("Listing tasks");
    });

    it("formats cancel_task as a readable action", () => {
      const result = formatActionForLinear("cancel_task", { taskId: "abc" });
      expect(result.action).toBe("Cancelling task");
    });

    it("falls back to tool name for unknown tools", () => {
      const result = formatActionForLinear("unknown_tool", { foo: "bar" });
      expect(result.action).toBe("unknown_tool");
    });

    it("truncates parameter to 200 chars", () => {
      const longTitle = "A".repeat(300);
      const result = formatActionForLinear("create_task", { title: longTitle });
      expect(result.parameter.length).toBeLessThanOrEqual(200);
    });
  });

  describe("formatResultForLinear", () => {
    it("returns truncated string for long results", () => {
      const long = "B".repeat(600);
      const result = formatResultForLinear("list_tasks", long);
      expect(result!.length).toBeLessThanOrEqual(503);
    });

    it("returns error prefix for errors", () => {
      const result = formatResultForLinear("create_task", "not found", true);
      expect(result).toBe("Error: not found");
    });

    it("returns undefined for null/undefined results", () => {
      expect(formatResultForLinear("list_tasks", undefined)).toBeUndefined();
      expect(formatResultForLinear("list_tasks", null)).toBeUndefined();
    });
  });

  describe("user-facing messages", () => {
    it("formatGreeting includes a greeting", () => {
      const msg = formatGreeting("Alice");
      expect(msg).toContain("Alice");
    });

    it("getStopConfirmation returns a message", () => {
      expect(getStopConfirmation()).toBeTruthy();
    });

    it("getBusyMessage returns a message", () => {
      expect(getBusyMessage()).toBeTruthy();
    });

    it("getAlreadyLockedMessage returns a message", () => {
      expect(getAlreadyLockedMessage()).toBeTruthy();
    });

    it("getInterruptionNotice returns a message", () => {
      expect(getInterruptionNotice()).toBeTruthy();
    });

    it("getResumeGreeting returns a message", () => {
      expect(getResumeGreeting()).toBeTruthy();
    });
  });

  describe("formatTerminationError", () => {
    it("formats max turns error", () => {
      const msg = formatTerminationError("max_turns");
      expect(msg).toContain("maximum");
    });

    it("formats generic error", () => {
      const msg = formatTerminationError("unknown");
      expect(msg).toBeTruthy();
    });
  });
});
