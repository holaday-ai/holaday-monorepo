# 隔离浏览器上下文资源生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，仅复用已有reviewer，全部重任务串行。

**Goal:** 隔离context从newContext派发到真实close结束持续登记，超时清理、重复清理和迟到结果不能伪造释放或复活资源。

**Architecture:** 新建只服务BrowserContext的私有绑定lease：ready可先交付，资源owner继续持有私有pin；创建scope在交付时seal，dispose只关闭这一个context，不接受任意action/ID。executor同步锁住setup轮次，generation阻止旧结果写回；清理保留共享成功/失败回执。

**Tech Stack:** TypeScript、现有ExecutionDrain/startOwnedOperation/withOperationDispatchScope、Vitest与constructor合成SDK，无新依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md、process-drain-coverage.md。

## Global Constraints

- 基线063f0618，现有隔离worktree。内存预算约10GB、Node heap2048MiB、Vitest显式单线程无文件并行且≤20文件。free<40%/disk<10GiB不启动重任务；reviewer和重任务串行。
- 不安装、不启Docker/真实浏览器、不访问生产或真实身份/秘密/业务文本；主8草稿、冻结PR237不变。不触禁止领域、配置、Qwen browser gate和boot接线。全机制及所有发布门禁完成前不得发布本单元。
- 浏览器本体/CDP WebSocket/managed launch与browser.close原始操作/OS后代、pool hook/timer及全局停止仍不由此证明。停止编排必须先dispose资源再等idle；不能等资源pin自行消失。

## 已核对根因与设计审查

disposeCleanContext先null再await close导致重入早返回；connect/launchManaged的newContext可能迟到写入；assertCleanContext读取后可能检查的是已被dispose的旧对象。explorer runner在硬超时回调、catch和finally重复调用dispose，要求共享真实回执。

唯一reviewer设计审查要求：首await前setup占位；资源ready后seal创建派发scope；cookies检查绑定lease/generation且失效后不认证/不误关新资源；初始化失败清自己的lease，close失败保留unknown和回执。全部纳入本单元。

## 单元文件与接口

- 新增apps/orchestrator/src/agent/vision-loop/owned-clean-context.ts：createOwnedCleanContext(browser, options?)返回只读{ready:Promise<BrowserContext>,dispose():Promise<void>}。无scope仍提供相同清理协调。实际newContext在预留owner并返回lease后的deferred action内派发，以先赋值后允许同步SDK重入。
- 修改playwright-executor.ts的connect/launchManaged/assertCleanContext/disposeCleanContext/disconnect及少量私有setup状态。其他动作不改。
- 新增playwright-executor.context-resource.test.ts，扩展旧connection-drain fixture的close与资源释放，以适配资源寿命不再等于newContext调用寿命。
- 更新coverage和本计划。结果记录在原ledger，原holaday自动化接续。

## 实施步骤

- [x] **RED资源持有与实际收尾：** 从真实executor公共方法连接/launch的合成SDK，创建成功父ACK后active仍非零；close挂起时并发dispose/disconnect都不得完成，失败后重复dispose仍失败且unknown保留；close getter/sync/async错误在返回前登记。测试释放所有gate，不遗留pending/unhandled。

```ts
await root.result; // real connect already returned ready
expect(drain.snapshot().idle).toBe(false);
const first = observe(executor.disposeCleanContext());
const second = observe(executor.disposeCleanContext());
await flush();
expect(second.state.done).toBe(false);
closeGate.release();
await first.finished;
await second.finished;
expect(drain.snapshot().idle).toBe(true);
```

- [x] **RED权限与竞态：** block/unknown/seal/父结束后仅绑定dispose仍运行；captured创建scope不能再派生新SDK。dispose发生在CDP/launch/newContext挂起时，迟到结果不写回，已创建context须close，尚未newContext不得开始；并发connect/launch不得重复SDK。cookies挂起期间dispose后不能返回通过；dirty检查只能dispose其捕获lease。setter/route初始化失败须清理已取得lease。
- [x] **GREEN绑定资源lease：** 当前scope下先验unknown，再startOwnedOperation(...execution,parent,known,deferred)。action内仅实际acquire或close错误markUnknown；控制拒绝/dispose-before-dispatch不记成已派发失败。ready交付前校验当前owner/unknown，seal后等待dispose信号；finally直接等待绑定context.close，无新准入或通用action。pending结果始终有内部拒绝观察者，dispose返回原始终态回执，不吞错误或重试。

```ts
// One admitted resource, not a reusable dispatch capability.
const operation = startOwnedOperation(drain, 'execution', async owner =>
  withOperationDispatchScope(async seal => {
    let context: BrowserContext | undefined;
    try {
      if (disposeRequested) { rejectReady(new Error('CONTEXT_DISPOSED')); return; }
      context = await acquireWithUnknownOnFailure(owner);
      assertStillAllowed(owner);
      if (disposeRequested) { rejectReady(new Error('CONTEXT_DISPOSED')); return; }
      seal(); resolveReady(context);
      await disposeSignal;
    } finally {
      seal();
      if (context) await closeBoundContextWithUnknownOnFailure(owner, context);
    }
  }), {parent, errorOutcome:'known', dispatch:'deferred'});
// Failure of operation rejects ready if not delivered yet; every dispose returns operation.result.
```

- [x] **GREEN真实executor接线：** setup共享私有锁在首await前占位，拒绝并发connect/launch，保留已连接快路径。setup记录generation，本轮lease保存于newContext调用之前；dispose递增generation并清页面引用，但保留lease回执。await之后核验generation/lease身份；失败只清本轮对象，不覆盖其他轮次。assert捕获context/lease/generation，cookies经runBrowserOperation，await后复查；dirty时只dispose捕获lease。disconnect等待所有已发起context清理/setup，即使browser字段已空也不提前返回；并发共享回执，失败不清记录。
- [x] **最终验证与收口：** 新矩阵、旧executor/clean-context/connection-drain/owned/drain/pool相关串行回归，完整后端tsc，新增文件与所改方法Biome、其他源码一致性、独立复审及最终重跑。精确本地提交本单元文件；记录HEAD/时间/计数/限制和下一项，更新原自动化，不PR或部署部分机制。

Run（apps/orchestrator）：`LOG_LEVEL=fatal NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-loop/playwright-executor.context-resource.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 实施证据（JST，最终验证）

- 05:48纠正两个fixture问题（unknown应使用仍有效的独立合成证据owner；并发测试不能直接await错误实现的挂起SDK）后，22测试17有效RED+5旧兼容，无超时/unhandled；05:50最小实现22GREEN。
- 自检补取消成功不能被误作cleanup失败的3条RED，以及managed setter同步重入disconnect导致browser.close两次的1条RED，均修复。补旧dirty检查不关闭替换context、blocked/unknown后的迟到acquire清理验证，新增矩阵27项。05:55新27+旧connection40共67/67。旧connection测试两条仅在newContext场景增加显式资源dispose，其他调用寿命不变；初次误对全部stage要求resource非空的fixture已改为stage限定。
- 新3文件Biome通过，完整后端tsc阶段性退出0；待最终扩大矩阵和最后修改后的完整类型检查。没有实际浏览器/网络/OS/生产或发布build验证。浏览器本体仍保留旧best-effort关闭规则，本单元不是它的释放凭证。
- 独立审查要求阻止dispose后的后续初始化SDK。新增7项中6有效RED+1已有间接保护，补setup独立scope同步seal、每context/page及getter后的generation检查、setter间检查，以及deferred setup实际action前实时owner/unknown检查，06:00新34+旧connection40共74GREEN。
- 复审新增getter-triggered dispose被raw wrapper误记unknown的Important；06:03 route/stealth/banner三项有效RED，改私有boolean generation guard+内部取消sentinel，wrapper外转固定取消错误；真正getter/SDK抛错仍unknown。06:05新37+旧40共77GREEN，最后独立复审无剩余Critical/Important/必修Minor。
- 06:06:56 JST最终9文件260/260，6.55秒：新37、旧connection40、clean5、executor47、raw browser46、owned16、drain20、pool stop23、pool26。资源free69%、磁盘143GiB；Node堆2GB、显式单线程无文件并行，审查与所有重任务串行。
- 最终类型检查发现addInitScript返回Disposable与取消sentinel联合推断冲突，回调改async统一Promise返回类型，不改变实际SDK派发顺序。修正后06:14:12 JST完整9文件重新260/260（6.59秒），06:15完整后端tsc退出0；新/适配3文件Biome通过，10个修改方法的stdin格式与lint检查一致，无规则忽略。AST核对33个有名称的未改成员及构造器、未来route handler正文不变；git diff --check通过。最终free68%、磁盘143GiB。全部是本地合成验证，不含实际浏览器、OS、Linux/PM2、Qwen或生产发布验证。
