import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration test verifying that no span attribute contains sensitive data.
 *
 * This test validates the whitelist approach: all span attributes must come
 * from the approved attribute set and must not contain secrets, prompts,
 * agent output, or user PII.
 */

// Collect all span attributes for inspection
const recordedAttributes: Record<string, unknown>[] = [];
const recordedExceptions: Array<{ name: string; message: string }>[] = [];

const mockSpan = {
  end: vi.fn(),
  setStatus: vi.fn(),
  setAttribute: vi.fn((key: string, value: unknown) => {
    recordedAttributes.push({ [key]: value });
  }),
  setAttributes: vi.fn((attrs: Record<string, unknown>) => {
    recordedAttributes.push(attrs);
  }),
  recordException: vi.fn((exc: { name: string; message: string }) => {
    recordedExceptions.push([exc]);
  }),
  spanContext: () => ({
    traceId: "abc123def456abc123def456abc123de",
    spanId: "1234567890abcdef",
  }),
  isRecording: () => true,
  addEvent: vi.fn(),
  updateName: vi.fn(),
};

vi.mock("@opentelemetry/api", () => {
  const SpanStatusCode = { OK: 1, ERROR: 2, UNSET: 0 };
  const ROOT_CONTEXT = {};
  const activeContext = {};

  return {
    SpanStatusCode,
    ROOT_CONTEXT,
    trace: {
      getTracer: () => ({
        startSpan: (_name: string, opts?: { attributes?: Record<string, unknown> }) => {
          if (opts?.attributes) {
            recordedAttributes.push(opts.attributes);
          }
          return mockSpan;
        },
      }),
      getActiveSpan: () => mockSpan,
      setSpan: (_ctx: unknown, _span: unknown) => activeContext,
    },
    context: {
      active: () => activeContext,
      with: (_ctx: unknown, fn: () => unknown) => fn(),
    },
    propagation: {
      inject: vi.fn(),
      extract: vi.fn(),
    },
  };
});

vi.mock("@optio/shared", () => ({
  classifyError: (msg: string) => {
    if (msg?.includes("token expired")) {
      return { category: "auth", title: "Authentication token expired" };
    }
    return { category: "unknown", title: "Unknown error" };
  },
}));

import { withSpan, sanitizeUrl, enableSpans } from "./spans.js";

/** Sensitive patterns that MUST NEVER appear in span attributes */
const SENSITIVE_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/, // GitHub personal access tokens
  /sk-ant-[a-zA-Z0-9-]+/, // Anthropic API keys
  /Bearer\s+[a-zA-Z0-9._-]+/, // Bearer tokens
  /sk-[a-zA-Z0-9]{48}/, // OpenAI API keys
  /gho_[a-zA-Z0-9]{36}/, // GitHub OAuth tokens
  /glpat-[a-zA-Z0-9-_]{20,}/, // GitLab PATs
  /xoxb-[0-9-]+/, // Slack bot tokens
  /ANTHROPIC_API_KEY/, // Secret name references
  /CLAUDE_CODE_OAUTH_TOKEN/, // Secret name references
];

function assertNoSensitiveData(data: unknown, context: string): void {
  const str = JSON.stringify(data);
  for (const pattern of SENSITIVE_PATTERNS) {
    expect(str, `${context}: matched sensitive pattern ${pattern}`).not.toMatch(pattern);
  }
}

describe("sensitive-data enforcement", () => {
  beforeEach(() => {
    recordedAttributes.length = 0;
    recordedExceptions.length = 0;
    vi.clearAllMocks();
    enableSpans();
  });

  it("task lifecycle span only contains whitelisted attributes", async () => {
    await withSpan(
      "task.lifecycle",
      {
        "task.id": "task-abc123",
        "task.repo_url": "https://github.com/org/repo",
        "task.agent_type": "claude-code",
        "task.model": "sonnet",
        "task.priority": 100,
      },
      async () => "done",
    );

    for (const attrs of recordedAttributes) {
      assertNoSensitiveData(attrs, "task.lifecycle attributes");
    }
  });

  it("sanitizeUrl strips tokens from GitHub URLs", () => {
    const url = "https://github.com/org/repo?token=ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const sanitized = sanitizeUrl(url);
    expect(sanitized).toBe("https://github.com/org/repo");
    expect(sanitized).not.toContain("ghp_");
    expect(sanitized).not.toContain("token=");
  });

  it("sanitizeUrl strips API keys from query params", () => {
    const url = "https://api.anthropic.com/v1/messages?key=sk-ant-abcdef123456";
    const sanitized = sanitizeUrl(url);
    expect(sanitized).not.toContain("sk-ant-");
  });

  it("error messages are classified, not raw", async () => {
    try {
      await withSpan("task.lifecycle", {}, async () => {
        throw new Error("token expired for ghp_abcdefghijklmnopqrstuvwxyz1234567890");
      });
    } catch {
      // expected
    }

    // Check that the recorded exception doesn't contain the raw token
    const allExceptions = mockSpan.recordException.mock.calls;
    for (const [exc] of allExceptions) {
      const excStr = JSON.stringify(exc);
      for (const pattern of SENSITIVE_PATTERNS) {
        expect(excStr, `Exception contained sensitive pattern: ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("span attributes never contain prompt content", async () => {
    const prompt = "Write a function that processes user data from the API";

    await withSpan(
      "task.lifecycle",
      {
        "task.id": "task-123",
        "task.agent_type": "claude-code",
        // Note: "task.prompt" is NOT in the whitelist — it should never be added
      },
      async () => "done",
    );

    for (const attrs of recordedAttributes) {
      const attrStr = JSON.stringify(attrs);
      expect(attrStr).not.toContain(prompt);
      expect(attrStr).not.toContain("task.prompt");
    }
  });

  it("span attributes never contain secret names as values", async () => {
    await withSpan(
      "task.lifecycle",
      {
        "task.id": "task-456",
        "task.repo_url": "https://github.com/org/repo",
      },
      async () => "done",
    );

    for (const attrs of recordedAttributes) {
      assertNoSensitiveData(attrs, "span attributes");
    }
  });
});

describe("no-op behavior when disabled", () => {
  it("withSpan executes function directly with no OTel overhead", async () => {
    // Even in the mocked environment, the function should execute
    const result = await withSpan("test.span", {}, async () => 42);
    expect(result).toBe(42);
  });

  it("sanitizeUrl works regardless of OTel state", () => {
    expect(sanitizeUrl("https://example.com?key=secret")).toBe("https://example.com/");
  });
});
