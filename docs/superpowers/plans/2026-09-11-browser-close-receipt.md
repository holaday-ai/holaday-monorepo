# Browser关闭回执实施计划（3D-3b-3c-9b）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现，只复用review_qwen_negation只读审查，重任务与审查串行。

**Goal:** 受拥有的Browser关闭不得因公开SDK吞TargetClosedError而误报安全结束。

**Architecture:** 在获取Browser后、request guard及ready之前按当时lifetime选择严格或legacy模式。严格模式预绑定一次性close capability，捕获真实固定SDK Browser/channel/Connection/关闭通知Promise；guard与失败fallback共享同一回执。仅调用原channel.close({})，等待真实ACK及Browser关闭通知，不调用共享Connection.close、不扩大原CDP/managed关闭权限；错误留unknown。

**Tech Stack:** Playwright/core1.59.1、TypeScript、现有ExecutionDrain/Vitest；无新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md与2026-09-10-process-drain-coverage.md。

## Global Constraints

- 基线614249a1、codex/qwen-safe-drain、现有隔离worktree；主8草稿、冻结分支/PR237包/QA不变。
- Node堆2048MiB、显式Vitest单线程无文件并行，每批≤20文件；free<40%或磁盘<10GiB不启重任务，总预算约10GB。
- 08:30 JST窗口已过；不生产、不安装/Docker/实际浏览器/网络/DB，不触禁止领域，不输出身份/秘密/业务文本。
- 单元仅证明client关闭RPC与SDK关闭通知，不证明远端动作、所有driver或OS组后代退出；不因此允许部分PR/部署。

## 源码事实与设计审查

client/browser.js close先调用_channel.close再await_closedPromise，但catch吞TargetClosedError；Connection.close会reject pending callbacks并清表，因此公开close成功不足为证。server BrowserDispatcher.close将potentiallyClosesScope设true，正常Browser scope dispose不取消自己的close命令；server Browser.close等browserProcess.close。CDP browserProcess.close仅closeAndWait WebSocket及artifacts cleanup；managed权限仍是原launch产生的Browser。pool TERM/宽限/KILL没有OS退出证明，本单元不改pool/spawn。

唯一review_qwen_negation设计审查要求：acquire时捕获而非dispose时临时读取；严格模式来自获取时lifetime；绑定失败不降级公开close；共享关闭Promise早于任何getter/RPC派发登记；形状漂移不丢弃已派发raw；成功必须ACK+关闭通知；proxy每次close getter函数可不同，不能错误比较函数对象；保留请求重入/事件等待与无scope旧行为。

## 文件与接口

- 新增apps/orchestrator/src/agent/vision-loop/browser-close-receipt.ts，导出bindBrowserCloseReceipt(browser: Browser): () => Promise<void>。只返回固定绑定Browser的close，不暴露通用action/owner/finish。固定版本与真实Browser/Connection/native close、_shouldCloseConnectionOnClose===false、channel._object、_closedPromise验证；捕获字段在派发前/结束核对。创建失败抛固定UNSUPPORTED。
- 修改owned-cdp-connection.ts、owned-managed-browser.ts：获取后用当前捕获lifetime选bind或legacy闭包，存同一closeReceipt；严格绑定失败留unknown，fallback不得调用公开close。guard建立失败时仅用已绑定receipt；重复dispose保留现有共享结果。
- 修改browser-request-guard.ts：构造接受固定closeBrowser回调（默认旧browser.close，仅无scope/既有直接调用兼容），替换原close调用点；不改变stop/route准入/异常与事件等待顺序。
- 新增browser-close-receipt.test.ts：真实SDK Connection/Browser及真实owned/drain，合成driver响应与close事件。已有合成SDK资源测试显式隔离新helper，只断言原资源编排，不冒称其为真实close验证；真实route套件的Browser.close原本合成，同样明确隔离close边界。

## 完整单元

- [x] RED：从现有owned lease实际调用dispose，Connection.close拒绝raw时公开SDK吞错导致idle；driver返回TargetClosedError同样应unknown。两种lease都覆盖。

```ts
const resource = await ownedFixture('cdp');
const closing = observed(resource.lease.dispose());
await flush();
resource.connection.close('synthetic disconnect');
await closing.finished;
expect(closing.error).toBeDefined();
expect(resource.drain.snapshot().unknown).toBe(1);
expect(resource.drain.snapshot().idle).toBe(false);
```

- [x] GREEN：绑定时验证固定形态；返回函数首次调用先缓存Promise，再deferred执行读校验和原close RPC。原方法固定receiver，raw在try中等待，不吞TargetClosedError；ACK后等待原_closedPromise，监听绑定Connection的close以将通知丢失归为unknown（不把它作成功，不清表/断连接）。监听器finally清理；已派发RPC必须先settle，不能让断连/形态检查抢先释放真实raw。统一固定错误BROWSER_CLOSE_RECEIPT_FAILED，不输出原error。

```ts
let receipt: Promise<void> | undefined;
return () => receipt ??= Promise.resolve().then(async () => {
  assertCapturedShape();
  // Install bounded close observer, retaining only this bound Connection.
  await originalChannelClose.call(channel, {});
  await observedBrowserClosed;
  assertCapturedShape();
});
```

- [x] 补回归：ACK未到但Browser通知先到仍pending；ACK先到而通知未到仍pending；Connection断开在ACK前/后均拒绝unknown；错误形态/remote flag零派发；重复close及真实newListener hook重入不双发；获取后字段漂移不重定向；派发后漂移先等原raw再失败；guard建立失败的fallback仍同一receipt；sealed/blocked/unknown后清已拥有资源；无lifetime原公开close兼容。SDK自有数据字段拒绝accessor且不执行getter，绑定期异常固定UNSUPPORTED。只观察固定close，不访问任何其他Browser context/page或共享Connection.close。
- [x] 串行运行新SDK及相邻≤20文件回归、完整tsc、精确Biome/diff；复用唯一reviewer最终只读复审。完整单元合格后仅本地提交；QA与原自动化记录下一未覆盖driver/OS边界，不重做本单元。

## 验证记录

- 11:46 JST，HEAD614249a1，仅qa-artifacts未跟踪，free70%、142GiB。固定SDK client/server/dispatcher/transport及pool源码核对，未访问真实driver/生产。设计方向获唯一reviewer通过，以上两项Important已纳入接口与测试要求。
- 11:52:34 初始8项4有效RED（两模式disconnect/TargetClosedError被吞），4项ACK/通知顺序兼容；11:54:10 8/8 GREEN。
- 11:55:41 _closeReason setter重定向Connection反例有效RED，赋值后再次校验后GREEN。11:56:31 专项24/24；11:59:09 相邻19文件502/502（8.85秒）。旧测试7文件的简化Browser/合成close需显式mock新固定helper；不改生产代码以接受测试替身，不称其为真实SDK关闭证明。
- 12:00:12 增补真实Route事件与真实close边界组合：CDP/managed的ACK成功/失败均不能提前释放另一在途abort；28/28通过。没有mock这些组合的close或route适配，只在独立guard初始化失败反例中故障注入constructor。完整后端tsc和最终复审继续检查。
- 独立审查发现末端getter仍可重定向连接，以及removeListener hook在最终检查之后断连/漂移/抛原始错误。12:05:07新增5有效RED（33项中28通过）；改为SDK自有data descriptor核验，整个绑定异常归一UNSUPPORTED，监听器清理放入固定错误边界并在其后再核验。不是对任意恶意同进程Proxy/SDK原型篡改的沙箱防御。
- 12:10:21兼容回归定位：固定SDK EventEmitter构造器将on/off分别赋值为addListener/removeListener；比较必须使用这两个原型方法，不能用prototype.on/off。按实际源码修正后12:12:03专项33/33。12:12:53最终19文件511/511（8.97秒），完整后端tsc退出0，精确12文件Biome和diff检查通过。没有启动真实浏览器、driver、网络或OS进程。
- 唯一review_qwen_negation最终只读复审确认两项Important关闭，无剩余Critical/Important/必修Minor，可作为完整本地单元提交；不构成整机制PR或生产部署批准。最终free69%、磁盘141GiB，所有重任务与审查串行。
