# 受管浏览器本体资源排空实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。沿用单主实现与唯一只读reviewer，重任务串行。

**Goal:** launchManaged创建的Browser从原始launch派发至绑定close实际结束持续登记，关闭失败不得被吞掉并伪造idle。

**Architecture:** 专用OwnedManagedBrowser只暴露ready与绑定dispose，与context资源分开登记；创建scope交付后seal，释放仅私有pin持有。executor保存每轮browser lease，在context实际清理后请求browser dispose；异常与重复清理保留同一回执。外部CDP所有权不纳入此单元。

**Tech Stack:** 现有TypeScript/ExecutionDrain/startOwnedOperation/withOperationDispatchScope/Vitest，无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md、2026-09-10-process-drain-coverage.md。

## Global Constraints

- 基线3b6503de，codex/qwen-safe-drain现有隔离worktree；保护主8草稿与冻结PR237。总任务约10GB、Node堆2048MiB、Vitest单线程无文件并行且每批最多20文件。free<40%或磁盘<10GiB不启动重任务。reviewer不与重任务同时运行。
- 不安装、不新启Docker/真实浏览器、不访问真实网络/生产/身份秘密。禁止领域、配置与Qwen browser gate/boot注入不变。完整机制/所有发布门禁之前不PR合并部署此局部组件。
- browser.close的SDK回执不是OS进程组/后代清理证明；外部CDP连接/reconnect、pool hook/timer、OS生命周期、其他入口/全局stop仍阻断发布。

## 已核对路径与根因

launchManaged原始launch在setup已捕获错误前没有未知登记；成功后context销毁可能使drain归零而Browser仍存续。disconnect的browser.close采用best-effort吞错、清字段后失败不留回执。setup catch与disconnect已避免双关但没有资源pin。外部connect/reconnect不拥有进程，本单元不改变其close规则。

## 文件与接口

- 新增apps/orchestrator/src/agent/vision-loop/owned-managed-browser.ts：接口OwnedManagedBrowser={readonly ready:Promise<Browser>;dispose():Promise<void>}；createOwnedManagedBrowser(chromium:{launch?:(options:{channel?:string;headless?:boolean})=>Promise<Browser>}, options, isActive:()=>boolean)。isActive是executor私有generation布尔谓词，不是可替换清理动作；cleanup只调用已取得Browser.close。
- 修改playwright-executor.ts：新增managedBrowserLease字段；launchManaged/runConnectionSetup/disconnect接线，删除这些方法中的直接managed close调用和已无读取的ownsBrowserProcess字段/赋值（connect仅删除这一赋值）；其他行为不改。
- 新增playwright-executor.managed-resource.test.ts：真实公共executor+真实drain，constructor合成SDK+受控Promise，无真实浏览器。
- 适配context-resource测试：managed context dispose后Browser仍须disconnect才idle；不能把两个资源等同。
- 更新coverage与本计划、原QA ledger/自动化断点。

## 步骤

- [x] **RED原始失败与资源存续：** launch getter/sync/async错误返回ok:false之前unknown保留；context dispose后Browser仍active，重复disconnect挂起至真实Browser.close结束；close getter/sync/async错误反复disconnect仍失败、unknown保留、不重试。使用startOwnedOperation真实root且关闸后断言。

```ts
await root.result;
await executor.disposeCleanContext();
expect(drain.snapshot().idle).toBe(false);
const done = observe(executor.disconnect());
await flush();
expect(done.state.done).toBe(false);
closeGate.release();
await done.finished;
expect(drain.snapshot().idle).toBe(true);
```

- [x] **RED清理顺序与权限：** context.close挂起期间Browser.close不得派发；context.close失败后仍尝试Browser.close且未知不得清除。父ACK/blocked/unknown/sealed后仅绑定close仍运行；捕获launch scope在ready后不能派发新操作。启动挂起时disconnect/取消、getter同步触发dispose/unknown/block等不得派发后续SDK或发布迟到Browser；无scope旧路径保持同样协调。并发launch不得重复启动。
- [x] **GREEN专用lease：** parent准入与unknown检查后同步reserve，deferred action实际launch getter和调用均在try内；getter后重新检查generation/isActive、drain dispatch/unknown，控制拒绝known，实际getter/SDK抛错unknown。无launch方法known拒绝。launch已完成但不再有效时仅清该Browser；ready之前seal acquisition scope，等待dispose信号；finally直接await绑定close，失败标unknown并保留原始result。dispose内部装拒绝观察者，无任意action/owner/release接口。

```ts
// Shape only: acquire uses the exact chromium receiver and fixed options.
const lease = createOwnedManagedBrowser(this.chromium, options,
  () => generation === this.cleanContextGeneration);
this.managedBrowserLease = lease; // before deferred SDK launch
const browser = await lease.ready;
// newContext + generation checks remain under existing setup scope.
// Failure: await contextLease?.dispose().catch(...), then lease.dispose().
// Disconnect: await allSettled(context disposal, setup), then stored browser lease.dispose().
```

- [x] **GREEN真实调用方与回归适配：** setup首await后先等待旧context/browser清理回执，失败禁止替换资源。catch先清本轮context再清本轮browser；disconnect即使browser字段空仍等待setup/context和已有browser lease，失败回执不清空。不引入等待自己setup的环；不提前关闭context未收尾的Browser。无scope正常重启仅在上轮全部成功后允许。
- [x] **最终验证与本地提交：** 新矩阵、context37、connection40、clean/executor/raw/owned/drain/pool相关≤20文件单线程回归；完整后端tsc、新增/所改方法Biome、其他方法一致性、独立审查及修正后的最后重跑。精确提交本单元文件，记录证据/HEAD/资源/下一边界；不把SDK终态宣称OS退出，不单独发布。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-loop/playwright-executor.managed-resource.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 证据

- 06:42 JST基线context37/37通过；free70%、磁盘143GiB。原HEAD3b6503de、仅qa-artifacts未跟踪。
- 设计审查无Critical/Important；要求旧资源清理、setup catch、disconnect全部context先收尾、拒绝后仍尝试browser close；setup不能等待全局disconnect。纳入实现与测试。
- 06:45:36 JST初始17项12有效RED+5兼容，无超时/unhandled；失败为原始launch/close错误漏记、context已关Browser未关却idle、getter触发关闸/unknown后仍launch、失败回执丢失。06:46:41最小实现17GREEN。
- 06:47旧context37、connection40、clean5中仅1项旧预期需适配：managed context.close完成不能再直接期待idle，必须先disconnect Browser。其余81通过。适配时保留context已收尾但Browser仍active的断言。
- 扩展无scope失败、外部CDP不关闭、缺launch已知拒绝及迟到launch遇block/unknown共22项；06:48:47新22+context37共59GREEN。阶段性完整后端tsc退出0，新/适配3文件Biome通过（修正变量声明格式和escape全局名遮蔽，无规则忽略）；最终审查和扩大矩阵待完成。
- 独立审查确认缺launch方法的无资源known拒绝不应污染以后外部CDP连接。06:51:17补真实后续connect断言有效RED（1失败21通过），仅该分支rejectReady后成功返回，实际getter/launch/close错误仍保留失败。06:51:44新22+context37共59GREEN；3个实质改动方法机械格式化及stdin lint输出一致。
- 最终独立复审无Critical/Important/必修Minor。06:52:37 JST最终10文件282/282（6.70秒）：managed22、context37、connection40、clean5、executor47、raw46、owned16、drain20、pool stop23、pool26。06:53完整后端tsc退出0，新/适配3文件Biome与git diff --check通过；AST确认44个其他成员（含构造器及route handler所在方法）逐字不变，connect仅删除无读取旧字段赋值。free70%、磁盘143GiB，全部重任务串行，未安装/启Docker/真实浏览器/生产访问。
- 本单元仅本地提交，不推送/PR/部署。下一步3D-3b-3c-6仍需明确external CDP WebSocket/reconnect资源所有权、pool后台hook/banner timer与OS收尾；完整发布门禁仍未达到。
