import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const handlers: Record<string, (...args: unknown[]) => void> = {};
const quitMock = vi.fn().mockResolvedValue("OK");

const mockRedis = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    handlers[event] = cb;
    return mockRedis;
  }),
  quit: quitMock,
};

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => mockRedis),
}));

vi.mock("./redis-config.js", () => ({
  redisConnectionUrl: "redis://localhost:6379",
  redisTlsOptions: undefined,
}));

const ensureRepeatJobsMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./repeatable-jobs.js", () => ({
  ensureRepeatJobs: (...args: unknown[]) => ensureRepeatJobsMock(...args),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { startRepeatJobMonitor, stopRepeatJobMonitor } from "./repeat-job-monitor.js";

describe("repeat-job-monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ensureRepeatJobsMock.mockClear();
    for (const key of Object.keys(handlers)) delete handlers[key];
  });

  afterEach(async () => {
    await stopRepeatJobMonitor();
    vi.useRealTimers();
  });

  it("ignores the first ready (initial connect)", () => {
    startRepeatJobMonitor();
    handlers.ready();
    vi.advanceTimersByTime(5000);
    expect(ensureRepeatJobsMock).not.toHaveBeenCalled();
  });

  it("re-registers jobs on a reconnect (later ready), after debounce", () => {
    startRepeatJobMonitor();
    handlers.ready(); // initial connect
    handlers.ready(); // reconnect

    expect(ensureRepeatJobsMock).not.toHaveBeenCalled(); // debounce not elapsed
    vi.advanceTimersByTime(2000);
    expect(ensureRepeatJobsMock).toHaveBeenCalledTimes(1);
  });

  it("debounces a burst of reconnects into a single re-registration", () => {
    startRepeatJobMonitor();
    handlers.ready(); // initial connect
    handlers.ready();
    handlers.ready();
    handlers.ready();

    vi.advanceTimersByTime(2000);
    expect(ensureRepeatJobsMock).toHaveBeenCalledTimes(1);
  });

  it("stop quits the connection", async () => {
    startRepeatJobMonitor();
    await stopRepeatJobMonitor();
    expect(quitMock).toHaveBeenCalled();
  });
});
