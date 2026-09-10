# 队列状态持久化原始事务生命周期实施计划（3D-3b-1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。单主实现、唯一复用只读reviewer；重任务与审查串行。

**Goal:** 为真实markQueuedTaskExecuting/Failed的查询、事务、更新与事件写入建立原始生命周期，不让被上层catch吞掉的失败或不可信回执消失。

**Architecture:** 读取当前有效server-only scope，每个原始DB调用同步预留database子owner；事务外层持有BEGIN/COMMIT/ROLLBACK。仅有scope时检查单行更新0/1和事件INSERT准确1行，原无scope业务兼容，不改SQL条件、任务状态规则或额度。

**Tech Stack:** TypeScript、ExecutionDrain/owned-operation、真实Drizzle/mysql2协议合成边界、Vitest；无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；docs/superpowers/specs/2026-09-10-process-drain-coverage.md。

## Global Constraints

- 本地开发、验证和检查点提交；不push/PR/合并/部署、不访问生产。保留主8草稿、PR237冻结包。
- 总预算约10GB，Node堆2048MiB，Vitest单线程、无文件并行、每批≤20文件；free<40%或磁盘<10GiB不启重任务。不安装、不启动Docker/浏览器。
- 不触支付、奖励、提现、PartnerLedger、额度规则、账号注销、DivineAPI和旧供应商配置；不输出原始身份、密钥或业务文本。
- 本单元仅两个实际repository方法和它们的helper。tasks.ts真实enqueue/回调Context/安全拒绝分类与浏览器raw/detached尚未接；不据此放开controller或宣称全链覆盖。

## 单元：队列两类状态事务

**Files:** 新增agent/task-queue-persistence.ts、task-queue-persistence.test.ts；仅修改agent/task-repository.ts的两个队列状态方法和必要import；更新覆盖清单。

**Interfaces:** runQueueDatabase<T>(action:()=>PromiseLike<T>):Promise<T>；runQueueWrite<T>(action:()=>PromiseLike<T>, exactRows?:number):Promise<T>。后者在原始database owner内验证回执；缺scope返回原结果。前者在实际调用前检查当前scope/unknown，封闭scope不得派发；事务原始回滚不由新的guard短路。

- [x] 写RED并验证：两种状态×read/begin/update/event/commit/rollback挂起，外部等待结束不能清byKind.database；晚失败即使调用者catch返回也留unknown，事务rollback仍活动。

```ts
const operation = startOwnedOperation(drain, 'execution', async () => {
  try { await repo.markQueuedTaskExecuting('tsk_synthetic'); } catch {}
}, { errorOutcome: 'known', dispatch: 'immediate' });
await flush();
drain.close();
expect(drain.snapshot().byKind.database).toBeGreaterThan(0);
gate.release();
await operation.result;
expect(drain.snapshot().unknown).toBeGreaterThan(0);
```

- [x] GREEN：在两个方法的select、this.db.transaction、tx.update与tx.insert外包原始边界。数据库读取与事件仍按原顺序，状态update保留queued CAS。事务callback抛错由真实Drizzle执行rollback，外层owner直到rollback原始Promise结束才释放。

```ts
await runQueueDatabase(() => this.db.transaction(async tx => {
  const result = await runQueueWrite(() => tx.update(tasks).set({
    status: 'executing', pauseReason: null, startedAt: new Date(),
    awaitingQuestion: null, awaitingKind: null, errorCode: null, errorMessage: null,
  }).where(and(eq(tasks.externalId, taskExternalId), eq(tasks.status, 'queued'))));
  if (extractMysqlAffectedRows(result) === 0) { persisted = false; return; }
  await runQueueWrite(() => tx.insert(taskEvents).values({
    externalId: newExternalId('taskEvent'), taskId: taskRow.id,
    type: 'task.transition', actor: 'system', payload: {from: 'queued', to: 'executing'},
  }), 1);
}));
```

- [x] 回执矩阵：UPDATE0无事件且unknown0；UPDATE1且INSERT1正常；UPDATE缺失/null/string/负数/多行和INSERT非1不得成功或提交，错误在catch前留未知。不改通用extractMysqlAffectedRows，以免影响禁止领域。
- [x] 补unknown在read与事务间、update与event间出现的反例；不派发后续新写，事务已有rollback可完成。真实SQL guard、事件类型/次数、commit/rollback日志为独立断言。
- [x] 串行运行新测试和旧repository/queue/owned/controller回归，完整后端tsc与改动TS检查、diff；复用唯一只读审查，无Critical/Important/必修Minor。本地提交和续接记录见PROGRESS最新节点，不发布部分组件。

运行新测试：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/task-queue-persistence.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`（apps/orchestrator）。不存在真实数据库连接，不跑被配置排除的integration套件并假称通过。

## 本地验证

初始54项中49条有效RED、5条兼容项通过；最小包装后54/54通过，旧repository102项通过。最终2026-09-10 23:54 JST，8文件296/296通过，完整后端tsc通过；新2TS及两个修改方法独立Biome检查通过（不声称存量repository全文件/全仓lint）。程序比较确认除必要import和两个方法之外仓储字节不变，独立只读审查无必修项。无真实DB/浏览器/模型/生产访问，无发布build。
