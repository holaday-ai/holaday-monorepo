# 核心回复入口快照保护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline，主线程串行，最多复用一名只读审查者，不另开实施智能体。

**Goal:** 真实reply入口的每次恢复读取都保留用户和origin授权，损坏或已带执行身份的新记录不能进入旧无轮次续接路径。

**Architecture:** C3c解码器已完成。本分项将其接入现有reply各次读取，先保护兼容路径；未接纳的旧文本记录仍按已有流程工作。新的core记录必须走后续C1/P2/P3编排，不能因为残留executionMode/planMode就被旧方法执行；本分项对其明确拒绝，不启用新格式写入，也不是全部入口接线完成。

**Tech Stack:** 现有TypeScript/tRPC/Drizzle/Vitest，无新增依赖。

**Status:** 本分项已完成本地实现及验证；完整core接纳/生成/核验/保存编排仍待完成，不可发布。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md` 第6/7节与V7/V11；`2026-09-09-qwen-core-record-reader.md` 实际入口门槛1。后续全部编排、前端与真实数据库门禁保持未完成。

## Global Constraints

- 既有隔离worktree、基线b583cc61，保护QA及主工作区草稿。不安装/Docker/新浏览器；Node堆2048MB、单worker、重任务串行，free<40%或disk<10GiB不启动。
- 不读真实身份/密钥/正文，不改模型/区域/配额/敏感业务。仅合成测试。三子项目组合完成前不推送/部署。
- 不伪造新记录的legacy字段，不回填丢失历史，不调用prepareCoreAdmission验证读取。core有效也不是旧调度许可。
- 暂不改browser/supercar自身执行模型；其旧记录路径和外部接口不变。新core记录必须在supercar分派前被隔离。

## Task 1：真实入口读取与旧写入的隔离

**Files:** 修改 `apps/orchestrator/src/trpc/routers/tasks.ts` / `tasks.plan-mode.test.ts`；新建 `tasks-reply-record.ts`；修改 `agent/task-repository.ts` / `.test.ts`。必要时只补既有router fixture的真实null/0/0列，不以生产默认值迁就不完整替身。

**Interfaces:**

```ts
assertLegacyReplyRecord(row: { status: string; executionId: string | null;
  executionRevision: number; coreRecordVersion: number; result: unknown }): void;
// result先过既有normalizeOutput。legacy通过；invalid为BAD_REQUEST固定文案；
// core为CONFLICT固定文案，后续真实core编排需在此之前分流，不能删掉invalid检查。
// 旧持久化方法新增可选授权范围，不改变现有browser调用。
markAwaitingReplyResumed(taskId: string, legacyUserId?: number): Promise<{persisted:boolean}>;
markAwaitingReplyCompleted(taskId: string, result: Record<string,unknown>, legacyUserId?: number): Promise<{persisted:boolean}>;
```

- [x] **基线/RED。** 运行现有plan-mode/repository测试。补实际router反例：新身份缺marker、coreRequirements损坏、完整core但残留legacy plan字段，均拒绝且不读附件/旧resume/runner。第一次旧snapshot到后续新snapshot同样拒绝；hold分支不得吞掉校验错误再广播成功。记录实际传给Drizzle的where，恢复读取必须同时含task/user/origin。先观察失败再实现，不把模块缺失算RED。

```ts
f.state.executionId = 'synthetic-new-execution';
f.state.executionRevision = 2;
f.state.coreRecordVersion = 4;
await expect(f.reply('确认')).rejects.toMatchObject({code:'BAD_REQUEST'});
expect(f.resume).not.toHaveBeenCalled();
expect(f.run).not.toHaveBeenCalled();
```

- [x] **GREEN。** 首次授权read、hold刷新read、park恢复read同时投影head+result；后两处仍用当前userId/origin。先判别再附件、hold广播或任何旧调度；校验错误不被best-effort catch吞掉。真实head字段不默认到0掩盖缺失。

```ts
const decoded = readCoreTaskRecord({head:{status:row.status,
 executionId:row.executionId, executionRevision:row.executionRevision,
 recordVersion:row.coreRecordVersion}, result:row.result});
if (decoded.kind === 'invalid') throw new TRPCError({code:'BAD_REQUEST',
 message:'任务执行记录无法恢复，请刷新后重试。'});
if (decoded.kind === 'core') throw new TRPCError({code:'CONFLICT',
 message:'任务已进入新的执行轮次，请刷新后再继续。'});
```

- [x] **RED/GREEN：读写间轮次变化。** 旧生成resume和旧browser-handoff父任务完成调用传入已授权userId；其DB读取与UPDATE都包含user/origin、executionId IS NULL、revision=0、recordVersion=0，防止检查后被新core接纳仍被旧写入。参数非法在DB前固定拒绝；affectedRows=0时无事件。新增SQL级反例先RED，真实Drizzle guard经MySqlDialect编译验证参数；真实MySQL并发仍是后续门禁，不冒充验证。

```ts
expect(guard.sql).toContain('`tasks`.`execution_id` is null');
expect(guard.sql).toContain('`tasks`.`execution_revision` = ?');
expect(guard.params).toContain(42); // synthetic owner
expect(captured.eventInserts).toBe(0); // rejected CAS scenario
```

- [x] **验证/审查。** targeted router/repository→core record/admission/recovery/settlement+相关reply回归，每批≤20文件单worker。`tsc --noEmit`与`tsc -p tsconfig.build.json`逐一退出后再下一项；精确Biome/diff，旧大文件诊断逐行对基线，不豁免新增问题。只读独立审查并修复。
- [x] **本地收口。** 精确代码/测试/本计划提交 `fix: isolate legacy reply snapshots from core executions`，QA不提交；记录真实RED/GREEN、约束与未接线部分。不创建部分PR、不部署、不自动开启已暂停夜间任务。

## 自查与下一步

该保护在真实router使用，不以纯组件通过冒充入口修复；没有让core记录偷偷降级。仅保护过渡期，不表示新的core回复已经能恢复。接下来必须在同一授权row上实现core/legacy恢复到完整要求，保留intake辅助解析与contract/lineage区分，首次与回复共同接入C1许可、registry、runner/review、P2/P3、同轮建议及事件/ACK/finally；届时替换core的受控拒绝为真实编排，并保留invalid拒绝与旧写入防护。整体发布前必须移除此暂时不可续接缺口，且跑真实双通道与数据库门禁。

## 本地完成证据（2026-09-09）

- 基线plan-mode/repository 149通过；新增14条实际行为先失败后通过，覆盖损坏/缺失记录、有效core不得旧调度、后续snapshot变化、hold错误传播、owner/origin读写及非法scope。未用不存在模块制造RED。
- 独立审查指出浏览器parked handle尚未传owner的Important。两个真实router反例（登录回复/手动数据）观察到错误resumed，再修复为同一scoped CAS，拒绝后两个wake方法均不执行。复审无Critical/Important/必修Minor。
- 两个既有router fixture此前没有真实身份列，补齐null/0/0；没有在生产解码器默认缺失值。plan-mode fixture补taskOrigin=user，并更新handoff新授权参数断言；这些fixture修正不计产品RED。
- 最终20文件569测试通过（09:36:47 JST启动、9.78秒、exit0）；tsc --noEmit和tsc -p tsconfig.build.json均exit0。新helper完整Biome通过，4文件lint通过；tasks.ts/task-repository.test.ts/tasks.core-suggestions.test.ts的33/3/1项诊断逐行对b583cc61及diff确认是未改行，不宣称全仓lint通过。
- lint诊断提取工具曾因输出缓冲及stdin JSON协议假设失败；另修正纯插入hunk的行号映射后重新检查。工具失败不当作通过，最终全部37项诊断行与基线同文。没有因工具问题改变产品代码或豁免新增诊断。
- 所有模型日志来自测试替身，未访问真实模型、数据库、浏览器或生产。没有环境/密钥/私人数据/额度/敏感业务变更，没有推送/PR/部署。重任务串行、Node堆2GB、单worker；最终重套件前空闲59%、磁盘150GiB，收尾53%。既有夜间自动化仍PAUSED，当前continue不自动恢复调度。
- 实际提交范围为7代码/测试文件加本计划：task-repository两文件、tasks.ts、tasks-reply-record.ts、plan-mode/resume-verifier/core-suggestions测试。QA不提交。新helper只作过渡保护，实际core首次/续接、前端排序、真实MySQL及新生产门禁仍未完成。
