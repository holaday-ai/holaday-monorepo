# 浏览器停机维护与兼容恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本计划推荐同一执行者串行完成，最后统一独立审查；未经用户确认执行方式，不开始实现。

**Goal:** 普通启动路径能够关闭新准入、等待已接纳执行、持久保留维护状态，并在发布失败时拒绝不兼容的旧版自动恢复。

**Architecture:** 复用 `ExecutionDrain` 与 `startOwnedOperation` 的进程内归属，不复制原生池启动链。新增普通模式维护协调器及部署身份专用 Unix socket；接入既有 HTTP、WS、内部调用、调度和资源关闭接点。发布脚本先验证旧实例能力和维护条件，迁移或候选启动之后只允许保持维护、兼容修复，不走旧版自动回退。

**Tech Stack:** 现有 TypeScript、Node.js、Express、tRPC、ws、Vitest、Node test、Bash/PM2；不增加第三方依赖、不新增业务 SQL。

**Spec:** [已确认设计](../specs/2026-09-25-browser-maintenance-release-design.md)。执行者必须先完整阅读设计及本计划。

## Global Constraints

- 工作树固定 `/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo`，分支 `codex/browser-release-candidate-20260925`；本计划开始 HEAD `0dc08322`，源码基线 `fa497fde`。原脏目录不回填、不清理。
- “本次设计和后续本地实现不授权推送、合并、生产停机、生产 SQL、修改生产配置、安装扩展或取消用户任务。”
- “本项不扩展浏览器功能，不建设零停机发布、原生池、通用运维平台或新的任务调度器。”
- “超时只返回阻塞，不取消任务、不执行强杀、不把数量清零。”
- “不删新列、不将 NULL 费用改零、不重写执行身份、不重置用户额度、不批量将任务改为终态、不恢复整库覆盖维护期间的其他业务写入。”
- “维护验收通过不等于浏览器成功率达标，也不替代多页、上传、Canvas 和代表性同题任务验收。”
- 首次旧进程不支持协议必须返回 `LEGACY_DRAIN_UNSUPPORTED`，变更前停止。首次运维引导不在本计划中执行；没有已验收的备用恢复 SHA。
- 普通维护与原生受控模式分离；不更改原生 loader 门槛、许可验证或 `ApplicationBoot`。同启两个模式失败关闭。
- 仅本地提交。定向 RED→GREEN 后再提交；最终完整后端测试、类型检查、构建与发布脚本隔离测试统一运行。不得将历史测试记作新结果。
- 当前产品模型测试预算记录为 53/1000；本计划的模拟测试不调用付费模型。真实 QA 如需模型，单独记账，不重置额度。

## Review Focus

1. HTTP 已响应但子任务仍执行：维护不能提前报 idle。任务 1、3、6 用延迟子 Promise 固定。
2. 已认证 WS 在维护瞬间既发新指令又交旧回执：只拒绝新指令，不能丢掉旧回执或接受异用户回执。任务 3 固定。
3. 进程在标记写入/候选启动附近崩溃：重启不能以零计数或旧验证回执恢复服务。任务 2、6 固定。
4. PM2、SSH 或控制命令只完成一部分：不能重试整个切换而重复停机/迁移，不能自动强杀或旧版恢复。任务 5 固定。
5. 暂停记录、持久队列和未知远端动作混在一起：不能全算忙，也不能全忽略；支付回调不能伪成功。任务 3、4、6 固定。

## 执行约定与文件分工

这是同一项发布能力的六个依赖步骤，不是六个新产品项目。顺序为 1→2→3→4→5→6；不并行编辑共享启动/入口文件。

所有命令从上述候选工作树执行。沿用已存在的依赖，不安装或升级；如 PATH 缺 Node，使用已核实的本机 runtime `/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`。测试后端用 `pnpm --filter @holaday/orchestrator exec vitest run <文件>`，路径相对 `apps/orchestrator`。源码树在默认可写根外时申请明确的本地权限，不换回原脏目录绕过。

每个任务的 Create 是待新增文件，不是已存在 API。新增测试必须先跑出预期失败，编译/导入错误只作为首次接口建立失败；行为回归仍须观察断言失败。测试密钥只用假值；不加载 `.env.deploy.local` 或真实模型环境。

| 模块 | 唯一职责 |
| --- | --- |
| `execution/execution-admission.ts` | 共享最小执行准入类型，不包含 native 身份或开放许可 |
| `execution/ordinary-maintenance.ts` | 普通维护状态机、执行归属与排空判定 |
| `execution/ordinary-maintenance-store.ts` | 维护/未完成标记的读取与持久化 |
| `execution/ordinary-maintenance-control.ts` | 本机命令验证、串行控制及只读状态 |
| `execution/ordinary-maintenance-background.ts` | 背景生产者生命周期聚合，等待真实 stop 结果 |
| `scripts/browser-maintenance-policy.mjs` | 发布阶段和失败恢复的纯决策 |
| `scripts/browser-maintenance-client.mjs` | 有界本机 socket 客户端，核对实例，不直接控制业务 |

### Task 1: 普通维护协调器与共享准入契约

**Files:**
- Create: `apps/orchestrator/src/execution/execution-admission.ts`
- Create: `apps/orchestrator/src/execution/ordinary-maintenance.ts`
- Create: `apps/orchestrator/src/execution/ordinary-maintenance.test.ts`
- Read/reuse: `execution/execution-drain.ts`、`execution/owned-operation.ts`；不改原生 `drain-controller.ts` 的行为。

**Interfaces:** 下列类型在新模块中导出。`ExecutionAdmission` 的 `tick()` 为已有队列代码所需；原生 `DrainController` 结构兼容，无需继承或伪造。

```ts
export interface ExecutionAdmission {
  readonly drain: ExecutionDrain;
  tick(): void;
  runRoot<T>(action: (life: OperationLifetime) => Promise<T>): OwnedOperation<T>;
}
export type MaintenanceMode = 'serving' | 'draining' | 'closed' | 'blocked';
export interface MaintenanceIdentity { candidate: string; bootId: string; }
export interface MaintenanceSnapshot {
  identity: MaintenanceIdentity;
  mode: MaintenanceMode;
  counts: DrainSnapshot;
  needsReconciliation: boolean;
}
export interface MaintenanceJournal {
  read(): { needsReconciliation: boolean };
  persist(input: { mode: MaintenanceMode; needsReconciliation: boolean }): void;
}
export interface MaintenanceChecks {
  verifyReady(identity: MaintenanceIdentity): Promise<void>;
  stopProducers(): Promise<void>;
  verifyRetainedQueue(): Promise<void>;
}
// ordinary-maintenance.ts 的导出类；缺检查项不能默认为通过。
// 构造函数参数：{ identity, journal, checks }。
// 方法：runRoot/tick（见 ExecutionAdmission）、snapshot(): MaintenanceSnapshot、
// beginMaintenance(): Promise<void>、waitForIdle(timeoutMs: number): Promise<void>、
// resumeServing(): Promise<void>。新实例总是 closed 或 blocked。
```

- [ ] **Step 1 — 编写状态与原始子任务回归。** 以下直接使用现有 `ExecutionDrain`/`startOwnedOperation`；在测试顶部导入接口中的真实类型与新类 `OrdinaryMaintenance`。加表驱动项：关闭后根拒绝、重复关闭幂等、未知结果不能 reopen、负数/非有限超时拒绝。

```ts
it('waits for an admitted child after its parent has returned', async () => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const m = new OrdinaryMaintenance({
    identity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
    journal: { read: () => ({ needsReconciliation: false }), persist() {} },
    checks: {
      verifyReady: async () => {}, stopProducers: async () => {},
      verifyRetainedQueue: async () => {},
    },
  });
  await m.resumeServing();
  let child!: OwnedOperation<void>;
  await m.runRoot(async life => {
    child = startOwnedOperation(m.drain, 'execution', async () => held,
      { parent: life.owner, errorOutcome: 'unknown', dispatch: 'immediate' });
  }).result;
  await m.beginMaintenance();
  expect(m.snapshot().counts.idle).toBe(false);
  expect(() => m.runRoot(async () => {})).toThrow();
  finish(); await child.result;
  await m.waitForIdle(1000);
  expect(m.snapshot().mode).toBe('closed');
});
```

- [ ] **Step 2 — RED。** 运行 `pnpm --filter @holaday/orchestrator exec vitest run src/execution/ordinary-maintenance.test.ts`，记录缺失接口/预期行为失败，不允许接入真实服务。
- [ ] **Step 3 — 最小实现。** 所有新根在派发前写入未完成标记；关闭先同步 `drain.close()`，再等待停止生产者；只在生产者、执行、队列保留证明全部完成后写 clean closed。`verifyReady` 完成后再核对实例状态，持久写 serving+dirty 后才能 `drain.open()`；异常保持 closed/blocked。根用如下原始执行封装，不用 HTTP finish 代替执行结束：

```ts
return startOwnedOperation(this.drain, 'request', async owner =>
  action(Object.freeze({ drain: this.drain, owner })),
  { errorOutcome: 'unknown', dispatch: 'immediate' });
```

本层不提供 `clearUnknown()`。鉴权/输入拒绝保持入口原有已知拒绝处理，不能用 catch 全清未知数。`waitForIdle` 使用单调时间、可清理的有界等待；不触发 cancel，结束时重新读取标记并核对覆盖检查。等待失败不写 clean。

`beginMaintenance()` 的 Promise 只等待停止生产者，不等待所有执行，否则调用者无法先得到“已关闭接单”的确认。`waitForIdle()` 才检查实际执行；`closed` 与执行计数为零不是可互换的两个字段。`tick()` 校验持久状态可读及当前实例归属，不能重新开放准入。
- [ ] **Step 4 — GREEN + 原语回归。** 同跑新测试、`src/execution/execution-drain.test.ts`、`src/execution/owned-operation.test.ts`；检查无未处理拒绝、无泄漏定时器。
- [ ] **Step 5 — 本地提交。** 仅暂存本任务三个新增文件，提交 `feat(orchestrator): add ordinary maintenance lifecycle`。

### Task 2: 持久标记与本机控制，重启不自动开放

**Files:**
- Create: `apps/orchestrator/src/execution/ordinary-maintenance-store.ts`、对应 `.test.ts`
- Create: `apps/orchestrator/src/execution/ordinary-maintenance-control.ts`、对应 `.test.ts`
- Create: `scripts/browser-maintenance-client.mjs`、`scripts/browser-maintenance-client.test.mjs`

**Interfaces:** store 实现任务 1 的 `MaintenanceJournal`。导出 `createOrdinaryMaintenanceStore(directory: string, identity: MaintenanceIdentity): MaintenanceJournal`。控制导出 `startOrdinaryMaintenanceControl({directory, coordinator}): Promise<{close(): Promise<void>}>`；coordinator 为任务 1 的 `OrdinaryMaintenance`。客户端导出 `requestMaintenance({socketPath, identity, op, timeoutMs}): Promise<MaintenanceSnapshot>`。

命令固定 `{protocol:1,candidate,bootId,op}`，op 仅 `status|close|wait|open`；wait 的 `timeoutMs` 为 1–600000 整数。每帧上限 4096 bytes、连接读取超时 5 秒；错误返回稳定 code，不回传路径、用户内容或原始异常。open 由服务端 `verifyReady` 决定，客户端不能提交 `verified:true` 充当证据。

- [ ] **Step 1 — 编写失败测试。** 用 `mkdtempSync` 创建每例独享目录，以 `readFileSync` 验证真实持久文件；新开 store 不能清除上一 boot 的 dirty。核心断言：

```ts
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const first = createOrdinaryMaintenanceStore(directory, identity);
first.persist({ mode: 'serving', needsReconciliation: true });
const restarted = createOrdinaryMaintenanceStore(directory,
  { ...identity, bootId: 'c'.repeat(32) });
expect(restarted.read().needsReconciliation).toBe(true);
```

用真实 socket 测试旧 boot、错误 SHA、额外字段、截断 JSON、超大帧、慢连接、并发 open/close；控制命令无效时业务计数不能变化。路径测试包含文件/目录符号链接、写权限不符、损坏 JSON、原子替换失败；失败不能使服务进入 serving。
- [ ] **Step 2 — RED。** 运行两新增 Vitest 文件及 `node --test scripts/browser-maintenance-client.test.mjs`。
- [ ] **Step 3 — 实现。** 运行目录生产固定在部署目录的普通维护子目录，测试通过明确 fixture 依赖注入；不从业务请求取路径。状态文件权限 0600，socket 0600，专用目录 0700，运行/部署身份通过受控本机命令访问；写临时文件→fsync→rename→目录 fsync。仅首次明确初始化生成 clean closed；缺失/损坏旧状态不能自动重建为 clean。保存 schemaVersion、candidate、bootId、mode、needsReconciliation。重启继承未结算标记但不继承旧开放授权。

```ts
// 服务端解析后，控制器内部还需串行及实例复核。
switch (command.op) {
  case 'status': return coordinator.snapshot();
  case 'close': await coordinator.beginMaintenance(); break;
  case 'wait': await coordinator.waitForIdle(command.timeoutMs); break;
  case 'open': await coordinator.resumeServing(); break;
}
return coordinator.snapshot();
```

生产检查回调不能是测试中的空函数。客户端只传上述命令，连接失败/超时返回错误；不能创建标记、启动进程、重试 open 或自选替代 socket。退出时仅移除本进程实际创建的 socket，不删除维护记录。
- [ ] **Step 4 — GREEN。** 同跑任务 1、新 store/control/client 测试。将“验证返回之前收到 close”的交错固定为不开放，保存/读取异常固定为失败关闭。
- [ ] **Step 5 — 本地提交。** 仅上述新增文件，提交 `feat(orchestrator): persist maintenance and expose local control`。

### Task 3: 入口接入与原执行回执完整性

**Files:**
- Modify: `apps/orchestrator/src/http.ts`、`trpc/context.ts`、`trpc/trpc.ts`、`trpc/task-drain.ts`
- Modify: `execution/http-drain.ts`、`api-keys/webhook-handler.ts`、`api-keys/webhook-drain.ts`
- Modify: `ws/server.ts`、`ws/server-work.ts`、`trpc/routers/tasks.ts`、`trpc/routers/task-queue-execution.ts`
- Create: `apps/orchestrator/src/execution/ordinary-maintenance-entry.test.ts`、`ws/ordinary-maintenance-receipts.test.ts`
- Extend tests: `http.execution-drain-wiring.test.ts`、`trpc/routers/tasks.drain.test.ts`、`api-keys/webhook-handler-drain.test.ts`、`ws/server-drain.test.ts`

**Interfaces:** 原 `executionDrain` 字段名保留，其类型由具体 `DrainController` 改成任务 1 的 `ExecutionAdmission`；只在上述普通消费者替换类型，不把 native 控制服务器改成普通协议。Context/HTTP/WS 增加可选 `ordinaryMaintenance: OrdinaryMaintenance`，区分普通维护与“存在 controller 即严格原生”的旧条件。

- [ ] **Step 1 — 编写新旧两种控制器的失败回归。** 复用既有真实入口 fixture：`tasks.drain.test.ts` 的 `fixture()` 用普通协调器增加一组实例，记录首个 DB lookup、Quota 调用、外部 adapter 调用；在 closed 状态执行 create/reply、内部 caller、任务 webhook、浏览器人工输入，均在副作用前拒绝。

```ts
await m.beginMaintenance();
await expect(caller.create({ intent: '仅处理合成材料' }))
  .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
expect(firstDatabaseLookup).not.toHaveBeenCalled();
expect(quotaConsume).not.toHaveBeenCalled();
expect(browserDispatch).not.toHaveBeenCalled();
```

这里 `caller` 是该测试现有 `tasksRouter.createCaller(ctx)`；三个 spy 接到 fixture 的原始 DB、QuotaService 和 browser adapter，不用代理调用计数推断。新 WS 测试沿用 `extension-tool-call.selected-tab.test.ts` 真实连接 fixture，先发出原动作，关闭新准入，再发匹配回执；原请求完成，跨用户/旧 requestId 回执不完成，新 user_input 拒绝。测试同时断言登录态上报不作为新业务写入旁路。
- [ ] **Step 2 — RED。** 运行两新增文件，确认断言证明普通维护未接入；不是因 mock 缺字段而失败。
- [ ] **Step 3 — 实现接点。** 将上述类型改为共享契约；保留 native 模式原有拒绝与广播限制。普通模式的回执按“已存在 resolver+原用户/执行/请求”处理，不能因为传入 controller 就禁用普通 legacy 回执，也不能把所有 memory 消息视为无副作用白名单。

```ts
// 分离执行在仍活跃的原调用中登记；跟踪原 Promise 及其真实清理。
const operation = startOwnedOperation(life.drain, 'execution',
  async () => await dispatchOriginalTask(),
  { parent: life.owner, errorOutcome: 'unknown', dispatch: 'immediate' });
void operation.result.catch(reportOriginalFailure);
```

`life` 使用现有 `currentOperationLifetime()`；`dispatchOriginalTask` 与 `reportOriginalFailure` 对应被包裹的原函数/原错误处理，不能改业务错误文案与扣费语义。逐个审阅 `tasks.ts` 的分离 async 分支：计划、生成、视频、图片、本地 Chrome、云浏览器、建议及结算写入；每个记录到任务 6 覆盖表。只加归属，不搬迁整个大文件。仅 wrapper promise 不覆盖的远端请求继续标记未知，不能提前 release。

只读检查初始仅健康状态和任务 5 明确列出的内部 schema/记录探针；不为所有 GET 或 tRPC query 放行。支付回调在维护入口返回 503，不伪造 2xx；既有交易与授权代码不变。

鉴权拒绝用服务端固定 gate 的原始错误对象和当前归属判断；只有在任何业务副作用之前发生的该次拒绝可计为已知无副作用。不能按 `UNAUTHORIZED`/`BAD_REQUEST` 文本统一豁免下游抛错。为普通模式补前置拒绝不产生 unknown 的测试，并保持 native 现有契约不变。
- [ ] **Step 4 — GREEN + 兼容回归。** 跑上述八组文件及 `ws/extension-tool-call.selected-tab.test.ts`、`ws/user-input.test.ts`、`trpc/routers/tasks.browser-qwen.test.ts`；native 的旧断言不能删掉换成普通语义。
- [ ] **Step 5 — 本地提交。** 精确暂存本任务实际改动，提交 `feat(orchestrator): gate new work while preserving execution receipts`。

### Task 4: 启动、后台、队列与停止顺序

**Files:**
- Create: `apps/orchestrator/src/execution/ordinary-maintenance-background.ts`、对应 `.test.ts`
- Modify: `application-entry.ts`、`application-main.ts`、`agent/scheduled-runner.ts`、`planned/planned-runner.ts`
- Modify: `execution/periodic-work.ts`、`energy/analytics-cleanup.ts`、`api-keys/webhook-idempotency-service.ts`、`agent/a-share/prewarm-scheduler.ts`
- Modify: `queue/task-queue.ts`、`queue/task-queue-lifetime.ts`、`account-closure/worker-entry.ts`
- Extend: `application-entry.test.ts`、`application-main.wiring.test.ts`、`queue/task-queue-drain.test.ts`、`execution/poller-stop.test.ts`
- Create: `apps/orchestrator/src/account-closure/worker-maintenance.test.ts`

**Interfaces:** `createMaintenanceBackground()` 返回 `{register(name, producer), startOnce(), stopAll()}`，producer 为 `{start(): void, stop(): Promise<void>}`；register/startOnce 同步，stopAll Promise。重复启动不重复 timer；停止失败保留失败结果，不能下一次调用转成功。消费者类型使用任务 1 契约。入口用部署启动脚本显式导出的 `HOLADAY_ORDINARY_MAINTENANCE=1` 启用；与 `HOLADAY_POOL_BOOT`/`HOLADAY_POOL_CANDIDATE` 共存立即拒绝。

- [ ] **Step 1 — 编写失败测试。** 在现有主应用 wiring 的 spy 上增加：closed 启动没有 recovery、scheduled、planned、prewarm、清理/归纳派发，也没有 orphan reaper/浏览器连接产生副作用；open 后只启动一次；beginMaintenance 不立即 close WS。生产者 stop 卡住时排空也卡住：

```ts
let done!: () => void;
const pending = new Promise<void>(resolve => { done = resolve; });
const stopped = vi.fn(() => pending);
const b = createMaintenanceBackground();
b.register('scheduled', { start: vi.fn(), stop: stopped });
b.startOnce();
let complete = false;
const stopping = b.stopAll().then(() => { complete = true; });
await Promise.resolve(); expect(complete).toBe(false);
done(); await stopping; expect(stopped).toHaveBeenCalledTimes(1);
```

新增 worker 测试用假 DB/存储/通知依赖：维护标记存在不进入 tick；标记出现时本轮 page 原 Promise 结束后停止，不能收到 SIGTERM 就把销毁动作算完成。
- [ ] **Step 2 — RED。** 运行新增 background/worker 文件及修改后的主应用测试，记录意外启动或提前退出的断言。
- [ ] **Step 3 — 实现。** 普通维护启动在导入会产生业务副作用的模块前读取部署标记；依赖构造与启动分开。把普通模式已有启动恢复、stale/zombie sweep、retention、归纳、预热、计划轮询及清理注册到 background，open 之前不 start。保留原有业务参数和 feature flag，不能假设一个从未实现的 `SCHEDULED_RUNNER_ENABLED` 存在。

```ts
await maintenance.beginMaintenance();
await maintenance.waitForIdle(600_000);
await ws.close();
await new Promise<void>((resolve, reject) =>
  httpServer.close(error => error ? reject(error) : resolve()));
// 随后执行原 executor / browserPool 关闭，逐项等待，失败不报告 clean stop。
```

上段只用于已启用普通维护的正常停机；未启用旧普通模式和 native 模式保持各自既有失败退出约束。普通维护未证明 idle 时不能调用 `process.exit(0)` 或强制杀进程。启动前失败且未接纳任何工作可以失败退出，但维护标记不能清除。

队列先停止未来派发与超时淘汰，再核对持久化。已有 callback 原 Promise 结束后方可完成 stop；默认非空内存队列阻止 idle。只有任务 ID/所属者/状态与持久记录逐项一致且可按既有规则恢复，才允许明确列为 retained；不能只看 `tasks.status='queued'` 或新增重放机制。paused/awaiting_user 在无实际活动句柄时保留，不参与执行计数清零。

独立 closure worker 读取相同维护标记，停止新 tick、等待当前 page、关闭 DB 后正常退出；部署工具仍须核验此独立进程已退出。不能用主进程零计数代替 worker 证明。
- [ ] **Step 4 — GREEN。** 运行本任务新增/修改测试、`agent/scheduled-runner-drain.test.ts`、`planned/planned-poller-drain.test.ts`、`execution/cleanup-drain.test.ts`、`account-closure/worker.test.ts`，再跑类型检查。
- [ ] **Step 5 — 本地提交。** 精确路径提交 `feat(orchestrator): suspend producers during maintenance boot and drain`。

### Task 5: 发布阶段决策、首次旧版拒绝与失败保持维护

**Files:**
- Create: `scripts/browser-maintenance-policy.mjs`、对应 `.test.mjs`
- Modify: `scripts/deploy-orchestrator.sh`、`scripts/orchestrator-runtime.sh`、`scripts/start-orchestrator-production.sh`、`scripts/start-account-closure-worker-production.sh`
- Create: `scripts/deploy-browser-maintenance.test.sh`
- Extend: `scripts/deploy-migration-gate.test.sh`、`scripts/deploy-rollback-target.test.sh`、`scripts/orchestrator-runtime.test.sh`
- Create: `apps/orchestrator/scripts/browser-maintenance-readiness.ts`、对应 `.test.ts`

**Interfaces:** policy 导出 `evaluateMaintenanceCutover({protocol, mode, idle, needsReconciliation, candidateMatches, workerStopped})`，返回 `{allowed:boolean, code:string}`；另导出 `recoveryAction(phase)`，phase 为 `preflight|closed|stopped|migration_started|candidate_started|verified|opened`，返回 `abort_without_mutation|hold_maintenance`。不产生旧版自动恢复决定。readiness 导出 `verifyMaintenanceReadiness(input): Promise<void>`，输入 `{identity, expectedIdentity, schemaCheck, recordsCheck, servicesCheck}`，三 check 均为 `() => Promise<void>`；由本机协调器调用，实际检查失败即拒绝 open。

这里 `candidateMatches` 校验关闭凭据与刚核实的**旧运行实例**身份一致，不要求旧 SHA 等于目标新 SHA。停止独立 worker 的本轮派发并等待其 page/进程退出在最终可停判断之前完成；主进程 closed 不能代替这个条件。新实例的 open 另按新 identity 验证。

- [ ] **Step 1 — 纯策略 RED。**

```js
assert.deepEqual(evaluateMaintenanceCutover({ protocol: 0 }),
  { allowed: false, code: 'LEGACY_DRAIN_UNSUPPORTED' });
for (const phase of ['migration_started', 'candidate_started', 'verified', 'opened']) {
  assert.equal(recoveryAction(phase), 'hold_maintenance');
}
```

参数缺失不是通过；支持协议但缺实例匹配、worker 证明、不明结果或未 idle 均不允许停机。返回阶段不认识也保持维护，不执行 fallback。
- [ ] **Step 2 — 编写真实脚本的隔离 RED。** 复用 `deploy-migration-gate.test.sh` 的假 SSH、假 PM2、`assert_event_order`，不调用真实 SSH。注入事件：旧协议、SSH 超时、mark closed 失败、stop 忙、进程没退出、schema 失败、启动失败、只读验收失败、open 回执丢失。旧协议事件日志不得含 `reset-new/build-new/migration/restart-new/rollback-restart`；open 回执丢失须重新读取同实例状态，不能直接重试开放。
- [ ] **Step 2b — 编写 readiness RED。** 新测试直接调用 `verifyMaintenanceReadiness`，三个检查函数为 Vitest spy。以下失败必须传播且不能再运行后续检查；另测 expectedIdentity 与 identity 的 SHA/bootId 任一不同，三个检查均为零次。

```ts
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const schemaCheck = vi.fn(async () => { throw new Error('SCHEMA_UNPROVEN'); });
const recordsCheck = vi.fn(async () => {});
const servicesCheck = vi.fn(async () => {});
await expect(verifyMaintenanceReadiness({ identity, expectedIdentity: identity,
  schemaCheck, recordsCheck, servicesCheck })).rejects.toThrow('SCHEMA_UNPROVEN');
expect(recordsCheck).not.toHaveBeenCalled();
expect(servicesCheck).not.toHaveBeenCalled();
```
- [ ] **Step 3 — 实现纯策略与脚本接点。** 默认先本机/远端只读 capability 探测，不把 staging helper 上传放在旧版能力检查之前。候选 SHA 和目标配置必填且精确，拒绝默认旧分支的隐式切换。对本候选发布，不调用原 `abort_with_rollback`；恢复策略只保留维护并给出阶段、实例、失败 code。

```js
export function recoveryAction(phase) {
  return phase === 'preflight' ? 'abort_without_mutation' : 'hold_maintenance';
}
export function evaluateMaintenanceCutover(input) {
  if (input.protocol !== 1)
    return { allowed: false, code: 'LEGACY_DRAIN_UNSUPPORTED' };
  const allowed = input.mode === 'closed' && input.idle === true &&
    input.needsReconciliation === false && input.candidateMatches === true &&
    input.workerStopped === true;
  return { allowed, code: allowed ? 'READY_TO_STOP' : 'MAINTENANCE_UNPROVEN' };
}
```

进程停止和新进程启动拆成可单独验证的运行脚本步骤：SIGTERM 后有界等待精确 PID/启动身份和端口退出；维护模式不落入现有 stale-process SIGKILL 分支。重启调用不能隐式删除仍活跃的 PM2 进程。部署过程加独占本机锁，阶段在不可逆动作前持久记录；恢复时只核对状态，不重跑未证实完成的整个 SSH 脚本。

候选构建在独立 staging 目录完成并绑定 SHA，停旧进程后才切换启动路径；不能在活跃 checkout 上 reset/install。迁移清单记录将执行的全部 SQL 文件摘要与 runner 是否重放旧 SQL；未取得生产许可不得运行。readiness 使用专门的只读 schema/兼容查询，不调用会写入的通用迁移 runner；读取 NULL 费用、执行身份的断言使用候选已有逻辑，不生成新任务。未核实支付回调重试/独立服务边界时 `servicesCheck` 拒绝，而非硬编码成功。
- [ ] **Step 4 — GREEN。** `node --test scripts/browser-maintenance-policy.test.mjs scripts/browser-maintenance-client.test.mjs`；运行新增及上述三个旧 shell 隔离测试，再 `bash -n` 四个改动生产脚本。旧测试对“始终 rollback”的断言改为分阶段保留维护，保留原分支祖先检查、凭据不外泄及非 root 身份检查。
- [ ] **Step 4b — 检查校验器本身。** 运行 `pnpm --filter @holaday/orchestrator exec vitest run scripts/browser-maintenance-readiness.test.ts`；测试身份不符时三个 check 均不执行，schema/records/services 任一失败时拒绝，只有三者全部完成才允许同实例 open。零调用/缺函数不能当作绿色校验。
- [ ] **Step 5 — 本地提交。** 仅本任务文件，提交 `fix(deploy): require maintenance proof and forbid incompatible recovery`。

### Task 6: 综合演练与收尾证据

**Files:**
- Create: `apps/orchestrator/src/execution/ordinary-maintenance.integration.test.ts`
- Create: `docs/superpowers/plans/2026-09-25-browser-maintenance-verification.md`
- Update: `docs/superpowers/plans/2026-09-25-browser-release-compatibility.md`、`2026-09-25-browser-candidate-selection.json`

**Interfaces:** 不新增产品接口；组合任务 1–5。新增文件及已有选中项改动分别登记 post-selection 清单，保留原来源摘要；不要把原目录变动整树复制过来。

- [ ] **Step 1 — 综合 RED。** 用 `child_process.spawn` 启动隔离进程，真实 HTTP/WS/socket，外部 adapter 与 DB 使用假实现；子进程仅显式合成环境。脚本用父子 IPC 控制“任务进行中→HTTP 已响应→maintenance close→原 WS 回执→子任务结束→idle→停止”，断言顺序而非固定 sleep。

```ts
expect(events).toEqual([
  'accepted', 'http-finished', 'maintenance-closed',
  'new-work-rejected', 'original-receipt', 'child-finished',
  'idle-proven', 'listeners-closed',
]);
```

同一 fixture 注入：dirty 标记后异常退出、状态 rename 失败、候选 bootId 改变、旧回执重放、支付回调 503、非空未验证队列、worker page 尚未结束。异常退出实验只杀本例 spawn 的 PID，并确认身份，不触及既有 QA 进程。
- [ ] **Step 2 — 实现测试 harness 并 GREEN。** fixture 直接装配已实现 coordinator/HTTP/WS 接口，事件由真实回执和原 Promise settle 产生，不能由期望列表手工发出；覆盖服务端拒绝、没有扣费/业务写入、paused/awaiting_user 内容不变、没有自动旧版启动。

命令：`pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts src/execution/ordinary-maintenance.integration.test.ts`。默认 Vitest 配置排除 integration 文件，不能把默认全量跑完视为此用例已运行；只指定该文件，不带起其他真实服务集成。
- [ ] **Step 3 — 隔离 MySQL 兼容回归。** 沿用先前 QA 安全辅助脚本，只连接 `holaday-control-qa-20260914-mysql-1` 的 `127.0.0.1:13316`，随机合成库或连接临时表；先验证容器身份，绝不改业务 3306。执行既有 `core-task-repository.integration.test.ts`、`llm-accounting.mysql.integration.test.ts` 的显式 opt-in 安全路径，真实 schema/NULL/执行记录通过才记录成功。移除的只允许本例创建的随机库，并报告。没有 opt-in 环境或权限就标未运行，不跳过后声称通过。

凭据仅由本地 QA 配置在内存中取得；清理其他模型/部署环境后显式传入下面两个 URL，绝不打印。两项地址守卫不通过就退出，禁止退回测试文件默认的 3306：

```bash
case "${CORE_MYSQL_TEST_ADMIN_URL:-}" in mysql://*@127.0.0.1:13316/*) ;; *) exit 2 ;; esac
case "${DATABASE_URL:-}" in mysql://*@127.0.0.1:13316/holaday_control_qa) ;; *) exit 2 ;; esac
CORE_MYSQL_INTEGRATION=1 HOLADAY_ACCOUNTING_MYSQL_QA=1 \
pnpm --filter @holaday/orchestrator exec vitest run --config vitest.integration.config.ts \
  src/agent/core-task-repository.integration.test.ts \
  src/agent/llm-accounting.mysql.integration.test.ts
```
- [ ] **Step 4 — 整体回归。** 顺序运行以下离线命令，日志保存到明确的 `/tmp/holaday-maintenance-*.log`，逐项记录退出码与测试数量：

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator build
node --test scripts/browser-maintenance-policy.test.mjs scripts/browser-maintenance-client.test.mjs
bash scripts/deploy-browser-maintenance.test.sh
bash scripts/deploy-migration-gate.test.sh
bash scripts/deploy-rollback-target.test.sh
bash scripts/orchestrator-runtime.test.sh
git diff --check
```

如果修改 shared-types 或工作台，必须先解释必要性、列新增范围，再补该包对应测试/typecheck；本计划不默认授权 UI 改版。不能用单元通过数声称浏览器成功率提升。
- [ ] **Step 5 — 独立审查与文档。** 一次收敛审查覆盖入口遗漏、关闭时回执、原始 async 子工作、启动 sweep、支付/worker 旁路和部署阶段；报告审查范围、未覆盖路径及明确裁定。不让审查者执行生产或另开用户任务。工具不可用时如实标为尚缺独立审查，不冒称完成。
- [ ] **Step 6 — 完成记录与本地提交。** verification 文档逐项映射设计第 7 节十个场景，记录范围、实际命令/结果、日志位置、模型调用数和剩余部署条件；附“入口→准入位置→生命周期终点→测试证据”的完整覆盖表。对未覆盖路径不宣称排空保证。更新文件哈希和最终 HEAD；提交 `test(browser): verify maintenance cutover and failure hold`。

## 计划自查与交接

设计覆盖：状态/子任务归属→1；持久、权限和旧实例→2；HTTP/WS/内部 caller、费用入口→3；后台、队列、暂停记录、独立 worker→4；首次旧版拒绝、迁移范围、维护失败恢复→5；综合演练、真实数据兼容与证据→6。Review Focus 五项均已落到相应测试步骤。

任务结束条件是本地实现和上述验证完成，不是生产已可自动切换。首次旧版引导、支付回调实际运维安排、生产批准及最终浏览器能力验收仍单列，不通过本计划默示通过。

当前状态：只编写计划，没有执行任何 Task 1–6，没有新测试结果。请用户审阅计划并确认执行方式后开始。建议本会话单执行者串行实现、最后统一独立审查，减少共享接口反复交接；若选子代理方式，则每任务独立实现与审查，但成本更高。两种方式都不自动部署。
