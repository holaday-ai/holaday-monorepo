# 定时任务生产者生命周期实施计划（3D-2a）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。沿已批准范围串行实现，最多复用一位只读reviewer，不新增智能体。

**Goal:** 可选控制器注入时，在定时轮询第一个DB之前持久接纳，原始DB/事务/派发/通知均持有真实子owner，内部catch不能抹去未知。

**Architecture:** 沿现有stop pending/generation屏障，在实际pass开始时由DrainController.runRoot写dirty并接纳，再创建scheduler子链。每个原始数据库调用与hook在当前scope中同步reserve/pin，以原始Promise结束释放，throw留未知。hooks可接第二个server-only lifetime参数，原无scope调用保持单参数；不凭任务ID创造权限。

**Tech Stack:** 现有TypeScript、AsyncLocalStorage、Drizzle/mysql2、Vitest、真实临时状态文件；不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；覆盖清单docs/superpowers/specs/2026-09-10-process-drain-coverage.md。

## Global Constraints

- 单主实现/至多复用一个只读reviewer，重任务与审查串行。Node heap2048MiB，Vitest maxThreads=1/minThreads=1/no-file-parallelism，每批≤20文件，任务内存约10GB；空闲<40%或磁盘<10GiB不跑重任务。
- 不安装、不启Docker/浏览器、不访问生产，不修改主工作区8草稿与PR237冻结包。旧生产窗口过期，不push/PR/合并/部署部分组件。
- 不改支付/奖励/提现/PartnerLedger/额度规则/账号注销/DivineAPI/旧供应商配置。不输出原始个人数据或秘密。
- 只包裹scheduled runner调用边界，不改recover/claim/advance/owner门禁条件、业务重试或通知规则。维护不能取消业务任务清场。
- 本单元不接index boot；hook内部可能吞错或返回ACK后继续派发，必须后续在真实调用者传播controller/lifetime并覆盖原始内部IO。当前hook Promise结束不等于实际task完成。planned/其他producer、未知对账与全进程门禁仍未完成，不能发布。

## 单元：scheduled poller 的实际接纳及原始调用

**Files:**
- Modify: apps/orchestrator/src/agent/scheduled-runner.ts，deps可选executionDrain、hook lifetime参数、pass与原始await包裹、异常回执保守未知。
- Create: apps/orchestrator/src/agent/scheduled-lifetime.ts，当前scope下runScheduledOperation与未知登记。
- Test: apps/orchestrator/src/agent/scheduled-runner-drain.test.ts，真实controller/state/runner/Drizzle，只替换mysql2和业务hook外部边界。

**Interfaces:** `runScheduledOperation<T>(kind: 'scheduler' | 'database' | 'execution', action: () => Promise<T>): Promise<T>`；无scope原样action，有scope同步startOwnedOperation(immediate, unknown)，禁止借已释放/封闭scope继续派发。`retainScheduledUncertainty(): boolean`只使用当前有效owner，返回是否已记录，不提供清零。ScheduledRunnerDeps.executionDrain?:DrainController；dispatch/notify/notifyReminder增加可选第二参数OperationLifetime，只有真实scope才传。

- [x] RED：closed controller启动后advanceTimers(0)，真实mysql2调用总量为0、dirty=false；open后hold扫描，close/stop尚未释放时database/scheduler/root活动仍存在；late scan rejection即使tick catch返回也unknown>0。删掉接纳或raw包装应分别破坏这些断言。

```ts
startScheduledRunner({ db, dispatch, executionDrain: controller, pollIntervalMs: 10 });
await vi.advanceTimersByTimeAsync(0);
controller.disconnect(session);
const stopped = stopScheduledRunner();
expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
releaseOriginalQuery();
await stopped;
expect(controller.drain.snapshot().unknown).toBeGreaterThan(0); // late failure fixture
```

- [x] Run RED in apps/orchestrator: `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/scheduled-runner-drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。排除fixture错误再记录真实失败。
- [x] GREEN：保留同步pending reservation与generation检查，在原try内调用controller.runRoot(() => runScheduledOperation('scheduler', pass)).result；pass含原recover/tick，不在接纳前做业务IO。原业务await改为runScheduledOperation('database', async () => originalQuery/transaction)，事务外层持有commit/rollback边界，内部query也独立持有。hook用execution子链内currentOperationLifetime传第二参数，兼容无scope单参数。
- [x] DB/dispatch/notify错误在原catch之前由wrapper留下未知；UPDATE回执无法证明非负整数/单行上限时留未知。审查补强：有有效scope的单行ACK只接受0/1，其余返回未获claim且保留未知，阻止当前dispatch/reminder/notify；不可信回执不能当CAS成功。无scope保持原提取行为；recover多行有效整数仍允许。dispatch null不能证明未创建，留未知。通知内部allSettled吞错、旧boot调用和真实内部caller仍在覆盖清单阻断，不假装已解决。
- [x] 安全接纳补强：存在未知时不再接纳下一poll pass，周期recover产生未知后不接本pass的tick，避免以旧恢复扫描重放未确认派发；保留原任务/状态，不改recover内部SQL，不自行清未知。两项真实重复派发计数反例应先失败，再加入这两处准入守卫。
- [x] 加强真实Drizzle延迟claim、owner read、transaction commit/rollback、末端notify、reminder、周期recovery、同步throw、明确CAS0、缺失/异常ACK、关闭后正常既有子工作、blocked后禁止新IO、hook派生子链在poll ACK后继续占用。所有测试输出仅合成数据/固定计数。
- [x] 同一reviewer只读审查，修复必要问题，串行跑新测试和相关scheduled/poller/owned/controller回归、完整后端tsc、改动TS Biome/diff，说明合成边界和排除的集成测试。
- [x] 本地精确提交与PROGRESS/自动化断点；下一步3D-2b planned pass/事务后dispatch及其ctx传播，不重复本单元。

## 本地验证记录（2026-09-10 18:51 JST）

- 初始测试fixture遗漏状态文件/控制协议末尾换行，修正canonical格式后，14条真实接纳/占用/晚失败断言RED→GREEN。异常ACK/null4条、未知后重复派发2条再分别RED→GREEN。
- 独立只读审查指出单行ACK留未知后仍可能派发这一Important；dispatch/reminder零副作用共7条反例RED后修复。只在有效scope下拒绝不可信单行ACK，无scope兼容不变，复审无Critical/Important/必修Minor。
- 新测试39项，覆盖原始DB/事务commit及rollback、末端通知、reminder、周期recovery、同步错误、确定CAS0、明确skip、异常ACK、关闭后既有链、blocked、hook预留detached子owner、原父结束后不可复活和无scope兼容。fixture仅合成mysql2/业务hook，controller/state/Drizzle/runner真实；不证明真实内部hook或生产。
- 18:49最终相关17文件289/289（12.13秒）；后端完整tsc、3TS Biome、git diff --check通过。最终tsc发现测试fixture交叉类型将optional controller变成required，改回实际ScheduledRunnerDeps类型后tsc通过并复跑新39项；此前另一测试闭包捕获的undefined窄化也已修正，没有绕过类型检查。
- 保留既有localstorage-file警告，不宣称全仓lint/tests、真实MySQL/千问/浏览器/通知或生产验证通过。只本地检查点，整个安全排空机制与新发布门禁未完成。
