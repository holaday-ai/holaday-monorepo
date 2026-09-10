# CDP连接与初始化原始操作生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，复用唯一只读reviewer，与测试/类型检查串行。

**Goal:** 连接、重连及初始化SDK操作在外层catch或两秒banner等待结束后，仍保留真实原始操作和不确定失败。

**Architecture:** 复用runBrowserOperation与当前server-only scope，不创建根、不保存旧owner、不修改接纳策略。仅对真实SDK调用建立execution子owner；保留现有返回值、best-effort和超时时限。路由安装Promise与之后的路由事件生命周期分开，后者尚未接入，继续阻断发布。

**Tech Stack:** TypeScript、Vitest、真实PlaywrightExecutor/ExecutionDrain，constructor注入合成CDP传输；无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；process-drain-coverage.md。

## Global Constraints

- 约10GB内存预算，Node heap2048MiB；Vitest单线程且无文件并行，每批≤20文件；free<40%或磁盘<10GiB不启重任务。reviewer与重任务串行。
- 现有隔离codex/qwen-safe-drain，基线67457475。不安装、不新开Docker/浏览器、不访问生产。主8草稿/PR237冻结包不变；禁止领域、配置及秘密不触碰。
- 不将SDK Promise结束当作浏览器资源/OS后代已退出。不启用boot、不解除Qwen browser未迁移门禁，不独立发布。

## 真实路径与本单元边界

- pool.spawnInstance→waitForCdpReady→executor.connect→connectOverCDP→可选newContext→route安装→stealth addInitScript→banner evaluate/2s timeout。
- getPage/resetPageForTask→reconnectIfStale→connectOverCDP→相同初始化。各层catch当前会吞掉原始失败，banner超时可先返回而evaluate仍运行。
- 本单元修改五个方法：connect、reconnectIfStale、applyNetworkPolicyToContexts、applyStealthToContexts、dismissBraveBanners。实际方法getter/receiver在owned action内，route可选性保持。
- launchManaged、disconnect/disposeCleanContext、assertCleanContext、fetch readiness/body/timer、pool hook/banner timer、长期资源及route事件是相邻但不同的边界。本单元不更改这些生命周期或伪造其所有权；后续要单独证明，整体发布仍受阻。

## 单元：原始连接与准备操作

**Files:** 修改apps/orchestrator/src/agent/vision-loop/playwright-executor.ts；新增playwright-executor.connection-drain.test.ts；本计划及覆盖清单。

**Interfaces:** 沿用runBrowserOperation<T>(action:()=>T|PromiseLike<T>):Promise<T>；无scope保留旧调用，scope受unknown/sealed/失效owner控制。connect仍返回ConnectResult，重连仍通过真实getPage触发，banner仍两秒上限。

- [x] RED：六个原始阶段connect/reconnect/newContext/route/stealth/banner，分别挂起成功/失败，执行真实executor和drain；原始action必须独立child并且调用者超时不能变idle。同步/getter失败在业务catch前留unknown。

```ts
const root = startOwnedOperation(drain, 'request', () => executor.connect(endpoint),
  { dispatch: 'immediate', errorOutcome: 'known' });
drain.close();
await advanceTimers(2100); // banner waiter may have returned
expect(drain.snapshot().idle).toBe(false);
raw.resolve();
await root.result;
```

- [x] RED：unknown/sealed/已结束scope不派发新SDK；banner两秒后迟到拒绝仍unknown；原始owner普通finish不能解除占用。无scope连接/重连/缺可选route等兼容。
- [x] GREEN：逐调用最小包装，不能只包外层connect或只依赖它的Promise。route安装包装不改变handler正文；banner保持原DOM脚本与2秒等待，stealth保持原内容与receiver。

```ts
const browser = await runBrowserOperation(() => this.chromium.connectOverCDP(endpoint));
await runBrowserOperation(() => context.addInitScript({ content: STEALTH_INIT_SCRIPT }));
await withTimeout(runBrowserOperation(() => page.evaluate(existingCallback)), 2000, label);
```

- [x] 验证新增矩阵、旧executor/clean context、pool停止/旧pool、既有browser drain与owned/drain相关回归，完整后端tsc，新测试与五方法Biome、方法外源码一致性和diff。独立审查→修反例→最终复验→精确4文件本地提交→ledger及原自动化断点。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-loop/playwright-executor.connection-drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 实施证据（JST）

- 03:40旧clean-context基线5/5。03:42新增39项，修正fixture的sealed记录（记录函数不能自己阻止SDK来制造通过）、finish API预期后，33项有效RED、6项旧无scope兼容通过，无unhandled/清理超时。
- 03:43最小五方法包装后39/39。03:44扩大8文件222/222，6.43秒；完整后端tsc通过。初次tsc指出测试Promise联合推断，明确then<unknown>后通过。新测试Biome、diff及五方法之外逐字相同检查通过。
- 独立只读reviewer无Critical/Important/必修Minor，允许最终门禁后本地提交。补充1条可选route不存在的兼容测试（无生产改动），03:49最终8文件223/223，6.42秒；新矩阵40=33有效RED对应修复+7兼容。五个修改方法及新测试Biome通过，方法外源码不变，完整后端tsc通过。
- 资源free70%、磁盘143GiB；所有重任务串行，reviewer与重任务错开。无真实CDP/浏览器/OS、数据库、模型、PM2或生产验证；不独立发布此单元。
