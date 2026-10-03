# 模型原始传输生命周期（阶段 3C-1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: executing-plans、test-driven-development。单主实现，复用唯一只读 reviewer；审查与重任务串行。

**Goal:** 千问 messages/responses 的缓存传输对象在每次实际调用时继承当前有效 owner；结果先交付，原始 fetch、body/read、cancel 全部结束后才释放物理占用。

**Architecture:** startOwnedOperation 用 Node AsyncLocalStorage 在真实 action 期间绑定不可变内部 lifetime；不从请求解析、不保存到 adapter 实例。新增模型操作包装器同步 reserve/pin model 子句柄，分别维护返回给调用者的结果 Promise 和涵盖所有原始传输/清理的物理 Promise。超时/取消或异常在实际派发后保留未知；预取消不派发、不留未知。仅现有清理动作允许在关闸或永久 block 后继续，不能把清理能力用于新请求。

**Tech Stack:** 现有 Node async_hooks、TypeScript、Vitest，无安装。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md

## Global Constraints

- 本地隔离 codex/qwen-safe-drain；不推送/PR/部署部分组件、不访问生产，过期窗口不复用。
- Node heap2048MiB；Vitest maxThreads=1/minThreads=1/no-file-parallelism，每批≤20文件；重任务串行、空闲内存<40%或磁盘<10GiB不启动。不安装、不启Docker/浏览器。
- 保护主工作区草稿、PR237冻结包；不改支付、奖励、提现、PartnerLedger、额度、账号注销、DivineAPI、旧供应商配置。不输出秘密或原始身份/业务文本。

## Task 1：真实千问传输与异步所有权

**Files:** execution/owned-operation.ts及测试；新增llm/model-operation.ts；llm/qwen-messages-transport.ts、responses-adapter.ts；新增llm/model-operation.test.ts和llm/model-transport-drain.test.ts。

**Interfaces:** owned-operation导出只读`currentOperationLifetime(): OperationLifetime | undefined`。新增`runModelOperation<T>(action:(operation: ModelOperation)=>Promise<T>): Promise<T>`，operation提供`run<T>(action:()=>Promise<T>):Promise<T>`跟踪原始IO、`cleanup(action:()=>Promise<unknown>):void`跟踪既有资源清理并观察错误、`markUnknown():void`只在已派发时留票。无ambient scope保留旧调用，无默认开放；scope存在但失效必须拒绝，不降级为无跟踪执行。

- [x] RED：真实缓存messages/responses在两个不同root之间复用，分别计数；outer ACK先结束，延迟fetch仍占用；stale async scope调用缓存实例零fetch且拒绝；并发不同drain不串属。

```ts
const root = startOwnedOperation(drain, 'request', async () => {
  pending = cached.messages.create(request);
}, { errorOutcome: 'unknown', dispatch: 'immediate' });
await root.result;
drain.close();
expect(drain.snapshot()).toMatchObject({ idle: false, byKind: { model: 1 } });
```

- [x] GREEN：在owned action的dispatch校验之后用AsyncLocalStorage.run冻结scope；model包装器在调用时获取scope，同步pin子操作；公开结果不等待pending清理，物理finally等待所有注册原始Promise。IO派发前重验guard；cleanup仅执行既有reader/body cancel并保持占用，异常保守unknown，不允许通过关闭闸门跳过清理。
- [x] RED→GREEN：真实messages的fetch忽略abort、JSON body延迟/拒绝；responses terminal后cancel延迟/拒绝仍计数但不延迟结果；abort-race reader.read原始Promise与cancel均观察；HTTP非200 body必须清理，重试前原body已收口，原重试上限不扩大。
- [x] RED→GREEN：abort/timeout在物理派发后立即留未知；迟到成功不清未知也不再返回正常成功；pre-abort零fetch、unknown0；after-request-error不能因辅助层catch吞错而假idle。原始read/cancel迟到失败无unhandled。
- [x] 完成前：25项既有transport基线已于15:33通过；新增与原transport/runtime/core/真实router回归，完整后端tsc、小文件Biome、diff。复用独立只读审查，必修项TDD修复，最后新鲜复验。本地提交、台账及自动化续接以最新检查点记录。

执行：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run <精确文件> --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 独立审查修复（本地）

- 第一轮3项Important：逻辑结束后ALS仍可利用仅清理存活的owner派发；messages在JSON读前guard拒绝时漏处置已取得body；纯请求转换移出catch导致原错误泄漏。5条实际传输反例15:46 RED，15:47 GREEN（guard用例先修正固定错误枚举的期待，再验证真实cancel计数0的RED）。
- 增加 `withOperationDispatchScope<T>(action:(seal:()=>void)=>T)`，在同一物理owner上创建可封闭的内部ALS上下文；模型逻辑结果结束先seal，再等待原始清理。getter与同属显式child入口拒绝已封上下文；先前已接纳child的独立上下文不受父seal取消。资源清理能力自身仍封闭，不能复用。
- JSON读前guard拒绝仍取消并跟踪未锁定body；请求转换独立catch固定PROVIDER_ERROR且仍位于物理run之前。新增先前已接纳子模型继续完成测试。15:47五文件66/66通过，最后复审和全组验证另记。
- 最后复审3项Important全部关闭，无Critical/Important/必修Minor。追加晚到JSON非法分支后，15:52 JST最终 **18文件368/368，16.85秒**，覆盖真实router/core/模型runtime/两协议adapter/owned/controller。完整后端tsc与6文件Biome通过，保留旧localstorage-file警告，不称全仓lint/真实千问/MySQL/生产已验证。测试中body提前锁定造成的夹具失败已用Node真实Response复现，改为先构造Response；不是业务缺陷。

## 未覆盖范围

本单元覆盖真实模型传输，不声称辅助链的全部DB已跟踪。下一单元用真实core plan/suggestions入口验证超时和主结果先交付，并给isCurrent/persist/publish及外层plan预算原始Promise绑定所有权；不能因辅助链catch吞错或callback晚启动丢失未知。boot/index、其他任务/HTTP/WS/调度/reaper、全进程覆盖表、首次旧版本维护与回滚、新工具/Linux/PM2/真实千问/有效生产窗口仍未完成，任一缺失都阻断发布。
