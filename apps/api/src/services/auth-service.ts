import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";

interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
}

interface CredentialsData {
  claudeAiOauth?: ClaudeOAuthCredentials;
}

let cachedCredentials: CredentialsData | null = null;
let lastRead = 0;
const CACHE_TTL_MS = 30_000; // re-read every 30s

function readCredentialsFromKeychain(): CredentialsData | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readCredentialsFromFile(): CredentialsData | null {
  const paths = [
    join(process.env.CLAUDE_CONFIG_DIR ?? "", ".credentials.json"),
    join(process.env.HOME ?? "", ".claude", ".credentials.json"),
  ].filter(Boolean);

  for (const p of paths) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
      continue;
    }
  }
  return null;
}

function readCredentials(): CredentialsData | null {
  const now = Date.now();
  if (cachedCredentials && now - lastRead < CACHE_TTL_MS) {
    return cachedCredentials;
  }

  // Try Keychain first (macOS), then file (Linux)
  let creds = readCredentialsFromKeychain();
  if (!creds) {
    creds = readCredentialsFromFile();
  }

  if (creds) {
    cachedCredentials = creds;
    lastRead = now;
  }

  return creds;
}

export interface AuthTokenResult {
  available: boolean;
  token?: string;
  expiresAt?: string;
  error?: string;
}

/**
 * Get the Claude OAuth access token from the host's credentials.
 * This is used by agent containers via the apiKeyHelper callback.
 */
export function getClaudeAuthToken(): AuthTokenResult {
  const creds = readCredentials();

  if (!creds?.claudeAiOauth?.accessToken) {
    return {
      available: false,
      error: "No Claude subscription credentials found on this host",
    };
  }

  const oauth = creds.claudeAiOauth;

  // Check if token is expired (with 5-minute buffer)
  if (oauth.expiresAt) {
    const expiresAt = new Date(oauth.expiresAt);
    const bufferMs = 5 * 60 * 1000;
    if (expiresAt.getTime() - bufferMs < Date.now()) {
      // Token is expired or about to expire
      // Claude Code auto-refreshes tokens, so re-reading should get a fresh one
      cachedCredentials = null;
      const freshCreds = readCredentials();
      if (freshCreds?.claudeAiOauth?.accessToken) {
        return {
          available: true,
          token: freshCreds.claudeAiOauth.accessToken,
          expiresAt: freshCreds.claudeAiOauth.expiresAt,
        };
      }
      return {
        available: false,
        error: "Claude subscription token is expired and could not be refreshed",
      };
    }
  }

  return {
    available: true,
    token: oauth.accessToken,
    expiresAt: oauth.expiresAt,
  };
}

/**
 * Check if a Claude subscription is available on this host.
 */
export function isSubscriptionAvailable(): boolean {
  const result = getClaudeAuthToken();
  return result.available;
}

/**
 * Invalidate the cached credentials so the next read fetches fresh ones.
 */
export function invalidateCredentialsCache(): void {
  cachedCredentials = null;
  lastRead = 0;
}
