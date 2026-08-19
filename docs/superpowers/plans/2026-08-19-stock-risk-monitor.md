# HOLA DAY 股票风险持续监控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把股票风险雷达中的确定性风险检查转换为可持续运行、去重提醒且可追溯的规划任务闭环。

**Architecture:** 复用 `planned_tasks` 的调度与状态操作，在普通自由文本任务分发前插入一个股票风险专用执行器。专用执行器只读取最新持久化可信快照、调用现有确定性风险雷达、比较上次有效状态并写结构化运行结果；生成模型不参与风险成立、等级或变化类型判断。

**Tech Stack:** TypeScript、Node.js、tRPC、Drizzle ORM/MySQL、React、React Router、Radix Sheet、Vitest、Testing Library、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-19-stock-risk-monitor-design.md`

## Global Constraints

- 每个用户、每个股票代码只有一个活动风险监控；重复创建返回已有记录。
- 默认每天上海时间 16:30 执行，时区固定为 `Asia/Shanghai`；可信快照日期未前进时只记录 `skipped`。
- 风险规则固定为 `pledge / goodwill / forecast / insider / announcements`；来源不可用时不得把风险判定为解除。
- 只在新增、升级、解除或无法判断时创建站内通知；不向 webhook、短信、邮件或其他外部渠道发送。
- 通知、运行记录和日志不得保存原始上游响应、推荐语、自由推断、密钥或额外个人数据。
- 普通规划任务、旧通知和旧运行记录行为保持不变；新增列全部可空，迁移纯增量。
- 本轮不增加价格阈值、买卖建议、收益预测、自动交易、自定义风险等级或多股票合并计划。
- 交付目标仅为 `application`；不修改或部署 AkShare。

---

### Task 1: 持久化契约与确定性状态比较

**Files:**
- Create: `apps/orchestrator/drizzle/0049_stock_risk_monitors.sql`
- Create: `apps/orchestrator/src/db/schema/stock-risk-monitors.ts`
- Create: `apps/orchestrator/src/db/schema/stock-risk-monitors.test.ts`
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-state.ts`
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-state.test.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Modify: `apps/orchestrator/src/db/schema/planned-tasks.ts`
- Modify: `apps/orchestrator/src/db/schema/notifications.ts`

**Interfaces:**
- Consumes: `StockRiskCheckKey`, `StockRiskSeverity`, `StockRiskSignalRecord`, `StockRiskSourceCheck` from `stock-risk-radar-service.ts`.
- Produces: `STOCK_RISK_CHECK_KEYS`, `CanonicalStockRiskMonitorSignal`, `StockRiskChangeItem`, `StockRiskMonitorState`, `StockRiskMonitorRunResultV1`, `compareStockRiskMonitorState(previous, current, checks)`, `stockRiskNotificationFingerprint(input)`, `nextShanghaiPostmarketRun(now)`.

- [ ] **Step 1: Write failing schema and pure-state tests**

```ts
it('keeps unavailable source risks unresolved and sorts real changes deterministically', () => {
  const result = compareStockRiskMonitorState(
    [
      signal('600000', 'pledge', '高风险'),
      signal('600000', 'forecast', '关注'),
    ],
    [signal('600000', 'forecast', '警示')],
    [
      check('pledge', 'unavailable'),
      check('forecast', 'checked'),
    ],
  );
  expect(result).toEqual({
    added: [],
    upgraded: [{ key: 'forecast', fromSeverity: '关注', toSeverity: '警示' }],
    resolved: [],
    unavailableChecks: ['pledge'],
  });
});

it('returns the next Shanghai 16:30 boundary before and after cutoff', () => {
  expect(nextShanghaiPostmarketRun(new Date('2026-08-19T08:29:59.000Z')).toISOString())
    .toBe('2026-08-19T08:30:00.000Z');
  expect(nextShanghaiPostmarketRun(new Date('2026-08-19T08:30:00.000Z')).toISOString())
    .toBe('2026-08-20T08:30:00.000Z');
});
```

Schema tests must use `getTableColumns`/`getTableConfig` and read `0049_stock_risk_monitors.sql` to assert:

```ts
expect(Object.keys(getTableColumns(stockRiskMonitors))).toContain('lastSignalsJson');
expect(getTableColumns(plannedTaskRuns).resultJson.notNull).toBe(false);
expect(getTableColumns(notifications).plannedTaskId.notNull).toBe(false);
expect(uniqueIndexNames).toEqual(expect.arrayContaining([
  'uk_stock_risk_monitors_external_id',
  'uk_stock_risk_monitors_user_symbol',
  'uk_stock_risk_monitors_plan',
]));
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/stock-risk-monitors.test.ts src/stocks/stock-risk-monitor-state.test.ts
```

Expected: FAIL because the schema module and state module do not exist.

- [ ] **Step 3: Add the additive migration and Drizzle schema**

The migration creates `stock_risk_monitors`, adds `planned_task_runs.result_json JSON NULL`, and adds `notifications.planned_task_id BIGINT UNSIGNED NULL` with `ON DELETE SET NULL`. The table stores only the five canonical risk keys and compact state JSON, with these exact unique constraints:

```sql
UNIQUE KEY `uk_stock_risk_monitors_external_id` (`external_id`),
UNIQUE KEY `uk_stock_risk_monitors_user_symbol` (`user_id`, `symbol`),
UNIQUE KEY `uk_stock_risk_monitors_plan` (`planned_task_id`)
```

- [ ] **Step 4: Implement canonical comparison, fingerprinting and Shanghai schedule helpers**

Use the following public shape:

```ts
export interface CanonicalStockRiskMonitorSignal {
  symbol: string;
  key: StockRiskCheckKey;
  severity: StockRiskSeverity;
  signalId: string;
  evidenceId: string;
  sourceDataAsOf: string | null;
}

export interface StockRiskMonitorRunResultV1 {
  kind: 'stock-risk-monitor';
  version: 1;
  monitorId: string;
  symbol: string;
  name: string;
  dataAsOf: string | null;
  outcome: 'changed' | 'unavailable' | 'unchanged' | 'skipped' | 'failed';
  added: StockRiskChangeItem[];
  upgraded: StockRiskChangeItem[];
  resolved: StockRiskChangeItem[];
  unavailableChecks: StockRiskCheckKey[];
  summary: string;
}
```

Normalize all arrays before hashing with `createHash('sha256')`, cap summary at 500 characters, and rank severities `高风险 > 警示 > 关注`, then fixed key order.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 6: Commit the persistence and state contract**

```bash
git add apps/orchestrator/drizzle/0049_stock_risk_monitors.sql apps/orchestrator/src/db/schema apps/orchestrator/src/stocks/stock-risk-monitor-state.ts apps/orchestrator/src/stocks/stock-risk-monitor-state.test.ts
git commit -m "feat(stocks): add risk monitor state model"
```

---

### Task 2: 可信创建服务与股票监控 API

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-service.ts`
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-service.test.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-risk-monitor.ts`
- Create: `apps/orchestrator/src/trpc/routers/stocks-risk-monitor.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`

**Interfaces:**
- Consumes: `runTrustedStockRiskRadar`, `validateStockTaskContext`, `nextShanghaiPostmarketRun`, tables from Task 1.
- Produces: `createStockRiskMonitor(args)`, `listStockRiskMonitors(args)`, `stockRiskMonitorInputSchema`, `stockRiskMonitorProcedures` containing `riskMonitors` and `createRiskMonitor`.

- [ ] **Step 1: Write failing service tests for trust, ownership and idempotency**

```ts
it('creates one daily plan and uses current trusted radar state as a silent baseline', async () => {
  const created = await createStockRiskMonitor(fixture({ trustMode: 'current' }));
  expect(created.created).toBe(true);
  expect(created.monitor.symbol).toBe('603528');
  expect(created.monitor.status).toBe('active');
  expect(created.monitor.nextRunAt.toISOString()).toBe('2026-08-20T08:30:00.000Z');
  expect(inboxRows).toHaveLength(0);
  expect(planRows[0]).toMatchObject({ repeatType: 'daily', timezone: 'Asia/Shanghai' });
});

it('returns the same monitor for the same user and symbol', async () => {
  const first = await createStockRiskMonitor(fixture());
  const second = await createStockRiskMonitor(fixture());
  expect(second).toMatchObject({ created: false, monitor: { monitorId: first.monitor.monitorId } });
  expect(planRows).toHaveLength(1);
});
```

Also cover literal failures for `delayed`/`historical`, altered `dataAsOf`, a symbol absent from the trusted watchlist, and a second user who must not see the first user's monitor.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-risk-monitor-service.test.ts src/trpc/routers/stocks-risk-monitor.test.ts
```

Expected: FAIL because creation/list procedures are missing.

- [ ] **Step 3: Implement the creation transaction**

`createStockRiskMonitor` must accept only server context plus:

```ts
{
  snapshotId: string;
  dataAsOf: string;
  trustMode: 'current';
  symbol: string;
}
```

Resolve name and market from the validated snapshot, run the radar, store only that symbol's compact baseline, create title `监控 {name} 风险变化`, instruction `系统专用：检查 {name}（{symbol}）风险变化`, and insert exactly one enabled planned item. On duplicate user/symbol, reload and return the owned existing record.

- [ ] **Step 4: Implement list and tRPC procedures**

`riskMonitors` accepts the same snapshot context as the radar and returns only snapshot watchlist symbols. `createRiskMonitor` restricts `trustMode` to literal `current`; names, market and risk facts never come from the client. Register both procedures directly on `stocksRouter` without changing existing `riskRadar` behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 6: Commit the creation API**

```bash
git add apps/orchestrator/src/stocks/stock-risk-monitor-service.ts apps/orchestrator/src/stocks/stock-risk-monitor-service.test.ts apps/orchestrator/src/trpc/routers/stocks-risk-monitor.ts apps/orchestrator/src/trpc/routers/stocks-risk-monitor.test.ts apps/orchestrator/src/trpc/routers/stocks.ts
git commit -m "feat(stocks): create trusted risk monitors"
```

---

### Task 3: 规划任务专用执行器与结构化运行记录

**Files:**
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.ts`
- Create: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.test.ts`
- Modify: `apps/orchestrator/src/planned/planned-runner.ts`
- Modify: `apps/orchestrator/src/planned/planned-runner.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/planned-tasks.ts`
- Modify: `apps/orchestrator/src/index.ts`

**Interfaces:**
- Consumes: current persisted `stock_dashboard_snapshots`, Task 1 comparison/result types, Task 2 monitor rows, existing `runStockRiskRadar`.
- Produces: `StockRiskSpecialDispatchResult`, `StockRiskSpecialDispatcher`, `executeStockRiskMonitorRun(args)`, optional `specialDispatcher` dependency in planned dispatch.

- [ ] **Step 1: Write failing executor and runner-boundary tests**

```ts
it('handles a monitor run without creating a generic task', async () => {
  const result = await executeStockRiskMonitorRun(executorFixture({ nextSignals: [] }));
  expect(result).toMatchObject({ handled: true, result: { outcome: 'unchanged' } });
  expect(genericTaskCreates).toHaveLength(0);
  expect(runRows[0]).toMatchObject({ status: 'complete', itemsDone: 1 });
});

it('leaves an ordinary planned task on the existing generic path', async () => {
  await dispatchFixture({ monitor: null });
  expect(genericTaskCreates).toHaveLength(1);
});
```

Add cases for added/upgraded/resolved, partial source unavailable, no newer `dataAsOf`, stock removed from watchlist, manual and scheduled trigger equivalence, and internal failure preserving the previous baseline.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/stocks/stock-risk-monitor-executor.test.ts src/planned/planned-runner.test.ts
```

Expected: FAIL because the specialized executor hook does not exist.

- [ ] **Step 3: Add the specialized dispatch hook before generic task creation**

Define:

```ts
export type StockRiskSpecialDispatchResult =
  | { handled: false }
  | { handled: true; result: StockRiskMonitorRunResultV1; notification: StockRiskMonitorNotification | null };

export type StockRiskSpecialDispatcher = (input: {
  ctx: AuthenticatedContext;
  runExternalId: string;
  plannedTaskInternalId: number;
  trigger: 'scheduled' | 'manual';
}) => Promise<StockRiskSpecialDispatchResult>;
```

If `handled:true`, update the run item and run without calling `tasksRouter`/`batchTasksRouter`. If `handled:false`, continue the existing branch byte-for-byte in behavior.

- [ ] **Step 4: Implement latest-trusted-snapshot execution and transactional result update**

Select the latest persisted dashboard snapshot for the monitor's user. Produce:

- `skipped` when the symbol is no longer watched or `dataAsOf` did not advance;
- `unavailable` when one or more canonical checks are unavailable;
- `changed` for added/upgraded/resolved;
- `unchanged` otherwise;
- `failed` only for an internal exception.

On successful comparison, a single transaction updates `planned_task_runs.result_json`, run counters/status, planned task last-run fields, and monitor baseline/fingerprint. On failure, update only run/planned failure metadata and preserve the monitor baseline.

- [ ] **Step 5: Wire the executor into production startup and expose `resultJson`**

Construct the dispatcher once in `index.ts` with the real DB, logger and risk client. Add nullable `resultJson` to `plannedTasks.runs` output; generic records return `null`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 7: Commit the execution path**

```bash
git add apps/orchestrator/src/stocks/stock-risk-monitor-executor.ts apps/orchestrator/src/stocks/stock-risk-monitor-executor.test.ts apps/orchestrator/src/planned/planned-runner.ts apps/orchestrator/src/planned/planned-runner.test.ts apps/orchestrator/src/trpc/routers/planned-tasks.ts apps/orchestrator/src/index.ts
git commit -m "feat(stocks): execute risk monitors through planned runs"
```

---

### Task 4: 站内通知去重与规划任务跳转数据

**Files:**
- Modify: `apps/orchestrator/src/notifications/notification-service.ts`
- Modify: `apps/orchestrator/src/notifications/notification-service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/notifications.ts`
- Modify: `apps/orchestrator/src/trpc/routers/notifications.test.ts`
- Modify: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.ts`
- Modify: `apps/orchestrator/src/stocks/stock-risk-monitor-executor.test.ts`

**Interfaces:**
- Consumes: notification candidate from Task 3 and `notifications.plannedTaskId` from Task 1.
- Produces: `NotifyInput.delivery: 'all' | 'in_app_only'` defaulting to `all`, `NotifyInput.plannedTaskInternalId`, notification list field `plannedTaskId: string | null`.

- [ ] **Step 1: Write failing tests for in-app-only delivery and stable dedupe**

```ts
it('writes a stock alert to the inbox but never enumerates webhook channels', async () => {
  const result = await notify(deps, {
    userInternalId: 7,
    type: 'task_complete',
    title: '多伦科技风险发生变化',
    message: '数据日期 2026-08-19：新增 1 条警示',
    plannedTaskInternalId: 42,
    delivery: 'in_app_only',
  });
  expect(result.channelResults).toEqual([]);
  expect(channelSelectCount).toBe(0);
  expect(inboxRows[0]).toMatchObject({ plannedTaskId: 42 });
});

it('does not create a second notification for the same canonical fingerprint', async () => {
  await executeStockRiskMonitorRun(fixture({ runExternalId: 'run_1' }));
  await executeStockRiskMonitorRun(fixture({ runExternalId: 'run_2' }));
  expect(inboxRows).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/notifications/notification-service.test.ts src/trpc/routers/notifications.test.ts src/stocks/stock-risk-monitor-executor.test.ts
```

Expected: FAIL because delivery mode and public planned task ID are missing.

- [ ] **Step 3: Implement in-app-only notification delivery**

After the inbox insert, return immediately when `delivery === 'in_app_only'`; the default remains `all` for existing scheduled-task notifications. Store `plannedTaskInternalId` separately from legacy `scheduledTaskInternalId`.

- [ ] **Step 4: Join owned planned tasks in notification list**

Return external `plannedTaskId`, not an internal DB ID. Preserve `scheduledTaskInternalId` for old scheduled notifications. A missing/deleted plan returns `plannedTaskId: null`.

- [ ] **Step 5: Call notify after executor transaction commit**

Only `changed` and deduped `unavailable` outcomes create a notification. Use bounded deterministic copy and `delivery:'in_app_only'`. Notification failure is logged with monitor ID, symbol, date and error code, but does not rerun the risk check or roll back state.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 7: Commit the notification boundary**

```bash
git add apps/orchestrator/src/notifications apps/orchestrator/src/trpc/routers/notifications.ts apps/orchestrator/src/trpc/routers/notifications.test.ts apps/orchestrator/src/stocks/stock-risk-monitor-executor.ts apps/orchestrator/src/stocks/stock-risk-monitor-executor.test.ts
git commit -m "feat(stocks): notify risk changes in app"
```

---

### Task 5: 风险雷达监控确认与状态交互

**Files:**
- Create: `apps/web-workbench/src/components/stocks/StockRiskMonitorSheet.tsx`
- Create: `apps/web-workbench/src/components/stocks/StockRiskMonitorSheet.test.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockRiskRadar.tsx`
- Modify: `apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx`

**Interfaces:**
- Consumes: `trpc.stocks.riskMonitors`, `trpc.stocks.createRiskMonitor`, existing `plannedTasks.toggle`, `plannedTasks.runNow`, `plannedTasks.archive`.
- Produces: expanded `StockRiskRadarApi` with `loadMonitors`, `createMonitor`, `toggleMonitor`, `runMonitorNow`, `archiveMonitor`; confirmation sheet with focus restoration.

- [ ] **Step 1: Write failing component tests**

```tsx
it('creates monitoring only after confirming the bounded rules', async () => {
  render(<StockRiskRadar {...currentTrust} api={api} />);
  await screen.findByText('多伦科技');
  await user.click(screen.getByRole('button', { name: '持续监控多伦科技' }));
  expect(screen.getByRole('dialog', { name: '持续监控多伦科技风险' })).toBeVisible();
  expect(screen.getByText('每天 16:30 · Asia/Shanghai')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '确认开始监控' }));
  expect(api.createMonitor).toHaveBeenCalledWith({ ...currentTrust, symbol: '603528' });
  expect(await screen.findByText('监控中')).toBeVisible();
});

it('keeps verified risk facts visible when monitor status loading fails', async () => {
  render(<StockRiskRadar {...currentTrust} api={monitorFailureApi} />);
  expect(await screen.findByText('质押比例偏高')).toBeVisible();
  expect(screen.queryByText('本次风险检查未完成')).not.toBeInTheDocument();
});
```

Add active/paused/failed rendering, next-run/last-summary, duplicate-create response, trigger-focus restoration, native `title`, and 390px no-overflow assertions.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockRiskMonitorSheet.test.tsx src/components/stocks/StockRiskRadar.test.tsx
```

Expected: FAIL because monitor controls and sheet do not exist.

- [ ] **Step 3: Build the accessible confirmation Sheet**

Show stock identity, current `dataAsOf`, five rule labels, daily execution time, change-only notification boundary and non-advice disclosure. Disable confirm while creating, surface the normalized error inline, and let Radix restore focus to the invoking button.

- [ ] **Step 4: Add per-stock monitor status and actions**

Load monitor status after risk success without sharing the risk error state. Use text plus icon for active/paused/failed. Active shows next check and record link; paused exposes resume; failed exposes record and run-now. At `max-width:390px`, use wrapping action rows and no fixed widths.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 6: Commit the risk radar UI**

```bash
git add apps/web-workbench/src/components/stocks/StockRiskMonitorSheet.tsx apps/web-workbench/src/components/stocks/StockRiskMonitorSheet.test.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.tsx apps/web-workbench/src/components/stocks/StockRiskRadar.test.tsx
git commit -m "feat(stocks): add persistent risk monitor controls"
```

---

### Task 6: 规划详情深链与通知入口

**Files:**
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/planned/PlannedTasksPage.test.tsx`
- Modify: `apps/web-workbench/src/lib/notification-bell-state.ts`
- Modify: `apps/web-workbench/src/lib/notification-bell-state.test.ts`
- Modify: `apps/web-workbench/src/components/notifications/NotificationBell.tsx`
- Modify: `apps/web-workbench/src/components/notifications/NotificationBell.test.ts`

**Interfaces:**
- Consumes: public `plannedTaskId` from notification list and `resultJson` from planned runs.
- Produces: `plannedNotificationHref(plannedTaskId)`, normalized `plannedTaskId`, one-time owned-plan query-param opener for `/planned?plan=`.

- [ ] **Step 1: Write failing deep-link and normalization tests**

```ts
it('opens only a plan present in the current user list', async () => {
  renderPlannedPage('/planned?plan=plan_owned', [ownedPlan]);
  expect(await screen.findByRole('dialog', { name: '监控多伦科技风险变化' })).toBeVisible();
  expect(api.loadPlan).toHaveBeenCalledWith('plan_owned');
});

it('silently ignores an unknown plan query parameter', async () => {
  renderPlannedPage('/planned?plan=plan_foreign', [ownedPlan]);
  await screen.findByText(ownedPlan.title);
  expect(api.loadPlan).not.toHaveBeenCalled();
});

expect(plannedNotificationHref('plan_abc')).toBe('/planned?plan=plan_abc');
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/pages/planned/PlannedTasksPage.test.tsx src/lib/notification-bell-state.test.ts src/components/notifications/NotificationBell.test.ts
```

Expected: FAIL because `plan` query handling and planned notification href are missing.

- [ ] **Step 3: Implement safe one-time plan query handling**

After the owned plan list has loaded, find an exact public ID match and call the existing `openPlan` once. Unknown IDs, empty values and IDs absent from the current user's list perform no detail request and show no error.

- [ ] **Step 4: Add planned-task notification navigation**

Normalize `plannedTaskId` as a non-empty string or `null`. In the notification detail modal, show a secondary `查看规划记录` action only when it exists, navigate to `/planned?plan=${encodeURIComponent(id)}`, and retain the legacy scheduled-task action for old notifications.

- [ ] **Step 5: Render structured monitor run summaries in plan history**

When `resultJson.kind === 'stock-risk-monitor'` and `version === 1`, show outcome, `dataAsOf`, bounded summary and change counts. Malformed/unknown JSON falls back to the existing generic run row without throwing.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests PASS.

- [ ] **Step 7: Commit navigation and history UX**

```bash
git add apps/web-workbench/src/pages/planned/PlannedTasksPage.tsx apps/web-workbench/src/pages/planned/PlannedTasksPage.test.tsx apps/web-workbench/src/lib/notification-bell-state.ts apps/web-workbench/src/lib/notification-bell-state.test.ts apps/web-workbench/src/components/notifications/NotificationBell.tsx apps/web-workbench/src/components/notifications/NotificationBell.test.ts
git commit -m "feat(stocks): link risk alerts to planned history"
```

---

### Task 7: 全量门禁、浏览器验收与发布

**Files:**
- Modify only if verification exposes a regression in files already touched by Tasks 1-6.

**Interfaces:**
- Consumes: completed implementation from Tasks 1-6.
- Produces: one reviewed PR, merged `application` deployment, production verification evidence.

- [ ] **Step 1: Run targeted changed-area tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/stock-risk-monitors.test.ts src/stocks/stock-risk-monitor-state.test.ts src/stocks/stock-risk-monitor-service.test.ts src/stocks/stock-risk-monitor-executor.test.ts src/planned/planned-runner.test.ts src/notifications/notification-service.test.ts src/trpc/routers/stocks-risk-monitor.test.ts src/trpc/routers/notifications.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/components/stocks/StockRiskMonitorSheet.test.tsx src/components/stocks/StockRiskRadar.test.tsx src/pages/planned/PlannedTasksPage.test.tsx src/lib/notification-bell-state.test.ts src/components/notifications/NotificationBell.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run repository gates**

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench build
pnpm db:verify
git diff --check
```

Expected: all commands exit 0. If repository-wide lint reports known unrelated Biome noise, run lint on every touched TypeScript/TSX file and record both the full-suite limitation and focused result.

- [ ] **Step 3: Verify browser behavior locally**

At 1440px and 390px verify:

1. current trusted stock creates one monitor after confirmation;
2. duplicate create returns the same monitor;
3. monitor status failure does not hide risk facts;
4. active/paused/failed states remain readable and keyboard operable;
5. `/planned?plan=<owned>` opens history while an unknown ID stays on the list;
6. notification detail links to planned history;
7. no horizontal overflow and reduced-motion mode has no forced animation.

- [ ] **Step 4: Run verification-before-completion and request code review**

Use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`. Resolve only actionable findings inside the approved scope and rerun affected focused tests plus `git diff --check`.

- [ ] **Step 5: Finish the branch and open the PR**

Use `superpowers:finishing-a-development-branch`; push `codex/stock-risk-monitor` and create one PR against the current release branch. The PR must state migration/rollback behavior, deterministic financial boundary, in-app-only delivery, test evidence and explicit exclusions.

- [ ] **Step 6: Merge, deploy `application`, and verify production**

After the already-authorized merge/deploy workflow completes:

1. both `https://holaday.ai/api/healthz` and `https://hd-app.orangebench.tech/api/healthz` return HTTP 200 with `status: ok`;
2. migration verification passes and orchestrator remains non-root;
3. both domains load the same new application bundle;
4. a current trusted production monitor creates exactly one plan;
5. manual run produces an explainable result with data date;
6. repeated manual run does not duplicate notifications;
7. pause/resume changes scheduling correctly;
8. old snapshot creation is rejected;
9. source-unavailable result never reports a resolution;
10. production console has no new error.

- [ ] **Step 7: Record final release evidence**

Report exact PR, merge commit, deployment ID, bundle ID, migration status, health response summaries, focused/full gate totals, production scenario outcomes, unresolved risks, and rollback trigger. Do not report secret values, raw upstream payloads, notification bodies or personal data.
