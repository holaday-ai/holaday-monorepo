# P2 Professional Workflow Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持专业工作流质量门禁和 Sonnet 主生成质量的前提下，消除 33–40 秒固定无收益等待，并压缩重复输出带来的主生成耗时。

**Architecture:** 将 typed expert workflow 视为已结构化、可确定性校验的输出通道：response layer 原样保护此类报告，verification pipeline 只在 registry 未解析到 typed contract 时保留 LLM verifier；工作流契约声明独立生成预算，由 runner 和 prompt builder 同时执行软字符目标与硬 token 上限。

**Tech Stack:** TypeScript、Node.js、Anthropic SDK、OpenAI SDK、Vitest、pnpm。

**Spec:** `docs/superpowers/specs/2026-08-21-p2-workflow-latency-design.md`

## Global Constraints

- 主生成模型保持 `claude-sonnet-4-6`；不得通过切换 Haiku 或其他低成本模型获得表面提速。
- 专业工作流的 intake、算术校验、section presence、来源标注、follow-up marker 和确定性 verifier 不得弱化。
- 只跳过 registry 可解析的 typed workflow 的 Haiku 复核；普通 full-tier 任务保持现有路径。
- 只跳过带 `expertWorkflowId` 的 OpenAI 二次润色；普通长回复仍可使用 response layer。
- 保留 `web_search` 能力；生产样本没有实际调用，不做未经证实的工具裁剪。
- 不修改数据库、API、环境变量、部署拓扑或其他产品模块。
- 每项修改先写失败测试、确认 RED，再写最小实现并确认 GREEN。

---

### Task 1: 专业报告 response layer 原样保护

**Files:**
- Modify: `apps/orchestrator/src/response-layer/openai-response-layer.ts`
- Modify: `apps/orchestrator/src/response-layer/openai-response-layer.test.ts`

- [x] **Step 1: 写失败测试**

把“expert workflow 总是触发”测试改为：无论长短，只要带 `expertWorkflowId`，`shouldFormat` 都返回 `false`；`format` 返回原文、`latencyMs=0`、`fallbackReason='expert_workflow_preservation'`，OpenAI client 调用次数为 0。

- [x] **Step 2: 运行单测确认 RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/response-layer/openai-response-layer.test.ts
```

Expected: FAIL，因为当前 expert workflow 会进入 OpenAI formatter，且 fallback reason union 中没有结构保护原因。

- [x] **Step 3: 实现最小跳过逻辑**

在 protected-source 判断之后、普通长度判断之前处理 `expertWorkflowId`；更新注释和 metadata union，确保缺 key/flag off 的优先原因保持不变。

- [x] **Step 4: 重跑单测确认 GREEN**

---

### Task 2: typed workflow 确定性通过后跳过失效 LLM verifier

**Files:**
- Modify: `apps/orchestrator/src/execution/llm-verifier.ts`
- Modify: `apps/orchestrator/src/execution/llm-verifier.test.ts`
- Modify: `apps/orchestrator/src/execution/execution-pipeline.ts`
- Modify: `apps/orchestrator/src/execution/execution-pipeline.test.ts`

- [x] **Step 1: 写 predicate 与 pipeline 失败测试**

扩展 `shouldRunLlmVerifier` 的第三参数 `hasTypedWorkflowContract`：

```ts
expect(shouldRunLlmVerifier(detResult, typedContract, true)).toBe(false);
expect(shouldRunLlmVerifier(detResult, ordinaryFullContract, false)).toBe(true);
```

在 pipeline 集成测试中使用 registry 已注册的 `douyin-review`，验证 deterministic pass 后 fake Anthropic `messages.create` 未调用，返回的 verification 仍为 deterministic checks。

- [x] **Step 2: 运行测试确认 RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/execution/llm-verifier.test.ts src/execution/execution-pipeline.test.ts
```

- [x] **Step 3: 实现显式 typed-contract gate**

由 `verifyAndFinalize` 已解析的 `workflowContract` 决定第三参数，避免仅凭任意旧 `expertWorkflowId` 全局关闭语义复核；deterministic failure 和 fix loop 路径不变。

- [x] **Step 4: 重跑测试确认 GREEN**

---

### Task 3: 工作流级生成预算与内容去重

**Files:**
- Modify: `apps/orchestrator/src/execution/expert-workflow-contract.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-douyin.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-ecom-daily.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-content-topic.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-prompt.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-prompt.test.ts`
- Modify: `apps/orchestrator/src/execution/expert-workflow-content-topic.test.ts`
- Modify: `apps/orchestrator/src/agent/generate-runner.ts`
- Modify: `apps/orchestrator/src/agent/generate-runner.test.ts`

- [x] **Step 1: 写契约、prompt 与 runner 失败测试**

断言：三个 workflow 都声明正整数 `maxTokens` 和有效字符区间；prompt 显示工作流字符预算；内容选题 prompt 对 `topic_count: 8` 明确要求 8 个方向、每方向 2 个标题、只展开 1 个 Top 大纲；runner 对抖音发送 4096、内容发送 5120，而普通 generate 仍发送 8192。

- [x] **Step 2: 运行聚焦测试确认 RED**

Run:

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/execution/expert-workflow-prompt.test.ts src/execution/expert-workflow-content-topic.test.ts src/agent/generate-runner.test.ts
```

- [x] **Step 3: 添加预算类型与三个工作流预算**

实现 `ExpertWorkflowGenerationBudget`；抖音、电商为 4096 / 1800–2800，内容为 5120 / 2600–3800。更新三个 preamble/guidance，明确同一数字和结论只出现一次。

- [x] **Step 4: 让 prompt builder 输出动态规模指令**

读取 `extracted.topic_count`；内容选题按实际数量输出，默认值继续来自 parser。字符预算只作为写作约束，不成为新的阻断检查。

- [x] **Step 5: 让 runner 使用 workflow token budget**

`max_tokens` 优先级固定为：调用方显式 `opts.maxTokens` > workflow `generationBudget.maxTokens` > 全局 8192。保持普通任务、lightweight 和 continuation 行为不变。

- [x] **Step 6: 重跑聚焦测试确认 GREEN**

---

### Task 4: 回归门禁与本地性能契约

**Files:**
- Verify only: all touched files and orchestrator suite

- [x] **Step 1: 运行 touched-file tests**

```bash
pnpm --filter @holaday/orchestrator exec vitest run src/response-layer/openai-response-layer.test.ts src/execution/llm-verifier.test.ts src/execution/execution-pipeline.test.ts src/execution/expert-workflow-prompt.test.ts src/execution/expert-workflow-content-topic.test.ts src/execution/expert-workflow-douyin.test.ts src/execution/expert-workflow-ecom-daily.test.ts src/agent/generate-runner.test.ts
```

- [x] **Step 2: 运行 typecheck、全量测试与 diff gate**

```bash
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator test
git diff --check
```

- [x] **Step 3: 检查改动范围**

确认只有本规格、计划和预期 orchestrator 文件发生变化，不包含主工作区用户改动、环境文件或生成产物。

---

### Task 5: PR、部署与生产前后对比

**Files:**
- Delivery only: Git branch, GitHub PR, production application

- [ ] **Step 1: 提交并推送分支**

提交信息：

```text
perf(orchestrator): reduce expert workflow latency
```

- [ ] **Step 2: 创建 Ready PR 并处理审查/CI**

PR 描述必须附 12 样本根因、跳过边界、测试结果和回滚方式；解决所有 blocking review threads 后合并。

- [ ] **Step 3: 部署 application 并验证健康**

使用仓库部署脚本发布合并 commit；确认两个 healthz 入口均为 200/`status: ok`，`holaday-orchestrator` uid 与 restart count 正常。

- [ ] **Step 4: 运行同版本生产评测**

至少先跑三类各一个代表样本确认无回归，再跑完整 24 项评测。记录每类中位数、P90、质量通过数、response-layer latency/fallback、LLM verifier 调用状态，并与 2026-08-21 基线比较。

- [ ] **Step 5: 给出上线结论**

只有健康、质量、延迟三项都有生产证据时才声明完成；若绝对延迟受上游波动未达标，按同类中位数下降 30% 的备用门槛判断，并明确剩余风险。
