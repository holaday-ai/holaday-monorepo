# Qwen 流式活跃与完成处理修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 单主智能体串行执行，复用既有只读审查智能体。

**Goal:** 正在返回有效推理增量的千问请求不被当作无响应；已完成的响应不等待 HTTP EOF。

**Architecture:** Responses 适配器提供无内容的 onProgress() 回调，只接受明确支持的非空推理增量。generate runner 用该信号刷新现有心跳，不输出、储存或展示推理内容。合法完成事件终结流读取并取消连接，保留规范化校验。

**Tech Stack:** TypeScript、Node ReadableStream、Vitest 假时钟与真实 adapter/runner 组合。

**Spec:** 本计划的范围与验收条款；事故证据见 qa-artifacts/pr234-typed-20260908/PLAN.md。官方协议参考：[百炼 Responses API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses)，其中定义 response.reasoning_text.delta。

## Global Constraints

- PR234 合成验收四个计划/修改阶段通过，最终生成失败。固定窗口日志含2次 HEARTBEAT_TIMEOUT，qwen3.7-plus；不推断实际收到何种 SSE，既有日志无法证明。
- 生产已恢复 PR231/off/allowlist0，UID998，两health正常，六个本次安全单元已退休。不得复用 typed-v1 窗口、冻结包、安装或任务。
- 不修改45秒空闲上限、300秒总上限、重试次数、地区路由、密钥、额度或支付。
- 不启动 Docker、安装依赖或并行重任务。Vitest 单 worker，Node 最大2048MB。
- 无供应商网络调用的本地通过不代表真实模型验收或发布成功。

## Task 1: 复现并修复流式边界

**Files:**
- Create: apps/orchestrator/src/agent/generate-stream-liveness.test.ts
- Modify: apps/orchestrator/src/llm/responses-adapter.ts
- Modify: apps/orchestrator/src/agent/generate-runner.ts
- Test: apps/orchestrator/src/llm/responses-adapter.test.ts

**Interfaces:** ResponsesAdapter.stream 第二参数新增 `onProgress?: () => void`，不能携带推理文本。保留 onTextDelta 和 NeutralResponsesResult。

- [x] 用真实 createQwenResponsesAdapter + runGenerateTask，构造每10秒 `response.reasoning_text.delta`、60秒后正文及completed的流；断言一次调用成功且正文不含推理。另构造completed后不close的流，断言立即完成并cancel。

```ts
controller.enqueue(encode({type:'response.reasoning_text.delta',delta:'synthetic private reasoning'}));
// 60s后：正文delta + 合法response.completed；故意不controller.close()
expect(fetchImpl).toHaveBeenCalledTimes(1);
expect(result.status).toBe('completed');
expect(result.summary).not.toContain('synthetic private reasoning');
```

- [x] 跑单文件，确认旧实现出现未完成/重复调用的RED。

```sh
NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter @holaday/orchestrator exec vitest run src/agent/generate-stream-liveness.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism
```

- [x] 最小实现：验证非空字符串 reasoning delta 后调用无参数进度回调，吞掉消费端回调异常；runner仅更新lastProgressAt。第一个 terminal 立即结束事件读取，并在finally取消reader、释放锁。规范化仍拒绝无效完成数据。

```ts
onProgress() { lastProgressAt = Date.now(); }
// adapter：不得拼接推理到text，也不调用onTextDelta传递推理。
if (terminalReceived) break;
```

- [x] 加入防退化：空/未知事件不续命；无事件仍超时；持续推理仍受总时限约束；完成字段无效仍拒绝；callback异常不破坏结果；取消reader不等待永不resolve的cancel。
- [x] 串行跑新测试、既有adapter/runner、路由/runtime/contracts，再typecheck/build、格式与diff检查。不得用旧全量结果声称当前代码全量通过。
- [x] 独立审查并处理所有Critical/Important：回调内取消必须优先于同块完成；首个 terminal 后事件不可受 HTTP 分块影响。两项均先 RED 后修复，复审无剩余阻断。
- [ ] 精确提交四个源码/测试文件及本计划，push/PR。发布必须使用新候选、新包、新窗口和现有PR231回滚基线。

### 本地验证证据（2026-09-08）

- 真实 adapter + runner 离线组合及已有适配器/runner：70 PASS，新增14项边界回归。
- 全部396个后端非 integration 测试文件，20批串行单 worker：6192 PASS，0 skipped。
- 首轮第8批因沙箱禁止本地 WebSocket listen 出现 EPERM；保留失败证据后，仅增加本地端口运行权限，原测试从头重跑20批全部通过，没有修改或跳过断言。
- Qwen 发布契约、初始切换策略、合成与 runtime benchmark 的离线测试：48 PASS；未发供应商请求。
- 完成全量后再次运行 orchestrator typecheck/build、四个修改 TS 文件 Biome 及 `git diff --check`：全部 PASS。
- 原始完整批次记录仅留本地 `qa-artifacts/qwen-stream-liveness-20260908/network-allowed/batch-results.json`，不提交 QA 包、凭据或运行日志。
- 本地通过不能证明 PR234 历史失败时实际收到过 reasoning SSE，也不代替新候选的真实最终生成验收。

## Task 2: 交付与下一次真实验收

- [ ] 合并前完整所需门禁，不降低约束或扩大白名单。
- [ ] 为新revision重新生成准确文件白名单、构建证明与冻结上传包；旧typed-v1仅作历史证据。
- [ ] 一次同范围CN合成任务验证，记录安全的事件类型计数和时间而非正文/推理内容；失败恢复，不自动重试任务。
- [ ] 只有真实最终交付、持久化、独立浏览器验证及恢复均通过后，讨论独立的永久发布门禁。
