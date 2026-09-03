# HOLA DAY Qwen Dual-Region Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不切换任何生产调用的千问双区域配置与路由基础层，使后续调用必须显式选择中国大陆或国际区域，并且不能静默跨区降级。

**Architecture:** 新增纯 TypeScript `llm/qwen-route` 模块，接收已解析的环境配置和显式 `cn | intl` 区域，返回内部调用配置及脱敏元数据。`config/env.ts` 只负责声明、默认值和区域 URL 校验；现有 DashScope 媒体变量与运行路径保持不变。本阶段没有数据库字段、网络调用或生产切流。

**Tech Stack:** TypeScript 5.7、Zod 3、Vitest、现有 Anthropic SDK 兼容接口、pnpm workspace、Biome。

**Spec:** `docs/superpowers/specs/2026-09-03-qwen-dual-region-foundation-design.md`

## Global Constraints

- 不新增数据库 migration，不修改账号、组织、支付、积分、股票、媒体、账号关闭或 DivineAPI。
- 不读取、输出、提交或记录任何 API Key 值。
- 不使用 IP、语言、时区、手机号或支付方式推断数据区域。
- 中国大陆配置不得读取或回退到国际 Key、国际 workspace 或国际 Base URL。
- 现有 `DASHSCOPE_API_KEY` 与 `DASHSCOPE_BASE_URL` 的媒体行为保持不变。
- 本阶段不得把任何生产调用切换到千问，不部署。
- 每个生产代码行为必须先有失败测试，并观察正确红态后才实施。

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/orchestrator/src/llm/qwen-route.ts` | 区域、用途、端点验证、凭据选择、模型选择与安全元数据 |
| `apps/orchestrator/src/llm/qwen-route.test.ts` | 无跨区回退、兼容回退、模型映射、URL 与脱敏契约 |
| `apps/orchestrator/src/config/env.ts` | 声明双区域 Key/Base URL/workspace 和模型覆盖变量 |
| `apps/orchestrator/src/config/env.qwen-region.test.ts` | 默认关闭式配置和区域 URL 启动校验 |

---

### Task 1: Pure Regional Route Contract

**Files:**
- Create: `apps/orchestrator/src/llm/qwen-route.test.ts`
- Create: `apps/orchestrator/src/llm/qwen-route.ts`

**Interfaces:**
- Consumes: a plain `QwenRuntimeEnvironment` object; no global environment or network.
- Produces: `ModelDataRegion`, `QwenPurpose`, `QwenRouteError`, `normalizeQwenAnthropicBaseUrl`, `resolveQwenRoute`, `toSafeQwenRouteMetadata`.

- [x] **Step 1: Write the failing route tests**

Create a table-driven test covering these literal outcomes:

```ts
expect(resolveQwenRoute(env, 'intl', 'reasoning')).toMatchObject({
  region: 'intl',
  deploymentScope: 'international',
  model: 'qwen3.8-max',
  apiKey: 'intl-explicit',
  baseURL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
});

expect(resolveQwenRoute({ ...env, DASHSCOPE_INTL_API_KEY: '' }, 'intl', 'fast').apiKey)
  .toBe('legacy-intl');

expect(() => resolveQwenRoute({ ...env, DASHSCOPE_CN_API_KEY: '' }, 'cn', 'standard'))
  .toThrowError(expect.objectContaining({ code: 'MISSING_REGION_CREDENTIALS' }));

expect(resolveQwenRoute(env, 'cn', 'verify')).toMatchObject({
  region: 'cn',
  deploymentScope: 'china_mainland',
  model: 'qwen3.8-flash',
  apiKey: 'cn-explicit',
  baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
});
```

Also assert that wrong-region hosts, HTTP, credentials, query strings, hashes and wrong paths fail, and that `JSON.stringify(toSafeQwenRouteMetadata(route))` contains neither API Key nor workspace value.

- [x] **Step 2: Verify the red state**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/llm/qwen-route.test.ts
```

Expected: FAIL because `qwen-route.ts` does not exist.

- [x] **Step 3: Implement the minimum pure contract**

Implement these exact types and functions:

```ts
export type ModelDataRegion = 'cn' | 'intl';
export type QwenPurpose = 'reasoning' | 'standard' | 'fast' | 'coding' | 'verify';
export type QwenRouteErrorCode =
  | 'REGION_REQUIRED'
  | 'MISSING_REGION_CREDENTIALS'
  | 'INVALID_REGION_ENDPOINT'
  | 'UNKNOWN_PURPOSE';

export function normalizeQwenAnthropicBaseUrl(
  region: ModelDataRegion,
  value: string,
): { baseURL: string; endpointKind: 'public' | 'workspace_dedicated' };

export function resolveQwenRoute(
  environment: QwenRuntimeEnvironment,
  region: ModelDataRegion,
  purpose: QwenPurpose,
): QwenRoute;

export function toSafeQwenRouteMetadata(route: QwenRoute): SafeQwenRouteMetadata;
```

Use an exhaustive `switch` for region and purpose. International credential selection is `DASHSCOPE_INTL_API_KEY || DASHSCOPE_API_KEY`; China selection is only `DASHSCOPE_CN_API_KEY`.

- [x] **Step 4: Verify green and refactor**

Run the same Vitest command and require all tests to pass. Then run:

```bash
pnpm --filter @holaday/orchestrator exec biome check src/llm/qwen-route.ts src/llm/qwen-route.test.ts
```

- [x] **Step 5: Commit Task 1**

```bash
git add apps/orchestrator/src/llm/qwen-route.ts apps/orchestrator/src/llm/qwen-route.test.ts
git commit -m "feat(llm): add qwen regional route contract"
```

### Task 2: Typed Environment Contract

**Files:**
- Create: `apps/orchestrator/src/config/env.qwen-region.test.ts`
- Modify: `apps/orchestrator/src/config/env.ts`

**Interfaces:**
- Consumes: `normalizeQwenAnthropicBaseUrl(region, value)` from Task 1.
- Produces: parsed `Env` fields consumed by `resolveQwenRoute` in the next migration phase.

- [x] **Step 1: Write the failing environment tests**

Assert these defaults from `envSchema.parse(BASE_ENV)`:

```ts
expect(parsed).toMatchObject({
  DASHSCOPE_INTL_API_KEY: '',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: '',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
});
```

Add literal tests proving a Singapore URL in the CN field and a Beijing URL in the INTL field both fail during parsing. Assert an accepted dedicated workspace URL is normalized without a trailing slash.

- [x] **Step 2: Verify the red state**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/config/env.qwen-region.test.ts
```

Expected: FAIL because the new fields are absent.

- [x] **Step 3: Add schema fields and regional super-refinement**

Add optional Key/workspace strings, exact Base URL defaults, and model default strings to `baseEnvSchema`. In `superRefine`, call `normalizeQwenAnthropicBaseUrl` for each regional field and attach errors to the exact field path. In the final transform, replace both Base URL fields with normalized values.

Do not alter `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `DASHSCOPE_WORKSPACE_ID` or their consumers.

- [x] **Step 4: Verify green and surrounding environment tests**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/config/env.qwen-region.test.ts \
  src/config/env.video-editing.test.ts \
  src/config/env.public-origin.test.ts
```

Then run Biome on the touched files.

- [x] **Step 5: Commit Task 2**

```bash
git add apps/orchestrator/src/config/env.ts apps/orchestrator/src/config/env.qwen-region.test.ts
git commit -m "feat(config): define qwen dual-region environment"
```

### Task 3: Foundation Verification and Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-qwen-dual-region-foundation.md`
- Verify: all Task 1 and Task 2 files.

**Interfaces:**
- Consumes: the complete regional route and environment contracts.
- Produces: verified foundation branch and an exact Phase 1 handoff; no production behavior.

- [x] **Step 1: Verify the new contract**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run \
  src/llm/qwen-route.test.ts \
  src/config/env.qwen-region.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm exec biome check \
  apps/orchestrator/src/llm/qwen-route.ts \
  apps/orchestrator/src/llm/qwen-route.test.ts \
  apps/orchestrator/src/config/env.ts \
  apps/orchestrator/src/config/env.qwen-region.test.ts
git diff --check
```

- [x] **Step 2: Verify the complete Orchestrator suite**

Run outside the restrictive network-listen sandbox:

```bash
pnpm --filter @holaday/orchestrator test
```

Expected: the same 369 test files and at least 5832 tests pass, plus the new tests.

- [x] **Step 3: Confirm the no-cutover boundary**

Review `git diff` and verify that no current production call site imports `qwen-route.ts`, no migration exists, and no environment or secret file is changed. Record the next exact action as: add persistent account/organization data-region ownership and a shadow-eval-only adapter before any canary routing.

- [x] **Step 4: Mark the plan ledger and commit documentation**

Replace completed checkboxes with `[x]`, then commit the spec and plan:

```bash
git add docs/superpowers/specs/2026-09-03-qwen-dual-region-foundation-design.md \
  docs/superpowers/plans/2026-09-03-qwen-dual-region-foundation.md
git commit -m "docs(llm): define qwen dual-region foundation"
```

Do not push, create a PR, merge, deploy or request either API Key during this foundation task.
