# 浏览器页面原始操作与超时后清理计划（3D-3b-3a）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans，单主实现及唯一复用reviewer串行。

**Goal:** 在直接打开网页实际使用的Playwright页面方法中，原始SDK Promise即使被超时或业务catch掩盖，仍计入生命周期与未知。

**Architecture:** 新runBrowserOperation在SDK调用前读取当前server-only scope，同步预留execution子owner，原始Promise结束才释放；无scope保持原行为。直接包装真实executor中的页面创建、关闭、探测、导航、截图、视口和既有脚本注入原始调用，不仅包runDirectOpen外层。停止新调用与已派发收尾分开。

**Tech Stack:** TypeScript、已有ExecutionDrain/startOwnedOperation、Vitest、真实PlaywrightExecutor与合成CDP接口；无新依赖/浏览器。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md；process-drain-coverage.md。

## Global Constraints

- 仅本地单元，完整机制/维护/平台/真实千问门禁完成前不发布部分；用户新夜间授权不替代发布证明。
- 总内存约10GB、Node堆2048MiB，Vitest单线程无文件并行≤20文件；free<40%或磁盘<10GiB不启重任务；reviewer与重任务串行。
- 不安装、不启动Docker/新浏览器，不动主草稿/PR237包，不触支付/奖励/提现/额度规则/账号注销/DivineAPI/旧模型配置，不输出秘密和真实个人数据。
- 保持Qwen browser未迁移门禁。此单元不涵盖BrowserPool子进程/保留timer、CDP连接/重连/路由事件、persistVisionOutcome原始DB；下单元继续，不能宣称完整direct-open链。

## 独立单元：页面SDK边界

**Files:** 新agent/vision-loop/browser-operation.ts及playwright-executor.drain.test.ts；只修改playwright-executor.ts的getPage/resetPageForTask/reopenActivePage、applyTargetViewportToPage/applyStealthToPageIfNeeded/isPageResponsive、screenshot/navigate相关原始调用；覆盖表。

**Interfaces:** `runBrowserOperation<T>(action:()=>T|PromiseLike<T>):Promise<T>`，实时scope、unknown屏障、同步预留并immediate派发，errorOutcome unknown；调用者只能拿结果不能释放。使用现有execution工作类型，无新公开计数或root API。

```ts
await runBrowserOperation(() => ctx.newPage());
await Promise.race([
  runBrowserOperation(() => close.call(page)).catch(() => {}),
  new Promise<void>(resolve => setTimeout(resolve, 1500)),
]);
void runBrowserOperation(() => page.evaluate('existing script')).catch(() => {});
```

- [x] RED：真实executor通过constructor注入合成CDP，仅替换SDK传输，不mock计数器/执行器方法。页面newPage/close/evaluate/goto/title/screenshot/setViewportSize/addInitScript延迟成功/失败时检查回调进入独立child、结束前不idle、被catch吞错仍unknown。
- [x] RED：reset旧tab关闭1500ms超时、probe超时、已有脚本evaluate与reopen close detached在父返回后仍活动；旧调用receiver完整传入，发生未知/封闭/失效scope不得调用下一个SDK；普通close后既有子链仍能完成。
- [x] GREEN：helper包装各原始调用；close/evaluate保留正确receiver。不改变超时值和用户可见返回契约，失败或guard仍走原有catch；未知不继续SDK重试但原先已发出的Promise继续收尾。sharp metadata原生异步也包装。
- [x] 回归：新矩阵、旧executor/clean-context/stealth/direct-open/queue/owned/drain相关≤20文件串行；后端完整tsc，小文件Biome，大文件仅精确区段变更检查，diff。
- [x] 独立审查→必修反例RED/GREEN→最终验证→本地提交与台账/自动化断点；下一单元pool/连接及实际结果保存，禁止声称全进程完成。

命令（apps/orchestrator）：`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/agent/vision-loop/playwright-executor.drain.test.ts --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1 --no-file-parallelism`。

## 验证记录

首轮fixture的probe receiver断言掩盖原始调用、sealed探针自身抛错、未使用gate缺观察导致unhandled，先修测试装置；00:43重新运行30/30有效RED（旧父owner、已有unknown仍派发、超时后虚假idle）。实现后30/30GREEN。后9项通过临时旁路owner包装及恢复旧receiver观察9/9RED，恢复后39/39GREEN；临时mutation已删除。

独立审查发现getter位于owned action外，可能被allSettled吞掉或detached IIFE产生未处理拒绝。新增7项有效RED（含1条真实unhandled反例）后，把可选方法读取/typeof/receiver调用共同移入包装，detached捕获整个包装结果；46/46GREEN且无unhandled。复审无剩余必修项。

最终00:55 JST，11文件287/287，11.39秒；完整后端tsc通过，两个新TS与八个修改方法独立Biome检查通过，方法外/import以外源码逐字不变，git diff通过。未做完整历史executor lint、真实浏览器/DB/模型/生产验证。资源free69%、磁盘143GiB，无新进程/安装；重任务与reviewer串行。
