# Stock Risk Radar P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trust-bound, deterministic risk radar to the stocks page so users can see which watchlist risks were triggered, why they matter, which sources were checked, and which facts could not be verified.

**Architecture:** Reuse the existing `risk-radar-engine.ts` threshold rules and AkShare risk endpoints; add a stock-domain service that converts raw envelopes into auditable signals and per-source coverage. A small tRPC boundary validates the caller-owned dashboard snapshot before fetching risk data. The web component consumes only this structured result and never invents a recommendation score or treats missing data as safety.

**Tech Stack:** TypeScript 5.7, tRPC, Drizzle/MySQL snapshot validation, React 18, Vitest, Testing Library, pnpm.

## Global Constraints

- Work only in `/Users/yaleiqi/holaday-monorepo/.worktrees/stock-risk-radar-p1` on `codex/stock-risk-radar-p1`.
- Execute serially; do not spawn subagents or parallel test processes.
- Follow strict red-green-refactor for every behavior change.
- Bind every radar result to the caller-owned `snapshotId`, `dataAsOf`, and `trustMode` validated by `validateStockTaskContext`.
- Accept `current`, `delayed`, and `historical` snapshots; do not query or render risk facts for `unavailable` or unverified snapshots.
- Use `Asia/Shanghai` semantics and a 180-calendar-day window for insider changes and announcement rules.
- Inspect at most eight A-share watchlist stocks per request and report truncation instead of silently implying full coverage.
- Severity is deterministic: `关注`, `警示`, or `高风险`; no generated model may choose or alter it.
- A successful source call with no matching rule is `checked`, not “safe”; a failed source call is `unavailable` and must render “无法判断”.
- Do not add buy/sell, target-price, timing, return, ranking score, `推荐指数`, `最值得买`, or suitability language.
- P1 is read-only: it provides inline evidence and source links. AI explanation tasks and persistent risk-alert subscriptions require separately persisted risk evidence and are intentionally outside this plan.
- Do not add a schema migration and do not modify unrelated browser, extension, payment, video, image, TaskStream, evidence-ledger, `.claude/`, `qa-artifacts/`, or `skills/*` work.
- Push and open a pull request after verification under the established branch-delivery default. Merge and deployment require separate authorization.

---

### Task 1: Deterministic Risk Radar Domain Service

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-risk-radar-service.ts`
- Create: `apps/orchestrator/src/stocks/stock-risk-radar-service.test.ts`
- Read: `apps/orchestrator/src/agent/a-share/risk-radar-engine.ts`
- Read: `apps/orchestrator/src/agent/a-share/briefing-types.ts`

**Interfaces:**

- Consumes the existing `detectAllRisks(RiskInputs): RiskSignal[]` rules and these `AkshareClient` methods: `getRiskPledge`, `getRiskGoodwill`, `getRiskForecast`, `getRiskInsider`, and `getStockAnnouncements`.
- Produces:

```ts
export type StockRiskSeverity = '关注' | '警示' | '高风险';
export type StockRiskCheckKey = 'pledge' | 'goodwill' | 'forecast' | 'insider' | 'announcements';

export interface StockRiskRadarStock {
  symbol: string;
  name: string;
  market?: string;
}

export interface StockRiskSignalRecord {
  signalId: string;
  evidenceId: string;
  symbol: string;
  name: string;
  key: RiskKey;
  label: string;
  severity: StockRiskSeverity;
  fact: string;
  trigger: string;
  whyRelevant: string;
  observedAt: string | null;
  sourceDataAsOf: string | null;
  source: string;
  fetchedAt: string;
  evidenceUrl: string | null;
}

export interface StockRiskSourceCheck {
  symbol: string;
  name: string;
  key: StockRiskCheckKey;
  status: 'checked' | 'unavailable';
  source: string;
  fetchedAt: string;
  sourceDataAsOf: string | null;
  errorCode: string | null;
}

export interface StockRiskRadarResult {
  snapshotId: string;
  dataAsOf: string;
  generatedAt: string;
  requestedStockCount: number;
  checkedStockCount: number;
  truncated: boolean;
  signals: StockRiskSignalRecord[];
  checks: StockRiskSourceCheck[];
}

export type StockRiskRadarClient = Pick<
  AkshareClient,
  | 'getRiskPledge'
  | 'getRiskGoodwill'
  | 'getRiskForecast'
  | 'getRiskInsider'
  | 'getStockAnnouncements'
>;

export async function runStockRiskRadar(args: {
  client: StockRiskRadarClient;
  snapshotId: string;
  dataAsOf: string;
  stocks: StockRiskRadarStock[];
  now?: Date;
}): Promise<StockRiskRadarResult>;
```

- `signalId` and `evidenceId` are deterministic SHA-256 identifiers over canonical arrays. Use `risk_signal_` and `risk:` prefixes plus the first 24 lowercase hex characters.
- Signal order is severity (`高风险`, `警示`, `关注`), then symbol, then existing R1–R5 rule order.

- [x] **Step 1: Write failing service tests for signal facts, severity, evidence, and source coverage**

Create literal fake envelopes for two stocks and assert:

```ts
const result = await runStockRiskRadar({
  client,
  snapshotId: 'stkshot_0123456789abcdef01234567',
  dataAsOf: '2026-08-17',
  stocks: [
    { symbol: '600001', name: '测试股份', market: 'A' },
    { symbol: '000002', name: '示例科技', market: 'A' },
  ],
  now: new Date('2026-08-17T12:00:00.000Z'),
});

expect(result.signals).toEqual(expect.arrayContaining([
  expect.objectContaining({
    symbol: '600001',
    key: 'pledge',
    severity: '高风险',
    trigger: '质押比例超过 50%',
    sourceDataAsOf: '2026-08-14',
  }),
]));
expect(result.checks).toEqual(expect.arrayContaining([
  expect.objectContaining({ symbol: '000002', key: 'goodwill', status: 'unavailable' }),
]));
expect(JSON.stringify(result)).not.toMatch(/买入|卖出|持有|目标价|推荐指数|最值得买/);
```

Also assert that an envelope with no matched row yields `checked` without a signal; a failed envelope yields `unavailable`; insider and announcement rows older than 180 days do not trigger; positive forecasts are omitted; and duplicate stocks are checked once.

- [x] **Step 2: Run the service test and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-risk-radar-service.test.ts
```

Expected: FAIL because `stock-risk-radar-service.ts` does not exist.

- [x] **Step 3: Implement envelope normalization and deterministic rules**

Implement the service with these mappings:

```ts
const SEVERITY_RANK: Record<StockRiskSeverity, number> = {
  高风险: 0,
  警示: 1,
  关注: 2,
};

function severityFor(signal: RiskSignal): StockRiskSeverity {
  if ((signal.key === 'pledge' || signal.key === 'goodwill') && signal.star) return '高风险';
  if (signal.key === 'forecast' || signal.key === 'inquiry') return '警示';
  return '关注';
}
```

Filter insider and announcement rows to `observedAt <= dataAsOf` and no earlier than 180 calendar days before `dataAsOf`. Pass only the filtered rows into `detectAllRisks`. Exclude `forecast` signals whose `star` is false. Map trigger and relevance copy from the rule key through exhaustive `Record<RiskKey, string>` maps. Preserve source names and `fetched_at`; never include raw error text.

Process at most eight unique `market === 'A'` stocks with a serial two-worker helper. Return a check for all five source families per inspected stock.

- [x] **Step 4: Run service and existing risk-engine tests and verify GREEN**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-risk-radar-service.test.ts src/agent/a-share/risk-radar-engine.test.ts
```

Expected: PASS with no warnings.

- [x] **Step 5: Commit the domain service**

```bash
git add apps/orchestrator/src/stocks/stock-risk-radar-service.ts apps/orchestrator/src/stocks/stock-risk-radar-service.test.ts docs/superpowers/plans/2026-08-18-stock-risk-radar-p1.md
git commit -m "feat(stocks): build deterministic risk radar"
```

---

### Task 2: Snapshot-Validated Risk Radar Procedure

**Files:**
- Create: `apps/orchestrator/src/trpc/routers/stocks-risk-radar.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-risk-radar.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`

**Interfaces:**

- Consumes `validateStockTaskContext`, `runStockRiskRadar`, and the minimal watchlist rows from `ValidatedStockTaskContext.snapshotPayload.watchlistStocks`.
- Produces:

```ts
export const stockRiskRadarInputSchema = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trustMode: z.enum(['current', 'delayed', 'historical']),
});

export async function runTrustedStockRiskRadar(args: {
  db: Db;
  userId: number;
  logger: RiskRadarLogger;
  client: StockRiskRadarClient;
  input: z.infer<typeof stockRiskRadarInputSchema>;
  execute?: typeof runStockRiskRadar;
}): Promise<StockRiskRadarResult>;
```

- Adds `stocks.riskRadar` as a protected query.

- [ ] **Step 1: Write failing trust-bound procedure tests**

Copy the compact fake snapshot DB pattern from `stocks-screening.test.ts`. Assert that current, delayed, and historical owned snapshots reach `execute`; mismatched ID/date/mode, unavailable snapshots, and another user's snapshot fail before `execute` or any AkShare call. Assert only snapshot watchlist stocks reach the service and logger metadata excludes facts, names, and raw errors.

- [ ] **Step 2: Run the procedure tests and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks-risk-radar.test.ts
```

Expected: FAIL because the helper and router procedure do not exist.

- [ ] **Step 3: Implement validation and route wiring**

Call:

```ts
const context = await validateStockTaskContext({
  db: args.db,
  userId: args.userId,
  input: { ...input, evidenceIds: [] },
  intent: '查看自选股风险雷达',
  logger: args.logger,
});
```

Normalize `snapshotPayload.watchlistStocks` into `{ symbol, name, market }` records, then call the service. Log only `snapshotId`, `dataAsOf`, counts, truncation, unavailable-check count, and duration.

In `stocks.ts`, construct `HttpAkshareClient` with `timeoutMs: 12_000` and `riskTimeoutMs: 12_000`, then expose:

```ts
riskRadar: protectedProcedure
  .input(stockRiskRadarInputSchema)
  .query(async ({ ctx, input }) => runTrustedStockRiskRadar({
    db: ctx.db,
    userId: await requireUserId(ctx.db, ctx.userId),
    logger: ctx.logger,
    client,
    input,
  })),
```

- [ ] **Step 4: Run procedure, stock-context, and screening boundary tests**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks-risk-radar.test.ts src/stocks/stock-task-context.test.ts src/trpc/routers/stocks-screening.test.ts
```

Expected: PASS with no live HTTP calls.

- [ ] **Step 5: Commit the trusted procedure**

```bash
git add apps/orchestrator/src/trpc/routers/stocks-risk-radar.ts apps/orchestrator/src/trpc/routers/stocks-risk-radar.test.ts apps/orchestrator/src/trpc/routers/stocks.ts
git commit -m "feat(stocks): validate risk radar snapshots"
```

---

### Task 3: Stocks Page Risk Radar Workbench

**Files:**
- Create: `apps/web-workbench/src/components/stocks/StockRiskRadar.tsx`
- Create: `apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/stock-tasks-layout.test.ts`

**Interfaces:**

- Consumes `trpc.stocks.riskRadar.query` with `{ snapshotId, dataAsOf, trustMode }`.
- Produces:

```ts
export interface StockRiskRadarApi {
  load(input: Parameters<typeof trpc.stocks.riskRadar.query>[0]):
    ReturnType<typeof trpc.stocks.riskRadar.query>;
}

export function StockRiskRadar(props: {
  snapshotId: string | null;
  dataAsOf: string | null;
  trustMode: 'current' | 'delayed' | 'historical' | 'unavailable' | 'unverified';
  api?: StockRiskRadarApi;
}): JSX.Element;
```

- [ ] **Step 1: Write failing component and layout tests**

Use an injected API and a literal result to assert:

- high-risk, warning, and attention signals render in server order;
- each card shows fact, rule trigger, relevance, source data date, and `查看依据`;
- expanding `查看依据` shows source, fetched time, evidence ID, and `查看来源` only when an evidence URL exists;
- unavailable checks render `无法判断` and are never summarized as “无风险” or “安全”;
- an empty checked result says `本轮规则未触发`, not `没有风险`;
- unavailable/unverified trust never calls the API;
- a snapshot ID or date change clears the previous result and loads the new one;
- the refresh button has both `aria-label` and native `title`;
- the page places `<StockRiskRadar>` after `<MarketHighlights>` and before `<StockScreeningWorkbench>`.

- [ ] **Step 2: Run component and layout tests and verify RED**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockRiskRadar.test.tsx src/pages/stock-tasks-layout.test.ts
```

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement progressive, non-recommendation UI**

Build one white workbench section with a compact header, trust/date badge, refresh control, summary counts, and signal cards. Use restrained severity accents:

```ts
const SEVERITY_STYLE = {
  高风险: 'border-[#F4B8C5] bg-[#FFF6F8] text-[#B4234D]',
  警示: 'border-[#F1D4A9] bg-[#FFF9EF] text-[#9A5B13]',
  关注: 'border-[#C9D7F2] bg-[#F6F9FF] text-[#315E9A]',
} as const;
```

The component loads automatically only when snapshot ID/date exist and mode is `current`, `delayed`, or `historical`. Keep the previous page usable while loading, but never keep a result after its snapshot identity changes. Display unavailable source families in a separate compact strip labelled `这些项目暂时无法判断`.

Footer copy is exactly:

```text
风险雷达只展示已核验事实与规则触发结果；未触发不等于没有风险，也不构成投资建议。
```

- [ ] **Step 4: Wire the component into `StockTasksPage`**

Pass:

```tsx
<StockRiskRadar
  snapshotId={dashboard?.trust?.snapshotId ?? null}
  dataAsOf={dashboard?.trust?.dataAsOf ?? null}
  trustMode={dashboard?.trust?.mode ?? 'unverified'}
/>
```

Place it immediately after `MarketHighlights` and before `StockScreeningWorkbench` so users see watchlist facts, then risk, then broad-market screening.

- [ ] **Step 5: Run component, page, tooltip, and layout tests**

Run:

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockRiskRadar.test.tsx src/pages/StockTasksPage.test.ts src/pages/stock-tasks-layout.test.ts src/lib/control-tooltip.test.ts
```

Expected: PASS with no React act warnings.

- [ ] **Step 6: Commit the workbench**

```bash
git add apps/web-workbench/src/components/stocks/StockRiskRadar.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-tasks-layout.test.ts
git commit -m "feat(stocks): add watchlist risk radar"
```

---

### Task 4: Verification, Review, and Pull Request

**Files:**
- Modify: `docs/superpowers/plans/2026-08-18-stock-risk-radar-p1.md`

- [ ] **Step 1: Run focused stock-risk verification serially**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/agent/a-share/risk-radar-engine.test.ts src/stocks/stock-risk-radar-service.test.ts src/trpc/routers/stocks-risk-radar.test.ts src/stocks/stock-task-context.test.ts src/trpc/routers/stocks-screening.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockRiskRadar.test.tsx src/components/stocks/StockScreeningWorkbench.test.tsx src/pages/StockTasksPage.test.ts src/pages/stock-tasks-layout.test.ts src/lib/control-tooltip.test.ts
```

- [ ] **Step 2: Run package-wide tests, typecheck, and builds serially**

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
pnpm typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build
git diff --check
```

Record exact counts, failures, warnings, and any pre-existing repository limitation. Do not infer release readiness from targeted tests alone.

- [ ] **Step 3: Review scope and compliance**

Run:

```bash
git diff --stat origin/claude/musing-keller-ae1d05...HEAD
git diff --name-only origin/claude/musing-keller-ae1d05...HEAD
rg -n "买入|卖出|持有|目标价|推荐指数|最值得买" apps/orchestrator/src/stocks/stock-risk-radar-service.ts apps/web-workbench/src/components/stocks/StockRiskRadar.tsx
```

The first two commands must show only stock risk radar, stock router/page wiring, tests, and this plan. The text scan may match the explicit non-recommendation footer or test sentinels; inspect each match and reject any recommendation action or score.

- [ ] **Step 4: Mark the plan complete and commit verification evidence**

Change every completed checkbox to `[x]`, then:

```bash
git add docs/superpowers/plans/2026-08-18-stock-risk-radar-p1.md
git commit -m "docs(stocks): record risk radar verification"
```

- [ ] **Step 5: Finish the branch**

Use `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`. Push `codex/stock-risk-radar-p1` and create a draft pull request with exact test evidence. Do not merge or deploy in this task.
