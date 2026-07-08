# PR Association Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Optio from associating a task with the wrong PR when a PR URL merely appears in agent logs (e.g. an example URL inside the prompt).

**Architecture:** Three independent defenses. (1) Agent adapters take the _last_ PR-URL match in logs instead of the first — PR-creation output comes at the end, prompts come first. (2) Before `task-worker` transitions to `PR_OPENED` with a log-scraped URL, validate via the git-platform API that the candidate PR's head branch is the task's deterministic branch `optio/task-<taskId>`; discard on mismatch so the existing branch-based API fallback (`checkExistingPr`) finds the real PR or the task escalates to `needs_attention`. (3) In the reconciler's pure decision function, refuse to act on a PR created before the task existed — route to `NEEDS_ATTENTION` instead of auto-completing/failing.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo), Vitest, Drizzle (no schema changes needed).

## Global Constraints

- ESM everywhere: imports use `.js` extensions (`import { x } from "./foo.js"` resolving to `foo.ts`).
- Conventional commits enforced by commitlint (`fix:`, `feat:`, `test:`).
- Pre-commit hooks run lint-staged + `pnpm format:check` + `pnpm turbo typecheck` — commits fail if these fail.
- Run tests with `pnpm vitest run <file>` from the package directory (`packages/agent-adapters`, `apps/api`, `packages/shared`).
- KISS: minimum code to solve the issue; no drive-by refactoring.

## Background (why)

Task `347c7c88` (prod incident 2026-07-08): its prompt contained the literal example URL `https://github.com/gynzy/backend-python/pull/453`. The k8s exec stream dropped mid-run, `task-worker` treated the agent as finished, `parseResult()` regex-scanned the full NDJSON log and returned the **first** PR URL match — the prompt's example. #453 was same-repo so it passed the only existing validation, the task went to `pr_opened`, and 2 s later the reconciler saw #453 was merged (weeks earlier) and auto-completed the task. The real PR #506 was created 90 s later and is untracked.

Key existing code:

- `apps/api/src/workers/task-worker.ts:1067-1118` — final PR selection: `capturedPrUrl || taskAfterExec?.prUrl || fallbackPrUrl` → `PR_OPENED`. Only repo owner/name is validated.
- `apps/api/src/services/pr-detection-service.ts:29` — `checkExistingPr(repoUrl, taskId, workspaceId)`: authoritative branch-based lookup (`listOpenPullRequests({ branch: "optio/task-" + taskId })`), returns `null` on both "no PR" and API error. Already used as fallback at `task-worker.ts:1153` and `:1200`.
- `packages/agent-adapters/src/*.ts` — six adapters each do `logs.match(prRegex)` (first match).
- `packages/shared/src/reconcile/reconcile-repo.ts:338` (`decideFromPrStatus`) — pure function; `pr.merged` → COMPLETED, `pr.state === "closed"` → FAILED. No sanity check that the PR belongs to the task.
- `packages/shared/src/constants.ts:3` — `TASK_BRANCH_PREFIX = "optio/task-"`.
- The mid-stream log scanner (`task-worker.ts:913-948`) is left unchanged: it never transitions state, and the reconciler ignores `snapshot.pr` for RUNNING tasks; Task 3's validation discards any bad URL it stored before `PR_OPENED`.

---

### Task 1: Adapters take the last PR-URL match

**Files:**

- Modify: `packages/agent-adapters/src/claude-code.ts:93-95`
- Modify: `packages/agent-adapters/src/codex.ts:100`
- Modify: `packages/agent-adapters/src/copilot.ts:68`
- Modify: `packages/agent-adapters/src/gemini.ts:127-129`
- Modify: `packages/agent-adapters/src/opencode.ts:103-105`
- Modify: `packages/agent-adapters/src/openclaw.ts:87-89`
- Test: the six sibling `*.test.ts` files

**Interfaces:**

- Consumes: nothing new.
- Produces: unchanged `parseResult(exitCode: number, logs: string): AgentResult` — only `prUrl` selection semantics change (last match instead of first).

- [ ] **Step 1: Write the failing tests**

Add to the `parseResult` describe block in each of the six test files (adjust `adapter` construction to match each file's existing style):

```typescript
it("takes the last PR URL when multiple appear in logs", () => {
  const logs = [
    "Example in prompt: https://github.com/org/repo/pull/453",
    "working...",
    "Created PR: https://github.com/org/repo/pull/506",
  ].join("\n");
  const result = adapter.parseResult(0, logs);
  expect(result.prUrl).toBe("https://github.com/org/repo/pull/506");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agent-adapters && pnpm vitest run`
Expected: 6 new tests FAIL with `expected '...pull/453' to be '...pull/506'`

- [ ] **Step 3: Change first-match to last-match in all six adapters**

In `claude-code.ts` (and identically in `gemini.ts`, `opencode.ts`, `openclaw.ts` which share the same regex):

```typescript
// before
const prMatch = logs.match(
  /https:\/\/(?![\w.-]+\/api\/)[^\s"]+\/(?:pull\/\d+|-\/merge_requests\/\d+)/,
);
// after — PR-creation output comes at the end of the log; prompts and
// examples come first, so the last match is the PR the agent created
const prMatches = logs.match(
  /https:\/\/(?![\w.-]+\/api\/)[^\s"]+\/(?:pull\/\d+|-\/merge_requests\/\d+)/g,
);
```

In `codex.ts` and `copilot.ts` (GitHub-only regex):

```typescript
// before
const prMatch = logs.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
// after
const prMatches = logs.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/g);
```

And in each file's returned object:

```typescript
// before
prUrl: prMatch?.[0],
// after
prUrl: prMatches?.[prMatches.length - 1],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agent-adapters && pnpm vitest run`
Expected: all PASS (existing single-URL tests still pass — with one match, last === first)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-adapters/src
git commit -m "fix: take last PR URL match in agent logs, not first"
```

---

### Task 2: Expose `headBranch` on `PullRequest`

**Files:**

- Modify: `packages/shared/src/types/git-platform.ts:11-27` (interface `PullRequest`)
- Modify: `apps/api/src/services/git-platform/github.ts:253-271` (`mapPr`)
- Modify: `apps/api/src/services/git-platform/gitlab.ts:384-407` (`mapMr`)
- Test: `apps/api/src/services/git-platform/github.test.ts`, `apps/api/src/services/git-platform/gitlab.test.ts`

**Interfaces:**

- Consumes: GitHub REST `pulls/:number` field `head.ref`; GitLab MR field `source_branch`.
- Produces: `PullRequest.headBranch: string` — used by Task 3's `validateTaskPrUrl`.

- [ ] **Step 1: Write the failing tests**

In `github.test.ts`, the existing `getPullRequest` test (line ~43) mocks a fetch response. Add `head: { ref: "optio/task-abc", sha: ... }` to that mock's payload if `head` isn't present (it already carries `head.sha`), and assert:

```typescript
expect(pr.headBranch).toBe("optio/task-abc");
```

In `gitlab.test.ts`, the `getPullRequest` test (line ~44): add `source_branch: "optio/task-abc"` to the mocked MR payload and assert:

```typescript
expect(pr.headBranch).toBe("optio/task-abc");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/git-platform/github.test.ts src/services/git-platform/gitlab.test.ts`
Expected: FAIL — `headBranch` is `undefined` (and a typecheck error until Step 3)

- [ ] **Step 3: Add the field**

`packages/shared/src/types/git-platform.ts` — after `headSha`:

```typescript
headSha: string;
headBranch: string;
baseBranch: string;
```

`github.ts` `mapPr`:

```typescript
headSha: data.head?.sha ?? "",
headBranch: data.head?.ref ?? "",
```

`gitlab.ts` `mapMr`:

```typescript
headSha: data.sha ?? data.diff_refs?.head_sha ?? "",
headBranch: data.source_branch ?? "",
```

- [ ] **Step 4: Fix any test fixtures that construct `PullRequest` literals**

Run: `cd apps/api && pnpm vitest run && pnpm typecheck` (also `cd packages/shared && pnpm typecheck`).
`pr-detection-service.test.ts` builds full `PullRequest` objects (line ~80) — add `headBranch: "optio/task-123"` (match the taskId each test uses). Fix any other literal the typecheck flags.
Expected: tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/git-platform.ts apps/api/src/services/git-platform
git commit -m "feat: expose PR head branch on PullRequest type"
```

---

### Task 3: Validate log-scraped PR URLs against the task branch

**Files:**

- Modify: `apps/api/src/services/pr-detection-service.ts` (new export `validateTaskPrUrl`)
- Modify: `apps/api/src/workers/task-worker.ts:1093` (final PR selection)
- Test: `apps/api/src/services/pr-detection-service.test.ts`

**Interfaces:**

- Consumes: `PullRequest.headBranch` (Task 2), `platform.getPullRequest(ri, number)`, `parsePrUrl` from `@optio/shared`, `TASK_BRANCH_PREFIX` from `@optio/shared`.
- Produces: `validateTaskPrUrl(repoUrl: string, taskId: string, prUrl: string): Promise<"valid" | "invalid" | "unknown">`. `"unknown"` (no token / API error) must be treated as "accept the candidate" by callers — validation is a filter, not a gate, so a GitHub outage can't break PR detection.

- [ ] **Step 1: Write the failing tests**

Append to `pr-detection-service.test.ts` (reuse the existing `mockPlatform` / `mockGetGitPlatformForRepo` setup; add `getPullRequest: vi.fn()` to `mockPlatform`):

```typescript
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
```

Add `validateTaskPrUrl` to the import at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm vitest run src/services/pr-detection-service.test.ts`
Expected: FAIL — `validateTaskPrUrl` is not exported

- [ ] **Step 3: Implement `validateTaskPrUrl`**

In `pr-detection-service.ts` (note `parsePrUrl` is exported from `@optio/shared` — extend the existing import):

```typescript
export type PrUrlValidation = "valid" | "invalid" | "unknown";

/**
 * Check that a candidate PR URL (scraped from agent logs) actually points at
 * this task's PR by comparing the PR's head branch to the deterministic task
 * branch. "unknown" means the API could not be consulted — callers should
 * accept the candidate in that case rather than block PR detection.
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
```

(Check how `parsePrUrl` names the number field — reconcile-snapshot.ts uses `parsed.prNumber`; mirror that.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm vitest run src/services/pr-detection-service.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into task-worker's final PR selection**

`task-worker.ts:1093` — change `const` to `let` and validate before the state decision:

```typescript
let detectedPrUrl = capturedPrUrl || taskAfterExec?.prUrl || fallbackPrUrl;

// A log-scraped URL can be a red herring (e.g. an example URL inside the
// prompt). Confirm the PR's head branch is this task's branch; on mismatch
// discard it so the branch-based API fallback below finds the real PR.
if (detectedPrUrl && !isReviewTask) {
  const validation = await validateTaskPrUrl(task.repoUrl, taskId, detectedPrUrl);
  if (validation === "invalid") {
    log.warn(
      { prUrl: detectedPrUrl },
      "Detected PR URL is not for this task's branch — discarding",
    );
    detectedPrUrl = undefined;
  }
}
```

Import `validateTaskPrUrl` next to the existing `checkExistingPr` import in task-worker.ts. No other changes: with `detectedPrUrl` cleared, execution falls into the existing `else` branch (line 1192) whose `checkExistingPr` API fallback finds the real PR by branch, or routes to failure/`needs_attention`.

- [ ] **Step 6: Typecheck and full api test run**

Run: `cd apps/api && pnpm typecheck && pnpm vitest run`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/pr-detection-service.ts apps/api/src/services/pr-detection-service.test.ts apps/api/src/workers/task-worker.ts
git commit -m "fix: validate log-scraped PR URLs against the task branch before pr_opened"
```

---

### Task 4: Reconciler guard — PR predating the task routes to needs_attention

**Files:**

- Modify: `packages/shared/src/reconcile/types.ts` (`RepoRunSpec`, `PrStatus`)
- Modify: `apps/api/src/services/reconcile-snapshot.ts:177-191` (spec) and `:299-308` (PrStatus)
- Modify: `packages/shared/src/reconcile/reconcile-repo.ts:338` (`decideFromPrStatus`)
- Test: `packages/shared/src/reconcile/reconcile-repo.test.ts`

**Interfaces:**

- Consumes: `tasks.createdAt` row column; `PullRequest.createdAt` (ISO string, already mapped by both platforms).
- Produces: `RepoRunSpec.createdAt: Date`; `PrStatus.createdAt: string | null`; new action reason `"pr_predates_task"`.

- [ ] **Step 1: Extend the types**

`types.ts` — in `RepoRunSpec` after `workflowRunId`:

```typescript
workflowRunId: string | null;
createdAt: Date;
```

In `PrStatus` after `latestReviewComments`:

```typescript
latestReviewComments: string | null;
createdAt: string | null;
```

- [ ] **Step 2: Update the test helpers and write the failing tests**

In `reconcile-repo.test.ts`: add `createdAt: null` to the `makePr` helper defaults (line ~63) and `createdAt: new Date("2026-01-01T00:00:00Z")` to the spec defaults inside the `snapshot` helper (line ~77). Then add:

```typescript
describe("PR predating the task", () => {
  const taskCreatedAt = new Date("2026-07-08T06:35:00Z");

  it("merged PR created before the task → NEEDS_ATTENTION, not COMPLETED", () => {
    const s = snapshot({ createdAt: taskCreatedAt }, openedStatus(), {
      pr: makePr({ merged: true, state: "merged", createdAt: "2026-04-24T16:45:53Z" }),
    });
    const action = reconcileRepo(s);
    expect(action.kind).toBe("transition");
    if (action.kind === "transition") {
      expect(action.to).toBe(TaskState.NEEDS_ATTENTION);
      expect(action.reason).toBe("pr_predates_task");
    }
  });

  it("closed PR created before the task → NEEDS_ATTENTION, not FAILED", () => {
    const s = snapshot({ createdAt: taskCreatedAt }, openedStatus(), {
      pr: makePr({ state: "closed", createdAt: "2026-04-24T16:45:53Z" }),
    });
    const action = reconcileRepo(s);
    expect(action.kind).toBe("transition");
    if (action.kind === "transition") expect(action.to).toBe(TaskState.NEEDS_ATTENTION);
  });

  it("PR created after the task is unaffected", () => {
    const s = snapshot({ createdAt: taskCreatedAt }, openedStatus(), {
      pr: makePr({ merged: true, state: "merged", createdAt: "2026-07-08T06:42:16Z" }),
    });
    const action = reconcileRepo(s);
    expect(action.kind).toBe("transition");
    if (action.kind === "transition") expect(action.to).toBe(TaskState.COMPLETED);
  });

  it("review tasks are exempt (their PR is the parent's, created earlier)", () => {
    const s = snapshot({ createdAt: taskCreatedAt, taskType: "review" }, openedStatus(), {
      pr: makePr({ merged: true, state: "merged", createdAt: "2026-04-24T16:45:53Z" }),
    });
    const action = reconcileRepo(s);
    expect(action.kind).toBe("transition");
    if (action.kind === "transition") expect(action.to).toBe(TaskState.COMPLETED);
  });

  it("missing pr.createdAt skips the guard", () => {
    const s = snapshot({ createdAt: taskCreatedAt }, openedStatus(), {
      pr: makePr({ merged: true, state: "merged", createdAt: null }),
    });
    const action = reconcileRepo(s);
    expect(action.kind).toBe("transition");
    if (action.kind === "transition") expect(action.to).toBe(TaskState.COMPLETED);
  });

  it("FAILED task with a predating PR noops (failed → needs_attention is invalid)", () => {
    const s = snapshot(
      { createdAt: taskCreatedAt },
      { ...openedStatus(), state: TaskState.FAILED },
      { pr: makePr({ merged: true, state: "merged", createdAt: "2026-04-24T16:45:53Z" }) },
    );
    const action = reconcileRepo(s);
    expect(action.kind).toBe("noop");
  });
});
```

(Match the file's existing helper names — `openedStatus()` etc. — and adjust the FAILED-state test to however the file builds failed statuses.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/reconcile/reconcile-repo.test.ts`
Expected: new tests FAIL (guard doesn't exist; typecheck errors surface any missed fixture)

- [ ] **Step 4: Implement the guard in `decideFromPrStatus`**

In `reconcile-repo.ts`, at the top of `decideFromPrStatus` right after the `if (!pr)` check (before the `pr.merged` block):

```typescript
// Sanity check: a PR created before the task existed cannot be this task's
// PR — it was misassociated (e.g. a URL scraped from the prompt). Acting on
// it would complete/fail the task off someone else's PR. Review subtasks are
// exempt: they legitimately point at the parent task's older PR.
const { spec } = snapshot.run;
if (spec.taskType !== "review" && pr.createdAt) {
  const prCreated = Date.parse(pr.createdAt);
  if (!Number.isNaN(prCreated) && prCreated < spec.createdAt.getTime()) {
    if (status.state === TaskState.FAILED) {
      return { kind: "noop", reason: "pr_predates_task" };
    }
    return {
      kind: "transition",
      to: TaskState.NEEDS_ATTENTION,
      statusPatch: {
        errorMessage:
          "Associated PR was created before this task — likely misdetected from logs. Verify the PR link.",
      },
      trigger: "pr_association_invalid",
      reason: "pr_predates_task",
    };
  }
}
```

(`snapshot.run.kind === "repo"` is already guaranteed by the guard at the top of the function; destructure `spec` alongside the existing `status` destructuring.)

- [ ] **Step 5: Populate the new fields in the snapshot builder**

`reconcile-snapshot.ts` — in the `RepoRunSpec` literal (line ~177):

```typescript
workflowRunId: row.workflowRunId ?? null,
createdAt: row.createdAt,
```

In the `PrStatus` return of `loadPrStatus` (line ~299):

```typescript
latestReviewComments: reviewResult.comments || null,
createdAt: prData.createdAt || null,
```

- [ ] **Step 6: Run tests and typecheck across packages**

Run: `cd packages/shared && pnpm vitest run && pnpm typecheck && cd ../../apps/api && pnpm typecheck && pnpm vitest run`
Expected: clean — fix any other `RepoRunSpec`/`PrStatus` literal the typecheck flags (test fixtures in `reconcile-edge-cases.test.ts` and `reconcile-standalone.test.ts` likely need the same helper-default additions as Step 2).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/reconcile apps/api/src/services/reconcile-snapshot.ts
git commit -m "fix: reconciler refuses to act on PRs created before the task"
```

---

### Task 5: Full verification

- [ ] **Step 1: Repo-wide quality gates**

Run from repo root:

```bash
pnpm format:check
pnpm turbo typecheck
pnpm turbo test
```

Expected: all pass.

- [ ] **Step 2: Commit any stragglers and hand off**

The branch is ready for PR. Suggested end-to-end verification after deploy: re-run the "backend-python: fix cve's" scheduled task config (id `f0e46f1a-11f7-451a-8cd6-7a5a931d7f69` on optio.gynzy.dev) with a prompt temporarily containing a same-repo example PR URL and confirm the task associates the newly created PR, not the example.

## Self-Review Notes

- Spec coverage: last-match (Task 1), API branch validation (Tasks 2+3), predating/merged-closed guard (Task 4 — merged/closed-at-association is covered by Task 3 discarding non-task-branch URLs, since `checkExistingPr` only finds _open_ task-branch PRs, and by Task 4 for anything already persisted).
- The `"unknown"` validation result deliberately fails open so a git-platform outage or missing token cannot regress PR detection to worse than today's behavior.
- Review-subtask exemption in Task 4 prevents false positives: review subtasks point at the parent's PR, which predates them by design.
- Not in scope (known, separate issue): the exec-stream drop that made the worker treat a running agent as finished.
