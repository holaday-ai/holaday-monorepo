# Vision结果保存原始数据库排空实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans；单主实现，复用唯一只读reviewer，与重任务串行。

**Goal:** persistVisionOutcome真实原始查询/写入/事务在等待超时或caller吞错后仍保持活动或unknown，不能错误广播已完成。

**Architecture:** 复用已有task-queue-persistence中的runQueueDatabase/runQueueWrite（历史queue命名，实际为当前scope中的仓储原始DB包装），只接同一TaskRepository的persistVisionOutcome四个原始边界。transaction外层持有真实BEGIN/COMMIT/ROLLBACK，UPDATE接受0/1，事件INSERT必须1；无scope兼容，不改共享提取器或SQL规则。真实direct-open函数配真实repository验证失败catch不再派发第二次未知写，不移除Qwen门禁。

**Tech Stack:** TypeScript、Vitest、真实Drizzle/mysql2协议合成传输、ExecutionDrain；无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；process-drain-coverage.md。

## Global Constraints

- 约10GB总预算，Node堆2048MiB，Vitest单线程无文件并行、每批≤20文件；memory free<40%或磁盘<10GiB不启重任务。
- 无安装、Docker、新浏览器、生产访问；主8草稿/PR237冻结包不改，禁止领域/旧模型配置不触碰，不输出秘密或真实个人业务文本。
- 单元只本地提交，全部覆盖与发布门禁完成前不单独发布；browser pool/连接、其他producer和boot仍未完成。

## 单元：persistVisionOutcome实际原始边界

**Files:** 修改apps/orchestrator/src/agent/task-repository.ts一个方法；新增同目录vision-outcome-persistence.test.ts；覆盖清单。本计划及测试随提交。

**Interfaces:** 保留persistVisionOutcome原签名及Promise<{persisted:boolean}>。复用runQueueDatabase<T>(action:()=>PromiseLike<T>):Promise<T>、runQueueWrite<T>(action:()=>PromiseLike<T>,exactRows?:number):Promise<T>；已有currentOperationLifetime与startOwnedOperation，无新权限API。

- [x] 写并运行RED：真实repo+Drizzle，只有mysql2 query返回合成数据。read/begin/update/event/commit/rollback各阶段挂起成功/失败时database子owner保留，父调用catch返回false仍unknown；父已ACK的void也要同步预留。禁止source-text测试，实际调用查询协议。

```ts
const pending = f.run();
await flush();
f.drain.close();
expect(f.drain.snapshot().byKind.database).toBeGreaterThan(0);
f.release();
await pending;
expect(f.drain.snapshot().unknown).toBeGreaterThan(0); // raw error swallowed
```

- [x] 补RED：不可信UPDATE/INSERT回执不得commit/成功；明确0行CAS无事件无unknown；已unknown/sealed/expired不发SQL；unknown在read/update中出现不再派发后续写，现有transaction仍rollback。五类status保留原允许源状态与事件。真实direct-open catch的失败保存路径不能在unknown后重试UPDATE或广播terminal。
- [x] GREEN：仅包四个调用，不改update/result构造与SQL、catch业务或状态规则。

```ts
const [taskRow] = await runQueueDatabase(() => this.db.select(...).limit(1));
await runQueueDatabase(() => this.db.transaction(async tx => {
  const result = await runQueueWrite(() => tx.update(tasks).set(update).where(...));
  // 原affected===0分支保留。
  await runQueueWrite(() => tx.insert(taskEvents).values(...), 1);
}));
```

- [x] 回归+独立审查：新矩阵、旧repo102、queue persistence54、caller/direct-open、drain/owned/controller，≤20文件串行。后端完整tsc、小TS Biome、单方法片段Biome及方法外逐字不变、diff。审查反例RED→GREEN，最终重跑后本地精确提交；保存ledger及原automation断点。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-outcome-persistence.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 验证记录

01:42 JST新矩阵46项中38条有效RED、8条旧契约兼容通过。四个原始边界接入后01:43全46GREEN；无测试装置错误或未处理拒绝。真实Drizzle协议原始挂起和caller catch重试均已实际观察，而非静态source断言。

独立只读审查无Critical/Important/必修Minor，允许最终复验后本地提交。01:46 JST最终11文件427/427通过，7.61秒；后端完整tsc退出0，新测试Biome/单方法Biome、方法外源码逐字不变与diff检查通过。无真实MySQL/浏览器/千问/Linux/PM2/生产或发布build，完整router的Qwen browser门禁仍保留。主8草稿/66f3分支/PR237 manifest现场不变。

最后内存free68%、磁盘143GiB；全部重任务单线程串行且与reviewer错开，无安装或新服务。下一单元pool/连接生命周期，不是整体发布完成。
