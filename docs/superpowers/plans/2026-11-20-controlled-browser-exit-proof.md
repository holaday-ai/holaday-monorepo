# Controlled Browser Exit Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. User requires one lane; no agents.

**Goal:** 先消除严格关闭链路漏清理，再为同一原始五单元建立可核验的停止/终态回执；在完整物理证据出现前保持unknown，不发槽位复用许可。

**Architecture:** 复用B2原manager、boot、资源能力、原进程pin、共享journal及Node组级IO归属。当前严格模式并非已经具备成功退出接口：root只实现create，Group.close只证明本地IO收口；真正stop与exit生产者仍缺，不能以换Linux或修改错误字符串替代。

**Tech Stack:** Node22.23.3/TypeScript、现有Python broker/native addon、Linux cgroup v2/systemd；不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-11-pool-process-containment-decision.md、2026-09-11-pool-quartet-wiring-design.md，以及2026-11-18-browser-assistant-release-readiness.md。

## Global Constraints

- 单路、无代理；测试heap1024MB/单fork、类型与构建2048MB；日志保存，重验证串行。
- 不新增模型/KMS调用、不重导出、不重放旧任务、不生产写入、不合并、不上线；既有AWS只读轮询独立持续。
- 不修改现有UNPROVEN、unknown、原始身份/观察守卫求绿，不用PID扫描或ChildProcess.close签整组退出。
- 当前Darwin缺systemd/pidfd/cgroup环境；Docker只读查询未及时返回，已仅终止自有客户端，未启动/停止Docker或容器。2026-11-21用户另行批准只在新Holaday-ExitLab准备官方最小环境与合成实验；现有Ubuntu和全局WSL不改。不在其他目标自行安装、切生产或扩大系统管理权限。

## Review Focus

- 收尾回调同步throw与Promise reject均不得跳过原SDK/组清理，失败仍保留。
- 同一stop重复调用与关机共享同一结果，不能重复副作用或释放物理槽位。
- leader/stdio结束、本地连接关闭、manager ACK和物理组退出分开核对。
- 原manager/unit InvocationID/cgroup/boot漂移、丢ACK、原始pin撤销或超时持续unknown。
- 空组观察后重新派发、其他组仍在途及旧boot记录不能被全局清零掩盖。

### Task 1: 严格释放的会话收尾错误不能跳过传输清理

**Files:** Modify apps/orchestrator/src/browser-pool/browser-pool.ts；Test apps/orchestrator/src/browser-pool/broker-pool-runtime.test.ts。

**Interfaces:** 消费PoolConfig.finishSession(executor):Promise<void>及原实例；保留BrowserPool.release(taskId):Promise<boolean>失败契约，不产groupExit证明。

- [x] RED：真实本地NAPI/Unix/HTTP/WS/SDK链路中，finishSession同步抛错，断连入口调用0次；同一hook返回rejected Promise的对照通过。
- [x] 最小实现：在Promise链内调用finishSession，再汇总错误，使后续原SDK及组清理必达；不吞错误。
- [x] GREEN：同步与异步失败都断连一次，原实际peer关闭，unknown>0、物理slot保留；重复release不得重跑finalizer。
- [x] 定向TS215/215及root侧Python78/78，严格类型/静态/后端构建通过；作者串行复核，无独立审查声明。格式前后发射JS token一致。

### Task 2: 原组停止事务与物理证据生产者（关闭意图已实现，停止/终态仍缺）

**Files to assess:** scripts/pool-broker/quartet_runtime.py、quartet_create_control.py、quartet_listener.py、quartet_records.py、resource_journal.py；新增的stop/exit模块与相应用例须先据原始句柄契约细化。apps/orchestrator/src/browser-pool/broker-control-protocol.ts、broker-pool-runtime.ts、browser-pool.ts为最终消费者，不提前发成功。

**Interfaces required:** close只接同一原资源能力和原boot，不接受任意PID/unit/path；同一持久stop事务绑定同一原manager、五个原unit/InvocationID及启动/停止job。终态生产者必须持原内核引用和终态封闭条件，不接受外部传入的success字典。公开DTO/协议字符串本身不构成退出能力。

- [ ] 先记录close intent并封闭该组新派发，独立管理与egress能力不互换；未知/崩溃重启只对账原事务。
  - [x] 内部原实例 `begin_close()` 在首个IO前封闭 `check()`，同一journal持久记录一次closeId及原manager/五unit/start job/InvocationID；重复调用不另建事务，失败保留unknown/slot，不发退出许可。
  - [ ] 将该内部入口接到同一原boot的认证关闭通道；当前listener/Node尚无实际关闭路由，不把私有方法当作已接通的整组关闭。
- [ ] 同一原manager定向停止原五unit：先四角色、后anchor；依赖停止/显式停止须统一纳入原job回执，不从StopUnit ACK推断完成。
- [ ] 持原cgroup对象，核对job完成、无待启动/重启、原身份仍匹配且不能重新填充；原pidfd显示退出并区分reap，任何缺失/漂移保留unknown。
- [ ] 消费者先收口该组既有SDK、会话及全部原始IO，再消费一次性原物理终态；仅解除本组凭据，不能清除DB/模型或其他boot未知。
- [ ] 在既有journal记录原终态后才允许槽位复用；证明丢失或写失败仍保留资源，不自动重派。

### Task 3: 实际Linux验收（独立门禁）

**Interfaces:** 输入准确候选、原身份/工具/manifest和明确归属的隔离环境；输出实际内核/systemd/五unit/后代退出及清理证据。默认模板unverified和Darwin原生seam测试均不得计为通过。

- [ ] 在资源受限、可核实归属的隔离目标验证double-fork/setsid、leader先退、忽略TERM、停止期fork、迟到job、manager换代和两组互不干扰。
- [ ] 核对真实Chromium沙箱、cgroup不可迁出、固定UID/GID及原进程能力，不新增生产权限或部署。
- [ ] 单独记录物理退出、业务排空与生产配置/发布批准；完整Goal不以Task1或模拟测试代替完成。

## Current evidence

工作起点HEAD ad483337，运行候选f2ccd2cb、1833输入；父交接127文件完整。初始相关TS批次180秒超时没有完整报告，不计通过；已观察worker自行退出。新的最小RED5.83秒：1 failed/1 passed，精确失败为同步finalizer后disconnect为0。所有模型/KMS/导出/重放/合并/上线为0。

## 平台契约先验收再接线

StopUnit只返回异步job，必须先订阅JobRemoved再派发并按原job过滤；v249已有该接口，不借用262新增接口。[systemd v249官方接口](https://raw.githubusercontent.com/systemd/systemd/v249/man/org.freedesktop.systemd1.xml)

cgroup.events的populated覆盖本组和后代的活进程，但单次0不是封闭后不可重新填充或reap的证明。[Linux内核文档](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification)

原cgroup在stop后可能被移除、unit的InvocationID可能进入终态表示；须先在自有隔离组实测这些事件和原FD的生命周期，不能猜测not-found/0 InvocationID就是同一原组成功退出。未拿到该平台契约前不新增成功退出生产者；现有unknown与pin保留。

### 2026-11-21 已取得的最小平台测量

- [x] 用户批准的新Holaday-ExitLab已创建，systemd249/PID1、原manager、cgroup2和自有pidfd实际核验。
- [x] 六个自有最小单元/九个原进程引用测量完成：普通停止、double-fork/setsid/leader先退、忽略TERM、停止期间fork、两个最小组互不影响。此项不完成Task3的完整B2验收。
- [x] 记录真实终态差异：原cgroup inode/nlink=2保持、events FD变ENODEV、路径ENOENT；持RefUnit时InvocationID保持。停止超时升级后service可为failed，同时原stop job done和pidfd退出；不翻译为业务成功。
- [ ] Task2接线继续：先在创建放行前持原cgroup/events/worker引用，并为关闭建立独立、不可外传伪造的终态能力。原job与封闭派发/持久记录、原Node IO及一次性消费组合验证；不从ENODEV/目录消失/JSON布尔值直接放行，也不把实测中未出现的nlink=0写成前提。
- [ ] Task3继续：原B2五单元/两组、固定身份/文件视图/不可迁出、Chromium sandbox、迟到或丢失ACK与manager漂移、原sealed native bundle，均保留未完成。

详见[实际源代码、原始回执与范围](../../reports/2026-11-21-controlled-browser-exit-wsl-lab.md)。产品运行源码未改变，native manifest仍unverified；原unknown、slot保留及禁止模型/重导出/重放/合并/上线约束继续有效。
