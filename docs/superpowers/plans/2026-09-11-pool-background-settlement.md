# 浏览器池后台生命周期与原始SDK收尾实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。主智能体实现，唯一review_qwen_negation只读审查；重任务与审查串行。

**Goal:** allocate可先返回，但后台hook/3秒timer及其timeout后的真实SDK仍计数；release先停止后台派发并等实际收尾，再断开连接。

**Architecture:** browser-operation增加纯观察性的ALS settlement scope，收集实际Promise并在scope结束/stop后禁止新SDK，不创建或恢复执行权限。每BrowserInstance绑定私有后台对象，预留父生命周期，取消未开始timer并等已开始hook/raw结果，adoptRetained不改身份。release/shutdown从自己的hook重入时明确拒绝，避免等待自己。

**Tech Stack:** 现有Node AsyncLocalStorage、TypeScript、ExecutionDrain、Vitest；无新依赖。

**Spec:** 2026-09-10-safe-execution-drain-design.md、2026-09-10-process-drain-coverage.md及2026-09-11-pool-background-cookie-drain.md的7b。

## Global Constraints

- 基线50785159，codex/qwen-safe-drain既有隔离worktree；保护主8草稿、QA与PR237候选/manifest。
- 总预算约10GB，Node堆2048MiB，Vitest每批≤20文件且maxThreads=minThreads=1/no-file-parallelism。free<40%或磁盘<10GiB不启重任务，审查与重任务串行。
- 已过09-11 08:30 JST，不启动生产变更，不安装/新Docker/真实浏览器/网络/数据库。禁止领域、供应商配置、秘密/真实身份/业务文本不触碰；Qwen browser及boot注入保持关闭。
- 不能把SDK完成当OS/后代退出，整个机制与全部维护/发布门禁未齐前不PR/部署部分组件。

## 文件和接口

1. agent/vision-loop/browser-operation.ts增加withBrowserOperationSettlement<T>(action:(seal:()=>void)=>Promise<T>):Promise<T>。只增加dispatch否决和原始Promise观察；当前scope有pending Set、sealed和parent，runBrowserOperation原始result登记到所有祖先观察scope，任一sealed则零派发拒绝。action结束finally seal，并等待现有raw settlement；不把外层timeout当raw完成，不把自己scope的返回Promise登记成自己的孩子。无drain scope也能观察Promise，但不创建root或unknown票据。
2. 新browser-pool/background-work.ts，startPoolBackgroundWork(instance,config,logger,isActive):{stop():Promise<void>;isCurrent():boolean}。只绑定该实例、原config hook及executor方法，不导出owner/action/release能力。当前parent同步预留execution child，deferred工作确保pool先登记对象；无parent用同一Promise协调。stop同步stopped+seal+唤醒/clear timer，等待两条后台链和收集到的SDK。timer与hook同一整体owner，但各回调有独立settlement scope防止完成后逃逸。实际hook/SDK错误在raw包装内保留unknown，原best-effort日志保留，不阻塞allocate；纯取消在真实回调前零派发。
3. browser-pool.ts新增WeakMap<BrowserInstance,PoolBackgroundWork>。instance创建后先建立后台对象并注册，然后发布registry/exit listener。删除旧裸timer/hook；tearDownInstance先await stop再disconnect。release/shutdown最开始检查isCurrent，自己的后台链不得等待自己的cleanup。adoptRetained按实例身份继承。spawn失败时清已获得executor/后台对象，移除仅本轮匹配registry并释放slot，不能漏掉连接资源；已有release在途时只等待它，不双释放slot。
4. 新browser-operation.settlement.test.ts及browser-pool/background-work.test.ts，使用真实pool/executor/drain，只有进程/CDP/proxy/DB边界合成；原pool-stop/pool/browser/cookie回归。更新coverage/计划/ledger。

## 单元一：SDK settlement观察与否决

设计组合补强：新增只读assertBrowserSettlementOpen()，检查所有观察scope的sealed状态，不授予权限；7a的assertCookieDispatch最先调用它，因此无drain scope的后台stop也不能被旧cookie catch当legacy吞掉并继续DELETE。测试真实injectPendingCookies在SDK getter内seal及held读取期间stop，保证后续SDK/delete零派发；没有observer的legacy路径不变。

- [x] RED：外层Promise.race返回后scope结果仍pending，raw成功/失败才结束；sealed后捕获的异步回调零派发；嵌套scope的raw同时被祖先观察且无自等待；无scope兼容，无条件root数0；原owned错误unknown仍独立保留。

```ts
const done = withBrowserOperationSettlement(async () => {
  const raw = runBrowserOperation(() => gate.promise);
  await Promise.race([raw, Promise.resolve('timeout')]);
});
await flush();
expect(observe(done).done).toBe(false);
gate.resolve();
await done;
```

- [x] GREEN：私有ALS scope，真实result登记（成功/失败观察均不制造unhandled），seal只阻止新派发不释放任何pin。finally等待pending；不改变原始runBrowserOperation的unknown/parent准入规则。scope结束不允许迟到callback重开子scope。

## 单元二：真实pool后台协调

- [x] RED：allocate结束后timer/hook继续持有独立execution占用；release同步取消未到期timer，等待held hook原始SDK（包括banner超过原2秒timeout）后才调用CDP close/kill/释放slot。并发release/shutdown共享现有回执，retained adoption不丢后台身份。
- [x] RED：stop前未启动工作SDK零调用；getter触发release/关闸后不得续发hook/banner，真实getter/SDK失败留unknown；hook内部await release/shutdown迅速拒绝而非自等待。准备后台时capacity/blocked失败不留下已连接executor或registry/slot。pending allocation遇shutdown不启动晚到hook/timer。
- [x] GREEN：按接口实现专用后台对象与WeakMap接线。先保存stop回执，再允许任何hook运行；捕获实例及SDK句柄清理，不借taskId重建权限。保留原hook签名、3000ms时序及业务catch，不改cookie实现和index启动配置。

```ts
const instance = await pool.allocate('synthetic-task', 'synthetic-user');
const releasing = observe(pool.release(instance.taskId));
await advanceTimers(5000);
expect(sdkCloseCount).toBe(0);
rawGate.resolve();
await advanceTimers(3000);
await releasing.finished;
expect(sdkCloseCount).toBe(1);
```

## 完成门禁

- [x] 独立设计/代码审查，所有必修项TDD修复后复审；最终≤20文件单线程矩阵、完整后端tsc、变更文件/方法Biome、非范围源码一致性、diff检查。通过后精确本地提交；生产与未来route/OS/其他入口/全局boot/对账/维护门禁仍未完成。

## 验证记录

- 现场HEAD50785159且只有原QA未跟踪，初始free52%、磁盘143GiB；同一隔离worktree不安装/新浏览器。设计审查要求Cookie共享否决、stop等待两链/all raw后才返回、自等待guard早于现有Promise、观察全部祖先且不登记自己的返回；均纳入行为测试。
- 09:22:39 JST首轮18项16有效RED+2兼容，指向提前断开/遗漏计数/续发SDK/重入及晚到hook；observer初轮用无observer旧行为作窄测试基线，不以缺失export错误冒充行为RED，实现后改为直接调用真实导出。09:23:01 observer8/8通过；09:23:23 Cookie组合4项全部有效RED（getter后SDK仍调用、停后继续DB/delete），加入只读否决后通过。
- 09:24:20新组合73/73通过。旧回归唯一失败为late allocation的hook不再执行；修改为确认不执行，并在外部仍断言retain=false，未删除原租约保护验证。09:26:37补“shutdown等另一个allocation时旧hook继续派发”有效RED，最小修复为首await前同步stop所有已有后台；release同样在logger之前stop。
- 新pool19项覆盖容量争用清理、hook失败+held banner、超时真实SDK、getter blocked/unknown/throw、重入已有release/shutdown回执与adopt身份；observer8项，Cookie组合新增4。09:28:39五文件131/131，1.46秒。类型检查修正observer循环可选scope及测试联合Promise推断后全后端tsc退出0；6文件Biome、5个修改pool方法stdin格式/lint、25个其他pool成员逐字一致及diff通过。独立最终审查随后进行。
- 最后free67%、磁盘143GiB，Node2GB/显式单线程无文件并行。所有重任务与唯一reviewer串行；未做真实网络/DB/浏览器/OS/Linux/PM2/千问/生产/build验证，不是整机制发布就绪。
- 独立最终代码审查无Critical/Important/必修Minor，确认祖先raw登记、无自等待、cookie否决、stop先封闭再等全部链及容量失败清理。09:32:42 JST最终16文件396/396通过，7.92秒；随后完整后端tsc退出0、6文件Biome、5修改pool方法stdin lint、25其他pool成员逐字一致和diff检查通过。
- 主8项未跟踪内容保持原样；冻结分支仍66f3a58353951d536fb91bd5247607e77a6d71e1，PR237 manifest SHA256仍ad0f5c0064bd02887a896fbf9e4a89b16e227da29bc75a4094aa2c56759e8c40。只提交本单元精确10文件，不含qa-artifacts，不推送或部署；7a旧计划中的7b待办由本完成记录接续。
