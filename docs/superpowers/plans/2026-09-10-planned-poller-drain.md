# 规划轮询器接纳与末端同步实施计划（3D-2b-2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans；本单元串行实现，复用唯一只读 reviewer。

**Goal:** 规划轮询器在首个IO前持久接纳，等待原始IO和末端sync，不因吞错或父ACK而重做未确认的恢复/派发。

**Architecture:** 可选executionDrain在真实pass外runRoot，再建立scheduler子链。原始DB/事务沿planned-lifetime持有；queue/notify在新的execution子scope接收可选server-only lifetime。受控模式下恢复扫描仅在无活动/未知时开始，pass与循环之间检查未知；原无scope行为兼容。

**Tech Stack:** 现有 TypeScript、DrainController、Drizzle/mysql2、Vitest，不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；docs/superpowers/specs/2026-09-10-process-drain-coverage.md。

## Global Constraints

- Node heap 2048MiB、Vitest maxThreads=1/minThreads=1/no-file-parallelism，每批≤20文件；重任务与reviewer串行，free<40%或磁盘<10GiB不跑重任务。
- 不访问生产、不安装、不新启Docker/浏览器、不推送/PR/合并/部署；保护主8草稿和PR237冻结包。旧生产窗口不复用。
- 不改claim/recover/owner gate的业务SQL、任务规则、支付/奖励/提现/PartnerLedger/额度/账号注销/DivineAPI/旧供应商配置，不输出秘密或原始个人数据。
- 受控轮询恢复扫描会等待其他在途工作全部结束，避免queue已ACK但detached工作仍活动时重新recover；这是保守接纳节流，不取消业务任务或修改状态清场。实际吞错/ACK内部工作仍须各自接线。
- 不接index boot。完整进程覆盖、旧boot首次维护、对账、Linux/PM2/真实千问、新有效窗口未完成，局部通过不可发布。

## 单元：planned pass 所有权、原始IO及hook交接

**Files:** Modify apps/orchestrator/src/planned/planned-lifetime.ts 和 planned-runner.ts；Create planned/planned-poller-drain.test.ts；更新覆盖清单。

**Interfaces:** `runPlannedOperation<T>(kind:'scheduler'|'execution'|'database', action:()=>PromiseLike<T>):Promise<T>`；`callPlannedHook<T,R>(hook:(input:T,lifetime?:OperationLifetime)=>Promise<R>, input:T):Promise<R>`；`plannedOutcomeUnknown():boolean`。PlannedRunnerDeps增加可选executionDrain及queue/notifyReminder第二参数lifetime。

- [x] RED：关闭时recover前零DB；挂起recover/claim/notify/queue/sync/commit/rollback时close和stop不得释放；迟到错误即使内部catch返回仍unknown>0。

```ts
startPlannedRunner(deps);
await flushMicrotasks();
closeController();
const stopped = stopPlannedRunner();
expect(controller.drain.snapshot().byKind.scheduler).toBe(1);
expect(controller.drain.snapshot().idle).toBe(false);
releaseOriginalIO();
await stopped;
expect(controller.drain.snapshot().unknown).toBeGreaterThan(0); // 迟到失败变体
```

- [x] Run RED/GREEN：在apps/orchestrator运行 `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/planned/planned-poller-drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。真实controller/state/Drizzle/runner，仅外部mysql2/hook合成。
- [x] GREEN：保留pending/generation，在pass真正派发前检查controller活动/未知，然后runRoot+scheduler；原始DB和return/await事务均用runPlannedDatabase，UPDATE使用runPlannedWrite，单行maxRows1，recover允许合法多行。所有业务循环/pass阶段之间停止未确认的新派发，原事务收尾仍可完成。
- [x] hook在实际调用前reserve执行子链，只在有scope时传第二参数；unknown时不接hook。无scope保持原单参数调用；真实调用者后续必须用同一controller与当前hook owner构造Context，不能捕获过期root。
- [x] 扩展反例：异常recover/claim/reminder ACK零派发；queue/notify吞错后同pass第二候选和下一recover均不再执行；detached子owner越过poll ACK时不重入recover；单项与批量sync原始更新/事务覆盖；overrides skip/defer与正常0行ACK兼容；stop末端sync和关闭后既有子工作正常收口。
- [x] 独立只读审查，修复必须项；相关回归≤20文件/批串行、完整后端tsc、3TS Biome、diff检查；只本地精确提交，保存PROGRESS与自动化断点。

## 本地验证记录（2026-09-10 22:11 JST）

- 合成wire fixture最初把claim WHERE中的next_run_at误识别为override更新，修正后22项真实反例RED→GREEN。补回调receiver兼容与直接受控plannedTick绕过scope的3项RED→GREEN；其余追加覆盖0行/多行ACK、override、rollback、同步throw和派发前unknown。
- 独立只读审查发现Important：派发前unknown拒绝被旧catch写成业务failed。将既有反例加上无queue-failure-write断言，RED后加入queueDispatched边界；未实际调用queue的拒绝保留claim/unknown，实际queue同步抛错仍走旧失败处理。复审无Critical/Important/必修Minor。
- 新planned poller测试37项；22:08最终相关19文件366/366，17.44秒。完整后端tsc、3TS Biome与diff检查通过。异步包装后的属性窄化用局部已检查值修正，没有非空断言或绕过类型检查。旧localstorage-file警告保留。
- mysql2/hooks是合成外部边界，controller/state/Drizzle/runner真实；没有真实MySQL/通知/千问/Linux/PM2/生产验证，不称全仓lint/tests或发布build通过。
- 最后内存空闲69%、磁盘144GiB。主工作区8草稿、66f3a583原分支与PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40现场未变。仅本地检查点，不发布部分组件；全局恢复互斥、未接入口、实际hooks/queue/batch和boot仍需后续证明。
