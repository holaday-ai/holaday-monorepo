# Qwen-only 核心文本与核验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:subagent-driven-development` only after the user explicitly authorizes subagents for that execution turn. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 HOLA DAY 子项目 A 的计划、建议、普通生成、抓取总结、视频剪辑指令规划和语义核验迁移到按区域路由的 Qwen-only 运行时，并让所有未迁移能力显式不可用而不是回退旧供应商。

**Architecture:** 在业务调用点与供应商协议之间增加 `ModelRuntimePolicy`、区域路由和两个中立网关：Messages 负责非流式结构化请求，Responses 负责流式文本与联网工具。所有核心 lane 通过同一个 rollout 决策器和 runtime factory 创建 Qwen 客户端；Anthropic、OpenAI、Gemini 真实客户端移入休眠边界，生产发布契约禁止进入该边界。

**Tech Stack:** TypeScript 5.7、Node.js 22、Vitest、Node test runner、tRPC 11、Drizzle ORM、React 18、Vite、原生 `fetch`/SSE、Alibaba Cloud Model Studio Qwen Messages 与 Responses 兼容协议。

**Spec:** `docs/superpowers/specs/2026-09-04-qwen-only-runtime-design.md`

## Global Constraints

- 生产运行策略只能是 `qwen_only`；`legacy_fixture` 仅限测试，且不得访问真实旧供应商网络。
- 从首次生产切换开始，Anthropic、OpenAI、Gemini 模型网络请求必须为 0；不存在任何旧供应商自动回退。
- 个人任务只使用持久化的用户区域；团队任务只使用持久化的组织区域；不得根据 IP、语言、手机号或时区推断。
- 中国大陆与国际凭据和端点不得交叉；凭据缺失时返回区域服务未配置，不跨区执行。
- 确定性核验先运行且拥有最终下限；Qwen 只能维持或收紧判定，不能把确定性失败升级为通过。
- 模型超时、结构错误或区域不可用时必须显式标记 `unavailable`，不得伪装为模型已通过。
- 新增运行监控不得记录提示词、回复、附件、URL、用户 ID、密钥或供应商原始错误；现有 `llm_calls` 计费归属结构不变。
- 浏览器、图片、视频生成、语音和长期记忆在本子项目中保持 `unavailable_migration`；本计划只迁移视频剪辑的文本指令规划，不迁移媒体生成。
- 不修改 Google OAuth、用户支付、订单、额度、提现、企业奖励、账户关闭、Partner Ledger、`apps/cn-payment` 或 DivineAPI Translator/OpenAI Key。
- 所有功能变更使用 TDD；每项任务先看到指定失败，再写最小实现；每个任务独立提交。

## File Map

### 新建运行时边界

- `apps/orchestrator/src/llm/model-runtime-policy.ts`：生产策略、核心 lane、rollout 模式与显式不可用原因。
- `apps/orchestrator/src/llm/model-runtime-policy.test.ts`：策略、精确白名单、生产拒绝旧策略的单元测试。
- `apps/orchestrator/src/llm/qwen-messages-transport.ts`：不依赖 Anthropic SDK 的 Qwen Messages HTTP transport。
- `apps/orchestrator/src/llm/qwen-messages-transport.test.ts`：Messages 请求、响应、超时与脱敏测试。
- `apps/orchestrator/src/llm/responses-adapter.ts`：Qwen Responses 流式文本、工具事件、来源和 usage 的中立协议。
- `apps/orchestrator/src/llm/responses-adapter.test.ts`：分片 SSE、来源、取消、错误与隐私测试。
- `apps/orchestrator/src/llm/core-model-runtime.ts`：组合策略、lane access、区域路由和网关工厂。
- `apps/orchestrator/src/llm/core-model-runtime.test.ts`：Qwen-only 工厂与 fail-closed 行为。
- `apps/orchestrator/src/llm/model-runtime-wiring.ts`：生产入口只接受 Qwen 工厂的依赖接线。
- `apps/orchestrator/src/llm/model-runtime-wiring.test.ts`：阻止旧模型客户端进入生产 wiring。
- `apps/orchestrator/src/llm/model-data-region-assignment.ts`：个人和组织区域的一次性 compare-and-set。
- `apps/orchestrator/src/llm/model-data-region-assignment.test.ts`：幂等、冲突与组织权限测试。
- `apps/orchestrator/src/llm/dormant/anthropic-messages-adapter.ts`：旧 Anthropic Messages 实现，仅供 fixture 测试。

### 新建前端区域体验

- `apps/web-workbench/src/lib/model-data-region-state.ts`：区域显示文案、任务提交门禁和错误映射。
- `apps/web-workbench/src/lib/model-data-region-state.test.ts`：纯状态测试。
- `apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.ts`：保存并在区域确认后只重放一次完整任务提交。
- `apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.test.tsx`：草稿、附件、模式、技能选择和重复确认测试。
- `apps/web-workbench/src/components/settings/ModelDataRegionSection.tsx`：设置页的一次性区域选择。
- `apps/web-workbench/src/components/settings/ModelDataRegionSection.test.tsx`：选择、确认、幂等和冲突交互测试。
- `apps/web-workbench/src/components/ModelDataRegionDialog.tsx`：首次任务提交前的区域选择对话框。
- `apps/web-workbench/src/components/ModelDataRegionDialog.test.tsx`：草稿保留与成功后继续提交测试。

### 新建发布门禁

- `apps/orchestrator/scripts/qwen-only-release-contract.mjs`：扫描生产入口中的旧 SDK 实例、旧模型 URL 与旧 provider 路由。
- `apps/orchestrator/scripts/qwen-only-release-contract.test.mjs`：允许休眠 fixture、拒绝生产调用的测试。
- `apps/orchestrator/scripts/fixtures/qwen-legacy-migration-inventory.json`：冻结尚未迁移的 B/C/D 旧模型模式路径与数量。
- `scripts/qwen-core-production-preflight.mjs`：只读生产前置检查，输出布尔值与聚合计数。
- `scripts/qwen-core-production-preflight.test.mjs`：缺配置、跨区和意外旧 provider 的测试。
- `docs/runbooks/qwen-core-rollout.md`：暗发布、canary、扩大、回滚和生产验证命令。

---

### Task 1: 锁定 Qwen-only 运行策略与核心 lane rollout

**Files:**
- Create: `apps/orchestrator/src/llm/model-runtime-policy.ts`
- Create: `apps/orchestrator/src/llm/model-runtime-policy.test.ts`
- Modify: `apps/orchestrator/src/config/env.ts`
- Modify: `apps/orchestrator/src/config/env.qwen-region.test.ts`

**Interfaces:**
- Produces: `ModelRuntimePolicy = 'qwen_only' | 'legacy_fixture'`
- Produces: `CoreModelLane = 'suggestions' | 'plan' | 'generate' | 'scrape' | 'video_edit_planner' | 'verifier'`
- Produces: `resolveCoreModelLaneAccess(input): CoreModelLaneAccess`
- Produces: `UnmigratedModelLane = 'browser' | 'image' | 'video_generation' | 'voice' | 'memory'`
- Produces: `resolveUnmigratedModelLane(lane): { kind: 'unavailable'; reason: 'MIGRATION_IN_PROGRESS' }`
- Produces: `assertProductionModelRuntimePolicy(nodeEnv, policy): void`

- [ ] **Step 1: Write failing policy and environment tests**

```ts
it('rejects legacy_fixture in production', () => {
  expect(() => assertProductionModelRuntimePolicy('production', 'legacy_fixture')).toThrow(
    'MODEL_RUNTIME_POLICY must be qwen_only in production',
  );
});

it('requires an exact allowlist match in synthetic mode', () => {
  expect(resolveCoreModelLaneAccess({
    mode: 'synthetic',
    enabledLanes: 'generate,scrape',
    allowlist: 'usr_alpha,usr_beta',
    actorExternalId: 'usr_al',
    lane: 'generate',
  })).toEqual({ kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
});

it('marks media and browser lanes outside subproject A as migration unavailable', () => {
  expect(resolveUnmigratedModelLane('browser')).toEqual({
    kind: 'unavailable',
    reason: 'MIGRATION_IN_PROGRESS',
  });
});
```

- [ ] **Step 2: Run the focused tests and verify the missing module failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-runtime-policy.test.ts src/config/env.qwen-region.test.ts`

Expected: FAIL because `model-runtime-policy.ts` and the new environment fields do not exist.

- [ ] **Step 3: Implement the exact policy types and parser**

```ts
export const CORE_MODEL_LANES = [
  'suggestions',
  'plan',
  'generate',
  'scrape',
  'video_edit_planner',
  'verifier',
] as const;
export type CoreModelLane = (typeof CORE_MODEL_LANES)[number];
export type CoreRolloutMode = 'off' | 'synthetic' | 'internal' | 'all';
export type CoreModelLaneAccess =
  | { kind: 'enabled' }
  | { kind: 'unavailable'; reason: 'LANE_DISABLED' | 'ROLLOUT_NOT_ALLOWED' };

export function resolveCoreModelLaneAccess(input: {
  mode: CoreRolloutMode;
  enabledLanes: string;
  allowlist: string;
  actorExternalId: string;
  lane: CoreModelLane;
}): CoreModelLaneAccess {
  const lanes = new Set(input.enabledLanes.split(',').map((v) => v.trim()).filter(Boolean));
  if (!lanes.has(input.lane) || input.mode === 'off') {
    return { kind: 'unavailable', reason: 'LANE_DISABLED' };
  }
  if (input.mode === 'all') return { kind: 'enabled' };
  const actors = new Set(input.allowlist.split(',').map((v) => v.trim()).filter(Boolean));
  return actors.has(input.actorExternalId)
    ? { kind: 'enabled' }
    : { kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' };
}
```

Add these environment fields with fail-closed defaults:

```ts
MODEL_RUNTIME_POLICY: z.enum(['qwen_only', 'legacy_fixture']).default('qwen_only'),
QWEN_CORE_ROLLOUT_MODE: z.enum(['off', 'synthetic', 'internal', 'all']).default('off'),
QWEN_CORE_ENABLED_LANES: z.string().default(''),
QWEN_CORE_ALLOWLIST: z.string().default(''),
QWEN_RESPONSES_ADAPTER_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
```

Call `assertProductionModelRuntimePolicy` immediately after `envSchema.parse` and reject unknown lane tokens during parsing.

- [ ] **Step 4: Run policy and environment tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-runtime-policy.test.ts src/config/env.qwen-region.test.ts`

Expected: PASS, including production rejection, empty allowlist fail-closed, exact matching, per-lane disable and `all` mode.

- [ ] **Step 5: Commit the policy boundary**

```bash
git add apps/orchestrator/src/llm/model-runtime-policy.ts apps/orchestrator/src/llm/model-runtime-policy.test.ts apps/orchestrator/src/config/env.ts apps/orchestrator/src/config/env.qwen-region.test.ts
git commit -m "feat(llm): enforce Qwen-only runtime policy"
```

### Task 2: 扩展双区域、双协议 Qwen 路由

**Files:**
- Modify: `apps/orchestrator/src/llm/qwen-route.ts`
- Modify: `apps/orchestrator/src/llm/qwen-route.test.ts`
- Modify: `apps/orchestrator/src/config/env.ts`
- Modify: `apps/orchestrator/src/config/env.qwen-region.test.ts`

**Interfaces:**
- Produces: `QwenProtocol = 'messages' | 'responses'`
- Produces: `QwenPurpose = 'reasoning' | 'standard' | 'fast' | 'coding' | 'verify_fast' | 'verify_strict' | 'vision'`
- Produces: `resolveQwenRoute(environment, region, purpose, protocol): QwenRoute`
- Produces: `QwenRoute.endpointKind` and `QwenRoute.protocol`

- [ ] **Step 1: Add failing protocol, purpose and cross-region tests**

```ts
it('builds a Singapore Responses route without exposing credentials', () => {
  const route = resolveQwenRoute(ENV, 'intl', 'reasoning', 'responses');
  expect(route.baseURL).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  expect(toSafeQwenRouteMetadata(route)).toEqual({
    provider: 'alibaba-model-studio',
    region: 'intl',
    deploymentScope: 'international',
    model: 'qwen3.8-max',
    endpointKind: 'public',
    protocol: 'responses',
  });
});

it('rejects a Beijing URL in the international Responses field', () => {
  expect(() => normalizeQwenBaseUrl(
    'intl',
    'responses',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  )).toThrowError(expect.objectContaining({ code: 'INVALID_REGION_ENDPOINT' }));
});
```

- [ ] **Step 2: Run route tests and verify they fail on the old signature**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/qwen-route.test.ts src/config/env.qwen-region.test.ts`

Expected: FAIL because Responses endpoints, protocol metadata, `verify_fast`, `verify_strict` and `vision` are absent.

- [ ] **Step 3: Implement protocol-aware route normalization**

Add exact defaults:

```ts
DASHSCOPE_INTL_RESPONSES_BASE_URL: z.string().url().default(
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
),
DASHSCOPE_CN_RESPONSES_BASE_URL: z.string().url().default(
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
),
QWEN_VERIFY_FAST_MODEL: z.string().min(1).default('qwen3.8-flash'),
QWEN_VERIFY_STRICT_MODEL: z.string().min(1).default('qwen3.8-max'),
QWEN_VISION_MODEL: z.string().min(1).default('qwen3.8-max'),
```

Accept only `/apps/anthropic` for `messages` and `/compatible-mode/v1` for `responses`. For dedicated domains require `.cn-beijing.maas.aliyuncs.com` in `cn` and `.ap-southeast-1.maas.aliyuncs.com` in `intl`. Keep the API key and workspace ID out of `toSafeQwenRouteMetadata`.

- [ ] **Step 4: Run route tests and Qwen benchmark contract tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/qwen-route.test.ts src/config/env.qwen-region.test.ts`

Run: `pnpm --filter @holaday/orchestrator exec node --test scripts/qwen-synthetic-benchmark.test.mjs scripts/qwen-runtime-benchmark.test.mjs`

Expected: PASS; no existing international benchmark changes its endpoint or credential fallback semantics.

- [ ] **Step 5: Commit protocol-aware routing**

```bash
git add apps/orchestrator/src/llm/qwen-route.ts apps/orchestrator/src/llm/qwen-route.test.ts apps/orchestrator/src/config/env.ts apps/orchestrator/src/config/env.qwen-region.test.ts
git commit -m "feat(llm): route Qwen protocols by data region"
```

### Task 3: 将 Qwen Messages transport 与 Anthropic SDK 解耦

**Files:**
- Create: `apps/orchestrator/src/llm/qwen-messages-transport.ts`
- Create: `apps/orchestrator/src/llm/qwen-messages-transport.test.ts`
- Create: `apps/orchestrator/src/llm/dormant/anthropic-messages-adapter.ts`
- Modify: `apps/orchestrator/src/llm/messages-adapter.ts`
- Modify: `apps/orchestrator/src/llm/messages-adapter.test.ts`

**Interfaces:**
- Consumes: `QwenRoute` from Task 2.
- Produces: `createQwenMessagesTransport(input): AnthropicCompatibleClient`
- Produces: `QwenTransportError` with safe `code`, HTTP `status` and no provider response body.
- Preserves: `MessagesAdapter.create(request, options): Promise<NeutralMessagesResponse>`

- [ ] **Step 1: Add failing tests for HTTP mapping and safe failures**

```ts
it('posts only to the resolved Qwen Messages endpoint', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
    id: 'msg_qwen',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 2, output_tokens: 1 },
  }), { status: 200 }));
  const transport = createQwenMessagesTransport({ route: INTL_ROUTE, fetchImpl });
  await transport.messages.create({ model: 'qwen3.8-flash', max_tokens: 32, messages: [] });
  expect(fetchImpl).toHaveBeenCalledWith(
    'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages',
    expect.objectContaining({ method: 'POST' }),
  );
});

it('never includes provider response bodies in normalized errors', async () => {
  const transport = createQwenMessagesTransport({
    route: INTL_ROUTE,
    fetchImpl: vi.fn(async () => new Response('private provider body', { status: 500 })),
  });
  await expect(transport.messages.create(REQUEST)).rejects.not.toThrow(/private provider body/);
});
```

- [ ] **Step 2: Run transport and adapter tests and verify failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/qwen-messages-transport.test.ts src/llm/messages-adapter.test.ts`

Expected: FAIL because Qwen still constructs `new Anthropic()` and the transport module is absent.

- [ ] **Step 3: Implement the fetch transport and move real Anthropic construction**

The Qwen transport must:

```ts
return {
  messages: {
    async create(request, options) {
      const response = await fetchImpl(`${route.baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': route.apiKey,
          ...(route.workspaceId ? { 'x-dashscope-workspace': route.workspaceId } : {}),
        },
        body: JSON.stringify(request),
        signal: options?.signal,
      });
      if (!response.ok) throw new QwenTransportError(response.status);
      return response.json();
    },
  },
};
```

Implement the existing timeout and `maxRetries` contract explicitly: zero retries when `maxRetries: 0`, exponential retry only for 429/502/503/504, and one shared abort signal. Move `createAnthropicMessagesAdapter` and its SDK import into `llm/dormant/anthropic-messages-adapter.ts`; production modules must import only neutral types and Qwen factories.

- [ ] **Step 4: Run the adapter suites**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/qwen-messages-transport.test.ts src/llm/messages-adapter.test.ts`

Expected: PASS for text, image, function calling, forced tool, usage, abort, timeout, malformed JSON and provider-body redaction.

- [ ] **Step 5: Commit the Messages boundary**

```bash
git add apps/orchestrator/src/llm/qwen-messages-transport.ts apps/orchestrator/src/llm/qwen-messages-transport.test.ts apps/orchestrator/src/llm/messages-adapter.ts apps/orchestrator/src/llm/messages-adapter.test.ts apps/orchestrator/src/llm/dormant/anthropic-messages-adapter.ts
git commit -m "refactor(llm): isolate Qwen Messages transport"
```

### Task 4: 实现 Qwen Responses 流式与来源网关

**Files:**
- Create: `apps/orchestrator/src/llm/responses-adapter.ts`
- Create: `apps/orchestrator/src/llm/responses-adapter.test.ts`

**Interfaces:**
- Consumes: a Task 2 `QwenRoute` with `protocol: 'responses'`.
- Produces: `ResponsesAdapter.stream(request, options): Promise<NeutralResponsesResult>`
- Produces: `NeutralResponseSource = { title: string; url: string; provenance: 'web_search' }`
- Produces: `NeutralResponsesResult = { id: string; metadata: SafeQwenRouteMetadata; text: string; sources: NeutralResponseSource[]; usage: { inputTokens: number; outputTokens: number }; status: 'completed' }`

- [ ] **Step 1: Write failing fragmented-SSE and source-provenance tests**

```ts
it('joins fragmented output_text deltas and extracts only tool sources', async () => {
  const adapter = createQwenResponsesAdapter({ route: INTL_RESPONSES_ROUTE, fetchImpl });
  const result = await adapter.stream(
    { input: [{ role: 'user', content: '今天的市场新闻' }], tools: [{ type: 'web_search' }] },
    { onTextDelta },
  );
  expect(result.text).toBe('市场摘要');
  expect(onTextDelta.mock.calls.flat()).toEqual(['市场', '摘要']);
  expect(result.sources).toEqual([
    { title: '交易所公告', url: 'https://example.com/exchange', provenance: 'web_search' },
  ]);
  expect(result.sources).not.toContainEqual(expect.objectContaining({ url: 'https://invented.test' }));
});
```

Use a fixture containing `response.output_text.delta`, then `response.completed` with `output[].type='web_search_call'` and `action.sources`; put `https://invented.test` only inside generated prose.

- [ ] **Step 2: Run the Responses test and verify the missing module failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/responses-adapter.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the neutral request, SSE parser and result schema**

```ts
export interface ResponsesAdapter {
  readonly metadata: SafeQwenRouteMetadata;
  stream(
    request: NeutralResponsesRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number; onTextDelta?: (delta: string) => void },
  ): Promise<NeutralResponsesResult>;
}

export type NeutralBuiltinTool =
  | { type: 'web_search' }
  | { type: 'web_extractor' }
  | { type: 'code_interpreter' };
```

POST `${route.baseURL}/responses` with `Authorization: Bearer`, `stream: true`, `store: false`, the route model and only whitelisted request fields. Parse SSE across arbitrary byte boundaries. Accept text only from `response.output_text.delta`; accept sources only from `response.completed.response.output[].action.sources`. Normalize all external failures to `REQUEST_ABORTED | REQUEST_TIMEOUT | INVALID_RESPONSE | PROVIDER_ERROR` without body text.

- [ ] **Step 4: Run Responses tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/responses-adapter.test.ts`

Expected: PASS for split UTF-8 chunks, multiple `data:` events per chunk, duplicate URL removal, HTTP/HTTPS filtering, timeout, user cancel, missing completion, usage extraction and callback exceptions.

- [ ] **Step 5: Commit the Responses gateway**

```bash
git add apps/orchestrator/src/llm/responses-adapter.ts apps/orchestrator/src/llm/responses-adapter.test.ts
git commit -m "feat(llm): add Qwen Responses streaming gateway"
```

### Task 5: 组合可信的核心模型 runtime factory

**Files:**
- Create: `apps/orchestrator/src/llm/core-model-runtime.ts`
- Create: `apps/orchestrator/src/llm/core-model-runtime.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 policy, lane, region, Messages and Responses factories.
- Produces: `resolveCoreModelRuntime(input): CoreModelRuntimeResolution`
- Produces: `CoreModelRuntimeResolution = { kind: 'ready'; region; messages(purpose); responses(purpose) } | { kind: 'unavailable'; reason }`

- [ ] **Step 1: Write failing factory tests**

```ts
it('does not construct a transport before policy, lane and region all pass', () => {
  const createMessages = vi.fn();
  const result = resolveCoreModelRuntime({
    environment: ENV,
    actorExternalId: 'usr_outside',
    lane: 'generate',
    ownership: { scope: 'personal', userRegion: 'intl' },
    createMessages,
    createResponses: vi.fn(),
  });
  expect(result).toEqual({ kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
  expect(createMessages).not.toHaveBeenCalled();
});

it('never tries the other region when the selected region lacks credentials', () => {
  expect(resolveCoreModelRuntime(CN_WITH_ONLY_INTL_KEY)).toEqual({
    kind: 'unavailable',
    reason: 'REGION_SERVICE_NOT_CONFIGURED',
  });
});
```

- [ ] **Step 2: Run the factory test and verify failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/core-model-runtime.test.ts`

Expected: FAIL because `resolveCoreModelRuntime` does not exist.

- [ ] **Step 3: Implement fail-closed construction**

```ts
export function resolveCoreModelRuntime(input: CoreModelRuntimeInput): CoreModelRuntimeResolution {
  assertProductionModelRuntimePolicy(input.environment.NODE_ENV, input.environment.MODEL_RUNTIME_POLICY);
  const access = resolveCoreModelLaneAccess({
    mode: input.environment.QWEN_CORE_ROLLOUT_MODE,
    enabledLanes: input.environment.QWEN_CORE_ENABLED_LANES,
    allowlist: input.environment.QWEN_CORE_ALLOWLIST,
    actorExternalId: input.actorExternalId,
    lane: input.lane,
  });
  if (access.kind === 'unavailable') return access;
  let ownership: ModelDataRegionOwnership;
  try {
    ownership = resolveModelDataRegionOwnership(input.ownership);
  } catch (error) {
    if (error instanceof ModelDataRegionError) {
      return { kind: 'unavailable', reason: 'MODEL_DATA_REGION_UNASSIGNED' };
    }
    throw error;
  }
  return createReadyQwenRuntime(input, ownership.region);
}
```

Map `QwenRouteError('MISSING_REGION_CREDENTIALS')` to `REGION_SERVICE_NOT_CONFIGURED`; do not catch programmer errors. Expose only safe metadata to callers. Each ready adapter call must produce one bounded observation containing only provider, region, deployment scope, purpose, model, outcome, token counts and latency. Do not change `llm-call-recorder.ts`, model pricing, user charges, quota mutation or Partner Ledger in this task; per-task result metadata and the sanitized operational observation provide the subproject A audit trail without changing billing semantics.

- [ ] **Step 4: Run the factory and route tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/core-model-runtime.test.ts src/llm/model-runtime-policy.test.ts src/llm/qwen-route.test.ts`

Expected: PASS with zero factory calls for every unavailable case.

- [ ] **Step 5: Commit the runtime factory**

```bash
git add apps/orchestrator/src/llm/core-model-runtime.ts apps/orchestrator/src/llm/core-model-runtime.test.ts
git commit -m "feat(llm): compose regional Qwen core runtime"
```

### Task 6: 增加个人与组织区域的一次性持久化 API

**Files:**
- Create: `apps/orchestrator/src/llm/model-data-region-assignment.ts`
- Create: `apps/orchestrator/src/llm/model-data-region-assignment.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/auth.ts`
- Create: `apps/orchestrator/src/trpc/routers/auth.model-data-region.test.ts`
- Modify: `apps/orchestrator/src/organizations/organization-service.ts`
- Modify: `apps/orchestrator/src/organizations/organization-service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/organizations.ts`
- Modify: `apps/orchestrator/src/trpc/routers/organizations.test.ts`

**Interfaces:**
- Produces: `assignPersonalModelDataRegion(input): Promise<{ region; changed }>`
- Produces: `assignOrganizationModelDataRegion(input): Promise<{ region; changed }>`
- Produces: `auth.assignModelDataRegion({ region })`
- Produces: `organizations.assignModelDataRegion({ organizationId, region })`
- Extends: `auth.me.modelDataRegion` and `organizations.list[].modelDataRegion`

- [ ] **Step 1: Write failing compare-and-set and permission tests**

```ts
it('sets a null personal region exactly once and treats the same value as idempotent', async () => {
  await expect(assignPersonalModelDataRegion({ db, actorExternalId: 'usr_a', region: 'cn' }))
    .resolves.toEqual({ region: 'cn', changed: true });
  await expect(assignPersonalModelDataRegion({ db, actorExternalId: 'usr_a', region: 'cn' }))
    .resolves.toEqual({ region: 'cn', changed: false });
});

it('rejects a different second value without changing the row', async () => {
  await expect(assignPersonalModelDataRegion({ db, actorExternalId: 'usr_a', region: 'intl' }))
    .rejects.toMatchObject({ code: 'REGION_ALREADY_ASSIGNED' });
});

it.each(['manager', 'member'])('does not let %s assign the organization region', async (role) => {
  await expect(assignOrganizationModelDataRegion(organizationInput(role)))
    .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
});
```

- [ ] **Step 2: Run the domain and router tests and verify failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-data-region-assignment.test.ts src/trpc/routers/auth.model-data-region.test.ts src/organizations/organization-service.test.ts src/trpc/routers/organizations.test.ts`

Expected: FAIL because mutations and return fields are absent.

- [ ] **Step 3: Implement atomic assignment and tRPC error mapping**

Use one transaction and an update constrained by both identity and `IS NULL`. After an affected-row count of zero, re-read the row: same region returns `{ changed: false }`; a different region raises `REGION_ALREADY_ASSIGNED`; missing or inactive actor raises the existing not-found error. Organization assignment requires an active owner or admin membership.

```ts
assignModelDataRegion: protectedProcedure
  .input(z.object({ region: z.enum(['cn', 'intl']) }))
  .mutation(({ ctx, input }) => assignPersonalModelDataRegion({
    db: ctx.db,
    actorExternalId: ctx.userId,
    region: input.region,
  })),
```

Map an attempted region change to tRPC `CONFLICT`; never accept a force flag.

- [ ] **Step 4: Run assignment and schema tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-data-region-assignment.test.ts src/trpc/routers/auth.model-data-region.test.ts src/organizations/organization-service.test.ts src/trpc/routers/organizations.test.ts src/db/schema/model-data-regions.test.ts`

Expected: PASS; no new migration is created because the nullable columns already exist.

- [ ] **Step 5: Commit the region assignment API**

```bash
git add apps/orchestrator/src/llm/model-data-region-assignment.ts apps/orchestrator/src/llm/model-data-region-assignment.test.ts apps/orchestrator/src/trpc/routers/auth.ts apps/orchestrator/src/trpc/routers/auth.model-data-region.test.ts apps/orchestrator/src/organizations/organization-service.ts apps/orchestrator/src/organizations/organization-service.test.ts apps/orchestrator/src/trpc/routers/organizations.ts apps/orchestrator/src/trpc/routers/organizations.test.ts
git commit -m "feat(llm): add one-time model data region assignment"
```

### Task 7: 在设置页与首次任务提交前完成区域选择体验

**Files:**
- Create: `apps/web-workbench/src/lib/model-data-region-state.ts`
- Create: `apps/web-workbench/src/lib/model-data-region-state.test.ts`
- Create: `apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.ts`
- Create: `apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.test.tsx`
- Create: `apps/web-workbench/src/components/settings/ModelDataRegionSection.tsx`
- Create: `apps/web-workbench/src/components/settings/ModelDataRegionSection.test.tsx`
- Create: `apps/web-workbench/src/components/ModelDataRegionDialog.tsx`
- Create: `apps/web-workbench/src/components/ModelDataRegionDialog.test.tsx`
- Modify: `apps/web-workbench/src/lib/auth-me-state.ts`
- Modify: `apps/web-workbench/src/lib/auth-me-state.test.ts`
- Modify: `apps/web-workbench/src/pages/SettingsPage.tsx`
- Modify: `apps/web-workbench/src/lib/settings-sections.ts`
- Modify: `apps/web-workbench/src/lib/settings-sections.test.ts`
- Modify: `apps/web-workbench/src/components/AppShell.tsx`
- Modify: `apps/web-workbench/src/WorkbenchApp.tsx`

**Interfaces:**
- Consumes: Task 6 `auth.me.modelDataRegion` and `auth.assignModelDataRegion`.
- Produces: `modelTaskSubmitDecision(region): 'submit' | 'choose_region'`
- Produces: `useRegionGatedTaskSubmit({ region, assignRegion, refreshMe, submit })`, which owns one exact pending task payload and replays it once after assignment.
- Extends: `OutletContext.refreshMe(): Promise<NormalizedAuthMeProfile | null>`

- [ ] **Step 1: Write failing state and interaction tests**

```ts
it('parks the exact draft until region selection succeeds', async () => {
  const { result } = renderHook(() => useRegionGatedTaskSubmit({
    region: null,
    assignRegion,
    refreshMe,
    submit,
  }));
  const payload = {
    intent: '分析这份市场报告',
    fileIds: ['file_1'],
    mode: 'fast',
    expertMode: false,
    skillSelection: { skillId: 'research' },
  };
  await act(() => result.current.requestSubmit(payload));
  expect(result.current.dialogOpen).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  await act(() => result.current.confirmRegion('intl'));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith(payload);
});

it('does not offer an inline switch after a region is assigned', () => {
  render(<ModelDataRegionSection region="cn" onAssign={vi.fn()} />);
  expect(screen.getByText('中国大陆')).toBeVisible();
  expect(screen.queryByRole('button', { name: /更改/ })).toBeNull();
});
```

- [ ] **Step 2: Run frontend tests and verify missing components**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/model-data-region-state.test.ts src/hooks/useRegionGatedTaskSubmit.test.tsx src/components/settings/ModelDataRegionSection.test.tsx src/components/ModelDataRegionDialog.test.tsx src/lib/auth-me-state.test.ts`

Expected: FAIL because the region state and components are absent.

- [ ] **Step 3: Implement accessible copy and submit continuation**

Use these exact primary explanations:

```ts
export const MODEL_DATA_REGION_COPY = {
  cn: { label: '中国大陆', description: '任务内容由中国大陆区域的千问服务处理。' },
  intl: { label: '国际', description: '任务内容由新加坡区域的千问服务处理。' },
} as const;
```

The dialog must state that the choice controls where model tasks are processed and cannot be changed directly after model data is created. `useRegionGatedTaskSubmit` preserves intent, attachments, mode, expert mode and skill selection in an in-memory pending-submit object; after mutation and `refreshMe`, it clears the pending slot before replaying that object once. Closing the dialog keeps the composer draft and does not submit. Repeated confirm clicks while assignment is pending are ignored.

- [ ] **Step 4: Run frontend focused tests, lint and typecheck**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/model-data-region-state.test.ts src/hooks/useRegionGatedTaskSubmit.test.tsx src/components/settings/ModelDataRegionSection.test.tsx src/components/ModelDataRegionDialog.test.tsx src/lib/auth-me-state.test.ts src/lib/settings-sections.test.ts`

Run: `pnpm --filter @holaday/web-workbench lint`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; keyboard focus remains trapped in the dialog, Escape cancels without losing the draft, and disabled submit state is explained.

- [ ] **Step 5: Commit the region UX**

```bash
git add apps/web-workbench/src/lib/model-data-region-state.ts apps/web-workbench/src/lib/model-data-region-state.test.ts apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.ts apps/web-workbench/src/hooks/useRegionGatedTaskSubmit.test.tsx apps/web-workbench/src/components/settings/ModelDataRegionSection.tsx apps/web-workbench/src/components/settings/ModelDataRegionSection.test.tsx apps/web-workbench/src/components/ModelDataRegionDialog.tsx apps/web-workbench/src/components/ModelDataRegionDialog.test.tsx apps/web-workbench/src/lib/auth-me-state.ts apps/web-workbench/src/lib/auth-me-state.test.ts apps/web-workbench/src/pages/SettingsPage.tsx apps/web-workbench/src/lib/settings-sections.ts apps/web-workbench/src/lib/settings-sections.test.ts apps/web-workbench/src/components/AppShell.tsx apps/web-workbench/src/WorkbenchApp.tsx
git commit -m "feat(web): require model data region before tasks"
```

### Task 8: 迁移计划与完成后建议 lane

**Files:**
- Modify: `apps/orchestrator/src/agent/suggestions-provider.ts`
- Modify: `apps/orchestrator/src/agent/suggestions-provider.test.ts`
- Modify: `apps/orchestrator/src/agent/suggestions-generator.ts`
- Modify: `apps/orchestrator/src/agent/suggestions-generator.test.ts`
- Modify: `apps/orchestrator/src/agent/supercar/plan-provider.ts`
- Modify: `apps/orchestrator/src/agent/supercar/plan-provider.test.ts`
- Modify: `apps/orchestrator/src/agent/supercar/plan-runner.ts`
- Modify: `apps/orchestrator/src/agent/supercar/plan-runner.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`

**Interfaces:**
- Consumes: Task 5 `resolveCoreModelRuntime`.
- Produces: provider routes with only `qwen | unavailable`; no `anthropic` variant.
- Preserves: `generateSuggestions` and plan JSON schemas.

- [ ] **Step 1: Replace old fallback expectations with failing Qwen-only tests**

```ts
it('never returns Anthropic when the Qwen rollout excludes the actor', () => {
  expect(resolveSuggestionsProviderRoute(EXCLUDED_ACTOR)).toEqual({
    provider: 'unavailable',
    reason: 'ROLLOUT_NOT_ALLOWED',
  });
});

it('uses standard Qwen Messages for plans and fast Qwen Messages for suggestions', async () => {
  await runPlan(READY_RUNTIME);
  await runSuggestions(READY_RUNTIME);
  expect(READY_RUNTIME.messages).toHaveBeenNthCalledWith(1, 'standard');
  expect(READY_RUNTIME.messages).toHaveBeenNthCalledWith(2, 'fast');
});
```

- [ ] **Step 2: Run focused lane tests and verify old Anthropic expectations fail**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/suggestions-provider.test.ts src/agent/suggestions-generator.test.ts src/agent/supercar/plan-provider.test.ts src/agent/supercar/plan-runner.test.ts`

Expected: FAIL on removed Anthropic routes and clients.

- [ ] **Step 3: Implement Qwen-only route unions and neutral adapters**

Remove `SUGGESTIONS_ANTHROPIC_MODEL`, `PLAN_ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY` from provider environments and all `createAnthropicMessagesAdapter` calls. Return explicit unavailable reasons from the shared runtime factory. Keep existing schema validation; empty or malformed model responses remain non-fatal for suggestions and fail closed for plans according to their existing contracts.

- [ ] **Step 4: Run the four lane suites and task router typecheck**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/suggestions-provider.test.ts src/agent/suggestions-generator.test.ts src/agent/supercar/plan-provider.test.ts src/agent/supercar/plan-runner.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS and no production import of the dormant Anthropic factory.

- [ ] **Step 5: Commit plan and suggestion migration**

```bash
git add apps/orchestrator/src/agent/suggestions-provider.ts apps/orchestrator/src/agent/suggestions-provider.test.ts apps/orchestrator/src/agent/suggestions-generator.ts apps/orchestrator/src/agent/suggestions-generator.test.ts apps/orchestrator/src/agent/supercar/plan-provider.ts apps/orchestrator/src/agent/supercar/plan-provider.test.ts apps/orchestrator/src/agent/supercar/plan-runner.ts apps/orchestrator/src/agent/supercar/plan-runner.test.ts apps/orchestrator/src/trpc/routers/tasks.ts
git commit -m "feat(agent): move plans and suggestions to Qwen"
```

### Task 9: 迁移普通生成、附件、流式输出与新鲜度搜索

**Files:**
- Modify: `apps/orchestrator/src/agent/generate-runner.ts`
- Modify: `apps/orchestrator/src/agent/generate-runner.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-attachment-availability.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.skill-selection.test.ts`

**Interfaces:**
- Consumes: Task 4 `ResponsesAdapter` and Task 5 core runtime.
- Changes: `RunGenerateOpts.client` to `RunGenerateOpts.responsesAdapter`.
- Preserves: `GenerateOutcome`, `onStreamDelta`, expert workflow intake and attachment behavior.

- [ ] **Step 1: Write failing neutral-runner tests**

```ts
it('requires web tools for fresh research and accepts sources only from the adapter', async () => {
  const responsesAdapter = makeResponsesAdapter({
    text: '今日摘要',
    sources: [{ title: '公告', url: 'https://example.com/a', provenance: 'web_search' }],
  });
  const outcome = await runGenerateTask({
    taskId: 'tsk_fresh', userId: 'usr_test', intent: '今天 A 股有哪些重要公告？',
    responsesAdapter, logger: makeLogger(),
  });
  expect(responsesAdapter.stream).toHaveBeenCalledWith(
    expect.objectContaining({
      tools: [{ type: 'web_search' }, { type: 'web_extractor' }, { type: 'code_interpreter' }],
    }),
    expect.any(Object),
  );
  expect(outcome.sourceUrls).toEqual(['https://example.com/a']);
});

it('returns a clear failure when a fresh request completes without observed sources', async () => {
  const outcome = await runGenerateTask(FRESH_REQUEST_WITHOUT_TOOL_SOURCES);
  expect(outcome).toMatchObject({ status: 'failed', reason: '未取得可核验的最新来源，请稍后重试。' });
});
```

- [ ] **Step 2: Run generate tests and verify old client assumptions fail**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/generate-runner.test.ts src/trpc/routers/tasks-attachment-availability.test.ts src/trpc/routers/tasks.skill-selection.test.ts`

Expected: FAIL because `runGenerateTask` still requires an Anthropic streaming client.

- [ ] **Step 3: Replace SDK-specific streaming with `ResponsesAdapter.stream`**

Map attachments to Responses input blocks before calling the adapter. Keep deterministic lightweight answers at zero model calls. Use no tools for lightweight and static writing tasks; use the three built-ins only when `requiresFreshResearch(intent)` is true. On stream completion, append only adapter-provided sources, require at least one observed source for freshness requests, and return normalized Chinese errors without the provider message.

Replace hard-coded result metadata `model: 'claude-sonnet-4-6'` with safe adapter metadata `{ provider, model, region, deploymentScope }`; remove `modelFinalText` from logs and persisted metadata.

- [ ] **Step 4: Run generate, execution and router tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/generate-runner.test.ts src/execution/generate-outcome-review.test.ts src/trpc/routers/tasks-attachment-availability.test.ts src/trpc/routers/tasks.skill-selection.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS for streaming, timeout, idle heartbeat, cancellation, attachment order, expert workflow, fresh-source enforcement and retry-on-empty.

- [ ] **Step 5: Commit generate migration**

```bash
git add apps/orchestrator/src/agent/generate-runner.ts apps/orchestrator/src/agent/generate-runner.test.ts apps/orchestrator/src/trpc/routers/tasks.ts apps/orchestrator/src/trpc/routers/tasks-attachment-availability.test.ts apps/orchestrator/src/trpc/routers/tasks.skill-selection.test.ts
git commit -m "feat(agent): run text generation through Qwen Responses"
```

### Task 10: 迁移抓取总结并保持 EvidenceLedger 来源边界

**Files:**
- Modify: `apps/orchestrator/src/agent/scrape-runner.ts`
- Modify: `apps/orchestrator/src/agent/scrape-runner.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`
- Modify: `apps/orchestrator/src/execution/evidence-ledger.test.ts`

**Interfaces:**
- Consumes: Task 4 `ResponsesAdapter` without built-in web tools; Firecrawl remains the observed-source provider.
- Changes: `RunScrapeOpts.client` to `RunScrapeOpts.responsesAdapter`.
- Preserves: `ScrapeOutcome.sources` as the exact Firecrawl URL list.

- [ ] **Step 1: Write failing source and fallback tests**

```ts
it('does not enable provider search when Firecrawl already supplied the evidence', async () => {
  await runScrapeTask({ ...BASE, responsesAdapter, firecrawl });
  expect(responsesAdapter.stream).toHaveBeenCalledWith(
    expect.objectContaining({ tools: [] }),
    expect.any(Object),
  );
});

it('keeps provider prose URLs out of the scrape source list', async () => {
  responsesAdapter.stream.mockResolvedValue({ ...RESULT, text: '参考 https://invented.test' });
  const outcome = await runScrapeTask({ ...BASE, responsesAdapter, firecrawl });
  expect(outcome.sources).toEqual(['https://example.com/observed']);
});
```

- [ ] **Step 2: Run scrape tests and verify the old stream mock fails**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/scrape-runner.test.ts src/execution/evidence-ledger.test.ts`

Expected: FAIL because the runner still calls `client.messages.stream`.

- [ ] **Step 3: Implement neutral synthesis and safe fallback**

Send the existing bounded Firecrawl markdown context through `responsesAdapter.stream`; pass `tools: []` so the model cannot introduce an untracked second source channel. Preserve `onProgress` and `onStreamDelta`. A Firecrawl failure may fall back only to the Qwen generate lane when that lane is enabled for the same actor and region; otherwise persist the exact normalized unavailable state.

- [ ] **Step 4: Run scrape and generate suites**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/agent/scrape-runner.test.ts src/agent/generate-runner.test.ts src/execution/evidence-ledger.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Expected: PASS with unchanged content caps, exact observed source URLs and no old provider fallback.

- [ ] **Step 5: Commit scrape migration**

```bash
git add apps/orchestrator/src/agent/scrape-runner.ts apps/orchestrator/src/agent/scrape-runner.test.ts apps/orchestrator/src/trpc/routers/tasks.ts apps/orchestrator/src/execution/evidence-ledger.test.ts
git commit -m "feat(agent): synthesize scraped evidence with Qwen"
```

### Task 11: 将视频剪辑文本规划从 OpenAI 迁移到 Qwen

**Files:**
- Modify: `apps/orchestrator/src/video-editing/instruction-planner.ts`
- Modify: `apps/orchestrator/src/video-editing/instruction-planner.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/video-editing.ts`
- Modify: `apps/orchestrator/src/trpc/routers/video-editing.test.ts`
- Modify: `apps/orchestrator/src/config/env.video-editing.test.ts`

**Interfaces:**
- Consumes: Task 5 core runtime with lane `video_edit_planner` and Messages purpose `fast`.
- Produces: `createQwenVideoEditPlannerClient({ messagesAdapter }): VideoEditPlannerClient`.
- Preserves: `validateVideoEditPlan` as the authoritative operation allowlist and quote decision.

- [ ] **Step 1: Write failing Qwen planner construction tests**

```ts
it('uses a forced JSON-only Qwen request and validates the result server-side', async () => {
  const messagesAdapter = makeMessagesAdapter(JSON.stringify({
    summary: '裁掉第二段开头一秒',
    operations: [{ kind: 'trim', sceneId: 'scene_2', startMs: 1000, endMs: 4000 }],
  }));
  const client = createQwenVideoEditPlannerClient({ messagesAdapter });
  await client.plan(REQUEST);
  expect(messagesAdapter.create).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0, thinking: { type: 'disabled' } }),
    expect.objectContaining({ timeoutMs: 12_000, maxRetries: 1 }),
  );
});
```

- [ ] **Step 2: Run planner and router tests and verify the missing factory failure**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/video-editing/instruction-planner.test.ts src/trpc/routers/video-editing.test.ts src/config/env.video-editing.test.ts`

Expected: FAIL because production construction still imports `openai` and expects an OpenAI API key.

- [ ] **Step 3: Implement the Qwen planner adapter**

Remove the production `OpenAI` construction. Use `MessagesAdapter.create` with one system block and one JSON user payload, join text blocks, parse JSON, then run the existing `validateVideoEditPlan`. Keep ambiguous instructions deterministic and model-free. A missing region, disabled lane, timeout or invalid JSON returns `planner_unavailable`; no operation may bypass the server validator.

- [ ] **Step 4: Run planner, quote and render tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/video-editing/instruction-planner.test.ts src/trpc/routers/video-editing.test.ts src/video-editing/operation-schema.test.ts src/video-editing/quote-service.test.ts src/video-editing/render-service.test.ts`

Expected: PASS and no changes to quote, debit, media generation or render execution.

- [ ] **Step 5: Commit video-edit planning migration**

```bash
git add apps/orchestrator/src/video-editing/instruction-planner.ts apps/orchestrator/src/video-editing/instruction-planner.test.ts apps/orchestrator/src/trpc/routers/video-editing.ts apps/orchestrator/src/trpc/routers/video-editing.test.ts apps/orchestrator/src/config/env.video-editing.test.ts
git commit -m "feat(video-editing): plan edits with Qwen"
```

### Task 12: 重写语义核验为单调、可用性显式且不泄露原文

**Files:**
- Modify: `apps/orchestrator/src/execution/llm-verifier.ts`
- Modify: `apps/orchestrator/src/execution/llm-verifier.test.ts`
- Modify: `apps/orchestrator/src/execution/execution-pipeline.ts`
- Modify: `apps/orchestrator/src/execution/execution-pipeline.test.ts`
- Modify: `apps/orchestrator/src/response-layer/openai-verifier-fallback.ts`
- Modify: `apps/orchestrator/src/response-layer/openai-verifier-fallback.test.ts`

**Interfaces:**
- Consumes: Task 5 runtime with lane `verifier` and Messages purpose `verify_fast | verify_strict`.
- Produces: `SemanticVerification = { status: 'pass' | 'warn' | 'reject' | 'unavailable'; issues: SafeVerifierIssue[] }`.
- Produces: `mergeDeterministicAndSemantic(det, semantic): VerificationResult`.

- [ ] **Step 1: Write failing monotonicity and privacy tests**

```ts
it('never upgrades a deterministic failure', () => {
  const merged = mergeDeterministicAndSemantic(DETERMINISTIC_FAIL, {
    status: 'pass', issues: [],
  });
  expect(merged.passed).toBe(false);
  expect(merged.failureLevel).toBe(DETERMINISTIC_FAIL.failureLevel);
});

it.each(['timeout', 'invalid_json', 'missing_region'])('reports %s as unavailable', async () => {
  const result = await verifyWithLlm(semanticFailureFixture());
  expect(result).toMatchObject({ status: 'unavailable', issues: [] });
});

it('does not copy raw provider output or user text into details', async () => {
  const result = await verifyWithLlm(malformedFixture('PRIVATE_USER_TEXT'));
  expect(JSON.stringify(result)).not.toContain('PRIVATE_USER_TEXT');
});
```

- [ ] **Step 2: Run verifier suites and observe legacy non-blocking-pass failures**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/execution/llm-verifier.test.ts src/execution/execution-pipeline.test.ts src/response-layer/openai-verifier-fallback.test.ts`

Expected: FAIL because timeout and malformed output currently produce `passed: true` and may include raw snippets.

- [ ] **Step 3: Implement Qwen schema and monotonic merge**

Replace Anthropic client types with `MessagesAdapter`. Accept only:

```ts
type SemanticVerification = {
  status: 'pass' | 'warn' | 'reject' | 'unavailable';
  issues: Array<{
    code: 'UNSUPPORTED_CONCLUSION' | 'MISSING_REQUIRED_SECTION' | 'IRRELEVANT_OUTPUT' | 'AMBIGUOUS_EVIDENCE';
    fixable: boolean;
    summary: string;
  }>;
};
```

Enforce a fixed maximum length on `summary`, reject unknown codes, and replace all infrastructure details with fixed internal reason codes. Delete the production call to `maybeApplyVerifierFallback`; keep its module as a dormant implementation with an always-false production gate. For high-trust workflows, surface a visible warning when semantic status is `unavailable`; do not change the deterministic pass/fail result.

- [ ] **Step 4: Run verifier and generate review tests**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/execution/llm-verifier.test.ts src/execution/execution-pipeline.test.ts src/execution/generate-outcome-review.test.ts src/response-layer/openai-verifier-fallback.test.ts`

Expected: PASS with deterministic fail-to-pass count fixed at zero and no raw text in any error detail.

- [ ] **Step 5: Commit verifier migration**

```bash
git add apps/orchestrator/src/execution/llm-verifier.ts apps/orchestrator/src/execution/llm-verifier.test.ts apps/orchestrator/src/execution/execution-pipeline.ts apps/orchestrator/src/execution/execution-pipeline.test.ts apps/orchestrator/src/response-layer/openai-verifier-fallback.ts apps/orchestrator/src/response-layer/openai-verifier-fallback.test.ts
git commit -m "feat(verification): enforce monotonic Qwen review"
```

### Task 13: 切换任务入口并显式关闭未迁移能力

**Files:**
- Create: `apps/orchestrator/src/llm/model-runtime-wiring.ts`
- Create: `apps/orchestrator/src/llm/model-runtime-wiring.test.ts`
- Modify: `apps/orchestrator/src/index.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-create-idempotency.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-confirm.integration.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/tasks-list-detail.integration.test.ts`
- Modify: `apps/orchestrator/src/agent/task-failure-copy.ts`
- Modify: `apps/orchestrator/src/agent/task-failure-copy.test.ts`
- Modify: `apps/web-workbench/src/lib/task-status-copy.ts`
- Modify: `apps/web-workbench/src/lib/task-status-copy.test.ts`

**Interfaces:**
- Consumes: all Tasks 1–12.
- Produces: `createProductionModelRuntimeWiring(environment, factories): ProductionModelRuntimeWiring` with no legacy-client factory in its return type.
- Produces: persisted unavailable reasons `MODEL_DATA_REGION_UNASSIGNED | REGION_SERVICE_NOT_CONFIGURED | MODEL_MIGRATION_IN_PROGRESS | MODEL_ROLLOUT_NOT_ALLOWED`.
- Preserves: task creation idempotency and terminal persistence.

- [ ] **Step 1: Write failing entrypoint and user-copy tests**

```ts
it('does not construct any legacy model client under qwen_only', async () => {
  const wiring = createProductionModelRuntimeWiring(QWEN_ONLY_ENV, {
    createQwenMessagesTransport,
    createQwenResponsesAdapter,
  });
  expect(wiring.policy).toBe('qwen_only');
  expect(Object.keys(wiring)).not.toContain('legacyModelClientFactory');
});

it('persists browser and media tasks as migration unavailable', async () => {
  const result = await createTask({ intent: '打开网页并登录', actor: CANARY_USER });
  expect(result).toMatchObject({ executionMode: 'browser' });
  await expectTask(result.taskId).resolves.toMatchObject({
    status: 'failed',
    reasonCode: 'MODEL_MIGRATION_IN_PROGRESS',
  });
});
```

- [ ] **Step 2: Run task entry and copy tests and verify legacy construction remains**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-runtime-wiring.test.ts src/trpc/routers/tasks-create-idempotency.test.ts src/trpc/routers/tasks-confirm.integration.test.ts src/agent/task-failure-copy.test.ts`

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/task-status-copy.test.ts`

Expected: FAIL because `index.ts` and `tasks.ts` still construct Anthropic clients and browser/media routes do not share the migration status.

- [ ] **Step 3: Wire Qwen runtimes and disable old providers at the top boundary**

Remove module-scope `anthropicForResolver` and all `new Anthropic()` / `new OpenAI()` production construction for subproject A. `createProductionModelRuntimeWiring` receives only Qwen transport factories and unavailable-lane descriptors, so old SDK factories cannot be injected accidentally. Build runtimes per task only after loading the persisted user or organization region. At boot under `qwen_only`, do not construct Anthropic planner, Anthropic vision commander, Gemini model clients or OpenAI verifier; register their lanes as `unavailable_migration` until B/C/D replace them.

Persist fixed reason codes and map them to these user messages:

```ts
export const MODEL_TASK_FAILURE_COPY = {
  MODEL_DATA_REGION_UNASSIGNED: '请先选择模型数据区域，再开始任务。',
  REGION_SERVICE_NOT_CONFIGURED: '该区域的模型服务尚未配置，请稍后再试。',
  MODEL_MIGRATION_IN_PROGRESS: '这项能力正在迁移到千问，暂时不可用。',
  MODEL_ROLLOUT_NOT_ALLOWED: '这项能力正在小范围验证，暂未对当前账号开放。',
} as const;
```

Template fill remains deterministic and available. Stock text research uses the migrated generate/scrape lanes; browser-based stock actions remain explicitly unavailable in this subproject.

- [ ] **Step 4: Run task lifecycle, web copy and type checks**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/llm/model-runtime-wiring.test.ts src/trpc/routers/tasks-create-idempotency.test.ts src/trpc/routers/tasks-confirm.integration.test.ts src/trpc/routers/tasks-list-detail.integration.test.ts src/agent/task-failure-copy.test.ts src/agent/generate-runner.test.ts src/agent/scrape-runner.test.ts`

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/task-status-copy.test.ts`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Expected: PASS; every accepted task reaches a terminal or awaiting-user state and no unavailable lane stays indefinitely executing.

- [ ] **Step 5: Commit the production task cutover**

```bash
git add apps/orchestrator/src/llm/model-runtime-wiring.ts apps/orchestrator/src/llm/model-runtime-wiring.test.ts apps/orchestrator/src/index.ts apps/orchestrator/src/trpc/routers/tasks.ts apps/orchestrator/src/trpc/routers/tasks-create-idempotency.test.ts apps/orchestrator/src/trpc/routers/tasks-confirm.integration.test.ts apps/orchestrator/src/trpc/routers/tasks-list-detail.integration.test.ts apps/orchestrator/src/agent/task-failure-copy.ts apps/orchestrator/src/agent/task-failure-copy.test.ts apps/web-workbench/src/lib/task-status-copy.ts apps/web-workbench/src/lib/task-status-copy.test.ts
git commit -m "feat(tasks): cut core lanes over to Qwen-only runtime"
```

### Task 14: 增加静态发布契约、金标准门禁和生产 runbook

**Files:**
- Create: `apps/orchestrator/scripts/qwen-only-release-contract.mjs`
- Create: `apps/orchestrator/scripts/qwen-only-release-contract.test.mjs`
- Modify: `apps/orchestrator/scripts/qwen-synthetic-benchmark.mjs`
- Modify: `apps/orchestrator/scripts/qwen-synthetic-benchmark.test.mjs`
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.mjs`
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs`
- Create: `apps/orchestrator/scripts/fixtures/qwen-core-gold.json`
- Create: `apps/orchestrator/scripts/fixtures/qwen-legacy-migration-inventory.json`
- Create: `scripts/qwen-core-production-preflight.mjs`
- Create: `scripts/qwen-core-production-preflight.test.mjs`
- Modify: `apps/orchestrator/package.json`
- Modify: `package.json`
- Modify: `scripts/deploy-orchestrator.sh`
- Modify: `scripts/deploy-rollback-target.test.sh`
- Create: `docs/runbooks/qwen-core-rollout.md`

**Interfaces:**
- Consumes: the completed subproject A runtime.
- Produces: `pnpm --filter @holaday/orchestrator test:qwen-only-contract`
- Produces: `pnpm qwen-core:preflight`
- Produces: a sanitized JSON report with provider/region/purpose/outcome counts only.

- [ ] **Step 1: Write failing static-contract and preflight tests**

```js
it('rejects real legacy provider construction outside dormant and fixtures', () => {
  const result = scanProductionModelImports({
    files: [{ path: 'src/index.ts', text: 'new Anthropic()' }],
  });
  assert.deepEqual(result.violations, [{ path: 'src/index.ts', rule: 'legacy_model_client' }]);
});

it('fails production preflight when any observed legacy request exists', () => {
  assert.deepEqual(evaluateQwenCorePreflight({
    runtimePolicy: 'qwen_only',
    legacyProviderRequests: 1,
    crossRegionRequests: 0,
    coreProbeFailures: 0,
  }).status, 'fail');
});
```

- [ ] **Step 2: Run contract tests and verify missing scanners**

Run: `pnpm --filter @holaday/orchestrator exec node --test scripts/qwen-only-release-contract.test.mjs scripts/qwen-synthetic-benchmark.test.mjs scripts/qwen-runtime-benchmark.test.mjs`

Run: `node --test scripts/qwen-core-production-preflight.test.mjs`

Expected: FAIL because the release scanner, gold fixture and production preflight do not exist.

- [ ] **Step 3: Implement release scanning and fixed gold evaluation**

The scanner must start from `src/index.ts`, follow static imports and literal dynamic imports, and reject these patterns in every production-reachable `.ts` file:

```js
const FORBIDDEN = [
  /new\s+Anthropic\s*\(/,
  /new\s+OpenAI\s*\(/,
  /generativelanguage\.googleapis\.com/,
  /provider:\s*['"]anthropic['"]/,
  /provider:\s*['"]openai['"]/,
];
```

The dormant directory must be unreachable from the production import graph. Existing B/C/D implementation files that still contain legacy patterns must be unreachable and listed by path plus exact pattern count in `qwen-legacy-migration-inventory.json`; the scanner fails if an inventory count grows, a new unregistered file appears, or a production root can reach any inventoried or dormant file. Tests, scripts and declared fixtures are excluded from the production graph. The gold fixture contains synthetic inputs and human labels for correct answer, omission, contradiction, fabricated source, prompt injection and high-trust error. The evaluator must calculate severe issue recall, correct-answer false rejection rate, deterministic fail-to-pass count and structured-output validity; gate at `>= 0.95`, `<= 0.02`, `=== 0` and `>= 0.99` respectively.

- [ ] **Step 4: Update deployment requirements and write the exact rollout runbook**

Change deployment required process keys from legacy model credentials to:

```text
MODEL_RUNTIME_POLICY
QWEN_CORE_ROLLOUT_MODE
QWEN_CORE_ENABLED_LANES
DASHSCOPE_INTL_API_KEY
DASHSCOPE_INTL_ANTHROPIC_BASE_URL
DASHSCOPE_INTL_RESPONSES_BASE_URL
```

Require mainland credentials only before a mainland probe or mainland account is enabled. The runbook must use this order: local tests → international synthetic protocol probe → mainland synthetic protocol probe → exact synthetic-account canary → internal allowlist → all users. Every expansion requires health 200, zero legacy requests, zero cross-region requests, no stuck tasks, verifier thresholds and p95 short-call latency `<= 5s`. Rollback may only target a revision that still enforces `qwen_only`.

- [ ] **Step 5: Run the complete local release gate**

Run: `pnpm --filter @holaday/orchestrator test`

Run: `pnpm --filter @holaday/orchestrator typecheck`

Run: `pnpm --filter @holaday/orchestrator build`

Run: `pnpm --filter @holaday/web-workbench test`

Run: `pnpm --filter @holaday/web-workbench lint`

Run: `pnpm --filter @holaday/web-workbench typecheck`

Run: `pnpm --filter @holaday/web-workbench build`

Run: `pnpm test:ops`

Run: `git diff --check`

Expected: every command exits 0. If repository-wide lint reports pre-existing unrelated failures, rerun lint on all touched files, record the exact unrelated paths, and do not mark the release gate complete until touched-file lint, tests, typecheck and builds pass.

- [ ] **Step 6: Commit release gates and runbook**

```bash
git add apps/orchestrator/scripts/qwen-only-release-contract.mjs apps/orchestrator/scripts/qwen-only-release-contract.test.mjs apps/orchestrator/scripts/qwen-synthetic-benchmark.mjs apps/orchestrator/scripts/qwen-synthetic-benchmark.test.mjs apps/orchestrator/scripts/qwen-runtime-benchmark.mjs apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs apps/orchestrator/scripts/fixtures/qwen-core-gold.json apps/orchestrator/scripts/fixtures/qwen-legacy-migration-inventory.json scripts/qwen-core-production-preflight.mjs scripts/qwen-core-production-preflight.test.mjs apps/orchestrator/package.json package.json scripts/deploy-orchestrator.sh scripts/deploy-rollback-target.test.sh docs/runbooks/qwen-core-rollout.md
git commit -m "test(llm): gate Qwen-only core rollout"
```

## Spec Coverage Map

| Approved specification requirement | Implementation tasks |
|---|---|
| Production `qwen_only`, no legacy fallback, explicit unavailable lanes | Tasks 1, 5, 13, 14 |
| Mainland/international routing, independent credentials, no cross-region fallback | Tasks 2, 5, 6, 7, 14 |
| Provider-neutral Messages and Responses protocols | Tasks 3, 4, 5 |
| Suggestions, planning, text generation, scrape synthesis and template/stock text paths | Tasks 8, 9, 10, 13 |
| Video-edit text instruction planning only; no media generation migration | Tasks 11, 13 |
| Deterministic-first, monotonic semantic verification and explicit unavailability | Task 12 |
| Structured tool sources, freshness fail-closed and EvidenceLedger boundaries | Tasks 4, 9, 10 |
| One-time personal/organization data-region choice with no inference | Tasks 6, 7 |
| Sanitized model metadata, no prompt/response/provider-body logging | Tasks 3, 4, 5, 9, 12, 14 |
| Fixed gold set, dual-region probes, latency/quality gates, canary and safe rollback | Task 14 |
| Browser, image/video generation, voice and memory remain visibly unavailable | Tasks 1, 13, 14 |
| Payment, quota, Partner Ledger, OAuth, account closure and deferred DivineAPI scope remain untouched | Global Constraints; verified again in Tasks 11 and 14 |

## Final Review and Delivery

- [ ] Re-read `docs/superpowers/specs/2026-09-04-qwen-only-runtime-design.md` and map every subproject A requirement to Tasks 1–14.
- [ ] Confirm every `rg -n "new Anthropic|new OpenAI|generativelanguage.googleapis.com" apps/orchestrator/src` match is either a test, the unreachable dormant boundary, or an unreachable B/C/D file with an exact frozen count in `qwen-legacy-migration-inventory.json`.
- [ ] Confirm the release scanner rejects a production path to any dormant or inventoried B/C/D legacy file and rejects every new or increased legacy pattern.
- [ ] Confirm no Qwen error path logs request bodies, response bodies, attachment contents, URLs, API keys, user external IDs or raw provider errors.
- [ ] Confirm all Qwen calls carry safe provider, region, deployment scope, purpose, model, outcome, token count and latency metadata.
- [ ] Confirm personal and organization region assignment is one-time, idempotent for the same value and conflict-producing for a different value.
- [ ] Confirm all non-canary calls return a clear status and no accepted task remains `executing` after a lane rejection.
- [ ] Push the verified branch and create a Draft PR against `claude/musing-keller-ae1d05` using the GitHub API connector.
- [ ] Request independent code review; resolve every actionable thread with a test before marking Ready.
- [ ] Merge only after every required check is green and the release evidence is attached to the PR.
- [ ] Deploy Orchestrator and application according to `docs/runbooks/qwen-core-rollout.md`; verify both production health endpoints and the exact synthetic account before any allowlist expansion.
- [ ] Do not request or configure the mainland key until the mainland synthetic probe step is ready; never display or persist the key value in task output.
