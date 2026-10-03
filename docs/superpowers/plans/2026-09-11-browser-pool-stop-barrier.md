# BrowserPool分配与释放停止屏障实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，复用唯一只读reviewer，与测试/类型检查串行。

**Goal:** shutdown不得越过已开始的allocate/release，防止代理先关闭后产生迟到实例；重复release仍返回false但等待原释放完成。

**Architecture:** 保留allocationPromises并在执行任何spawn/hook前登记；新增releasePromises同步登记独占释放。shutdown先关闭未来接纳/GC/retention，再等全部已登记allocation收尾、释放现有实例并等已有release，最后关闭代理；并发shutdown共享一个停止流程。分配/释放的同步回调重入也必须已登记。

**Tech Stack:** TypeScript、Vitest、真实BrowserPool/SlotAllocator/PlaywrightExecutor与合成child_process、代理socket及CDP传输；无安装/新进程。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；process-drain-coverage.md。

## Global Constraints

- 约10GB预算，Node heap2048MiB，Vitest单线程无文件并行≤20文件；free<40%或磁盘<10GiB不启重任务。reviewer错开。
- 不安装、不启动真实Docker/浏览器、不连接生产或读取秘密/身份业务文本。不触主8草稿/PR237冻结包、支付/奖励/提现/额度/账号注销/DivineAPI或旧模型配置。
- 这是协调层等待屏障，不是execution owner/unknown的完整接线，也不是OS终止证明；保留失败处理、kill宽限/状态及容量规则。未完成整体门禁不独立发布。

## 已核对的真实调用关系

- allocate → 容量回收releaseOldestRetained → spawnInstance → proxy.start → spawn quartet → CDP readiness → executor.connect → 注册实例 → detached ready hook；allocate的Map当前晚于IIFE开始。
- retain/touch → retention timer → release；adoptRetained只迁移已保留实例的key。GC interval → sweep → Promise.all(release)。子进程exit → release。
- release → disconnect → SIGTERM/3s/SIGKILL → 释放slot/删profile；status=draining当前让重复调用提前false。shutdown当前只快照instances，忽略allocationPromises。
- spawn另有3s banner timer和onInstanceReady；executor connect/reconnect存在原始SDK及route callback；reaper按进程表发送信号，不能证明后代已退出。本单元不覆盖这几条原始/后台链，继续阻断全进程资格。

## 单元：可等待的分配/释放与停止顺序

**Files:** 修改apps/orchestrator/src/browser-pool/browser-pool.ts；新增同目录browser-pool-stop.test.ts；本计划和覆盖清单。

**Interfaces:** allocate/release/shutdown返回契约不变；重复release等待原Promise后返回false。shutdown永久阻止新allocate、retain/adopt/touch续租及startGc；共享停止Promise。无新公共root/计数或destroy接口。

- [x] RED：真实pool，外部原始spawn/CDP/proxy只用合成协议。allocate在CDP/ready或同步logger重入期间shutdown必须仍pending，代理不得先关闭；挂起release与重复release/shutdown都等待，失败allocation收尾也要等待。实例slot/profile真正释放才完成。

```ts
const allocating = pool.allocate('synthetic', 'synthetic');
await flush();
const stopping = observe(pool.shutdown());
expect(stopping.done).toBe(false);
releaseCdp();
await allocating;
await advanceKillGrace();
await stopping.promise;
expect(pool.peek('synthetic')).toBeNull();
```

- [x] RED：停止后拒绝新allocate、不再retain/adopt/touch/startGc；并发shutdown只关闭proxy一次。已有retention/GC/child-exit触发release，停止仍等同一物理协调Promise；不启动真实OS进程。
- [x] GREEN：先登记pending再执行异步工作。shutdown同步设置shuttingDown，清未来timer，然后await分配/释放屏障，迟到ready实例必须release；现有失败/去重/容量/profile规则不改。

```ts
// Explicit deferred registration preserves existing synchronous spawn dispatch.
const promise = new Promise<BrowserInstance>((yes, no) => { resolve = yes; reject = no; });
this.allocationPromises.set(taskId, { userId, promise });
void spawnWithCapacityReclaim().then(resolve, reject);
// stop path: await Promise.allSettled(allocationPromises);
// then allSettled(existing release receipts + releases for actual instances).
// A removed instance key does not erase a failed cleanup receipt.
```

- [x] 新矩阵+旧pool/spawn/reaper/session-recovery/executor/drain相关≤20文件串行，后端tsc、修改方法片段/新文件Biome及diff；独立审查、修反例、最终复验、本地精确提交与ledger/原automation断点。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/browser-pool/browser-pool-stop.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 实施证据（JST）

- 02:43初始13项中12条有效RED、1条旧兼容。后补4条adopt/touch/失败等待反例，修正测试lazy import与fake timer清理后02:46为4条有效RED；早先两个afterEach超时是fixture问题，不算产品反例。
- 02:49审查前8文件153/153、后端tsc与精确修改方法/新文件Biome通过。独立审查随后发现两处Important，故该轮通过不构成提交门禁。
- 02:59重复验证：同key在pending/failed release中允许新分配，以及实例key已删后shutdown漏掉失败回执，共3条有效RED。03:00额外child exit→warn回调重入allocate的非ready分支1条有效RED。
- 最小修复：allocate拒绝未完成release及非ready实例，shutdown独立汇总全部release回执与实际实例释放；不得以key不存在视为释放成功。03:00新21+旧26共47/47通过。
- 复审原两项关闭，但发现adoptRetained目标key同样可撞上旧失败记录；03:02真实尾部失败→retain→adopt反例有效RED，补目标release receipt保护。源实例已受ready状态检查保护。等待最终复审与扩大回归。
- 进一步交叉核对adopt目标在allocationPromises中但未出现在instances的阶段：03:05 pending CDP→adopt反例有效RED，增加目标pending allocation拒绝；分配完成后shutdown仍删除两个真实临时profile。新23+旧26共49/49通过。
- 过程偏差：首轮reviewer尚未FINAL时主线程曾运行两条短反例；已停止交叉，后续复审仅文档整理，重任务待FINAL后串行运行。不宣称本单元全程严格串行。
- 最终复审无Critical/Important/必修Minor，允许本地提交，不代表整体发布资格。03:07最终8文件159/159，6.49秒（23新pool停止、26旧pool、4spawn、2reaper、6session recovery、46executor drain、47旧executor、5clean context）；完整后端tsc退出0，新测试及8个修改方法Biome、方法外源码一致性、diff检查通过。最终格式门禁曾指出测试非空断言，改为明确值检查后重跑通过，未改生产语义。
- 资源free71%、磁盘143GiB。真实Linux/OS后代、MySQL、模型、PM2、生产和发布build未验证。下一单元处理pool/连接原始操作及后台hook、timer的归属；不能把此协调Promise直接计入全进程idle。
