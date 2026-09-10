# 定时与规划轮询停止屏障实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 单主实现，最多复用一位只读reviewer；不新增智能体。

**Goal:** stop同步关掉未来tick，返回可等待的原始tick完成Promise，stop/start不产生重叠轮询。

**Architecture:** 每个现有单例poller保留generation和pending Promise。先同步预留pending，再微任务进入首个DB await；旧generation未进入的tick拒绝派发。已进入tick继续完成原逻辑，pending的finally才释放busy。新generation不能覆盖旧pending，stop不再清busy。

**Tech Stack:** 现有TypeScript、Promise、Vitest fake timers、真实Drizzle查询构造与合成mysql2 transport，不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md`；覆盖清单 `docs/superpowers/specs/2026-09-10-process-drain-coverage.md`。

## Global Constraints

- 本地实现/验证，不接boot、不发布、不复用过期窗口，主工作区8草稿和PR237冻结包不改。
- Node heap2048MiB；Vitest maxThreads=1/minThreads=1/no-file-parallelism，每批≤20文件；reviewer/重任务串行；内存空闲<40%或磁盘<10GiB不跑重任务。
- 不安装、不新启Docker/浏览器，不输出身份、密钥或业务数据。支付、奖励、提现、PartnerLedger、额度规则、账号注销、DivineAPI、旧供应商配置不变。
- stop仅等待本poll tick；不能声称detached子任务、远端提交、全进程或跨boot已排空。不改recover/claim/advance/notification内容。

## 单元：两个现有poller的停止与重启竞态

**Files:**
- Modify: `apps/orchestrator/src/agent/scheduled-runner.ts`，仅start/stop及私有lifecycle变量。
- Modify: `apps/orchestrator/src/planned/planned-runner.ts`，同上。
- Create/Test: `apps/orchestrator/src/execution/poller-stop.test.ts`。

**Interfaces:** start函数保留现有deps和NodeJS.Timeout返回；`stopScheduledRunner(): Promise<void>`、`stopPlannedRunner(): Promise<void>` 同步清timer并返回当前pending（没有则resolved）。旧调用方不await仍能立即停止未来tick；维护方之后可await。当前不改index调用和生产策略。

- [x] 用真实start/stop和Drizzle transport写失败测试：hold首个query后stop未完成，stop/start时旧query未释放前没有新query；释放后stop完成，新generation下一个tick正常。分别测试迟到成功/失败，失败不得让stop永远悬挂。

```ts
start({ db, pollIntervalMs: 10 });
await vi.advanceTimersByTimeAsync(0);
let settled = false;
const stopped = Promise.resolve(stop()).then(() => { settled = true; });
await vi.advanceTimersByTimeAsync(0);
expect(settled).toBe(false); // 原始DB尚未释放
start({ db, pollIntervalMs: 10 });
await vi.advanceTimersByTimeAsync(20);
expect(queryCount).toBe(1); // 不重叠
release();
await vi.advanceTimersByTimeAsync(0);
await stopped;
```

- [x] RED命令：在apps/orchestrator运行 `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/poller-stop.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。必须见真实计数/未完成断言失败，不把fixture错误当RED。
- [x] 最小实现：`generation`随start/stop变更，`pending = Promise.resolve().then(() => generation匹配 ? 原tick : undefined).finally(...)`；busy只在该pending结束时释放；stop清timer后返回pending。不新增业务重试、不丢弃已开始tick。
- [x] GREEN后补stop紧跟start但tick尚未派发的零IO测试、重复stop等待同一物理工作、启动幂等、正常下一tick继续，现有scheduled/planned回归保持。
- [x] 同一reviewer只读复核竞态与覆盖清单；主线程暂停重任务。修正必要问题后串行跑相关≤20文件、完整后端tsc、改动文件检查和diff。旧文件格式噪音只说明，不整篇格式化。
- [x] 本地精确提交本单元文件/覆盖文档并记录测试与下一步。整体生命周期未完成前不得push/PR/合并/部署。

## 本地验证记录（2026-09-10 17:50 JST）

- 原始6项停止/重启及派发前停止反例均先出现真实断言失败，最小修复后通过；补幂等启动和旧回调共10项。真实runner/Drizzle，仅mysql2传输使用合成替身。
- 最终相关回归15文件230/230通过（17:49，9.61秒）；命令中指定的tasks-batch-confirm.integration.test.ts被现有Vitest exclude排除，不计入本次通过数，不声称已跑集成数据库。完整后端tsc --noEmit、3个改动TS文件Biome和git diff --check均通过。既有localstorage-file警告仍在。
- 同一独立只读reviewer无Critical/Important；非阻断Minor建议未来增加末端notify/syncPlannedRuns挂起用例。当前测试挂起首个查询，代码审查确认pending覆盖完整pass；下一生命周期单元一并加强末端证据。
- 仅本地检查点；stop未接boot，detached派发/提交未知/其他入口仍待接，未构建发布包、未push/PR/合并/部署或访问生产。覆盖清单是静态快照，reviewer未独立重算全部路由计数。
