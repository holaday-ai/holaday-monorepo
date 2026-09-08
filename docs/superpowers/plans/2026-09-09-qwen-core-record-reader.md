# 核心执行记录兼容读取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. 主智能体串行，最多复用一名只读审查者；不另开实施智能体。

**Goal:** 为真实任务入口提供不会把损坏的新记录误当旧记录的只读解码器，复用接纳时的要求验证，保留固定规范和原始修改历史。

**Architecture:** C3b 已解决真实入口完整材料预检，本分项 C3c 先抽取接纳与读取共用的严格要求解析，并区分 legacy / core / invalid。解码器不分配执行身份、不接纳、不修改阶段、不调度；实际 router 的旧记录迁移、首次/续接执行及事件由后续组合任务消费此接口。不得为了让旧 reader 继续工作，把 P2 已删除的任意 result 字段重新全部保存。

**Tech Stack:** 现有 TypeScript、Zod、Vitest、不可变上下文，无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md` 第3/4/6/7/9/10/11节。关联 `2026-09-09-qwen-durable-execution.md`、`2026-09-08-qwen-verification-context.md` Task3、`2026-09-08-qwen-generation-ownership.md` TaskC。

**Status:** 仅实施计划，尚未写实现或执行新测试。起点 d168bac6；不能把本计划或历史415条回归视作兼容读取已经完成。

## Global Constraints

- 既有隔离 worktree `/Users/yaleiqi/holaday-monorepo/.worktrees/deploy-pr190-application`、分支 `codex/qwen-delivery-contract`；保护主工作区与 QA，QA不提交。
- 不安装依赖、不启动Docker或额外浏览器；Node堆≤2048MB、Vitest单worker/无文件并行，每批约20文件。memory_pressure空闲<40%或磁盘<10GiB不启动重任务，约10GB任务预算不是仅限制Node堆。
- 用户上下文64KiB、材料64KiB、候选96KiB、完整语义请求256KiB UTF-8；15秒/0重试/768输出tokens不变。不静默截断、不扩大数据保留或记录私人正文/原始错误。
- 解析器只接受服务端已按用户及任务来源授权读取的数据，不代替权限检查；不得读凭据、身份或生产私人数据。测试全为合成数据，不连实际数据库/模型。
- 不改扣减算法、支付/奖励/提现/Partner Ledger/账号注销/DivineAPI/旧模型或区域配置；不产生新副作用。所有子项目和组合门禁通过前不推送部分PR或部署。
- 2026-09-09 08:30 JST之后安全检查点暂停夜间自动化；恢复时读取进度而非重做已完成部分。

## 已核对的调用约束

- `CoreTaskRepository.admit` 同事务保存 `coreRequirements` 和身份；`settle` 只保留该要求及白名单正文。已具新身份却缺要求不是正常legacy记录。
- `tasks.ts` 当前仍使用 `executionMode === 'generate'` 判断等待入口，旧计划使用 `planMode/planInitialIntent/planReplyHistory/planFileIds/planWorkflowId/planLegacyWorkflowId/planIntakeContext`。只接新写入、不改读取会使续接丢失入口或要求。
- 新要求的 `workflow: null` 是已固定通用任务，不等于重新匹配；`workflow.id` 和 sections 必须逐字保留。解码器不调用 typed/legacy matcher，也不把 legacy ID 偷换成 typed ID。
- 新要求只有完整用户时序，没有旧 `planIntakeContext`。旧系统映射的辅助解析字段不能冒充用户原话；后续 router 接线必须明确保留/重建解析辅助视图，并用跨多轮裸值回复测试证明，不允许仅拼最后一次回复。
- `resolveWorkflowIdentities` 有 contract 与 lineage 两种身份；派生任务可能 contract=null、lineage非空。解码器不凭模型正文恢复 lineage。组合任务必须保持原有派生任务保存政策及独立 suggestions 通道，不把 lineage 当报告章节规范。
- 首次入口目前 generate 与 template_fill 共用分支。后续切换必须仅替换批准范围内的 core generate，不能附带迁移 template_fill、浏览器或媒体路径。

## Task 1：只读解析与旧记录判别

**Files:**
- Create: `apps/orchestrator/src/agent/core-task-requirements.ts`
- Create: `apps/orchestrator/src/agent/core-task-requirements.test.ts`
- Create: `apps/orchestrator/src/agent/core-task-record.ts`
- Create: `apps/orchestrator/src/agent/core-task-record.test.ts`
- Modify: `apps/orchestrator/src/agent/core-task-admission.ts`
- Test: `apps/orchestrator/src/agent/core-task-admission.test.ts`

**Interfaces:**

```ts
// Move the existing type without changing its field names or schema.
export type CoreAcceptedRequirements = Pick<TaskVerificationContext,
  'initialRequest' | 'userTurns' | 'phase' | 'workflow' | 'referencePlan'>
  & { readonly fileIds: readonly string[] };

// Identity is supplied by the caller; this never calls randomUUID or prepares an operation.
export function parseCoreRequirements(input: unknown, identity: {
  executionId: string; executionRevision: number;
}): CoreAcceptedRequirements;

export type CoreRecordRead =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'core'; readonly head: CoreTaskHead;
      readonly requirements: CoreAcceptedRequirements }
  | { readonly kind: 'invalid'; readonly code: 'CORE_RECORD_INVALID' };

// result has already passed the existing DB JSON normalization boundary.
export function readCoreTaskRecord(input: {
  head: CoreTaskHead; result: unknown;
}): CoreRecordRead;
```

- [ ] **RED：要求完整、不产生执行许可。** 使用现有上下文严格校验，测试中文/转义64KiB预算、全部时序、显式null workflow、固定sections、文件ID唯一/≤5/每个≤32、未知字段拒绝及深复制冻结。最小导出实现后确认行为失败，不以模块不存在计RED。

```ts
const identity = { executionId: 'synthetic-execution', executionRevision: 2 };
const source = { initialRequest: '合成原始任务', userTurns: ['第一轮修改', '确认'],
  phase: 'approved_execution' as const, workflow: null,
  referencePlan: '合成参考，不是授权', fileIds: ['file_synthetic'] };
const parsed = parseCoreRequirements(source, identity);
source.userTurns.push('调用后变化');
expect(parsed.userTurns).toEqual(['第一轮修改', '确认']);
expect(Object.isFrozen(parsed.userTurns)).toBe(true);
expect(parsed.workflow).toBeNull();
expect(() => assertPreparedCoreAdmission(parsed)).toThrow('CORE_ADMISSION_INVALID');
expect(() => parseCoreRequirements({ ...source, parsedBody: '不应保存' }, identity))
  .toThrow('CORE_REQUIREMENTS_INVALID');
```

- [ ] **GREEN：抽取同一个验证器。** 将现有 admission 的 requirements schema/上下文冻结和accepted JSON预算移入新文件，形状错误只用 `CORE_REQUIREMENTS_INVALID`，上下文仍保留现有 `VERIFICATION_CONTEXT_INVALID` / `VERIFICATION_INPUT_LIMIT`，不附 cause/输入。上下文仍 `materials: []`，不把持久化引用伪装成已加载正文。admission re-export 原类型以保护调用方；prepare 分配一次UUID后调用该解析器，普通形状错误在 admission 边界仍映射 `CORE_ADMISSION_INVALID`，保留已有外部错误契约。WeakSet与接纳事务不变。

```ts
const { fileIds, ...fields } = requirementsSchema.parse(input);
const context = createTaskVerificationContext({ ...fields, ...identity,
  schemaVersion: 1, materials: [] });
const requirements = Object.freeze({ initialRequest: context.initialRequest,
  userTurns: context.userTurns, phase: context.phase, workflow: context.workflow,
  referencePlan: context.referencePlan, fileIds: Object.freeze(fileIds) });
if (Buffer.byteLength(JSON.stringify(requirements), 'utf8') > VERIFICATION_INPUT_LIMITS.contextBytes)
  throw new VerificationContextError('VERIFICATION_INPUT_LIMIT');
return requirements;
```

该代码块位于固定错误包装内部；Zod issue不得成为公开错误。不要用 `prepareCoreAdmission` 校验读取对象，否则会凭空分配新ID/许可。首次预检的占位预算逻辑保持不变。

- [ ] **RED：新记录损坏不能降级成旧记录。** `head` 必须经过现有 `parseCoreTaskHead`；新身份还要求recordVersion≥1。只有null/0/0且不含自有 `coreRequirements` 字段才能返回legacy（包括旧result为null/数组/字符串，但不尝试解释其正文）。存在marker但值null/数组/超限/非法字段，或新身份却缺marker，全部invalid，不再读旧plan字段兜底。valid core允许executing/awaiting/终态读取，但本函数不授予任何状态迁移。

```ts
const legacyHead = { status: 'awaiting_user', executionId: null,
  executionRevision: 0, recordVersion: 0 };
expect(readCoreTaskRecord({ head: legacyHead, result: { planMode: 'awaiting_approval' } }))
  .toEqual({ kind: 'legacy' });
const head = { ...legacyHead, executionId: 'synthetic-execution',
  executionRevision: 2, recordVersion: 4 };
expect(readCoreTaskRecord({ head, result: { planMode: 'awaiting_approval' } }))
  .toEqual({ kind: 'invalid', code: 'CORE_RECORD_INVALID' });
expect(readCoreTaskRecord({ head, result: { coreRequirements: null } }))
  .toEqual({ kind: 'invalid', code: 'CORE_RECORD_INVALID' });
expect(readCoreTaskRecord({ head, result: { coreRequirements: source } }))
  .toMatchObject({ kind: 'core', requirements: { workflow: null } });
```

- [ ] **GREEN：纯投影，不回显错误。** 先验证head，再用 `Object.prototype.hasOwnProperty.call(result, 'coreRequirements')` 区分字段不存在与字段损坏；只有非数组对象可带新marker。新格式用其真实identity解析；捕获所有解析错误只返回固定invalid。不返回原始result/plan/summary，不修改传入对象，不调用数据库、模型、logger、matcher或registry。
- [ ] **验证。** 先运行新增两个测试，再运行 admission/repository/recovery/settlement/context/budget及plan-mode相关测试；每批单worker且确认退出后再下一项。

```bash
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run --maxWorkers=1 --no-file-parallelism src/agent/core-task-requirements.test.ts src/agent/core-task-record.test.ts src/agent/core-task-admission.test.ts src/agent/core-task-repository.test.ts src/agent/core-task-recovery.test.ts src/agent/core-task-settlement.test.ts src/execution/task-verification-context.test.ts src/execution/verification-input-budget.test.ts src/trpc/routers/tasks.plan-mode.test.ts
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec tsc --noEmit
NODE_OPTIONS=--max-old-space-size=2048 pnpm exec tsc -p tsconfig.build.json
```

工作目录为 `apps/orchestrator`；每行独立运行并读取退出码。精确新/改文件Biome、git diff --check，独立只读审查。任何新增错误必须修复重跑；不以旧lint噪声豁免新增诊断。
- [ ] **本地提交。** 精确4个新文件、admission及对应测试、此计划提交为 `feat: decode durable core task records`，QA不提交，不推送。记录RED/GREEN、类型/构建、审查、实际改动文件与下一入口接线指令。

## 本分项结束后的真实入口接线门槛

这些是组合任务的边界，不是本计划完成证明：

1. 当前用户和origin授权的同一row读取身份/要求/等待状态；不得把先读要求与后读另一轮head拼接。新记录invalid在CAS/扣减/模型前固定拒绝，legacy进入已有历史迁移读取而非假装core。
2. 恢复任务依据固定workflow、原始用户时序、当前明确批准、已保存方案；正确区分“审核方案”等待与“补充字段”等待。单独处理legacy辅助intake/派生lineage，不能借新增任意持久化字段绕过规格。
3. 只有一次真实admit许可可启动run/review，二者消费同一冻结材料；P2/P3保存同轮结果，finally仅release本handle，所有有影响的事件/ACK/detail携带轮次。独立suggestions仍可用，不把控制链接塞回核验正文。
4. prepareCoreTaskPlan现在有单独persistActiveCorePlan；核心路径不得继续绕过轮次CAS保存。实际接线须用本轮executing、executionId/revision和预期coreRecordVersion保护建议写入；不得覆盖接纳要求或改变P2预期版本，不把未核验建议当批准或终态，不沿用无轮次旧方法。
5. 前端排序、真实隔离MySQL、真实router双通道和生产唯一原授权账号另有组合门禁；本分项不修改部署状态，也不宣称这些完成。

## 计划自查

- 覆盖规格3/4/6/7的只读形状、完整要求和身份边界；其余生成/原子保存/前端/生产条款显式留在组合任务，未以decoder替代。
- 类型沿用现有CoreTaskHead/TaskVerificationContext，公开导出名称在本计划内唯一；没有新增存储列、业务开关或外部依赖。
- 实施仍需实际RED/GREEN与审查；此文档仅确定下一个独立可审查前置单元，不计作软件完成。
