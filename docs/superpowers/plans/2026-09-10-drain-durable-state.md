# 持久排空状态实施计划（第二阶段 A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 单主实现，最多复用一名轻量只读 reviewer；审查期间不跑重任务。

**Goal:** 完成独占写者的持久排空状态单元；缺失、异常和旧 boot 未收口一律拒绝接纳，不提供自动清场或 bootstrap 放行。

**Architecture:** 私有目录中的独占 `writer.lock` 加原子 `state.json`。写者持有锁描述符并持续校验 inode、权限和旧状态；真实 ExecutionDrain 绑定安全失败，任何存储错误使它 block。锁只在真实内核 idle 且已持久化 closed/clean 后释放。异常退出保留锁，不以PID消失自动抢锁。

**Tech Stack:** 现有 Node fs/path/crypto、TypeScript、Vitest；无依赖安装。

**Spec:** `docs/superpowers/specs/2026-09-10-safe-execution-drain-design.md`。

## Global Constraints

- 任务内存预算约 10GB；Node 堆 2GB；Vitest 单 worker、每批最多 20 文件；重任务串行。
- 不安装、不新启 Docker/浏览器。保护主工作区草稿与 PR237 冻结包。
- 支付、奖励、提现、Partner Ledger、额度规则、账号注销、DivineAPI 和旧供应商配置不变。不输出密钥、身份或业务文本。
- 本单元不接公网、Unix socket 或真实任务，不合并部署局部组件。旧生产窗口不复用。

## 单元与接口

新增 `apps/orchestrator/src/execution/drain-state-store.ts` 和 `drain-state-store.test.ts`；固定记录编码/解码独立放在 `drain-state-record.ts`，由真实存储测试验证，不重复源码文本测试。

`DrainStateIdentity = { epoch, candidate, bootId }`：epoch为16–48个小写十六进制字符，candidate为40位，bootId为32位。`DrainStateRecord`附加schemaVersion=1、sequence正安全整数、mode=closed/open/blocked、dirty布尔值；固定字段、固定规范JSON，禁止自由文本。

`new DrainStateStore(directory, identity, drain)`：目录必须是调用进程所有、0700、真实规范绝对路径。以wx/0600/NOFOLLOW取得单写者锁；只接受前boot已经closed且clean的合法状态，且boot不同。缺失、损坏、旧open/dirty/blocked或遗留锁都block并拒绝；没有初始化/抢锁/reset API。首次bootstrap种子必须由后续已经验证旧工作收口的维护流程提供，本单元不生成它。

`prepareOpen()`：仅真实drain.idle时先持久化open/clean意图；调用者在授权验证后才可调用，随后同步drain.open。`markDirty()`：在新根操作派发前持久化dirty，不替代内核准入。`checkpoint()`：读取真实内核聚合，持久化mode及active/unknown/blocked导出的dirty。`read()`：仅返回冻结后的固定记录，每次重新核对目录、锁和磁盘内容，漂移永久block。`release()`：只有真实idle且最新磁盘closed/clean时删除自己持有的同inode锁并fsync目录；重复调用返回false。`abandon()`：用于失败停机，block并关FD，但保留锁及状态。

每次新状态以随机自有临时文件wx创建，完整写入、fsync文件、rename至state.json、fsync目录后才返回。任何失败不继续开放，后续调用统一拒绝。最多2048字节记录。文件必须0600、同uid、普通文件且nlink=1；不跟随软链接。写前比较精确旧字节，拒绝外部修改。目录身份在操作前后复核；拥有该私有目录的同uid代码仍属于信任边界，不声称能抵御root或同uid恶意并发篡改。

成功release在删除锁之前永久block旧内存接纳实例，防止锁已移交后旧实例重新open。磁盘保留已证明的closed/clean回执，新boot使用新的ExecutionDrain实例；这不是强制终止运行中任务。测试用SIGKILL只终止本次创建的合成Node子进程，验证真实异常退出留下锁；不触生产进程。

## TDD 步骤

- [x] 创建真实0700临时目录及代表已正常关闭前boot的0600合成种子；先验证新boot可以持久关闸，旧open和dirty不能变成新boot空闲。

```ts
const drain = new ExecutionDrain();
const store = new DrainStateStore(dir, nextIdentity, drain);
store.prepareOpen(); drain.open();
store.markDirty(); const owner = drain.admit('request');
drain.close(); store.checkpoint();
expect(store.read().dirty).toBe(true);
drain.finish(owner); store.checkpoint();
expect(store.read().dirty).toBe(false);
expect(store.release()).toBe(true);
```

- [x] 运行失败测试：cwd apps/orchestrator，`NODE_OPTIONS=--max-old-space-size=2048 pnpm exec vitest run src/execution/drain-state-store.test.ts --maxWorkers=1 --minWorkers=1`。无模块第一轮显式断言缺失；随后都断言真实行为与磁盘副作用。
- [x] 实现上述固定接口、同步fs原子写和独占锁，无测试专用方法/全局实例。保持失败锁，不在catch中删除未知文件。
- [x] 增补RED→GREEN：缺状态、非法/额外字段/大小、权限、软链接、硬链接、同boot、并发第二写者、替换锁/状态/目录、真实写失败、unknown与pinned操作、释放时未checkpoint、abandon后的新boot拒绝。
- [x] 运行新测试及相关45项、4个内核文件加新文件Biome、后端全量tsc和diff检查。只清理各测试自己mkdtemp创建的合成目录，不动其他路径。
- [x] 复用独立只读审查者，关闭必修项并重跑后，本地提交此单元。记录仍未完成的控制协议、Unix socket、真实入口接线和bootstrap证明，不以文件测试当生产通过。

## 下一阶段边界

Unix socket处理程序消费此单元，但还需固定epoch/boot/候选/版本/有效期、单次开放授权和本机权限验证。其任何“status/close/open”不能直接伪造bootstrap证据、直接清除未知票据或删除遗留锁。该协议和真实生命周期持久化调用点将单独实现和审查，当前模块默认不可独立上线。

## 本地验证记录

- 2026-09-10 11:46 JST：新持久化40项加既有内核45项，85/85通过、0失败、0跳过；7文件Biome及后端全量tsc通过。所有测试单worker/Node堆2GiB；唯一合成子进程堆128MiB，仅用于真实异常退出反例。未启动Docker或浏览器。
- TDD记录：模块缺失显式失败；补齐行为测试后32项中31项失败，再全部通过；旧gate释放后可重新开放的第37项先失败，再由释放前block修复。审查建议另加3项文件写入/文件fsync/release目录fsync故障断言，最终共40项。写入和fsync故障仅替换相应OS边界，仍使用真实文件和真实ExecutionDrain。
- release删除锁后目录fsync失败时不返回成功，旧gate永久blocked；锁在当前文件系统中可能已经不存在，不承诺任何失败都仍保留锁。新boot是否可以开放仍由后续维护及启动授权协议决定。失败时不重建或删除未知替换锁。
- 独立只读审查首次及补充测试复核均未发现Critical/Important/必修Minor；精确本地提交SHA记录于QA进度账本。当前仅完成持久化单元，不代表Unix socket、真实接线、首次维护或生产通过。
