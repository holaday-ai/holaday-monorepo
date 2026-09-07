# 方案附件与技能选择续接修复

> **For agentic workers:** Use superpowers:executing-plans inline; resource constraint overrides parallel implementation. One read-only reviewer, serial tests/builds.

**Goal:** 暂停时保留新增附件，批准及澄清时保留创建阶段的 typed workflow 决定。
**Architecture:** 复用现有 result JSON；持久化 `planWorkflowId: string | null`，缺省字段用于兼容旧任务，未知已存 ID 拒绝续接。原始技能决定同样用于澄清字段解析，不能只修复生成器参数。
**Tech Stack:** TypeScript、tRPC、Zod、Vitest。
**Spec:** PR232交接及 `2026-09-07-qwen-approved-delivery-recovery.md` 中两个关联待处理项。

## Global Constraints

- 现有隔离worktree；主工作区草稿及qa-artifacts不提交。
- 不新增数据库迁移、依赖或模型供应商；不触碰支付/积分/注销/DivineAPI。
- 仍只有独立当前回复可批准；暂停附带附件只能更新方案。
- 新旧附件每次续接仍经FileService所有权/有效期及5文件数量检查。
- 每次最多一个重测试进程，Node堆1–2GB；不启动Docker。

## Task 1: 暂停附件

Files: `apps/orchestrator/src/trpc/routers/tasks.ts`、`tasks.plan-mode.test.ts`。

- [x] RED：create附件A → reply('先别执行', [B]) → 重建caller → approve，断言B在持久化及下次模型附件中；暂停仍planOnly=true。
- [x] GREEN：`reviseHeldPlan` 条件改为 `!isPurePlanHold(input.message) || (input.fileIds?.length ?? 0) > 0`，不改授权判断。
- [x] 反例：B失效时批准拒绝且无状态转移；无附件纯暂停仍无模型调用。

## Task 2: 技能决定

Same files. Consumes existing `getExpertWorkflowById(id)` and `workflowOverride?: ExpertWorkflowContract | null`.

- [x] RED：创建normal显式null后续文字出现小红书匹配词，批准仍无typed intake；创建auto匹配内容选题后修改/批准/澄清仍同一个workflow ID。
- [x] GREEN：创建JSON写 `planWorkflowId: typedWorkflow?.workflowId ?? null`；Zod恢复 `z.string().min(1).nullable().optional()`；非空ID必须registry可解析，否则BAD_REQUEST且不释放等待状态。
- [x] 恢复使用保存决定（null仍传null；旧记录undefined不强行选null）；澄清parseInputs与生成器用同一决定；再次等待继续保存字段。
- [x] 验证未知ID拒绝、旧记录兼容、原审批边界及附件安全回归。

## Delivery

- [x] 单worker targeted RED/GREEN，独立只读审查。
- [x] 完整后端、类型/build、相关发布合同；前端未改则检查与基线树无差异，不重跑相同前端构建。
- [ ] 精确文件提交、推送、PR、审查解决、合并；不得把合并当部署。
- [ ] 之后按新的合并SHA准备固定版本发布工具和单账号真实模型验收，旧工具不直接复用。

## 审查与证据

- 基线23项通过；暂停附件先1失败再24通过，技能决定先3失败再27通过。
- 独立审查指出旧matcher仍可触发browser handoff/preamble，且核验契约及metadata未统一。追加2个saved null/ID平台关键词反例及真实pipeline契约断言，先3失败；修复后路由30项通过、三文件针对性95项通过、后端类型检查通过。真实pipeline契约已开启EXECUTION_CONTRACT检查返回contract，不只检查runner参数。
- 保存字段的新记录不再运行旧matcher；路由、preamble、intake、生成、核验及metadata采用同一决定。仅undefined旧记录兼容原路径。独立最终只读审查无Critical/Important。
- RED日志：`/private/tmp/holaday-continuity-attachment-red.log`、`holaday-continuity-workflow-red.log`、`holaday-continuity-legacy-red.log`。最终针对性日志`holaday-continuity-final-target.log`、真实契约复验`holaday-continuity-contract-target.log`。
- 测试使用真实tRPC/生成器/契约构造，文件、数据库和模型传输为合成fixture。未触发生产任务、浏览器动作或真实供应商调用；不等同于生产端到端验收。
- 完整后端395文件6167项通过，256.64秒，单worker2GB，一次exit0，无OOM；日志`/private/tmp/holaday-continuity-full-backend.log`。两端类型检查（含前端node配置）、后端build及diff-check均exit0。前端子树与PR232完全无差异，没有重复前端完整回归/build；此前结果仅作为历史基线，不称本轮前端实测。
- 测试文件导入排序检查首次失败，修正后Biome check通过，路由用例再次复验。tasks.ts保留已有大文件格式及3项non-null lint噪声，不做无关重写，不宣称仓库全量lint通过。
- 两站公开healthz新只读核对均HTTP200/status ok。没有生产代码、配置、数据库或灰度变更。
- 导入排序后路由30项、QA/Qwen合同78项及Qwen静态合同复验全部exit0。日志`/private/tmp/holaday-continuity-post-lint.log`、`holaday-continuity-release-contracts.log`、`holaday-continuity-qwen-contract.log`。所有重任务已结束，未启动Docker、安装或浏览器。
