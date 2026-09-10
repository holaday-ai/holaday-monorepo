# 核心任务真实生命周期接线（阶段 3A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development. 主实现串行，最多复用一名只读审查员，不与重任务并行。

**Goal:** 核心 coordinator 的 ACK、主 completion、建议、通知和 RecoveryBudget 原始数据库调用使用同一父子所有权，超时和用户已收到结果均不伪造空闲。

**Architecture:** server-only 可选 `lifetime: { drain, owner }` 接受已接纳父句柄，coordinator 同步预留并 pin 子句柄。子链在关闭新接纳后仍可完成。原始 DB Promise 独立跟踪，恢复结果 unknown 在父释放前留下未知票据。未注入时保持原行为；这不是进程启动接线，不提供全进程发布资格。

**Tech Stack:** 现有 TypeScript、Vitest、ExecutionDrain，无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md`

## Global Constraints

- 约 10GB 内存预算，Node heap 2048MiB。测试使用 `--poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`，每批不超过 20 文件。
- 内存空闲低于 40% 或磁盘低于 10GiB 不启动重任务。不安装、不启动 Docker/浏览器。
- 主工作区草稿、PR237 冻结包不动，不访问生产、凭据或原始私人数据；支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI 不变。
- 本单元不推送、合并或部署；完整入口/底层传输/持久关闸/维护证据缺一不可。

## Task 1：同步子链与实际 coordinator / recovery 接线

**Files:** 修改 `apps/orchestrator/src/execution/owned-operation.ts` 及其测试、`agent/core-task-execution.ts` 及其测试、`agent/core-task-recovery.ts` 及其测试。

**Interfaces:** `startOwnedOperation` 保留默认延迟派发，增加 `dispatch: 'immediate' | 'deferred'`，action 接收其不透明 owner。`OperationLifetime = Readonly<{ drain: ExecutionDrain; owner: DrainOwner }>` 仅内部使用。coordinator 在任何 admission await 前取得 execution 子句柄，原要求同步冻结时序不变；ACK 不等待 completion，但 owner 等待 completion。建议/通知必须同步进入回调，不能拖到 registry finally 之后才调用。

- [x] 写 RED：immediate 回调在返回前已进入，关闸后已接纳父可派生，失败保留未知；无效 dispatch 在预留前拒绝。
- [x] 写真实 coordinator RED：ACK 后主链仍活动；建议和通知独立持有；关闭后子链可结束；失效父零数据库派发；超时返回后原始写仍活动，迟到结束后 unknown 仍阻断。

```ts
const drain = new ExecutionDrain();
drain.open();
const owner = drain.admit('request');
f.input.lifetime = { drain, owner };
const started = await startCoreTaskExecution(f.input);
drain.finish(owner);
drain.close();
await started.completion;
expect(drain.snapshot().idle).toBe(false); // held afterSettlement Promise
resolveSuggestions();
```

- [x] 运行 RED：在 apps/orchestrator，`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/owned-operation.test.ts src/agent/core-task-execution.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。
- [x] 实现最小接线：立即模式也先 reserve/pin/assertDispatch，吸收同步抛出为 rejected Promise，释放只能由原始 Promise finally；coordinator 子句柄覆盖 admission 与 completion，publish/afterSettlement 分别预留子句柄；RecoveryBudget DB action 在自己的超时 race 内单独 startOwnedOperation，逻辑 unknown 由仍活动父记录。read/wait 错误不自动判定提交未知，不根据迟到值擅自解除未知。
- [x] GREEN 后补退化和恢复路径：已确认的错误后权威读取不得被误标 unknown；等待超时不能重试写；invalid input 不进入 DB；子回调同步抛出不会更改已保存主结果。
- [x] 新鲜验证三个相关测试文件及 drain/registry 测试，改动文件 Biome、后端全量 typecheck、diff 检查。独立只读审查，修复必修项后再验证，记录真实证据后本地提交精确文件。

## 全进程覆盖清单与发布阻断（本轮审计）

| 入口/后台 | 源文件 | 本单元覆盖与尚缺项 |
| --- | --- | --- |
| core ACK/completion/afterSettlement/publish | agent/core-task-execution.ts | 本单元注入式跟踪；生产父接线仍缺 |
| admission/settlement recovery | agent/core-task-recovery.ts | 本单元原始 Promise；仓储内额外 detached work 仍须审计 |
| create/reply 首 await、附件、shell INSERT | trpc/routers/tasks.ts、tasks-core-create.ts、tasks-core-reply.ts | 未接；15s shell INSERT 可迟到，阻断资格 |
| 建议计划内 DB/模型 timeout | core-task-suggestions.ts、core-task-plan.ts、core-model-runtime.ts | 外层子链不等于底层传输；原始 transport 接线仍缺 |
| HTTP/tRPC/WS/browser | http.ts、trpc/trpc.ts、ws/server.ts、index.ts | 未接，不能声称进程 idle |
| scheduled/planned/cache warm/browser queue | index.ts、agent/scheduled-runner.ts、planned/planned-runner.ts | 未接，必须覆盖内部调度，不能只关闭公网 |
| boot sweep/zombie reaper/retention/crystallize | index.ts | 未接；禁止以改业务状态清场代替排空 |
| energy cleanup/其他敏感业务入口 | index.ts 及各注册模块 | 本单元不改业务；覆盖尚未证明，发布资格仍阻断 |
| SIGTERM 与首次旧版本升级 | index.ts、发布工具 | 现有 process.exit 不证明在途结束；新 boot 零值不证明旧 boot 完成 |

**下一单元必须先补：** durable controller 在 root admit 前同步 dirty 与即刻租约检查，再把真实入口父作用域、shell INSERT 和底层模型/建议/计划 timeout 纳入；未覆盖清单不可放行。不得用可选注入测试当作线上启用证据。

## 审查修正

- 13:44 JST 两项 Important 反例均 RED：确定性超预算输入错误留下 unknown；同一 prepared operation 的缓存被未跟踪/跨 drain/跨 owner 调用静默复用。另补 recovery 自持逻辑子句柄，调用方提前释放父仍不丢失原始 DB 派发。
- 纯同步 preflight 单次完成并复用已冻结 admission/context，然后才建立 execution 副作用 owner；不是将整条执行改成 known。缓存记录不可变来源，归属不符 block 新 drain、固定错误，不重发写；恢复自身及原始 DB 分别持有 pinned 子句柄。逻辑结果 unknown 仍保留票据，迟到成功不自动清除。
- 13:45 JST 5 文件 151/151 通过；初始反例运行中的 5 个未处理错误来自延迟 await 失败的测试断言，改即时观察结果后最终运行无未处理异常。后续 typecheck 揭示只读 fixture 赋值，已改整体替换 requirements，需新鲜复验。尚待独立复审，不作为完成记录。
- 13:49 JST 独立复审新增外层 await 跨期问题，真实 AbortSignal cleanup 推进单调时钟反例返回 committed，已观察 RED。唯一 RecoveryBudget 现在由逻辑 scope 创建并传入全部恢复步骤，cleanup 后复用原截止复查，再返回结果及保留未知；不重置预算。补 admission 过期许可反例。13:51 JST 五文件 153/153 通过，完整 tsc、格式/diff 通过，待最后复审。
- 13:53 JST 最后独立复审无剩余 Critical/Important/必修 Minor，仅允许本地检查点。最终九文件 **204/204** 通过（12.59秒，单线程、无文件并行）；后端完整 `tsc --noEmit`、六文件 Biome、diff 检查通过。保留既有 `--localstorage-file` 警告，不声称零警告或全仓测试通过。真实路由编排 + 合成仓储/模型边界，不是实际 MySQL/千问或生产验证。
- 单主实现与同一只读 reviewer 串行，最新系统内存空闲 72%、磁盘 144GiB。没有安装/Docker/浏览器/生产操作，原分支 66f3a583 和 PR237 manifest SHA 未变。精确本地提交 SHA 记录于 `qa-artifacts/qwen-delivery-contract-20260908/PROGRESS.md`；下一单元按上方缺口续接，不重复已完成基础模块。
