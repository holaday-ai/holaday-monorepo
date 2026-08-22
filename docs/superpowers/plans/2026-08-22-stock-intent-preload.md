# Stock Intent Preload Implementation Plan

**Goal:** Reduce authenticated in-app navigation time to `/stocks` by warming only the lazy route module when the user points at or focuses the stock navigation item, while preserving fresh stock-data requests for the actual navigation.

**Architecture:** Keep the trusted stock-data handoff introduced by PR #122. Add a cached, rejection-safe route-module preload that does not call protected stock APIs by itself. The sidebar invokes this module-only preload on pointer intent and keyboard focus; React's lazy loader starts fresh initial data only when navigation actually renders `/stocks`, then reuses the already-loaded route promise.

**Tech Stack:** React 18, React Router, TypeScript, tRPC client, Vitest.

**Production evidence:** Four preference-profile checks on 2026-08-22 completed in 1,804ms for the first sample and 744–856ms for warm samples, so the earlier 14.6-second observation is not currently reproducible and does not justify backend query changes. Direct `/stocks` navigation still spends a median 1,974ms reaching the stock shell, making route-module intent preload the narrower evidenced target.

## Constraints

- Pointer hover/focus must not call watchlist, briefing-status, or dashboard APIs.
- Initial `/stocks` navigation must still start those three requests exactly once.
- Keep the 30-second prepared-data expiry, trading-date trust envelope, manual refresh, and 20-second background refresh unchanged.
- Do not preload the preference profile, create stock tasks, or write browser storage.
- Execute with one agent, serially.

## Task 1: Add a module-only preload contract

**Files:**
- Modify: `apps/web-workbench/src/lib/stock-page-preload.ts`
- Modify: `apps/web-workbench/src/lib/stock-page-preload.test.ts`

- [x] Add a failing test proving that route preload is promise-deduplicated and starts zero protected data requests.
- [x] Add a failing assertion proving the lazy route loader reuses the warmed route while starting one initial request set.
- [x] Implement a cached route promise with rejection recovery.
- [x] Keep `loadStockTasksPageRoute()` responsible for preparing fresh data at actual route render.
- [x] Run the focused preload test green.

## Task 2: Wire sidebar user intent

**Files:**
- Modify: `apps/web-workbench/src/lib/sidebar-feature-nav.ts`
- Modify: `apps/web-workbench/src/lib/sidebar-feature-nav.test.ts`
- Modify: `apps/web-workbench/src/components/Sidebar.tsx`

- [x] Add a small tested helper for optional feature-navigation preload actions.
- [x] Assign the module-only stock preload to the `/stocks` feature item.
- [x] Trigger it on pointer enter and keyboard focus without changing click/navigation behavior.
- [x] Run focused sidebar and stock preload tests green.

## Task 3: Verify and release

- [x] Run the full web-workbench test suite.
- [x] Run lint, typecheck, production build, and `git diff --check`.
- [x] Review the final diff for trust, duplicate-request, and bundle-size regressions.
- [ ] Commit, push, create a ready PR, inspect review threads, merge, and deploy application.
- [ ] In authenticated production, compare no-intent and hover/focus-intent navigation, verify 08/21 trusted data, risk 5/5, and zero console warning/error.
- [ ] Record measured results in `docs/daily/SESSION_STATUS.md` through a documentation-only PR.

## Self-review

- The plan separates code preload from data preload so user intent cannot consume stock APIs unnecessarily.
- Direct URLs retain PR #122 behavior; only in-app intent gains an earlier route-module start.
- No database, schema, production configuration, secrets, payments, AkShare, DivineAPI, Translator, or OpenAI key changes are in scope.
