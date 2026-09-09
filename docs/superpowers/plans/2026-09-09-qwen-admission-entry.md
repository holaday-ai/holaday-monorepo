# 千问接纳入口时限与单次调度许可 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 串行实施。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首次接纳写入纳入有界等待，只有直接确认成功的原调用能取得一次调度许可，任何恢复/重复调用不重新启动模型。

**Architecture:** 复用已完成P3的RecoveryBudget和接纳对账分类，新增admitCoreTask入口；同operation共用现有WeakMap保存的只读结论。原调用持有正常事务成功的一次性返回许可，其他观察者一律dispatchAllowed:false。不新增队列、表、额度或runner回调。

**Tech Stack:** TypeScript、既有Vitest fake timers、真实Drizzle/CoreTaskRepository及仅DB传输故障fixture。

**Spec:** `docs/superpowers/specs/2026-09-08-qwen-delivery-contract-design.md`第7/11节；是`2026-09-08-qwen-generation-ownership.md` Task C的可独立审查前置，不代表真实router接线完成。

## Global Constraints

- 既有隔离worktree `.worktrees/deploy-pr190-application`，branch `codex/qwen-delivery-contract`，基线5a758722。保护QA和主工作区，不安装依赖、不启动Docker/新浏览器。
- 主线程串行、最多复用一名只读审查者，Node堆≤2048MB，Vitest单worker/无文件并行；memory_pressure空闲<40%或磁盘<10GiB不启动重任务，总任务内存预算约10GB。
- 首次接纳写入和最多两次只读对账（1s/3s）共用15s期限；绝不重试接纳写、模型、扣减或外部动作。正常事务直接确认且在期限内才允许原调用调度一次。
- 不变更64KiB上下文/64KiB材料/96KiB候选/256KiB请求预算，不新增正文保留、恢复队列或延长保留期。只能接受已prepare的原operation。
- 不触碰支付/奖励/提现/Partner Ledger/额度mutation/账户注销/DivineAPI或旧供应商凭据，不跨区域。三子项目及组合门禁通过前不得推送部分PR/合并/部署，旧发布包禁止复用。

## Task C1：有界首次接纳（本地完成，尚未接入router）

证据：108条相关基线通过；新增13条，其中12条观察到行为RED、1条排队超时unknown边界在最小实现时已通过。最初耗尽恢复用例未推进fake timer导致测试超时，补finish后重新得到缺失首次写的具体行为RED，不将该测试框架超时当产品反例。最终20文件555测试通过（2026-09-09 03:32:52 JST启动，29.85秒），tsc --noEmit、tsc -p tsconfig.build.json、2文件Biome/diff通过。只读独立审查无Critical/Important或必须修复Minor。模拟mysql2传输保留真实repository事务调用，不是实际MySQL；真实入口与组合发布仍未完成。

**Files:** 修改`apps/orchestrator/src/agent/core-task-recovery.ts`及`.test.ts`；现有有状态真实repository传输fixture直接复用，不复制事务实现；更新本计划和本地QA进度。

**Interfaces:**

```ts
type AdmissionStartResult = Readonly<{
  kind: 'committed'|'not_committed'|'stale'|'unknown';
  dispatchAllowed: boolean;
}>;
admitCoreTask(
  repo: Pick<CoreTaskRepository, 'admit'|'readHead'>,
  op: CoreAdmission,
  clock?: CoreRecoveryClock,
): Promise<AdmissionStartResult>;
```

返回的许可仅供后续服务端入口在同次调用立即使用，不是客户端授权或可持久化凭据。重复调用只能获得false；若先进入recoverCoreAdmission，再调用admitCoreTask，也只能观察原恢复结论，不允许重发。恢复观察者不能夺取正常原调用许可。

- [x] **RED：正常确认和重入边界。** 新导出先为固定unknown最小实现，避免把模块加载失败当行为RED。正常保存调用真实repo.admit后，仅第一调用dispatchAllowed:true；并发或迟到重复调用均false且不再写。只读恢复可以并发观察，但自身永远false。复制operation固定拒绝，不触发DB。

```ts
const first = admitCoreTask(repo, op);
const duplicate = admitCoreTask(repo, op);
const observer = recoverCoreAdmission(repo, op);
expect(await finish(first)).toEqual({kind:'committed',dispatchAllowed:true});
expect(await duplicate).toEqual({kind:'committed',dispatchAllowed:false});
expect(await observer).toEqual({kind:'committed',dispatchAllowed:false});
expect(db.events).toHaveLength(1);
```

- [x] **RED：未知/超时不能取得调度许可。** 真实repository传输commit后抛错→对账committed但false；commit前抛错→not_committed且false；CAS拒绝→只读当前头。初始写一直挂起→15s unknown、0读取、0重试，释放迟到commit后返回值不变。初始写耗时12s失败、随后的读永不返回→总15s结束，不重开预算；重复恢复不重置读取次数。微任务跨deadline时即使正常persisted:true也unknown。固定返回不泄漏驱动异常。

```ts
const pending = admitCoreTask(hangingRepo, op);
await vi.advanceTimersByTimeAsync(15_000);
expect(await pending).toEqual({kind:'unknown',dispatchAllowed:false});
gate.resolve({persisted:true});
expect(await admitCoreTask(hangingRepo, op)).toEqual({kind:'unknown',dispatchAllowed:false});
```

- [x] **GREEN：同一预算、一次许可。** 原调用同步注册共享观察Promise后启动write，DB入口前及await后复核deadline；仅首次明确persisted:true的原调用返回true。将接纳读取循环提取为接收同一RecoveryBudget的私有函数；正常公开recover自行创建预算，admit发生异常/CAS拒绝则传入其已有预算。所有退出先发布只读固定结论给观察者，再finally取消等待计时；不给观察者true、不以相同最终status代替事务确认。

```ts
const write = await budget.run(() => repo.admit(op));
if (write.kind === 'timeout' || !budget.canWait(0)) return finish('unknown', false);
if (write.kind === 'ok' && write.value?.persisted === true) return finish('committed', true);
const observed = await readAdmissionWithinBudget(repo, op, budget);
return finish(budget.canWait(0) ? observed.kind : 'unknown', false);
```

- [x] **验证与本地提交。** 单worker运行core-task-admission/core-task-repository/core-task-recovery及上一阶段相关回归（每批≤20文件）；tsc --noEmit、tsc -p tsconfig.build.json、2文件Biome、diff、独立只读审查。本地提交`fix: bound initial core admission and dispatch once`（编号见本地进度）；记录RED/GREEN的准确范围，不称实际MySQL或真实入口已验证。

## 下一接线边界

Task3/TaskC接入真实router时，必须在文件授权/预算后调用此入口；仅本次dispatchAllowed:true才创建registry句柄并运行。同一已确认ID/revision传到生成、核验、finally与P2终态事务。保存/恢复/控制状态变化一律不重取该许可。当前C1没有修改tasks.ts，不在其完成报告勾选Task3/TaskC全部完成。
