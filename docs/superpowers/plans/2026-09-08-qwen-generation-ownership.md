# 千问生成完整性与执行所有权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已有草稿不等于完整生成；旧执行不能核验、清理或保存新执行的数据。

**Architecture:** 先修生成器的显式完整性和最终状态上限，再引入与legacy registry隔离的本轮句柄；核心router接线等待服务端事务提供真实executionId/revision，禁止临时常量。只处理核心文本首次及计划续接，非核心浏览器/抓取兼容路径不在本轮切换。

**Tech Stack:** TypeScript、现有Responses适配器、Vitest、execution-pipeline。

**Spec:** 已批准的 `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md`，本计划细化第5/6节及V5/V6/V7，不引入新产品决策。

## 约束

- 在既有 `codex/qwen-delivery-contract` 隔离worktree串行执行。主智能体加最多一名复用的只读审查者；不得启动Docker、安装依赖或新浏览器。
- Node堆≤2048MB，Vitest单worker、无文件并行。free<40%或磁盘<10GiB不启重任务；不把Node堆当成整机内存。
- 不改额度/支付/奖励/提现/账户注销/旧供应商凭据/DivineAPI，不跨区域，不重放模型或外部副作用。
- 三子项目及组合门禁全部完成前，不推送部分功能PR，不合并/部署，不重用旧生产包。

## Task A：显式生成完整性与草稿保护（完成）

证据：11条行为RED后60测试GREEN；迟到completed超时反例再RED，接收前校验signal后GREEN。最终上下文/核验/生成/核心路由12文件264测试通过（27.34秒），tsc --noEmit与tsc -p tsconfig.build.json通过。5个实现/单测文件Biome通过；4个router fixture lint仅1条基线已有useImportType未处理。独立复核无Critical/Important。不是真实模型、保存事务或生产验证。

**Files:** 新建 `execution/generation-completion.ts`；修改 `agent/generate-runner.ts` / `.test.ts`、`execution/generate-outcome-review.ts` / `.test.ts`；`tasks.core-plan/core-suggestions/plan-mode/resume-verifier.test.ts`仅补typed生成替身元信息。主router暂不重构，完整性原子落库属于后续事务子项目。

**Interfaces:**

```ts
type GenerationCompletion =
  | { completeness: 'complete'; stopReason: 'end_turn' | 'deterministic' | 'awaiting_user' }
  | { completeness: 'partial'; stopReason:
      'continuation_limit' | 'continuation_failed' | 'timeout' |
      'empty_response' | 'provider_error' | 'invalid_response' | 'quality_rejected' };
```

兼容公共 `GenerateOutcome.generation?` 与 `ReviewableGenerateOutcome.generation?`；真实runner返回类型要求generation必填，legacy生成替身/未启动错误可暂缺。后续核心接线必须拒绝新执行缺少完整性，不以optional作为正式核心豁免。

`outcome.status`仍沿用旧运行器协议；`generation`明确完整性。review先完整执行现有确定性/语义/来源检查，只有原本可completed的partial生成才降为partial_success。原failed/awaiting和更严格核验失败不被草稿标记放宽。固定原因码 `GENERATION_INCOMPLETE`用于提示，不回传提供者原始错误。

- [x] **RED：续写和流式边界。** 合成Responses传输测试：三段均max_output达到续写上限；第二次调用异常；第二次空响应耗尽；流式收到delta后超时；成功续写不重复；无文本timeout维持failed；计划不完整维持failed；已批准但仍重复求批准维持failed。断言正文、固定generation字段和调用次数，不能仅比提示文案。
- [x] **GREEN：状态与可用草稿。** 每个真实runner返回分支设置generation。只在完整provider结果时清除本次delta缓冲；异常保留之前已接收正文+当前未提交delta一次。已有delta的心跳超时不重试同一片段，防止重复；没有任何内容保留现有有限重试。续写空响应有前文时保留为partial，不丢草稿。planOnly与需要真实新鲜来源的失败边界不放宽；catch内同样检查已批准却重复求批准的草稿。deadline后的迟到completed不接收、不认证为complete。
- [x] **RED/GREEN：交付上限。** review测试partial元信息即使无提示也不能completed；complete正文中出现“截断”不凭字面误判；硬失败不能被partial抬升；缺省元信息仅沿用legacy。补一条真实runner→真实review组合，mock的只有外部模型传输。
- [x] **验证与提交。** runner/review/pipeline及plan-mode/resume-verifier/core-plan/core-suggestions相关单worker测试；tsc、构建、精确Biome/diff、独立审查。分项本地提交 `fix: preserve explicit generation completeness`（编号见本地进度）。完整性元信息未原子落库/尚未核心强制，不能称整体完成。

## Task B：独立执行句柄与轮次隔离

**Files:** 新建 `execution/core-execution-registry.ts` / `.test.ts`；修改pipeline/evidence-ledger的内部复用接口和针对性测试，避免对legacy taskId registry作隐式语义变化。

**Interfaces:** `CoreExecutionHandle`包含readonly taskId/executionId/revision；registry持有对应contract、独立EvidenceLedger与TaskVerificationContext。服务器接纳后初始化；同一task的新revision替换active引用，旧handle仅可释放其自有资源，不暴露新轮可变对象。每次访问验证taskId/ID/revision及句柄归属。

- [ ] **RED：旧finally交错。** A初始化→B更高revision初始化→A清理→B仍可读且核验未跳过；A读写不得进入B ledger；重复清理无副作用；同revision不同ID拒绝；低revision初始化拒绝；未注册/伪造/丢失handle不能走NULL_OUTPUT成功。
- [ ] **GREEN：独立且有界。** 使用新核心registry，创建独立ledger，不调用getOrCreateLedger(taskId)复用旧实例。当前轮缺必需数据返回固定VERIFICATION_CONTEXT_INVALID及不完全成功；不输出上下文。旧轮不得查询当前轮后再执行写入；异步核验前后都检查归属，数据库最终CAS仍由Task C/事务层保障。
- [ ] **验证与提交。** 单测交错、pipeline现有回归、类型/构建、独立审查。legacy API仍可被非核心路径使用，不因本分项声称全入口隔离已完成。

## Task C：与事务接纳和共享上下文组合

**Files:** `trpc/routers/tasks.ts`核心首次/续接分支及对应集成测试；`generate-outcome-review.ts`、pipeline新handle接口；TaskRepository的真实CAS属于下一份可靠持久化计划。

- [ ] 确认可靠接纳模块真实提供同一事务的executionId/revision；上下文计划Task3的授权附件/用户历史一起接线。不得用taskId、Date.now或常量revision替代服务端单调计数。
- [ ] 核心初始化、recordEvidence、verify/finalize、审计及finally全部传同一handle；禁止在核心finally调用legacy disposeExecution(taskId)。同轮元信息保留到终态事务。
- [ ] 真实router→runner→review组合验证：partial不能completed、晚到旧轮不能覆盖、新轮缺上下文不能跳过、硬失败不放宽、两通道看到同一材料/历史。
- [ ] 组合门禁与事务/前端计划统一；未完成前不发布，不创建新生产时间窗。

## 下一计划依赖

TaskRepository事务接纳、终态元信息原子保存、CAS执行身份/单调revision、有界对账及页面ACK/WS/detail排序按总规格第7/8节单独计划。Task A可先独立实现；Task B/C不能代替数据库跨进程所有权，也不能宣称恢复尚未落库正文。
