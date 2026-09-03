# Qwen Runtime Protocol Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用固定合成数据验证国际千问的 SSE 流式响应、两轮 `tool_use/tool_result` 和 Holaday 典型长材料提取能力，且报告不包含模型正文、工具 ID 或合成材料。

**Architecture:** 新增独立的 Node 运行时基准脚本和测试，不接入 Orchestrator 启动或任务路由。脚本复用上一阶段的安全边界，但自身封装凭据预检、新加坡端点校验、串行调用、超时和脱敏报告，以便通过 stdin 在生产服务器内存中运行而不写远程文件。

**Tech Stack:** Node.js ESM、内置 `fetch` / `AbortController` / `node:test`、Alibaba Cloud Model Studio Anthropic-compatible Messages API。

**Spec:** `docs/superpowers/specs/2026-09-03-qwen-holaday-capability-matrix.md`

## Global Constraints

- 只允许 `https://dashscope-intl.aliyuncs.com/apps/anthropic` 或新加坡 workspace 专属 `/apps/anthropic` 端点。
- Key 只从运行时环境或目标 PM2 进程的 `/proc/<pid>/environ` 读入内存；不得打印、复制或写文件。
- 不读取数据库、生产任务、附件、日志或用户自由文本；全部输入在脚本内确定性生成。
- 串行执行、每个请求零自动重试；单请求最多 60 秒。
- 报告只包含 case id、模型、状态、失败原因代码、延迟与 token 汇总。
- 不修改生产配置、功能开关、数据库或用户可见行为。

---

### Task 1: SSE 流式事件门禁

**Files:**
- Create: `apps/orchestrator/scripts/qwen-runtime-benchmark.mjs`
- Create: `apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs`

**Interfaces:**
- Produces: `runQwenRuntimeBenchmark({ runtimeEnv, fetchImpl, now, timeoutMs, cases })`
- Produces: `parseAnthropicSse(raw): { text, eventTypes, stopReason, usage } | null`
- Consumes: Anthropic-compatible `POST /v1/messages` with `stream: true`.

- [x] **Step 1: Write the failing SSE test**

Add a `node:test` case with a hand-written SSE fixture containing `message_start`, `content_block_start`, two `text_delta` events, `message_delta`, and `message_stop`. Assert the runtime report marks `streaming_text` passed, totals the literal token counts, and does not serialize `STREAM_OK`.

- [x] **Step 2: Run the test to verify RED**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: FAIL because `qwen-runtime-benchmark.mjs` does not exist.

- [x] **Step 3: Implement minimal streaming support**

Implement strict endpoint and credential preflight, one `qwen3.8-flash` request with `thinking: { type: 'disabled' }`, `stream: true`, and an SSE parser that accepts only JSON `data:` events. Pass only when all required event stages exist, `stop_reason=end_turn`, token counts are finite and the internally collected text equals `STREAM_OK`.

- [x] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: PASS with one test and zero failures.

### Task 2: 两轮工具回传门禁

**Files:**
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.mjs`
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs`

**Interfaces:**
- Produces: `tool_roundtrip` case with exactly two sequential requests.
- First response contract: one `lookup_record` tool block with `{ recordId: 'REC-7' }`.
- Second request contract: original user message, assistant `tool_use`, then matching user `tool_result`.

- [x] **Step 1: Write the failing round-trip test**

Use two complete mock responses. The first returns a literal `tool_use` block; the second returns `{"recordId":"REC-7","status":"READY","score":91}`. Assert request ordering, matching `tool_use_id`, 2-call token totals and absence of the tool ID or record payload from the report.

- [x] **Step 2: Run the test to verify RED**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: FAIL because `tool_roundtrip` is absent.

- [x] **Step 3: Implement minimal round-trip support**

Send a forced `lookup_record` custom tool request to `qwen3.8-max`, validate the returned tool name and input, then send the exact tool block plus a fixed synthetic result back as `tool_result`. Disable further tools with `tool_choice: { type: 'none' }`, parse the final JSON internally, and return only safe metadata.

- [x] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: PASS for streaming and tool round-trip cases.

### Task 3: 合成长上下文门禁

**Files:**
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.mjs`
- Modify: `apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs`

**Interfaces:**
- Produces: `long_context_retrieval` case using `qwen3.7-plus`.
- Input: 2,048 generated synthetic rows with one marker at row 1,777.
- Expected internal result: `{ record: 'SYNTHETIC-1777', status: 'amber', value: 314159 }`.

- [x] **Step 1: Write the failing long-context test**

Mock the exact valid JSON response and assert the outgoing prompt contains row 1,777 and more than 60,000 characters, the case passes, and neither the marker nor the generated source is serialized in the report.

- [x] **Step 2: Run the test to verify RED**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: FAIL because `long_context_retrieval` is absent.

- [x] **Step 3: Implement deterministic material generation and scoring**

Generate 2,048 rows in memory, inject the marker only at index 1,777, request strict JSON Schema output, and compare the parsed fields to hand-derived literals. Do not retain or print the prompt after the request.

- [x] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs`  
Expected: PASS for all three runtime cases.

### Task 4: CLI、真实国际评测与记录

**Files:**
- Modify: `apps/orchestrator/package.json`
- Modify: `docs/superpowers/specs/2026-09-03-qwen-holaday-capability-matrix.md`
- Modify: `docs/superpowers/plans/2026-09-03-qwen-runtime-protocol-benchmark.md`

**Interfaces:**
- Produces: `pnpm --filter @holaday/orchestrator eval:qwen-intl:runtime`.
- CLI: `node scripts/qwen-runtime-benchmark.mjs --run [--pm2-process holaday-orchestrator]`.

- [x] **Step 1: Add the tested CLI entrypoint and package script**

The CLI reads the PM2 environment only when explicitly requested, prints one JSON report, and exits nonzero on blocked or failed gates.

- [x] **Step 2: Run local verification**

Run: `node --test scripts/qwen-runtime-benchmark.test.mjs scripts/qwen-synthetic-benchmark.test.mjs`  
Run: `pnpm exec biome check scripts/qwen-runtime-benchmark.mjs scripts/qwen-runtime-benchmark.test.mjs scripts/qwen-synthetic-benchmark.mjs scripts/qwen-synthetic-benchmark.test.mjs package.json`  
Run: `pnpm --filter @holaday/orchestrator typecheck`  
Expected: all commands exit 0.

- [x] **Step 3: Run the real international runtime gate**

Stream the script to the existing production host over the established SSH helper, read the existing international Key only inside the target process environment, and execute four requests serially. Do not store remote artifacts or print provider response bodies.

- [x] **Step 4: Record safe aggregate evidence**

Record passed/total, per-case latency, input/output token totals, and any safe reason code. Explicitly state that the result does not cover Anthropic beta computer-use, visual screenshots, image/video generation or Beijing-region behavior.

- [x] **Step 5: Commit**

```bash
git add apps/orchestrator/scripts/qwen-runtime-benchmark.mjs apps/orchestrator/scripts/qwen-runtime-benchmark.test.mjs apps/orchestrator/package.json docs/superpowers/specs/2026-09-03-qwen-holaday-capability-matrix.md docs/superpowers/plans/2026-09-03-qwen-runtime-protocol-benchmark.md
git commit -m "feat(eval): verify qwen runtime protocols"
```

## Safe Result Record

- Final real gate: `passed=3`, `total=3`, `calls=4`.
- SSE: qwen3.8-flash, 561 ms, 13 input / 2 output tokens.
- Tool round-trip: qwen3.8-max, 2,241 ms, 427 input / 46 output tokens across two requests.
- Long context: qwen3.7-plus, 7,171 ms, 49,209 input / 40 output tokens.
- Provider variance discovered and locked by test: a valid `tool_use` content block may arrive with `stop_reason=end_turn`.
- Not covered: real browser loop, active SSE cancellation, visual screenshots, image/video generation, or Beijing-region behavior.
