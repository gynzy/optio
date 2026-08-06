import { describe, it, expect } from "vitest";
import { isPrWatchStale, PR_WATCH_MAX_AGE_MS } from "./pr-watch-policy.js";

const NOW = new Date("2026-08-06T12:00:00Z");

describe("isPrWatchStale", () => {
  it("defaults to a 5-day window", () => {
    expect(PR_WATCH_MAX_AGE_MS).toBe(5 * 86_400_000);
  });

  it("treats a null last activity as stale", () => {
    expect(isPrWatchStale(null, NOW)).toBe(true);
  });

  it("keeps watching recent activity", () => {
    expect(isPrWatchStale(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });

  it("keeps watching at exactly the cutoff", () => {
    expect(isPrWatchStale(new Date(NOW.getTime() - PR_WATCH_MAX_AGE_MS), NOW)).toBe(false);
  });

  it("stops watching just past the cutoff", () => {
    expect(isPrWatchStale(new Date(NOW.getTime() - PR_WATCH_MAX_AGE_MS - 1), NOW)).toBe(true);
  });
});
