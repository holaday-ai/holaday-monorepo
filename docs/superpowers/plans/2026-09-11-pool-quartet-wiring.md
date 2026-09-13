# 浏览器池完整接线 Implementation Plan

## 第2整项本地验收：2026-09-13

本地接线、原唯一reviewer必修复审及最终回归已完成，按本计划整项本地提交，保留worktree。验收映射及完整证据见`2026-09-13-pool-quartet-local-verification.md`：Python702；相关TS67文件1278通过/1条件入口skip；独立WS6；最终typecheck/build、AST/JSON、格式与diff核验完成。未推送、PR、合并、部署或访问生产。下方时刻记录及叙述是历史，不再用其“尚未接/下一步”否定现有实现。

勾选仅表示本地实现及显式合成外部边界下的验证；不能表示真实Linux/NSS/systemd五unit/浏览器隔离已通过。第3原始IO完整排空及组退出、第4Linux、第5真实维护/升级回滚、第6千问E2E和第7发布仍未完成。默认closed、无authorizeOpen、未知组占位与源树unverified不变；下一大项为安全停止、排空和对账。

> **For agentic workers:** 使用 executing-plans、TDD 与唯一原 review_qwen_negation 独立审查。主智能体实现，所有测试/构建与审查串行；以下均为第2大项的内部步骤，不单独交付或部署。

**Goal:** 将本机受控浏览器整组创建、隔离、数据通道、应用使用和失败保留接成真实可测试链，缺第3/4/5项时仍拒绝生产开放。

**Architecture:** 已批准B2：固定每槽位不同非登录UID/GID，systemd管理每组anchor及四角色，原manager/unit/InvocationID贯穿持久事务；不自写PID1或同UID PIDnamespace加入器。Node保留同PID登记和原运行SCM_RIGHTS拒绝，通过Unix数据端点通信，egress始终经过原策略且逐组跟踪物理IO。

**Tech Stack:** Python3.10、受控原生Linux初始化边界、现有Node22/TypeScript/Vitest，不新增包。

**21:52范围核对（原reviewer独立确认）：** 第2整项本地接线交付允许默认closed、没有authorizeOpen且groupExit仍unknown；真实全进程排空/组退出、第4Linux、第5维护开放不得倒置为第2本地提交前提。不是删验收：第2仍须正式boot/main入口、原controller所有实际工厂/手工Context、strict Pool/SDK/VNC双组组合、本项已创建对象失败收口及整项回归审查。未迁移后台在controlled不得偷偷派发，不能沿用吞错后exit0。本轮正在完成application-entry/main/boot草稿，旧19:42“index未改”已过时；用户要求不断到整项完成，当前继续执行，具体证据与下一动作见PROGRESS21:52。

**日间续接（2026-09-13 19:42 JST）：** 预热producer已捕获controller、关闸拒新、single in-flight及stop原Promise屏障；复审发现的同步接纳前stop尾部同时在prewarm及WS真实RED→GREEN修复，原reviewer全部必修关闭。最终148项23777/3e950f及显式WS integration6项9233/a909a4通过，tsc81688 exit0，内存空闲60%。index未修改，完整预热底层IO/吞错、cleanup、manual Context及default-closed动态boot/真实维护来源仍待接；第2整项及3～7不发布。直接下一步完成后台原IO，再完整启动接线，证据及边界见PROGRESS19:42。

**日间续接（2026-09-13 15:25 JST）：** WS新入口原Promise、认证/hello/revalidation、扩展原caller child/原socket send callback及匹配结果已接；strict旧step结果不建执行权，strict恢复不重派旧executing。原reviewer3项Important真实RED→GREEN且复审关闭，无新增必修；最终8文件133项（88936/38bff9）及显式integration配置6项（14989/352915）通过，tsc71264 exit0。所有重任务结束，内存空闲61%，未提交/PR/部署/生产访问，主8草稿不变。完整WS raw IO/关闭空闲socket顺序、HTTP纯拒绝分类及index/default-closed动态启动/真实maintenance来源仍是门禁；不能将组件通过替代第2整项。直接下一步继续index、scheduler/queue/manual Context/启动恢复及剩余原IO，具体证据和限制见PROGRESS 15:25。

**最新日间断点（2026-09-13 14:48 JST）：** HTTP原body/auth/response与返回Promise/callback父链、真实tRPC next与Context请求归属组件已审查关闭；首轮两项Important及旧root Context绕过sealed/nested旁路均真实RED→GREEN，原席位最终无必修。最终9文件203项17860/075be8、后端tsc8860、4文件Biome/diff-check通过。当前tRPC错误保守unknown，含纯输入/权限拒绝；精准分类仍是发布门禁，不冒充可用性或原始IO全覆盖。下一步直接WS原pending/socket/认证、新工作与旧回执，然后index/default-closed实际接线；不重做已闭合HTTP/boot/Pool/webhook。第2整项及3～7未完成、不单独发布，原隔离树未提交、主区草稿未动、自动化PAUSED、无生产访问。详见PROGRESS14:48。

**Spec:** docs/superpowers/specs/2026-09-11-pool-quartet-wiring-design.md；9d containment、9d-2b身份与总体safe-execution-drain规格。

**日间续接（2026-09-13 12:13 JST）：** root固定native公共入口、dormant Pool并发及ACK/v2固定通道非阻塞同步均已有组件实现和独立复审；最新20文件373/373通过（24555，168.27秒），tsc76273 exit0、C/NAPI3项17998通过，root关联Python181项为此前98347证据。原reviewer两项Important及后续唯一poll期限Minor均RED→GREEN复审关闭。当前直接继续首次真正uid998握手，再index/default-closed、真实epoch/maintenance verifier和完整双组消费者；不将dormant或通道可连接当开放许可。第2及3～7仍不发布，原分支未提交、自动化保持暂停，具体证据与下一步见PROGRESS。

**早晨收口（2026-09-13 08:28 JST）：** 夜间自动化按既定要求暂停，产品源码与 07:59 断点一致，本轮不重跑测试。第 2 整项及第 3～7 未完成、未发布；下一步仍为受控 index boot/root 正式入口和完整双组消费者，然后退出/Linux/升级回滚/Qwen E2E/发布。无新的产品决策阻塞，不将尚未实施的工作包装为等待用户确认。主区与冻结分支保持，无遗留本任务重进程，内存空闲59%、磁盘140GiB。详见 PROGRESS 08:28；恢复时直接接该未完成项，不重做已闭合组件，不复用过期生产窗口。

**最新优先断点（2026-09-13 07:59 JST）：** 正式 strict VNC 初次认证已接原 boot registry：异步 provider 前拥有原 raw/pending，5 秒总截止、64 KiB、64 连接边界；版本化账户/原任务绑定/实时白名单保持。原 reviewer 三项 Important 均真实 RED→GREEN 并复审关闭（adoption 交接、末端时钟撤销、合法活动只续原私有租期）。最新 browser-pool20文件357通过、关联8文件175通过1条件入口skip、完整tsc及3文件Biome/diff-check通过；所有重任务和审查结束。第2整项仍未完成，下一步受控 index boot、root 公开启动链、双组完整消费者；现有 root 私有 runtime 方法已存在，不重复实现，严格启动不得退回 singleton 或伪造 authorizeOpen。第3～7及真实Linux门禁未完成，零提交/生产访问，禁止部分发布。详见 PROGRESS 07:59；08:30 JST 后不启动新生产动作，早晨收口暂停自动化。

**最新优先断点（2026-09-13 06:44 JST）：** 已定位06:04偶发allocate的SDK包别名解析失败：pnpm符号链接作为createRequire基点时找不到playwright-core；两个SDK边界规范到同一原包realpath，原版本/对象/回执校验不放松。两条真实RED→GREEN，原唯一reviewer复审无必修；3全新进程原失败顺序各7/7、完整browser-pool20文件336/336、关联6文件156通过1条件入口skip、tsc及4文件Biome/diff-check通过。所有诊断/重任务已结束，不再把这一已确认根因记为未知，也不承诺所有偶发问题消失。下一步正式VNC初次认证、受控boot/root入口和双组完整消费者；第2整项及后续第3～7仍未完成，禁止局部发布，详见PROGRESS 06:44。

**最新优先断点（2026-09-13 06:04 JST）：** strict BrowserPool原实例私有组绑定、实际SDK消费者、原allocate veto及私有VNC桥已实现；4项Important均真实RED→GREEN且原唯一reviewer复审关闭。失败任务占位/strict原记录release/私有租期否决/adopt末端检查已补。最新完整browser-pool20文件336/336（runtime81）、相关4文件72通过1条件skip、后端tsc通过；6文件Biome通过，Pool仅4条HEAD原有lint，format/diff-check通过。**仍有批量正常allocate偶发启动失败的未解决证据（41156/36183），后续通过不能覆盖，优先安全阶段诊断后再接线。** 正式VNC初次认证、受控boot/root入口及完整双组消费者未完成，第2整项保持未完成、零提交/生产变更，不得局部发布。后续第3～7不变，08:30 JST后无新生产动作。详见PROGRESS 06:04；所有重任务及原reviewer已结束。

**最新优先断点（2026-09-13 04:56 JST）：** VNC用户会话组件已独立复审关闭，无剩余Critical/Important/必修Minor。两端pong统一有界队列及原5秒复核末端截止均真实RED→GREEN；用户会话18项+原上游9项通过。最新完整browser-pool20文件315/315、后端tsc、4文件Biome、git diff --check通过；所有重任务与原reviewer已结束。原vnc-proxy/BrowserPool/受控boot尚未接此组件，不能当正式用户路径完成。下一步原实例私有绑定、严格分支与完整用户认证接入，然后root入口/双组完整消费者；详见PROGRESS 04:56。第2整项及第3～7仍未完成，禁止局部发布；本夜新生产动作截止2026-09-13 08:30 JST。

**最新优先断点（2026-09-13 03:51 JST）：** VNC服务端私有上游与共享原_final回执修复已独立审查关闭；首条RFB消息丢失真实RED→GREEN，ready返回paused WebSocket，消费方挂齐处理器后resume。实际依赖ws8.18.0，不是旁存8.21.3。9项VNC定向全绿，完整browser-pool20文件297/297、后端tsc、2文件Biome、git diff --check均通过；独立审查无剩余必修，重任务全部结束。第2整项仍未完成、零提交或生产变更。下一步VNC原用户会话与原frontend IO所有权，继而strict Pool/boot/root入口/双组完整消费者；详见PROGRESS 03:51。原自动化已更新ACTIVE每小时续接，08:30 JST后不启动新生产动作，禁止局部发布。

**最新优先断点（2026-09-13 03:20 JST）：** CDP组件及SDK header接线均已独立复审关闭，无剩余必修。CDP完整browser-pool20文件288/288、tsc及5broker文件Biome通过；header截断门禁要求正式Node22>=22.23.2，真实Linux未验证。SDK覆盖私有快照/首连/重连/清除、getter错误、真实调试日志派发前拒绝、组合/旧资源清理错误，10文件299通过1子进程入口skip（实际两种子进程已执行）、tsc通过；3 helper/test Biome绿，executor仅format绿，HEAD原有lint噪音保留。全部重任务/原reviewer已结束。下一步VNC原用户认证与strict Pool接线，然后boot/root入口/双组完整消费者，见PROGRESS最新段，不重做已闭合组件。holaday自动化保持ACTIVE每小时续接，新生产动作最晚08:30 JST；第2整项仍未完成，禁止局部PR/部署。

**当前状态：** B2已批准。2026-09-13 00:05：root原材料/角色派发/长期数据桥/egress/协议探针/完整私有launch与原listener入口、本地Node控制客户端/原生连接器/可信loader/egress/HPD1数据消费者均已实现，相关独立组件审查关闭。最终Node浏览器池19文件251/251、tsc、4文件Biome通过；最终Python681/681通过823.798s，源指纹前后未变，所有重任务已结束。真实Linux仍未验证。第2整项仍缺BrokerPoolRuntime、受认证CDP loopback适配器与VNC用户认证接线、strict BrowserPool/boot与root公开入口、双组完整消费者联测。第3整组退出、第4Linux、第5升级回滚、第6Qwen E2E、第7发布仍未完成；全部quartet未提交、生产零变更。9月12日当日收口目标未达到，23:59后不启动新生产动作。runtime blocked/native政策unverified不变，内部组件不单独发布。下文早时段完成状态为历史断点，以本段及PROGRESS最新段为准。

## Global Constraints

### 2026-09-13 正式入口接线顺序（同一第2大项，不单独发布）

首次boot组件收口后，从现有调用点补齐依赖而不先开放index：先验证`createHttpApp`向实际tRPC context和webhook的手工Context传递同一个DrainController；缺省依赖保留原部署行为，不从请求体、任务ID或可见DTO构造控制器。该检查只证明原依赖传递，**不证明HTTP的body/auth/原始响应流及webhook前置数据库已被持有**。

Webhook父链实施：在首个API-key查询前同步接纳；若已有HTTP父lifetime则只在同一controller下建立子链，不重复新root或从请求字段取权限。两个认证查询和last_used_at原始UPDATE逐个持有，后者可保留原先不延迟ACK的行为，但其子owner必须持续到真实回执；业务catch不清提交未知。随后同单元覆盖幂等claim/replay/过期替换/finalize/release的全部数据库及确定唯一键冲突，未知后不靠重试/删除claim假造完成；无scope兼容、额度及禁止业务规则保持。唯一SQL安全增量是独立审查复现的过期claim接管ABA：DELETE须比较原观察的expiresAt并仍早于当前时间，不能删除竞争请求的新占位。使用真实Drizzle、controller和临时状态，只有mysql2与dispatch边界合成；闭门零查询、迟到失败/写入/父ACK、跨controller与原Context、claim各阶段纳入测试。此父链仍不替代上游Express认证/上传解析与原始响应流、定时cleanup或全进程启动。

原query派发边界：固定Drizzle 0.38.4真实prepare/execute，严禁将QueryPromise交给后续微任务再派发。child中完成prepare，拒绝getter、自定义query logger、动态placeholder参数或版本/方法漂移；只在本次原prepared的client字段置冻结单次query委托，不改全局pool/session。委托捕获原child/scope/client receiver/data方法，同步消耗一次调用标记，原scope/owner最后否决后立即调用原driver.query并原样返回原Promise。原execute和原raw回执均持有至结算；只有实际原raw Promise拒绝能提供确定duplicate结果，builder异常/同步driver抛错不充当driver回执。不宣称取消已进入mysql2内部的IO。真实driver计数、单次委托与并发接管反例是复审必需，不把返回500或计数归零当已阻止IO。

随后补webhook/HTTP原始父链、WS新工作与旧回执分类、index的scheduler/queue/manual Context及启动恢复；按process-drain-coverage逐一核实未接入口，不以个别context已接豁免其他入口或后台工作。最终受控启动必须在动态加载可能产生副作用的应用模块之前完成同一boot验证和持久closed检查；不得让ESM静态导入提前启动旧singleton/reaper/调度器。实际maintenance verifier、既有状态来源与首次旧版本全进程维护属于独立门禁，缺失继续拒绝open；不新增空成功verifier，不将正常bootstrap资源记作已准入业务，不更改禁止领域规则。

### 2026-09-13 首次降权身份握手细化（实施中）

沿同一固定 v2 listener，根入口固定 `start_quartet_runtime → confirm_application_boot → create循环`；boot不是新增业务action。独立闭合四帧hello/challenge/accepted/ACK绑定版本、candidate、boot、两端fresh nonce及原持久消费LaunchWindow保留的epoch。每段仍检查原pin与真实SCM，拒绝所有rights、额外帧和提前业务；原流关闭及末端复验后才接纳握手。此结果仅为本次初始化身份，不是ready/open/排空或资源能力。原登记窗口不续期；当前实现额外夹紧首次握手，成功后不作为业务租约，独立审查后收口。

Node使用独立私有BootIoOwner，仅能固定加载和boot IO，不临时开放ExecutionDrain、不伪造OperationLifetime。首异步前持有原对象、取消同步否决、5秒绝对预算覆盖加载/rendezvous/四帧/EOF/native close/回调；全部结清后给同一boot私有一次性初始化回执。原只读artifact FD是安装信任引用，不混同未完成transport。后续Runtime复用同一次真实加载；一回boot不得消耗原32次业务容量，两侧计数分别验证。旧状态dirty/未知、epoch不符、缺实际maintenance verifier仍拒绝开放。

根端原两项Important已RED→GREEN并复审关闭，关联Python13模块142项通过。Node真实owner/同一native加载及strict Pool消费已实现；原绝对5秒以一次bigint截止贯穿C/Linux实际IO，codec闭合、一次性boot消费及Pool最后时钟撤销均已复审关闭。最新证据见PROGRESS13:14；实际index及完整入口尚未接，不得发布或将局部证据替代第2整项。

### 2026-09-13 固定运行通道启动同步细化

原 reviewer 认可在既定 B2 内采用 native 非阻塞 rendezvous，不改 root 登记 ACK/receive 的生命周期：ACK 后的 listener 创建有 ENOENT、root:root0700、root:appgid0700、appgid0660但尚未listen 的正常阶段。原父链必须在第一次尝试前存在且合规；首个 O_PATH 叶永久持有，只有精确前进的权限发布状态可等待，换叶/换父/异常ACL或权限立即拒绝。明确 ECONNREFUSED 只关闭该未连通 socket 后在同一叶上再观察；EINPROGRESS 只推进原 socket，poll=0，不同步睡眠。成功连接/原root pin建立后不重连、不重开pin、不重发create。全部原生等待、peer/pin及末端检查共享原5秒，create总60秒不刷新。

Node仍只取得原生独占对象，新增ready轮询和connecting事件由原owner/timer持有；原scope的末端否决早于connect事件及业务发送，关闭等待保留原回执，清理失败继续unknown。此同步只证明固定通道可连接，不能代替首次真正uid998双向握手、旧boot/epoch对账或维护开放授权。当前实现与反例证据见PROGRESS最新段；完整增量复审、全量回归及真正启动接线之前不得发布。

- 2026-09-12用户白天最新授权优先：今天内完成昨天剩余整项，自主PR/合并/部署/验证；新生产变更启动界限为2026-09-12 23:59 Asia/Tokyo。下文08:30为历史夜间窗口，不阻止这次新授权，但精确候选/新epoch/独立备份/单合成账号/失败回滚及全部门禁不变。完整大项连续实施，不因内部步骤结束停下。

- 基线fad214e5，现有codex/qwen-safe-drain隔离树；旧PR237包和主8份草稿不变。
- 10GB预算；Node堆2048MB；Vitest单线程、单文件并发；不安装/Docker/额外浏览器或生产操作。
- 旧2026-09-11 08:30JST窗口不复用。本夜新授权适用至2026-09-12 08:30 JST；届时不启动新的生产变更，未收口事务优先安全处理，之后可继续本地准备。完整机制及门禁前不push/PR/合并/部署部分实现。
- 不触支付/奖励/提现/Partner Ledger/额度规则/账号注销/DivineAPI/旧供应商，不输出身份、能力、秘密或业务原文。
- 合成Linux边界不当平台通过；native manifest继续unverified。第3项提供退出组合证据前所有close均不宣称groupExitProven。
- 一个完整任务内完成下列实现、失败修复、相关全套回归和独立审查。不得以只有模板、stub backend或本地某个测试通过标第2大项完成。

## 内部B0：固定槽位身份政策与可信加载

**Files:** scripts/pool-broker/slot_identity.py、test_slot_identity.py、slot-identity-policy.json；bootstrap.py、installation.py及对应测试。

**Interfaces:** 可信loader仅从已校验candidate包给slot_identity设置_POLICY原始bytes；inspect_slot_identities(candidate)无账号/路径/容量参数，返回不可变SlotIdentitySnapshot(candidate, policy_digest, slots)。snapshot.for_slot(slot)只选择该白名单条目；所有字段repr隐藏，快照不授予运行权限。策略精确字段version/status/candidate/capacity/slots；每项slot/uid/gid，不接受命令/home/shell/名称；slot为连续0..capacity-1，capacity1..32且实际容量由受审候选固定，不依据请求扩大。

- [x] RED：普通导入、unverified、错candidate、重复键/字段、UID/GID冲突、超容量、NSS正反查/枚举不一致、跨槽位主/附加组、旧单账号冲突均拒绝；秘密属性读取即测试失败。
- [x] GREEN：只核验固定身份元数据，返回快照；真实部署创建/锁定账号不在此代码内。已修复原reviewer发现其他账号派生附加组遗漏，普通root/nobody兼容。
- [x] RED→GREEN：候选hash名单要求政策与模块，缺失/可写/hash不符拒绝；原始政策字节不二次读取，语义在inspect消费时拒绝，源树政策保持unverified。
```python
snapshot = slot_identity.inspect_slot_identities(candidate)
identity = snapshot.for_slot(request.slot)
# Launch still requires original registration, journal, manager and fresh guards.
```

## 内部A：独立整组协议与日志

**Files:** scripts/pool-broker/quartet_protocol.py、test_quartet_protocol.py；quartet_records.py、quartet_journal.py、test_quartet_journal.py；resource_journal.py仅增严格v2记录分支和跨版本冲突检查，旧记录原字节不改。

**Interfaces:** decode_quartet_request(payload:bytes)返回不可变QuartetCreateRequest(version=2,action=create,request_id,boot,slot)或QuartetResourceRequest(version=2,action=query/close,request_id,boot,capability)。无component、命令、路径、PID、环境字段。最大4096字节；slot整数0..31；标识非零小写hex32/能力hex64，private字段repr隐藏。解码不授权。

prepare_quartet(journal,request)只复用原ResourceJournal同一root预置日志/原FD/flock/登记，不另开可与旧日志竞争的第二占位文件；内部先真实inspect_slot_identities，不接受外部快照当授权。query_quartet(journal,request)只接受v2管理能力，独立egress能力不能查询。新记录version2/component=quartet，旧v1未决角色跨版本占位；双方不迁移/重写旧字节，v1派发/查询不得消费v2组。状态记录保留固定anchor及四角色的unit/manager/InvocationID，任一丢回复不重新派发；不记录持久FD数字冒充内核引用。最大32组与旧角色共享128逻辑角色预算，未知组永久占位直到第3项退出证据实现。

- [x] 写实际解码RED；成功请求可交日志消费者，v1/角色请求/任意路径/重复字段/类型冒充拒绝，错误和repr无原数据。
```python
r = decode_quartet_request(b'{"version":2,"action":"create","requestId":"11111111111111111111111111111111","boot":"22222222222222222222222222222222","slot":0}')
assert (r.version, r.action, r.slot) == (2, 'create', 0)
```
- [x] 实现新协议并验证GREEN；旧decode_request继续拒绝v2，不能从旧通道误放行。
- [x] 真实文件/flock测试整组prepare-before-dispatch、双能力不互用、旧资源冲突、32组容量、丢ACK不重派、group/endpoint换代及跨boot未知；之后实现日志与固定整组启动控制流，不伪造ready。

日志子集已完成：prepare/query、同一真实FD/flock、v1/v2冲突、容量、五角色dispatch/accepted/observe顺序；当前测试内部append回执只证明持久状态机，不是实际systemd派发。endpoint原对象和固定启动生产者仍未实现，本项保持未勾选。v2 observed仅五份InvocationID记录，不是ready；旧恢复扫描对此保持missing_binding未知，不把anchor单unit等同全组退出。

## 内部B：固定systemd组、预工作守卫和数据端点

**Files:** scripts/pool-broker/quartet_launch.py、quartet_template.py、quartet_worker_guard.py、quartet_endpoints.py及对应test_*.py；复用systemd固定RootDirectory/JoinsNamespaceOf，不引入自写root namespace初始化器或PID1。

**Interfaces:** launch_quartet(journal,manager,request)仅承接相同原登记/pin；派发前inspect_slot_identities(manager._candidate).for_slot(request.slot)。模板角色集合固定anchor/xvfb/brave/x11vnc/websockify，身份只来自原快照，启动中仅返回真实观察。worker_guard消费原事务LoadCredential里的namespace绑定元数据，检查后exec固定角色；不接受任意命令/账号/root环境。

### B1 预工作守卫与原worker握手细化

固定非rootguard在授权前不fork、不exec业务，先检查LoadCredential只读文件、resuid/resgid/附加组/能力/NoNewPrivs、实际net/ipc/mount namespace与RootDirectory/tmp/shm对象、无宿主网卡。anchor与host net/ipc不同，后四角色net/ipc及tmp/shm等于原anchor；各unit mount namespace可以不同。原root进程号仅由本次root凭据提供，guard连接唯一/run/holaday-pool/control.sock后核验每包root内核凭据；只接受新challenge→回应→同challenge grant，不用固定预置值直接作放行。

root侧新WorkerPin与PinnedApplication分开：首包SCM PID仅候选，pidfd_open后核对同一已持久role/unit/InvocationID/MainPID/cgroup，再发本连接新nonce；返回同一原pin消息并复查anchor、manager、撤销与期限后方可授权。grant先持久消耗再单次发送，ACK丢失不重发。原应用pin启动前持有pidfd的契约不放宽。根端只传固定数据listener FD给非root桥，不泄漏目录、namespace、pidfd或管理socket；长期anchor hold不作为启动回执等待条件。

本子步骤新增scripts/pool-broker/quartet_worker_guard.py与test_quartet_worker_guard.py；schema严格闭合，未连接root生产者之前不提供公共“已就绪”或执行权限接口。测试先证明降级namespace、可写凭据、错误身份、跨组文件对象、旧nonce/截断/多余FD均拒绝，再接真实root私有listener和派发。

- [x] 本地消费者：_WorkerGuard.open(candidate,resource,role)仅从固定只读LoadCredential获取闭合数据，原FD保留及换代/权限/namespace复核；_await_grant()一次challenge/response/grant、每包root凭据、固定原deadline、不接受任何FD。没有main/exec/公开ready。systemd凭据目录及文件同时覆盖有效只读UID ACL或chown fallback；connect通过固定父目录原FD且复核当前绝对目录链与leaf。
- [x] 本地必要身份核验：_WorkerPin.from_received_peer(journal,manager,resource,role,kernel_credentials,scope_guard=...)先pidfd，再原unit/InvocationID/MainPID/cgroup；应用PinnedApplication不变。check_sender必须接原握手deadline veto；原生/外部回调后纯状态否决，已退出不重挂。对象本身不授权，也未生产anchor的namespace绑定。
- [x] 本地root生产者：固定组目录/只读凭据绑定原对象的实际创建与私有listener；核验candidate worker后发本连接新nonce，同原pin回应后复查anchor/manager/期限；在原共享journal持久消耗grant后只发送一次，丢ACK不重试。真实WorkerGuard消费者packet socket贯通；Linux内核与systemd边界仍合成，不是平台或五unit实际派发通过。

上述两个已勾选项为第2大项内部断点，不是可发布子功能；13守卫+8原worker测试采用真实临时文件/生命周期和合成Linux边界，374全套通过不代表Linux隔离成立。下一步root生产者必须与这两个真实消费者贯通，随后下面的实际五unit派发/固定数据端点和Node接线仍全部待完成。

### B1 root材料与一次性授权生产者实施接口

沿既定候选文件视图边界新增`quartet_root_view.py`、`rootfs-policy.json`、`test_quartet_root_view.py`：`_RootView.open(journal)`只从可信loader注入的政策和固定`/usr/local/lib/holaday-pool-broker/releases/<candidate>/rootfs`读取，普通导入及源树unverified政策拒绝。闭合政策绑定candidate和完整节点白名单；最多4096节点、政策1MiB、单文件512MiB、总文件2GiB，流式64KiB哈希，不并行。只允许root只读目录/普通文件；不支持链接、设备、setuid、ACL、额外子项或身份/应用配置。逐层O_NOFOLLOW，原根及祖先目录FD保留；文件只在检查时持有并即时关闭，避免按节点数长期占用FD。`_check()`重核原路径、完整集合、元数据/只读挂载与原登记；不是授权或运行期挂载证明。

`quartet_material.py`中的`_GroupMaterial.create(journal,manager,prepared)`仅消费同一日志内原`PreparedQuartet`，先持久material_claim，再独占创建固定groups/resource及control/credentials/tmp/shm/profile。已存在、部分失败、丢回执都保留未知，不unlink重做。目录持久后记录material_ready。`prepare_role(role)`对anchor从原host namespace及rootfs/tmp/shm原对象创建LoadCredential；其他角色必须来自已核验仍活着的原anchor。每个credential_claim必须早于独占创建，文件/目录fsync及credential_ready早于role_dispatch；无任意路径/UID/argv参数。实际模板明确将这些原对象bind到/tmp、/dev/shm、/profile，不让自动PrivateTmp覆盖它们，运行期再核实际对象。

`quartet_worker_channel.py`由原`_GroupMaterial`持有的root私有listener接受一次消息，调用真实_WorkerPin、核验实际worker root/tmp/shm和namespace，再发fresh nonce；同原pin回应后复查材料/anchor/manager/期限。`role_grant`先在同一原journal/fsync持久消耗，之后只send一次；短写/丢ACK不再次grant。早先标记和metadata仅对账，不恢复可签发的材料句柄。测试必须走真实材料创建/文件/socket和现有WorkerPin/WorkerGuard，不注入成功对象。

```python
# 同一原登记/日志的实际内部链；每个失败都保留原占位。
material = _GroupMaterial.create(journal, manager, prepared)
material.prepare_role('anchor')
# 固定unit派发及原InvocationID观察完成后才执行原listener事务。
material.accept_role('anchor')
```

这只是内部接口细化，不创建新交付项或生产权限。先RED覆盖unverified/额外文件/文件或目录换代/只读失效，再实现root视图；接材料独占与原日志，再做producer→consumer挑战和持久grant，最后模板/Node完整接线。原reviewer只读确认仍在B2范围，要求创建、派发和grant均复核原对象及实际挂载，不新增PID1/root业务代理。

00:59内部进度：rootview与材料创建、anchor凭据实际生产已实现并审查；完整root授权生产者仍未勾选。rootview单次30秒准备预算，材料事务30秒；后续握手固定原5秒并夹紧所有内层预算。ResourceJournal._run的scope_guard仅限时/否决，failure_cleanup在busy及flock释放前关闭原材料，覆盖最终guard失败；RootView._check_locked必须原journal busy，不另开writer。接WorkerPin时也需同原已持锁路径，禁止再次嵌套journal._run或用外部成功值绕过实际核验。材料/凭据日志是持久未知与顺序证据，不是运行授权；后四角色必须原anchor生产者就绪后才实现，不回放历史观察当anchor。

01:17内部进度：WorkerPin已补上述locked入口；WorkerView._open_locked(material,pin)从原proc实际采样，先保留namespace，读环境/对象后重核同一namespace。实际IO同时检查原pin/manager5秒及material预算；对象失败全部close一次，原应用pin契约不变。8 view+12 pin以及完整406回归通过，唯一原reviewer复审无必修。下一步channel调用方必须在每个acquire返回后立即接管原pin/view/accepted socket，统一放入material的failure_cleanup集合，覆盖outer最终guard失败；不能仅在callee内部异常时清理，也不得向外提供ready成功对象。当前没有role_grant记录/生产者、consumer贯通或业务exec，不勾选完整B1。

- [x] 本地RED→GREEN：精确manager唯一目标、prepare/fsync先于一次StartTransientUnit；固定unit/Candidate/组身份；无任意argv、root环境注入或宿主端点。11项实际dispatch控制链测试与严格读回通过，外部systemd边界合成，不等于平台或整组运行通过。
- [x] anchor与四角色处于固定组slice，独立每角色unit/InvocationID；Requires/After/BindsTo/JoinsNamespaceOf只引用原anchor，Restart=no。所有工作非root清能力/附加组；RootDirectory固定只读候选文件视图，profile按本次组隔离，不挂旧组或其他槽位。
- [x] 真实socket/pipe与合成内核边界验证namespace实际差异/本组共享、/dev/shm隔离和降权exec守卫；失败不放行工作，原句柄不因close重入提前释放，不扫描PID重挂，不将相同UID复用视为旧数据授权。
- [x] 固定CDP/VNC listeners原FD交非root桥，仅本组固定loopback目标；egress叶socket按原对象绑定，challenge每段内核凭据匹配原应用，换代/短读/截断/超时/FD走私均失败。
- [x] 固定四角色启动顺序基于实际端点协议，不使用250ms/sleep或伪ready；anchor/job ACK/InvocationID不作为组退出/ready。

01:54内部进度：root生产者与消费者、五角色原anchor绑定已完成本地验证。新增channel11项、anchor绑定9项；最终426全套通过。原anchor/channel/pin/view必须在child每次IO前后保持原对象且未撤销，WorkerView将该scope否决传入原WorkerPin，覆盖内层原生IO；完整anchor原生复验仍保留。上述01:17及更早节点保留为历史，不再据其拒绝后四角色凭据或重做握手。下一步五unit实际派发、固定业务exec/协议就绪/数据FD/Node仍均未勾选。

<!-- B2内部启动源约束：适用于前述五unit，非新权限或交付项。 -->

### 固定systemd派发源的持久不可替换契约（2026-09-12）

v249的StartTransientUnit回执只表示job接纳，挂载和LoadCredential可能随后读取源；namespace.c还会chase bind源。因此不得把/proc/<brokerPID>/fd/<n>写进异步unit模板，内存强持有也无法覆盖broker退出后的PID/FD复用。

在既定宿主root可信边界内，采用已实际独占创建的规范实体路径：/var/lib/holaday-pool-broker/groups/<resource>下control/tmp/shm/profile和credentials/<role>.binding，以及固定candidate的只读rootfs。父链root保护、无symlink，槽位只能修改工作目录内容，不能替换源目录或credential。material_claim/credential_claim/role_dispatch先持久化；从此所有未决引用包括跨boot unknown都禁止删除、改名、替换、覆盖挂载或candidate清理，close只关本地FD。当前没有删除/清理生产路径；以后任何GC/安装回滚工具也必须遵守，真实组退出证明前不允许解除。若未来不能约束其他root写入者，则必须重新设计内核持久pin，不能沿用此假设。

继续保留派发前后原FD—规范路径—namespace核验和grant前worker实际对象匹配；不声称能抵御宿主root主动并发替换。真实临时文件测试覆盖丢回执后原FD关闭且被/dev/null复用，固定实体源仍为原inode；路径被受控改名则拒绝后续核验/grant，不追随替代路径。原reviewer已认可这一较小方案不需要新增PID1/账号/root mount能力，但实现与真实Linux仍须分别验证。

MountAPIVFS在v249 namespace.c已有/run tmpfs fallback，不能因源/run为空便推断缺失。三个工作源tmp/shm/profile则必须派发前实际fstatvfs满足nosuid|nodev|noexec且可写；BindPaths仅允许0/MS_REC，NoExecPaths只补noexec，不能假设源/var/lib已有nodev。源不满足则在role_dispatch前失败，不自动挂载、改宿主配置或放松WorkerGuard/View。实际平台的固定源挂载准备与验证仍属于Linux门禁。

### B1固定业务exec与Xauthority材料接线（本地内部步骤）

守卫私有_execute只执行Xvfb/Brave/x11vnc/websockify，自身消费一次原grant；anchor/main仍保持未接，不能通过此私有方法推出整组ready。首步建立同一原5秒期限，覆盖文件准备、握手及最终检查；末端原namespace/身份、固定只读可执行及解释器、profile、Xauthority、原FD/CLOEXEC和真实/dev/null stdio均需满足。拒绝未知FD，只忽略枚举自身已关闭且实际EBADF的条目；最后FD检查后不再打开文件。exec异常或异常返回永久关闭消费者，未决占位不释放。

业务路径、argv、DISPLAY :99、CDP 19222、RFB 15900、WS 16080、egress proxy 18080仅在本组net namespace内固定，不接受请求参数指定。Brave强制原代理与禁loopback绕过，保留Chromium sandbox；Xvfb使用-auth而非-ac，x11vnc以相同Xauthority接X11，RFB仍仅本组loopback并依赖后续私有桥/用户认证。认证文件缺失不得降级为无认证X11。

GroupMaterial在原material_claim持久化后独占创建credentials/xauthority，格式为单一FamilyWild/display 99/MIT-MAGIC-COOKIE-1的16字节随机cookie记录，root0400；文件与父目录fsync早于material_ready。固定模板通过LoadCredential将同一不可替换源交各角色；原inode/权限/大小/hash逐次核验，失败不改名重建、不输出cookie或写入日志，跨组独立随机。源持久不可替换契约也覆盖该文件。依据：[X.Org安全说明](https://www.x.org/docs/man/man.pdf)。

Python shebang不继承guard解释器的隔离参数：允许的固定Python脚本显式经/usr/bin/python3 -I执行（保留可信系统site，不-S），最小env固定PYTHONNOUSERSITE=1，禁止加载可写HOME用户启动模块。真实本地Python哨兵反例已由原环境返回42转为修复后0；这不是Linux真实角色启动或沙箱证明。shell包装器/完整解释依赖仍须纳入只读candidate和真实Linux门禁。

<!-- 下列B2细化承接B1；C实现须先满足此边界。 -->

### B2私有数据端点与anchor交接实施接口

新增scripts/pool-broker/quartet_endpoints.py及test_quartet_endpoints.py；quartet_records.py增闭合endpoint_claim/endpoint_ready，GroupMaterial统一拥有失败清理。_GroupEndpoints.create(material)只消费原GroupMaterial，在其原writer/flock下执行；不接受路径/账号/端口/成功快照。程序只核验预置/run/holaday-pool-data为root:原registration._gid的0750目录，不创建全局父目录。endpoint_claim持久后独占本组resource子目录（同owner/gid0750）及cdp.sock/vnc.sock（root:appgid0660，AF_UNIX/SOCK_STREAM监听）；文件系统leaf和原socket FD分别记录身份，不能相互假定inode相等。目录fsync后endpoint_ready仅表示端点材料持久，不是业务ready。所有原对象逐次检查；失败close仅关闭原FD，不unlink、重建或释放slot。

0750/0660仅限制可达性，appgid并非独占应用身份证明；实际非root桥在转发任何字节前必须完成原组数据认证。root从不accept或读写这些业务listener。首次anchor HPW1 grant → 单一HPB1 FD交接消费者 → 后四角色HPW1为唯一顺序，共享control.sock不运行竞争accept循环，不跳过错误协议重试。原WorkerGuard四角色和原Node运行通道依旧拒绝SCM_RIGHTS。

HPB1接口单独闭合：原candidate/resource/anchor InvocationID、fresh nonce及有序cdp/vnc两端点身份关联；challenge/response后，原writer先持久bridge_offer消耗再单次SCM_RIGHTS两FD，非root消费者先接管全部rights再验证AF_UNIX/STREAM/ACCEPTCONN/固定名称/不同原socket/CLOEXEC和每包root内核凭据。消费者accepted回应同nonce，原root再持久bridge_commit并单次发送commit；只有消费者实际收到commit才能开始下一阶段认证，不以root写记录推断交付。offer后任何短写/丢ACK/超时都保留未知，不重传；root close无法撤销远端FD副本，不据此称桥停止、业务ready或退出。egress不加入此FD集合，单独按原应用叶socket+challenge和独立能力接线。

- [x] 端点真实文件/socket与同原writer TDD：占位fsync先于mkdir/bind，缺/弱/换代父目录拒绝，两个固定listener不同原对象，部分创建/日志失败不重试，外层最终撤销先清理再释放flock。05:33本地463/463通过130.258秒，精化outer guard后端点11/11再过3.146秒；原reviewer无必修。仅SO_ACCEPTCONN等Linux边界合成，实际listen/connect真实，未接HPB1/桥，不是业务ready或Linux验收。
- [x] 本地producer/consumer HPB1实际packet socket+SCM_RIGHTS与真实句柄链测试，异常关闭/不可重发/锁内清理/原身份撤销和固定5秒覆盖。11:35全套487/487通过191.760秒，原reviewer Important已关闭；仍为合成Linux边界，不是业务或平台ready。
- [x] 接原非root长期selector桥与原应用认证、独立egress、逐组IO归属；认证前不转发业务，之后再接协议就绪/main/完整launch及Node。

HPB1本地实现接口：quartet_bridge_channel._BridgeChannel._transfer_locked仅由原material._run(handshake=True)调用，接收端_WorkerGuard._receive_bridge自行消费原HPW1后连接同一固定control.sock。帧固定为网络序`!4sB20s16s16s32sQQQQ`，依次为HPB1、阶段0/1/2/3/4/5、candidate、resource、原anchor InvocationID、nonce和有序两socket(dev,ino)。hello只携原binding握手值，Invocation和对象字段为零；root由原anchor pin/view及原endpoints生产后续字段，不能传入调用者成功值。每次只接一个阶段，不重试错包。

生产者入口还必须自行把原material事务deadline夹紧为min(外层剩余截止, 本次已核验单调时钟+5秒)，不能只依赖调用方的handshake=True。此截止一直覆盖原journal最终guard；后续新_run重新建立预算，不把交接期限当作永久bridge租约。默认30秒scope在response第6秒、以及_handshake返回后outer-final第6秒仍放行的两个真实RED已修复，并以成功后第6秒新角色事务正常执行作配对保护。

bridge_offer和bridge_commit只持久invocation/challengeDigest/endpointDigest，不写FD号或nonce明文；同一original writer先fsync才发送相应帧。记录只代表已消耗/可能交付，不能恢复可发放对象。原material在accept前持有bridge，bridge借用而不接管原anchor pin/view及listeners；清理在原flock释放前关闭控制连接/意外rights，最后由material清理原借出者。material的纯撤销检查需包含bridge所绑定的精确原anchor/pin/view，即使在journal内部原生IO期间撤销也必须停止，不等待外层检查。纯撤销检查不要求journal busy；仅执行IO的_budget要求锁内，以容许正常事务结束后最终状态检查。

有原endpoints的后继credential/accept必须原bridge仍活着且一次commit已发送、日志committed；这仅允许派发后续角色，不能代替接收端实际收到commit，更不能当作业务协议ready。没有endpoints的历史内部材料测试仍不被此新阶段强行改写；完整launch_quartet未来必须要求原endpoints与bridge。当前没有main/长期桥/业务转发，此项复合任务仍未勾选。

```python
# 原材料事务接收实际创建者，不传任意路径或外部监听成功值。
endpoints = _GroupEndpoints.create(material)
# 创建只有端点材料事实；业务桥尚未接管，root不读取业务字节。
assert journal._resources[material._resource]['endpoints']['state'] == 'ready'
endpoints.close()
assert journal._resources[material._resource]['state'] != 'exited'
```

以上接口细化已由唯一原reviewer只读确认属于已批B2，不扩大账号/root能力；实际代码、FD交接、应用认证与Linux证明须分别验证，不能以方案审查替代实现门禁。

### B2应用原进程监视接口细化（D，非新增权限）

唯一原reviewer确认采用首次持有时序：anchor在第一次HPW1 hello之前取得应用pidfd并持续持有；root在该次response之后实际核验原registration/PinnedApplication；anchor收到grant及HPB1 commit后复验同一个FD。实际同PID namespace中，后一次原pin仍活可证明先一次lookup没有指向复用者；原进程死亡则永久拒绝，不关闭后重开。它不是按PID恢复已丢失授权，也不把pidfd当业务授权/退出证明。HPB1保持精确两个listener FD，Node继续拒绝SCM_RIGHTS。

**Files:** quartet_material.py固定anchor凭据增加闭合application={pid,uid,gid,boot,pidNamespace}，全部从原pin和root实际namespace获得；quartet_worker_guard.py内部持有/核验，不新增可执行模块或root能力；test_quartet_application_monitor.py及现有材料/guard/Linux边界fixture。

**Interfaces:** `_WorkerGuard._capture_application()`只能由首次anchor `_await_grant()`在hello之前调用；`_check_application()`从原binding和原FD检查。`_check()`纳入该监视，`_discard()`关闭原FD；没有成功参数、重新建立接口或信号/ptrace操作。保留net/ipc/mnt必须隔离的原约束，PID namespace则必须与root凭据相等；核验实际NSFS类型、原及当前namespace身份、proc/self/status的Pid与os.getpid一致，以及本进程fdinfo唯一正Pid等于原应用PID。pidfd的CLOEXEC及poll无IN/HUP/ERR/NVAL必须持续成立，失败永久关闭。

- [x] RED：缺少capture时真实首次hello仍发出；真实管道FD模拟Linux pidfd生命周期，proc/NSFS为合成内核边界。成功grant持续持有同一个FD且只open一次；退出/错误Pid/错误namespace/错proc视图/可继承FD均在发送前拒绝并清理。
- [x] GREEN：闭合anchor凭据从原pin及root实际PID namespace生产；root现有response后原pin验证保持，不添加外部成功快照。原PID namespace与当前实际对象均复核，其他net/ipc/mnt仍要求隔离。
- [x] RED→GREEN：grant/HPB1 commit期间及最后native cleanup退出均拒绝；原5秒覆盖capture，后续调用不能重开；四角色不取得应用监视FD。
- [x] 本地定向、真实HPW1/HPB1集成、唯一原reviewer及498全套通过。Linux边界合成，不勾选长期桥/业务ready。后续长期桥每段recvmsg前后须使用同一监视并核对本段SCM_CREDENTIALS，不能只检查连接快照。

12:10本地收口：首次审查1项Important和1项必修测试Minor均已修复复审关闭。原监视最后poll后还清理临时FD、握手末端还核验endpoint，4个真实尾部close→pipe可读反例均曾错误返回成功；现在完整_check末端执行应用监视，其临时FD清理后以及HPW1/HPB1 endpoint最后清理后执行原FD terminal poll与时钟复核。该poll不打开任何新引用，不把观察瞬间之后的未来存活当承诺。root后验测试只令捕获的原application FD在response后失败，其他worker FD保持原seam，且证明实际发生应用后验，避免把worker死亡混作应用检查。新增monitor8项、receiver2项、root后验1项；最终498/498、62AST/4JSON/34新文件空白通过。所有业务接线和真实Linux仍待后续。

```python
# _await_grant的内部顺序；_check持续使用已持有的同一FD。
if binding['role'] == 'anchor':
    self._capture_application()
# 原HPW1 hello/challenge/response/grant，root实际原pin检查在response之后。
self._check()
```

依据：[Linux 5.15 pidfd_open](https://raw.githubusercontent.com/torvalds/linux/v5.15/kernel/pid.c)、[proc pidfdinfo](https://raw.githubusercontent.com/torvalds/linux/v5.15/kernel/fork.c)。该非root操作不增加signal/ptrace/setns权限；不同UID、零能力和不支持同PID后续exec转换边界不变。

## 内部C：Node数据与浏览器池接线

### 固定协议观察与控制连接（16:00内部细化，原reviewer已认可属于B2）

17:17细化优先：HPT1固定126字节，`!4sBB20s16s16s16sI32sQQ`，末两字段为原create总截止与本阶段截止的CLOCK_MONOTONIC绝对纳秒；不是收包后重新开始相对计时。root先持有并持续核验原broker与原anchor相同time namespace（原FD、设备/inode、NS_GET_NSTYPE=CLONE_NEWTIME、原WorkerPin存活），之后才允许发deadline；双方整数monotonic_ns拒绝排队过期/倒退/超原总期限。phase1 hello双零，2/3握手同时携总60s及独立5s截止，4命令/5报告/6每阶段durable ACK回显完整原上下文，7仅stage4最终确认。后续stage6不得等到stage4才发，root fsync protocol_observed后才ACK；ACK丢失/跨期为unknown，不能重试派发。源消费者及四真实协议流已验证；root同钟域/日志生产者、同selector与公开main仍在实现，未达到发布门禁。

不修改既有HPB1单次交接/close语义。anchor完成原egress接入后，在派发Xvfb之前主动连接唯一原control listener，root核验仍持有的同anchor pin/view并用fresh nonce建立一条HPT1元数据连接。之后root仍用原listener串行接四角色HPW1，该独立已认证HPT1连接只传固定阶段命令/观察回执，不竞争accept，不传FD、路径或业务响应。原create总60秒包含阶段等待；命令发出起每阶段≤5秒覆盖探针/关闭/报告/最终持久化，不分段重置。

anchor把控制与最多一个探针纳入原selector，保留固定两个额外控制FD容量，不占用或扩大64业务连接，tick公平有界。四阶段固定X11→CDP→RFB→WS；root每role grant之后发送当前role InvocationID和新nonce，非root只按固定协议探测本组既定端点。X11使用原Xauthority和固定/tmp/.X11-unix/X99；CDP固定127.0.0.1:19222/json/version并验证发现地址仍为本组固定CDP，不跟随任意URL；RFB完成3.8/None/共享ClientInit/ServerInit有界交换，不请求帧缓冲；WS固定16080，校验RFC6455握手且实际承载同RFB交换，不以101当成功。原响应只在非root小缓冲内校验并丢弃，不交root/日志/异常，不读页面截图。

报告仅固定stage/resource/candidate/原role invocation/fresh nonce；root最后持久protocol_observed前重新验证原anchor/current-role对象、原manager、总/阶段deadline，记录只保存不可反向恢复的挑战摘要。一次性固定阶段，不重连、不重派、不用记录恢复授权；控制/探针失败永久清理所有原IO并保留unknown。protocol_observed仅限定时刻协议事实，不是永久端点归属、groupExit或Node业务ready。最终Node仍需实际认证CDP/VNC通路验收。

实现继续TDD：先纯有界协议交换，再原guard/输入与非阻塞探针、原root控制回执，最后公开main和完整launch。参考X.Org X11协议、RFC6143、RFC6455和Chrome DevTools官方/json/version文档；不增加依赖或调用外部业务。

### anchor独立egress消费（15:10内部接线）

保持已复审HPW1/binding闭合格式，另由原_GroupEgress在egress_claim后独占创建credentials/egress(0400)，文件/父目录fsync且持续验证原FD/摘要/目录精确成员后才egress_ready。内容仅version/candidate/resource/boot/key/leaf(device,inode)，原应用身份来自原binding.application。只有持同material、complete、未retired原_GroupEgress的anchor模板增加LoadCredential egress和root保护link→`/run/holaday-egress.sock`只读bind；完整launch必须实际对象，不从历史ready或文件恢复。单元级旧HPW1模板不代表可生产启动。

新原_AnchorEgress从原HPB1/guard/应用pidfd消费固定只读credential和O_PATH叶；必须经该held O_PATH连接而不是再解析名字。HPG1方向为anchor hello→Node challenge→anchor ACK；完成ACK不代表Node已验收或group ready。每连接5秒、之后双64KiB/30秒积压/每段SCM身份和末端pidfd检查。最终与数据桥使用同一个selector、统一总64连接上限而非两份64。root不读业务；anchor专属传递不等于同槽同UID角色之间的秘密隔离。此细化已由唯一原reviewer确认在既批B2内，不新增权限。

### 固定原Node监听器（14:30内部实现细化）

路径式libuv close会unlink当前叶，不用于本生产监听器。采用原Node进程内固定N-API工厂，仅uid998、固定`/run/holaday-pool-egress/egress.sock`、无调用方路径/权限选项/unlink。保留NOFOLLOW父链和O_PATH叶；通过原leaf magic-link自连、原listener accept、两端原PID/UID/GID和随机nonce验证再chmod原叶0666。创建整体5秒，不修改umask。错误保留文件系统叶不重建。

原生对象只持一个listener FD；take在返回整数前永久清除native所有权，一次尝试。Node提前安装error/close/connection观察器、pin原child，并在take前显式拒绝cluster worker（Node22 fd分支不传exclusive）。直接documented listen({fd})，成功listening才接管；take开始后任意异常保持原owner unknown，不能根据空server close释放，也绝不按旧整数补close。可能遗留的一枚原FD仍计入原进程未完成状态，最终进程退出后才能对账。take前close/GC只关闭仍native持有的FD。

TDD先编译原C核心配合显式合成syscall边界，逐调用失败/超时/清理及单次take；再Linux固定实现/N-API和Node实际FD接管测试。Darwin测试不证明Linux O_PATH/SO_PEERCRED；精确native产物hash、Node22 Linux兼容和真实Linux验证仍发布门禁，不fallback到普通path监听。本细化唯一原reviewer已核对可行，不增加系统权限。

### B2数据子键与非阻塞三帧认证（C接线前置）

**Files:** quartet_protocol.py仅增加私有固定上下文子键派生；quartet_material.py在anchor LoadCredential下发dataKey，不下发management/egress；quartet_worker_guard.py内新增_DataPeer非阻塞认证状态机（stdlib，保持-I/-S单文件可信执行）；test_quartet_data_peer.py及原材料/协议/guard fixture。

**Interfaces:** `_derive_data_key(management,candidate,boot,resource)->hex64`按RFC5869单块Expand，info固定为`b'HoladayPool/CDP-VNC/data-key/v1\0' + candidate20 + boot16 + resource16`，末尾计数0x01。仅root与原Node管理客户端持parent；anchor只有派生子键。原v2双能力日志不改，不支持单独子键轮换。

`_DataPeer.open(worker,stream,kind)`只消费已收到HPB1 commit的原anchor guard和本地accepted AF_UNIX/STREAM，kind仅1(CDP)/2(VNC)，立即接管连接并核对原app SO_PEERCRED；每段recvmsg还要SCM_CREDENTIALS和原monitor前后核验，rights先接管后关闭拒绝。`advance(mask)`每次至多执行一个非阻塞读写，返回当前selector READ/WRITE需求；整个认证独立原5秒，不重置、不占住其他连接等待读写。`_authenticated`只在完整ACK送出且原guard/时钟最后复验后成立，无公共ready或组退出含义。

闭合帧`!4sBB20s16s16s32s32s32s`：HPD1/type/kind/candidate/resource/boot/serverNonce/clientNonce/tag。type1 challenge以零clientNonce签名；type2 response必须新非零clientNonce，与serverNonce不同；type3 ack签名绑定完整上下文/双nonce及实际response tag。HMAC输入为`b'HoladayPool/data-auth/v1\0' + frame_without_tag`，ack额外追加response_tag；每个type本身分离方向。Node验证challenge后生成自己的随机nonce，再验ack防旧challenge/ack重放。认证期间已观察到的超量/前置业务字节、错帧、截断、短写、未知cmsg、错误身份、退出或超时均永久拒绝该连接，不重试认证。

- [x] RED→GREEN子键向量及原材料：标准单块HKDF固定上下文，context变更分离，非法字段拒绝，原anchor有dataKey但无parent/egress，管理query拒绝dataKey；后四角色不包含子键。
- [x] RED→GREEN真实Unix STREAM分段三帧：未认证不提供业务状态，双方nonce及ack transcript验证，身份/HMAC/context/重放/rights/短写/5秒/尾部退出反例；其他连接无需等待一条连接认证完成。
- [x] 将真实消费者连到原HPB1 guard验证所有权；独立审查。随后同一大项继续selector固定端口转发/egress/协议ready/main/Node，禁止把本认证单元单独发布。

```python
# 未来anchor selector只在固定listener.accept后交给此内部对象。
peer = _DataPeer.open(worker, accepted, 1)
mask = peer.advance(events)
# 只有私有_authenticated实际成立，才进入本组固定loopback连接阶段。
```

派生子键与双nonce接口由唯一原reviewer确认属于已批B2，参考[RFC5869](https://www.rfc-editor.org/rfc/rfc5869.html)。STREAM不声称一次peek证明远端从未提前发送，转发边界依赖本地认证完成状态。

### B2长期数据桥（同一大项继续）

`_DataRelay.open(peer)`只接受真实已完成三帧认证的原_DataPeer且只能消费一次。非阻塞TCP连接仅固定本组127.0.0.1:19222(CDP)/16080(VNC WebSocket)，连接预算5秒；认证预算不限制后续长连接。两个方向各最多64KiB，积压从空到非空开始计30秒，不因新输入或部分发送延长；满缓存暂停该方向读事件。每段Unix消息仍核SCM_CREDENTIALS/原app监视，任何rights都完整清理拒绝；EOF允许Linux不附凭据但仍核原进程，半关闭先排空队列再SHUT_WR。连接结束不代表groupExit。

`_AnchorBridge.open(worker)`仅从原HPB1监听FD复制本地拥有的listener，同一原guard/bridge/application引用贯穿。一个selector上限64连接（含认证中），至多128×64KiB业务缓存；每次tick等待最多100ms，每个就绪监听端最多accept一次，每个连接每方向至多一次IO，所有活动认证/积压期限即使无事件也检查。坏客户端只关闭自身；原guard/原监听对象失效关闭本桥全部IO，不从路径重新打开原listener。close关闭复制FD及所有连接，不声称撤销其他进程持有的原FD。

先实际Unix/TCP RED→GREEN，再覆盖一条认证等待不阻塞另一条、上限拒绝、应用退出全关闭、短写/EAGAIN恢复和半关闭。原reviewer正在审查relay，发现recvmsg后重入close可能泄露刚收到的rights；已加真实FD反例，必须先失败再修复并复审。Linux身份仍合成，以上不计平台门禁。

egress原叶固定采用同一/run挂载上的root保护硬链接，无新root挂载权限：原app叶O_PATH/原pidfd/challenge后，egress_claim先持久，再以原父FD执行不覆盖link；目标父链root0700，类型/dev/ino/权限核对后，第二challenge必须通过目标链接。不改socket chown/chmod，多组nlink/ctime变化不作为身份换代；EXDEV/已存在/不支持/换源竞态均unknown且不重试。目标目录fsync后才登记可消费，原监听者失联/权限改变拒绝，不用旧ready在重启后重建缺失目标。参考[Linux5.15 Unix inode查找](https://raw.githubusercontent.com/torvalds/linux/v5.15/net/unix/af_unix.c)、[link语义](https://man7.org/linux/man-pages/man2/link.2.html)。实现和真实Linux验证待后续同项完成。

#### egress原叶生产者接口

新增quartet_egress.py/test_quartet_egress.py，_GroupEgress.create(material)只接原材料；原material立即持有清理对象。固定源/run/holaday-pool-egress/egress.sock，专用父app(uid998):原gid0700、叶0666；预置root目标父/run/holaday-pool-egress-links为root0700。本次resource目标子目录独占创建root0700，只有egress.sock一叶。原父FD+O_PATH|O_NOFOLLOW叶引用绑定dev/ino/类型/uid/gid/mode，拒绝ACL/capability；Linux O_PATH的xattr用固定/proc/self/fd/<本进程持有FD>同步访问，不把/proc/<PID>/fd源交异步systemd。

固定身份探针HPE1帧`!4sB20s16s16s32s`（89字节）：type1请求/type2原nonce回应、candidate/resource/boot/随机32B。root只发送此闭合元数据且只收此固定帧；SO_PEERCRED和每段SCM_CREDENTIALS必须原app，原pidfd/boot在每次IO前后核验，任何rights完整清理拒绝。两次探针各新nonce，整个create用原材料5秒；第二次必须连root目标。STREAM分段有界，不容许超量/未知字段/短写，不重试。原ready记录只有leafDevice/leafInode及两次challenge摘要，不存能力或原nonce，不支持从该记录恢复可派发句柄。

同一日志增加闭合egress_claim→egress_ready，要求endpoints ready、无roles/credentials；claim先于mkdir/link，目标/父fsync与原对象核对及第二challenge先于ready。material验证和纯veto接入原egress对象；失败与outer-final清理只关本地FD/socket，保留目标与未知。Linux不支持/跨mount/源替换等关闭式失败，不调整宿主挂载。

**Files:** apps/orchestrator/src/browser-pool/broker-client.ts、broker-endpoints.ts、broker-pool-runtime.ts及对应测试；egress-proxy.ts、cdp-readiness.ts、vnc-proxy.ts、browser-pool.ts、types.ts、index.ts；执行生命周期接口复用owned-operation.ts，不改计费业务。

### 原create事务的Node准备交接（13:25接口核对）

22:45可信加载细化（原reviewer已确认B2内）：application_guard只有消费原sealed capsule并核candidate/boot后才覆盖生成HOLADAY_POOL_CANDIDATE/BOOT；两个字段仅路由元数据，不加入输入环境继承白名单、不当原登记/开关许可。Node模块首次读取并私有固定，未有字段不得dotenv补齐。无参数固定loader在任何dlopen之前核验Linux/Node22/uid998、固定root-only候选父链、严格manifest schema/status/candidate/arch、两个原NAPI文件完整摘要。两个原FD同时持有，整个加载器使用期保留以免/proc/self/fd/N名字复用命中动态链接缓存；只以原FD+固定RTLD_NOW加载，无全局符号/普通路径fallback，部分加载失败永久停用整份loader、不返回半个工厂或重试。依赖候选不可覆盖安装契约，后续root pidfd/每包SCM/boot核验仍必须执行。Linux产物门禁还须核ELF架构、动态依赖白名单和禁止RPATH/RUNPATH，两个文件hash不代表依赖验证。技术依据为[Node22 process.dlopen](https://nodejs.org/docs/latest-v22.x/api/process.html#processdlopenmodule-filename-flags)，本地loader测试不计Linux门禁。

21:45接收层细化：v2控制严格拒绝SCM_RIGHTS，因此原socket始终由固定N-API对象持有，不能take后交libuv读而丢失ancillary。工厂无路径/FD参数；固定父链与O_PATH叶连接，首次root内核peer绑定原pidfd，后续不按PID重建；非阻塞recvmsg接管并关闭所有rights后拒绝，逐段核root SCM和原pin/路径对象。只把核验后的有界字节交私有Duplex消费者；无socketpair中转、额外进程或root业务代理。JS单个有界轮询泵承载原socket读写回执，不新增线程，关闭必须实际回收native原FD后才产生close。准备/总期限及原drain否决仍由原create拥有，native IO不续期。CDP/VNC原设计的逐段SCM检查在anchor接收方向，不把Node普通Socket声称为双向ancillary核验。原reviewer已确认此为已批B2实现细化，尚未实现/平台验收。

18:52补充运行态期限边界（同一B2范围）：原create从收到首请求前开始，总60秒；prepared/accepted阶段不续期。完整五角色与四协议核验之后，在原journal持久group_ready元数据并完成原owner末端检查，才把原_GroupMaterial一次性交给私有运行态owner。日志中的ready不能重建此对象；未知或重启保留占位。只有这个原owner可以解除启动总期限，后续每次只读运行态核验仍各有固定30秒上限和原app/manager/pin/view校验，不能把一般_remaining改成无期限。创建返回/写ready仍受原control总60秒约束；完整准备或ready丢失不释放物理占位。第3项前任何close均不签发groupExit。以上转换必须有超过启动60秒后的真实原对象检查、过期创建无法转运行态、原worker撤销及失败写盘反例。

外部action仍仅create/query/close；v1 serve_closed原行为不改。新v2在同一个原Node私有Unix连接内，按`持久prepare/offer → prepared → Node原组owner预留+egress登记 → accepted → root材料/探针/派发/协议核验 → ready`执行。prepared不是业务可用组，accepted不是ready或退出凭据。Node egress listener及逐组处理必须accepted前可用，消除等待最终ready的循环。

Node create客户端内部接口细化（2026-09-12）：由原boot私有connector交付已核根身份/固定父链与叶的原Unix stream及其检查/清理能力，不接收API路径、FD或成功布尔值，不回退普通路径connect。每个create客户端先从原操作fork+pin一个child，再进行连接/写请求；原请求最多一次。prepared严格核同candidate/boot/request/slot后，同步回调原BrokerPoolRuntime预留不可复用group并注册egress，只有得到原私有reservation且末端dispatch检查通过才能accepted。回调Promise、抛错、重入关闭均拒绝，不把未决Promise当登记完成。root ready摘要严格匹配；之后等待本条原流EOF和实际close，才向原私有group提交ready。原组数据通路的真实认证/协议仍另验，不从控制帧制造端点。

客户端总60秒从首IO前开始，准备/确认写入与最终ready交付各≤5秒且不延长总期。最多两响应、累计8200字节；错误/多余/截断/同块提前ready/阶段换代、断连一律不重试。连接factory或写请求已开始后不确定结果进入原drain unknown，必须留待真实对账；即使本地socket实际关闭也不释放物理group槽位。只在所有本地原连接/保留native句柄确实close后释放该控制child；清理未知时保留pin。能力仅私有内存，不进入错误、repr、日志或用户DTO。测试用真实本地Unix流、显式native身份边界替身，不能据此封存Linux产物。

新会话不是复用prepare_quartet返回handle就有启动许可：原(boot,requestId)若已存在即不得重放这次派发；prepared首字节前同原journal落盘单次offer，accepted校验通过后也持久消耗；重连/旧handle/重启不可重发prepared或launch。accepted摘要覆盖规范完整prepared帧（version/requestId/candidate/boot/slot/resource/管理与egress能力/新事务nonce），Node仅服务端内存存能力，不进日志、用户结果或异常。

v2独立定长长度前缀与闭合JSON/阶段/总字节上限，不沿用v1 EOF；总create预算固定原60秒，各握手/探针/角色IO继续≤5秒且夹紧原总剩余，不逐步重置。前置accepted/额外请求/跨帧换SCM/错误摘要/rights/截断/超时一律unknown且不继续派发。Node同步预留原owner后才能accepted；prepared或最后ready丢失即使已启动工作也不能仅凭控制socket关闭释放物理占位。

完整启动要求原_GroupEgress非空且有效，不接受日志ready恢复。仅anchor把root保护硬链接只读bind到/run/holaday-egress.sock，避开已有只读control目录；其他角色只经本组127.0.0.1:18080。anchor私有binding的egress须真实原对象与独立能力，历史内部无main测试的null不允许用于完整launch。原reviewer已认可此为B2内部握手细化，未作为实现通过。

**Interfaces:** 私有BrokerPoolRuntime由受控boot创建；create(slot)返回私有物理组句柄和经核验的数据连接工厂；用户不能构造端点/PID/成功字典。adopt仅绑定原物理组。close等待已接收SDK/数据原始IO，并在第3项未给出真实退出凭据时保留unknown，不释放slot。

固定根端监听接线细化（2026-09-12 20:30）：`quartet_listener._QuartetListener.open(journal)`仅借用原ResourceJournal/registration/pin；无路径参数，仅独占`/run/holaday-pool-runtime/control.sock`。根父链NOFOLLOW原FD/元数据贯穿，叶与原socket分别校验，已有或换代叶不unlink/接管；原生边界之后复核期限和纯owner。初次建立及每次accept最多5秒，取得原流后移交已有_CreateControl原60秒事务。每个监听器至多32次接纳，不重建过期监听器，不修改v1 serve_closed。所有迟到socket/control在验证前即接管，close立即否决、忙时延后回收，先清理control后原listener/父FD。私有serve_create_once仅调用原Control.prepare/launch，持有实际_RunningQuartet；它不是日志重建或退出回执。根注册入口与原Node连接器接通、真实完整消费者联测前本内部组件不开放生产。

- [x] 真实临时Unixsocket/HTTP测试Node发请求一次、接纳响应严格解码、超时/丢回复不重复；私有能力不进日志、异常、用户结果。
- [x] 出站Unixlistener独占创建，不unlink未知路径；逐组egress token与管理token分离，握手后才进入原SSRF/IP固定连接策略，迟到DNS/HTTP/CONNECT/升级与socket全计入原组owner。
- [x] CDP用有认证头/能力的uid998 loopback适配器→私有Unix数据端点；VNC保留原用户认证并核对原组，不使用随机端口本身作为权限。
- [x] 严格pool用私有组工厂替代直接spawn/reaper、固定sleep及PID/端口重建；boot保持closed，初始化失败不回退singleton旧路径；未启用旧应用行为不受无关变更影响。
- [x] 双组本地控制链验证私有对象不可复制/串用、端点换代、release期间迟到IO/adoption、容量和部分启动失败。Linux真实隔离另列第4项。

### HPG1 出站数据认证编码

仅使用原组独立egress能力，域为`HoladayPool/egress-auth/v1\0`。154字节固定布局与HPD1一致，magic为HPG1、kind固定3。hello(type1)为零server nonce和新client nonce；challenge(type2)为新server nonce并回显client nonce，HMAC覆盖域、header、hello tag；ACK(type3)覆盖域、header、challenge tag、hello tag。Node验证ACK前不能交HTTP；anchor验证challenge后完整发送ACK才进入业务。两端nonce必须非零且不相同。所有失败消耗交换、清理私有副本；返回帧与内部状态隔离。编码器不证明原进程、socket所有权、ready或groupExit，后续socket消费者仍需原组存活、总预算和物理IO持有。

### Node逐组出站消费（同一第2项）

每个BrowserEgressProxy在任何IO前同步从原group fork并私有pin一个child；该child覆盖全部未决策略/连接Promise和原client/upstream/request实际close，最后physical close才释放，父group继续等待真实groupExit。HTTP不复用全局Agent，agent:false且持有原request底层socket；TCP连接在connect前只close无error也单次终结原Promise。任何await后及实际派发前重新验证原child/closing，关闭清理不被新准入guard阻断。strict实例禁用start()，只收私有runtime已经认证且只交接一次的socket；旧legacy无需新lifetime，但关闭不能复活。

BrokerEgressConnections是固定源listener之外的原Node会话所有者，不自选/打开路径。构造在IO前pin原boot child；同一boot/candidate最多32份原prepared登记，每份原scope+独立egress key+原group lifetime，仅内存存在。原scope一旦登记（含已关闭）不重用；HPE1仅对已登记原组回复固定身份挑战，绝不交HTTP。HPG1逐帧有界，5秒总认证预算不因分片重置；认证中的会话最多64。HELLO后提前业务字节拒绝；完成ACK可和首HTTP同块，ACK验证后暂停原socket、取消认证读者和期限、将剩余≤64KiB原字节一次unshift，再交该组proxy。原boot/global所有者持有每个socket到真实close，group关闭同时关闭未完成认证和已交接IO；关闭映射不删除后重新授权。它不证明原listener inode/安装、Linux身份或完整组ready。

### 2026-09-13 原运行时及 CDP 适配器接线

BrokerPoolRuntime 固定加载原 native 工厂，先独占 egress listener，再在每个 create 派发前保留不可复用的槽位和 global group pin。prepared 同步派生数据子键并登记 egress；实际控制 ready/EOF/native close 后才交付私有 group。runtime transport 与每组 data/egress 使用分离的内部 drain，检查始终回到原 global owner 和纯撤销来源；外层 group pin 不在 transport drain 中，不形成 create→reservation.close→create 等待环。close 只清理本地 IO，group unknown/槽位仍保留，不提供 groupExit/reconcile。同步 BrokerDataAcquisition.ready/close 让失败认证也能依原物理 close 归还连接容量；未证明关闭时不归还。runtime 两项独立审查 Important 已经真实 RED→GREEN 关闭。

CDP 同一 B2 内采用较小的 WS 适配面：先经原 group.connect(1) 的 HPD1 私有通道，以有界 GET /json/version 核验固定 ws://127.0.0.1:19222/devtools/browser/<id>，再向服务器内 SDK 提供本机 /cdp WS 地址及独立认证 header。不公开 HTTP 发现接口，不在 URL 中放能力；rawHeaders 严格拒绝重复认证、错误 Host、Origin 和查询串，认证前没有后端连接，代理不转发私有 header。原 accept 起五秒涵盖首部认证及完整上游 101；发现正文64KiB、握手首部8KiB、本地64连接，所有 late open/socket/原回执仍归原 owner。Playwright 官方支持直接 WS endpoint 与 headers：https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp 。本地测试是真实 NAPI/Unix/HTTP/WS，浏览器协议端为合成 fixture，绝不等同实际 Chromium/Playwright 完整链或 Linux 证明。实际 SDK header 传递、VNC 用户认证与 strict pool/boot 仍待后续。

## 整项收尾

- [x] 独立审查真实实现及全部调用点；Important先反例RED再修复GREEN，不引入成功替身。
- [x] Python全组/AST/JSON、相关Vitest按≤20文件单线程分批、后端typecheck、变更文件格式和git diff --check串行执行。
- [x] 对照本设计逐项记录实现/本地验证/Linux待验/第3项未开放，不用代码量或局部测试代替闭环。
- [x] 整项本地提交并更新QA/原自动化精确断点，下一大项安全停止排空；禁止推送/合并/部署片段。提交及自动化实际回执记入QA/PROGRESS，不在此自引用提交hash。
