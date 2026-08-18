# Stock Task Workbench P1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the stock page into a task-centered workbench that uses the full desktop width, groups risk events by stock, compresses the preference profile, expands active screening results, and moves deterministic market context below the core tasks.

**Architecture:** Keep every existing server query, snapshot contract, polling loop, and mutation unchanged. Add small pure presentation helpers for stock risk and discovery relevance, expose one read-only screening view-state callback, add a compact profile presentation, and compose the existing page modules through two layout-only React components.

**Tech Stack:** React 18, TypeScript 5.7, Tailwind CSS, tRPC client, Vitest 2.1, Testing Library, Vite 6.

## Global Constraints

- Preserve `stockDashboardTrustState`, `stockTemporalCopy`, `snapshotId`, `dataAsOf`, evidence IDs, and all current historical/unavailable copy boundaries.
- Do not add database tables, migrations, server routes, environment variables, network requests, recommendation scores, suitability judgments, or transaction behavior.
- Do not infer relevance from clicks, dwell time, the preference profile, or natural-language prompt text.
- Keep existing watchlist, briefing, screening, profile, Sheet, news-reader, and task-navigation actions functional.
- All behavior changes follow RED → GREEN → REFACTOR; production code is not edited before the corresponding test fails.
- Run serially with one agent; do not create subagents.
- Preserve unrelated `.claude/`, `qa-artifacts/`, `skills/*`, and `docs/PHASE1_PLAYBOOK_EVIDENCE_LEDGER_DESIGN.md` files.

---

## File Structure

**Create**

- `apps/web-workbench/src/lib/stock-risk-presentation.ts` — pure risk grouping and stable sorting.
- `apps/web-workbench/src/lib/stock-risk-presentation.test.ts` — presentation-helper contract.
- `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.tsx` — layout-only composition for task and market sections.
- `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.test.tsx` — responsive spans and DOM order.
- `apps/web-workbench/src/components/DiscoveryNewsCard.test.tsx` — deterministic relevance-label rendering.

**Modify**

- `apps/web-workbench/src/components/stocks/StockRiskRadar.tsx` — render one group per stock and event-level evidence.
- `apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx` — grouped interaction coverage.
- `apps/web-workbench/src/components/stocks/StockPreferenceProfile.tsx` — compact presentation and complete-profile Sheet.
- `apps/web-workbench/src/components/stocks/StockPreferenceProfile.test.tsx` — compact/full behavior and control preservation.
- `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx` — expose `idle / criteria / results` and preserve results on failed preview.
- `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx` — view-state and failure-state coverage.
- `apps/web-workbench/src/lib/stock-discovery.ts` — deterministic default feed and explicit watchlist-symbol relevance.
- `apps/web-workbench/src/lib/stock-discovery.test.ts` — default-feed and relevance rules.
- `apps/web-workbench/src/components/DiscoveryNewsCard.tsx` — render the explicit relevance marker.
- `apps/web-workbench/src/pages/StockTasksPage.tsx` — task-first ordering, new layouts, screening span state, and market-context placement.
- `apps/web-workbench/src/pages/stock-tasks-layout.test.ts` — source-level trust and ordering gates.
- `apps/web-workbench/src/pages/StockTasksPage.test.ts` — page contract assertions that remain valuable after the reordering.

---

### Task 1: Group risk signals by stock

**Files:**

- Create: `apps/web-workbench/src/lib/stock-risk-presentation.ts`
- Create: `apps/web-workbench/src/lib/stock-risk-presentation.test.ts`
- Modify: `apps/web-workbench/src/components/stocks/StockRiskRadar.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx`

**Interfaces:**

- Produces:

```ts
export type StockRiskSeverity = '高风险' | '警示' | '关注';

export interface GroupableStockRiskSignal {
  signalId: string;
  symbol: string;
  name: string;
  severity: StockRiskSeverity;
  sourceDataAsOf: string | null;
}

export interface StockRiskSignalGroup<T extends GroupableStockRiskSignal> {
  symbol: string;
  name: string;
  severity: StockRiskSeverity;
  latestSourceDataAsOf: string | null;
  signals: T[];
}

export function groupStockRiskSignals<T extends GroupableStockRiskSignal>(
  signals: readonly T[],
): StockRiskSignalGroup<T>[];
```

- Consumes: `StockRiskRadarResult['signals']` without changing the tRPC response.

- [ ] **Step 1: Write the failing helper test**

Add tests proving that two signals for `600001` become one group, the group severity is `高风险`, event order is severity then date, group order is severity then latest date then symbol, and the input array is not mutated.

```ts
expect(groupStockRiskSignals(signals).map((group) => ({
  symbol: group.symbol,
  severity: group.severity,
  eventIds: group.signals.map((signal) => signal.signalId),
}))).toEqual([
  { symbol: '600001', severity: '高风险', eventIds: ['high-new', 'warning-old'] },
  { symbol: '000002', severity: '关注', eventIds: ['attention'] },
]);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/stock-risk-presentation.test.ts
```

Expected: FAIL because `groupStockRiskSignals` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Use a `Map<string, T[]>`, a severity-rank constant, ISO-date lexical comparison with `null` last, and copied arrays. Do not discard duplicate facts or evidence.

- [ ] **Step 4: Write the failing component interaction test**

Change `StockRiskRadar.test.tsx` to expect two `data-testid="risk-stock-group"` articles rather than three event cards. Assert that `测试股份` shows `2 条事项`, only the first two event summaries are present by default, and `查看全部 3 条` reveals the remaining event while every event still has an independent `查看依据` button.

- [ ] **Step 5: Run the component test and verify RED**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockRiskRadar.test.tsx
```

Expected: FAIL because the component still renders one article per signal.

- [ ] **Step 6: Render grouped cards and event details**

Replace `result.signals.map` with `groupStockRiskSignals(result.signals).map`. Keep group expansion and evidence expansion as separate state:

```ts
const [expandedGroupSymbol, setExpandedGroupSymbol] = React.useState<string | null>(null);
const [expandedSignalId, setExpandedSignalId] = React.useState<string | null>(null);
```

The group card shows its worst severity, latest fact date, event count, two event rows by default, and all rows after expansion. Event rows retain fact, why-relevant copy, trigger, source, fetched time, evidence ID, and URL.

- [ ] **Step 7: Run focused tests and refactor while green**

Run:

```bash
pnpm exec vitest run src/lib/stock-risk-presentation.test.ts src/components/stocks/StockRiskRadar.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add apps/web-workbench/src/lib/stock-risk-presentation.ts apps/web-workbench/src/lib/stock-risk-presentation.test.ts apps/web-workbench/src/components/stocks/StockRiskRadar.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx
git commit -m "feat(stocks): group risk events by stock"
```

---

### Task 2: Add the compact preference profile

**Files:**

- Modify: `apps/web-workbench/src/components/stocks/StockPreferenceProfile.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockPreferenceProfile.test.tsx`

**Interfaces:**

- Produces:

```ts
type StockPreferencePresentation = 'full' | 'compact';

export function StockPreferenceProfile(props: {
  refreshKey?: number;
  api?: StockPreferenceProfileApi;
  presentation?: StockPreferencePresentation;
}): JSX.Element;
```

- The default remains `full`; `StockTasksPage` will pass `presentation="compact"` in Task 5.

- [ ] **Step 1: Write the failing compact-mode test**

Render a profile with four facts, two strengths, two blind spots, and two supplementary views. Assert compact mode shows at most three facts and one item from each summary group, does not render `依据与控制` inline, and exposes a `查看完整画像` button.

```tsx
render(<StockPreferenceProfile api={api} presentation="compact" />);
expect(await screen.findByText('事实 1')).toBeTruthy();
expect(screen.queryByText('事实 4')).toBeNull();
expect(screen.queryByText('依据与控制')).toBeNull();
expect(screen.getByRole('button', { name: '查看完整画像' })).toBeTruthy();
```

- [ ] **Step 2: Run the compact test and verify RED**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockPreferenceProfile.test.tsx
```

Expected: FAIL because the `presentation` prop and complete-profile control do not exist.

- [ ] **Step 3: Implement compact ready content**

Keep the existing full `ReadyProfile`. Add `CompactReadyProfile` that uses server order and `slice` only:

```ts
const facts = profile.facts.slice(0, 3);
const strength = profile.possibleStrengths[0] ?? null;
const blindSpot = profile.blindSpots[0] ?? null;
const supplement = profile.supplementaryViews[0] ?? null;
```

The compact section keeps confidence, 90-day sample counts, refresh, pause, edit, and the non-advice footer.

- [ ] **Step 4: Add a complete-profile Sheet and test it**

Clicking `查看完整画像` opens a Sheet named `完整选股画像` containing the existing full facts, strengths, blind spots, supplementary views, and basis. Closing restores focus to the trigger. The existing `调整选股偏好` Sheet remains independent.

- [ ] **Step 5: Run the profile suite and verify GREEN**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockPreferenceProfile.test.tsx
```

Expected: all tests PASS, including pause/resume, editing, two-step clear, stale-request protection, and delayed refresh.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/web-workbench/src/components/stocks/StockPreferenceProfile.tsx apps/web-workbench/src/components/stocks/StockPreferenceProfile.test.tsx
git commit -m "feat(stocks): add compact preference summary"
```

---

### Task 3: Expose screening layout state without changing screening semantics

**Files:**

- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx`

**Interfaces:**

- Produces:

```ts
export type StockScreeningViewState = 'idle' | 'criteria' | 'results';

onViewStateChange?: (state: StockScreeningViewState) => void;
```

- Task 5 consumes this callback to choose the grid span.

- [ ] **Step 1: Write the failing view-state test**

Render with `onViewStateChange={vi.fn()}` and assert transitions:

```ts
expect(onViewStateChange).toHaveBeenLastCalledWith('idle');
await user.click(screen.getByRole('button', { name: '识别条件' }));
await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('criteria'));
await user.click(screen.getByRole('button', { name: '按这些条件查找' }));
await waitFor(() => expect(onViewStateChange).toHaveBeenLastCalledWith('results'));
await user.click(screen.getByRole('button', { name: '清空筛选条件' }));
expect(onViewStateChange).toHaveBeenLastCalledWith('idle');
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx
```

Expected: FAIL because the callback is not accepted or called.

- [ ] **Step 3: Derive and publish state**

Derive state from existing trusted UI state and notify from an effect:

```ts
const viewState: StockScreeningViewState = result
  ? 'results'
  : criteria.length > 0
    ? 'criteria'
    : 'idle';

React.useEffect(() => {
  onViewStateChange?.(viewState);
}, [onViewStateChange, viewState]);
```

Do not put layout state into the screening API.

- [ ] **Step 4: Write the failing result-preservation test**

After one successful run, make the next `preview` reject. Assert the previous `完整符合` result remains visible and the new error is shown. This protects the specification that a transient preview failure must not erase a trustworthy result.

- [ ] **Step 5: Run the preservation test and verify RED**

Expected: FAIL because `preview()` currently calls `setResult(null)` before the request succeeds.

- [ ] **Step 6: Move result clearing to the successful preview path**

Remove the eager `setResult(null)`. After `api.preview(trimmed)` resolves, set criteria/unparsed clauses and then clear the old result. Existing criterion edits continue to clear results immediately because they change the confirmed query.

- [ ] **Step 7: Run the screening suite and verify GREEN**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockScreeningWorkbench.test.tsx src/components/stocks/stock-screening-state.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx
git commit -m "feat(stocks): expose screening view state"
```

---

### Task 4: Make market context deterministically relevant

**Files:**

- Modify: `apps/web-workbench/src/lib/stock-discovery.ts`
- Modify: `apps/web-workbench/src/lib/stock-discovery.test.ts`
- Create: `apps/web-workbench/src/components/DiscoveryNewsCard.test.tsx`
- Modify: `apps/web-workbench/src/components/DiscoveryNewsCard.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`

**Interfaces:**

- Produces:

```ts
export type StockDiscoveryFeed =
  | '全部'
  | '自选股新闻'
  | '重要公告'
  | 'A股要闻'
  | '美股要闻'
  | '港股要闻';

export function preferredStockDiscoveryFeed(
  counts: Readonly<Record<Exclude<StockDiscoveryFeed, '全部'>, number>>,
): StockDiscoveryFeed;

export function isExplicitWatchlistNews(
  newsSymbols: readonly string[],
  watchlistSymbols: readonly string[],
): boolean;
```

- `DiscoveryNewsCard` accepts `relatedToWatchlist?: boolean`.
- `DiscoveryPanel` accepts `watchlistSymbols: readonly string[]`.

- [ ] **Step 1: Write failing pure-helper tests**

Assert the default order `自选股新闻 > 重要公告 > A股要闻 > 全部`; US/HK-only content does not outrank A-share news; symbol comparison trims and uppercases values; empty symbol arrays are never related.

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
pnpm exec vitest run src/lib/stock-discovery.test.ts
```

Expected: FAIL because both helpers are missing.

- [ ] **Step 3: Implement deterministic helpers**

Use counts only for default selection and exact normalized symbol intersection only for relevance. Do not consume the preference profile or browser behavior.

- [ ] **Step 4: Write the failing news-card test**

Render the same real news row with `relatedToWatchlist` false and true. Assert `与你的关注相关` appears only for true and the card remains keyboard-activatable.

- [ ] **Step 5: Run the card test and verify RED**

Run:

```bash
pnpm exec vitest run src/components/DiscoveryNewsCard.test.tsx
```

Expected: FAIL because the prop and label do not exist.

- [ ] **Step 6: Wire relevance into the panel**

Rename the visible section title to `市场动态`. Use a ref to protect user choice:

```ts
const userSelectedFeed = React.useRef(false);

React.useEffect(() => {
  if (!userSelectedFeed.current) setActiveFeed(preferredFeed);
}, [preferredFeed]);
```

When a tab is clicked, set `userSelectedFeed.current = true`. Pass `relatedToWatchlist={isExplicitWatchlistNews(item.symbols, watchlistSymbols)}` to each card. `StockTasksPage` passes normalized symbols from the real watchlist.

- [ ] **Step 7: Run discovery and card tests and verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/stock-discovery.test.ts src/components/DiscoveryNewsCard.test.tsx src/pages/stock-tasks-layout.test.ts
```

Expected: all tests PASS after updating the title assertion.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/web-workbench/src/lib/stock-discovery.ts apps/web-workbench/src/lib/stock-discovery.test.ts apps/web-workbench/src/components/DiscoveryNewsCard.tsx apps/web-workbench/src/components/DiscoveryNewsCard.test.tsx apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-tasks-layout.test.ts
git commit -m "feat(stocks): prioritize explicit market relevance"
```

---

### Task 5: Compose the task-first responsive page

**Files:**

- Create: `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.tsx`
- Create: `apps/web-workbench/src/components/stocks/StockWorkbenchLayout.test.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/stock-tasks-layout.test.ts`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.test.ts`

**Interfaces:**

- Consumes: `StockScreeningViewState` from Task 3.
- Produces:

```tsx
export function StockTaskWorkspaceLayout(props: {
  highlights: React.ReactNode;
  riskRadar: React.ReactNode;
  screening: React.ReactNode;
  preferenceProfile: React.ReactNode;
  briefing: React.ReactNode;
  screeningView: StockScreeningViewState;
}): JSX.Element;

export function StockMarketContextLayout(props: {
  discovery: React.ReactNode;
  temperature: React.ReactNode;
  sectors: React.ReactNode;
  leaderboard: React.ReactNode;
  marketTable: React.ReactNode;
  starStocks: React.ReactNode;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing layout-component test**

Render labeled test nodes and assert DOM order: highlights, risk, screening, profile, briefing. In idle mode assert screening has `lg:col-span-7` and profile has `lg:col-span-5`; in results mode both have `lg:col-span-12`. Assert market context follows its `市场背景` heading and uses an explicit 12-column grid rather than a page-long sidebar.

- [ ] **Step 2: Run the layout test and verify RED**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockWorkbenchLayout.test.tsx
```

Expected: FAIL because the layout components do not exist.

- [ ] **Step 3: Implement layout-only components**

The components accept only React nodes and the screening view state. They do not query data or own product behavior. Use `min-w-0`, `grid-cols-1`, `lg:grid-cols-12`, and explicit span wrappers. The market layout contains a visible `h2` named `市场背景`.

- [ ] **Step 4: Write the failing page-order test**

Update `stock-tasks-layout.test.ts` to assert:

```ts
expect(source.indexOf('<StockTaskWorkspaceLayout')).toBeLessThan(
  source.indexOf('<StockMarketContextLayout'),
);
expect(source).not.toContain("xl:grid-cols-[minmax(0,1fr)_320px]");
expect(source).toContain('presentation="compact"');
expect(source).toContain('onViewStateChange={setScreeningView}');
```

- [ ] **Step 5: Run the page test and verify RED**

Run:

```bash
pnpm exec vitest run src/pages/stock-tasks-layout.test.ts src/pages/StockTasksPage.test.ts
```

Expected: FAIL because the old discovery-first `main + aside` layout remains.

- [ ] **Step 6: Recompose `StockTasksPage`**

Add `const [screeningView, setScreeningView] = React.useState<StockScreeningViewState>('idle')`. Pass existing components as named props to the two new layouts:

```tsx
<StockTaskWorkspaceLayout
  highlights={<MarketHighlights ... />}
  riskRadar={<StockRiskRadar ... />}
  screening={<StockScreeningWorkbench onViewStateChange={setScreeningView} ... />}
  preferenceProfile={<StockPreferenceProfile presentation="compact" refreshKey={preferenceRevision} />}
  briefing={<DailyBriefing ... />}
  screeningView={screeningView}
/>
<StockMarketContextLayout
  discovery={<DiscoveryPanel ... />}
  temperature={<MarketTemperature ... />}
  sectors={<SectorTrends ... />}
  leaderboard={<Leaderboard ... />}
  marketTable={<MarketTable ... />}
  starStocks={<StarStocks ... />}
/>
```

Delete only the old wrapper grid. Preserve every existing prop, Sheet, modal, error boundary, footer, and handler.

- [ ] **Step 7: Align the initial skeleton and header density**

Make the initial skeleton use full-width task rows followed by a bounded market-context grid. Keep the title/status/actions source order and `min-[769px]:pr-[12rem]`; reduce only vertical padding that does not alter touch-target height.

- [ ] **Step 8: Run focused page and component tests**

Run:

```bash
pnpm exec vitest run src/components/stocks/StockWorkbenchLayout.test.tsx src/components/stocks/StockRiskRadar.test.tsx src/components/stocks/StockPreferenceProfile.test.tsx src/components/stocks/StockScreeningWorkbench.test.tsx src/components/DiscoveryNewsCard.test.tsx src/pages/stock-tasks-layout.test.ts src/pages/StockTasksPage.test.ts
```

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 5**

```bash
git add apps/web-workbench/src/components/stocks/StockWorkbenchLayout.tsx apps/web-workbench/src/components/stocks/StockWorkbenchLayout.test.tsx apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-tasks-layout.test.ts apps/web-workbench/src/pages/StockTasksPage.test.ts
git commit -m "feat(stocks): reorder the task-centered workbench"
```

---

### Task 6: Final regression, responsive acceptance, and release handoff

**Files:**

- Modify only if a failing verification requires a test-first fix in the files already listed.
- Update: `docs/superpowers/plans/2026-08-18-stock-task-workbench-p1b.md` checkboxes after each completed gate.

**Interfaces:** None; this task validates the integrated behavior.

- [ ] **Step 1: Run the full stock-focused suite**

```bash
pnpm exec vitest run src/lib/stock-risk-presentation.test.ts src/lib/stock-discovery.test.ts src/components/DiscoveryNewsCard.test.tsx src/components/stocks/StockRiskRadar.test.tsx src/components/stocks/StockPreferenceProfile.test.tsx src/components/stocks/StockScreeningWorkbench.test.tsx src/components/stocks/StockWorkbenchLayout.test.tsx src/pages/stock-tasks-layout.test.ts src/pages/StockTasksPage.test.ts
```

- [ ] **Step 2: Run the full Web suite**

```bash
pnpm test
```

Expected baseline: at least 186 files and 1412 tests, all passing; the final count may be higher because this plan adds tests.

- [ ] **Step 3: Run lint, typecheck, and production build**

```bash
pnpm build
```

Run from `apps/web-workbench`; this command includes ESLint, both TypeScript checks, and Vite production build.

- [ ] **Step 4: Run repository hygiene checks**

```bash
git diff --check
pnpm exec biome check apps/web-workbench/src/lib/stock-risk-presentation.ts apps/web-workbench/src/lib/stock-risk-presentation.test.ts apps/web-workbench/src/lib/stock-discovery.ts apps/web-workbench/src/lib/stock-discovery.test.ts apps/web-workbench/src/components/DiscoveryNewsCard.tsx apps/web-workbench/src/components/DiscoveryNewsCard.test.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx apps/web-workbench/src/components/stocks/StockPreferenceProfile.tsx apps/web-workbench/src/components/stocks/StockPreferenceProfile.test.tsx apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx apps/web-workbench/src/components/stocks/StockScreeningWorkbench.test.tsx apps/web-workbench/src/components/stocks/StockWorkbenchLayout.tsx apps/web-workbench/src/components/stocks/StockWorkbenchLayout.test.tsx apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-tasks-layout.test.ts apps/web-workbench/src/pages/StockTasksPage.test.ts
```

- [ ] **Step 5: Perform local visual acceptance**

Open the authenticated stock page against the local build. Capture and inspect:

1. 1280px current-data desktop overview;
2. grouped risk default and expanded evidence;
3. idle screening beside compact profile;
4. result screening expanded to full width;
5. market context below the core task workspace;
6. 390px single-column layout without horizontal overflow.

Cross at least one 20-second background-refresh cycle and verify scroll position, selected discovery tab, expanded risk group, focus, and screening results remain stable.

- [ ] **Step 6: Commit any verification-only plan status update**

```bash
git add docs/superpowers/plans/2026-08-18-stock-task-workbench-p1b.md
git commit -m "docs(stocks): record workbench verification"
```

- [ ] **Step 7: Finish the branch**

Use `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`. Because the user has already chosen single-agent serial execution, perform a direct self-review rather than spawning review agents. Push the verified branch and open a Ready PR; merge and deployment still require the user's existing task-specific authorization boundary.
