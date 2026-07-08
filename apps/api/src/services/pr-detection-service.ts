import { TASK_BRANCH_PREFIX, parseRepoUrl, parsePrUrl } from "@optio/shared";
import { getGitPlatformForRepo } from "./git-token-service.js";
import { logger } from "../logger.js";

export interface ExistingPr {
  url: string;
  number: number;
  state: string;
}

/**
 * Extract owner and repo from a normalized repo URL.
 * e.g. "https://github.com/owner/repo" → { owner: "owner", repo: "repo" }
 */
export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const ri = parseRepoUrl(repoUrl);
  if (!ri) return null;
  return { owner: ri.owner, repo: ri.repo };
}

/**
 * Check if an open PR already exists for a task's branch.
 *
 * Uses the GitPlatform abstraction to list open PRs filtered by branch.
 * Branch naming is deterministic: `optio/task-{taskId}`
 *
 * Returns the PR info if found, or null if no PR exists.
 */
export async function checkExistingPr(
  repoUrl: string,
  taskId: string,
  workspaceId: string | null,
): Promise<ExistingPr | null> {
  const ri = parseRepoUrl(repoUrl);
  if (!ri) {
    logger.debug({ repoUrl }, "Cannot parse repo URL — skipping PR check");
    return null;
  }

  let platform;
  try {
    const result = await getGitPlatformForRepo(repoUrl, { server: true });
    platform = result.platform;
  } catch {
    logger.debug("No git token available — skipping existing PR check");
    return null;
  }

  const branch = `${TASK_BRANCH_PREFIX}${taskId}`;

  try {
    const pulls = await platform.listOpenPullRequests(ri, { branch });

    if (pulls.length === 0) return null;

    const pr = pulls[0];
    return {
      url: pr.url,
      number: pr.number,
      state: pr.state,
    };
  } catch (err) {
    logger.debug({ err }, "Failed to check for existing PR");
    return null;
  }
}

export type PrUrlValidation = "valid" | "invalid" | "unknown";

/**
 * Check that a candidate PR URL (scraped from agent logs) actually points at
 * this task's PR by comparing the PR's head branch to the deterministic task
 * branch. "unknown" means the API could not be consulted — callers should
 * accept the candidate in that case rather than block PR detection.
 *
 * Assumes `prUrl` has already been confirmed to point at `repoUrl`; only the
 * PR number is taken from it, its owner/repo/host are not re-checked here.
 */
export async function validateTaskPrUrl(
  repoUrl: string,
  taskId: string,
  prUrl: string,
): Promise<PrUrlValidation> {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) return "invalid";

  let platform;
  let ri;
  try {
    const result = await getGitPlatformForRepo(repoUrl, { server: true });
    platform = result.platform;
    ri = result.ri;
  } catch {
    return "unknown";
  }

  try {
    const pr = await platform.getPullRequest(ri, parsed.prNumber);
    return pr.headBranch === `${TASK_BRANCH_PREFIX}${taskId}` ? "valid" : "invalid";
  } catch (err) {
    logger.debug({ err, prUrl }, "Could not fetch candidate PR for validation");
    return "unknown";
  }
}
