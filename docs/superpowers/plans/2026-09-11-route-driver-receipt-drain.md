# 请求内部driver回执排空实施计划（3D-3b-3c-9a）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，只复用review_qwen_negation只读审查，审查与重任务串行。

**Goal:** 固定网络route的safeRace提前结束时，资源仍等待已派发内部channel Promise；迟到失败或连接断开不能伪装为已确认完成。

**Architecture:** 扩展已有固定SDK事件边界，每个事件在原SDK listener之前核对真实Route/Request与归属并预留完整事件位置。仅此Route实例的_raceWithTargetClose记录传入的原始channel Promise，保留SDK原safeRace行为；事件位置直到原listener与其所有已派发channel Promise实际settle才释放。沿用同一Browser资源pin、close后等待事件的两阶段次序，不关闭共享Connection。

**Tech Stack:** 固定Playwright/core1.59.1、TypeScript、现有ExecutionDrain/Vitest；不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md及2026-09-10-process-drain-coverage.md。

## Global Constraints

- 基线b7183db0、codex/qwen-safe-drain、现有隔离worktree；主8草稿/PR237冻结包/QA保持。
- Node堆2048MiB，Vitest显式maxThreads=minThreads=1与no-file-parallelism，每批≤20文件；free<40%或磁盘<10GiB不启重任务，总任务约10GB。
- 08:30 JST生产窗口已过；不部署、不安装/Docker/浏览器/网络/DB，不触支付等禁止领域，不读出秘密/身份/业务文本。
- 仅改固定route内部回执，不改变网络允许范围、SDK原safeRace、Browser.close权限或共享Connection；不实现OS kill/reaper，不把Connection.close清表当远端结束证明。

## 已核对事实与范围

client/network.js Route.abort/continue先创建_channel Promise，再交_raceWithTargetClose；后者调用Request._targetClosedScope().safeRace，Worker/Page关闭可先返回undefined。client/connection.js sendMessageToServer的Promise等待_callbacks收到响应，但Connection.close会统一reject并清表；拒绝必须保留unknown，而不是推断driver提交未发生。当前pool killAll仅信号，tearDownInstance仅TERM/宽限/KILL；仍不证明OS后代退出，本单元不改这部分。

本单元跟踪的是**固定route的client-channel真实Promise**，不是所有driver命令，也不证明driver远端动作或OS已结束。响应错误、传输关闭或不可信SDK边界保留unknown；没有可用回执时保持pending，不能通过超时/清表/重放收口。

独立设计审查补充：_race包装仅是事后回执观察点，不是派发闸门，收到promise时_channel已调用；不得以容量为由丢弃任何已收到promise。准入与1024容量在原listener之前。原listener失败立即report unknown，再finally等其他raw。父对象链有界且循环拒绝，Route的Request parent与真实SDK一致；不用GUID认证。保留受控包装，不恢复原方法。

独立审查已同意的派发前补强：abort/continue安装固定原Route receiver的实例委托，共享单次标记，在原方法调用前同步占用；首次失败不能改用另一方法重试。重复或inactive调用在channel派发前固定拒绝，不触碰已结束owner。原listener和全部raw结束后才inactive并释放事件位置。调用前及终态再验三个包装、原方法、channel与有界context归属，漂移失败关闭。已取消且尚未派发的正常分支仍允许首次abort。直接绕过公开方法、人为调用私有_race并传入已经派发的Promise不在准入保护承诺内；它不能被事后拦截，也不是通用安全调用接口。

## 文件与接口

- 修改apps/orchestrator/src/agent/vision-loop/browser-route-events.ts：维持createRouteEventBoundary(context,browser,enter,onFailure)公开内部签名及seal/settled接口。在单事件operation内新增私有Route观察逻辑，不暴露任意action/finish/owner或新root。
- 修改同目录browser-route-events.test.ts：沿用真实SDK fixture；新增实际Worker及它的close事件，让真实Request._targetClosedScope().safeRace提前结束；driver响应可hold/成功/错误/Connection.close。Browser.close和driver响应是合成边界，不称真实浏览器验证。
- 更新本计划及coverage，完成后写QA ledger与原自动化断点；不修改executor/pool业务及其他SDK调用。

## 一个完整实现单元

- [x] 设计审查确认原始回执观察点与有界事件位置，原listener运行前验证真实Route/Request类、_connection与context一致、原_raceWithTargetClose方法/prototype；拒绝未知/重复Route实例，在任何此事件SDK派发前失败关闭。路由scope只供固定abort/continue路径，不能成为任意调用包装器。
- [x] RED：真实Worker关闭让原SDK事件safeRace结束，故旧边界在driver回执hold时提前idle；同时测late成功、late失败和Connection.close。

```ts
const f = fixture(false, { method: 'abort', promise: held });
const owned = await ownedFixture(f);
const event = f.emitWithWorker();
await flush();
event.worker._channel.emit('close');
await flush();
const closing = observed(owned.lease.dispose());
expect(owned.closed()).toBe(1);
expect(closing.done).toBe(false);
expect(owned.drain.snapshot().idle).toBe(false);
release();
await closing.finished;
expect(owned.drain.snapshot().idle).toBe(true);
```

- [x] GREEN：单事件进入前已经占用pending事件槽（1024），私有Route观察器在原listener之前安装。实际_raceWithTargetClose(promise)将原promise的成功/失败观察链加入本事件集合，失败调用固定report、不输出原error；仍返回原race方法.call(route,promise)。原listener结束后不释放事件槽，先allSettled全部已登记channel Promise，再核验Route包装未漂移。BrowserRequestGuard.stop仍等待registration/policy/publiccontinue；实际close后等待完整事件含内部回执，允许已有continue的内部Promise在safeRace已返回后与close并行收尾，避免close/回执互等。

```ts
const raw = new Set<Promise<void>>();
// The event slot/resource pin is already reserved before the original SDK listener runs.
const race = (promise: Promise<unknown>) => {
  const receipt = promise.then(() => {}, report);
  raw.add(receipt);
  void receipt.then(() => raw.delete(receipt));
  return originalRace.call(route, promise);
};
try { await originalListener(); }
finally { while (raw.size) await Promise.allSettled([...raw]); }
```

- [x] 补回归：abort/continue两类、CDP/managed两类、成功/late failure/连接断开、不同事件一个失败另一pending、真实SDK错误不新unhandled、unknown不清除、stop后无continue、关闭后无新原listener、1024位置不能因safeRace返回提前腾空；重复Route或未知方法零派发且failedclosed。真实SDK的固定回调每Route仅发一次abort或continue，无retry；不在Promise已经派发之后以容量为由丢弃它。
- [x] 运行SDK新矩阵和相邻18文件回归、完整后端tsc、变更文件Biome、git diff --check，独立复审无必修项，达到本单元精确本地提交门槛。提交SHA及原holaday自动化更新读回记录以QA PROGRESS本节点为准；下一步从未覆盖driver/OS边界继续，不重复9a。所有平台/全入口/boot/维护/真实模型/生产门禁保持阻断。

## 验证记录

- 10:45 JST起现场确认HEAD b7183db0，仅qa-artifacts未跟踪；free68%、磁盘142GiB。已读取实际SDK network/connection/Browser/Worker、pool终止路径，仅源码调查，没有外部进程或网络试验。
- 10:51:17 初始12项safeRace矩阵有效RED；10:52:09 归属/循环/未知race与容量4项有效RED。原23项兼容保留。
- 10:59:35 42项中3失败：pending重复公开调用、首次失败后改用continue两个有效RED；原错误计数回归显示同一失败被raw观察与listener重复报告，改为单次失败状态转移，保留unknown。11:00:40 42/42 GREEN。
- 11:01:45 增补等待期间channel/parent漂移两个有效RED（实际发出了continue），原race漂移、重复事件、listener立即失败与跨事件pending是通过的补充回归。11:02:26 48/48 GREEN。
- 完整后端tsc退出0；两文件Biome格式化及检查通过。相邻18文件与最终独立审查待记录。
- 11:03:14 相邻18文件477/477（8.69秒）通过。独立审查发现terminal校验getter抛错会跳过inactive；11:07:27真实SDK反例有效RED（dispose后恢复属性，late abort仍成功）。将安装纳入try并在完整raw等待的finally中先永久inactive，再固定处理终态校验异常；11:08:03 49/49 GREEN。该修复后重跑全矩阵及最终复审，不把此前477项结果当最终版本证据。
- 11:09:06 JST最终18文件478/478（8.74秒；SDK49，其余429），修复后完整后端tsc退出0；两文件Biome无修复通过、git diff --check通过。只运行单线程合成driver/SDK边界测试，未做实际driver/OS/网络/生产/build或全仓历史lint。唯一review_qwen_negation最终只读复审确认上一Important已关闭，无剩余Critical/Important/必修Minor；只允许本单元本地提交，不构成整机制PR/部署许可。
