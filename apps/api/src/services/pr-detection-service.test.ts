import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseOwnerRepo, checkExistingPr, validateTaskPrUrl } from "./pr-detection-service.js";

// Mock git-token-service
const mockPlatform = {
  type: "github",
  listOpenPullRequests: vi.fn(),
  getPullRequest: vi.fn(),
};
const mockGetGitPlatformForRepo = vi.fn();

vi.mock("./git-token-service.js", () => ({
  getGitPlatformForRepo: (...args: unknown[]) => mockGetGitPlatformForRepo(...args),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe("parseOwnerRepo", () => {
  it("parses HTTPS GitHub URL", () => {
    expect(parseOwnerRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses lowercase normalized URL", () => {
    expect(parseOwnerRepo("https://github.com/myorg/myrepo")).toEqual({
      owner: "myorg",
      repo: "myrepo",
    });
  });

  it("parses GitLab URL", () => {
    expect(parseOwnerRepo("https://gitlab.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null for empty string", () => {
    expect(parseOwnerRepo("")).toBeNull();
  });

  it("handles URLs with trailing path segments", () => {
    const result = parseOwnerRepo("https://github.com/owner/repo/tree/main");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

describe("checkExistingPr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitPlatformForRepo.mockResolvedValue({
      platform: mockPlatform,
      ri: {
        platform: "github",
        host: "github.com",
        owner: "owner",
        repo: "repo",
        apiBaseUrl: "https://api.github.com",
      },
    });
  });

  it("returns PR when an open PR exists for the task branch", async () => {
    mockPlatform.listOpenPullRequests.mockResolvedValue([
      {
        url: "https://github.com/owner/repo/pull/42",
        number: 42,
        state: "open",
        title: "",
        body: "",
        merged: false,
        mergeable: true,
        draft: false,
        headSha: "abc",
        headBranch: "optio/task-123",
        baseBranch: "main",
        author: "",
        assignees: [],
        labels: [],
        createdAt: "",
        updatedAt: "",
      },
    ]);

    const result = await checkExistingPr("https://github.com/owner/repo", "task-123", null);

    expect(result).toEqual({
      url: "https://github.com/owner/repo/pull/42",
      number: 42,
      state: "open",
    });

    expect(mockPlatform.listOpenPullRequests).toHaveBeenCalledWith(expect.any(Object), {
      branch: "optio/task-task-123",
    });
  });

  it("returns null when no PR exists", async () => {
    mockPlatform.listOpenPullRequests.mockResolvedValue([]);

    const result = await checkExistingPr("https://github.com/owner/repo", "task-456", null);

    expect(result).toBeNull();
  });

  it("returns null when no git token is available", async () => {
    mockGetGitPlatformForRepo.mockRejectedValue(new Error("No token"));

    const result = await checkExistingPr("https://github.com/owner/repo", "task-789", null);

    expect(result).toBeNull();
  });

  it("returns null when platform API returns an error", async () => {
    mockPlatform.listOpenPullRequests.mockRejectedValue(new Error("API error"));

    const result = await checkExistingPr("https://github.com/owner/repo", "task-err", null);

    expect(result).toBeNull();
  });

  it("works for GitLab repo URLs", async () => {
    mockGetGitPlatformForRepo.mockResolvedValue({
      platform: mockPlatform,
      ri: {
        platform: "gitlab",
        host: "gitlab.com",
        owner: "owner",
        repo: "repo",
        apiBaseUrl: "https://gitlab.com/api/v4",
      },
    });
    mockPlatform.listOpenPullRequests.mockResolvedValue([]);

    const result = await checkExistingPr("https://gitlab.com/owner/repo", "task-gl", null);

    expect(result).toBeNull();
    expect(mockGetGitPlatformForRepo).toHaveBeenCalled();
  });

  it("returns null when fetch throws a network error", async () => {
    mockPlatform.listOpenPullRequests.mockRejectedValue(new Error("Network error"));

    const result = await checkExistingPr("https://github.com/owner/repo", "task-net", null);

    expect(result).toBeNull();
  });

  it("uses server context for token resolution", async () => {
    mockPlatform.listOpenPullRequests.mockResolvedValue([]);

    await checkExistingPr("https://github.com/owner/repo", "task-ws", "workspace-42");

    expect(mockGetGitPlatformForRepo).toHaveBeenCalledWith("https://github.com/owner/repo", {
      server: true,
    });
  });
});

describe("validateTaskPrUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGitPlatformForRepo.mockResolvedValue({
      platform: mockPlatform,
      ri: {
        platform: "github",
        host: "github.com",
        owner: "owner",
        repo: "repo",
        apiBaseUrl: "https://api.github.com",
      },
    });
  });

  it("returns valid when the PR head branch is the task branch", async () => {
    mockPlatform.getPullRequest.mockResolvedValue({ headBranch: "optio/task-abc" });
    const result = await validateTaskPrUrl(
      "https://github.com/owner/repo",
      "abc",
      "https://github.com/owner/repo/pull/506",
    );
    expect(result).toBe("valid");
    expect(mockPlatform.getPullRequest).toHaveBeenCalledWith(expect.anything(), 506);
  });

  it("returns invalid when the PR head branch is a different branch", async () => {
    mockPlatform.getPullRequest.mockResolvedValue({ headBranch: "renovate/aiosqlite-0.x" });
    const result = await validateTaskPrUrl(
      "https://github.com/owner/repo",
      "abc",
      "https://github.com/owner/repo/pull/453",
    );
    expect(result).toBe("invalid");
  });

  it("returns invalid when the URL is not a parseable PR URL", async () => {
    const result = await validateTaskPrUrl(
      "https://github.com/owner/repo",
      "abc",
      "https://github.com/owner/repo/pulls",
    );
    expect(result).toBe("invalid");
  });

  it("returns unknown when no git token is available", async () => {
    mockGetGitPlatformForRepo.mockRejectedValue(new Error("no token"));
    const result = await validateTaskPrUrl(
      "https://github.com/owner/repo",
      "abc",
      "https://github.com/owner/repo/pull/506",
    );
    expect(result).toBe("unknown");
  });

  it("returns unknown when the PR fetch fails", async () => {
    mockPlatform.getPullRequest.mockRejectedValue(new Error("GitHub API error 500"));
    const result = await validateTaskPrUrl(
      "https://github.com/owner/repo",
      "abc",
      "https://github.com/owner/repo/pull/506",
    );
    expect(result).toBe("unknown");
  });
});
