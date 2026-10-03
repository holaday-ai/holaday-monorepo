# 外部CDP连接资源排空实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，只复用现有reviewer；重任务串行。

**Goal:** 从connectOverCDP派发至连接实际关闭持续计数，重连不能直接丢弃旧句柄并报告排空。

**Architecture:** 专用OwnedCdpConnection区分SDK连接与外部浏览器进程。ready交付后资源pin持有至绑定Browser.close结束；context先收尾，随后关闭连接。重连复用同步setup锁，先关闭旧连接再发起新连接，失败不遗忘旧回执。

**Tech Stack:** 现有TypeScript/ExecutionDrain/Vitest与Playwright 1.59.1，不加依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md、2026-09-10-process-drain-coverage.md。

## Global Constraints

- 基线5d0a0c44，既有codex/qwen-safe-drain隔离worktree；主8草稿、冻结PR237/manifest不变。总预算约10GB、Node堆2GB、Vitest每批≤20文件且显式单线程无文件并行；reviewer与重任务串行。free<40%或磁盘<10GiB不启重任务。
- 不安装/新启Docker/真实浏览器，不访问生产/真实身份或秘密。支付/奖励/提现/Partner Ledger/额度/注销/DivineAPI/供应商配置不变。完整机制与所有发布门禁之前不单独发布；08:30 JST后不启动新生产变更。
- SDK关闭不证明外部进程/OS组/后代退出；也不替代未来route callback、pool hook/timer及其他入口全局排空。Qwen browser gate和boot注入关闭。

## 权限语义证据与根因

本机node_modules实际Playwright/playwright-core均1.59.1。client/browser.close经channel调用server/browser.close；server/chromium._connectOverCDPImpl用browserProcess={close:doClose,kill:doClose}，doClose等待WebSocketTransport.closeAndWait及自有artifactsDir清理，不向外部进程发送Browser.close协议。官方文档 https://playwright.dev/docs/api/class-browser#browser-close 说明连接方式下断开浏览器服务器；显式创建的context应先close。以上只读源码/文档核对，不对用户浏览器操作。发布前仍需核对实际运行依赖并做自有合成平台验证。

当前connect原始调用结束即释放raw pin；disconnect只清字段，reconnectIfStale主动抛弃旧句柄避免死WebSocket等待，均不能证明连接已释放。本计划改变的是SDK连接收尾，不获得关闭外部进程/默认页面的权限，不调用ctx.close或page.close清外部默认context。

## 文件与接口

- 新增apps/orchestrator/src/agent/vision-loop/owned-cdp-connection.ts：createOwnedCdpConnection(chromium:{connectOverCDP:(endpoint:string)=>Promise<Browser>},endpoint:string,isActive:()=>boolean):{readonly ready:Promise<Browser>;dispose():Promise<void>}。固定绑定一个SDK连接，无任意cleanup/action/owner导出；私有generation谓词只拒绝迟到使用。
- 修改playwright-executor.ts：新增cdpConnectionLease字段；connect与reconnectIfStale共用私有initializeCdpConnection(generation,endpoint,opts,requireContext)，整体由runConnectionSetup锁覆盖，包括重连contexts验证及捕获lease清理。connect由专用lease替代原raw包装；runConnectionSetup/disconnect在context完成后依次清managed/CDP lease。自动重连先拒绝cleanMode，绝不以默认opts降级隔离；只有新的显式connect按opts设置cleanMode，避免受管完全关闭转外部后误用已释放clean context。
- 新增playwright-executor.cdp-resource.test.ts；适配connection/context/managed/pool现有SDK fixture的真实close方法和资源结束断言。不能mock executor自身的connect/disconnect；仅constructor SDK与进程/网络传输合成。
- 更新coverage、本计划、原ledger/自动化，精确记录验证与未覆盖边界。

## 实施步骤

- [x] **RED资源持有/失败：** 默认与clean连接成功后父ACK不idle；并发disconnect等待实际close，context挂起不先关连接，close getter/sync/async失败unknown且同一失败回执不重试。迟到连接遇取消/block/unknown不发布、不创建context，但绑定close必须收尾。固定外部默认context/pages的close计数零。

```ts
await connectDone.finished;
expect(drain.snapshot().idle).toBe(false);
const closing = observe(executor.disconnect());
await flush();
expect(closing.state.done).toBe(false);
closeGate.release();
await closing.finished;
expect(drain.snapshot().idle).toBe(true);
```

- [x] **RED重连：** 真实getPage触发contexts为空恢复，旧连接关闭挂起期间新connectOverCDP次数仍1；关闭成功之后才2。失败不得重拨；pending重连期间disconnect不能被迟到结果复活。无scope路径同样等待，cleanMode丢失不进入默认context；受管完全关闭后外部connect可访问默认页。
- [x] **GREEN专用连接lease：** 模仿已验证的专用resource结构但只绑定connectOverCDP返回句柄；准入预留在getter前，getter后实时generation/dispatch/unknown；真实getter/SDK错误unknown，取消控制拒绝known。ready前seal，dispose终态共享，finally始终等待绑定SDK close，不建新root或绕过失效scope。

```ts
connection = createOwnedCdpConnection(this.chromium, endpoint,
  () => generation === this.cleanContextGeneration);
this.cdpConnectionLease = connection;
const browser = await connection.ready;
// Existing context creation/initialization proceeds in setup scope.
// Catch: finish captured context, then captured connection; no global disconnect await.
// Reconnect: reject cleanMode and overlapping setup/disconnect first,
// then runConnectionSetup(g => initializeCdpConnection(g, endpoint, {}, true)).
// initialize validates contexts inside the setup lock; catch closes captured leases.
```

- [x] **GREEN真实接线与兼容：** disconnect等待setup与context，再保存managed/CDP清理结果并传播第一个失败。runConnectionSetup旧失败不能被替换，旧清理的失败后仍完成其他已拥有的cleanup。重连context仍0时关闭新连接后返回false；不复活已取消轮次、不关闭外部默认页/context。原无scope合成用例补完整SDK close而非吞missing方法错误。
- [x] **最终验证与收口：** 独立审查后串行执行新矩阵及executor/connection/context/managed/raw/owned/drain/pool相关≤20文件，全后端tsc，新增/所改方法Biome和未改方法一致性。所有通过后精确本地提交，不PR/部署局部组件。记录依赖语义证据、不把SDK证明当OS或生产验证。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-loop/playwright-executor.cdp-resource.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 审查与证据

- 最终独立只读审查无剩余Critical、Important或必修Minor，允许最终验证后本地提交；审查本身未运行测试。2026-09-11 08:02:00 JST最终11文件303/303通过，6.85秒（CDP21、managed22、context37、connection40、clean5、executor47、raw46、owned16、drain20、pool stop23、pool26）。完整后端tsc退出0；6个新增/适配文件Biome、5个修改方法stdin格式/lint、45个其他成员逐字一致及git diff --check通过。
- 资源检查free68%、磁盘143GiB；Node堆2048MiB、Vitest显式单线程无文件并行，所有重任务与reviewer串行。没有实际网络/浏览器/OS/Linux/PM2/数据库/千问/生产或发布build验证；此单元仅本地收口，不是完整发布门禁。

- 07:45基线connection40/40；free72%、磁盘143GiB。设计审查要求自动重连拒绝lost cleanMode，及setup锁覆盖contexts校验/捕获lease清理；采用私有共用初始化方法而非connect返回后锁外disconnect，纳入TDD。
- 07:48:46 JST初始15项全部有效RED，无超时/unhandled；07:50:09最小实现15GREEN。旧8文件246项中35项失败来自旧资源寿命断言、缺SDK close fixture以及原来不调用CDP close的行为约定；补真实close fixture、显式等disconnect、调整SDK连接关闭计数（仍不调用默认context/page close），未删除失败断言。
- 补contexts验证重入锁与取消、getter后取消/block/unknown、迟到连接关闸清理，新增21项。07:54:46 JST新21+context37+managed22+connection40+clean5，共125/125通过。5个修改/新增executor方法机械格式与stdin lint输出一致；45个其他成员含构造器/getPage/未来route handler所在方法逐字不变。类型检查指出测试数组索引可能undefined，补显式缺省值后重验；不是生产实现失败。
