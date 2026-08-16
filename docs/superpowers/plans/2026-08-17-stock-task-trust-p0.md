# Stock Task Trust P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stock data freshness a server-authoritative state, prevent stale snapshots from presenting as current, bind stock tasks to the dashboard snapshot that created them, and make AkShare failures bounded and observable.

**Architecture:** AkShare exposes one latest-valid-trading-day primitive and bounded cache waits. The orchestrator turns source results into one `StockSnapshotTrust` envelope, persists it with the existing dashboard JSON, validates any task context against that persisted snapshot, and carries the context into the task result. The web workbench renders only server-authored trust modes and derives all time-sensitive copy and actions from that mode.

**Tech Stack:** Python 3.10/FastAPI/pytest, TypeScript 5.7, tRPC, Drizzle/MySQL, React 18, Zustand, Vitest, pnpm.

## Global Constraints

- Work only in `/Users/yaleiqi/holaday-monorepo/.worktrees/stock-task-trust-workbench` on `codex/stock-task-trust-workbench`.
- Use serial inline execution; do not spawn subagents or parallel test processes.
- Follow strict red-green-refactor: every behavior change starts with a test that fails for the expected missing behavior.
- `Asia/Shanghai` is the only stock-market timezone.
- On a non-trading day, the latest valid trading day is the most recent exchange-calendar trading day.
- Before 09:45 on a trading day, daily-close semantics may use the previous trading day; at or after 09:45 the expected trading date is the current trading day.
- A snapshot older than the latest expected trading date is `historical`, never `current`; a snapshot generated more than seven calendar days ago or carrying source data more than seven calendar days old is `unavailable` and its numeric values are not rendered.
- Historical mode must not use `今日`, `最新`, `当前机会`, `强势`, `现价`, or `实时` as claims about the present.
- Stock tasks require `snapshotId`, `dataAsOf`, `trustMode`, and an evidence-id list; `unavailable` snapshots cannot create a stock-data task.
- Do not add buy/sell, target-price, timing, return, `推荐指数`, or `最值得买` language.
- Do not modify unrelated browser, extension, payment, video, image, TaskStream, evidence-ledger, `.claude/`, `qa-artifacts/`, or `skills/*` work.
- Migration files may be authored and verified locally, but no production migration or deployment is authorized by this plan.

---

### Task 1: Latest Valid A-Share Trading Day Contract

**Files:**
- Modify: `apps/akshare-mcp/akshare_mcp/adapters.py`
- Modify: `apps/akshare-mcp/akshare_mcp/http_server.py`
- Modify: `apps/akshare-mcp/tests/test_stock_adapters.py`
- Modify: `apps/akshare-mcp/tests/test_http_server.py`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-client.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts`
- Modify: `apps/orchestrator/src/agent/a-share/briefing-service.test.ts`

**Interfaces:**
- Produces Python adapter `latest_trading_day(on_or_before: str) -> tuple[list[dict[str, Any]], str]`.
- Produces HTTP `GET /trading-calendar/latest?on_or_before=YYYY-MM-DD`.
- Produces TypeScript `TradingCalendarRow` and `AkshareClient.getLatestTradingDay(onOrBefore: string)`.
- The successful envelope contains exactly one row: `{ requested_date, latest_trading_date }` using `YYYY-MM-DD`.

- [x] **Step 1: Write failing adapter tests for weekends, holidays, and malformed dates**

Add literal fixtures to `test_stock_adapters.py`; monkeypatch `tool_trade_date_hist_sina` to return known dates and assert:

```python
records, source = adapters.latest_trading_day("2026-08-16")
assert records == [{
    "requested_date": "2026-08-16",
    "latest_trading_date": "2026-08-14",
}]
assert source == "akshare:tool_trade_date_hist_sina"
```

Also assert `2026-10-08` resolves across a holiday fixture and `20260816` is normalized. A malformed value must raise `AkShareUnavailable` rather than silently selecting today.

- [x] **Step 2: Run the adapter tests and verify RED**

Run:

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests/test_stock_adapters.py -k latest_trading_day -q
```

Expected: FAIL because `latest_trading_day` does not exist.

- [x] **Step 3: Implement one calendar fetch and deterministic latest-date selection**

Normalize input with `datetime.datetime.strptime`, build a sorted set from `trade_date`, select `max(date <= requested)`, and raise `AkShareUnavailable("交易日历没有可用日期")` when the calendar is empty or has no earlier entry. Do not fall back to weekday logic inside the data service.

- [x] **Step 4: Add failing HTTP and TypeScript client contract tests**

Assert `_safe(_latest_tradecal, "2026-08-16")` preserves source/fetched time and the TypeScript client requests:

```ts
'http://127.0.0.1:8848/trading-calendar/latest?on_or_before=2026-08-16'
```

- [x] **Step 5: Run the HTTP/client tests and verify RED**

Run:

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests/test_http_server.py -k trading_calendar -q
pnpm --filter @holaday/orchestrator exec vitest run src/agent/a-share/akshare-http-client.test.ts
```

Expected: both fail because the route and client method are missing.

- [x] **Step 6: Implement the cached route and client method**

Cache the latest-day adapter with `TTL_TRADECAL`. Add:

```ts
export interface TradingCalendarRow {
  requested_date?: string;
  latest_trading_date?: string;
  [key: string]: unknown;
}
```

and URL-encode the query parameter through `URLSearchParams`.

- [x] **Step 7: Run Task 1 tests and commit**

Run the three commands from Steps 2 and 5; all must pass. Then:

```bash
git add apps/akshare-mcp/akshare_mcp/adapters.py apps/akshare-mcp/akshare_mcp/http_server.py apps/akshare-mcp/tests/test_stock_adapters.py apps/akshare-mcp/tests/test_http_server.py apps/orchestrator/src/agent/a-share/akshare-client.ts apps/orchestrator/src/agent/a-share/akshare-http-client.ts apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts apps/orchestrator/src/agent/a-share/briefing-service.test.ts docs/superpowers/plans/2026-08-17-stock-task-trust-p0.md
git commit -m "feat(stocks): resolve latest valid trading day"
```

---

### Task 2: Server-Authoritative Trust Envelope

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-trust.ts`
- Create: `apps/orchestrator/src/stocks/stock-trust.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.test.ts`

**Interfaces:**
- Produces `StockTrustMode = 'current' | 'delayed' | 'historical' | 'unavailable'`.
- Produces `StockSourceHealth` and `StockSnapshotTrust`.
- Produces `marketSessionAt(now)` and `stockSnapshotTrust(input)` as pure functions.
- Produces `latestExpectedTradingDate(client, now)` using Task 1.
- Adds `trust: StockSnapshotTrust` to every `DashboardSnapshot` response, including persisted legacy snapshots and partial responses.

Use these exact shapes:

```ts
export interface StockSourceHealth {
  key: 'quotes' | 'indices' | 'news' | 'announcements';
  status: 'healthy' | 'delayed' | 'failed' | 'disabled';
  dataAsOf: string | null;
  fetchedAt: string | null;
  errorCode?: string;
}

export interface StockSnapshotTrust {
  snapshotId: string;
  generatedAt: string;
  marketTimezone: 'Asia/Shanghai';
  marketSession: 'preopen' | 'open' | 'lunch' | 'closed' | 'non-trading';
  latestExpectedTradingDate: string | null;
  dataAsOf: string | null;
  mode: StockTrustMode;
  calendarStatus: 'verified' | 'unavailable';
  sources: StockSourceHealth[];
  evidenceIds: string[];
}
```

- [x] **Step 1: Write failing pure domain tests**

Cover literal cases:

```ts
expect(stockSnapshotTrust({
  snapshotKey: 'user-watchlist',
  now: new Date('2026-08-16T14:00:00.000Z'),
  generatedAt: '2026-08-16T13:55:00.000Z',
  latestExpectedTradingDate: '2026-08-14',
  dataAsOf: '2026-08-11',
  calendarStatus: 'verified',
  freshnessStatus: 'fresh',
  sources: healthySources,
  evidenceIds: ['quote:603528:2026-08-11'],
}).mode).toBe('historical');
```

Also test: Friday data on Sunday is current; current date plus refreshing status is delayed; missing calendar cannot be current; missing data is unavailable; generated more than seven calendar days ago is unavailable; snapshot ID is stable for identical input and changes when data date or generated time changes.

- [x] **Step 2: Run the trust tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-trust.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the pure trust domain**

Derive Shanghai date/minute through `Intl.DateTimeFormat`. Query today's calendar date first so the service can distinguish a real trading day from a weekend or holiday; before 09:45 on a real trading day, resolve the prior calendar date. Derive `snapshotId` from SHA-256 over a canonical JSON array of snapshot key, generated time, expected date, data date, calendar status, source status/date/time, and sorted evidence IDs. Delivery freshness changes `mode` without changing the immutable snapshot ID. Prefix the first 24 hex characters with `stkshot_`.

- [x] **Step 4: Write failing router tests for returned and persisted trust**

Add tests demonstrating:

- a 2026-08-11 snapshot requested on 2026-08-16 returns `trust.mode === 'historical'` even if legacy `freshness.status === 'fresh'`;
- a persisted snapshot older than seven days returns a partial response with `trust.mode === 'unavailable'` and no numeric watchlist values;
- a newly built snapshot stores and reloads the same `snapshotId`;
- source health reports failed quote/news envelopes rather than calling the whole dashboard fresh.

- [x] **Step 5: Run router tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks.test.ts
```

Expected: new assertions fail because dashboard responses have no `trust` envelope and persisted snapshots are not age-gated.

- [x] **Step 6: Integrate the envelope without a schema migration**

Keep `stock_dashboard_snapshots.snapshot_json` as the latest display cache. Add trust before `persistDashboardSnapshot`, re-evaluate legacy snapshots on read, and refuse numeric display after the seven-day maximum age. Source-backed evidence IDs use deterministic forms:

```ts
`quote:${symbol}:${dataAsOf}`
`news:${sha256(sourceUrl).slice(0, 24)}`
```

Never create a news evidence ID for an item without a source URL.

- [x] **Step 7: Run Task 2 tests and commit**

Run the trust and router tests; then:

```bash
git add apps/orchestrator/src/stocks/stock-trust.ts apps/orchestrator/src/stocks/stock-trust.test.ts apps/orchestrator/src/trpc/routers/stocks.ts apps/orchestrator/src/trpc/routers/stocks.test.ts
git commit -m "feat(stocks): make snapshot trust server authoritative"
```

---

### Task 3: Historical and Unavailable UI Semantics

**Files:**
- Modify: `apps/web-workbench/src/lib/stock-dashboard-trust.ts`
- Modify: `apps/web-workbench/src/lib/stock-dashboard-trust.test.ts`
- Create: `apps/web-workbench/src/lib/stock-temporal-copy.ts`
- Create: `apps/web-workbench/src/lib/stock-temporal-copy.test.ts`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.test.ts`
- Modify: `apps/web-workbench/src/pages/stock-tasks-layout.test.ts`

**Interfaces:**
- `stockDashboardTrustState` consumes backend `StockSnapshotTrust`; it does not calculate weekday freshness.
- `stockTemporalCopy(mode, dataAsOf)` returns title/label/action copy for the dashboard.
- `StockTasksPage` passes trust mode to daily briefing, highlights, tables, quick commands, and prompt submission.

- [x] **Step 1: Write failing trust-mapping and copy tests**

Assert a backend historical envelope maps to:

```ts
{
  tone: 'historical',
  statusLabel: '历史回看',
  canGenerateBriefing: false,
  canCreateCurrentTask: false,
  dataDateLabel: '数据日期 08/11',
}
```

Assert `stockTemporalCopy('historical', '2026-08-11')` returns `08/11 回看重点`, `当日表现`, `当日价格`, and `历史关注点`, with none of the prohibited present-tense claims.

- [x] **Step 2: Run library tests and verify RED**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-dashboard-trust.test.ts src/lib/stock-temporal-copy.test.ts
```

Expected: FAIL because the state still guesses dates locally and temporal-copy does not exist.

- [x] **Step 3: Implement backend-mode mapping and structured copy**

Map `current`, `delayed`, `historical`, and `unavailable` directly. A missing backend envelope is `unverified` and blocks current-data actions; do not restore the old three-calendar-day heuristic.

- [x] **Step 4: Write failing page behavior tests**

Render/inspect page helpers for a historical fixture and assert:

- `生成今日关注日报` is replaced by `基于 08/11 生成历史复盘`;
- `机会` becomes `当时的关注点`;
- `最新价` becomes `当日价格`;
- `明星股票 · 今日关注` becomes `关注股票 · 08/11 回看`;
- unavailable mode renders no old numeric quote and disables prompt submission;
- current mode retains current wording.

- [x] **Step 5: Run page tests and verify RED**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/StockTasksPage.test.ts src/pages/stock-tasks-layout.test.ts
```

Expected: the historical assertions fail against present-tense hard-coded copy.

- [x] **Step 6: Thread temporal copy through the page**

Do not use global string replacement. Pass structured labels into `DailyBriefing`, `MarketHighlights`, `MarketTable`, and `StarStocks`. Preserve source article titles verbatim even if a publisher title contains words such as “最新” or “强势”; only HOLA DAY-authored claims change.

- [x] **Step 7: Run Task 3 tests and commit**

Run the four library/page test files; then:

```bash
git add apps/web-workbench/src/lib/stock-dashboard-trust.ts apps/web-workbench/src/lib/stock-dashboard-trust.test.ts apps/web-workbench/src/lib/stock-temporal-copy.ts apps/web-workbench/src/lib/stock-temporal-copy.test.ts apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/StockTasksPage.test.ts apps/web-workbench/src/pages/stock-tasks-layout.test.ts
git commit -m "fix(stocks): enforce historical dashboard semantics"
```

---

### Task 4: Snapshot-Bound Stock Task Context

**Files:**
- Create: `apps/orchestrator/drizzle/0046_tasks_source_context.sql`
- Modify: `apps/orchestrator/src/db/schema/tasks.ts`
- Create: `apps/orchestrator/src/stocks/stock-task-context.ts`
- Create: `apps/orchestrator/src/stocks/stock-task-context.test.ts`
- Create: `apps/orchestrator/src/stocks/snapshot-akshare-client.ts`
- Create: `apps/orchestrator/src/stocks/snapshot-akshare-client.test.ts`
- Modify: `apps/orchestrator/src/agent/a-share/briefing-types.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-create-idempotency.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-list-detail.integration.test.ts`
- Modify: `apps/orchestrator/src/agent/task-repository.ts`
- Modify: `apps/web-workbench/src/stores/task-store.ts`
- Modify: `apps/web-workbench/src/stores/task-store.test.ts`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`

**Interfaces:**
- Adds nullable `tasks.source_context JSON`.
- Adds `StockTaskContextInput` with `snapshotId`, `dataAsOf`, `trustMode`, and `evidenceIds`.
- Adds `validateStockTaskContext({ db, userId, input, intent })`.
- Adds `SnapshotAkshareClient`, an `AkshareClient` implementation backed only by the validated dashboard snapshot copied into `tasks.source_context`.
- Changes `createStockTask(intent, context)` to require the current dashboard context.
- Task detail and terminal metadata expose the same public context; they never expose the private `snapshotPayload` copy.

Use this input schema:

```ts
const stockTaskContextInput = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trustMode: z.enum(['current', 'delayed', 'historical']),
  evidenceIds: z.array(z.string().min(1).max(160)).max(50),
});
```

- [x] **Step 1: Write failing pure validation tests**

Test matching snapshot ID/date/evidence subset; reject another user's snapshot, mismatched date, forged evidence ID, unavailable mode, a symbol absent from the bound snapshot, and a historical context with present-tense intent such as `今天哪只最强`. A successful validation returns a minimal `snapshotPayload` containing only the matched watchlist quotes, indices, sectors, and source-backed news selected by the validated evidence IDs.

- [x] **Step 2: Run context tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-task-context.test.ts
```

Expected: FAIL because the validator does not exist.

- [x] **Step 3: Implement validation against the latest persisted dashboard**

Select the user's recent `stock_dashboard_snapshots` rows, parse their `snapshotJson.trust`, and require an exact snapshot ID and data date. Evidence IDs must be a subset of the persisted envelope. Historical intents containing current-data terms return `BAD_REQUEST` with a rewrite such as `请改为“截至 08/11，当时有哪些关注点？”`. Copy a bounded payload into the validated context; do not retain unrelated discovery records or another user's data.

- [x] **Step 4: Write failing snapshot-client tests**

Build a literal dashboard payload for `603528` and assert the client returns its bound quote, intraday points, index rows, and selected news with `fetched_at === generatedAt`. Assert fundamentals, valuation, risk, announcements, or another symbol return an error envelope with `error_code: SNAPSHOT_EVIDENCE_UNAVAILABLE`; no method may call global `fetch`.

- [x] **Step 5: Run snapshot-client tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/snapshot-akshare-client.test.ts
```

Expected: FAIL because the snapshot-backed client does not exist.

- [x] **Step 6: Implement the snapshot-backed AkShare interface**

Map only fields present in the immutable payload into complete `AkEnvelope` objects. Use source names beginning `stock-snapshot:`. Methods without bound evidence return a sanitized error envelope instead of reaching the live `HttpAkshareClient`.
Add optional `error_code?: string` to `AkEnvelope` so callers can distinguish bounded operational states without parsing human text.

- [x] **Step 7: Write failing API, repository, and store tests**

Assert:

```ts
await createStockTask('解释多伦科技当日变化', {
  snapshotId: 'stkshot_0123456789abcdef01234567',
  dataAsOf: '2026-08-11',
  trustMode: 'historical',
  evidenceIds: ['quote:603528:2026-08-11'],
});
```

sends `taskSource` and `stockContext`, persists the validated public fields plus private minimal `snapshotPayload` in `source_context`, returns only the public fields from task detail, routes stock-dashboard analysis through `SnapshotAkshareClient`, and includes the public fields in A-share terminal metadata.

- [x] **Step 8: Run API/store tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/tasks-create-idempotency.test.ts src/trpc/routers/tasks-list-detail.integration.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/stores/task-store.test.ts
```

Expected: new assertions fail because only `taskSource` is currently sent and no task context column exists.

- [x] **Step 9: Add migration, persistence, API validation, and snapshot-bound execution**

Migration:

```sql
ALTER TABLE `tasks`
  ADD COLUMN `source_context` JSON NULL AFTER `result`;
```

`InsertTaskContext` accepts `sourceContext?: Record<string, unknown> | null`. Every task created from `stock_dashboard` persists the validated context. Dashboard-created A-share, index, and guidance paths use `SnapshotAkshareClient`; a prompt needing evidence absent from the snapshot gets a clear “当前快照没有该项证据，请刷新或把股票加入自选后重试” boundary instead of silently fetching live data. Result metadata repeats only the four public context fields. The first line states `分析基于 YYYY-MM-DD 数据` and uses the original `snapshotId`.

- [x] **Step 10: Run Task 4 tests and commit**

```bash
git add apps/orchestrator/drizzle/0046_tasks_source_context.sql apps/orchestrator/src/db/schema/tasks.ts apps/orchestrator/src/stocks/stock-task-context.ts apps/orchestrator/src/stocks/stock-task-context.test.ts apps/orchestrator/src/stocks/snapshot-akshare-client.ts apps/orchestrator/src/stocks/snapshot-akshare-client.test.ts apps/orchestrator/src/agent/a-share/briefing-types.ts apps/orchestrator/src/trpc/routers/tasks.ts apps/orchestrator/src/trpc/routers/tasks-create-idempotency.test.ts apps/orchestrator/src/trpc/routers/tasks-list-detail.integration.test.ts apps/orchestrator/src/agent/task-repository.ts apps/web-workbench/src/stores/task-store.ts apps/web-workbench/src/stores/task-store.test.ts apps/web-workbench/src/pages/StockTasksPage.tsx
git commit -m "feat(stocks): bind tasks to trusted snapshots"
```

---

### Task 5: Bounded AkShare Waiting and Circuit Breaking

**Files:**
- Modify: `apps/akshare-mcp/akshare_mcp/cache.py`
- Modify: `apps/akshare-mcp/tests/test_cache.py`
- Create: `apps/orchestrator/src/agent/a-share/circuit-breaker.ts`
- Create: `apps/orchestrator/src/agent/a-share/circuit-breaker.test.ts`
- Modify: `apps/orchestrator/src/agent/a-share/briefing-types.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.test.ts`

**Interfaces:**
- `cached(ttl_seconds, wait_timeout_seconds=15.0)` gives followers a finite wait.
- `CircuitBreaker` opens after three consecutive failures for 60 seconds, permits one half-open probe, and resets after success.
- `HttpAkshareClient` returns `error_code: CIRCUIT_OPEN` without starting a fetch while open.
- Dashboard stock fetches run with maximum concurrency 3 and no 75/90-second request budget.

- [ ] **Step 1: Write a failing Python follower-timeout test**

Own one flight with a blocked function, call the same key from a follower, and assert the follower raises `TimeoutError` within a test-configured 50 ms rather than waiting for the owner forever. Release the owner in `finally` so the test leaves no thread behind.

- [ ] **Step 2: Run the cache test and verify RED**

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests/test_cache.py -k follower_timeout -q
```

Expected: FAIL because `cached` has no wait timeout.

- [ ] **Step 3: Implement finite follower waiting**

Use `flight.event.wait(timeout=wait_timeout_seconds)`. Raise `TimeoutError("single-flight wait exceeded ...")` when false. Do not remove or overwrite the owner's flight from a follower.

- [ ] **Step 4: Write failing circuit-breaker tests**

Use an injected clock. Assert exactly three failed calls reach the operation, the fourth is rejected with `CircuitOpenError`, only one call is admitted after 60 seconds, and a successful probe closes the circuit.

- [ ] **Step 5: Run circuit/client tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/agent/a-share/circuit-breaker.test.ts src/agent/a-share/akshare-http-client.test.ts
```

Expected: FAIL because the circuit module and `CIRCUIT_OPEN` envelope are missing.

- [ ] **Step 6: Implement per-route-family circuit breaking**

Group keys as `quote`, `intraday`, `kline`, `news`, `calendar`, `risk`, and `market`. HTTP non-2xx, abort, network errors, malformed envelopes, and envelope errors count as failures. A successful valid envelope resets the group. Log group/state/error code without leaking upstream response text.

- [ ] **Step 7: Write failing dashboard concurrency/budget tests**

Track active fake quote requests across eight symbols and assert `maxActive <= 3`. Use fake timers to assert quick/slow dashboard stages settle within their configured 5.5/12-second bounds and do not leave a 75/90-second promise holding the refresh state.

- [ ] **Step 8: Implement bounded concurrency and budgets**

Add a focused `mapWithConcurrency(items, 3, worker)` helper beside dashboard orchestration. Set discovery and slow-signal request budgets to 12 seconds; keep individual client aborts at or below those stage budgets.

- [ ] **Step 9: Run Task 5 tests and commit**

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests/test_cache.py tests/test_http_server.py -q
pnpm --filter @holaday/orchestrator exec vitest run src/agent/a-share/circuit-breaker.test.ts src/agent/a-share/akshare-http-client.test.ts src/trpc/routers/stocks.test.ts
git add apps/akshare-mcp/akshare_mcp/cache.py apps/akshare-mcp/tests/test_cache.py apps/orchestrator/src/agent/a-share/circuit-breaker.ts apps/orchestrator/src/agent/a-share/circuit-breaker.test.ts apps/orchestrator/src/agent/a-share/briefing-types.ts apps/orchestrator/src/agent/a-share/akshare-http-client.ts apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts apps/orchestrator/src/trpc/routers/stocks.ts apps/orchestrator/src/trpc/routers/stocks.test.ts
git commit -m "fix(stocks): bound AkShare failures and concurrency"
```

---

### Task 6: Observability, Full Verification, and Release Evidence

**Files:**
- Modify: `apps/akshare-mcp/akshare_mcp/http_server.py`
- Modify: `apps/akshare-mcp/tests/test_http_server.py`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.test.ts`
- Create: `docs/runbooks/STOCK_DATA_TRUST.md`

**Interfaces:**
- AkShare health reports timeout and single-flight-timeout counters without raw errors.
- Orchestrator logs `snapshotId`, expected date, data date, trust mode, snapshot age, source statuses, and task-context rejection code.
- Runbook defines production probes, alert conditions, degraded-mode drill, and rollback.

- [ ] **Step 1: Write failing health and structured-log tests**

Assert health counters increment for timeout/circuit-open paths and logger calls contain structured fields without upstream secrets. Test exact operational codes, not exact user-facing sentence text.

- [ ] **Step 2: Run observability tests and verify RED**

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests/test_http_server.py -q
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks.test.ts
```

Expected: new counter/log assertions fail.

- [ ] **Step 3: Implement counters/logs and write the runbook**

The runbook must include literal checks for:

- `dataAsOf === latestExpectedTradingDate` in `current` mode;
- no current-language actions in `historical` mode;
- seven-day snapshots become `unavailable`;
- a stopped AkShare service returns bounded degraded UI;
- task `sourceContext.snapshotId` equals the originating dashboard snapshot;
- rollback keeps the server trust gate active even if the new page copy is disabled.

- [ ] **Step 4: Run targeted and full verification serially**

```bash
/Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest tests -q
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-trust.test.ts src/stocks/stock-task-context.test.ts src/agent/a-share/circuit-breaker.test.ts src/agent/a-share/akshare-http-client.test.ts src/trpc/routers/stocks.test.ts src/trpc/routers/tasks-create-idempotency.test.ts src/trpc/routers/tasks-list-detail.integration.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-dashboard-trust.test.ts src/lib/stock-temporal-copy.test.ts src/stores/task-store.test.ts src/pages/StockTasksPage.test.ts src/pages/stock-tasks-layout.test.ts
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
pnpm typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build
git diff --check
```

Record exact counts, failures, warnings, and any repository-wide pre-existing lint limitation. Do not claim release readiness from targeted suites alone.

- [ ] **Step 5: Review sensitive paths and commit**

Verify the diff contains no unrelated TaskStream, payment, browser, extension, video, image, or evidence-ledger changes. Then:

```bash
git add apps/akshare-mcp/akshare_mcp/http_server.py apps/akshare-mcp/tests/test_http_server.py apps/orchestrator/src/trpc/routers/stocks.ts apps/orchestrator/src/trpc/routers/stocks.test.ts docs/runbooks/STOCK_DATA_TRUST.md
git commit -m "docs(stocks): add trust operations runbook"
```

- [ ] **Step 6: Finish the branch**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`. Push the verified branch and create a PR by the user's established default. Merge, migration, deployment, and production verification remain separately gated until explicitly authorized for this release.
