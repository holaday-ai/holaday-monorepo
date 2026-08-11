# 今日能量内容补给站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Current authorization constraint: choose `superpowers:executing-plans` and execute serially; do not dispatch subagents unless the user explicitly reauthorizes them.

**Goal:** 将今日能量扩展为可持续探索的内容补给站，先修复 DivineAPI 来源真实性，再上线日／周／月／年星座内容、连续抽卡、18 套轻测试、底部内容组和任务状态联动。

**Architecture:** 后端以严格的 DivineAPI 响应契约和显式能力表为边界，按周期返回结构统一、来源独立的星座读数；前端使用按周期惰性加载的 astrology state，并把星座、牌库、测试、内容流和任务状态拆成职责单一的模块。塔罗套餐未授权时使用明确标注的 Holaday 能量牌，未来开通能力后通过同一模式协议切换 Provider。

**Tech Stack:** TypeScript、Node.js、tRPC、Zod、React 18、Vite、Zustand、Vitest、Testing Library、Radix Dialog、Lucide React、现有 `energy.css`。

## Global Constraints

- 设计规格是 `docs/superpowers/specs/2026-08-12-today-energy-content-hub-design.md`；实施不得扩大阶段 C 范围。
- 串行单智能体执行；除非用户重新明确授权，不派发子智能体。
- 只有 HTTP 成功、JSON 可解析、`success === 1` 且必需字段有效时，来源才可标记为 `divineapi`。
- Translator 未启用时，不得向英文域发送 `lan=zh`，也不得把本地中文内容标记成真实 API。
- 当前未授权塔罗必须命名为“Holaday 能量牌”，不得命名为“真实塔罗”。
- 不保存轻测试答案或塔罗问题正文；匿名事件不得包含自由文本或 Provider 正文。
- 本轮不新增数据库表、不接广告 SDK、不做视频托管、不创建能量币余额或兑换账本。
- 首屏保持当前视觉层级；新增深度内容从星座摘要下方展开。
- 正式视觉资产只使用现有资产、Provider 图片或 ImageGen 生成并落盘的资产；不用 Emoji、CSS 图形、内联 SVG 或占位框。
- 图标按钮同时具备 `aria-label` 和原生 `title`；完整支持 `prefers-reduced-motion`。
- 每个任务先写失败测试、确认红灯、做最小实现、确认绿灯，再提交该任务文件。
- 只暂存任务列出的具体文件；不触碰主工作区的 `.claude/`、`qa-artifacts/` 和 `skills/*` 草稿。

---

## File Structure

### Orchestrator

- Create `apps/orchestrator/src/astrology/divine-api-contract.ts`: DivineAPI envelope 校验、必需字段校验、错误原因和能力类型。
- Create `apps/orchestrator/src/astrology/divine-api-contract.test.ts`: HTTP 200 + `success: 2`、缺字段、成功数据和能力解析测试。
- Modify `apps/orchestrator/src/astrology/service.ts`: 修正请求参数、中文域选择、周期读数、能力守卫和缓存。
- Modify `apps/orchestrator/src/astrology/service.test.ts`: 日／周／月／年、未授权、Translator 和来源回退测试。
- Modify `apps/orchestrator/src/trpc/routers/astrology.ts`: 暴露 status、daily、weekly、monthly、yearly 与 ranking。
- Modify `apps/orchestrator/src/trpc/routers/astrology.test.ts`: 路由契约与输入边界。
- Modify `apps/orchestrator/src/trpc/routers/energy.ts`: 扩充有界匿名事件枚举。
- Modify `apps/orchestrator/src/trpc/routers/energy.test.ts`: 允许新事件并继续拒绝自由文本。
- Modify `.env.example`: 增加 Provider 能力白名单和 Translator host 配置说明。

### Web Workbench: astrology

- Modify `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`: 按周期、按来源维护状态并惰性加载月／年。
- Modify `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`: 局部失败、能力关闭、惰性加载和来源测试。
- Create `apps/web-workbench/src/components/energy/astrology-content.ts`: 六维映射、幸运信息和周期展示辅助函数。
- Create `apps/web-workbench/src/components/energy/astrology-content.test.ts`: 映射、排序和缺失内容测试。
- Create `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`: 日／周／月／年范围导航与继续探索。
- Create `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`: 范围切换、加载、回退和展开测试。
- Create `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx`: 六维复用卡片。
- Create `apps/web-workbench/src/components/energy/LuckyInsights.tsx`: 幸运色、数字、字母和关系提示。
- Modify `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx`: 摘要 CTA 改为滚动到深度区。

### Web Workbench: cards and tests

- Create `apps/web-workbench/src/components/energy/experiences/energy-card-content.ts`: 36 张 Holaday 能量牌。
- Create `apps/web-workbench/src/components/energy/experiences/energy-card-selection.ts`: 每日稳定抽取、会话去重和三张牌选择。
- Create `apps/web-workbench/src/components/energy/experiences/energy-card-selection.test.ts`: 稳定性、去重、耗尽循环和三张不重复。
- Modify `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`: 抽卡实验室连续状态机。
- Modify `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`: 单卡、是／否、三张牌和继续路径。
- Modify `apps/web-workbench/src/components/energy/experiences/test-content.ts`: 6 类 18 套完整测试。
- Modify `apps/web-workbench/src/components/energy/experiences/test-content.test.ts`: 数量、题数、结果可达和文案安全测试。
- Create `apps/web-workbench/src/components/energy/experiences/light-test-engine.ts`: 确定性评分和结果选择。
- Create `apps/web-workbench/src/components/energy/experiences/light-test-engine.test.ts`: 得分边界与全部结果可达。
- Modify `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx`: 目录、答题、结果和连续体验。
- Modify `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx`: 完整流程、换一套、相关测试和返回目录。

### Web Workbench: feed, task dock, integration

- Create `apps/web-workbench/src/components/energy/explore-content.ts`: 36 条微内容和统一内容协议。
- Create `apps/web-workbench/src/components/energy/explore-content.test.ts`: 数量、类型、到期过滤和会话去重。
- Create `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`: 每组 6 张与“再来一组”。
- Create `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`: 换组、无重复、耗尽和事件。
- Create `apps/web-workbench/src/components/energy/running-task-dock-state.ts`: 活跃任务选择和状态映射。
- Create `apps/web-workbench/src/components/energy/running-task-dock-state.test.ts`: 优先级、终态和多任务边界。
- Create `apps/web-workbench/src/components/energy/RunningTaskDock.tsx`: 非阻塞任务状态条与返回入口。
- Create `apps/web-workbench/src/components/energy/RunningTaskDock.test.tsx`: 执行、等待、完成、失败和无任务状态。
- Modify `apps/web-workbench/src/components/energy/EnergyHome.tsx`: 编排深度区、事件、收藏／完成状态和任务 Dock。
- Modify `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`: 页面完整层级与入口。
- Modify `apps/web-workbench/src/components/energy/experience-registry.ts`: 将 Tarot 使用本地牌库协议，保留现有懒加载边界。
- Modify `apps/web-workbench/src/components/energy/energy-types.ts`: 新事件和内容类型。
- Modify `apps/web-workbench/src/components/energy/energy-progress.ts`: v1 迁移、完成测试 ID、收藏 ID 与已见内容 ID 的用户隔离存储。
- Modify `apps/web-workbench/src/components/energy/energy-progress.test.ts`: 迁移、隔离、ID 有界和无答案／正文持久化测试。
- Modify `apps/web-workbench/src/components/energy/energy.css`: 桌面、窄屏、动效和 reduced-motion。
- Modify `apps/web-workbench/src/components/energy/energy-css.test.ts`: 关键选择器和移动规则。
- Modify `apps/web-workbench/src/pages/AstrologyPage.tsx`: 给任务 Dock 提供已登录任务环境。
- Modify `apps/web-workbench/src/pages/AstrologyPage.test.tsx`: 已登录与预览路由边界。
- Create `docs/qa/today-energy-content-hub-release-checklist.md`: 发布验证记录模板。

---

### Task 1: Enforce DivineAPI response truth and explicit capabilities

**Files:**
- Create: `apps/orchestrator/src/astrology/divine-api-contract.ts`
- Create: `apps/orchestrator/src/astrology/divine-api-contract.test.ts`
- Modify: `apps/orchestrator/src/astrology/service.ts`
- Modify: `apps/orchestrator/src/astrology/service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/astrology.ts`
- Modify: `apps/orchestrator/src/trpc/routers/astrology.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `AstrologyCapability`, `ProviderCapabilityState`, `readConfiguredCapabilities(env)`, `assertDivineApiSuccess(json, requiredPaths)`.
- Later tasks consume the capability list and validated Provider payloads; they must not parse raw `success: 2` envelopes.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  assertDivineApiSuccess,
  readConfiguredCapabilities,
} from './divine-api-contract.js';

describe('DivineAPI contract', () => {
  it('rejects HTTP-200 business denial envelopes', () => {
    expect(() =>
      assertDivineApiSuccess(
        { success: 2, msg: 'You are not authorized to access this API' },
        [['data']],
      ),
    ).toThrow(/not-authorized/);
  });

  it('rejects success envelopes missing required data', () => {
    expect(() => assertDivineApiSuccess({ success: 1, data: {} }, [['data', 'sign']]))
      .toThrow(/invalid-response/);
  });

  it('accepts a complete success envelope', () => {
    expect(
      assertDivineApiSuccess(
        { success: 1, data: { sign: 'Aries' } },
        [['data', 'sign']],
      ),
    ).toEqual({ sign: 'Aries' });
  });

  it('parses only known comma-separated capabilities', () => {
    expect(
      readConfiguredCapabilities({
        DIVINE_API_CAPABILITIES: 'daily-horoscope,monthly-horoscope,unknown',
      } as NodeJS.ProcessEnv),
    ).toEqual(new Set(['daily-horoscope', 'monthly-horoscope']));
  });
});
```

- [ ] **Step 2: Run the contract tests and confirm red**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/divine-api-contract.test.ts
```

Expected: FAIL because `divine-api-contract.ts` does not exist.

- [ ] **Step 3: Implement the strict envelope and capability contract**

```ts
export type AstrologyCapability =
  | 'daily-horoscope'
  | 'weekly-horoscope'
  | 'monthly-horoscope'
  | 'yearly-horoscope'
  | 'translator'
  | 'chinese-horoscope'
  | 'numerology-horoscope'
  | 'daily-tarot'
  | 'yes-no-tarot'
  | 'past-present-future-tarot';

export type ProviderCapabilityReason =
  | 'not-configured'
  | 'not-authorized'
  | 'invalid-response'
  | 'provider-unavailable';

export interface ProviderCapabilityState {
  capability: AstrologyCapability;
  available: boolean;
  checkedAt: string;
  reason?: ProviderCapabilityReason;
}

export class DivineApiContractError extends Error {
  constructor(public readonly reason: ProviderCapabilityReason) {
    super(`DivineAPI ${reason}`);
  }
}

export function assertDivineApiSuccess(
  json: unknown,
  requiredPaths: ReadonlyArray<ReadonlyArray<string>>,
): Record<string, unknown> {
  if (!json || typeof json !== 'object') throw new DivineApiContractError('invalid-response');
  const envelope = json as Record<string, unknown>;
  if (envelope.success !== 1) {
    const message = JSON.stringify(envelope.msg ?? '');
    throw new DivineApiContractError(
      /not authorized/i.test(message) ? 'not-authorized' : 'invalid-response',
    );
  }
  for (const path of requiredPaths) {
    let value: unknown = envelope;
    for (const key of path) {
      if (!value || typeof value !== 'object' || !(key in value)) {
        throw new DivineApiContractError('invalid-response');
      }
      value = (value as Record<string, unknown>)[key];
    }
    if (value === null || value === undefined) throw new DivineApiContractError('invalid-response');
  }
  return envelope.data as Record<string, unknown>;
}
```

Add `.env.example` entries:

```dotenv
# Comma-separated allowlist. Production-verified baseline:
# daily-horoscope,weekly-horoscope,monthly-horoscope,yearly-horoscope
DIVINE_API_CAPABILITIES=
DIVINE_API_CAPABILITIES_CHECKED_AT=
DIVINE_API_TRANSLATOR_BASE_URL=https://astroapi-5-translator.divineapi.com
DIVINE_API_STALE_IF_ERROR_MS=86400000
```

- [ ] **Step 4: Wire validation into every existing request before caching**

Change `postDivineApiJson` to accept `requiredPaths`, call `assertDivineApiSuccess`, and cache only validated envelopes. Cache entries carry `expiresAt` and `staleUntil`; after fresh expiry, a Provider failure may return the last validated envelope only until `staleUntil`, with `freshness: 'stale'`. After that window, use local content. Cache keys include endpoint, period/range, date bucket, sign, and actual Provider language. Guard each endpoint with `readConfiguredCapabilities`; a missing capability returns the existing deterministic local fallback without calling `fetch`.

```ts
const json = await res.json();
assertDivineApiSuccess(json, requiredPaths);
if (config.cacheTtlMs > 0) {
  divineApiCache.set(cacheKey, { expiresAt, staleUntil, value: json });
}
return { json, freshness: 'fresh' as const };
```

`DIVINE_API_CAPABILITIES_CHECKED_AT` records the timestamp of the controlled production probe that generated the allowlist. A business denial observed during normal use marks that capability unavailable in the in-process registry until the capability refresh TTL; page requests never trigger a full endpoint probe.

- [ ] **Step 5: Extend service and router tests for truthful status**

Add assertions that `success: 2` produces `provider: 'mock'`, `fetch` is not called for unlisted capabilities, one recently stale validated success is used after a transient failure, an over-age entry falls back locally, and `astrology.status` returns a capability array and controlled-probe timestamp without exposing credentials.

```ts
expect(await getDailyTarotReading({}, options)).toMatchObject({ provider: 'mock' });
expect(divineApiStatus(env).capabilities).toContainEqual({
  capability: 'daily-tarot',
  available: false,
  reason: 'not-configured',
});
```

- [ ] **Step 6: Run focused tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/divine-api-contract.test.ts src/astrology/service.test.ts src/trpc/routers/astrology.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add .env.example apps/orchestrator/src/astrology/divine-api-contract.ts apps/orchestrator/src/astrology/divine-api-contract.test.ts apps/orchestrator/src/astrology/service.ts apps/orchestrator/src/astrology/service.test.ts apps/orchestrator/src/trpc/routers/astrology.ts apps/orchestrator/src/trpc/routers/astrology.test.ts
git commit -m "fix(astrology): enforce provider capability truth"
```

### Task 2: Add normalized daily, weekly, monthly, yearly and ranking contracts

**Files:**
- Modify: `apps/orchestrator/src/astrology/service.ts`
- Modify: `apps/orchestrator/src/astrology/service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/astrology.ts`
- Modify: `apps/orchestrator/src/trpc/routers/astrology.test.ts`

**Interfaces:**
- Produces: `AstrologyPeriod`, `AstrologyDimension`, `AstrologyPeriodReading`, `getMonthlyAstrologyReading`, `getYearlyAstrologyReading`, `getAstrologyRanking`.
- Consumes: Task 1 `assertDivineApiSuccess` and configured capability guards.

- [ ] **Step 1: Write failing normalized-reading tests**

```ts
const providerOptions = (envelope: unknown) => ({
  env: providerEnv,
  fetchImpl: vi.fn(async () => response(envelope)),
});

it('uses the official week parameter and maps six dimensions', async () => {
  const fetchImpl = vi.fn(async (_url, init) => {
    expect(String(init?.body)).toContain('week=current');
    expect(String(init?.body)).not.toContain('h_week=');
    return response({
      success: 1,
      data: {
        sign: 'Aries',
        week: '12 Aug to 18 Aug',
        weekly_horoscope: {
          personal: 'P', health: 'H', profession: 'W',
          emotions: 'E', travel: 'T', luck: ['Lucky Numbers : 3, 7'],
        },
        special: { horoscope_percentage: { personal: 80, health: 70, profession: 90, emotions: 75, travel: 60, luck: 85 } },
      },
    });
  });
  const reading = await getWeeklyAstrologyReading(profile, {
    env: providerEnv,
    fetchImpl,
  });
  expect(reading.dimensions).toHaveLength(6);
  expect(reading.dimensions.find((item) => item.key === 'profession')?.score).toBe(90);
});

it('maps current month and current year with a shared contract', async () => {
  expect(await getMonthlyAstrologyReading(profile, 'current', providerOptions(validMonthlyEnvelope))).toMatchObject({
    period: 'monthly', source: 'divineapi', rangeKey: 'current',
  });
  expect(await getYearlyAstrologyReading(profile, providerOptions(validYearlyEnvelope))).toMatchObject({
    period: 'yearly', source: 'divineapi', rangeKey: 'current',
  });
});
```

Declare `providerEnv`, `validMonthlyEnvelope`, and `validYearlyEnvelope` beside the existing daily/weekly fixtures with complete `success: 1` payloads and all fields required by the new parsers.

- [ ] **Step 2: Run the focused service tests and confirm red**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts
```

Expected: FAIL because period types and monthly/yearly functions do not exist.

- [ ] **Step 3: Add the normalized period types**

```ts
export type AstrologyPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type AstrologyDimensionKey =
  | 'personal' | 'health' | 'profession' | 'emotions' | 'travel' | 'luck';

export interface AstrologyDimension {
  key: AstrologyDimensionKey;
  label: string;
  body: string;
  score: number | null;
}

export interface AstrologyPeriodReading {
  period: AstrologyPeriod;
  provider: 'mock' | 'divineapi';
  source: 'local-fallback' | 'divineapi';
  freshness: 'local' | 'fresh' | 'stale';
  zodiacSign: ZodiacSign;
  zodiacLabel: string;
  rangeLabel: string;
  rangeKey: 'today' | 'current' | 'next';
  summary: string;
  dimensions: AstrologyDimension[];
  luckyColors: string[];
  luckyNumbers: string[];
  luckyLetters: string[];
  suitableTimes: string[];
  sevenDayTrend: {
    source: 'divineapi';
    items: Array<{ dateLabel: string; score: number }>;
  } | null;
  cosmicTip: string | null;
  singlesTip: string | null;
  couplesTip: string | null;
}
```

- [ ] **Step 4: Implement period-specific paths and parsers**

Use these exact request fields:

```ts
const PERIOD_REQUESTS = {
  daily: { path: '/api/v5/daily-horoscope', selector: 'prediction', rangeField: ['h_day', 'today'] },
  weekly: { path: '/api/v5/weekly-horoscope', selector: 'weekly_horoscope', rangeField: ['week', 'current'] },
  monthly: { path: '/api/v5/monthly-horoscope', selector: 'monthly_horoscope', rangeField: ['month', 'current'] },
  yearly: { path: '/api/v5/yearly-horoscope', selector: 'yearly_horoscope', rangeField: ['year', 'current'] },
} as const;
```

Add `parseDimensions`, `parseLuckyInsights`, local period builders, and these exact public signatures. `suitableTimes` comes only from explicit Provider time fields. `sevenDayTrend` is populated only when the validated response contains seven dated, structured scores; otherwise return `null` and never synthesize a chart.

```ts
export function getMonthlyAstrologyReading(
  input: AstrologyProfileInput,
  rangeKey: 'current' | 'next' = 'current',
  options: RequestOptions = {},
): Promise<AstrologyPeriodReading>;

export function getYearlyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): Promise<AstrologyPeriodReading>;
```

- [ ] **Step 5: Add locale-aware host selection**

```ts
function requestTarget(config: DivineApiConfig, locale?: string): { baseUrl: string; lan: 'en' | 'zh' } {
  if (locale?.toLowerCase().startsWith('zh') && config.capabilities.has('translator')) {
    return { baseUrl: config.translatorBaseUrl, lan: 'zh' };
  }
  return { baseUrl: config.baseUrl, lan: 'en' };
}
```

When the requested UI locale is Chinese and Translator is unavailable, return the local Chinese period immediately; do not silently return English copy.

- [ ] **Step 6: Add monthly, yearly, and complete ranking routes**

Extend `profileInputSchema` with an optional `zodiacSignOverride` using the existing twelve-sign enum. Service functions resolve this override before deriving a sign from the birthday; it is request-scoped and is never written back to the user profile. Apply the same field to daily, weekly, monthly, and yearly routes so “换个星座看看” can reuse the normalized contract.

```ts
monthly: protectedProcedure
  .input(profileInputSchema.extend({ month: z.enum(['current', 'next']).default('current') }))
  .query(({ input }) => getMonthlyAstrologyReading(input, input.month)),
yearly: protectedProcedure
  .input(profileInputSchema)
  .query(({ input }) => getYearlyAstrologyReading(input)),
ranking: protectedProcedure
  .input(z.object({ locale: z.string().trim().max(16).optional() }))
  .query(({ input }) => getAstrologyRanking(input.locale)),
```

`ranking` returns `{ complete: false, items: [] }` unless all twelve same-date readings are Provider-backed and contain an overall score.

- [ ] **Step 7: Run service and router tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/service.test.ts src/trpc/routers/astrology.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/orchestrator/src/astrology/service.ts apps/orchestrator/src/astrology/service.test.ts apps/orchestrator/src/trpc/routers/astrology.ts apps/orchestrator/src/trpc/routers/astrology.test.ts
git commit -m "feat(astrology): add normalized period readings"
```

### Task 3: Refactor the frontend astrology state to isolate periods and failures

**Files:**
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.ts`
- Modify: `apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy-types.ts`

**Interfaces:**
- Produces: `EnergyPeriodState`, `EnergyAstrologyState.periods`, `loadPeriod(period, rangeKey?)`, `refreshPeriod(period)`.
- Keeps `reading` as the local `AstroReading` compatibility view until all consumers migrate.

- [ ] **Step 1: Write failing hook tests for partial success and lazy periods**

```ts
it('keeps daily provider data when weekly fails', async () => {
  trpcMocks.daily.mockResolvedValue(providerPeriod('daily'));
  trpcMocks.weekly.mockRejectedValue(new Error('weekly unavailable'));
  const { result } = renderHook(() => useEnergyAstrology(profile, true));
  await waitFor(() => expect(result.current.periods.daily.loading).toBe(false));
  expect(result.current.periods.daily.source).toBe('divineapi');
  expect(result.current.periods.weekly.source).toBe('local-fallback');
});

it('does not fetch monthly until requested', async () => {
  const { result } = renderHook(() => useEnergyAstrology(profile, true));
  expect(trpcMocks.monthly).not.toHaveBeenCalled();
  await act(() => result.current.loadPeriod('monthly', 'current'));
  expect(trpcMocks.monthly).toHaveBeenCalledWith(expect.objectContaining({ month: 'current' }));
});
```

- [ ] **Step 2: Run the hook tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx
```

Expected: FAIL because `periods` and `loadPeriod` do not exist.

- [ ] **Step 3: Add period-scoped state**

```ts
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/lib/trpc';

type AstrologyRouterOutput = inferRouterOutputs<AppRouter>['astrology'];
export type EnergyPeriodReading = AstrologyRouterOutput['daily'];
export type EnergyRankingItem = AstrologyRouterOutput['ranking']['items'][number];

export interface EnergyPeriodState {
  reading: EnergyPeriodReading;
  source: 'divineapi' | 'local-fallback';
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface EnergyAstrologyState {
  reading: AstroReading;
  periods: Record<AstrologyPeriod, EnergyPeriodState>;
  capabilities: Record<string, boolean>;
  ranking: {
    complete: boolean;
    items: EnergyRankingItem[];
    loaded: boolean;
    loading: boolean;
    error: string | null;
  };
  signPreview: EnergyPeriodState | null;
  loadPeriod: (period: AstrologyPeriod, rangeKey?: 'current' | 'next') => Promise<void>;
  refreshPeriod: (period: AstrologyPeriod) => Promise<void>;
  loadRanking: () => Promise<void>;
  loadSignPreview: (sign: ZodiacSign) => Promise<void>;
}
```

Fetch `status`, `daily`, and `weekly` independently with `Promise.allSettled`. Load monthly/yearly, the twelve-sign ranking, and sign previews only through their explicit methods. `loadSignPreview` calls the daily route with a validated `zodiacSignOverride` added in Task 2 and never rewrites the saved birth profile. Preserve request IDs per period and sign preview so stale responses cannot overwrite a newer profile.

- [ ] **Step 4: Remove unauthorized eager tarot calls from the hook**

Do not call `trpc.astrology.tarot` or `yesNoTarot` when their capabilities are false. Keep Provider tarot types behind optional capability adapters for Task 6; local card selection does not depend on this hook.

```ts
if (!capabilities['daily-tarot']) return { source: 'holaday-editorial' as const };
```

- [ ] **Step 5: Run hook tests and compatibility tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/useEnergyAstrology.test.tsx src/components/energy/EnergyHome.test.tsx src/components/energy/experiences/HoroscopeExperience.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/web-workbench/src/components/energy/useEnergyAstrology.ts apps/web-workbench/src/components/energy/useEnergyAstrology.test.tsx apps/web-workbench/src/components/energy/energy-types.ts
git commit -m "refactor(energy): isolate astrology period state"
```

### Task 4: Build the inline Astrology World

**Files:**
- Create: `apps/web-workbench/src/components/energy/astrology-content.ts`
- Create: `apps/web-workbench/src/components/energy/astrology-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx`
- Create: `apps/web-workbench/src/components/energy/LuckyInsights.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`

**Interfaces:**
- Consumes: Task 3 `EnergyAstrologyState.periods` and `loadPeriod`.
- Produces: `AstrologyWorld` with `id="energy-astrology-world"`; the summary CTA scrolls to this ID.

- [ ] **Step 1: Write failing content and component tests**

```ts
it('orders the six dimensions without inventing missing scores', () => {
  expect(periodSections(reading).map((item) => item.key)).toEqual([
    'profession', 'personal', 'health', 'emotions', 'travel', 'luck',
  ]);
  expect(periodSections(readingWithoutScores).every((item) => item.score === null)).toBe(true);
});
```

```tsx
it('loads month only when the month tab is opened', async () => {
  const loadPeriod = vi.fn(async () => undefined);
  render(<AstrologyWorld astrology={state({ loadPeriod })} onComplete={vi.fn()} />);
  await userEvent.click(screen.getByRole('tab', { name: '本月' }));
  expect(loadPeriod).toHaveBeenCalledWith('monthly', 'current');
});

it('never renders an invented ranking or seven-day chart', async () => {
  render(<AstrologyWorld astrology={state({
    ranking: { complete: false, items: [], loaded: true, loading: false, error: null },
    periods: { daily: periodState({ reading: dailyReading({ sevenDayTrend: null }) }) },
  })} onComplete={vi.fn()} />);
  expect(screen.queryByText('十二星座今日能量排行')).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: '七日能量趋势' })).not.toBeInTheDocument();
  expect(screen.getByText('暂未获得可验证的七日趋势')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the new tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/astrology-content.test.ts src/components/energy/AstrologyWorld.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement reusable six-dimension and lucky-insight views**

`AstrologyDimensionGrid` renders the first three dimensions, then a button labelled “展开全部六项”. A missing score omits the percentage element instead of rendering `0%`.

```tsx
{dimension.score === null ? null : <span>{dimension.score}%</span>}
```

`LuckyInsights` renders only non-empty groups and uses actual color codes for swatches with text labels available to screen readers. It includes suitable-time chips only when `suitableTimes` is non-empty. The seven-day trend uses validated dated scores only; when `sevenDayTrend` is `null`, render the quiet copy “暂未获得可验证的七日趋势” and no chart geometry.

- [ ] **Step 4: Implement four-range navigation and local fallback copy**

Use `role="tablist"`, `role="tab"`, `aria-selected`, and a single `tabpanel`. Add current/next month sub-controls only inside monthly view. Render “Holaday 本地提示” whenever the selected period source is `local-fallback`; render “DivineAPI 最近成功数据” when `freshness === 'stale'` so stale-if-error recovery remains transparent.

```tsx
const tabs: Array<{ period: AstrologyPeriod; label: string }> = [
  { period: 'daily', label: '今日' },
  { period: 'weekly', label: '本周' },
  { period: 'monthly', label: '本月' },
  { period: 'yearly', label: '本年' },
];
```

- [ ] **Step 5: Integrate below the summary card**

Add a ref in `EnergyHome`, render `AstrologyWorld` immediately after `.energy-insight-grid`, and change the summary CTA to call `scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })`.

At the end of `AstrologyWorld`, add three explicit continuation paths:

- “查看十二星座排行” calls `loadRanking`; render the ranking only when `complete === true` and all 12 dated items are present, otherwise explain that Provider data is incomplete without inserting local scores;
- “换个星座看看” opens the twelve-sign picker and calls `loadSignPreview` without mutating the stored profile;
- “抽一张相关能量牌” and “测个相关主题” call callbacks from `EnergyHome` to open the existing Experience Player in the matching mode.

- [ ] **Step 6: Run focused frontend tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/astrology-content.test.ts src/components/energy/AstrologyWorld.test.tsx src/components/energy/EnergyHome.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/web-workbench/src/components/energy/astrology-content.ts apps/web-workbench/src/components/energy/astrology-content.test.ts apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx apps/web-workbench/src/components/energy/LuckyInsights.tsx apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx
git commit -m "feat(energy): add astrology world"
```

### Task 5: Create the 36-card Holaday energy deck and deterministic selector

**Files:**
- Create: `apps/web-workbench/src/components/energy/experiences/energy-card-content.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/energy-card-selection.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/energy-card-selection.test.ts`

**Interfaces:**
- Produces: `HoladayEnergyCard`, `HoladayCardTheme`, `HOLADAY_ENERGY_CARDS`, `drawEnergyCards`.
- Task 6 consumes the selector and never accesses array positions directly.

- [ ] **Step 1: Write failing catalog and selector tests**

```ts
it('contains 36 complete cards across six primary themes', () => {
  expect(HOLADAY_ENERGY_CARDS).toHaveLength(36);
  expect(new Set(HOLADAY_ENERGY_CARDS.map((card) => card.id)).size).toBe(36);
  for (const theme of ['work', 'relationship', 'emotion', 'space', 'confidence', 'uplift']) {
    expect(HOLADAY_ENERGY_CARDS.filter((card) => card.primaryTheme === theme)).toHaveLength(6);
  }
  expect(HOLADAY_ENERGY_CARDS.every((card) =>
    [card.title, card.subtitle, card.body, card.action].every((value) => value.trim().length > 0),
  )).toBe(true);
});

it('draws three distinct cards and avoids seen ids', () => {
  const first = drawEnergyCards({ mode: 'three', theme: 'work', count: 3, seed: 'session-a', seenIds: [] });
  const second = drawEnergyCards({ mode: 'single', theme: 'work', count: 1, seed: 'session-b', seenIds: first.map((card) => card.id) });
  expect(new Set(first.map((card) => card.id)).size).toBe(3);
  expect(first.map((card) => card.id)).not.toContain(second[0]?.id);
});
```

- [ ] **Step 2: Run selector tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/energy-card-selection.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define the card contract and six themed groups**

```ts
export type HoladayCardTheme =
  | 'work' | 'relationship' | 'emotion' | 'space' | 'confidence' | 'uplift';

export interface HoladayEnergyCard {
  id: string;
  title: string;
  subtitle: string;
  body: string;
  action: string;
  answer: 'yes' | 'no' | 'wait';
  primaryTheme: HoladayCardTheme;
  themes: HoladayCardTheme[];
}
```

Create six cards per primary theme. IDs use `work-01` through `work-06`, `relationship-01` through `relationship-06`, `emotion-01` through `emotion-06`, `space-01` through `space-06`, `confidence-01` through `confidence-06`, and `uplift-01` through `uplift-06`. Secondary `themes` may cross-reference other themes, but selection and the six-per-theme invariant use `primaryTheme`. Every body is 35–90 Chinese characters; every action is a concrete step that can be completed within 15 minutes.

- [ ] **Step 4: Implement selection without `Math.random`**

```ts
export function drawEnergyCards(input: {
  mode: 'daily' | 'single' | 'yes-no' | 'three';
  theme: HoladayCardTheme;
  count: 1 | 3;
  seed: string;
  seenIds: string[];
}): HoladayEnergyCard[] {
  const themed = HOLADAY_ENERGY_CARDS.filter((card) => card.primaryTheme === input.theme);
  const unseen = themed.filter((card) => !input.seenIds.includes(card.id));
  const pool = unseen.length >= input.count ? unseen : themed;
  return stableRotate(pool, seededNumber(input.seed)).slice(0, input.count);
}
```

- [ ] **Step 5: Run selector tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/energy-card-selection.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/web-workbench/src/components/energy/experiences/energy-card-content.ts apps/web-workbench/src/components/energy/experiences/energy-card-selection.ts apps/web-workbench/src/components/energy/experiences/energy-card-selection.test.ts
git commit -m "feat(energy): add Holaday energy card deck"
```

### Task 6: Rebuild TarotExperience as a continuous card lab

**Files:**
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/experience-registry.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-types.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.test.ts`
- Modify: `apps/web-workbench/src/components/energy/ExperiencePlayer.tsx`
- Modify: `apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx`

**Interfaces:**
- Consumes: Task 5 `drawEnergyCards` and `HOLADAY_ENERGY_CARDS`.
- Produces: result actions for redraw, theme change, three-card entry, and session history.

- [ ] **Step 1: Replace existing tests with failing continuous-flow tests**

```tsx
it('continues from a single-card result into a three-card spread', async () => {
  renderTarot();
  await userEvent.click(screen.getByRole('button', { name: '单张能量牌' }));
  await userEvent.click(screen.getByRole('button', { name: '工作推进' }));
  await userEvent.click(screen.getByRole('button', { name: '开始抽卡' }));
  await userEvent.click(screen.getByRole('button', { name: '翻开这张牌' }));
  await userEvent.click(screen.getByRole('button', { name: '进入三张牌' }));
  expect(screen.getAllByTestId('energy-card-result')).toHaveLength(3);
  expect(screen.getByText('回顾')).toBeInTheDocument();
  expect(screen.getByText('当下')).toBeInTheDocument();
  expect(screen.getByText('下一步')).toBeInTheDocument();
});

it('redraws without closing the result phase', async () => {
  const { onPhaseChange } = renderCompletedSingleCard();
  await userEvent.click(screen.getByRole('button', { name: '再抽一次' }));
  expect(screen.getByRole('button', { name: '翻开这张牌' })).toBeInTheDocument();
  expect(onPhaseChange).not.toHaveBeenLastCalledWith('intro');
});

it('saves only the revealed card id for the current storage scope', async () => {
  const { scope } = renderCompletedSingleCard({ profileStorageScope: 'usr_a' });
  await userEvent.click(screen.getByRole('button', { name: '收藏本次提示' }));
  expect(readEnergyProgress(scope).savedCardIds).toEqual([expect.stringMatching(/^[a-z-]+-\d{2}$/)]);
  expect(window.localStorage.getItem('holaday.energy.progress.v2:usr_a')).not.toContain('body');
});
```

- [ ] **Step 2: Run TarotExperience tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TarotExperience.test.tsx
```

Expected: FAIL on the new labels and three-card result.

- [ ] **Step 3: Implement the explicit state machine**

```ts
type CardLabMode = 'single' | 'yes-no' | 'three';
type CardLabStage = 'directory' | 'theme' | 'ready' | 'revealed' | 'history';

interface CardLabSession {
  mode: CardLabMode | null;
  stage: CardLabStage;
  theme: HoladayCardTheme;
  cards: HoladayEnergyCard[];
  seenIds: string[];
  history: Array<{ mode: CardLabMode; cardIds: string[]; createdAt: number }>;
}
```

The visible heading must say “Holaday 能量牌”. Provider modes remain hidden while capability flags are false. Call `onComplete` only for the first reveal in one player session, while redraws call `onPhaseChange('active')` and retain session history.

- [ ] **Step 4: Keep Player-level next actions and inner next actions distinct**

The inner result presents “再抽一次”, “换个主题”, “进入三张牌”, “收藏本次提示”, and “本次记录”. Extend the versioned, user-scoped `energy-progress` record with `savedCardIds` and store stable IDs only—not card bodies or user questions. Add an explicit `replayLabel?: string` prop to `ExperiencePlayer`; the registry passes “重新开始抽卡” for Tarot while other experiences keep the current default, avoiding duplicate accessible names.

- [ ] **Step 5: Run Tarot and Player tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TarotExperience.test.tsx src/components/energy/ExperiencePlayer.test.tsx src/components/energy/experience-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/web-workbench/src/components/energy/experiences/TarotExperience.tsx apps/web-workbench/src/components/energy/experiences/TarotExperience.test.tsx apps/web-workbench/src/components/energy/experience-registry.ts apps/web-workbench/src/components/energy/energy-types.ts apps/web-workbench/src/components/energy/energy-progress.ts apps/web-workbench/src/components/energy/energy-progress.test.ts apps/web-workbench/src/components/energy/ExperiencePlayer.tsx apps/web-workbench/src/components/energy/ExperiencePlayer.test.tsx
git commit -m "feat(energy): build continuous card lab"
```

### Task 7: Build the 18-test library and deterministic scoring engine

**Files:**
- Modify: `apps/web-workbench/src/components/energy/experiences/test-content.ts`
- Modify: `apps/web-workbench/src/components/energy/experiences/test-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/light-test-engine.ts`
- Create: `apps/web-workbench/src/components/energy/experiences/light-test-engine.test.ts`

**Interfaces:**
- Produces: `LightTestCategory`, expanded `LightTestDefinition`, `scoreLightTest`, `LIGHT_TESTS`.
- Task 8 consumes only these public exports.

- [ ] **Step 1: Write failing library invariants**

```ts
it('contains six categories, three tests each, and complete questions', () => {
  expect(LIGHT_TESTS).toHaveLength(18);
  const counts: Record<string, number> = {};
  for (const test of LIGHT_TESTS) {
    counts[test.category] = (counts[test.category] ?? 0) + 1;
    expect(test.questions.length).toBeGreaterThanOrEqual(5);
    expect(test.questions.length).toBeLessThanOrEqual(7);
    expect(test.outcomes.length).toBeGreaterThanOrEqual(4);
    expect(test.relatedTestIds.length).toBeGreaterThanOrEqual(2);
  }
  expect(counts).toEqual({
    emotion: 3,
    stress: 3,
    work: 3,
    relationship: 3,
    social: 3,
    'daily-number': 3,
  });
});

it('contains no diagnostic or deterministic-risk language', () => {
  expect(JSON.stringify(LIGHT_TESTS)).not.toMatch(/患有|确诊|风险等级|人格缺陷|注定|一定会/);
});
```

- [ ] **Step 2: Write failing scoring tests**

```ts
it('maps score bands to stable outcome ids', () => {
  const test = LIGHT_TESTS[0]!;
  const lowest = test.questions.map((question) =>
    question.options.find((option) => option.points === 0)!.id,
  );
  const highest = test.questions.map((question) =>
    question.options.find((option) => option.points === 3)!.id,
  );
  expect(scoreLightTest(test, lowest).id).toBe('recover');
  expect(scoreLightTest(test, highest).id).toBe('charge');
});

it('makes every declared outcome reachable', () => {
  for (const test of LIGHT_TESTS) {
    expect(reachableOutcomeIds(test).sort()).toEqual(test.outcomes.map((item) => item.id).sort());
  }
});
```

- [ ] **Step 3: Run content and engine tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/test-content.test.ts src/components/energy/experiences/light-test-engine.test.ts
```

Expected: FAIL because the library still contains three one-question tests and the engine is absent.

- [ ] **Step 4: Define the expanded contract**

```ts
export type LightTestCategory =
  | 'emotion' | 'stress' | 'work' | 'relationship' | 'social' | 'daily-number';

export interface LightTestOption {
  id: string;
  label: string;
  body: string;
  points: number;
}

export interface LightTestOutcome extends LightTestResult {
  id: string;
  minScore: number;
  maxScore: number;
}

export interface LightTestDefinition {
  id: string;
  category: LightTestCategory;
  title: string;
  description: string;
  estimatedSeconds: number;
  questions: Array<{ id: string; prompt: string; options: LightTestOption[] }>;
  outcomes: LightTestOutcome[];
  relatedTestIds: string[];
}
```

- [ ] **Step 5: Author the exact 18-test directory**

Use these stable IDs:

```ts
const REQUIRED_TEST_IDS = [
  'emotion-battery', 'emotion-weather', 'emotion-recovery',
  'stress-signal', 'stress-rhythm', 'stress-boundary',
  'work-start', 'work-focus', 'work-finish',
  'relationship-expression', 'relationship-distance', 'relationship-listening',
  'social-energy', 'social-boundary', 'social-recharge',
  'daily-number-action', 'daily-number-relationship', 'daily-number-rest',
] as const;
```

Each definition has five questions, four options worth 0–3 points, and four non-overlapping outcomes covering 0–15: `0–3`, `4–7`, `8–11`, `12–15`. Use the stable outcome IDs `recover`, `steady`, `build`, and `charge` in that order. Each result includes title, body, strength, reminder, and an action completable within 15 minutes.

- [ ] **Step 6: Implement score selection and reachability helper**

```ts
export function scoreLightTest(test: LightTestDefinition, answers: string[]): LightTestOutcome {
  const score = test.questions.reduce((total, question, index) => {
    return total + (question.options.find((option) => option.id === answers[index])?.points ?? 0);
  }, 0);
  const outcome = test.outcomes.find((item) => score >= item.minScore && score <= item.maxScore);
  if (!outcome) throw new Error(`No outcome for ${test.id} score ${score}`);
  return outcome;
}

export function reachableOutcomeIds(test: LightTestDefinition): string[] {
  const maximum = test.questions.reduce(
    (total, question) => total + Math.max(...question.options.map((option) => option.points)),
    0,
  );
  const ids = new Set<string>();
  for (let score = 0; score <= maximum; score += 1) {
    const outcome = test.outcomes.find((item) => score >= item.minScore && score <= item.maxScore);
    if (outcome) ids.add(outcome.id);
  }
  return [...ids];
}
```

- [ ] **Step 7: Run test library and engine tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/test-content.test.ts src/components/energy/experiences/light-test-engine.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7**

```bash
git add apps/web-workbench/src/components/energy/experiences/test-content.ts apps/web-workbench/src/components/energy/experiences/test-content.test.ts apps/web-workbench/src/components/energy/experiences/light-test-engine.ts apps/web-workbench/src/components/energy/experiences/light-test-engine.test.ts
git commit -m "feat(energy): add complete light test library"
```

### Task 8: Rebuild TestExperience for directory, progress and continuous results

**Files:**
- Modify: `apps/web-workbench/src/components/energy/experiences/TestExperience.tsx`
- Modify: `apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.test.ts`

**Interfaces:**
- Consumes: Task 7 `LIGHT_TESTS` and `scoreLightTest`.
- Produces: complete directory → questions → result → related/retry/directory loop.

- [ ] **Step 1: Write failing end-to-end component tests**

```tsx
it('completes five questions and opens a related test without closing', async () => {
  renderTestExperience();
  await userEvent.click(screen.getByRole('button', { name: /情绪电量/ }));
  for (let index = 0; index < 5; index += 1) {
    await userEvent.click(screen.getAllByTestId('light-test-option')[0]!);
  }
  expect(screen.getByText('今日心理画像')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '测相关主题' }));
  expect(screen.getByText(/1\/5/)).toBeInTheDocument();
});

it('returns to the directory and marks the completed test', async () => {
  const view = await completeFirstTest();
  await userEvent.click(screen.getByRole('button', { name: '返回测试目录' }));
  expect(view.getByText('已完成')).toBeInTheDocument();
});

it('saves completion and action ids without persisting answers', async () => {
  await completeFirstTest({ profileStorageScope: 'usr_a' });
  await userEvent.click(screen.getByRole('button', { name: '收藏行动建议' }));
  const progress = readEnergyProgress('usr_a');
  expect(progress.completedTestIds).toContain('emotion-battery');
  expect(progress.savedTestActionIds).toContain('emotion-battery:recover');
  expect(window.localStorage.getItem('holaday.energy.progress.v2:usr_a')).not.toContain('answers');
});
```

- [ ] **Step 2: Run TestExperience tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TestExperience.test.tsx
```

Expected: FAIL because current tests end after one question and lack next actions.

- [ ] **Step 3: Implement the explicit runner state**

```ts
type TestStage = 'directory' | 'questions' | 'result';

interface TestSessionState {
  stage: TestStage;
  activeTestId: string | null;
  questionIndex: number;
  answers: string[];
  result: LightTestOutcome | null;
  completedTestIds: string[];
}
```

Every answer control exposes `data-testid="light-test-option"` for stable flow tests while retaining its visible accessible label. Do not render the final question behind the result. When the last answer is chosen, calculate the result and switch to `stage: 'result'`. Provide “换一套”, “测相关主题”, “重新测试”, “收藏行动建议”, and “返回测试目录”.

- [ ] **Step 4: Preserve only completion IDs in scoped storage**

Migrate the user-scoped record in `energy-progress.ts` to `holaday.energy.progress.v2` while reading and normalizing existing v1 completion data. Add `completedTestIds`, `savedCardIds`, and `savedTestActionIds`; values are bounded stable IDs and never answer arrays or result prose. A preview route with `profileStorageScope=null` uses an in-memory session only and does not write the guest key.

- [ ] **Step 5: Run TestExperience and registry tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/experiences/TestExperience.test.tsx src/components/energy/experience-registry.test.ts src/components/energy/EnergyHome.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```bash
git add apps/web-workbench/src/components/energy/experiences/TestExperience.tsx apps/web-workbench/src/components/energy/experiences/TestExperience.test.tsx apps/web-workbench/src/components/energy/energy-progress.ts apps/web-workbench/src/components/energy/energy-progress.test.ts
git commit -m "feat(energy): make light tests replayable"
```

### Task 9: Add the six-card Explore Feed and bounded analytics

**Files:**
- Create: `apps/web-workbench/src/components/energy/explore-content.ts`
- Create: `apps/web-workbench/src/components/energy/explore-content.test.ts`
- Create: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-progress.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.ts`
- Modify: `apps/orchestrator/src/trpc/routers/energy.test.ts`

**Interfaces:**
- Produces: `EnergyContentItem`, `ENERGY_EXPLORE_CONTENT`, `nextEnergyContentBatch` and `EnergyExploreFeed`.
- Extends analytics with the nine bounded event names locked in the design specification.

- [ ] **Step 1: Write failing catalog and selector tests**

```ts
it('contains 36 complete, non-sponsored launch items', () => {
  expect(ENERGY_EXPLORE_CONTENT).toHaveLength(36);
  expect(ENERGY_EXPLORE_CONTENT.some((item) => item.kind === 'sponsored')).toBe(false);
  expect(new Set(ENERGY_EXPLORE_CONTENT.map((item) => item.id)).size).toBe(36);
});

it('returns six unseen items before recycling', () => {
  const context = { mood: 'stressed', energyNeed: 'relax' } as const;
  const first = nextEnergyContentBatch({ items: ENERGY_EXPLORE_CONTENT, seenIds: [], seed: 'a', size: 6, now, ...context });
  const second = nextEnergyContentBatch({ items: ENERGY_EXPLORE_CONTENT, seenIds: first.map((item) => item.id), seed: 'b', size: 6, now, ...context });
  expect(first).toHaveLength(6);
  expect(first.map((item) => item.id).filter((id) => second.some((item) => item.id === id))).toEqual([]);
});

it('ranks content matching the current energy need before other unseen items', () => {
  const batch = nextEnergyContentBatch({
    items: ENERGY_EXPLORE_CONTENT,
    seenIds: [],
    seed: 'need-aware',
    size: 6,
    now,
    mood: 'tired',
    energyNeed: 'relax',
  });
  expect(batch.slice(0, 3).every((item) => item.tags.includes('relax'))).toBe(true);
});
```

- [ ] **Step 2: Write failing feed interaction tests**

```tsx
it('replaces the visible six cards and reports a bounded refresh', async () => {
  const onEvent = vi.fn();
  render(<EnergyExploreFeed storageScope="usr_a" onEvent={onEvent} />);
  const before = screen.getAllByRole('article').map((item) => item.textContent);
  await userEvent.click(screen.getByRole('button', { name: '再来一组' }));
  const after = screen.getAllByRole('article').map((item) => item.textContent);
  expect(after).not.toEqual(before);
  expect(onEvent).toHaveBeenCalledWith({ type: 'energy_feed_refreshed' });
});
```

- [ ] **Step 3: Run new tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/explore-content.test.ts src/components/energy/EnergyExploreFeed.test.tsx
```

Expected: FAIL because the feed modules do not exist.

- [ ] **Step 4: Author 36 items across eight launch categories**

Define the protocol before the catalog so future video and sponsored entries can use the same selector without entering the launch set:

```ts
export type EnergyContentKind =
  | 'astrology' | 'tarot' | 'test' | 'game' | 'micro-content' | 'video' | 'sponsored';

export type EnergyContentCategory =
  | 'relaxation' | 'fortune' | 'zodiac-knowledge' | 'relationship-quiz'
  | 'poll' | 'test-recommendation' | 'card-recommendation' | 'game-recommendation';

export interface EnergyContentItem {
  id: string;
  kind: EnergyContentKind;
  category: EnergyContentCategory;
  title: string;
  summary: string;
  estimatedSeconds: number;
  tags: string[];
  source: 'divineapi' | 'holaday-editorial' | 'partner';
  actionTarget: string;
  publishedAt?: string;
  expiresAt?: string;
}
```

Use IDs and counts:

```ts
const REQUIRED_CONTENT_COUNTS = {
  relaxation: 6,
  fortune: 6,
  'zodiac-knowledge': 6,
  'relationship-quiz': 4,
  poll: 4,
  'test-recommendation': 4,
  'card-recommendation': 3,
  'game-recommendation': 3,
} as const;
```

Each item has a title, 25–80 Chinese-character summary, estimated seconds, tags, `source: 'holaday-editorial'`, and an action target. At least six launch items include each energy-need tag (`focus`, `relax`, `confidence`, `uplift`) so affinity ranking always has usable candidates. The launch catalog uses broad `kind` values plus the exact category above; `video` and `sponsored` remain valid protocol kinds but have zero launch items.

- [ ] **Step 5: Implement date filtering and session no-repeat**

```ts
export function nextEnergyContentBatch(input: {
  items: EnergyContentItem[];
  seenIds: string[];
  seed: string;
  size: 6;
  now: Date;
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
}): EnergyContentItem[] {
  const active = input.items.filter((item) => isActiveAt(item, input.now));
  const unseen = active.filter((item) => !input.seenIds.includes(item.id));
  const pool = unseen.length >= input.size ? unseen : active;
  const ranked = rankByEnergyAffinity(pool, input.mood, input.energyNeed);
  return stableRotateEqualRankGroups(ranked, seededNumber(input.seed))
    .slice(0, input.size);
}
```

Persist only bounded seen IDs under the current user scope. A preview route keeps them in memory and does not write a shared guest key.

- [ ] **Step 6: Extend the server event schema without free text**

Keep the existing strict experience-event schema for backward compatibility and union it with strict schemas for:

```ts
type EnergyContentHubEventType =
  | 'energy_section_viewed'
  | 'astrology_range_opened'
  | 'tarot_mode_started'
  | 'tarot_redrawn'
  | 'light_test_started'
  | 'light_test_completed'
  | 'energy_feed_refreshed'
  | 'energy_content_opened'
  | 'running_task_returned';
```

Bound all metadata with enums or `z.string().regex(/^[a-z0-9-]{1,64}$/)`: `section`, astrology `range`, card `mode`, `testId`, `contentId`, and `taskStatus`. Each union member is `.strict()`. Add tests that valid examples of all nine events pass, while `answerText`, `questionText`, `providerBody`, unknown keys, and invalid IDs are rejected. Wire callbacks from `AstrologyWorld`, `TarotExperience`, `TestExperience`, `EnergyExploreFeed`, and `RunningTaskDock` through `EnergyHome` without including visible copy.

- [ ] **Step 7: Integrate the feed at the bottom of EnergyHome and run tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/trpc/routers/energy.test.ts
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/explore-content.test.ts src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```bash
git add apps/orchestrator/src/trpc/routers/energy.ts apps/orchestrator/src/trpc/routers/energy.test.ts apps/web-workbench/src/components/energy/explore-content.ts apps/web-workbench/src/components/energy/explore-content.test.ts apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/energy-progress.ts apps/web-workbench/src/components/energy/energy-progress.test.ts
git commit -m "feat(energy): add waiting explore feed"
```

### Task 10: Add the non-blocking Running Task Dock

**Files:**
- Create: `apps/web-workbench/src/components/energy/running-task-dock-state.ts`
- Create: `apps/web-workbench/src/components/energy/running-task-dock-state.test.ts`
- Create: `apps/web-workbench/src/components/energy/RunningTaskDock.tsx`
- Create: `apps/web-workbench/src/components/energy/RunningTaskDock.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/pages/AstrologyPage.tsx`
- Modify: `apps/web-workbench/src/pages/AstrologyPage.test.tsx`

**Interfaces:**
- Consumes: `useTaskStore`, `UiTask`, `taskStatusLabel`, React Router navigation.
- Produces: `selectEnergyDockTask(tasks)` and `RunningTaskDock`.

- [ ] **Step 1: Write failing selector tests**

```ts
it('prioritizes a task waiting for the user over executing and queued tasks', () => {
  expect(selectEnergyDockTask([
    task('queued', 'queued'), task('running', 'executing'), task('needs-user', 'awaiting_user'),
  ])?.taskId).toBe('needs-user');
});

it('returns null when there is no active or newly terminal tracked task', () => {
  expect(selectEnergyDockTask([task('old', 'completed')])).toBeNull();
});
```

- [ ] **Step 2: Write failing component tests**

```tsx
it('keeps the tracked task visible when it completes and links back to it', async () => {
  const navigate = vi.fn();
  const { rerender } = renderDock(task('one', 'executing'), navigate);
  rerender(dock(task('one', 'completed'), navigate));
  expect(screen.getByText('已完成')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看任务结果' }));
  expect(navigate).toHaveBeenCalledWith('/?task=one');
});
```

- [ ] **Step 3: Run dock tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/running-task-dock-state.test.ts src/components/energy/RunningTaskDock.test.tsx
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement deterministic task selection**

Priority is: `awaiting_user`, `executing`, `planning`, `queued`, `pending`, `paused`. Within one priority choose newest `createdAt`. Never select historical terminal tasks on initial mount.

```ts
const PRIORITY: Partial<Record<UiTaskStatus, number>> = {
  awaiting_user: 0, executing: 1, planning: 2, queued: 3, pending: 4, paused: 5,
};
```

- [ ] **Step 5: Implement transition-aware dock behavior**

The component tracks the selected task ID in a ref and derives a minute-level elapsed label from `createdAt` without adding a polling protocol. If that task becomes `completed`, `partial_success`, `failed`, or `cancelled` while the page is mounted, retain it and change the CTA to “查看任务结果”. Do not auto-navigate. If more than one active task has the same priority, show “查看进行中的任务” and navigate to `/` without a guessed task ID.

- [ ] **Step 6: Integrate only on the authenticated `/cosmic` route**

`AstrologyPage` reads task store state only inside `AuthedAstrologyPage`. `/cosmic-preview` receives `tasks=[]` and renders no dock.

- [ ] **Step 7: Run dock, page, and EnergyHome tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/running-task-dock-state.test.ts src/components/energy/RunningTaskDock.test.tsx src/components/energy/EnergyHome.test.tsx src/pages/AstrologyPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 10**

```bash
git add apps/web-workbench/src/components/energy/running-task-dock-state.ts apps/web-workbench/src/components/energy/running-task-dock-state.test.ts apps/web-workbench/src/components/energy/RunningTaskDock.tsx apps/web-workbench/src/components/energy/RunningTaskDock.test.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/pages/AstrologyPage.tsx apps/web-workbench/src/pages/AstrologyPage.test.tsx
git commit -m "feat(energy): show running task dock"
```

### Task 11: Integrate responsive styling, motion and accessibility gates

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`
- Modify: `apps/web-workbench/src/components/control-tooltip.test.ts`

**Interfaces:**
- Consumes all visible components from Tasks 4, 6, 8, 9, and 10.
- Produces final desktop, mobile, focus, hover and reduced-motion behavior.

- [ ] **Step 1: Add failing CSS contract tests**

```ts
it('contains content-hub layout and reduced-motion overrides', () => {
  expect(css).toContain('.energy-astrology-world');
  expect(css).toContain('.energy-explore-feed');
  expect(css).toContain('.energy-running-task-dock');
  expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
});
```

Add component assertions that tab targets and icon buttons expose accessible names and `title` attributes.

- [ ] **Step 2: Run CSS and tooltip tests and confirm red**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy/energy-css.test.ts src/components/control-tooltip.test.ts src/components/energy/EnergyHome.test.tsx
```

Expected: FAIL on missing selectors and controls.

- [ ] **Step 3: Add desktop layout without changing the first-screen hierarchy**

Use the existing 1180px page width. The astrology world and explore feed span full width below `.energy-insight-grid`; six dimensions use three columns above 900px, two columns from 641–900px, and one column at 640px and below. The task dock uses `position: sticky` inside page flow on desktop and a fixed safe-area-aware bottom bar on mobile.

- [ ] **Step 4: Add short motion and reduced-motion overrides**

Card reveal and feed replacement durations stay between 180–360ms. The reduced-motion block sets animation duration to `0.01ms`, disables transforms, and changes smooth scrolling to immediate behavior through the component media query.

```css
@media (prefers-reduced-motion: reduce) {
  .energy-astrology-world *,
  .energy-explore-feed *,
  .energy-running-task-dock * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Run all frontend energy tests**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx src/lib/astrology.test.ts src/components/control-tooltip.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 11**

```bash
git add apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts apps/web-workbench/src/components/energy/EnergyHome.test.tsx apps/web-workbench/src/components/control-tooltip.test.ts
git commit -m "style(energy): polish content hub interactions"
```

### Task 12: Run release gates and record browser evidence

**Files:**
- Create: `docs/qa/today-energy-content-hub-release-checklist.md`
- Modify only if a gate finds a task-scope defect: files already listed in Tasks 1–11.

**Interfaces:**
- Consumes the completed implementation.
- Produces a reproducible release checklist; it does not merge or deploy.

- [ ] **Step 1: Run orchestrator focused tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/astrology/divine-api-contract.test.ts src/astrology/service.test.ts src/trpc/routers/astrology.test.ts src/trpc/routers/energy.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run orchestrator typecheck and build**

```bash
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
```

Expected: PASS.

- [ ] **Step 3: Run the complete frontend energy gate**

```bash
pnpm --filter @holaday/web-workbench exec vitest run src/components/energy src/pages/AstrologyPage.test.tsx src/lib/astrology.test.ts src/lib/sidebar-feature-nav.test.ts src/components/control-tooltip.test.ts
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench build
```

Expected: PASS. If repository-wide lint reports unrelated pre-existing findings, run ESLint on every touched file, record both outputs, and do not claim the repository-wide gate passed.

- [ ] **Step 4: Run repository hygiene checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status contains only intentional task files before the final verification commit.

- [ ] **Step 5: Verify the authenticated desktop flow in the Codex in-app browser**

Use `/cosmic` at 1440×1024 and the existing test account. Verify:

1. first screen remains bright and uncluttered;
2. summary CTA scrolls to Astrology World;
3. daily, weekly, monthly, yearly tabs work;
4. local content is labelled “Holaday 本地提示” while Translator is unavailable;
5. single card can continue to three cards;
6. five-question test completes and opens a related test;
7. “再来一组” replaces six items without immediate duplicates;
8. a running task transitions to completed without forcing navigation.

- [ ] **Step 6: Verify narrow viewport and reduced motion**

At 390×844 verify one-column cards, scrollable range tabs, uncropped images, no task dock overlap, keyboard focus visibility, and reduced-motion behavior.

- [ ] **Step 7: Record exact evidence and known external blockers**

Create `docs/qa/today-energy-content-hub-release-checklist.md` with:

```md
# 今日能量内容补给站发布检查

- HEAD: 填入 `git rev-parse HEAD` 的原样输出
- DivineAPI production capability snapshot: 记录验证时间、受控探测方式及每项能力的实际状态
- Focused tests: 逐条记录实际命令、退出码和通过数量
- Typecheck: 逐条记录实际命令与结果；失败时粘贴首个相关错误
- Lint: 记录全量结果；若受既有问题阻塞，同时记录触及文件的定向结果
- Build: 逐条记录实际命令、退出码和结果
- Desktop browser: 记录实际 viewport、验证账号类型和八项路径结果
- Mobile browser: 记录实际 viewport、布局、图片裁剪、Dock 和 reduced-motion 结果
- Provider truth cases: 分别记录 success、not-authorized、unavailable 的实际结果
- External blocker: real Chinese DivineAPI text requires Translator activation
- External blocker: real Tarot modes require a Tarot subscription
```

These instruction lines must be replaced with observed values while creating the formal checklist; do not commit words such as “填入”, “记录”, or “实际结果” in the release evidence.

- [ ] **Step 8: Commit Task 12**

```bash
git add docs/qa/today-energy-content-hub-release-checklist.md
git commit -m "docs(energy): record content hub release evidence"
```

## Execution Order and Review Gates

1. Tasks 1–2 are the API truth gate. Do not start UI expansion if `success: 2` can still appear as `divineapi`.
2. Task 3 is the frontend data contract gate. Tasks 4 and 6 may begin only after period-local failures are isolated.
3. Tasks 5–6 form the card-lab gate.
4. Tasks 7–8 form the light-test gate.
5. Task 9 is the retention-content gate.
6. Task 10 is the task-return gate.
7. Task 11 integrates all visible surfaces.
8. Task 12 is evidence only; it does not authorize push, PR creation, merge, deployment, subscription purchase, or production environment changes.
