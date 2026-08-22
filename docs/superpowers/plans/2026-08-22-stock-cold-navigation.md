# Stock Cold Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the serial route-chunk-to-dashboard-request waterfall when opening `/stocks`, while preserving the existing trusted-date and degraded-state behavior.

**Architecture:** A small route preload module starts the three existing initial stock requests immediately when React begins loading the lazy stock route. `StockTasksPage` consumes that prepared request set when it mounts, so route code and data travel in parallel instead of serially. Manual/background refreshes remain fresh requests, and no response is persisted in browser storage.

**Tech Stack:** React 18, React Router, tRPC client, TypeScript, Vitest.

**Spec:** Production investigation on 2026-08-22: four same-session navigations showed the stock page shell at 1,528–1,970ms and trusted 08/21 content at 2,531–3,427ms. `App.tsx` lazy-loads `StockTasksPage`, while its initial tRPC calls begin only in the page mount effect, establishing a serial waterfall.

## Global Constraints

- Keep current trading-day/latest-available labels and trust envelopes unchanged.
- Do not cache stock data in localStorage, sessionStorage, or another cross-session browser store.
- Do not prefetch the slow preference profile or create stock tasks.
- Preserve manual and 20-second background refresh behavior.
- Execute with one agent, serially.

---

### Task 1: Parallelize stock route code and initial data

**Files:**
- Create: `apps/web-workbench/src/lib/stock-page-preload.ts`
- Create: `apps/web-workbench/src/lib/stock-page-preload.test.ts`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`

**Interfaces:**
- Produces: `prepareStockPageInitialRequests()`, `consumeStockPageInitialRequests()`, `createStockPageInitialRequests()`, and `loadStockTasksPageRoute()`.
- Consumes: `trpc.watchlists.list.query()`, `trpc.watchlists.briefingStatus.query()`, and `trpc.stocks.dashboardSnapshot.query()`.

- [x] **Step 1: Write the failing request-handoff tests**

```ts
it('hands the route-prepared request set to the page without starting duplicates', async () => {
  const prepared = prepareStockPageInitialRequests();
  const consumed = consumeStockPageInitialRequests();
  expect(consumed).toBe(prepared);
  await expect(consumed.dashboard).resolves.toEqual(dashboardFixture);
  expect(callCounts).toEqual({ watchlist: 1, briefing: 1, dashboard: 1 });
});

it('starts a fresh request set after the prepared set is consumed', () => {
  prepareStockPageInitialRequests();
  consumeStockPageInitialRequests();
  consumeStockPageInitialRequests();
  expect(callCounts).toEqual({ watchlist: 2, briefing: 2, dashboard: 2 });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-page-preload.test.ts`

Expected: FAIL because the preload module and exports do not exist.

- [x] **Step 3: Implement the request handoff and route loader**

```ts
export function loadStockTasksPageRoute() {
  prepareStockPageInitialRequests();
  return import('@/pages/StockTasksPage');
}
```

The prepared request object contains the three existing promises. Attach a rejection observer immediately so a fast failure cannot become unhandled while the lazy route is still downloading. `consumeStockPageInitialRequests()` returns the prepared object once and clears the slot; without a prepared object it creates a fresh one. Discard a prepared request set after 30 seconds so an interrupted navigation cannot later surface an old snapshot.

- [x] **Step 4: Consume the prepared set only for initial load**

In `StockTasksPage.loadPageData`, use `consumeStockPageInitialRequests()` for `mode === 'initial'`; use `createStockPageInitialRequests()` for manual/background refresh. Preserve the existing state updates and error copy.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-page-preload.test.ts src/pages/StockTasksPage.test.ts src/pages/stock-tasks-layout.test.ts`

Expected: all focused files pass.

- [x] **Step 6: Run full verification**

Run: `pnpm --filter @holaday/web-workbench exec vitest run --reporter=dot`

Run: `pnpm --filter @holaday/web-workbench build`

Run: `git diff --check`

Expected: all tests, lint, typecheck, build, and diff checks pass.

- [x] **Step 7: Commit**

```bash
git add apps/web-workbench/src/lib/stock-page-preload.ts \
  apps/web-workbench/src/lib/stock-page-preload.test.ts \
  apps/web-workbench/src/App.tsx \
  apps/web-workbench/src/pages/StockTasksPage.tsx \
  docs/superpowers/plans/2026-08-22-stock-cold-navigation.md
git commit -m "perf(stocks): parallelize route and initial data"
```

### Task 2: Verify the production user journey

**Files:**
- Modify after deployment: `docs/daily/SESSION_STATUS.md`

**Interfaces:**
- Consumes: deployed `/stocks` page and the existing authenticated browser session.
- Produces: comparable route-shell, trusted-content, risk-prewarm, console, and screenshot evidence.

- [ ] **Step 1: Merge and deploy the verified application PR**

Use the existing `application` deployment path and its blocking release gates.

- [ ] **Step 2: Repeat the same four-sample browser timing loop**

Flow: `/cosmic` or a fresh `/stocks` navigation → stock page shell → trusted 08/21 content → hidden risk panel ready.

Expected: trusted stock content no longer waits for route import plus data sequentially; no framework overlay or relevant console warning/error appears.

- [ ] **Step 3: Record the production result**

Update the top production ref and timing evidence in `docs/daily/SESSION_STATUS.md`, merge the documentation-only PR, and do not redeploy it.

## Self-Review

- Spec coverage: route/data waterfall, trust preservation, refresh behavior, full verification, deployment, and production timing are covered.
- Placeholder scan: no TBD/TODO/implicit implementation steps remain.
- Type consistency: request-set names are identical across producer, route loader, page consumer, tests, and handoff.
