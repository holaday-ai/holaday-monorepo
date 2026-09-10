# 持久准入与任务入口（阶段 3B）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development. 单主实现，最多复用一名只读 reviewer，重任务与审查串行。

**Goal:** 同一 DrainController 的持久状态先于 tasks.create/reply 第一个业务 await，核心主链和原始 shell INSERT 继承其所有权。

**Architecture:** 新增 controller.runRoot，同步检查租约、写 dirty、最后 I/O 后复核再同步预留 pinned root。ExecutionDrain 的可选同步 dispatch guard 在每次 owned-operation 派发时检查同一个持久状态；正常关闸允许既有子链结束，异常存储永久阻断。tasks middleware 在认证及纯输入 schema 后、业务处理前进入 scope；嵌套 createCaller 继承有效同实例父 scope，不冒充新根。

**Tech Stack:** 现有 Node fs、TypeScript、tRPC、Vitest，无依赖安装。

**Spec:** `docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md`

## Global Constraints

- 只本地开发，生产窗口过期；不推送/合并/部署部分组件，不访问生产数据/凭据，不改 PR237 冻结包和主工作区草稿。
- 不改支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI、旧供应商配置。入口 wrapper 覆盖原额度调用但不修改其逻辑。
- Node heap 2048MiB，Vitest 显式 maxThreads=1/minThreads=1/no-file-parallelism，每批≤20文件；内存空闲<40%或磁盘<10GiB不启重任务；不安装/新启Docker或浏览器。

## Task 1：持久根准入到真实任务链

**Files:** execution/execution-drain.ts及测试、drain-controller.ts及测试；trpc/context.ts、trpc.ts、新task-drain.ts；routers/tasks.ts（仅两处middleware挂载）、tasks-core-create.ts、tasks-core-reply.ts；新routers/tasks.drain.test.ts及相关核心路由测试。

**Interfaces:** `DrainController.runRoot<T>(action: (lifetime: OperationLifetime) => Promise<T>): OwnedOperation<T>`。`ExecutionDrain(capacity=1024, beforeDispatch?:()=>void)`，guard异常永久block且在guard后重验owner/block。Context新增可选executionDrain和executionLifetime，工厂仅在显式注入时转发控制器；没有全局单例、boot启用或默认成功授权。

- [x] RED：已有真实文件controller fixture开放后，runRoot首回调中磁盘dirty=true且root被pin；默认closed、过期、dirty写失败、写盘跨期均无派发。guard检查期间永久block/父释放必须拒绝。

```ts
const op = controller.runRoot(async ({ drain, owner }) => {
  expect(JSON.parse(readFileSync(statePath, 'utf8')).dirty).toBe(true);
  expect(drain.finish(owner)).toBe(false);
  await held;
});
controller.disconnect(session);
expect(controller.drain.snapshot().idle).toBe(false);
```

- [x] GREEN：runRoot验证状态/开放会话，markDirty，复核时间/开放态，startOwnedOperation immediate并在紧前再验开放；真实guard读取state+纯时间，dirty缺失/读写失败block。控制器关闭不清在途；不因root ACK写clean。
- [x] RED：真实tasksRouter closed create/reply 在第一次用户DB读取前拒绝；开放后第一次读取看到同一dirty与root；输入schema无效不创建root；嵌套同属scope可在关闸后完成，foreign scope固定拒绝。ctx无controller保留旧路由行为。
- [x] GREEN：middleware在.input之后，mutation之前。控制拒绝返回固定SERVICE_UNAVAILABLE；next失败保守保留unknown（业务入口已进入，不以错误码猜无副作用），成功不等于子链完成。输入schema和认证位于scope前，故这些确定性拒绝不留unknown。嵌套scope只接受同一控制器的有效owner。不把此保守错误分类当最终用户可用性优化完成。
- [x] RED→GREEN：ctx.executionLifetime传入create/reply核心coordinator；shell INSERT在timeout race内预留原始DB子句柄，外层15s超时留unknown，迟到成功/失败都不重发、不清unknown、不继续模型派发。直接调用helper时父scope必须仍有效。
- [x] 验证：新增controller/drain/router/shell行为测试，再运行已有core create/reply/建议/plan/恢复测试；后端全量tsc，小文件Biome，tasks.ts仅局部diff（不重排万行既有代码）。独立只读审查并逐项修复、最后新鲜复验。本地提交和PROGRESS/自动化续接以最新台账节点记录。

执行命令（apps/orchestrator）：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run <本单元精确文件> --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。测试用实际私有临时文件和真实controller，DB/模型只在传输边界使用合成夹具，不能注入生产许可。

## 审查修复记录（本地）

- 首轮独立审查发现两项 Important，真实 router 反例于 14:50 JST 均得到 unknown=0/idle=true 的 RED，14:51 修复后 2/2 GREEN：shell 已确认但 runtime resolve 跨原截止的 creationUnconfirmed 留票；幂等 finalize 三次 false 的既有 onFinalizeFailure 留票。保持原 ACK、重试次数、额度规则不变。
- 追加正常 create/reply 的关闸后完成，以及 shell/create-admission/reply-admission 的迟到成功和失败，共 8 个实际路由用例；这些使用合成 DB/fetch 边界及真实 controller 私有状态文件，不是真实千问或生产验证。
- 最终 14:52 JST 12 文件 **315/315**（17.11 秒）；完整后端 tsc --noEmit、11 个小 TS 文件 Biome、git diff --check 通过。tasks.ts 全文件 lint 仍有既有诊断，未声明全仓 lint 通过，未格式化万行文件。保留旧 localstorage-file 警告。复审两项 Important 关闭，无 Critical/Important/必修 Minor，只准本地检查点。

## 尚未完成的全进程门禁

boot/index仍未注入控制器，故生产功能不启用。HTTP/WS及其他任务mutation、定时/队列/reaper/能源等仍未全覆盖；模型、建议、计划内原始timeout仍需接线。create的旧执行分支可能detach，不称完整create业务后台已覆盖。尚未完成覆盖表/首次旧版本维护/回滚/Linux/PM2/真实千问/有效新窗口，不得把本root或core idle当成进程排空。下一项先审计实际模型传输与建议/计划原始Promise，并继续全进程覆盖。
