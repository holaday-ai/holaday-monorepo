# 实际任务入队与回调上下文计划（3D-3b-2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。单主实现与唯一复用只读reviewer串行。

**Goal:** tasks.ts两处真实入队绑定有效上下文，安全拒绝不执行QUEUE_REJECTED业务写入。

**Architecture:** queue在容量检查前验证scope，并返回固定拒绝分类；新server-only enqueueTaskExecution把请求lifetime交给队列，回调用队列给出的新lifetime构造Context。只有明确capacity拒绝返回到旧失败处理，其他拒绝抛SERVICE_UNAVAILABLE。

**Tech Stack:** TypeScript、真实TaskQueue/DrainController、Vitest、tRPC；无依赖新增。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md及process-drain-coverage.md。

## Global Constraints

- 仅本地代码、测试、审查和提交；不push/PR/合并/部署或访问生产。保留主8草稿及冻结PR237包。
- 总内存约10GB，Node堆2048MiB；Vitest单线程、无文件并行、每批≤20文件，free<40%或磁盘<10GiB不启重任务。审查与重任务串行，不安装/新启Docker或浏览器。
- 不改支付、奖励、提现、PartnerLedger、额度、账号注销、DivineAPI或旧模型配置，不输出原始身份/秘密/业务文本。
- 只证明真实caller的入队/Context/拒绝边界；direct-open/Brave内部原始浏览器IO、吞错和detached需后续逐一接，index仍不注入，不冒充整条执行链完成。

## 单元：队列准入分类和真实caller

**Files:** queue/task-queue.ts、task-queue-lifetime.ts及drain测试；新增trpc/routers/task-queue-execution.ts和测试；tasks.ts只修改两处enqueue、两个dispatch函数Context参数及相应非排队调用参数；覆盖清单。

**Interfaces:** EnqueueResult rejected增加可选reasonCode:'capacity'|'unavailable'（兼容旧typed实现，缺失分类按不可信安全拒绝）；assertQueueAdmission(controller?,inherited?)执行无预留前置验证。enqueueTaskExecution<C extends Context>(ctx:C,input:TaskQueueExecutionInput<C>):EnqueueResult，runFn/onStart/onTimeout接收bound C。有效callback绑定必须匹配ctx.controller与当前ALS owner；无scope兼容原ctx，不接受旧父owner代替callback owner。

- [x] RED：队列满与closed/unknown/失效/封闭/缺controller并存时仍为安全拒绝，容量拒绝不泄漏owner；合法scope深度满明确capacity。
- [x] GREEN：拆出原有准入验证并用于queue容量检查前和真正reserve前；没有提前reserve→release的虚假占用。保持正常close可派发既有子链规则。
- [x] RED：用真实队列/controller调用新helper，在父ACK后验证onStart/runFn/onTimeout收到新的当前Context，raw挂起阻断idle；安全拒绝抛SERVICE_UNAVAILABLE，明确容量拒绝可走旧业务处理；缺失/跨实例callback能力不得调用业务。

```ts
const result = enqueueTaskExecution(ctx, {
  taskId, userId: ctx.userId,
  onStart: async bound => markQueuedTaskExecutingOrThrow({repo, taskId, logger:bound.logger}),
  runFn: async bound => dispatchDirectOpen(bound),
});
// 仅明确capacity的rejected能到达此处；安全拒绝已抛错，不执行旧失败UPDATE。
```

- [x] GREEN：helper同步enqueue，传ctx.executionLifetime；回调验证并以其lifetime覆盖Context。实际tasks两处改用helper，dispatch函数改收当前Context（不复用闭包旧ctx），非队列调用显式传原ctx且仍标未跟踪。
- [x] 验证真实caller接线：实际router合成边界测试或可执行语义提取检查两处生产调用（不以grep字符串当行为验证）；严禁为测试新建模拟router冒充原router。补安全拒绝后无失败写、有效回调上下文与旧兼容路径证据。
- [x] 单线程相关回归、完整tsc、修改区段Biomes与diff；独立审查必修项先RED再修复，完成本地检查点和续接，不发布部分组件。

命令（apps/orchestrator）：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/queue/task-queue-drain.test.ts src/trpc/routers/task-queue-execution.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

### 执行说明

初始队列6项RED；helper基线仅转发旧ctx，10项RED/1项兼容；生产区段接线6项RED/2项容量兼容。新测试初次缺少合成repo失败方法，补齐边界后重新观察到真实安全拒绝（不是把fixture异常当RED）。随后最小实现后相关75项通过。完整router目前被Qwen unmigrated-browser门禁挡住，保持门禁，按计划允许的AST可执行语义提取验证原有区段，不宣称完整router已通过。

用户于本轮夜间重新授权PR、合并、部署、验证及需要时computer use；本单元仍只做本地检查点，整体发布门禁全部满足前不发布部分功能。自动化已记录最新夜间边界。

独立审查发现1项Important：受控helper无parent时可能进入legacy或异控制器队列，ACK时未在正确drain登记。新增无parent三组合和脱离ALS的有效parent反例共4项RED→GREEN；helper作为caller adapter强制parent与当前ALS匹配，不新增root API。缺分类测试改为有效parent以避免被新guard掩盖。复审无剩余必修项，允许本地提交，不代表发布就绪。

最终00:24 JST：10文件337/337（6.79秒）；后端完整tsc退出0，5个小TS文件Biome与git diff检查通过；tasks.ts逐字归一比较确认只有枚举的import、Context类型/参数和两处入队接线变化，不对历史大文件作全文件lint通过声明。资源free70%、磁盘143GiB；无真实DB/浏览器/千问/生产验证。
