# 本机排空控制实施计划（第二阶段 B）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，最多复用一名只读审查者；重任务与审查串行。

**Goal:** 实现默认关闭、固定有界协议、单连接所有权和一次性开放授权的本机控制单元。

**Architecture:** DrainController独占自己的ExecutionDrain及DrainStateStore，不接受可能错配的两个实例。Unix socket仅承载规范JSON命令；授权验证由可信维护集成提供，未提供则拒绝开放。断连、过期、存储错误不能因延迟授权再开放。

**Tech Stack:** 现有Node fs/net/crypto/performance、TypeScript、Vitest，无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md

## Global Constraints

- 任务内存预算约10GB；Node堆2GB；Vitest单worker每批最多20文件；重任务串行；空闲低于40%或磁盘不足10GiB不启重任务。
- 无安装/新Docker/额外浏览器；不访问生产、不使用过期窗口，不合并部署局部组件，保留PR237冻结包和主区8份草稿。
- 不触支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI和旧供应商配置，不输出凭据、身份或业务文本。

## 接口与协议

新增execution/drain-control-protocol.ts（固定编解码）、drain-controller.ts（状态与授权）、drain-control-server.ts（本机传输），分别由controller/server真实行为测试覆盖。测试种子沿用前阶段真实0700目录、0600合成closed/clean旧boot记录，不代表生产bootstrap。

`DrainController(directory, identity, authorizeOpen?, clock?)` 自建readonly `drain` 与 `state`。authorizeOpen是可信维护边界的异步只读核验函数 `(command: Readonly<DrainCommand>) => Promise<void>`，缺省拒绝。它必须在真实集成中核对旧工作收口、外部门禁、单账号pin及新租约；禁止从核验回调派发业务副作用，当前单元不提供生产成功实现、不在wire中接受proven=true。clock为wall/monotonic函数，缺省Date.now/performance.now。测试时仅替代时钟和未来外部核验，不替代真实文件/计数器。

命令固定字段：`protocol:1, op:status|close|open, epoch, candidate, bootId, version, serial, expiresAt`。身份格式与持久记录一致；version等于当前持久sequence，serial严格等于上次受理+1，正安全整数；expiresAt为有效未来毫秒且距现在不超过15分钟。规范JSON固定键顺序加换行，最多1536字节，重复键/额外字段/无效UTF8拒绝。响应只含固定错误码或协议版本、serial、持久状态及聚合snapshot，无回显输入。

`connect(): object`取得唯一不透明会话；重复连接拒绝。`execute(session, bytes): Promise<response>`至多一条在处理，不排无界队列。校验身份、时限、serial、version后消费serial。status/close在回执前checkpoint；open只尝试一次，消费许可后await可信核验，返回后再次验证连接、时钟、版本、真实idle，再prepareOpen、重验时间和同步open。最终持久状态读完后、成功回执返回前做不含文件IO的时间/会话复核。拒绝、超时或断连不会回滚已消费许可。没有清除unknown、抢锁、初始化或任意业务确认命令。

授权等待与会话失效信号竞争；断连、租约失效、关停或存储故障使控制等待有界结束，新会话仍能查询状态。原只读核验Promise的迟到成功/失败继续被观察，绝不声明其已取消或据迟到结果重新开放；每个execute只释放自己不透明commandOwner，不能清另一条命令的busy。每boot仅一次open尝试使永久挂起的原核验最多一个。核验返回契约必须是Promise/thenable且resolve为undefined；sync undefined或Promise<boolean>均拒绝，避免把错误的布尔返回当放行。

`disconnect(session)`先关闸再checkpoint；旧会话不能影响后来连接。`tick()`检查墙钟倒退、单调时钟倒退、固定绝对租约和最多10秒连接活动超时，任何超限使当前连接失效并关闸；重复tick不自动重开。授权pending也受同一时限约束。`shutdown()`拒绝新连接并关闸；仅真实idle时release，否则持久dirty并等待下一次shutdown。不取消既有原始操作，不抹掉未知。未来真实入口必须用这里的drain/state，尚未接线不得宣称全进程排空。

`startDrainControlServer(directory, controller)`创建固定control.sock。目录必须规范真实0700/同uid，socket必须普通Unix socket0600/同uid/nlink1；检查不存在后bind，不删除遗留socket。Node自动socket unlink是风险：若所有权漂移，关闭监听不得删除替换文件，必须测试并采取安全保留策略。每条命令必须以LF结束；限制1536字节、1个未完成响应、唯一连接、socket活动超时；多帧管道/超长/非法输入断连并关闸。定时器每250ms tick并核对目录/socket身份；不提供TCP监听。close先controller.shutdown、销毁自有连接，关闭监听并清理自有socket；不触未知路径。异步故障只输出固定错误，不记录原始请求或fs路径。

路径替换时Node不能安全close：将唯一自有监听置为拒绝全部新连接、unref并停止watchdog，返回`{released, retainedListener:true}`；保留描述符直到进程恢复退出，不能称清理完成。正常路径仅同inode关闭，返回retainedListener=false。正常close不代表对端已瞬间收到关闭，对端以自己的close事件确认。控制端计时器不是入口/派发的原子时间闸；下一阶段必须在根准入和实际派发紧前重新核对控制状态、租约与持久化，不能仅依赖250ms watchdog。

## 单元步骤

- [x] 写controller失败测试并确认RED：缺少实现时显式导出断言；随后真实开关/存储状态断言。

```ts
const session = controller.connect();
await controller.execute(session, encode({op:'open', version:2, serial:1}));
const owner = controller.drain.admit('request');
controller.disconnect(session);
expect(controller.drain.snapshot().mode).toBe('closed');
expect(controller.state.read().dirty).toBe(true);
controller.drain.finish(owner);
expect(controller.shutdown()).toBe(true);
```

- [x] 实现编解码和controller，逐项RED→GREEN：默认拒绝授权，跨身份、旧version/serial/过期、重复key/大输入；延迟授权期间断连/到期/状态变化，第二连接、重复开放、真实unknown和原始子操作，存储损坏，时钟倒退。
- [x] 写真实Unix socket测试并先失败，再实现server：真实客户端分片命令/回应，0600检查、断连关闸、第二连接拒绝、遗留socket/软链接/替换路径保护、超长/管道/授权pending关闭、清理及定时失联。若沙箱限制本机监听，仅为自有临时socket请求工具授权，不退回mock网络。
- [x] 串行验证：cwd apps/orchestrator，`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/drain-controller.test.ts src/execution/drain-control-server.test.ts src/execution/drain-state-store.test.ts src/execution/execution-drain.test.ts src/execution/owned-operation.test.ts src/execution/core-execution-registry.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`；改动文件Biome、全量`tsc --noEmit`、diff检查。
- [x] 独立只读审查、修复反例并复验；精确本地提交本单元、记录测试时间/风险/下一步。不得合并/部署。

## 仍不覆盖

真实授权实现、生命周期所有入口和调度接线、跨进程首次维护与恢复、真实Linux/PM2集成、千问生产验收、新候选及有效发布窗口。这些必须后续完整通过，不以本单元可通信或合成许可当发布证明。

## 验证记录

- 2026-09-10 12:43 JST：138/138通过，0失败/跳过/未处理异常；6文件，实耗4.82秒，其中controller36、真实socket17、既有85。5个新源码/测试Biome及后端全量tsc通过。
- 初始controller显式缺失RED后默认拒绝GREEN；新增35项中33项失败后补实现；写盘耗过截止时间的反例先失败，再在持久化后紧前重验。socket初始缺失RED后在授权的自有临时监听下首项GREEN；14项中13项失败及1个未处理第二连接错误均修复；固定拒绝回执另经RED→GREEN。没有mock网络或生产访问。
- 发现vitest.config.ts的poolOptions.threads.maxThreads=4覆盖了先前maxWorkers参数的意图，12:43最终回归已显式覆盖线程数并关闭文件并行。此前134项运行不再作为单线程执行证据，不修改全局配置。
- 路径替换夹具的reject-only listener由测试worker退出回收描述符；仅清理自有临时目录。生产若出现retainedListener=true仍必须按维护恢复处理，不能报已完整关闭服务。
- 12:50 JST：独立审查提出最后读盘跨期和永久挂起verifier占住busy两项Important。3个真实读盘/时钟及never-settle反例先RED再GREEN；新增迟到成功/失败、真实socket重新查询、非法核验返回值（3个RED再GREEN）。最新147/147通过（controller44、socket18、既有85），5文件Biome和全量tsc通过，等待独立复审。控制超时不代表底层核验已取消，且仍无生产核验实现。
- 12:52 JST：独立复审确认两项Important关闭，无剩余必修；最终显式单线程/无文件并行回归147/147通过，实耗5.26秒，0失败/跳过/未处理异常。5文件Biome、后端全量tsc通过。本地提交SHA见PROGRESS最新节点。下一项为真实入口/后台链/原始操作和同进程调度完整覆盖的实施计划及接线，仍不发布部分基础组件。
