# 浏览器池后台初始化与Cookie原始IO排空计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，仅复用review_qwen_negation只读审查；重任务串行。

**Goal:** 后台初始化不因allocate返回而漏计，停止时取消尚未开始的timer、等待已开始hook及其原始IO，然后才能释放连接。

**Architecture:** 分两个可独立审查边界：7a先登记cookie原始DB/SDK并阻止未知后的重试/删除；7b再接pool timer/hook的预留、取消、等待和浏览器raw操作settlement。仅7a通过不能宣称pool后台已排空，完整机制前不发布。

**Tech Stack:** 现有TypeScript、ExecutionDrain、owned-operation、Vitest，不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；2026-09-10-process-drain-coverage.md。

## Global Constraints

- 已在codex/qwen-safe-drain隔离worktree，基线662d23ef；保护主8草稿及PR237冻结候选和manifest。约10GB总预算，Node堆2048MiB，Vitest每批≤20文件且显式单线程/无文件并行；free<40%或磁盘<10GiB不启重任务。
- 当前已过2026-09-11 08:30 JST，不启动生产变更。无安装/新Docker/真实浏览器/数据库/网络/秘密/真实身份或业务文本。支付、奖励、提现、Partner Ledger、额度、注销、DivineAPI及供应商配置不变。
- Cookie白名单、加密、映射和无scope兼容不变；未知只保留证据，不自动重试或删除pending行。SDK Promise不代表OS/后代退出；Qwen browser和boot注入保持关闭。

## 调查与边界

browser-pool.ts约650的3秒setTimeout没有保存/取消回执，约700的onInstanceReady脱离allocate；tearDownInstance直接disconnect。index.ts的hook先getPage，再injectPendingCookies并catch。sync-service.ts两次select、五条delete及bulk/per-cookie addCookies均为实际原始调用；bulk失败目前直接重试，最后删除pending行。新受控scope里这种未知后续派发违反排空规范，无scope保留既有行为。

7b不能只包hook：getPage和dismissBraveBanners存在withTimeout，外层结束不证明内部SDK结束。须独立处理实际raw settlement，再接release/stop；不在7a混入未审查的通用权限/cleanup能力。

## 7a：Cookie原始DB与SDK（当前完整实施单元）

设计审查补强：五个DELETE按现有mysql2回执形状严格校验affectedRows为数值0或1，缺失/字符串/负数/大于1等在database owner释放前保留unknown；无scope不改旧回执行为。SDK getter后明确控制拒绝用私有捕获错误/sentinel在raw wrapper外传播，不能误记未知。校验须绑定调用方原始ALS scope而非只读新建raw子scope，避免getter封闭父scope后仍续发；不导出恢复权限接口。

**Files:** 修改apps/orchestrator/src/cookies/sync-service.ts；新增cookies/sync-service.drain.test.ts；更新本计划与coverage。upsertPendingCookies和crypto/schema不改。

**Interfaces:** 既有injectPendingCookies(opts):Promise<number>和injectCookies(context,cookies):Promise<void>签名不变。新增私有runCookieDatabase<T>(action:()=>PromiseLike<T>):Promise<T>，在当前scope检查权限/unknown，用startOwnedOperation(kind=database,dispatch=immediate,errorOutcome=unknown)登记完整thenable；没有scope直接执行，不建root。addCookies复用runBrowserOperation，但每次读取SDK方法后、真实调用前再检查当前scope的dispatch/unknown；准入失败不被降级为成功删除。内部assertCookieDispatch只校验，不创建/恢复owner。

- [x] **RED物理IO寿命：** 两次select、各delete分支、bulk addCookies及无scope fallback逐个held Promise；父ACK之后按database/execution种类仍活动，原始settle后才释放。真实service与drain，底层合成DB链/SDK，不mock service或计数器。

```ts
const root = startOwnedOperation(drain, 'request', async () => {
  pending = injectPendingCookies({ db, context, userExternalId: 'synthetic' });
  void pending.catch(() => {});
}, { dispatch: 'immediate', errorOutcome: 'known' });
await root.result;
drain.close();
expect(drain.snapshot().byKind.database).toBe(1);
releaseRaw();
await pending.catch(() => {});
```

- [x] **RED错误及后续派发：** DB/SDK同步、getter、异步失败在catch前保留unknown；bulk失败不得续发per-cookie/最终delete。block/unknown/sealed/过期owner在初始或中间操作前阻止真实调用；getters触发关闸后SDK零调用。没有scope保持bulk失败逐个重试、错误best-effort，以及JSON/空行/解密错误的原清理分支。
- [x] **GREEN最小接线：** 所有injectPendingCookies实际DB链置于惰性私有wrapper，bulk/per-cookie SDK置于runBrowserOperation；catch和后续delete前校验当前派发权限，未知保留pending行。维持参数、receiver、返回计数、加密优先级/映射/白名单与无scope结果；不改upsert。

```ts
const [userRow] = await runCookieDatabase(async () =>
  opts.db.select({ id: users.id }).from(users)
    .where(eq(users.externalId, opts.userExternalId)).limit(1));
// The same wrapper encloses the complete pending select and every delete.
// addCookies: read the method inside runBrowserOperation, validate again,
// then call with the bound context and original mapped payload.
```

- [x] **独立审查与最终验证：** 新矩阵+原sync/crypto+owned/drain/browser/pool回归≤20文件，全后端tsc，变更文件Biome、未改upsert/映射/白名单字节一致及diff。失败则修复复审，全部通过才精确本地提交7a；QA ledger和原自动化断点更新。

## 7a验证记录

- 2026-09-11 08:44现场HEAD662d23ef、仅QA未跟踪，memory free72%、磁盘143GiB；同一隔离worktree，无安装或生产访问。
- 08:50:52 JST真实service上25有效RED+3兼容（原始计数为0、关闸后继续派发、getter调用及未知记录缺失）；08:51:24 ACK补充8有效RED+3兼容。最小接线08:52:16新39/39通过；继续扩展各删除分支ACK、DB getter、SDK getter后sealed/blocked/unknown及注入后关闸不删除，共51项。
- 08:53:07新51+原sync3/crypto8/owned16/drain20，共98/98，1.09秒；完整后端tsc退出0，两文件Biome及其他9个声明（含upsert、白名单/schema、映射）逐字一致。独立最终审查和最终完整回归随后执行，不把该中间结果当发布门禁。

- 最终独立只读审查无Critical/Important/必修Minor；08:55:19 JST最终14文件365/365通过，7.70秒（新cookie51+原cookie11+此前browser/owned/drain/pool303）。完整后端tsc再次退出0，两文件Biome/diff通过；9个其他声明逐字不变。最后free70%、磁盘143GiB，Node2GB及显式单线程无文件并行。仅7a本地完成，未运行实际网络/DB/浏览器/Linux/PM2/千问/生产/build。

## 7b：后台协调（后续单元，尚未完成）

在7a完成后，读取getPage/dismissBraveBanners原始timeout与runBrowserOperation，明确如何收集实际raw结束回执而不重建权限。pool每实例用私有生命周期对象（按实例身份而非可变taskId）持有timer和hook，首个回调前同步reserve。stop同步取消未开始timer、封闭派发scope，等待已开始hook及raw settlement；capture已有资源的cleanup仍允许。retained adoption不丢回执，shutdown也覆盖正在allocate的late实例；发生capacity/getter/取消异常时清理已取得executor且不遗留registry/slot。

下一次先把这条边界的具体接口、取消/等待次序、hook自等待/重入风险与测试写完整并独立审查，再TDD。7a不修改pool/index，不用外层Promise结束替代底层资源回执。未来route事件、OS终止、其他入口、boot/对账/维护/平台/真实千问/生产门禁仍独立阻断发布。
