# Stock Screening P1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transparent A-share screening workbench that converts a user's explicit requirements into editable criteria, checks a clearly disclosed market pool, explains every match/mismatch/missing field, and surfaces deterministic risk warnings without giving investment recommendations.

**Architecture:** AkShare exposes a cached full-market screening snapshot with only source-provided fields. The orchestrator owns deterministic Chinese criterion parsing, validation, two-stage market/deep-fact evaluation, trusted-snapshot binding, coverage reporting, and rule-based warnings. The web workbench presents preview-before-run criteria and explanatory candidate cards in a focused component inserted after the user's watchlist, with no AI score and no silent criterion relaxation.

**Tech Stack:** Python 3.10/FastAPI/AkShare, TypeScript 5.7, tRPC, Zod, React 18, Vitest, pytest, pnpm.

## Global Constraints

- Execute serially; do not create subagents.
- Preserve all P0 stock trust guarantees. Screening runs only against `trust.mode === 'current'`, and must bind `snapshotId` plus `dataAsOf`.
- Do not emit buy/sell/hold language, target prices, expected returns, recommendation scores, or “most worth buying” copy.
- Never silently invent a threshold or relax a criterion. Ambiguous clauses stay `needs_input` until the user supplies a value.
- Display the exact pool size, prefiltered count, deep-checked count, truncation state, source dates, and missing fields.
- Missing data is `missing`, never a pass. Zero complete matches is a valid result.
- Reuse `risk-radar-engine.ts` for deterministic risk facts; a language model cannot assign severity.
- Limit one request to 20 deep-check candidates and four concurrent AkShare deep-fetches.
- Full-market raw rows remain internal and may contain only normalized source fields; no upstream errors, tokens, cookies, or private user data enter logs or API responses.
- Keep unrelated `.claude/`, `qa-artifacts/`, and `skills/*` drafts untouched.

---

### Task 1: Full-market screening snapshot in AkShare

**Files:**
- Modify: `apps/akshare-mcp/akshare_mcp/adapters.py`
- Modify: `apps/akshare-mcp/akshare_mcp/http_server.py`
- Modify: `apps/akshare-mcp/tests/test_stock_adapters.py`
- Modify: `apps/akshare-mcp/tests/test_http_server.py`
- Modify: `apps/akshare-mcp/README.md`

**Interfaces:**
- Produces: `get_screening_universe() -> tuple[list[dict[str, Any]], str]`.
- Produces HTTP: `GET /screening-universe` returning the standard AkShare envelope.
- Each row contains `代码`, `名称`, `最新价`, `涨跌幅`, `成交额`, `换手率`, `市盈率TTM`, `市净率`, `总市值原值`, and `行情时间`; absent source values are `None`.

- [x] **Step 1: Write failing adapter tests**

Add fixtures with two raw Sina rows, including an ST name and numeric `per/pb/turnoverratio`, then assert normalization, invalid-row removal, and stable `成交额` descending order. Name the test `test_screening_universe_preserves_source_fields_and_excludes_invalid_rows`.

- [x] **Step 2: Run the adapter test and verify RED**

Run: `PYTHONPATH=apps/akshare-mcp /Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_stock_adapters.py -k screening_universe -q`

Expected: FAIL because `get_screening_universe` does not exist.

- [x] **Step 3: Implement the cached Sina snapshot**

Implement a bounded page fetch against `_SINA_A_RANK_URL` using `num=80`, `sort=amount`, `asc=0`, a maximum of 90 pages, per-request timeout from `AKSHARE_MCP_SINA_SCREEN_TIMEOUT` defaulting to 15 seconds, and stop on an empty/short page. Normalize only source fields, deduplicate by six-digit code, require positive price and amount, cache with `TTL_SPOT`, hydrate the symbol table, and never synthesize values.

- [x] **Step 4: Add failing/passing HTTP contract tests**

Assert `/screening-universe` delegates through `_safe`, returns the standard envelope, and exposes no raw exception text. Run:

`PYTHONPATH=apps/akshare-mcp /Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_http_server.py -k screening_universe -q`

- [x] **Step 5: Verify the AkShare task**

Run: `PYTHONPATH=apps/akshare-mcp /Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests/test_stock_adapters.py apps/akshare-mcp/tests/test_http_server.py -q`

Expected: all selected tests pass.

- [x] **Step 6: Commit the AkShare slice**

```bash
git add apps/akshare-mcp/akshare_mcp/adapters.py apps/akshare-mcp/akshare_mcp/http_server.py apps/akshare-mcp/tests/test_stock_adapters.py apps/akshare-mcp/tests/test_http_server.py apps/akshare-mcp/README.md
git commit -m "feat(stocks): expose screening universe snapshot"
```

### Task 2: Deterministic criterion parser and editor contract

**Files:**
- Create: `apps/orchestrator/src/stocks/screening-criteria.ts`
- Create: `apps/orchestrator/src/stocks/screening-criteria.test.ts`

**Interfaces:**
- Produces:

```ts
export type StockScreenField =
  | 'exclude_st'
  | 'pe_ttm'
  | 'pb'
  | 'turnover_ratio'
  | 'amount'
  | 'change_pct'
  | 'net_profit_3y_positive'
  | 'debt_ratio'
  | 'roe'
  | 'revenue_yoy'
  | 'net_profit_yoy'
  | 'insider_reduction_recent';

export type StockScreenOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';

export interface StockScreenCriterion {
  id: string;
  field: StockScreenField;
  operator: StockScreenOperator;
  value: boolean | number | [number, number] | null;
  unit: '%' | '元' | null;
  label: string;
  sourceField: string;
  status: 'ready' | 'needs_input';
}

export function parseStockScreenPrompt(prompt: string): {
  criteria: StockScreenCriterion[];
  unparsedClauses: string[];
};

export function validateStockScreenCriteria(criteria: StockScreenCriterion[]): {
  ok: boolean;
  errors: Array<{ criterionId: string; message: string }>;
};
```

- [x] **Step 1: Write parser RED tests**

Cover `排除ST`, `市盈率低于30`, `PB不超过3`, `资产负债率低于50%`, `ROE高于10%`, `近三年持续盈利`, and `近期无减持`. Assert `市盈率不过高` becomes `needs_input` with `value: null`; unrelated prose stays in `unparsedClauses`.

- [x] **Step 2: Run parser tests and verify RED**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stocks/screening-criteria.test.ts`

Expected: FAIL because the module is missing.

- [x] **Step 3: Implement minimal deterministic parsing and validation**

Use explicit regular expressions and stable criterion IDs derived from field plus occurrence order. Deduplicate exact duplicate criteria, reject non-finite numbers, reject inverted `between` bounds, and reject any `needs_input` criterion at run time.

- [x] **Step 4: Verify parser GREEN**

Run the command from Step 2. Expected: all parser and validation tests pass.

- [x] **Step 5: Commit the parser slice**

```bash
git add apps/orchestrator/src/stocks/screening-criteria.ts apps/orchestrator/src/stocks/screening-criteria.test.ts
git commit -m "feat(stocks): parse explicit screening criteria"
```

### Task 3: Explainable two-stage screening service

**Files:**
- Modify: `apps/orchestrator/src/agent/a-share/briefing-types.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-client.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.ts`
- Modify: `apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts`
- Create: `apps/orchestrator/src/stocks/stock-screening-service.ts`
- Create: `apps/orchestrator/src/stocks/stock-screening-service.test.ts`

**Interfaces:**
- Consumes: Task 1 `getScreeningUniverse()` and Task 2 criteria.
- Produces:

```ts
export interface StockCandidateMatch {
  symbol: string;
  name: string;
  snapshotId: string;
  dataAsOf: string;
  matchedCriteria: string[];
  unmetCriteria: string[];
  missingCriteria: string[];
  warnings: Array<{
    key: string;
    severity: '关注' | '警示' | '高风险';
    label: string;
    finding: string;
    source: string;
    asOf: string | null;
  }>;
  evidence: Array<{ id: string; label: string; source: string; asOf: string | null }>;
}

export interface StockScreeningResult {
  snapshotId: string;
  dataAsOf: string;
  coverage: {
    universeCount: number;
    marketPrefilterCount: number;
    deepCheckedCount: number;
    deepCheckLimit: 20;
    truncated: boolean;
  };
  candidates: StockCandidateMatch[];
  zeroResult: boolean;
}
```

- [x] **Step 1: Add HTTP-client RED tests**

Assert `/screening-universe` uses the `market` circuit group, normalizes timeout errors, and maps the standard envelope into `StockScreeningUniverseRow`.

- [x] **Step 2: Implement the client method and verify GREEN**

Add `getScreeningUniverse(): Promise<AkEnvelope<StockScreeningUniverseRow>>` to real and stub clients. Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/a-share/akshare-http-client.test.ts`.

- [x] **Step 3: Write service RED tests**

Test cheap market filtering before deep fetch, four-worker concurrency, a hard deep limit of 20, missing fields not passing, zero-result preservation, stable sorting by complete matches then missing count then amount, and reuse of `detectAllRisks`. Include a candidate with a reduction event and assert a warning appears without recommendation language.

- [x] **Step 4: Implement the service**

Use market fields for the first pass. For the first 20 rows after deterministic amount ordering, fetch fundamentals, valuation, pledge, goodwill, forecast, insider changes, and 90-day announcements with at most four concurrent candidates. Evaluate every criterion into matched/unmet/missing arrays; map `RiskSignal.star` to `警示`, non-star to `关注`, and explicit source failures to `missingCriteria` rather than a clean bill of health.

- [x] **Step 5: Verify service GREEN**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-screening-service.test.ts src/agent/a-share/risk-radar-engine.test.ts src/agent/a-share/akshare-http-client.test.ts`

Expected: all selected tests pass and the compliance sentinel remains green.

- [x] **Step 6: Commit the service slice**

```bash
git add apps/orchestrator/src/agent/a-share/briefing-types.ts apps/orchestrator/src/agent/a-share/akshare-client.ts apps/orchestrator/src/agent/a-share/akshare-http-client.ts apps/orchestrator/src/agent/a-share/akshare-http-client.test.ts apps/orchestrator/src/stocks/stock-screening-service.ts apps/orchestrator/src/stocks/stock-screening-service.test.ts
git commit -m "feat(stocks): evaluate explainable screening candidates"
```

### Task 4: Trusted tRPC screening procedures

**Files:**
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-screening.test.ts`

**Interfaces:**
- Produces: `stocks.previewScreening.query({ prompt })`.
- Produces: `stocks.runScreening.mutate({ snapshotId, dataAsOf, criteria })`.
- `runScreening` rejects non-current, stale, unowned, or mismatched snapshots before any AkShare deep fetch.

- [ ] **Step 1: Write router RED tests**

Assert preview returns editable criteria plus unparsed clauses. Assert run rejects `historical`, `delayed`, `unavailable`, foreign snapshot IDs, mismatched dates, incomplete criteria, over 20 criteria, and empty criteria. Assert a valid current snapshot reaches the injected screening service.

- [ ] **Step 2: Run router tests and verify RED**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks-screening.test.ts`

Expected: FAIL because the procedures do not exist.

- [ ] **Step 3: Implement the procedures**

Reuse the existing persisted dashboard snapshot lookup and ownership checks from stock-task context validation. Use Zod discriminated validation for boolean, scalar, and range values. Log only `userId`, `snapshotId`, criterion fields, coverage counts, duration, and stable error codes; never log the natural-language prompt or candidate payload.

- [ ] **Step 4: Verify router GREEN and P0 regression**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/stocks-screening.test.ts src/trpc/routers/stocks.test.ts src/stocks/stock-task-context.test.ts src/stocks/stock-trust.test.ts`

- [ ] **Step 5: Commit the router slice**

```bash
git add apps/orchestrator/src/trpc/routers/stocks.ts apps/orchestrator/src/trpc/routers/stocks.test.ts apps/orchestrator/src/trpc/routers/stocks-screening.test.ts
git commit -m "feat(stocks): bind screening runs to trusted snapshots"
```

### Task 5: Screening workbench UI

**Files:**
- Create: `apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx`
- Create: `apps/web-workbench/src/components/stocks/stock-screening-state.ts`
- Create: `apps/web-workbench/src/components/stocks/stock-screening-state.test.ts`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/stock-tasks-layout.test.ts`

**Interfaces:**
- Consumes: `previewScreening`, `runScreening`, and the current dashboard trust envelope.
- Produces: prompt entry, editable criterion rows, explicit unparsed-clause warning, run confirmation, coverage summary, explanatory candidates, zero-result state, and add-to-watchlist action.

- [ ] **Step 1: Write state RED tests**

Test that `needs_input` blocks execution, numeric edits preserve the server criterion field/operator, all missing data renders as “缺少数据”, zero matches never change criteria, and current-trust gating requires both snapshot ID and data date.

- [ ] **Step 2: Run state tests and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/stock-screening-state.test.ts`

Expected: FAIL because the state module is missing.

- [ ] **Step 3: Implement the pure state helpers**

Create focused helpers for editable values, criterion validation summaries, coverage copy, and match grouping. Do not put parsing rules in the browser.

- [ ] **Step 4: Add layout RED assertions**

Assert the page imports and renders `StockScreeningWorkbench` after `MarketHighlights`, passes the current `snapshotId/dataAsOf/trustMode`, and exposes an add-to-watchlist callback. Assert the component contains native `title` plus `aria-label` on icon-only controls.

- [ ] **Step 5: Implement the component and integrate it**

Use the existing white workbench cards and quiet pink accent. The initial card shows one prompt and examples. Preview renders editable compact criteria; run is a separate explicit action. Results show why each candidate matched, failed, or lacks data, risk warnings, evidence metadata, and coverage limits. The footer states “条件匹配不等于投资建议”. Do not introduce charts, recommendation badges, or a composite score.

- [ ] **Step 6: Verify web GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/stock-screening-state.test.ts src/pages/stock-tasks-layout.test.ts src/pages/StockTasksPage.test.ts src/lib/stock-dashboard-trust.test.ts`

- [ ] **Step 7: Commit the web slice**

```bash
git add apps/web-workbench/src/components/stocks/StockScreeningWorkbench.tsx apps/web-workbench/src/components/stocks/stock-screening-state.ts apps/web-workbench/src/components/stocks/stock-screening-state.test.ts apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-tasks-layout.test.ts
git commit -m "feat(stocks): add transparent screening workbench"
```

### Task 6: Verification and delivery

**Files:**
- Modify: `docs/superpowers/plans/2026-08-17-stock-screening-p1a.md` only to check completed steps.

**Interfaces:**
- Produces: a verified branch and Ready PR targeting `claude/musing-keller-ae1d05`.

- [ ] **Step 1: Run full affected test suites**

Run:

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
PYTHONPATH=apps/akshare-mcp /Users/yaleiqi/holaday-monorepo/apps/akshare-mcp/.venv/bin/python -m pytest apps/akshare-mcp/tests -q
```

Expected: all test suites pass.

- [ ] **Step 2: Run typechecks and builds**

Run:

```bash
pnpm typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build
```

Expected: all commands exit 0.

- [ ] **Step 3: Run release and diff gates**

Run:

```bash
node --test apps/orchestrator/scripts/release-db-contract.test.mjs
git diff --check
git status --short
```

Expected: release migration contracts pass, diff check is clean, and only intentional files are present.

- [ ] **Step 4: Perform authenticated browser verification**

Open `/stocks`, confirm preview-before-run, ambiguous threshold blocking, explanatory results, zero-result behavior, add-to-watchlist action, current-trust gating, and a 390px viewport with no clipping. Do not create a real production screening run during local verification.

- [ ] **Step 5: Push and open a Ready PR**

Push `codex/stock-screening-p1a` and create a Ready PR into `claude/musing-keller-ae1d05`. Do not merge or deploy without a separate release decision after review.
