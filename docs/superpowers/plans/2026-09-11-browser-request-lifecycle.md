# 浏览器请求回调生命周期实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。单主实现、仅复用review_qwen_negation只读审查，重任务不与审查并行。

**Goal:** 网络拦截注册完成后，未来请求仍属于真实浏览器资源；停止后不继续放行请求，不在SDK关闭前移除防护，真实回调IO未结束时不报告排空。

**Architecture:** 内部BrowserRequestGuard绑定已经取得的Browser及它的有效资源owner。NORMAL→ABORT_ONLY→绑定SDK close→CLOSED；close前只等待注册与已派发检查/continue，不等待依赖close才能结束的abort。close后封闭新SDK并等待所有已开始的abort/回调。资源lease原有pin覆盖全程，不另建root或接受任意关闭证明。

**Tech Stack:** 现有TypeScript、AsyncLocalStorage、ExecutionDrain、Playwright和Vitest，不新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md与2026-09-10-process-drain-coverage.md。

## Global Constraints

- 基线90c87be3，既有codex/qwen-safe-drain隔离工作树；保留主8草稿、QA、冻结PR237分支及manifest。
- 总任务预算10GB，Node堆2048MiB，Vitest每批≤20文件，显式maxThreads=minThreads=1和no-file-parallelism；free低于40%或磁盘低于10GiB不启动重任务。
- 已过2026-09-11 08:30 JST，不启生产变更；不安装/Docker/真实浏览器/网络/DB，不触禁止领域与配置，不读出秘密/身份/业务文本。
- 不能将SDK连接关闭当OS进程退出证明；全局入口、恢复对账、维护与平台发布门禁仍未完成，不单独PR或部署组件。

## 已核对的SDK语义

本机playwright-core 1.59.1 browserContext._unrouteInternal先替换本地_routes，再更新远程interception；_onRoute无匹配handler会_innerContinue。因此不能用提前unroute/unrouteAll作为安全停止。RouteHandler同时等待SDK handling Promise与用户callback；abort可能依赖transport close结束，必须避免先等待完整callback再close的环。

## 文件与接口

- 新agent/vision-loop/browser-request-guard.ts，由playwright-executor.request-lifecycle.test.ts通过真实executor/两个资源lease/ExecutionDrain覆盖，不再增加重复的孤立helper测试。工厂createBrowserRequestGuard(browser: Browser)只能内部绑定当前资源lifetime；返回guardContext(context: BrowserContext,policy: Pick<BrowserNetworkPolicy,'check'>):Promise<boolean>、stopRequests():Promise<void>、isInRequest():boolean和close():Promise<void>。close只调用绑定Browser.close，不接受caller action或任意receipt，不暴露owner/release/对账。
- owned-cdp-connection.ts与owned-managed-browser.ts在获取browser之后、resolveReady之前建立guard；原物理cleanup改用guard.close。lease向executor只暴露guardContext/stopRequests/isInRequest，不能访问close以外的释放能力。缺少browser时方法零派发安全结束。
- playwright-executor.ts的applyNetworkPolicyToContexts使用当前lease的guardContext，保留网络policy业务；stop/dirty/disconnect/reconnect/setup失败清理先停网络新派发，再等normal后清理context/browser。重入同资源的close/dispose先于快返回拒绝，防回调等待自身。
- 新playwright-executor.request-lifecycle.test.ts用真实executor/资源/drain及合成SDK；适配少量旧网络route测试，并保留原policy/拒绝断言。coverage和本计划记录证据。

## 完整实施单元

- [x] 独立设计审查并确认两阶段barrier、边界容量及错误分类。currentOperationLifetime只在绑定资源时捕获，固定回调全部由已有Browser resource pin和有界pending集合持有；只核验私有有效resource owner，不创建child、不使用已封闭setup owner、不用AsyncLocalStorage.bind复制旧observer、不按taskId恢复权限。
- [x] RED：已有guard注册后callback的check/continue期间真实资源仍active；stop阻止已held check之后continue，改abort；外层等待结束不释放实际SDK。late events只abort，continue计数0；close前无unroute，close后新SDK计数0；abort等待close才能完成时不死锁。

```ts
const checking = gate();
const callback = observed(registeredHandler(route, request));
await flush();
const closing = observed(boundGuard.close());
expect(browserCloseCount).toBe(0);
checking.resolve(allowedDecision);
await flush();
expect(continueCount).toBe(0);
expect(browserCloseCount).toBe(1);
closeReceipt.resolve();
abortReceipt.resolve();
await closing.finished;
expect(drain.snapshot().idle).toBe(true);
```

- [x] RED：真实getter/SDK同步异步错误保留unknown，单回调失败不提前结束其他raw；normal拒绝/capacity/blocked后只能失败关闭，不借新root；stop/close回调重入与既有receipt快返拒绝；注册失败/late ready和多context不丢回执。清理abort有固定有界集合，容量耗尽不能放行网络或清unknown。
- [x] GREEN：normal phase的每个实际policy/continue Promise同步加入独立normal集合；route.abort仅加入总raw集合。stop同步改phase并返回normal barrier。close共享回执，先stop，调用绑定SDK close（含getter）；成功CLOSED，失败FAILED_SEALED，均封闭所有新SDK后allSettled全部raw，再传播错误。失败保留unknown和原失败回执，不允许替换或继续迟到abort，不证明关闭/idle。注册RPC失败可能已经本地安装，保留guard直到同一真实资源cleanup，不按未成功安装丢弃。任何已经封闭的callback只能零派发结束，不提前unroute。
- [x] GREEN：接入两个browser资源与executor所有相关cleanup，callback不发布可复用scope/任意action；全程固定networkpolicy和context对象，不改允许范围、不关闭外部默认context，不引入可伪造finish接口。
- [x] 单线程目标及相邻回归、完整后端tsc、变更文件/方法Biome、范围外源码一致性和diff检查，独立代码审查无必修项后精确本地提交，更新ledger/原自动化。合成验证不是平台或整机制生产完成。

## 验证记录

### 固定SDK事件边界补充契约

独立审查发现公开route callback不足以安全处理错误：Playwright 1.59.1 EventEmitter会重新抛出_onRoute的拒绝；成功noop又使_startHandling悬挂。已用真实Connection/BrowserContext/Route/RouteHandler/EventEmitter与合成driver响应离线复现：noop留下pendingRouteEvents=1，abort错误在strict模式子进程退出1。之前直接observe(handler)的33项不能证明该事件边界，不得据此提交。

新增browser-route-events.ts固定兼容适配及真实SDK离线测试。仅1.59.1允许接入；验证context/channel身份、唯一route listener、无已在途route事件、无newListener/removeListener重入hooks，在首个route注册前精确替换单一listener。包装器在调用原listener前登记SDK事件，记录本资源unknown后必须正常settle（不全局吞错、不改变其他事件、不提前unroute）；关闭后不进入原listener，因此不会新建SDK handlingPromise。原listener整体置于本资源重入identity下。

stop仍只等待normal注册/check/continue；实际Browser.close之后seal入口，等待已开始SDK事件与callback。安装失败/半替换/终态listener漂移记unknown并拒绝发布；终态保留sealed wrapper、不恢复旧入口。容量1024在原listener之前拒绝且留unknown，仅限制本模块，不宣称SDK内部所有队列有界。真实原始错误不直接记录到日志/公开回执。

本适配是明确的固定私有SDK兼容契约，不是公共API保证；不修改node_modules、网络允许范围、外部默认context生命周期或driver进程。Playwright-client到driver的内部RPC（含safeRace）和OS资源仍需要独立覆盖，不能将本事件边界称为整个driver排空。

- 初始HEAD90c87be3，仅qa-artifacts未跟踪；free69%、磁盘143GiB。未启动重任务或真实浏览器，未改生产。
- 独立设计审查确认：复用Browser lease pin足够，不恢复ALS/派生future child；close前barrier只等registration/check/continue，不能等待abort；实际close失败只能FAILED_SEALED；安装RPC失败也可能已注册本地handler。按此收紧方案后开始TDD。
- 09:53:12 JST首轮14项全部有效RED：提前close/丢失raw、停后continue、SDK错误unknown丢失及重试。09:55:54最小14GREEN。扩展28兼容/故障/容量/无scope用例通过；09:58:45另加managed关闭后新CDP cleanContext场景有效RED（误用旧managed guard），改为显式传本轮lease后通过。
- 首次相邻回归发现旧context测试在释放注册RPC之前await dispose，其前提与新安全顺序冲突；中断该轮（退出130），改为断言dispose仍pending/close0，释放RPC后才close1，保留laterRoute/stealth/banner全为0的原断言。09:59:08六文件196/196，5.87秒。不中断或伪造真实SDK完成来迁就旧测试。
- 10:00:49注册SDK/close SDK重入等待自身4项有效RED；给实际调用加私有identity（不改变lifetime ALS），10:01:10新33+旧context37=70/70。10:03:08迟到callback固定拒绝2项RED后GREEN：成功noop会使SDK内部_startHandling一直pending。无新SDK派发的关闭拒绝不标unknown；实际SDK错误仍保留unknown，不重试continue/abort。
- 完整tsc先发现泛型cancelled和contextual typing，再发现测试Disposable必须包含Symbol.asyncDispose；修正类型及完整合成协议后全后端tsc退出0。5文件Biome、9修改executor方法格式化、43其他成员逐字不变；独立代码审查中。未验证真实网络/DB/浏览器/OS/Linux/PM2/千问/生产/build，不是全机制通过。

- 10:25:37真实SDK与资源lease集成测试在接入适配前复现2个unhandled rejection：abort原错误和关闭后late事件；并显示close回执泄漏原错误。最小接入后8项通过。旧4文件合成context缺SDK内部channel导致相邻回归失败（其中等待夹具超时，非生产故障）；只在这些raw顺序测试中隔离事件适配，真实SDK套件保持真实。10:27:54六文件211/211通过。
- 扩展到18项真实SDK事件测试，覆盖CDP/managed两类lease、abort等待与实际close起始顺序、多context allSettled、固定版本拒绝/半替换/入口漂移/容量1024/正常continue与stop后abort/重入。10:30:17固定隐私诊断反例RED，恢复blocked/policy_failed聚合分类后51/51（SDK18+raw33）通过。新增防御用例中已通过的部分属于回归/兼容验证，不冒称每项均首次RED。
- 最终审查发现两个Important：单个function不证明已知SDK入口，且context可能属于另一Browser。10:35:34 foreign listener、foreign Browser context、changed _onRoute三项有效RED；核对实际playwright/core1.59.1、真实instance/prototype原方法、Function.prototype.toString精确入口签名及context→Browser→Connection归属后GREEN。归属核验在首个listener变更/route注册之前，后续事件和终态持续核验。固定可信SDK兼容不是进程内恶意伪造防御。
- 真实SDK测试夹具已使用实际Browser+Context，通过SDK context事件建立归属；多context共享Browser/Connection。Browser.close调用与driver响应仍为合成边界，不能写成仅driver响应被替代。23项SDK测试包含两包版本拒绝和运行中归属漂移，未访问网络、真实browser或用户资料。
- 10:37:28 JST最终18文件452/452，8.41秒；完整后端tsc退出0，8文件Biome通过，executor7修改方法+2新方法外43成员逐字一致，删除不再使用的guardedContexts。独立最终复审无Critical/Important/代码层必修Minor，结论仅允许记录后本地提交本单元，不批准局部PR或生产发布。
