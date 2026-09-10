# 任务队列待派发与回调生命周期实施计划（3D-3a）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。单主实现，复用现有只读reviewer，重任务串行。

**Goal:** enqueue ACK之前同步预留排队owner，原始onStart/runFn/onTimeout结束前不能假idle，停止不丢弃未派发任务。

**Architecture:** 可选controller和server-only入队lifetime绑定真实权限；以内部未结束Promise持有排队owner，callback在该owner下各自reserve子链并传自己的lifetime。待派发保留队列；stop清未来timer/接纳并返回当前callback等待Promise，但排队owner仍阻断idle，不以清timer或signalSlotFreed释放生命周期。

**Tech Stack:** TypeScript、DrainController/owned-operation、真实临时状态文件、Vitest；不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；docs/superpowers/specs/2026-09-10-process-drain-coverage.md。

## Global Constraints

- 总任务预算约10GB；Node heap2048MiB，Vitest单线程/无文件并行，每批≤20文件。free<40%或磁盘<10GiB不启动重任务；reviewer与测试/tsc串行。
- 不安装、不新启Docker/浏览器、不访问生产、不push/PR/合并/部署；保护主8草稿与PR237包，不改受限业务域或输出秘密/个人数据。
- 不改FIFO、最大深度、池并发计数、slot信号或原业务超时阈值。stop不取消/删除排队任务，也不提前触发超时来清场。停止后仍排队的owner意味着尚未排空，不能部署。
- 无controller且无scope保持旧callback receiver/零参数调用、入队返回和调度顺序。cfg缺controller但携带scope须拒绝，防静默失去追踪。
- 本单元只接queue模块；tasks真实enqueue两处与boot尚未传controller/lifetime，callback内部IO/吞错/ACK后工作后续接线。全进程仍阻断发布。

## 单元：队列拥有待派发工作并等待回调

**Files:** Create apps/orchestrator/src/queue/task-queue-lifetime.ts、task-queue-drain.test.ts；Modify queue/task-queue.ts 和覆盖清单。

**Interfaces:** TaskQueueConfig.executionDrain?:DrainController；QueuedTaskInput.executionLifetime?:OperationLifetime；onStart/runFn/onTimeout接受可选lifetime参数；TaskQueue.stop():Promise<void>。内部Reservation持有lifetime、原始pending Promise和私有finish，不能由taskId或外部finish重建/释放。

- [x] RED：closed入口不入队；合法父ACK结束后queue owner仍活动，普通finish不能释放；延迟onStart/runFn/onTimeout在close/stop期间仍占用，晚失败留unknown；signalSlotFreed不能提前清生命周期。

```ts
await controller.runRoot(async life => queue.enqueue({ ...syntheticTask, executionLifetime: life })).result;
closeController();
expect(queue.size()).toBe(1);
expect(controller.drain.snapshot().idle).toBe(false);
const stopped = queue.stop();
await stopped; // 当前没有执行callback，但排队任务仍保留
expect(queue.size()).toBe(1);
expect(controller.drain.snapshot().idle).toBe(false);
```

- [x] 运行RED/GREEN：在apps/orchestrator执行 `NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/queue/task-queue-drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。真实queue/controller/state/Promises，不启动浏览器或数据库。
- [x] GREEN：在queue.push前验证scope并同步reserve/pin；缺/过期/复制/跨drain/封闭能力拒绝。实际派发先校验且unknown时不shift/reap；callback reserve自己的执行子owner，正常close允许既有链，block/unknown禁止新副作用，实际失败在旧catch前留unknown。
- [x] 超时保留原年龄条件，仅正常业务超时移除待派发条目；其async callback原始Promise须持有，异步拒绝有catch且留unknown。无onTimeout的明确纯内存超时也完成自己的reservation。
- [x] 所有当前callback在调用前先登记等待屏障；stop同步停止未来调度并await这些原始工作，排队条目不释放。onStart失败原inFlight处理保留，runFn原slot信号规则不改；slot信号不是物理工作结束证明。
- [x] 补权限、深度拒绝无泄漏、过期微任务、owner过期不可复活、receiver/零参数兼容、同scope子工作ACK后留存、未确认错误不重派发的反例；独立只读审查后串行回归、完整tsc、改动TS Biome/diff；本地精确提交记录见PROGRESS最新节点。

## 验证与审查说明

初始18项中17条真实反例RED，1条既有兼容场景通过。追加2条同步错误窗口反例RED→GREEN：onStart/onTimeout同步throw必须在当前派发turn立即留未知，不能等Promise catch后才阻挡下一条。其余回归覆盖正常root/继承、权限、guard、stop、超时、signal与detached child。

独立审查发现3项Important，8条新反例全部RED后修复：私有释放能力移到WeakMap；stop屏障登记在日志/回调之前，隔离日志错误；input/now/capacity准备移到reserve/push之前。复审无Critical/Important/必修Minor，只批准本地检查点。最终精确时间/测试数量/提交见PROGRESS，不能视作完整分支或生产通过。
