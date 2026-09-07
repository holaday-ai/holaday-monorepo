# Qwen 方案模式确认边界实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复普通文本任务的“先出方案”模式在生成入口丢失，使计划、修改计划、确认后继续形成可恢复的闭环。

**Architecture:** 方案模式用显式 `planOnly` 参数限制生成器工具与终态，不靠模型猜测或仅靠提示词。生成结果复用现有 `awaiting_user` 持久化路径，保存 `planMode` 和当前方案；仅当前用户明确批准才解除计划限制。普通生成、既有澄清与敏感动作门禁不变。

**Tech Stack:** TypeScript、tRPC、现有 JSON result、Qwen Responses、Vitest。

**Spec:** 用户本轮“继续”承接 PR230 未完成质量验收。源码显示 `input.mode==='plan'` 仅构造 preamble，而普通 generate 任务仍传 `input.intent`；生产菜单选择后结果直接 completed。修复现有模式语义，不新增产品功能。

## Global Constraints

- 基线为已发布 PR230 `a6f0281fc03cd7f9fc3101c2708795dba7d5ec80`，复用隔离工作区；主工作区草稿不变。
- 不改生产配置、名单、套餐、额度、支付、奖励、注销、DivineAPI 或旧供应商配置。
- 测试和构建串行，Vitest 最多2 workers；只使用合成输入。
- 不将模型计划、历史回复或附件内容视为用户确认；只能解析当前 reply。
- 本轮先修文本 generate 路径；不扩展 browser/image/video 的模型迁移范围。
- 不声称实现通用事实验证；新计划的未知信息要求标为待确认/建议，未标注细节的广义语义质量仍须真实模型评估。

### Task 1: 生成器显式计划模式

**Files:** 修改 `apps/orchestrator/src/agent/generate-runner.ts` 和 `.test.ts`；新增 `apps/orchestrator/src/agent/plan-mode.ts` 和 `.test.ts`。

**Interfaces:** `RunGenerateOpts.planOnly?: boolean`；`isExplicitPlanApproval(reply: string): boolean`；`PLAN_ONLY_INSTRUCTIONS`；`finishPlanDraft(text: string): string`。

- [x] RED：使用真实 runner、仅替换外部 Responses 边界，近期研究方案在 `planOnly=true` 时 tools=[]，完整返回 awaiting_user，不因没有来源失败；普通 auto 仍要求真实来源。

```ts
const outcome = await run(adapter, { intent:'规划本周行业新闻调研', planOnly:true });
expect(requestAt(adapter).tools).toEqual([]);
expect(outcome.status).toBe('awaiting_user');
expect(outcome.summary).toContain('确认');
```

- [x] GREEN：方案模式不走简单问答短路或报告 intake，使用独立计划提示词；保留用户已知条件，补充安排标建议，未知字段待确认。无工具，完整方案固定 awaiting_user；截断或错误方案不得伪装成可批准的完整方案。

```ts
const forceFreshResearch = !opts.planOnly && !isLightweight && requiresFreshResearch(opts.intent);
return { status: opts.planOnly ? 'awaiting_user' : 'completed', summary, ...usage };
```

- [x] 审核批准匹配的合成正反例：`执行`、`按计划做`、`确认`、`go`接受；`不要执行`、`确认预算但先别执行`、`修改第二步`、附带额外指令及引用中的执行均不接受。
- [x] 运行 `pnpm --filter @holaday/orchestrator exec vitest run src/agent/generate-runner.test.ts src/agent/plan-mode.test.ts --maxWorkers=2 --minWorkers=1`。

### Task 2: 创建、修改与恢复状态闭环

**Files:** 修改 `apps/orchestrator/src/trpc/routers/tasks.ts`；新增 `apps/orchestrator/src/trpc/routers/tasks.plan-mode.test.ts`，复用现有 route harness。

**Interfaces:** generate 输入透传 `planOnly: input.mode==='plan'`；等待结果保存 `{planMode:'awaiting_approval', planText:outcome.summary}`；回复仅当前明确批准时 planOnly=false，否则继续 true。

- [x] RED：真实 create caller 的普通任务 `mode=plan` 传到 runner，并等待持久化；state guard 拒绝时不能发送待确认帧。
- [x] RED：awaiting plan 的“修改第二步”继续 planOnly、保存新计划；“执行”解除计划限制且把已保存计划作为不可信参考输入；否定确认不解锁；原普通澄清保持原行为。

```ts
expect(runGenerateTask).toHaveBeenCalledWith(expect.objectContaining({planOnly:true}));
expect(persistAwaitingUser).toHaveBeenCalledWith(expect.objectContaining({
  result:expect.objectContaining({planMode:'awaiting_approval',planText:plan}),
}));
```

- [x] GREEN：创建与 resume 均保存计划状态；未批准的计划修改不得进入 browser handoff；当前方案通过 executionPlan 传递，不升格成 system 指令或已执行事实。
- [x] 运行新路由与既有 create/reply/core-plan/core-suggestions 回归；重新运行类型检查。

### Task 3: 独立审查与交付

- [x] 完整后端/前端测试、类型、两端构建、Qwen合同、ops、QA数据库安全门禁和 diff 检查，记录已知非阻塞警告。
- [x] 独立代码审查；每个重要反馈先写失败测试再修复并复审。
- [ ] 本地真实 UI 验证模式选择、待确认展示、刷新恢复、修改计划和批准输入；若浏览器控制/截图失败，准确记录未验证项，不能用构建通过替代。
- [x] 提交、推送和创建 PR，保留准确范围。生产发布不能复用 PR230 固定版本、7工具目录或11文件白名单，不能在缺少当前精确发布授权时放宽守卫。

## 验证记录

- 实施前 runner/review 基线28项通过，跟踪源码干净；主目录未跟踪草稿保留。
- 计划先处理已证实的模式丢失；13:30新增时间的逐条建议标注作为后续内容质量评估项，不混同为本次已完整解决。

## 独立审查收口

- 生成器新增6项红绿回归；批准匹配20项；真实router23项，包含真实runner/typed intake，仅模型transport和数据库边界使用合成fixture。
- 额外保存初始用户/父上下文、用户修改原话和附件引用。每轮恢复重新验证文件归属、有效性、解析结果；失败发生在恢复CAS之前。合计5个附件、最多32轮回复，超限明确拒绝，不截断旧约束。
- “修改预算但先别执行”会修订并继续待批准，纯暂停不调用模型。批准后澄清也保留上下文；裸值的字段映射独立标记并持久化，不冒充用户原话。
- 类型化字段解析有独立的最新原话优先视图；模型、核验器和后续建议仍使用原时间顺序。明确的新字段值覆盖旧值，模型方案始终不可信。
- 复审发现的附件、父/多轮约束、否定修改、裸值重复澄清、旧字段覆盖均有真实红绿或负对照证据，最终独立只读复审无Critical/Important。
- 本轮没有访问生产账户，没有改变任何生产配置或发布工具。浏览器真实交互和生产新代码验收尚未完成，不将fixture测试当作真实UI/模型质量验收。

## 最终本地验证（2026-09-07）

- 后端395文件/6145测试；前端249文件/2419测试；均0失败，重任务全程串行，最多2 workers。
- 后端完整typecheck、后端build、前端build（含eslint和两项tsc）通过。初期ES2022类型检查发现不支持toReversed，已替换成非变异复制后reverse并重新验证。
- Qwen-only合同41项+静态合同通过，ops120项+全部shell安全门禁通过，QA数据库安全/报告/发布合同37项通过。均为本地fixture或静态检查，不是生产数据库/部署验证。
- 新增文件及runner相关5文件Biome通过；`tasks.ts`保留已有大文件格式，不进行全仓格式重写。git diff --check通过。
- 保留已有Node localstorage警告及Vite大chunk警告。首轮27项失败来自沙箱本地端口EPERM，允许本地端口后的完整重跑0失败。
- 日志：`/private/tmp/qwen-plan-backend-verified.log`、`qwen-plan-frontend-verified.log`、`qwen-plan-backend-build.log`、`qwen-plan-frontend-build.log`、`qwen-plan-contract.log`、`qwen-plan-ops.log`、`qwen-plan-qa-contract.log`。
- 待完成：真实UI/模型生产闭环；本PR自己的精确发布/灰度控制授权及最终发布验收。旧PR230工具没有改动，不能直接拿来部署本分支。
- 已创建草稿PR：<https://github.com/holaday-ai/holaday-monorepo/pull/231>。代码提交`2b422e8cab1a936f59e5f54af479bd354a9f574f`，目标`claude/musing-keller-ae1d05`；本记录后续提交仅更新交付状态。未合并、未部署，不声称远程CI或完整千问迁移通过。
