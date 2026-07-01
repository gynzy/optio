import { describe, it, expect, vi, beforeEach } from "vitest";

const addMock = vi.fn();
const closeMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation((name: string) => ({
    name,
    add: (...args: unknown[]) => addMock(name, ...args),
    close: closeMock,
  })),
}));

vi.mock("./redis-config.js", () => ({
  getBullMQConnectionOptions: vi.fn().mockReturnValue({}),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { REPEATABLE_JOBS, ensureRepeatJobs } from "./repeatable-jobs.js";

describe("ensureRepeatJobs", () => {
  beforeEach(() => {
    addMock.mockReset().mockResolvedValue(undefined);
    closeMock.mockReset().mockResolvedValue(undefined);
  });

  it("registers exactly the REPEATABLE_JOBS entries with correct repeat options", async () => {
    await ensureRepeatJobs();

    expect(addMock).toHaveBeenCalledTimes(REPEATABLE_JOBS.length);
    for (const job of REPEATABLE_JOBS) {
      expect(addMock).toHaveBeenCalledWith(
        job.queueName,
        job.jobName,
        {},
        { repeat: { every: job.every } },
      );
    }
  });

  it("closes a queue for every entry", async () => {
    await ensureRepeatJobs();
    expect(closeMock).toHaveBeenCalledTimes(REPEATABLE_JOBS.length);
  });

  it("shares a single in-flight run across concurrent calls", async () => {
    const first = ensureRepeatJobs();
    const second = ensureRepeatJobs();

    expect(first).toBe(second);

    await Promise.all([first, second]);

    // One registration pass ran, not two — adds called once per entry.
    expect(addMock).toHaveBeenCalledTimes(REPEATABLE_JOBS.length);
  });
});
