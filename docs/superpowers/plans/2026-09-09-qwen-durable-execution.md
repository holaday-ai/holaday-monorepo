# 千问可靠接纳与结果保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核心文本用户要求与执行轮次原子接纳，结果及核验原子保存，数据库响应不确定时不重复执行模型或假报完成。

**Architecture:** 独立CoreTaskRepository负责核心文本事务，不改变legacy TaskRepository的浏览器/视频/控制路径。tasks新增执行ID、单调revision及核心记录版本，既有result保存接纳的用户要求/附件引用，既有verification_json保存终态受控元信息；无需新正文队列。接纳、终态事务和恢复协调器分别审查，随后接入已有上下文/句柄计划。前端排序是独立子模块，按总规格第8节另写实施计划后接线，不在此后端分项声称完成。

**Tech Stack:** TypeScript、Drizzle MySQL、现有Zod/Vitest、Node crypto.randomUUID；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md`，特别是第3/6/7/9/11节及V7/V8；完整链路仍受V10–V12组合门禁约束。

## Global Constraints

- 主智能体串行，最多复用一名只读审查者；既有隔离worktree `.worktrees/deploy-pr190-application`、分支 `codex/qwen-delivery-contract`，基线a42d5cab。不安装依赖，不启动Docker/新浏览器，Node堆≤2048MB，Vitest单worker/无文件并行。
- memory_pressure空闲<40%或可用磁盘<10GiB时不启动重任务。主工作区草稿与QA不提交。
- 不改积分/额度扣减规则、支付奖励提现、账户注销、Partner Ledger、旧供应商凭据、DivineAPI；不跨区域，不重放模型或外部副作用。
- 上下文64KiB、材料64KiB、候选96KiB、完整核验请求256KiB UTF-8；已有输入超限在生成/扣减前拒绝。不得静默截断用户要求。
- 恢复最多两次只读对账（1秒、3秒），终态最多两次写入重试（1秒、3秒），二者共用15秒总时限。接纳响应未知不自动重发或调度；20分钟回收保持不变。
- 不保存核验拒绝正文、不新增永久候选稿队列、不延长保留期。附件仅保存现有授权文件引用，不把解析材料正文写进任务日志。
- 三子项目及组合门禁未完成，不推送部分PR/合并/部署；旧灰度包不可重用，自动试发保持暂停。

## 文件与接口边界

- `db/schema/tasks.ts`、`drizzle/0059_core_execution_identity.sql`：仅新增nullable execution_id varchar(64)、execution_revision bigint unsigned default0、core_record_version bigint unsigned default0。旧记录null/0/0可读，首次新接纳升级；不回填身份，不DROP。
- `agent/core-task-admission.ts`：服务端创建不可变接纳操作，严格校验scope/旧head/要求/文件引用及预算；没有数据库/模型/日志。身份不从客户端DTO传入。
- `agent/core-task-repository.ts`：仅真实事务、实际SQL CAS、最小只读head投影；不自动重试、不调度。
- `agent/core-task-settlement.ts`：受控终态候选及固定核验摘要，生成唯一commitId用于幂等对账；不保留failed正文。
- `agent/core-task-recovery.ts`：已提交/未提交/过期/未知分类与15秒有界协调，输入输出只有受控状态；不能导入runner/额度服务。
- 新文件同目录 `.test.ts`；`core-task-repository.integration.test.ts`保留真实MySQL事务验证门禁，只有明确隔离测试数据库可运行，不调用会重置普通数据库的旧helper。

## P1：原子接纳与数据库身份（本地分项完成，真实数据库门禁未执行）

证据：129条相关基线通过；最小导出后40条失败/2条通过，修复后42条通过；独立审查两项分别追加1条真实SQL边界/错误反例RED，再GREEN至44条。最终18文件440测试通过（2026-09-09 00:17 JST启动，29.20秒）、tsc --noEmit/构建、5文件Biome/diff通过。复审无剩余Critical/Important。真实MySQL迁移、JSON运算和事务并发尚未执行，不是整体发布通过。

**Interfaces:**

```ts
type CoreTaskScope = { readonly taskId: string; readonly userId: number };
type CoreTaskHead = {
  readonly status: string;
  readonly executionId: string | null;
  readonly executionRevision: number;
  readonly recordVersion: number;
};
type CoreAcceptedRequirements = Pick<TaskVerificationContext,
  'initialRequest' | 'userTurns' | 'phase' | 'workflow' | 'referencePlan'>
  & { readonly fileIds: readonly string[] };
type CoreAdmission = {
  readonly scope: CoreTaskScope;
  readonly before: CoreTaskHead;
  readonly executionId: string;
  readonly executionRevision: number;
  readonly recordVersion: number;
  readonly requirements: CoreAcceptedRequirements;
};
prepareCoreAdmission(input: {
  scope: CoreTaskScope; before: CoreTaskHead; requirements: CoreAcceptedRequirements;
}): CoreAdmission;
class CoreTaskRepository {
  constructor(db: DB);
  readHead(scope: CoreTaskScope): Promise<CoreTaskHead | null>;
  admit(operation: CoreAdmission): Promise<{ persisted: boolean }>;
}
```

旧head只有执行ID/revision一致的形态可用：null必须revision0；非空ID必须revision>0。status只允许awaiting_user续接，或legacy identity null/0的executing初次接纳；取消/终态/已有执行中的新接纳拒绝。recordVersion及revision均为安全非负整数，接纳递增后必须仍为安全整数。UUID由prepare创建一次；同一operation在对账期间不重新生成。prepare仅接受已授权的服务端组装数据，不替代文件/phase权限核验。非此函数创建的复制/伪造operation不能写库。

- [x] **RED：接纳不丢用户要求。** 使用合成字符串、真实Drizzle SQL编译器与仅替换DB传输的fixture，捕获UPDATE及同事务事件。先最小导出避免把加载错误计为RED。

```ts
const op = prepareCoreAdmission({ scope, before: legacyAwaiting, requirements });
expect(op.executionId).not.toBe(prepareCoreAdmission({ scope, before: legacyAwaiting, requirements }).executionId);
requirements.userTurns.push('后来才写的');
expect(op.requirements.userTurns).toEqual(['补充条件']);
await repo.admit(op);
expect(captured.guard.params).toContain(scope.userId);
expect(captured.guard.sql).toContain('`tasks`.`core_record_version` = ?');
expect(captured.requirements.userTurns).toEqual(['补充条件']);
expect(captured.requirements.fileIds).toEqual(['file_synthetic']);
expect(captured.events[0].payload).toEqual({ executionId: op.executionId, executionRevision: 1, recordVersion: 1 });
```

- [x] **RED：拒绝和回滚。** scope/身份/版本非法、未知字段、超预算、数组引用变化、复制operation、SQL affectedRows=0、异常结果形状、event INSERT失败；断言固定错误不含输入、未接纳不插事件。通过实际SQL params核对userId/taskId/status/旧ID/revision/version全部在WHERE，nullable旧ID使用IS NULL。readHead只投影四个字段且按userId/taskId限定，不读取正文/用户资料。
- [x] **GREEN：精确事务。** schema及0059按现有编号方式追加，migration每个ADD独立statement-breakpoint方便既有幂等迁移器重放。新模块通过Zod和已有createTaskVerificationContext深复制冻结要求，fileIds最多5个且每个≤32字符；accepted JSON仍限制64KiB。只把requirements写入现有result的coreRequirements路径，保留其他result字段，不保存解析材料。

```ts
await db.transaction(async tx => {
  const updated = await tx.update(tasks).set({
    status: 'executing', executionId: op.executionId,
    executionRevision: op.executionRevision, coreRecordVersion: op.recordVersion,
    result: sql`JSON_SET(COALESCE(${tasks.result}, JSON_OBJECT()), '$.coreRequirements', CAST(${JSON.stringify(op.requirements)} AS JSON))`,
    awaitingQuestion: null, awaitingKind: null, pauseReason: null,
    errorCode: null, errorMessage: null,
  }).where(and(
    eq(tasks.externalId, op.scope.taskId), eq(tasks.userId, op.scope.userId),
    eq(tasks.status, op.before.status),
    op.before.executionId === null ? isNull(tasks.executionId) : eq(tasks.executionId, op.before.executionId),
    eq(tasks.executionRevision, op.before.executionRevision),
    eq(tasks.coreRecordVersion, op.before.recordVersion),
    or(isNull(tasks.result), sql`JSON_TYPE(${tasks.result}) = 'OBJECT'`),
  ));
  // affectedRows必须恰好1才写task.resumed/core.admitted事件；0返回persisted:false；未知/多行结果抛固定异常。
  // INSERT使用同一事务内按scope查询的内部task id，不把内部id或正文放入公开payload。
});
```

WHERE在repository内部直接构造，不是公开新权限接口。事件INSERT异常必须传播至transaction使UPDATE回滚。admit返回仅在transaction Promise成功后设置persisted；commit后连接抛错也不伪装false/成功，转换为固定CORE_ADMISSION_UNCONFIRMED交由P3依据原operation处理。readHead异常转换为CORE_EXECUTION_READ_UNAVAILABLE，无原始cause。

审查修复：旧result根只允许SQL NULL或JSON OBJECT，数组/标量/JSON null拒绝，不无声覆盖原数据。依据[MySQL JSON_SET官方说明](https://dev.mysql.com/doc/refman/8.0/en/json-modification-functions.html#function_json-set)，不存在的对象成员只能插入已有对象；不能用identity UPDATE的affectedRows证明JSON成员已写入。本地新增SQL输出断言保护此WHERE，实际MySQL JSON行为仍在集成门禁中验证。

- [x] **验证与提交。** 本项测试+legacy task-repository及上下文/registry和核心生成/核验/路由回归，tsc、构建、精确Biome/diff、只读独立审查。本地提交 `feat: atomically admit core task executions`（编号见本地进度）。SQL/传输替身验证不是实际MySQL；真实迁移及事务门禁未通过时明确保留为组合发布阻塞，不因本分项完成而试发。

## P2：结果与核验原子保存（本地分项完成，真实数据库门禁未执行）

最终证据：新增59条测试（factory38、repository新增21）；相关19文件499测试通过（2026-09-09 01:45 JST启动，29.14秒）。tsc --noEmit、tsc -p tsconfig.build.json、4文件Biome/diff通过；独立审查发现的关键结构失败上限及来源阻断交叉问题均补RED/GREEN，复审无剩余Critical/Important。SQL/CAS/BEGIN/COMMIT/ROLLBACK使用真实Drizzle代码、仅数据库传输替身；实际MySQL事务并发和持久化门禁仍未执行，不能视作上线通过。

**Files:** 新建 `core-task-settlement.ts` / `.test.ts`；扩展repository及测试。`TaskVerificationContext`/`GenerationCompletion`/`VerificationResult`使用现有类型，绝不另定义宽松副本。

**Interfaces:** `prepareCoreSettlement({admission, status, result, generation, verification, sourceTrust?}) -> CoreSettlement`；status只允许completed/partial_success/failed/awaiting_user。operation持有scope、executionId/revision、预期admission.recordVersion、唯一commitId及安全正文/核验投影。`CoreTaskRepository.settle(operation):Promise<{persisted:boolean}>`，`readSettlement(scope):Promise<CoreTaskHead & {commitId:string|null}|null>`只读最小受控字段。

实现细化（不改变批准的质量/隐私边界）：复用现有deriveFinalStatus，受控sourceTrust来自同一服务端结果审查，保留URL来源不足的既有非阻断例外；明确blocking来源和任一hard_fail独立约束状态，避免legacy提前返回partial时降低质量。sourceTrust不保存自由detail，仅映射固定SOURCE_TRUST_FAILED。failed只保存固定reason和tickCount；新result从白名单payload构造，仅从旧JSON保留coreRequirements，不能残留旧summary/错误详情。awaiting只保存question/可选planText；这两处既有MySQL TEXT列各限制65535 UTF-8字节且合计仍不超过96KiB，超限拒绝不截断，JSON summary仍允许96KiB。没有新增宽泛metadata接口或放宽核验类型。

对账读取：SQL仅投影head及四个receipt字段（schemaVersion/executionId/revision/commitId），校验同轮身份和UUID。新终态缺失/畸形receipt固定报不可读；legacy或executing/cancelled不借用上轮receipt。不读取summary、intent或完整verification_json。

- [x] **RED：不可拆开写。** 正文、status、verificationJson和终态event同事务；故意让verification/event失败，整个结果不得成功；相同状态但不同executionId/revision/version拒绝。FAILED fixture不持有summary；partial generation或inputCoverage不完全拒绝completed；verification缺轮次/与本轮不同拒绝。

```ts
const rejected = prepareCoreSettlement({ admission, status:'failed',
  result:{ reason:'质量校验未通过' }, generation, verification });
expect(JSON.stringify(rejected)).not.toContain(candidateRejectedBody);
await expect(repo.settle(op)).rejects.toThrow(); // 注入event写失败
expect(transactionCommitted).toBe(false);
expect(capturedUpdate).toMatchObject({ status: 'partial_success', verificationPassed: false });
```

- [x] **GREEN：同一次UPDATE+事件。** WHERE scope/executing/currentID/revision/coreRecordVersion全匹配。一次UPDATE写result、状态、awaiting/完成字段、verificationJson及verificationPassed/failureLevel、recordVersion+1；verificationJson只包含schemaVersion、executionId/revision、commitId、generation、inputCoverage、semanticStatus、固定问题码及受控failureLevel，不存模型自造detail。用JSON_SET保留coreRequirements；failed分支不得写summary。事件只有身份/固定状态，不重复保存候选正文。awaiting的question/plan依旧按现有允许规则保存，不把计划当授权。
- [x] **验证与提交。** 上述反例、旧轮结果晚到及同操作二次CAS拒绝；真实SQL参数、类型/构建、受影响回归与独立审查。本地提交 `feat: atomically settle verified core results`（编号见本地进度），仍不接生产入口或发布。

## P3：提交状态不确定的有界对账（本地分项完成，真实入口及数据库门禁未执行）

最终证据：新增43条恢复测试。最小实现27条行为RED/1条既有行为pass后28 GREEN；请求排队跨deadline与同commitId异常状态2 RED后35 GREEN；再以真实Drizzle/repository加有状态传输fixture补4条组合回归（未宣称这4条观察过RED）。异步适配器按时resolve、协调器微任务恢复时已超时的四条路径均先RED再GREEN，总43条。最终20文件542测试通过（2026-09-09 02:45:40 JST启动，29.91秒），tsc --noEmit、后端构建、2文件Biome/diff通过。只读独立审查无剩余Critical/Important。实际MySQL及真实router/前端接线未执行，不是整体发布通过。

**Files:** 新建 `core-task-recovery.ts` / `.test.ts`；repository最小read接口由P1/P2提供。

**Interfaces:** `recoverCoreAdmission(repo, operation, options?) -> {kind:'committed'|'not_committed'|'stale'|'unknown'; dispatchAllowed:false}`仅用于异常/CAS拒绝后的恢复，正常admit成功才允许router首次调度。`persistCoreSettlement(repo, operation, options?) -> {kind:'committed'|'not_committed'|'stale'|'unknown'}`包装一次正常写及有界恢复。options只注入单调now与可取消wait以测试deadline，不提供runner/扣减回调。

P3控制器细化：同一不可变operation通过WeakMap共享进行中的Promise及完成结论，重复/并发调用不重置预算或重启写入；不新增强引用正文队列。终态从第一次保存起计15秒，接纳恢复从调用恢复器起计；真实接纳入口尚须在TaskC接线时给初始admit的悬挂请求设置边界。每次只读对账后仅在精确未提交前态才等待并重试终态CAS。最后一次写仍响应未知且没有剩余读取次数时返回unknown，不能沿用重试前的旧快照冒充not_committed。最新权威读明确未提交但剩余时间不足以容纳下一次退避时，可直接返回not_committed且不再写。取消/暂停/更新轮次或已被其他提交替代为stale；同revision不同ID、版本倒退或不合法读取为unknown。任何committed只返回保存结论，不直接触发广播、模型或额度操作。

- [x] **RED：commit成功后抛错。** 有状态DB传输fixture先提交行/事件后抛连接异常；对账看到相同admission身份或settlement commitId，只报告已提交，模型/扣减调用数不变。read报错不是not_committed；cancelled/更高revision是stale；两次读取失败是unknown。两个不同操作相同最终状态不能互认成功。协调器初始故障用例观察过RED；真实repository组合的4条在其后追加，属于GREEN回归，不混称先失败证据。

```ts
const outcome = await recoverCoreAdmission(repo, op, clock);
expect(outcome).toEqual({kind:'committed', dispatchAllowed:false});
expect(modelCalls).toBe(0);
expect(chargeCalls).toBe(0);
expect(await persistCoreSettlement(unreadableRepo, settlement, clock)).toEqual({kind:'unknown'});
expect(clock.elapsed()).toBeLessThanOrEqual(15_000);
```

- [x] **GREEN：恢复预算共用。** 初次写异常/CAS拒绝后至多两次只读对账1s/3s；只有当前头严格等于原操作未提交前态才允许终态重试，至多两次1s/3s，沿用同一不可变candidate和commitId。对账与重试共享15s deadline；每次await前后检查，晚到成功不直接广播，进入受控未知/再权威对账边界。接纳绝不自动重发，确认已接纳也不自动启动模型；由原回收兜底。

恢复计时实现还须让悬挂的DB Promise与剩余deadline竞速：到期返回unknown，不只在await结束后检查时间。已经超时但未结束的写不能并发启动重试，迟到回调不得直接触发广播或模型；保存操作可能随后提交，必须保留“未确认”边界。为永不resolve的读/写与迟到commit分别补故障测试。
- [x] **验证与提交。** fake timer/真实SQL传输组合覆盖deadline、取消、未知、commit前/后错、只读错与重试耗尽；独立审查。本地提交 `fix: reconcile uncertain core persistence`（编号见本地进度）。初始类型检查的Attempt联合缩窄错误已修正；测试helper更名避免被Biome当作Mocha before hook。最终类型/构建/相关测试/精确lint全部重新通过，未推送或发布。

## 组合交接门禁（本计划不等于上线）

- 将本repo/provider接入上下文计划Task3和所有权计划TaskC：先文件授权/预算再既有扣减顺序；真实ID/revision被生成、核验、finally、事件及detail共同使用，取消仍优先。
- 为前端 `apps/web-workbench/src/stores/task-store.ts`、`packages/shared-types/src/ws.ts` 写独立排序计划后执行V9；不改布局。ACK/WS/detail全部携带轮次且按本地事件版本合并，失败保留用户输入。
- 在已隔离测试MySQL验证0059、并发CAS及事务回滚；不启动Docker的约束下如环境不可用，记录尚未执行并等待可用门禁环境，不以mock宣称通过。迁移重复编号检查、前后端构建、真实代码双通道V10/V11、安全预算性能及独立审查齐全后才新建发布包；V12不复用旧生产证据。
