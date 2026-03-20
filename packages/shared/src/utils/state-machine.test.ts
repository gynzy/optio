import { describe, it, expect } from "vitest";
import { canTransition, transition, isTerminal, getValidTransitions, InvalidTransitionError } from "./state-machine.js";
import { TaskState } from "../types/task.js";

describe("state-machine", () => {
  describe("canTransition", () => {
    it("allows valid transitions", () => {
      expect(canTransition(TaskState.PENDING, TaskState.QUEUED)).toBe(true);
      expect(canTransition(TaskState.QUEUED, TaskState.PROVISIONING)).toBe(true);
      expect(canTransition(TaskState.PROVISIONING, TaskState.RUNNING)).toBe(true);
      expect(canTransition(TaskState.RUNNING, TaskState.PR_OPENED)).toBe(true);
      expect(canTransition(TaskState.RUNNING, TaskState.FAILED)).toBe(true);
      expect(canTransition(TaskState.FAILED, TaskState.QUEUED)).toBe(true);
    });

    it("rejects invalid transitions", () => {
      expect(canTransition(TaskState.PENDING, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.COMPLETED, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.FAILED, TaskState.RUNNING)).toBe(false);
      expect(canTransition(TaskState.FAILED, TaskState.PROVISIONING)).toBe(false);
    });
  });

  describe("transition", () => {
    it("returns the target state on valid transition", () => {
      expect(transition(TaskState.PENDING, TaskState.QUEUED)).toBe(TaskState.QUEUED);
    });

    it("throws InvalidTransitionError on invalid transition", () => {
      expect(() => transition(TaskState.FAILED, TaskState.PROVISIONING)).toThrow(InvalidTransitionError);
    });
  });

  describe("isTerminal", () => {
    it("identifies terminal states", () => {
      expect(isTerminal(TaskState.COMPLETED)).toBe(true);
    });

    it("identifies non-terminal states", () => {
      expect(isTerminal(TaskState.RUNNING)).toBe(false);
      expect(isTerminal(TaskState.FAILED)).toBe(false);
      expect(isTerminal(TaskState.QUEUED)).toBe(false);
    });
  });

  describe("getValidTransitions", () => {
    it("returns correct transitions for running state", () => {
      const valid = getValidTransitions(TaskState.RUNNING);
      expect(valid).toContain(TaskState.PR_OPENED);
      expect(valid).toContain(TaskState.NEEDS_ATTENTION);
      expect(valid).toContain(TaskState.FAILED);
      expect(valid).toContain(TaskState.CANCELLED);
      expect(valid).not.toContain(TaskState.QUEUED);
    });

    it("returns empty array for terminal state", () => {
      expect(getValidTransitions(TaskState.COMPLETED)).toEqual([]);
    });
  });
});
