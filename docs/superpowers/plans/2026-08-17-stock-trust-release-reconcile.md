# Stock Trust Production Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current production history while integrating PR #61 and releasing its stock-data trust guarantees without a duplicate numbered migration.

**Architecture:** Build the release from the active production branch, merge the already-reviewed stock-trust branch, and retain both feature sets. Add a release-contract check that treats duplicate four-digit migration prefixes as invalid, then renumber the unapplied stock migration from `0046` to `0047`. Deploy through the existing ancestor, migration, schema, rollback, and health gates.

**Tech Stack:** Git worktrees, Node test runner, Vitest, TypeScript, Drizzle/MySQL numbered SQL migrations, pnpm, Bash deployment scripts.

## Global Constraints

- Do not use `ALLOW_DIVERGENT_DEPLOY`; the live HEAD must remain an ancestor of the release branch.
- Preserve the production Today Energy analytics migration and behavior.
- Apply additive numbered migrations before restarting the orchestrator.
- Do not modify or stage unrelated untracked workspace files.
- Execute serially; do not create subagents.

---

### Task 1: Establish the production baseline

**Files:**
- No source changes.

**Interfaces:**
- Consumes: `origin/claude/musing-keller-ae1d05` and production HEAD `327ab0bd3a2a94a18bd9c4e36845fb3bda9b4dea`.
- Produces: a clean isolated branch whose ancestry contains the current production HEAD.

- [x] **Step 1: Verify branch ancestry and clean status**

Run: `git merge-base --is-ancestor 327ab0bd origin/claude/musing-keller-ae1d05 && git status --short`

Expected: exit 0 and no tracked changes other than this plan.

- [x] **Step 2: Run baseline database release-contract tests**

Run: `node --test apps/orchestrator/scripts/release-db-contract.test.mjs`

Expected: all tests pass before integration.

### Task 2: Prevent duplicate numbered migrations

**Files:**
- Modify: `apps/orchestrator/scripts/release-db-contract.mjs`
- Modify: `apps/orchestrator/scripts/release-db-contract.test.mjs`
- Rename after merge: `apps/orchestrator/drizzle/0046_tasks_source_context.sql` to `apps/orchestrator/drizzle/0047_tasks_source_context.sql`

**Interfaces:**
- Consumes: migration filenames matching `NNNN_description.sql`.
- Produces: `findDuplicateMigrationNumbers(files: string[]): string[]` returning duplicate four-digit prefixes.

- [x] **Step 1: Write the failing duplicate-prefix test**

Add a test with literal filenames `0046_energy_analytics.sql` and `0046_tasks_source_context.sql`; expect `['0046']`.

- [x] **Step 2: Run the test and confirm RED**

Run: `node --test apps/orchestrator/scripts/release-db-contract.test.mjs`

Expected: failure because `findDuplicateMigrationNumbers` is not exported.

- [x] **Step 3: Implement the minimal duplicate-prefix detector**

Count four-digit prefixes for matching SQL filenames and return sorted prefixes whose count exceeds one.

- [x] **Step 4: Run the test and confirm GREEN**

Run: `node --test apps/orchestrator/scripts/release-db-contract.test.mjs`

Expected: all tests pass.

### Task 3: Integrate PR #61 with production history

**Files:**
- Merge: `origin/codex/trust-loop-round1` into this release branch.
- Resolve only genuine overlapping files while preserving both stock trust and production analytics contracts.
- Rename: `apps/orchestrator/drizzle/0046_tasks_source_context.sql` to `apps/orchestrator/drizzle/0047_tasks_source_context.sql`.

**Interfaces:**
- Consumes: PR #61 merge commit `514058a192a4ac746e82b67218e1d38a605a722a`.
- Produces: one release commit containing both production history and PR #61.

- [x] **Step 1: Merge the reviewed stock-trust branch without committing**

Run: `git merge --no-commit --no-ff origin/codex/trust-loop-round1`

Expected: either an automatically merged tree or explicit conflicts to resolve; no stock-trust files may be dropped.

- [x] **Step 2: Resolve conflicts by preserving both contracts**

For `verify-db-schema.ts`, keep energy analytics table checks and the `tasks.source_context` column check. For any other overlap, compare both parents and retain both independently tested behaviors.

- [x] **Step 3: Renumber the unapplied stock migration**

Rename `0046_tasks_source_context.sql` to `0047_tasks_source_context.sql`; keep SQL content unchanged.

- [x] **Step 4: Add the migration-set integration assertion**

Read the real `apps/orchestrator/drizzle` directory in the release-contract test and expect `findDuplicateMigrationNumbers(files)` to equal `[]`.

- [x] **Step 5: Commit the reconciled release**

Stage only merge resolutions, migration contract files, migration rename, and this plan. Commit with a release-reconciliation message.

### Task 4: Verify and publish the release branch

**Files:**
- No additional source changes expected.

**Interfaces:**
- Consumes: reconciled release tree.
- Produces: pushed branch and Ready pull request into `claude/musing-keller-ae1d05`.

- [x] **Step 1: Run orchestrator tests and build**

Run: `pnpm --filter @holaday/orchestrator test && pnpm --filter @holaday/orchestrator build`

Expected: all tests and build pass.

- [x] **Step 2: Run AkShare tests**

Run: `cd apps/akshare-mcp && python3 -m pytest`

Expected: all tests pass.

- [x] **Step 3: Run web tests and production build**

Run: `pnpm --filter @holaday/web-workbench test && pnpm --filter @holaday/web-workbench build`

Expected: all tests, ESLint, typecheck, and Vite build pass.

- [x] **Step 4: Run repository typecheck and diff checks**

Run: `pnpm typecheck && git diff --check && git status --short`

Expected: typecheck and diff check pass; status contains only intentional release files.

- [ ] **Step 5: Push and create a Ready PR**

Push `codex/stock-trust-release-reconcile`, create a PR targeting `claude/musing-keller-ae1d05`, and confirm GitHub reports it mergeable.

### Task 5: Merge, deploy, and verify production

**Files:**
- No source changes.

**Interfaces:**
- Consumes: merged active production branch.
- Produces: production AkShare, orchestrator, schema, and SPA at the reconciled commit.

- [ ] **Step 1: Merge the Ready reconciliation PR**

Confirm no failing checks, then merge without deleting the worktree branch.

- [ ] **Step 2: Deploy AkShare through the guarded script**

Run: `BRANCH=claude/musing-keller-ae1d05 ./scripts/deploy-current.sh akshare`

Expected: ancestor gate, health check, and real rankings smoke pass.

- [ ] **Step 3: Deploy application through the guarded script**

Run: `BRANCH=claude/musing-keller-ae1d05 ./scripts/deploy-current.sh application`

Expected: migration `0047`, schema verification, orchestrator restart, dual-origin SPA upload, and both public health checks pass.

- [ ] **Step 4: Verify production trust behavior**

Confirm production HEAD, schema column `tasks.source_context`, AkShare health counters, public health endpoints, and authenticated stock dashboard freshness/trust-state behavior. Stop and report if any P0 trust gate fails.
