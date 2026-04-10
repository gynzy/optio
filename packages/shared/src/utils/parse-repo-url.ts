import type { GitPlatformType, RepoIdentifier } from "../types/git-platform.js";

const GITHUB_HOSTS = new Set(["github.com"]);

/**
 * GITLAB_HOSTS (plural): comma-separated list of all known GitLab hostnames,
 * used for platform detection when parsing repository URLs.
 * Distinct from GITLAB_HOST (singular) which is the specific GitLab host
 * for the current task/auth context (used in scripts and credential helpers).
 */
function getGitLabHosts(): Set<string> {
  const hosts = new Set(["gitlab.com"]);
  const env =
    typeof process !== "undefined"
      ? (process.env.GITLAB_HOSTS ?? process.env.OPTIO_GITLAB_HOSTS)
      : undefined;
  if (env) {
    for (const h of env.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return hosts;
}

function detectPlatform(host: string): GitPlatformType {
  const h = host.toLowerCase();
  if (GITHUB_HOSTS.has(h)) return "github";
  if (getGitLabHosts().has(h)) return "gitlab";
  // Unknown hosts: check if the hostname contains "gitlab"
  if (h.includes("gitlab")) return "gitlab";
  // Default to github for unknown hosts (most common case)
  return "github";
}

function buildApiBaseUrl(platform: GitPlatformType, host: string): string {
  if (platform === "github") {
    return host.toLowerCase() === "github.com"
      ? "https://api.github.com"
      : `https://${host}/api/v3`; // GitHub Enterprise
  }
  return `https://${host}/api/v4`;
}

/**
 * Extracts host + owner/repo path from a git URL.
 * Returns null if the URL cannot be parsed.
 */
function extractParts(url: string): { host: string; path: string } | null {
  let u = url.trim();

  // SSH shorthand: git@host:owner/repo.git
  const sshShorthand = u.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshShorthand) {
    return { host: sshShorthand[1], path: sshShorthand[2] };
  }

  // ssh://git@host(:port)/owner/repo
  const sshProto = u.match(/^ssh:\/\/[^@]+@([^:/]+)(?::\d+)?\/(.+)$/);
  if (sshProto) {
    return { host: sshProto[1], path: sshProto[2] };
  }

  // Normalize http/https
  u = u.replace(/^https?:\/\//i, "https://");
  if (!u.startsWith("https://")) {
    u = `https://${u}`;
  }

  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/^\//, "");
    if (!path) return null;
    return { host: parsed.hostname, path };
  } catch {
    return null;
  }
}

/**
 * Clean a path segment: strip .git suffix, trailing slashes, and extract
 * owner/repo. For GitLab subgroups the owner includes the full namespace
 * path (e.g. "group/subgroup"), with the last segment as the repo.
 * For GitHub-style URLs, takes the first two segments only.
 */
function cleanOwnerRepo(
  rawPath: string,
  platform: GitPlatformType = "github",
): { owner: string; repo: string } | null {
  let p = rawPath.replace(/\.git\/?$/, "").replace(/\/+$/, "");

  // Strip GitLab path suffixes like /-/... or /merge_requests/...
  if (platform === "gitlab") {
    p = p.replace(/\/?-\/.*$/, "").replace(/\/merge_requests\/.*$/, "");
  }

  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  if (platform === "gitlab") {
    // GitLab: last segment is the project, everything before is the namespace
    return { owner: parts.slice(0, -1).join("/"), repo: parts[parts.length - 1] };
  }

  // GitHub: always owner/repo (first two segments)
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Parse a git repository URL into a RepoIdentifier.
 * Detects platform from the host (github.com → github, gitlab.com or GITLAB_HOSTS → gitlab).
 */
export function parseRepoUrl(url: string): RepoIdentifier | null {
  const extracted = extractParts(url);
  if (!extracted) return null;

  const host = extracted.host.toLowerCase();
  const platform = detectPlatform(host);

  const ownerRepo = cleanOwnerRepo(extracted.path, platform);
  if (!ownerRepo) return null;

  return {
    platform,
    host,
    owner: ownerRepo.owner,
    repo: ownerRepo.repo,
    apiBaseUrl: buildApiBaseUrl(platform, host),
  };
}

/**
 * Parse a PR/MR URL into a RepoIdentifier plus the PR/MR number.
 * Handles GitHub `/pull/N` and GitLab `/-/merge_requests/N` or `/merge_requests/N`.
 */
export function parsePrUrl(url: string): (RepoIdentifier & { prNumber: number }) | null {
  const extracted = extractParts(url);
  if (!extracted) return null;

  const host = extracted.host.toLowerCase();
  const platform = detectPlatform(host);

  const p = extracted.path.replace(/\.git\/?$/, "").replace(/\/+$/, "");

  // GitHub: owner/repo/pull/123
  const ghMatch = p.match(/^([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (ghMatch) {
    return {
      platform,
      host,
      owner: ghMatch[1],
      repo: ghMatch[2],
      apiBaseUrl: buildApiBaseUrl(platform, host),
      prNumber: parseInt(ghMatch[3], 10),
    };
  }

  // GitLab: owner/repo/-/merge_requests/123 or owner/repo/merge_requests/123
  // Also handles subgroups: group/subgroup/repo/-/merge_requests/123
  const glMatch = p.match(/^(.+?)\/([^/]+)\/?-?\/merge_requests\/(\d+)/);
  if (glMatch) {
    return {
      platform,
      host,
      owner: glMatch[1],
      repo: glMatch[2],
      apiBaseUrl: buildApiBaseUrl(platform, host),
      prNumber: parseInt(glMatch[3], 10),
    };
  }

  return null;
}
