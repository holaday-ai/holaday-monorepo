# Eval Origin Lifecycle Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete server-trusted task-origin isolation across active-task recovery and generic lifecycle controls.

**Architecture:** Treat `TaskRepository.taskOrigin` as the scope for active-task rehydration, then construct generic lifecycle repositories with the authenticated `ctx.taskOrigin`. Keep product-only and billable-video endpoints explicitly user-only.

**Tech Stack:** TypeScript, tRPC, Drizzle ORM, MariaDB/MySQL, Vitest

**Spec:** `docs/superpowers/specs/2026-08-22-eval-origin-lifecycle-design.md`

## Global Constraints

- Do not change schema or migrations.
- Do not mutate or backfill historical production tasks.
- Do not change secrets, production feature flags, billing, AkShare, DivineAPI, Translator, or OpenAI-key configuration.
- Preserve explicit `origin='user'` guards on paid-video and product-history management endpoints.

---

### Task 1: Prove repository rehydration leaks across origins

**Files:**
- Modify: `apps/orchestrator/src/agent/task-repository.integration.test.ts`
- Modify: `apps/orchestrator/src/agent/task-repository.ts`

**Interfaces:**
- Consumes: `new TaskRepository(db, taskOrigin)` and `rehydrateInFlight()`
- Produces: `rehydrateInFlight(): Promise<RehydratedTask[]>` scoped to the repository origin

- [x] **Step 1: Write the failing integration test**

Seed one active user task and one active eval task for the same user, then assert the default
repository returns only the user task and an eval repository returns only the eval task:

```ts
const userRows = await new TaskRepository(db).rehydrateInFlight();
const evalRows = await new TaskRepository(db, 'eval').rehydrateInFlight();
expect(userRows.map((row) => row.state.taskId)).toContain(userTaskId);
expect(userRows.map((row) => row.state.taskId)).not.toContain(evalTaskId);
expect(evalRows.map((row) => row.state.taskId)).toContain(evalTaskId);
expect(evalRows.map((row) => row.state.taskId)).not.toContain(userTaskId);
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/agent/task-repository.integration.test.ts
```

Expected: the new assertions fail because both repositories currently rehydrate both origins.

- [x] **Step 3: Add the origin predicate**

Change the active-task query to:

```ts
.where(
  and(
    inArray(tasks.status, [...TASK_ACTIVE_STATUSES]),
    eq(tasks.origin, this.taskOrigin),
  ),
)
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: the new isolation test and the existing repository
integration tests pass.

### Task 2: Prove generic lifecycle controls honor the signed origin

**Files:**
- Modify: `apps/orchestrator/src/trpc/routers/tasks-confirm.integration.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`

**Interfaces:**
- Consumes: tRPC context `taskOrigin: 'user' | 'eval'`
- Produces: origin-scoped behavior for `smokeTest`, `pause`, `resume`, `confirm`, `reply`, and `abort`

- [x] **Step 1: Extend the HTTP test helper with an optional signed origin**

Add `taskOrigin?: 'user' | 'eval'` to `callTrpc` and include it only in the server-signed JWT:

```ts
const token = await signAccessToken({
  sub: userExternalId,
  plan: 'free',
  ...(taskOrigin ? { taskOrigin } : {}),
});
```

- [x] **Step 2: Write failing cross-origin lifecycle tests**

Seed user and eval tasks for the same account. Assert an eval token receives 404 when pausing or
aborting the user task, while it can pause or abort the eval task and the untouched task retains
its original status.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/trpc/routers/tasks-confirm.integration.test.ts
```

Expected: the eval token can currently operate on the user task or cannot operate on its own eval
task, demonstrating the incomplete lifecycle boundary.

- [x] **Step 4: Thread `ctx.taskOrigin` through generic controls**

Use `new TaskRepository(ctx.db, ctx.taskOrigin)` in `smokeTest`, `pause`, `resume`, `confirm`, and
reply persistence branches. In `abort`, replace the hardcoded user-origin predicate with
`eq(tasksTable.origin, ctx.taskOrigin)` and use the scoped repository. Leave `confirmVideo` and
product-history management endpoints explicitly user-only.

- [x] **Step 5: Run focused lifecycle and repository tests and verify GREEN**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- \
  src/trpc/routers/tasks-confirm.integration.test.ts \
  src/agent/task-repository.integration.test.ts \
  src/trpc/routers/tasks-list-detail.integration.test.ts
```

Expected: every targeted test passes with no warning or error output.

### Task 3: Verify and release

**Files:**
- Modify: `docs/daily/SESSION_STATUS.md`

**Interfaces:**
- Consumes: merged implementation and production verification evidence
- Produces: current release record and explicit non-backfill boundary

- [x] **Step 1: Run local verification**

Run targeted auth/context/repository/router tests, Orchestrator typecheck, build, complete test
suite, and `git diff --check`. All must pass.

- [x] **Step 2: Commit and publish a ready PR**

Stage only the spec, plan, tests, implementation, and status document. Commit with:

```bash
git commit -m "fix(orchestrator): isolate eval task lifecycle"
```

Push the feature branch and create a ready PR against `claude/musing-keller-ae1d05`.

- [x] **Step 3: Review, merge, and deploy application**

Resolve blocking review threads, merge only if the head SHA is unchanged, deploy `application`
from the merged production branch, and preserve the deploy preflight ancestor gate.

- [x] **Step 4: Verify production**

Confirm the live HEAD equals the merge commit, Orchestrator is online under uid 998 with restart
count 0, both public health endpoints return 200/status ok, the P0 release gate passes, and a
controlled lifecycle probe proves same-origin control without targeting existing user-origin
rows.

- [x] **Step 5: Record evidence**

Update `docs/daily/SESSION_STATUS.md` with exact commit, test totals, production health, lifecycle
probe results, and the statement that historical misclassified rows were neither changed nor
deleted.
