# Stock Screening P0 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production condition screening return within a bounded wait, fail closed when event evidence is unavailable, and present matches, evidence, and preference insights in a clear task-first hierarchy.

**Architecture:** The orchestrator will fetch only sources required by the confirmed criteria, cap each deep-source wait, and treat an upstream no-data sentinel as missing rather than proof of a negative event. Candidates that satisfy every confirmed criterion will receive a second, bounded risk-enrichment pass; incomplete candidates will not load unrelated risk sources. The workbench will show exact matches first, collapse secondary outcomes, render evidence as readable rows, and place the preference profile after the active screening task.

**Tech Stack:** TypeScript, React, tRPC, Vitest, Testing Library, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-08-16-stock-task-trust-workbench-design.md`

## Global Constraints

- Current-trading-day/latest-available data remains a product-trust P0.
- Missing or timed-out evidence must fail closed and must never become a positive match.
- Screening is explanatory research, not investment advice or a recommendation.
- Preserve unrelated `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md` drafts.
- Execute serially with one agent.

---

### Task 1: Bound deep-source latency and correct negative-event evidence

**Files:**
- Modify: `apps/orchestrator/src/stocks/stock-screening-service.ts`
- Test: `apps/orchestrator/src/stocks/stock-screening-service.test.ts`

**Interfaces:**
- Consumes: `StockScreeningClient`, confirmed `StockScreenCriterion[]`, current `snapshotId` and `dataAsOf`.
- Produces: `runStockScreening()` results where stalled sources become missing, valid empty insider-event results are dated to the query cutoff, and unrelated risk endpoints are loaded only for exact matches under the same source budget.

- [x] **Step 1: Write failing latency and trust tests**

Add tests that use a never-resolving insider request with a 5 ms source budget, a sentinel source `akshare:stock_share_hold_change(无数据)`, and a valid empty exchange source. Assert that the run settles, the stalled/sentinel criterion is missing, and the valid empty result matches with `asOf === dataAsOf`.

- [x] **Step 2: Verify the tests fail for the expected reasons**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-screening-service.test.ts`

Expected: FAIL because `runStockScreening` has no source budget, sentinel no-data currently matches, and valid empty insider evidence has `asOf: null`.

- [x] **Step 3: Write the minimal bounded-source implementation**

Add a default 4,000 ms deep-source budget, load only fundamentals and/or insider data required by the confirmed criteria, return a safe error envelope on budget expiry, raise candidate concurrency from four to eight, and date valid empty insider lookbacks with `dataAsOf`. After criteria evaluation, load bounded pledge, goodwill, forecast, insider, and announcement signals only for exact matches so warning coverage is preserved without penalizing incomplete candidates.

- [x] **Step 4: Verify the backend tests pass**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-screening-service.test.ts`

Expected: PASS with no unhandled promise rejection or timer warning.

### Task 2: Make results scannable and evidence readable

**Files:**
- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx`
- Test: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx`

**Interfaces:**
- Consumes: the existing grouped screening result and candidate evidence array.
- Produces: exact matches visible by default, secondary result groups behind native disclosure controls, and non-truncated evidence rows with explicit source dates.

- [x] **Step 1: Write failing result-hierarchy tests**

Render one exact, one missing, and one unmet candidate. Assert that only the exact candidate is initially visible, that the missing/unmet group summaries expose their counts, that opening a group reveals its candidates, and that an evidence row shows a full technical source plus an explicit date or availability message.

- [x] **Step 2: Verify the tests fail**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx`

Expected: FAIL because all candidates are currently expanded and evidence is rendered as truncated inline text.

- [x] **Step 3: Implement the result grouping and evidence rows**

Render exact candidates in the primary list. Render missing and unmet candidates inside separate `<details>` groups; when there are zero exact matches, open the missing-data group initially. Replace truncated evidence lines with two-line rows: criterion label/date first and breakable technical source second. Add copy clarifying that screening only verifies confirmed conditions and that full risk review lives in Risk Evidence.

- [x] **Step 4: Verify the workbench tests pass**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx`

Expected: PASS.

### Task 3: Restore task-first screening hierarchy

**Files:**
- Modify: `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.tsx`
- Test: `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.test.tsx`

**Interfaces:**
- Consumes: screening and preference-profile React nodes.
- Produces: one uninterrupted screening column followed by the secondary preference profile.

- [x] **Step 1: Write a failing layout test**

Assert that the screening task container uses a single-column stack in idle, criteria, and results states and never applies the `xl:grid-cols-[minmax(0,1fr)_340px]` split.

- [x] **Step 2: Verify the test fails**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockWorkbenchLayout.test.tsx`

Expected: FAIL in idle/criteria because the profile currently competes in a right-side column.

- [x] **Step 3: Implement the single-column hierarchy**

Render screening first and preference profile second with consistent vertical spacing. Preserve the existing component styling and navigation.

- [x] **Step 4: Verify the layout tests pass**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockWorkbenchLayout.test.tsx`

Expected: PASS.

### Task 4: Release verification

**Files:**
- Verify only; no additional production files.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: a reviewed branch, production deployment, and an end-to-end timing/trust report.

- [x] **Step 1: Run targeted and package gates**

Run orchestrator screening tests, web stock component tests, targeted typechecks, Biome on touched files, and `git diff --check`.

- [x] **Step 2: Verify the local rendered flow**

Use the authenticated stock route to confirm condition confirmation, bounded loading, result grouping, readable evidence, and preference placement at desktop and mobile widths.

- [ ] **Step 3: Commit, push, create a PR, and complete review**

Commit only the planned files and the plan. Push `codex/stock-screening-p0-ux`, create a pull request, resolve actionable review feedback, and merge only under the user’s standing release authorization.

- [ ] **Step 4: Deploy and verify production**

Deploy application/orchestrator as required, then repeat the same production screening query. Record actual elapsed time, trusted data date, missing-data behavior, result evidence readability, and service health.
