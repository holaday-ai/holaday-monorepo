# HOLA DAY 今日能量隐私最小化观测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为今日能量增加聚合优先、隐私最小化、可幂等、可灰度和可回滚的 B/P2 数据闭环，同时保持页面体验和 DivineAPI 内容不依赖观测服务。

**Architecture:** 客户端沿用单一 reporter，在入队时生成 UUID 并复用该 UUID 完成一次有限重试；Orchestrator 使用严格 Zod 白名单，将事件规范化为固定维度后，在同一事务内认领短期收据、累加每日聚合桶，并仅对首页访问写入 HMAC 匿名日访客。管理员只能读取 7/30 天聚合结果；三类数据分别按 48 小时、30 天、400 天清理，写入由默认关闭的功能开关控制。

**Tech Stack:** TypeScript 5.7、React 18、tRPC 11、Zod 3、Drizzle ORM 0.38、MySQL/MariaDB、Vitest 2、Testing Library、Node `crypto`。

## Global Constraints

- 不增加“有帮助／没有帮助”交互，不定义或发送 `energy_feedback_submitted`。
- 不保存原始事件流、可重放行为时间线、真实用户 ID、邮箱、生日、出生地、个人档案、测试答案、塔罗问题、自由文本或第三方星座正文。
- `/cosmic-preview`、未登录预览和缺少 `storageScope` 的页面不发送观测事件。
- `energy_daily_metrics` 保留最多 400 天；`energy_daily_visitors` 保留最多 30 天；`energy_event_receipts` 保留最多 48 小时。
- `ENERGY_ANALYTICS_HMAC_SECRET` 必须独立，不复用 JWT、OpenAI、DivineAPI 或支付密钥；密钥值不得进入日志、文档、提交、PR 或测试夹具。
- `ENERGY_ANALYTICS_ENABLED` 默认 `false`；观测写入或清理失败不得改变页面、玩法结果、推荐、DivineAPI 内容或应用启动结果。
- 所有事件输入对象保持 `.strict()`；新客户端携带 UUID `eventId`，服务端过渡期兼容旧客户端缺失 `eventId`。
- 只提供管理员聚合查询，不建设运营看板、内容后台、分群推荐或 Staff 对比。
- migration 只允许新增表和索引，不删除或改写现有业务表；回滚首选关闭功能开关，不执行破坏性逆向 migration。
- 客户端网络或 5xx 最多重试一次，4xx 不重试，并发上限仍为 8，卸载后放弃待重试事件。
- 所有统计日期由服务端按 UTC 生成；D1 只计算已经拥有完整次日数据的 cohort。

---

## File Map

- Create `apps/orchestrator/drizzle/0046_energy_analytics.sql`: 纯新增的三表 migration 与全部唯一键、查询索引、清理索引。
- Create `apps/orchestrator/src/db/schema/energy-analytics.ts`: 三张表的 Drizzle schema 和 inferred types。
- Create `apps/orchestrator/src/db/schema/energy-analytics.test.ts`: schema、migration 安全性和保留字段契约测试。
- Modify `apps/orchestrator/src/db/schema/index.ts`: 导出新 schema。
- Modify `apps/orchestrator/scripts/verify-db-schema.ts`: 把三张表及关键列加入在线 schema 校验。
- Modify `apps/orchestrator/scripts/release-db-contract.mjs`: 把六个关键唯一/查询/清理索引加入发布门禁。
- Modify `apps/orchestrator/scripts/release-db-contract.test.mjs`: 覆盖新索引完整性和唯一性。
- Create `apps/orchestrator/src/energy/analytics-contract.ts`: 严格事件白名单、旧事件兼容和事件类型。
- Create `apps/orchestrator/src/energy/analytics-bucket.ts`: UTC 日期、固定维度规范化、稳定桶哈希、HMAC 访客键和过期时间纯函数。
- Create `apps/orchestrator/src/energy/analytics-bucket.test.ts`: 规范化、隐私边界、UTC 和 TTL 测试。
- Modify `apps/orchestrator/src/config/env.ts`: 新增默认关闭的开关、独立密钥和有上限的保留配置。
- Create `apps/orchestrator/src/config/env.energy-analytics.test.ts`: 配置默认值、上限与密钥格式测试。
- Create `apps/orchestrator/src/energy/analytics-store.ts`: 唯一数据库适配层；提供事务写入、无身份聚合读取和有界删除。
- Create `apps/orchestrator/src/energy/analytics-write-service.ts`: 功能开关、幂等、同事务聚合和匿名访客写入。
- Create `apps/orchestrator/src/energy/analytics-write-service.test.ts`: 状态型内存 store 测试幂等、回滚、缺密钥降级和不留身份。
- Create `apps/orchestrator/src/energy/analytics-metrics-service.ts`: 7/30 天聚合结果、D1 与比率公式。
- Create `apps/orchestrator/src/energy/analytics-metrics-service.test.ts`: 空分母、未完整次日和聚合响应隐私测试。
- Create `apps/orchestrator/src/energy/analytics-cleanup.ts`: 三表分批、有限轮次清理、每小时定时器与积压接续。
- Create `apps/orchestrator/src/energy/analytics-cleanup.test.ts`: 过期边界、批量上限、积压接续、失败非致命和 timer 生命周期测试。
- Modify `apps/orchestrator/src/trpc/routers/energy.ts`: 使用共享契约和服务，移除逐事件日志，新增 `adminProcedure` 聚合查询。
- Modify `apps/orchestrator/src/trpc/routers/energy.test.ts`: 路由兼容、严格拒绝、权限和脱敏响应测试。
- Modify `apps/orchestrator/src/index.ts`: 启动独立的每小时清理 timer；统计开关关闭时仍允许清理旧数据。
- Modify `apps/web-workbench/src/components/energy/energy-event-reporter.ts`: 入队时生成 UUID，一次重试复用同一个 UUID。
- Modify `apps/web-workbench/src/components/energy/energy-event-reporter.test.ts`: UUID、重试复用、4xx、dispose 和并发边界测试。
- Modify `apps/web-workbench/src/components/energy/EnergyHome.tsx`: 首页、补给方向和正确重玩事件。
- Modify `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`: 登录/预览、选择去重、生命周期和无反馈控件测试。
- Create `docs/runbooks/today-energy-analytics-rollout.md`: 迁移、密钥、灰度、验证、监控和关闭开关回滚步骤。

### Task 1: Additive database foundation and release contract

**Files:**
- Create: `apps/orchestrator/drizzle/0046_energy_analytics.sql`
- Create: `apps/orchestrator/src/db/schema/energy-analytics.ts`
- Create: `apps/orchestrator/src/db/schema/energy-analytics.test.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Modify: `apps/orchestrator/scripts/verify-db-schema.ts`
- Modify: `apps/orchestrator/scripts/release-db-contract.mjs`
- Modify: `apps/orchestrator/scripts/release-db-contract.test.mjs`

**Interfaces:**
- Consumes: existing Drizzle `mysqlTable`, numbered migration runner, `findMissingRequiredIndexes()` and `db:verify` conventions.
- Produces: `energyDailyMetrics`, `energyDailyVisitors`, `energyEventReceipts` and database uniqueness/retention guarantees used by Tasks 3–5.

- [ ] **Step 1: Write the failing schema and migration contract tests**

Create `apps/orchestrator/src/db/schema/energy-analytics.test.ts` with assertions that enumerate the privacy-safe columns, read `0046_energy_analytics.sql`, and reject destructive SQL:

```ts
import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  energyDailyMetrics,
  energyDailyVisitors,
  energyEventReceipts,
} from './energy-analytics.js';

describe('energy analytics schema', () => {
  it('stores aggregate buckets without user identity or event payloads', () => {
    expect(Object.keys(getTableColumns(energyDailyMetrics))).toEqual([
      'id', 'metricDate', 'bucketHash', 'eventType', 'experienceId', 'modeId',
      'energyNeed', 'durationBucket', 'outcome', 'sectionId', 'targetType',
      'sourceKind', 'contentId', 'rangeKey', 'taskStatus', 'batchCount',
      'eventCount', 'expiresAt', 'createdAt', 'updatedAt',
    ]);
    expect(Object.keys(getTableColumns(energyDailyMetrics))).not.toEqual(
      expect.arrayContaining(['userId', 'eventId', 'payload', 'answerText', 'providerBody']),
    );
  });

  it('keeps visitor and receipt rows purpose-limited', () => {
    expect(Object.keys(getTableColumns(energyDailyVisitors))).toEqual([
      'id', 'activityDate', 'visitorHash', 'expiresAt', 'createdAt',
    ]);
    expect(Object.keys(getTableColumns(energyEventReceipts))).toEqual([
      'eventId', 'expiresAt', 'createdAt',
    ]);
  });

  it('uses a purely additive migration with the required keys', () => {
    const migration = readFileSync(
      new URL('../../../drizzle/0046_energy_analytics.sql', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE `energy_daily_metrics`');
    expect(migration).toContain('UNIQUE KEY `uk_energy_daily_metrics_bucket`');
    expect(migration).toContain('CREATE TABLE `energy_daily_visitors`');
    expect(migration).toContain('UNIQUE KEY `uk_energy_daily_visitors_day_hash`');
    expect(migration).toContain('CREATE TABLE `energy_event_receipts`');
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i);
  });
});
```

Extend `release-db-contract.test.mjs` with valid metadata rows for all energy indexes and tests that a non-unique visitor key or incomplete metric key is reported missing.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/energy-analytics.test.ts
pnpm --filter @holaday/orchestrator exec node --test scripts/release-db-contract.test.mjs
```

Expected: FAIL because the schema, migration and required index entries do not exist.

- [ ] **Step 3: Add the Drizzle schema and pure-additive migration**

Implement `energy-analytics.ts` with `date(..., { mode: 'string' })`, `datetime(..., { mode: 'date', fsp: 3 })`, unsigned counts and empty-string/zero dimension defaults. The three table declarations must match this database contract:

```sql
CREATE TABLE `energy_daily_metrics` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `metric_date` DATE NOT NULL,
  `bucket_hash` CHAR(64) NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `experience_id` VARCHAR(32) NOT NULL DEFAULT '',
  `mode_id` VARCHAR(64) NOT NULL DEFAULT '',
  `energy_need` VARCHAR(16) NOT NULL DEFAULT '',
  `duration_bucket` VARCHAR(32) NOT NULL DEFAULT '',
  `outcome` VARCHAR(16) NOT NULL DEFAULT '',
  `section_id` VARCHAR(32) NOT NULL DEFAULT '',
  `target_type` VARCHAR(32) NOT NULL DEFAULT '',
  `source_kind` VARCHAR(32) NOT NULL DEFAULT '',
  `content_id` VARCHAR(64) NOT NULL DEFAULT '',
  `range_key` VARCHAR(16) NOT NULL DEFAULT '',
  `task_status` VARCHAR(16) NOT NULL DEFAULT '',
  `batch_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `event_count` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_energy_daily_metrics_bucket` (`metric_date`, `bucket_hash`),
  KEY `ix_energy_daily_metrics_expires_at` (`expires_at`),
  KEY `ix_energy_daily_metrics_date_type` (`metric_date`, `event_type`)
);
--> statement-breakpoint
CREATE TABLE `energy_daily_visitors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `activity_date` DATE NOT NULL,
  `visitor_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_energy_daily_visitors_day_hash` (`activity_date`, `visitor_hash`),
  KEY `ix_energy_daily_visitors_expires_at` (`expires_at`)
);
--> statement-breakpoint
CREATE TABLE `energy_event_receipts` (
  `event_id` CHAR(36) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`event_id`),
  KEY `ix_energy_event_receipts_expires_at` (`expires_at`)
);
```

Export the schema from `src/db/schema/index.ts`.

- [ ] **Step 4: Extend release and live schema verification**

Add the three table names and their exact column lists to `verify-db-schema.ts`. Add these definitions to `REQUIRED_INDEXES`:

```js
{ table: 'energy_daily_metrics', name: 'uk_energy_daily_metrics_bucket', unique: true, columns: ['metric_date', 'bucket_hash'] },
{ table: 'energy_daily_metrics', name: 'ix_energy_daily_metrics_expires_at', unique: false, columns: ['expires_at'] },
{ table: 'energy_daily_metrics', name: 'ix_energy_daily_metrics_date_type', unique: false, columns: ['metric_date', 'event_type'] },
{ table: 'energy_daily_visitors', name: 'uk_energy_daily_visitors_day_hash', unique: true, columns: ['activity_date', 'visitor_hash'] },
{ table: 'energy_daily_visitors', name: 'ix_energy_daily_visitors_expires_at', unique: false, columns: ['expires_at'] },
{ table: 'energy_event_receipts', name: 'ix_energy_event_receipts_expires_at', unique: false, columns: ['expires_at'] },
```

Keep the existing `findMissingRequiredIndexes()` rule: `unique: false` accepts either index kind, while `unique: true` requires `non_unique = 0`. The new tests must prove both branches without changing unrelated payment-index behavior.

- [ ] **Step 5: Run schema and release tests to verify they pass**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/energy-analytics.test.ts
pnpm --filter @holaday/orchestrator exec node --test scripts/release-db-contract.test.mjs
```

Expected: PASS; the migration safety test proves no destructive statement is present.

- [ ] **Step 6: Commit the database foundation**

```bash
git add apps/orchestrator/drizzle/0046_energy_analytics.sql apps/orchestrator/src/db/schema/energy-analytics.ts apps/orchestrator/src/db/schema/energy-analytics.test.ts apps/orchestrator/src/db/schema/index.ts apps/orchestrator/scripts/verify-db-schema.ts apps/orchestrator/scripts/release-db-contract.mjs apps/orchestrator/scripts/release-db-contract.test.mjs
git commit -m "feat(energy): add privacy-minimal analytics schema"
```

### Task 2: Strict event contract, normalization and bounded configuration

**Files:**
- Create: `apps/orchestrator/src/energy/analytics-contract.ts`
- Create: `apps/orchestrator/src/energy/analytics-bucket.ts`
- Create: `apps/orchestrator/src/energy/analytics-bucket.test.ts`
- Modify: `apps/orchestrator/src/config/env.ts`
- Create: `apps/orchestrator/src/config/env.energy-analytics.test.ts`

**Interfaces:**
- Consumes: existing energy event enums from `trpc/routers/energy.ts` and the column names created in Task 1.
- Produces: `energyEventInput`, `EnergyEventInput`, `NormalizedEnergyBucket`, `normalizeEnergyBucket()`, `hashEnergyVisitor()`, `utcDate()` and typed `EnergyAnalyticsConfig` used by Tasks 3–5.

- [ ] **Step 1: Write failing contract, privacy and configuration tests**

In `analytics-bucket.test.ts`, cover canonical and legacy events, stable hashes and prohibited data:

```ts
it('maps legacy lifecycle names to canonical aggregate types', () => {
  expect(normalizeEnergyBucket({
    type: 'replayed', experienceId: 'tarot', energyNeed: 'relax',
    durationBucket: null, outcome: null,
  }, NOW, 400).eventType).toBe('energy_experience_replayed');
});

it('does not put event ids or user identity into the bucket hash', () => {
  const left = normalizeEnergyBucket({ type: 'energy_home_viewed', eventId: UUID_A }, NOW, 400);
  const right = normalizeEnergyBucket({ type: 'energy_home_viewed', eventId: UUID_B }, NOW, 400);
  expect(left.bucketHash).toBe(right.bucketHash);
  expect(JSON.stringify(left)).not.toContain(UUID_A);
  expect(JSON.stringify(left)).not.toContain('usr_');
});

it('rejects private bodies and unknown ids before normalization', () => {
  expect(() => energyEventInput.parse({
    type: 'light_test_completed', testId: 'emotion-battery', answerText: 'private',
  })).toThrow();
  expect(() => energyEventInput.parse({
    type: 'astrology_range_opened', range: 'daily', providerBody: 'private',
  })).toThrow();
});
```

In `env.energy-analytics.test.ts`, parse only safe synthetic values and assert defaults `false`, `30`, `400`, `48`; assert visitor values above 30, metrics above 400, receipts above 48, and non-empty HMAC values shorter than 32 characters fail.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-bucket.test.ts src/config/env.energy-analytics.test.ts
```

Expected: FAIL because the shared contract, normalization helpers and env fields do not exist.

- [ ] **Step 3: Extract the strict event schema without widening inputs**

Move the existing enums and discriminated union into `analytics-contract.ts`. Add optional `eventId: z.string().uuid().optional()` to every strict variant and add exactly these two variants plus replay to the canonical lifecycle enum:

```ts
z.object({ eventId: eventId.optional(), type: z.literal('energy_home_viewed') }).strict(),
z.object({
  eventId: eventId.optional(),
  type: z.literal('energy_need_selected'),
  energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']),
}).strict(),
z.object({
  eventId: eventId.optional(),
  type: z.enum([
    'energy_experience_started',
    'energy_experience_replayed',
    'energy_experience_completed',
    'energy_experience_failed',
  ]),
  experienceId: z.enum(['recharge', 'practice', 'poll', 'tarot', 'light-test', 'horoscope', 'games']),
  modeId: experienceModeId.nullable(),
  energyNeed: energyNeed.nullable(),
  durationBucket: durationBucket.nullable(),
  outcome: outcome.nullable(),
}).strict(),
```

Keep the old `started | completed | replayed | failed` variant for deployed-client compatibility and export `type EnergyEventInput = z.infer<typeof energyEventInput>`.

- [ ] **Step 4: Implement fixed-dimension normalization and cryptographic helpers**

Define a fixed ordered shape, convert absent values to `''`/`0`, map legacy lifecycle names to canonical names, and hash only this stable shape:

```ts
export interface NormalizedEnergyBucket {
  metricDate: string;
  bucketHash: string;
  eventType: string;
  experienceId: string;
  modeId: string;
  energyNeed: string;
  durationBucket: string;
  outcome: string;
  sectionId: string;
  targetType: string;
  sourceKind: string;
  contentId: string;
  rangeKey: string;
  taskStatus: string;
  batchCount: number;
  expiresAt: Date;
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function hashEnergyVisitor(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex');
}
```

Use `createHash('sha256').update(JSON.stringify(orderedDimensions)).digest('hex')` for `bucketHash`. Map `testId` and tarot `mode` into `modeId`, `range` into `rangeKey`, `section` into `sectionId`, `fromKind` into `sourceKind`, and never inspect properties outside the parsed union.

- [ ] **Step 5: Add bounded env configuration**

Rename the private root schema to exported `envSchema` for direct tests, keep `env = envSchema.parse(process.env)`, and add:

```ts
ENERGY_ANALYTICS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
ENERGY_ANALYTICS_HMAC_SECRET: z.string().refine(
  (value) => value === '' || value.length >= 32,
  'ENERGY_ANALYTICS_HMAC_SECRET must be empty or at least 32 chars',
).default(''),
ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: z.coerce.number().int().min(1).max(400).default(400),
ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: z.coerce.number().int().min(1).max(48).default(48),
```

Export `EnergyAnalyticsConfig` and a pure `energyAnalyticsConfigFromEnv()` from `analytics-bucket.ts`; it must copy only those five values and never log the secret.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-bucket.test.ts src/config/env.energy-analytics.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: PASS; the typecheck proves all existing env consumers still compile after exporting `envSchema`.

- [ ] **Step 7: Commit the contract and configuration**

```bash
git add apps/orchestrator/src/energy/analytics-contract.ts apps/orchestrator/src/energy/analytics-bucket.ts apps/orchestrator/src/energy/analytics-bucket.test.ts apps/orchestrator/src/config/env.ts apps/orchestrator/src/config/env.energy-analytics.test.ts
git commit -m "feat(energy): define bounded analytics contract"
```

### Task 3: Transactional idempotent event recording

**Files:**
- Create: `apps/orchestrator/src/energy/analytics-store.ts`
- Create: `apps/orchestrator/src/energy/analytics-write-service.ts`
- Create: `apps/orchestrator/src/energy/analytics-write-service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.test.ts`

**Interfaces:**
- Consumes: `EnergyEventInput`, `NormalizedEnergyBucket`, `EnergyAnalyticsConfig` and the three Task 1 tables.
- Produces: `createEnergyAnalyticsStore(db)`, `recordEnergyEvent()` returning `Promise<{ ok: true; duplicate: boolean; visitorRecorded: boolean }>` and the persisted `energy.reportEvent` route.

- [ ] **Step 1: Write failing service tests with a transactional in-memory store**

Define a test store that clones its maps before `transaction()` and commits the clone only on success. Cover these exact cases:

```ts
it('records receipt, aggregate and home visitor atomically', async () => {
  const result = await recordEnergyEvent({
    store, input: { eventId: UUID_A, type: 'energy_home_viewed' },
    userId: 'usr_energy', now: NOW, config: ENABLED_CONFIG, logger,
  });
  expect(result).toEqual({ ok: true, duplicate: false, visitorRecorded: true });
  expect(store.metrics).toHaveLength(1);
  expect(store.visitors).toHaveLength(1);
  expect(JSON.stringify(store.visitors)).not.toContain('usr_energy');
});

it('does not double count a retried event id', async () => {
  await recordEnergyEvent(args(UUID_A));
  const retry = await recordEnergyEvent(args(UUID_A));
  expect(retry).toEqual({ ok: true, duplicate: true, visitorRecorded: false });
  expect(store.metrics[0]?.eventCount).toBe(1);
});

it('rolls back the receipt when metric increment fails', async () => {
  store.failMetricIncrement = true;
  await expect(recordEnergyEvent(args(UUID_A))).rejects.toThrow('metric write failed');
  expect(store.receipts).toHaveLength(0);
  expect(store.metrics).toHaveLength(0);
});
```

Also test: disabled config performs zero store calls; missing event ID still increments for legacy clients; missing HMAC secret increments the metric, skips visitor, and warns once without including user/event data; same visitor on the same day remains one row.

- [ ] **Step 2: Write failing router tests**

Hoist mocks for `recordEnergyEvent()` and `createEnergyAnalyticsStore()`. Assert the route passes parsed input and authenticated `ctx.userId`, accepts old no-UUID input, returns `duplicate`, rejects private fields, and does not call `logger.info` with an event payload.

- [ ] **Step 3: Run service and route tests to verify they fail**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-write-service.test.ts src/trpc/routers/energy.test.ts
```

Expected: FAIL because transactional persistence is not implemented and the route still logs individual events.

- [ ] **Step 4: Implement the database store adapter**

Define the interfaces before the adapter so tests can supply an in-memory implementation:

```ts
export interface EnergyAnalyticsTransaction {
  claimReceipt(eventId: string, expiresAt: Date): Promise<boolean>;
  incrementMetric(bucket: NormalizedEnergyBucket): Promise<void>;
  insertVisitor(activityDate: string, visitorHash: string, expiresAt: Date): Promise<boolean>;
}

export interface EnergyAnalyticsStore {
  transaction<T>(callback: (tx: EnergyAnalyticsTransaction) => Promise<T>): Promise<T>;
}
```

The Drizzle adapter must:

1. catch only MySQL `ER_DUP_ENTRY` in `claimReceipt()` and `insertVisitor()` and return `false`;
2. rethrow every other error;
3. use `onDuplicateKeyUpdate({ set: { eventCount: sql\`${energyDailyMetrics.eventCount} + 1\`, updatedAt: new Date() } })` for the metric;
4. execute all three operations through the `tx` object supplied by `db.transaction()`.

- [ ] **Step 5: Implement `recordEnergyEvent()` in one transaction**

Use this control flow exactly:

```ts
if (!config.enabled) {
  return { ok: true, duplicate: false, visitorRecorded: false };
}

const bucket = normalizeEnergyBucket(input, now, config.metricRetentionDays);
const visitorHash = input.type === 'energy_home_viewed' && config.hmacSecret
  ? hashEnergyVisitor(config.hmacSecret, userId)
  : null;

return store.transaction(async (tx) => {
  if (input.eventId) {
    const claimed = await tx.claimReceipt(
      input.eventId,
      addUtcHours(now, config.receiptRetentionHours),
    );
    if (!claimed) return { ok: true, duplicate: true, visitorRecorded: false };
  }
  await tx.incrementMetric(bucket);
  const visitorRecorded = visitorHash
    ? await tx.insertVisitor(
        bucket.metricDate,
        visitorHash,
        addUtcDaysFromDate(bucket.metricDate, config.visitorRetentionDays),
      )
    : false;
  return { ok: true, duplicate: false, visitorRecorded };
});
```

If a home event arrives without an HMAC secret, call a module-level warn-once helper with only `{ feature: 'energy_analytics_visitors' }`; do not log `userId`, `eventId`, hash or the input object.

- [ ] **Step 6: Replace event logging with the service call**

Import `energyEventInput` from the shared contract. Make `reportEvent` async, construct config from `env`, construct the store from `ctx.db`, and return `recordEnergyEvent(...)`. Remove both existing `logger.info` branches so no individual event reaches logs.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-write-service.test.ts src/trpc/routers/energy.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: PASS, including rollback and duplicate tests.

- [ ] **Step 8: Commit transactional persistence**

```bash
git add apps/orchestrator/src/energy/analytics-store.ts apps/orchestrator/src/energy/analytics-write-service.ts apps/orchestrator/src/energy/analytics-write-service.test.ts apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts
git commit -m "feat(energy): persist analytics events atomically"
```

### Task 4: Aggregate-only 7/30-day admin metrics

**Files:**
- Modify: `apps/orchestrator/src/energy/analytics-store.ts`
- Create: `apps/orchestrator/src/energy/analytics-metrics-service.ts`
- Create: `apps/orchestrator/src/energy/analytics-metrics-service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.test.ts`

**Interfaces:**
- Consumes: daily metric rows and visitor rows created by Tasks 1 and 3.
- Produces: `queryEnergyMetrics({ store, window, now })` and admin-only `energy.metrics({ window: 7 | 30 })` with no IDs, hashes or row-level details.

- [ ] **Step 1: Write failing metric formula and privacy tests**

Use a fake read store returning fixed aggregate rows. Assert the exact response shape:

```ts
expect(result).toEqual({
  window: 7,
  startDate: '2026-08-10',
  endDate: '2026-08-16',
  daily: expect.arrayContaining([
    { date: '2026-08-14', homeViews: 10, dau: 8, d1Returning: 3, d1Rate: 0.375 },
    { date: '2026-08-15', homeViews: 4, dau: 4, d1Returning: null, d1Rate: null },
  ]),
  experiences: expect.arrayContaining([
    {
      experienceId: 'tarot', started: 6, replayed: 2, completed: 5, failed: 1,
      completionRate: 0.625, replayRate: 0.25, failureRate: 0.125,
    },
  ]),
  totals: {
    homeViews: 14,
    started: 6,
    replayed: 2,
    completed: 5,
    failed: 1,
    startsPerVisit: 0.5714,
  },
});
expect(JSON.stringify(result)).not.toMatch(/visitorHash|eventId|userId|\bhash\b/i);
```

Add zero-denominator tests returning `null`, not `Infinity`/`NaN`, and verify D1 is `null` when `date + 1 >= utcToday`.

- [ ] **Step 2: Write failing admin authorization tests**

Mock `queryEnergyMetrics()`. Use a fake `ctx.db.select().from().where().limit()` returning an active admin for success, a member for `FORBIDDEN`, and `userId: null` for `UNAUTHORIZED`. Assert only `{ window: 7 | 30 }` is accepted and extra keys are `BAD_REQUEST`.

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-metrics-service.test.ts src/trpc/routers/energy.test.ts
```

Expected: FAIL because no read service or admin procedure exists.

- [ ] **Step 4: Extend the store with aggregate-only reads**

Add:

```ts
export interface EnergyMetricReadRow {
  metricDate: string;
  eventType: string;
  experienceId: string;
  eventCount: number;
}

export interface EnergyDailyAudienceRow {
  activityDate: string;
  dau: number;
  d1Returning: number;
}

readMetricRows(startDate: string, endDate: string): Promise<EnergyMetricReadRow[]>;
readDailyAudience(startDate: string, endDate: string): Promise<EnergyDailyAudienceRow[]>;
```

`readMetricRows()` selects only the four fields above. `readDailyAudience()` must self-join `energy_daily_visitors` by equal `visitor_hash` and `next.activity_date = DATE_ADD(current.activity_date, INTERVAL 1 DAY)`, but select only `activityDate`, `COUNT(current.id)` and `COUNT(next.id)`. No repository return type may expose `visitorHash`.

- [ ] **Step 5: Implement deterministic aggregation and ratios**

Use `ratio(numerator, denominator)` that returns `null` for zero and otherwise rounds to four decimal places. The 7/30-day window includes UTC today as a possibly partial day and returns exactly 7 or 30 consecutive daily rows, filling absent aggregate rows with zero. Aggregate lifecycle rows by the seven fixed `experienceId` values; use `started + replayed` as the denominator for completion, replay and failure rates; use total `homeViews` as the denominator for `startsPerVisit`. D1 is populated only when `activityDate < utcYesterday`; later cohorts return `d1Returning: null` and `d1Rate: null`.

- [ ] **Step 6: Add the admin-only query**

Add to `energyRouter`:

```ts
metrics: adminProcedure
  .input(z.object({ window: z.union([z.literal(7), z.literal(30)]).default(7) }).strict())
  .query(({ ctx, input }) =>
    queryEnergyMetrics({
      store: createEnergyAnalyticsStore(ctx.db),
      window: input.window,
      now: new Date(),
    }),
  ),
```

Do not add an admin page in this task.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-metrics-service.test.ts src/trpc/routers/energy.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: PASS; member and unauthenticated calls are rejected and the response has no identifiers.

- [ ] **Step 8: Commit aggregate admin metrics**

```bash
git add apps/orchestrator/src/energy/analytics-store.ts apps/orchestrator/src/energy/analytics-metrics-service.ts apps/orchestrator/src/energy/analytics-metrics-service.test.ts apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts
git commit -m "feat(energy): expose aggregate admin metrics"
```

### Task 5: Bounded retention cleanup and runtime wiring

**Files:**
- Modify: `apps/orchestrator/src/energy/analytics-store.ts`
- Create: `apps/orchestrator/src/energy/analytics-cleanup.ts`
- Create: `apps/orchestrator/src/energy/analytics-cleanup.test.ts`
- Modify: `apps/orchestrator/src/index.ts`

**Interfaces:**
- Consumes: `expires_at` indexes from Task 1.
- Produces: `cleanupEnergyAnalytics()`, `startEnergyAnalyticsCleanup()` and `stopEnergyAnalyticsCleanup()`; cleanup remains active even when new writes are disabled.

- [ ] **Step 1: Write failing cleanup tests**

Use a fake cleanup store whose delete methods return scripted counts. Cover:

```ts
it('deletes each table in bounded batches and stops after a short batch', async () => {
  store.receiptCounts = [500, 12];
  store.visitorCounts = [0];
  store.metricCounts = [500, 500, 500, 500, 500];
  const result = await cleanupEnergyAnalytics({ store, logger, now: NOW });
  expect(result).toEqual({ receipts: 512, visitors: 0, metrics: 2500 });
  expect(store.calls.every((call) => call.limit === 500)).toBe(true);
  expect(store.calls.filter((call) => call.table === 'metrics')).toHaveLength(5);
});
```

Also verify the store uses `expiresAt <= now`, one table failure produces one sanitized warning and does not throw, timer is `unref()`'d, and `stopEnergyAnalyticsCleanup()` clears it.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-cleanup.test.ts
```

Expected: FAIL because cleanup functions do not exist.

- [ ] **Step 3: Add bounded delete operations to the store**

Add three methods accepting `(now: Date, limit: number)` and returning `readAffectedRows(...)`. Use `lte(table.expiresAt, now)` and MySQL DELETE `limit(limit)`. Do not provide any unbounded delete method.

- [ ] **Step 4: Implement non-fatal cleanup and the hourly backlog-draining timer**

Use constants `CLEANUP_BATCH_SIZE = 500`, `CLEANUP_MAX_ROUNDS = 5`, `CLEANUP_INTERVAL_MS = 60 * 60 * 1000`, and `CLEANUP_BACKLOG_DELAY_MS = 1000`. For each table, stop when a batch deletes fewer than 500 rows or five rounds have run. If a table deletes the full 2,500-row pass capacity, schedule another bounded pass after one second and continue until a short batch proves the backlog is drained. Prevent overlapping runs and cancel pending continuation on shutdown. Isolate each table sweep so one failure does not prevent the other two tables from being attempted; collect only error class names, emit one warning for the whole run as `{ feature: 'energy_analytics_cleanup', errorNames }`, return successful counts, and never rethrow.

`startEnergyAnalyticsCleanup()` must run one non-awaited boot sweep, schedule the hourly sweep, call `unref?.()` on both periodic and continuation timers, and be idempotent. It must not inspect `ENERGY_ANALYTICS_ENABLED`.

- [ ] **Step 5: Wire startup without blocking application boot**

Import `startEnergyAnalyticsCleanup` in `index.ts` and call it after the HTTP server starts:

```ts
startEnergyAnalyticsCleanup({
  store: createEnergyAnalyticsStore(db),
  logger,
});
```

Do not `await` the boot sweep and do not place it behind the write feature flag.

- [ ] **Step 6: Run focused tests, typecheck and build**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/energy/analytics-cleanup.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
```

Expected: PASS; build proves the timer wiring compiles in the application entrypoint.

- [ ] **Step 7: Commit retention cleanup**

```bash
git add apps/orchestrator/src/energy/analytics-store.ts apps/orchestrator/src/energy/analytics-cleanup.ts apps/orchestrator/src/energy/analytics-cleanup.test.ts apps/orchestrator/src/index.ts
git commit -m "feat(energy): add bounded analytics retention"
```

### Task 6: Client UUID generation and retry idempotency

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy-event-reporter.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-event-reporter.test.ts`

**Interfaces:**
- Consumes: Task 2's optional server `eventId` and existing reporter retry/dispose semantics.
- Produces: every new SPA event reaches `send()` with a UUID, and a retry reuses the exact same UUID.

- [ ] **Step 1: Write failing UUID and retry tests**

Add an injectable `createEventId` and test:

```ts
it('adds one event id before delivery and reuses it for retry', async () => {
  const send = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ ok: true });
  const reporter = createEnergyEventReporter({
    send,
    createEventId: () => '11111111-1111-4111-8111-111111111111',
    waitBeforeRetry: () => Promise.resolve(),
  });
  await reporter.report({ type: 'energy_feed_refreshed' });
  expect(send).toHaveBeenNthCalledWith(1, {
    type: 'energy_feed_refreshed', eventId: '11111111-1111-4111-8111-111111111111',
  });
  expect(send).toHaveBeenNthCalledWith(2, {
    type: 'energy_feed_refreshed', eventId: '11111111-1111-4111-8111-111111111111',
  });
});
```

Also assert caller-supplied `eventId` is preserved, `createEventId` runs once per accepted report, and a dropped event at the pending limit does not allocate an ID.

- [ ] **Step 2: Run reporter tests to verify they fail**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-event-reporter.test.ts
```

Expected: FAIL because the reporter currently forwards events without `eventId`.

- [ ] **Step 3: Generate the UUID at queue acceptance**

Change the generic contract to accept `eventId?: string`, make `send` receive `TEvent & { eventId: string }`, and default `createEventId` to `() => crypto.randomUUID()`. In `report()` check `disposed` and `pendingLimit` first, then create one immutable delivery object:

```ts
const deliveryEvent = {
  ...event,
  eventId: event.eventId ?? createEventId(),
} as TEvent & { eventId: string };
const delivery = deliver(deliveryEvent);
```

Keep both send attempts inside `deliver(deliveryEvent)` so retries cannot generate a second UUID. Keep warning metadata limited to event type, retryability and attempt count.

- [ ] **Step 4: Run reporter tests and web typecheck**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-event-reporter.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: PASS; network/5xx still retries once, 4xx still sends once, dispose and pending limits remain unchanged.

- [ ] **Step 5: Commit client idempotency**

```bash
git add apps/web-workbench/src/components/energy/energy-event-reporter.ts apps/web-workbench/src/components/energy/energy-event-reporter.test.ts
git commit -m "feat(energy): add idempotent event delivery ids"
```

### Task 7: Correct homepage, need-selection and replay instrumentation

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`

**Interfaces:**
- Consumes: Task 6 reporter and Task 2 server event union.
- Produces: correct `energy_home_viewed`, `energy_need_selected`, `energy_experience_replayed` lifecycle events with no new visible controls.

- [ ] **Step 1: Write failing user-behavior tests**

Add tests that clear mocks after initial render when appropriate and assert:

```ts
it('reports one home view for a stable authenticated scope', async () => {
  const { rerender } = render(<EnergyHome profileStorageScope="usr_energy" />);
  rerender(<EnergyHome profileStorageScope="usr_energy" />);
  await waitFor(() => expect(
    trpcMocks.reportEvent.mock.calls.filter(([event]) => event.type === 'energy_home_viewed'),
  ).toHaveLength(1));
});

it('reports only real need changes and never the initial default', async () => {
  const user = userEvent.setup();
  render(<EnergyHome profileStorageScope="usr_energy" />);
  await user.click(screen.getByRole('button', { name: '专注' }));
  await user.click(screen.getByRole('button', { name: '放松' }));
  await user.click(screen.getByRole('button', { name: '放松' }));
  expect(trpcMocks.reportEvent.mock.calls.filter(
    ([event]) => event.type === 'energy_need_selected',
  ).map(([event]) => event.energyNeed)).toEqual(['relax']);
});
```

Add a completed-experience replay test expecting `energy_experience_replayed` and no second `energy_experience_started`. Retain the preview test expecting zero service events. Add `expect(screen.queryByRole('button', { name: /有帮助|没帮助/ })).toBeNull()`.

- [ ] **Step 2: Run EnergyHome tests to verify they fail**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/EnergyHome.test.tsx
```

Expected: FAIL because home/need events are absent and replay is mislabeled as started.

- [ ] **Step 3: Add home-view and need-change handlers**

Extend `EnergyEventType` with `energy_experience_replayed`. Add a ref keyed by `storageScope`:

```ts
const reportedHomeScopeRef = React.useRef<string | null>(null);
React.useEffect(() => {
  if (!storageScope || reportedHomeScopeRef.current === storageScope) return;
  reportedHomeScopeRef.current = storageScope;
  void eventReporter.report({ type: 'energy_home_viewed' });
}, [eventReporter, storageScope]);
```

Add a callback that compares against current state before reporting:

```ts
const handleEnergyNeedChange = React.useCallback((next: EnergyNeed) => {
  if (next === energyNeed) return;
  setEnergyNeed(next);
  void eventReporter.report({ type: 'energy_need_selected', energyNeed: next });
}, [energyNeed, eventReporter]);
```

Pass this callback to `EnergyHero.onChange`. Keep preview behavior local because the reporter's `send` closure resolves without a tRPC mutation when `storageScope` is missing.

- [ ] **Step 4: Correct replay semantics and existing exact-call assertions**

Change `onReplay` to report `energy_experience_replayed`. Do not report completed or feedback on close. Because Task 6 adds `eventId`, convert existing exact `toHaveBeenCalledWith({ ... })` assertions to `expect.objectContaining({ ... })` only where the ID is irrelevant; retain explicit UUID assertions in reporter tests.

- [ ] **Step 5: Run web energy tests, lint, typecheck and build**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-event-reporter.test.ts src/components/energy/EnergyHome.test.tsx src/components/energy/ExperiencePlayer.test.tsx
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
```

Expected: PASS; no visual DOM structure or visible control is added.

- [ ] **Step 6: Commit corrected page instrumentation**

```bash
git add apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx
git commit -m "feat(energy): complete privacy-safe lifecycle metrics"
```

### Task 8: Release runbook, full gates and production-equivalent acceptance

**Files:**
- Create: `docs/runbooks/today-energy-analytics-rollout.md`
- Modify only if a gate finds a scoped defect: files already listed in Tasks 1–7

**Interfaces:**
- Consumes: all previous tasks and existing application deployment gates.
- Produces: a verified, documented rollout that can be enabled, inspected only through the admin aggregate endpoint, and rolled back with one flag.

- [ ] **Step 1: Write the rollout runbook**

Document this exact order without secret values:

1. apply `0046_energy_analytics.sql` and run `db:verify`;
2. generate/store a dedicated high-entropy HMAC secret while `ENERGY_ANALYTICS_ENABLED=false`;
3. deploy Orchestrator first, then SPA;
4. verify preview sends no event and authenticated UI remains usable while reporter requests fail;
5. enable the flag for production;
6. make one authenticated homepage visit, first start, replay and completion;
7. query `energy.metrics({ window: 7 })` as an active admin and verify only expected aggregate deltas;
8. observe errors/table growth without reading visitor hashes;
9. rollback by setting the flag to `false`; do not drop tables.

Include a safe admin query example that reads the token interactively and unsets it afterwards:

```bash
read -r -p 'Holaday application origin: ' HOLADAY_APP_ORIGIN
read -s HOLADAY_ADMIN_TOKEN
curl --fail-with-body \
  --header "Authorization: Bearer ${HOLADAY_ADMIN_TOKEN}" \
  "${HOLADAY_APP_ORIGIN%/}/api/trpc/energy.metrics?input=%7B%22window%22%3A7%7D"
unset HOLADAY_ADMIN_TOKEN HOLADAY_APP_ORIGIN
```

The runbook must require an `https://` deployed origin and state that the token must never be pasted into logs, tickets or PRs.

- [ ] **Step 2: Run all focused backend tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/db/schema/energy-analytics.test.ts src/config/env.energy-analytics.test.ts src/energy/analytics-bucket.test.ts src/energy/analytics-write-service.test.ts src/energy/analytics-metrics-service.test.ts src/energy/analytics-cleanup.test.ts src/trpc/routers/energy.test.ts
pnpm --filter @holaday/orchestrator exec node --test scripts/qa-db-safety.test.mjs scripts/release-db-contract.test.mjs
```

Expected: PASS with no skipped scoped test.

- [ ] **Step 3: Run all focused frontend tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-event-reporter.test.ts src/components/energy/EnergyHome.test.tsx src/components/energy/ExperiencePlayer.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run static and build gates**

```bash
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
pnpm exec biome check apps/orchestrator/src/energy apps/orchestrator/src/db/schema/energy-analytics.ts apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/config/env.ts apps/web-workbench/src/components/energy/energy-event-reporter.ts apps/web-workbench/src/components/energy/EnergyHome.tsx
git diff --check
```

Expected: PASS. If repository-wide unrelated Biome noise exists, do not modify unrelated files; the explicit touched-file Biome command must still pass and the limitation must be stated in the handoff.

- [ ] **Step 5: Verify the numbered migration against a dedicated loopback QA database**

Use only the explicit local QA database, never the current production URL:

```bash
DATABASE_URL='mysql://holaday:holaday-dev@127.0.0.1:3306/holaday_energy_qa' pnpm --filter @holaday/orchestrator db:migrate:numbered
DATABASE_URL='mysql://holaday:holaday-dev@127.0.0.1:3306/holaday_energy_qa' pnpm --filter @holaday/orchestrator db:verify
```

Expected: migration runner and schema verification both exit 0. If the local QA database is unavailable, record this as an unverified release blocker; do not substitute a remote database without explicit authority.

- [ ] **Step 6: Perform production-equivalent browser acceptance with the flag off**

At desktop width and 390 px width, verify authenticated `/cosmic` loads, `/cosmic-preview` sends no `energy.reportEvent`, selecting/replaying/completing remains usable when event requests return 500, and the page has no feedback control. Compare screenshots only for unintended regressions; this change should not alter layout.

- [ ] **Step 7: Perform an enabled-path data acceptance in QA**

With a dedicated QA HMAC secret and `ENERGY_ANALYTICS_ENABLED=true`, record one home event, one start, one replay and one completion. Assert:

- each event ID creates one receipt and a retry leaves counts unchanged;
- home creates one anonymous visitor for the UTC day;
- no row contains internal user ID or event payload;
- `energy.metrics({ window: 7 })` changes only the corresponding aggregate fields;
- a member caller receives `FORBIDDEN`;
- switching the flag back to false stops new metric writes while cleanup remains callable.

- [ ] **Step 8: Commit the runbook and any scoped gate fixes**

```bash
git add docs/runbooks/today-energy-analytics-rollout.md
git commit -m "docs(energy): add analytics rollout runbook"
```

If a gate exposes a scoped defect, fix it, rerun its red/green test, and commit that exact file with the task that owns it before this runbook commit. Before committing, inspect `git diff --cached --name-only`; the runbook commit must contain only `docs/runbooks/today-energy-analytics-rollout.md`.

- [ ] **Step 9: Final branch review before delivery**

```bash
git status --short --branch
git log --oneline --decorate -10
git diff origin/claude/musing-keller-ae1d05...HEAD --stat
git diff origin/claude/musing-keller-ae1d05...HEAD --check
```

Expected: only the design, implementation plan, runbook and scoped implementation files differ; all required gates are recorded with exact pass/fail results. Push and create a PR only after this review; merge, enablement and deployment remain separate actions governed by the user's explicit authorization.

## Self-Review Checklist

- Spec coverage: Tasks 1–8 cover all three retention classes, strict input, legacy compatibility, transactionality, HMAC visitor keys, D1, admin-only aggregate output, retry UUID reuse, preview suppression, failure degradation, rollout and rollback.
- Explicit exclusion: no task creates feedback UI/event, raw event storage, a dashboard, third-party analytics, staff comparison, DivineAPI/OpenAI/payment changes or destructive migrations.
- Placeholder scan: every implementation step names exact files, APIs, commands and expected outcomes; production secrets remain intentionally absent.
- Type consistency: `EnergyEventInput`, `EnergyAnalyticsConfig`, `NormalizedEnergyBucket`, `EnergyAnalyticsStore`, `recordEnergyEvent()` and `queryEnergyMetrics()` names/signatures are consistent across producing and consuming tasks.
- Release honesty: production enablement is not considered complete until local numbered migration/schema verification and both disabled/enabled acceptance paths pass.
