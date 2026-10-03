# 规划任务事务后派发交接实施计划（3D-2b-1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans，按已批准范围串行执行，复用现有只读 reviewer。

**Goal:** queue 的 starting 回执不释放仍在运行的 detached dispatch；迟到错误和异常写入回执不能让排空假成功。

**Architecture:** 在 queue/dispatch 入口绑定 server-only Context 与真实 owner。事务提交后同步预留 dispatch 子 owner，再返回 starting；原始数据库 Promise 和事务 commit/rollback 由独立 database owner 持有。内部调用传递新子链 Context，不凭运行 ID 接纳。

**Tech Stack:** TypeScript、现有 DrainController/AsyncLocalStorage、Drizzle/mysql2、Vitest；不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；docs/superpowers/specs/2026-09-10-process-drain-coverage.md。

## Global Constraints

- 单实现、至多一位已有只读 reviewer；所有重任务和审查串行。Node heap 2048MiB，Vitest threads=1/no-file-parallelism，每批不超过20文件；约10GB内存预算，free<40%或磁盘<10GiB不跑重任务。
- 不访问生产、不安装、不启动 Docker/浏览器、不 push/PR/合并/部署。保护主工作区8草稿与 PR237冻结包。
- 不改业务 SQL 条件、账号注销规则、支付/奖励/提现/Partner Ledger/额度规则/DivineAPI/旧供应商配置，不输出秘密或原始个人数据。
- 无控制器且无继承权限时保持兼容。缺控制器、跨控制器、过期/伪造 owner、Context/当前 scope 不匹配须在 IO 前拒绝；有未知不接新规划派发，已有数据库收尾可完成。
- 这里只完成 queue/dispatch 交接，不接 planned poller root/index boot，不把 special/batch 的 ACK 当成它们内部 detached 工作已覆盖。全进程覆盖、未知对账、真实 Linux/PM2/千问、新发布窗口仍是发布阻断。

## 单元：原始事务与 detached dispatch

**Files:**
- Create: apps/orchestrator/src/planned/planned-lifetime.ts，Context 接纳、原始 DB 持有及 scoped ACK 验证。
- Modify: apps/orchestrator/src/planned/planned-runner.ts，仅 queue/dispatch 和它们调用的持久化边界；原业务条件不改。
- Test: apps/orchestrator/src/planned/planned-runner-drain.test.ts，真实 controller/state/Drizzle/runner，mysql2 与 special 服务使用合成边界。

**Interfaces:** `withPlannedContext<C extends Context,T>(ctx:C, action:(bound:C)=>Promise<T>):Promise<T>` 同步验证并预留 owner；`runPlannedDatabase<T>(action:()=>PromiseLike<T>):Promise<T>`；`retainPlannedUncertainty():boolean`；scoped 单行 ACK 只接受0/1，INSERT要求正安全整数ID及准确行数。

- [x] RED：closed queue 第一次 DB 前拒绝；hold commit 时 active database>0，放行 commit 后 queue 返回但 hold special 时 execution>0；release 后最终 idle。错误变体验证 rollback/迟到 special 错误虽被 catch 仍 unknown>0。

```ts
const result = queuePlannedRun(ctx, syntheticManualInput);
await untilPhase('commit');
expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
releaseCommit();
await result;
expect(controller.drain.snapshot().idle).toBe(false);
releaseSpecial();
await untilInactive();
expect(controller.drain.snapshot().unknown).toBeGreaterThan(0); // 错误变体
```

- [x] 运行 RED：在 apps/orchestrator 执行 `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/planned/planned-runner-drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`，先修 fixture 错误，只把真实行为断言失败记为 RED。
- [x] GREEN：薄入口调用 withPlannedContext；startRunDispatch 在非 async 边界同步 reserve 后再 .catch；原始 DB/transaction 包裹 runPlannedDatabase，特殊服务和内部 tasks/batch caller 接新的 bound Context；原 catch 前保留未知。

```ts
function startRunDispatch(ctx: AuthenticatedContext, runId: string): void {
  const pending = withPlannedContext(ctx, bound => dispatchPlannedRunOwned(bound, runId));
  void pending.catch(error => reportExistingDispatchError(error));
}
```

- [x] 扩展 RED/GREEN：异常单行 claim ACK 不得调用 special/generic；异常 INSERT ID/行数不继续派发；已有 pending 的 scheduled 去重分支同样预留；缺失/过期/跨 drain/ambient mismatch 在 IO 前失败；关闭后原有合法子工作仍可继续；实际 tasks/batch caller 在第一个合成 users 查询边界验证继承，不运行模型。
- [x] 只读独立审查，必要修复先加反例；新测试与相关 planned/scheduled/poller/controller/owned 回归分批串行；完整后端 tsc、改动TS Biome、diff check。
- [x] 精确本地提交，更新覆盖清单、PROGRESS、当前自动化断点。下一完整单元为 planned poller 的接纳、notify/queue lifetime、sync/stop/未知屏障。

## 本地验证记录（2026-09-10 20:56 JST）

- 初始合成mysql2日期采用Date对象导致dispatch未到special，改为真实wire格式字符串；idle断言须先close。这两项fixture问题不算RED。修正后23条真实接纳/持有/回执/权限反例RED→GREEN；special结构错误与缺少持久化证明3条追加RED→GREEN。
- 新增40项本地测试：原始读写/commit/rollback、queue ACK后detached占用、迟到失败、已有pending分支、非法继承、异常INSERT与UPDATE ACK、明确CAS0、关闭后实际tasks/batch内部caller、账号门禁取消事务、无scope兼容和special预留子owner/父结束后不能复活。
- 独立只读reviewer未发现Critical/Important/必修Minor。最终18文件329/329通过（15.12秒）；完整后端tsc --noEmit、3TS Biome、git diff --check通过。旧localstorage-file警告保留，不称全仓lint/tests或真实MySQL/模型/生产通过。
- 主工作区8草稿、codex/qwen-delivery-contract=66f3a583及PR237 manifest ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40现场核对未变。最终内存空闲69%，磁盘144GiB；没有安装/新启Docker/浏览器或生产访问。后续仍需planned poller与完整进程覆盖，不得发布局部组件。
