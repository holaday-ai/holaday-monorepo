# 安全执行排空第一阶段：生命周期内核实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use one main implementer and at most one lightweight read-only reviewer; do not run heavy tasks with the reviewer.

**Goal:** 完成完整排空机制的第一阶段——真实进程内所有权和原始 Promise 跟踪；缺少后续持久化、完整接线和生产证明时仍拒绝发布。

**Architecture:** 不透明父子所有权区分活动与提交未知；持久关闸和本机控制绑定 boot/epoch。真实路由、后台链和原始 Promise 必须接线，首次旧版本升级独立检查，不用新计数器掩盖旧进程未知。

**Tech Stack:** 现有 TypeScript、Node.js fs/net、Vitest；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md`

## Global Constraints

- 任务内存预算约 10GB；Node 堆 2GB；Vitest 单 worker、每批最多 20 文件；重任务串行。
- 不安装、不新启 Docker/浏览器。保护主工作区草稿与 PR237 冻结包。
- 支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI 和旧供应商配置不变。不输出密钥、身份或业务文本。
- 未完成所有接线与门禁前不合并部署部分组件；旧 08:30 夜间窗口不复用。

## 当前实施单元：生命周期内核（可独立验证，不是发布就绪）

**Files:** 新增 `apps/orchestrator/src/execution/execution-drain.ts`、同目录 `execution-drain.test.ts`；原始 Promise 边界使用 `owned-operation.ts` 与 `owned-operation.test.ts`。

**Interfaces:** `ExecutionDrain` 默认关闭；`admit(kind)` 返回不透明句柄，`fork(parent,kind)` 继承占用；`finish(handle)` 只释放对应句柄；`markUnknown(handle)` 返回不透明未知票据；`reconcile(ticket)` 只供已核对证据的应用层调用，不对外暴露。`close()` 关闭接纳，`open()` 仅关闭且无活动/未知时开放，`block()` 永久拒绝开放。`snapshot()` 只返回聚合。

- [x] 写实际行为失败测试：默认拒绝根操作，开放后准入、关闭后拒绝新根且保留现有子链。

```ts
const drain = new ExecutionDrain();
expect(() => drain.admit('request')).toThrow('EXECUTION_DRAIN_CLOSED');
drain.open();
const root = drain.admit('request');
drain.close();
const child = drain.fork(root, 'suggestions');
drain.finish(root);
expect(drain.snapshot().idle).toBe(false);
drain.finish(child);
expect(drain.snapshot().idle).toBe(true);
```

- [x] 运行并确认 RED：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/execution-drain.test.ts --maxWorkers=1 --minWorkers=1`（cwd 为 apps/orchestrator）。第一轮无模块时明确断言导出未存在；已有模块上的缺陷使用实际行为断言验证。
- [x] 实现同步有界 Map 所有权，无定时器、网络或全局单例；执行原语不接业务入口。使用对象身份验证，关闭后 fork 仅接受尚未释放的现有句柄，finish 重复调用不能误减计数。
- [x] 增补 RED→GREEN：复制/跨实例/失效句柄，开放中不报告idle，容量拒绝，未知票据独立阻断、复制票据不解除，永久block、非法工作类型，真实Promise派发前登记与原始调用结束才释放。
- [ ] 运行内核测试和现有 registry 测试，检查改动文件格式与后端 typecheck；独立审查后提交仅本单元和规格。提交不等于发布。

### 原始 Promise 边界（同一内核单元）

接口：`startOwnedOperation(drain, kind, action, { parent?, errorOutcome })` 同步取得句柄再调度 action；返回 `{ owner, result, uncertainty() }`。仅原始 action 结束才释放。`errorOutcome` 为 `unknown` 时在释放前登记未知票据，`known` 只用于已确认无提交歧义的动作。调用方等待超时不会改变原始生命周期。

实现补强：包装器同步 `pin(owner)` 领取唯一私有释放闭包；调用方拿到的owner不能通过普通finish释放原始操作。实际派发再次校验owner和永久block。pin闭包不返回给调用方，只有原始Promise的finally持有。

先写并观察以下失败行为，再实现 Promise 链的最小包装：

```ts
let complete!: () => void;
const held = new Promise<void>((resolve) => { complete = resolve; });
const operation = startOwnedOperation(drain, 'database', () => held, { errorOutcome: 'unknown' });
drain.close();
await Promise.race([operation.result, Promise.resolve('caller-timeout')]);
expect(drain.snapshot().idle).toBe(false);
complete();
await operation.result;
expect(drain.snapshot().idle).toBe(true);
```

补真实延迟 Promise 的已拒绝未知写、同步抛出、错误归类、同一调用栈立即关闸、父子交接、非法选项和容量拒绝不派发测试。命令同上增加 `src/execution/owned-operation.test.ts`，不得用mock计数器替代真实内核。

## 后续阶段依赖（不属于本第一阶段的完成声明）

以下是完整工程剩余范围，而非已完成的实现或可直接执行的全阶段计划。它们按各自明确接口形成独立实施计划后执行；不能用未实现占位函数给发布工具放行，也不因第一阶段通过就合并部署。

1. **持久关闸与本机控制：** 新增 execution/drain-state-store.ts 及 drain-control-server.ts 和各自测试。真实临时文件验证 owner/mode/symlink/大小/损坏/原子写入/旧boot；真实临时 Unix socket 验证固定协议、身份、过期、重放、异步命令互斥。状态写失败要 block，而非清零；开放前恢复验证是独立职责。
2. **完整生命周期接线：** tasks.ts 的首个 await、core-task-execution.ts 的 afterSettlement、core-task-recovery.ts 的原始 Promise、tasks-core-create.ts 的 shell INSERT、建议链和 core-model-runtime.ts 的实际调用。使用持有 Promise 验证关闭期间不接新根、既有子链不中断、未知不能被finally清零；补所有被重启入口/调度覆盖清单，无法覆盖的路径阻断资格。
3. **维护和发布适配：** 发布执行器从受控本机接口取得真实状态而非注入布尔值；强制首次 PR231 维护证据缺失返回 BOOTSTRAP_UNPROVEN。精确parked/单账号/新epoch/失败恢复，不复用旧工具manifest。测试未知状态、旧版本、回滚和新boot伪零全部拒绝。
4. **完整门禁：** 重新全量相关测试/类型/构建、独立审查、Linux真实生命周期、PM2受控兼容、新生产基线、受控真实千问验收；全部通过才准备新候选/精确白名单/独立备份/有效时间窗，按现有授权PR、合并、部署和复验。

## 检查点

- 基线：2026-09-10 10:12 JST，现有 core-execution-registry 14/14通过。新分支已创建，PR237冻结包不改。此前177项为历史工具回归，不能视为新代码验证。
- 10:21 JST：内核18项、原始Promise13项、原registry14项，共45项通过；4文件Biome和后端全量typecheck通过。独立审查发现early-finish可伪造空闲，已补4项反例RED→GREEN并引入私有pin释放能力，复审无本单元剩余必修项。后续阶段仍未实施，不开启过期生产窗口。
