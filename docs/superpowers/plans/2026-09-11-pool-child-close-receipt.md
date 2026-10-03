# 自有pool子进程关闭回执实施计划（3D-3b-3c-9c）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。主实现加原review_qwen_negation只读审查，二者重任务不并行。

**Goal:** pool严格路径不得以信号成功、PID消失或leader exit冒充完整关闭，不丢启动失败时已取得的子进程。

**Architecture:** node spawn前同步预留资源owner，绑定本次ChildProcess的spawn/error/exit/close和单次终止能力；close仅收口leader/stdio，已启动进程的进程树仍标GROUP_EXIT_UNPROVEN。pool在首个spawn前建立强引用启动记录，成功后同一记录关联实例，失败后保留slot/profile与回执，shutdown可枚举。无scope旧路径不升级为排空证明。

**Tech Stack:** Node ChildProcess/EventEmitter、ExecutionDrain、TypeScript/Vitest，无新增依赖。

**Spec:** docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md与2026-09-10-process-drain-coverage.md。

## Global Constraints

- 现有隔离worktree、codex/qwen-safe-drain，基线b236122a；主8草稿和冻结PR237不变。
- 总任务内存约10GB、Node堆2048MiB、Vitest显式单线程无文件并行，每批≤20文件；free<40%或磁盘<10GiB不启重任务。
- 已过2026-09-11 08:30 JST生产窗口，只本地合成验证，无安装/Docker/真实浏览器/网络/DB/OS进程试验，不修改禁止领域，不输出秘密/身份/业务文本。
- 不关闭外部浏览器/共享driver，不从公开PID/taskId重建终止权限；不清unknown，不把单元测试当平台/进程树证明。整机制及新门禁前不push/PR/部署。

## 源码与设计审查

spawn.wrap在无PID时先throw，未监听异步error/close；kill将ESRCH当成功。pool启动catch仅TERM后释放slot；正常tearDown从公开PID负号发送组TERM、三秒后KILL，未等close；releaseInstance吞teardown错误后free/rm。BrowserInstance在所有启动完成后才构造，不能只用实例WeakMap保存启动阶段资源。

唯一reviewer同意保守单元：已启动child的close允许释放leader私有pin，但必须先留下组退出未证明ticket；无PID不能马上丢弃，要等明确未spawn的error及close；终止升级不在exit/close后派发；所有已取得句柄都清理，不因一个失败跳过其他。启动记录须强引用可枚举，adoption仍绑定同实例且私有stop/dead状态不可被public status绕过。

## 文件与接口

- 新增browser-pool/owned-pool-process.ts：`spawnOwnedPoolProcess(command: string, args: string[], options: SpawnOptions): OwnedPoolProcess`仅供捕获到有效lifetime的内部spawner调用。接口只暴露固定`child`、`pid`、`ready: Promise<void>`、`terminate(): Promise<void>`、`isRunning(): boolean`，不返回owner/reconcile/任意action能力。真实node spawn在startOwnedOperation立即派发体中进行；无scope拒绝此严格接口。
- 修改spawn.ts：各spawner经统一选择器按当前lifetime选择原wrap或新严格handle。SpawnedProcess增加可选`lifecycle`；strict kill旧接口拒绝，不调用process.kill。strict流只排空不输出原文本；所有生命周期监听先于读取PID/流和诊断。无PID异步spawn失败仍返回handle给pool等待，ready拒绝，terminate等待close；同步native spawn抛出且未返回child则固定失败。
- 修改browser-pool.ts：首spawn前Set登记私有record（原slot/profile/taskKey、所有process句柄、strict、stop回执、instance可选），实例WeakMap指同record。严格获取await ready并检查所有child存活及关闸；异步等待后再spawn前重复检查。启动失败先disconnect再清全部已取得child，记录错误且不释放不确定slot/profile。成功实例release先停后台、等disconnect、清全部process，即使前面失败也不能跳过process清理。strict teardown失败向上拒绝，不吞错free/rm。shutdown等待allocation/release和未绑定实例的record；同key未收口record禁止重开，adoption拒绝stopping/dead record。
- 新增owned-pool-process.test.ts与browser-pool-process.test.ts。Node spawn/kill与外部CDP/proxy合成；实际ChildProcess对象/EventEmitter、pool、slot、owned/drain运行。旧background-work.test.ts明确提供合成进程lifecycle，仅证明原hook顺序，不将其当OS/新生命周期证明。

## 一个完整可审查单元

- [x] RED：先从公开pool行为测试release发TERM后即使计时器走完仍不能free/rm；native child exit先于close仍pending；已spawn收到close后只转unknown不idle。无PIDerror必须等close才结束，且不能当组退出成功。采用已有pool完整路径行为RED驱动新helper，不以缺少模块的加载错误充当证据。

```ts
const closing = observe(pool.release('synthetic-task'));
await flush();
child.emit('exit', 0, null);
await vi.advanceTimersByTimeAsync(3000);
expect(closing.state.done).toBe(false);
expect(existsSync(profile)).toBe(true);
child.emit('close', 0, null);
await closing.finished;
expect(closing.state.error).toBeDefined();
expect(drain.snapshot().idle).toBe(false);
```

- [x] GREEN：child获取前资源reserve，立即挂监听；ready只在合法spawn身份后resolve，error/先close拒绝。terminate同步置stop且共享result，合法未退出child用捕获原生kill发TERM，再三秒后单次KILL；不再发组信号。两次signal的返回/异常不settle，exit取消升级但仍等close，close永久terminal且错误监听不再触owner。已取得PID或见spawn必须先markUnknown再结束result；真正无PID/no-spawn/error/close归已知启动失败。未close永远不靠超时清计数。

```ts
const operation = startOwnedOperation(parent.drain, 'execution', async () => {
  child = spawn(command, args, options);
  installBoundListeners(child);
  await childClosed;
  if (hadProcess) {
    markUnknown();
    throw new Error('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
  }
}, {parent: parent.owner, dispatch: 'immediate', errorOutcome: 'known'});
```

- [x] 补反例：信号false/抛错仍等close；重复stop相同Promise；延迟spawn后stop先请求，spawn事件后只TERM一次；exit后不KILL；pid或kill属性漂移不重定向；sealed/blocked下cleanup仍可进行；blocked派发前零spawn。pool启动第二进程失败仍等第一close，failed record在allocation key删除后仍被shutdown找到；某child已失败不能跳过另一pending；adoption后退出仍指原record；修改公开PID/status不获得权限；失败同key重开拒绝；slot/profile不可复用。旧background容量回归保留；不将其合成lifecycle计数当新进程资源证明。
- [x] 串行专项及相邻回归（每批≤20文件）、完整后端tsc、精确文件Biome/diff；原大型pool仅格式/检查触及方法，不重排无关成员；唯一reviewer最终审查无Critical/Important/必修Minor，允许完整本地单元精确提交。提交SHA与自动化断点见QA最新节点。后续实际Linux树/后代证明仍独立阻断，不提供假成功provider。

## 验证记录

- 初始HEAD b236122a，仅qa-artifacts未跟踪；free71%、磁盘141GiB。只读核对源码及唯一reviewer设计意见，未运行任何真实子进程/浏览器实验。
- 12:53:07 三项pool真实行为有效RED：exit无close提前free、启动失败立即丢record、公开PID变动误发负PID信号。12:55:23最小3GREEN；12:57:00新增stream getter失败提前释放有效RED，改为保留close等待后通过。流resume断言另需等待Node nextTick，这是测试时序修正而非产品缺陷。
- 12:58:33 adoption后profile复用和同key重复获取等待两项有效RED，修复private record门禁顺序；profile反例采用真实两槽容量，不改私有allocator。13:01:03同步disconnect（startup/release）和logger打断清理三项有效RED，修复后13:01:53专项23/23。
- 13:05:43串行19文件511/511，9.12秒；13:05:59串行新专项加spawn参数3文件27/27，0.56秒。总22文件538项分两批，不并行。完整后端tsc退出0；4个新/相关文件Biome检查整理完成，pool仅格式化9个修改/新增方法、23个原成员逐字不变，spawn只格式化新改声明，不触参数生成/沙箱/环境白名单。最终静态检查与唯一reviewer审查进行中。
- 独立审查两项Important：原生newListener抛错可跳过close持有，pipe error缺监听；track返回与下一派发之间关停仍可启动下一child/CDP。13:10:11新增6项有效RED，逐项保护监听安装、close观察优先、流error固定unknown；close观察本身安装失败保持active+unknown，不以其他事件伪造close。每个真实spawner/CDP调用点前重新assertActive。13:12:11暂移除两个调用点校验，两个微任务窗口反例均有效RED；恢复后GREEN。
- 13:13:18最终19文件511/511（9.04秒）；13:13:40最终3文件35/35（0.561秒），合计22文件546项分两批。最终完整后端tsc退出0、4文件Biome0、pool/spawn修改声明stdin lint0、diff0。native exitCode/signalCode只用于禁止迟到signal，不用于结束回执。free69%、磁盘141GiB。等待唯一reviewer最后复审。
- 最后复审发现error监听注册本身失败仍可能留下未处理错误；13:20:29 child/stdout/stderr三项有效RED。对本次新取得资源的emit绑定固定receiver，只兜底error抛出，不改共享原型/全局处理器、不移除其他监听，非error派发保持原行为；关闭后仅吸收迟到错误，不触已结束owner。pipe监听与resume分别保护，监听注册失败仍消费输出。13:21:03修复后38/38；13:22:08最终旧19文件511/511（8.89秒），13:22:36新3文件38/38（0.571秒），合计549。后端tsc退出0。
- 13:24 JST唯一review_qwen_negation最终只读复审：最后Important关闭，无剩余Critical/Important/必修Minor，可提交完整本地9c；未运行额外测试，不等于进程树/整机制/生产门禁通过。4文件Biome、pool/spawn修改声明lint、diff均0；free69%、磁盘142GiB。
