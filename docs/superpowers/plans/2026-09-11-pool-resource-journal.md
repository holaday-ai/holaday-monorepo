# 创建前资源日志与单次派发记录（9d-2l）

> **For agentic workers:** executing-plans＋TDD，主线程实现，仅复用原review_qwen_negation只读审查，重任务串行。

**Goal:** 真实持久prepare→dispatching前置记录、重复请求绑定、能力查询与重启恢复；不操作systemd或宣称实际已派发/退出。

**Architecture:** 沿9d containment/9d-2b。固定root日志文件上的非阻塞独占flock约束写者，严格解析全部追加记录。prepare记录含私有随机资源与能力标识，先完整写入并fsync，才能返回私有句柄；dispatching记录再持久后才返回，重复claim永拒绝。操作都保留同一真实登记对象，不接受任意路径/命令/PID。

**Tech Stack:** Python3.10标准库、真实临时文件/fsync/flock测试＋合成root身份/原pidfd；无依赖安装。

**Spec:** docs/superpowers/specs/2026-09-11-pool-process-containment-decision.md、2026-09-11-pool-launch-registration-decision.md、2026-09-10-safe-execution-drain-design.md。

## 边界与格式

- 基线534c7287，隔离codex/qwen-safe-drain；保护主8草稿、PR237冻结manifest和delivery分支。10GB预算、Node2GB，单主＋原reviewer；禁止安装/Docker/新浏览器/生产/秘密读取/支付奖励额度账号注销DivineAPI等禁止模块。旧08:30 JST窗口不延长，不部分发布。
- /var/lib/holaday-pool-broker/resource-journal.jsonl必须由未来受信维护流程预置root:root0600单链接常规文件，父目录root0700、无ACL/capability、祖先不可被应用修改。不mkdir、不create该日志、不初始化/截断/重置/删行。空/缺失/损坏不是已清理证据。头记录精确{"version":1,"action":"initialize"}加换行，仅表示格式，不证明历史排空；维护证明仍独立。
- ResourceJournal.open(registration)仅消费真实已完成LaunchRegistration；取得原candidate/boot并每次查原pin/撤销。O_RDWR|O_APPEND|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK打开固定文件，flock LOCK_EX|LOCK_NB；保持FD与目录直到close。第二对象/进程不得竞争追加，文件替换/内容漂移/权限变更一律毒化实例，不能按新路径重新取得锁。
- 最大262144字节、最多128资源（4角色×32槽），每条JSON严格重复键/字段/类型验证并以换行完整结束。顺序revision从1递增。prepare记录固定version/action/revision/resource32/capability64/candidate40/boot32/requestId32/component/slot；非零小写hex。dispatch记录固定version/action/revision/resource32，只能引用唯一prepared资源一次。其他动作包括运行/终态一律拒绝，本单元没有随意mark_success或mark_exited入口。
- 加载时回放全部记录，拒绝重复resource/capability/(boot,requestId)/(component,slot)、跳号、非法转换或未知动作。已有任何其他candidate/boot记录时允许本地聚合读取，但禁止prepare/claim/私有能力查询；不因重启或空内存清旧账。
- prepare(CreateRequest)验证真实protocol形状及boot，服务用os.urandom生成资源16字节和能力32字节，不接受调用方值。同一requestId且全部字段相同返回本对象同一PreparedResource；字段冲突拒绝，槽位冲突/容量满拒绝。句柄无公开构造、不序列化、repr不泄露；不能复制/跨对象claim。
- claim_dispatch(handle)只在同一实例尚prepared时追加dispatch记录；完整短写、fsync文件和父目录、最终权限/内容/登记检查后返回None。它是必要的持久前置条件，不是平台派发授权令牌或实际启动确认。未来受信平台调用者必须在此成功后、重新核验接纳与原发送者后才执行；本单元无成功callback、无平台调用。
- query(ResourceRequest)只允许action=query，能力用常量时间匹配且同candidate/boot；返回固定state和groupExitProven=false，不返回能力/资源/业务标识。snapshot仅总数/prepared/dispatching/foreignBoot和groupExitProven=false。dispatching表示可能派发而结果未证明，永不自动重试。即使无记录，也不报告全局idle/旧账清零。
- 任一IO、解析、时钟外身份漂移、同步重入或复核失败后实例永久失败，已写字节原样保留，句柄失效。close仅释放自身FD/锁，不删日志/记录、不改变资源状态。整行尚未fsync或部分写入在崩溃恢复后或被保留为dispatching未知、或严格拒绝损坏；不修补截断后重试。
- 操作开始同步busy；同步重入close立即retired，后续IO/成功返回被禁止，但日志FD及flock延迟至原操作finally释放。重入close不自等待，不允许外层继续使用已关闭/复用FD。write/fsync回调close期间第二写者仍必须被真实flock拒绝；所有本操作在途文件调用收口后才释放锁。

## Task 1：完整日志单元

**Files:** 新增scripts/pool-broker/resource_journal.py、test_resource_journal.py；同步installation/bootstrap精确成员及其测试。运行通道仍blocked，未接线prepare生产调用，避免后端未就绪时占槽或返回假成功。

**Interfaces:** ResourceJournal.open(registration)、prepare(CreateRequest)→PreparedResource、claim_dispatch(handle)→None、query(ResourceRequest)→固定状态dict、snapshot()→聚合dict、close()→None。没有清理资源或平台完成接口。

- [x] 先写缺模块RED，用真实临时文件/flock/fsync，只合成固定路径定位、root身份和原登记内核边界；不mock journal状态机、protocol或文件内容成功。

```python
journal = ResourceJournal.open(registration)
held = journal.prepare(decode_request(create_bytes))
assert journal.prepare(decode_request(create_bytes)) is held
journal.claim_dispatch(held)
assert journal.snapshot() == {'total': 1, 'prepared': 0, 'dispatching': 1, 'foreignBoot': False, 'groupExitProven': False}
with assert_raises(ValueError): journal.claim_dispatch(held)
```

- [x] 按格式实现严格回放＋固定路径/metadata/锁/原对象验证；缺失/坏头/截断/重复键/重复记录/非法状态/外boot/第二写者先RED，128槽容量另补边界回归。
- [x] 实现prepare持久写与重复请求重用，测试短写、fsync错误、权限/内容/路径变化、能力冲突、槽位冲突及无效句柄；失败不返回句柄、不删除已写字节。
- [x] 实现dispatch前置记录和仅私有能力查询，测试重启后已dispatch拒绝、半行、外boot、跨对象句柄、最终close错误/同步重入。candidate和boot共同绑定；本地结果丢失后的dispatching不能再次claim。日志不接受终态，GROUP_EXIT_UNPROVEN不放宽。
- [x] 新模块纳入installation固定成员及bootstrap hash/preload，缺成员/可写/hash集合先RED再GREEN；独立审查修复并通过全套验证。提交后QA和原自动化保存精确断点，不发布部分组件。

## 2026-09-11 本单元验证记录

- 18:59 JST，全套262/262通过（3.329秒），其中20项journal测试；27 Python AST、2 JSON和diff检查通过。真实临时文件追加、短写、fsync、flock；Linux身份、ACL/capability及pidfd边界为合成数据，不是Linux实机验证。
- 原reviewer设计审查要求重入close延迟释放FD/flock，已实现并验证write/fsync内close时第二写者仍被锁拒绝。代码审查三项Important全部RED→GREEN：逐层固定目录dev/ino绑定，按尺寸循环短读及提前EOF拒绝，close失败固定报告且全部FD一次清理。复审无剩余Critical/Important/必修Minor；审查者没有代跑测试。
- 运行通道保持blocked，未接线日志或平台调用；dispatch记录仅表示单次派发前置已持久，不表示真实启动，空日志也不证明旧资源排空。native manifest保持unverified。维护预置、真实平台/回执/结束证据、Linux和整体发布门禁仍未完成。

## 后继任务（不是本单元完成范围）

受信systemd派发与实例回执、运行/停止/终态组合证据消费者、资源私有能力的受控返回、运行通道和Node客户端接线、维护签发/精确交接、服务第一入口、实际Linux及首次升级/回滚/发布门禁。没有平台事实生产者，不提供任意布尔值或调用方字典把状态改成完成的接口。
