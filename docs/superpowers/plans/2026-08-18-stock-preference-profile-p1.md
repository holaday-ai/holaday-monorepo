# Stock Preference Profile P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Execute serially; do not create subagents.

**Goal:** Add an explainable, editable stock-preference profile that summarizes the user's explicit screening conditions and watchlist behavior without turning those observations into suitability, risk-tolerance, or investment-advice claims.

**Architecture:** Persist only canonical screening criteria and explicit profile controls in two additive MySQL tables. A pure deterministic domain builder combines post-clear watchlist rows, successful screening signals from a bounded 90-day window, and user-authored preference tags into facts, possible strengths, blind spots, supplementary research perspectives, confidence, and source evidence. Protected tRPC procedures expose read/update/clear controls. A React card sits directly after condition screening and refreshes after successful screenings or watchlist changes.

**Tech Stack:** TypeScript 5.7, Drizzle/MySQL, tRPC, React 18, Vitest, Testing Library, pnpm.

## Global Constraints

- Work only in `/Users/yaleiqi/holaday-monorepo/.worktrees/stock-preference-profile` on `codex/stock-preference-profile`.
- Follow strict red-green-refactor for every behavior change.
- Use one agent and serial execution; do not spawn subagents or run independent test processes in parallel.
- The profile may use only explicit user settings, current watchlist structure after the most recent clear, and successful canonical screening criteria from the last 90 days.
- Never persist the natural-language screening prompt, candidate list, portfolio size, account balance, income, debt, free text from notes, or inferred risk tolerance.
- Never describe the user as smart, conservative, aggressive, suitable, or unsuitable. Never produce buy/sell/hold, target-price, return, timing, or recommendation language.
- `clear` resets prior profile evidence without deleting watchlist rows. Existing watchlist rows are excluded with a `cleared_at` cutoff; future explicit behavior can rebuild the profile.
- Recording preference evidence is best effort and must never make an otherwise successful screening fail.
- The profile must show its 90-day window, sample counts, confidence basis, sources, and controls. Low sample volume is labeled `样本不足`, not converted into a confident conclusion.
- Manual preference values are bounded server-side. Screening signals use server-canonical field/operator/value records and a per-user dedupe hash.
- Do not modify unrelated browser, extension, payment, video, image, Today Energy, TaskStream, evidence-ledger, `.claude/`, `qa-artifacts/`, or `skills/*` work.
- After verification, push and create a ready pull request under the established completed-branch workflow. Merge and production deployment follow the authorization already given for this sequence.

---

### Task 1: Additive Preference Storage

**Files:**
- Create: `apps/orchestrator/src/db/schema/stock-preferences.ts`
- Create: `apps/orchestrator/src/db/schema/stock-preferences.test.ts`
- Create: `apps/orchestrator/drizzle/0048_stock_preference_profiles.sql`
- Modify: `apps/orchestrator/src/db/schema/index.ts`

- [x] Write a failing schema contract test for one profile row per user, post-clear cutoff, canonical signal payload, per-user dedupe, and cascade deletion.
- [x] Run the single test and verify RED because the schema module does not exist.
- [x] Add `stock_preference_profiles` with `user_id`, `enabled`, `manual_preferences_json`, `cleared_at`, and timestamps.
- [x] Add `stock_preference_signals` with `user_id`, `kind`, `dedupe_hash`, `payload_json`, `data_as_of`, `occurred_at`, and timestamps; index the user/time query path and make `(user_id, dedupe_hash)` unique.
- [x] Add migration `0048` using additive `CREATE TABLE` statements only, export the schema, and verify the schema contract GREEN.

### Task 2: Deterministic Profile Builder

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-preference-profile.ts`
- Create: `apps/orchestrator/src/stocks/stock-preference-profile.test.ts`

- [x] Write failing tests for empty, disabled, low/medium/high confidence, 90-day filtering, post-clear watchlist filtering, manual overrides, repeated canonical screening fields, market concentration, single-factor concentration, missing liquidity/cash-flow/holding-period perspectives, and prohibited language.
- [x] Verify RED because the builder does not exist.
- [x] Implement exhaustive field-to-dimension mapping for valuation, profitability quality, growth, volatility, liquidity, and event preference; keep industry, market cap, cash flow, and holding period manual-only until supported by explicit data.
- [x] Produce bounded `facts`, `possibleStrengths`, `blindSpots`, `supplementaryViews`, and `basis` arrays with stable IDs and deterministic order.
- [x] Compute confidence from sample volume and independent source families; return `insufficient`, `low`, `medium`, or `high` with a plain-language basis.
- [x] Run the profile builder tests GREEN and check output contains no suitability or recommendation claims.

### Task 3: Repository, Recording, and Protected Procedures

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-preference-repository.ts`
- Create: `apps/orchestrator/src/stocks/stock-preference-repository.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-preferences.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-preferences.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`

- [x] Write failing repository tests for loading the bounded window, filtering watchlist rows after `cleared_at`, upserting manual controls, disabling/enabling, clearing signals, and deduplicating successful screening evidence.
- [x] Write failing procedure tests for caller ownership, server-side value bounds, read/update/clear response shapes, and safe logs.
- [x] Implement repository methods and the three protected stocks procedures: `preferenceProfile`, `updatePreferenceProfile`, and `clearPreferenceProfile`.
- [x] After `runTrustedStockScreening` succeeds, record only canonical criteria, `snapshotId`, and `dataAsOf`; catch storage errors, log bounded metadata, and still return the screening result.
- [x] Ensure clear deletes stored signals and advances `cleared_at`, while leaving `watchlists` untouched.
- [x] Run repository, procedure, screening, watchlist, and trust-context tests GREEN.

### Task 4: Editable Stocks-Page Profile

**Files:**
- Create: `apps/web-workbench/src/components/stocks/StockPreferenceProfile.tsx`
- Create: `apps/web-workbench/src/components/stocks/StockPreferenceProfile.test.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/stock-tasks-layout.test.ts`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.test.ts`

- [x] Write failing component tests for loading, empty, disabled, ready, and error states; confidence/window/sample disclosure; facts/strengths/blind-spots/supplements; native tooltips; edit; disable/enable; two-step clear confirmation; and mobile-safe controls.
- [x] Write failing integration/layout tests that place the profile after condition screening and refresh it after a successful screening or watchlist mutation.
- [x] Implement a compact white workbench card with the existing red-neutral stocks palette, explicit `可能优势`/`潜在盲点` wording, and a Sheet-based bounded preference editor.
- [x] Make controls keyboard accessible, add both `aria-label` and native `title` to icon-only controls, and use text plus color for states.
- [x] Explicitly state that clearing the profile does not remove watched stocks and that the profile neither changes screening conditions nor triggers trades.
- [x] Run component and stocks-page suites GREEN.

### Task 5: Verification, Review, Delivery, and Production Acceptance

- [ ] Run touched stock tests, both package full suites, monorepo typecheck, Orchestrator build, Web lint/typecheck/build, migration/schema checks, and `git diff --check`.
- [ ] Review privacy boundaries, canonical-signal recording, clear semantics, error isolation, deterministic copy, accessibility, mobile layout, and prohibited recommendation/suitability language.
- [ ] Commit intentionally, push `codex/stock-preference-profile`, and create a ready PR with exact verification evidence.
- [ ] Merge after a clean final review, deploy `application` only, and verify both health endpoints, live commit/bundle, migration presence, authenticated profile read/update/disable/enable/clear behavior, screening-triggered refresh, and zero console errors.
- [ ] Do not use `gh`; use the connected GitHub capability for PR operations.
