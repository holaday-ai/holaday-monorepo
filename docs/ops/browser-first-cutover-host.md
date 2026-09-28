# 首次发布主流程接线

2026-09-27。本页描述代码接口，不是生产就绪或部署批准证明。

`scripts/browser-first-cutover-host.mjs` 的 `createFirstCutoverHostAdapter({ attempt }, io)` 已连接候选准备、同一实际 journal、证据采集、备份回执、迁移、首次状态、候选关闭启动、精确开放及后续核对。沿用 `performFirstCutover` 和共用的 `finishStoppedRelease`，不伪造旧 bootId，也不另建发布引擎。

## 调用契约

### 专用跨主机通道（2026-09-27 已安装并实测）

用户已明确批准此凭据边界。Vultr 的 `/var/lib/holaday-deploy/channel/identity` 是新生成的 ED25519 专用身份，root 私密目录0700、文件0600；私钥只留原机，没有传到 Mac、阿里云或 Git。阿里云只追加对应公钥，原管理员授权完整保留，安装前原文备份在 `/var/lib/holaday-deploy/channel/authorized_keys.before`。不修改 sshd 全局配置、不重启 SSH。

- 公钥指纹：`SHA256:mTMfZx3UlwAYB6A331mjGhgHDBwpdcML76GMHQSLTyg`。授权限定 `from="207.148.70.106"`、`restrict` 和固定 `/usr/bin/python3 -I /var/lib/holaday-deploy/channel/browser-cutover-channel.py`；不开放 shell、PTY、文件传输、端口/agent/X11 转发或用户 rc。
- 仅接受完全匹配的 `holaday-cutover-v1 probe` 和 `holaday-cutover-v1 observe <32位小写十六进制nonce>`。采集器必须匹配安装摘要、root所有权和0600权限；调用方不能上传代码、路径或写操作。Node替换入口进程，避免留下一个未分类的额外采集父进程。
- Vultr 的独立 `known_hosts` 来自 Mac 已信任的阿里云 ED25519 记录，不采用首次连接自动信任。客户端固定SSH配置、密钥及主机，禁止agent/密码回退，不使用Mac凭据。身份目录已存在则安装器拒绝，不在不确定状态下重新生成密钥。
- `readFirstCutoverHostPair` 在真实Linux root默认使用本机采集 + 此阿里云通道；Mac保留原管理员只读审计路径。仍检查nonce、源码摘要、主机、原checkout、boot、精确observer和60秒新鲜度，两端均结束才返回，不自动重试失败观察。

安装入口SHA256：`cf00acb2fae7cca75428dcc01ce2eb0ffe24d8b9a477fe28edf9f6c384d86a3d`；采集器SHA256：`58511139b884091781bafd78bcd98cdab3972916135857730cc073e114f0d218`。后续修改采集器必须先验证再按管理员维护流程更新固定安装和摘要，不会接受客户端临时源码替换。

真实新身份已验证probe/observe，以及拒绝任意命令、scp/sftp、未实现execute、命令拼接、直接转发和PTY。隔离sshd另验证错误来源、远程转发、用户rc和摘要篡改拒绝。最终真实双机观察 `observedAtMs=1790518727337`，Aliyun12/Vultr30个相关进程，旧checkout仍为 `107857fe70503e30691073f267d87275596edb20`；这是当时观察，不是长期有效发布许可。私密原文在Mac `/private/tmp/holaday-root-pair-final-ztkNFu`，单通道验收在 `/private/tmp/holaday-channel-verification-3hg7m9`。

撤销时通过保留的管理员入口，先按以上公钥指纹确认，只移除该专用公钥的授权行；不要把备份整文件覆盖回去，以免抹掉之后加入的其他管理员授权。专用私钥不属于Mac恢复密钥，不复制到USB。当前没有任何远程写操作opcode，固定发布副作用、受保护批准清单、真实journal和维护窗口仍须原计划接线；这一步不等于整项部署完成。

### 原发布调用约束

- 只接受 `attempt`，其余候选、摘要、分支和绝对窗口由已有受保护批准文件读取；不接受 CLI 手填字段覆盖批准。
- 构造无副作用；缺少任何现场适配接口时，获取锁和构建之前拒绝。`preflight` 只读批准，`stage` 复用实际准备函数持锁、构建并做 prepare readiness；只有通过后才进入入口修改。
- 调用方必须在 transition 返回后调用 `adapter.finish(result)`。失败只关闭文件句柄、保留锁与记录；`reconciled` 是意图，实际后续核对成功且仍在核对窗口内才释放锁。
- 同一副作用方法不能重复或并发执行；失败不重跑 SQL、不回启旧代码、不全局 PM2 save/delete/kill。启动状态查询可以轮询，启动命令和 open 只执行一次；open 丢 ACK 只查询同一身份。
- 保护性 close 不受维护窗口截止阻止。启动已读到合法候选身份但随后发现 dirty 时，也保留该身份用于关闭，而非等待 transition 收到 start 成功结果。

### 双主机操作记录

同一真实 journal 的启动文件及 PM2 注册子事件可带固定 `host: 'aliyun' | 'vultr'`。每台主机分别校验备份、意图、执行回执及所在阶段；相同 `/root/.pm2/dump.pm2` 路径、相同 PM2 数字 ID 不再被误判为另一台主机的重复操作。已有不带host的单机接口保留，但同一attempt不允许混用两种模式，也不接受任意主机名。

持久文件仍保留完整顺序事件，不能在第二台主机执行前覆盖第一台记录。已开始的任一主机批次未完成时，不能推进主阶段；重复执行、缺失回执和错误payload仍拒绝。现场适配器必须把host绑定到实际执行通道，并证明全部批准对象已处理，不能把一个host字符串或“当前所有批次完成”当成双机执行完毕证明。本变更不提供远程RPC或自动批准清单。

## 必须连接的现场接口

现场生命周期现在必须实现 `attach(context)` 与 `detach(context)`。host在实际候选准备、持锁及配置校验完成后、prepare证据采集前调用attach；此时journal仍为preflight，适合构造固定双机入口和原退役观察器。attach只读接线，不能停服务或修改入口；不应藏在证据读取回调中，也不能等到orders_fenced才构造。缺任一方法在获取锁/构建之前拒绝，没有默认空实现。

detach关闭本次执行会话：成功路径在同实例恢复入口、恢复worker之后且维护截止前调用，之后独立只读核对可以继续到reconcile截止。失败路径finish仍在持锁状态清理已开始的attach；detach调用只尝试一次，确认丢失不重试、不杀远端进程。成功解除发布锁必须同时满足原reconciliation条件与detach已完成；异常则关闭候选准入、保留实际journal/锁。独立核对连接和数据库恢复仍由完整site提供，不能把detach当成业务核对或恢复完成。

### 正式 nginx 测试、重载与生效观察（2026-09-28）

`applyCutoverFence / restoreCutoverIngress`未提供成对的`testNginx / reloadNginx`替代接口时，现默认调用`browser-first-cutover-nginx.mjs`。现场必须提供同一操作的`nginx.maintenanceEndsAtMs`，沿用原journal/受保护入口回执；缺窗口、过期、非Linux/root或接口不完整时拒绝，不通过CLI接受任意命令。一个控制器只执行一次测试/重载，不把失败或丢确认改成可重试。

正式命令固定为`/usr/sbin/nginx -t / -T / -s reload`，使用清理过的环境。测试后的完整配置输出、同一master与正在服务的worker代际须在发送重载前保持一致；调用前后及轮询期间检查原窗口/操作/回执。发送一次reload后，最多观察30秒且不超过维护截止，新worker必须连续两次稳定、旧worker不再接受新连接；随后重核完整配置。失败不调用stop/quit，不回滚、不强制杀worker。

默认从`/run/nginx.pid`及真实`/proc`读取master和worker的PID、启动时刻、UID、exe、父进程和运行角色。未知活子进程、权限不足、主进程变化、复用PID或无新服务代际不能当成成功。共享nginx上无关站点的旧连接允许由已经进入graceful shutdown的旧worker继续持有；不能将其强制断开，也不能由此推导HOLADAY已无写入。后续实际HTTP探针及独立HOLADAY停写证明仍必需。

现有Linux实体夹具已使用此默认控制器和默认PID/proc读取，仅将nginx配置路径映射到容器的合成多站点配置。需要容器自有PID/network namespace中的`NET_ADMIN`和`SYS_PTRACE`，不挂宿主PID或凭据。真实无关长连接贯穿两次维护重载和恢复仍可传输数据；真实目标业务响应在隔离时拒绝、恢复后正常。该结果不代表双机现场副作用通道或整项切换已完成。

### 固定跨主机入口会话（2026-09-28，本地实现，未安装生产）

`createFirstCutoverIngressPair({binding,maintenanceEndsAtMs},io)` 是完整site可消费的固定双机入口组合。`readApprovedPair()` 从受保护现场清单提供 `{inventoryDigest,unknownIngress:[],files:三个已审核站点,remoteSiteDigest}`；remoteSiteDigest绑定阿里云独立审批文件的完整字节。它在preflight/prepared阶段持有真实journal时构造本机生命周期和远端会话。两阶段隔离依次执行Vultr→Aliyun；恢复在同实例serving已确认后依次Aliyun→Vultr。每个跨机操作始终绑定同一个journal记录摘要、完整清单和绝对窗口，中途变化或一侧失败都不继续后续写操作、重试或自动回滚。

两台主机取得的是同一个全局writer观察，不能相加成重复计数；必须一致、新鲜且全隔离时为零，返回最早观察时间，不刷新旧时间。每次隔离核对两份实际回执及各自精确文件范围；`readFenceReceipts()` 返回 `{host,receipt}`，可供原退役观察器消费。writer读取器必须独立读取实际事实，不能递归调用正在执行的入口会话；不从nginx探针推断 `unsettledWork/externalWork` 为零。`close()` 只结束会话，不解除维护或清除journal。构造与结束须由完整site生命周期安排；尚无默认生产site提供者，不能据此启动完整发布。

Linux演练现由真正本机生命周期和独立接收进程执行，分别保存私密回执/备份/生成文件，使用同一个真实journal。容器为节省资源共享一个网络命名空间及nginx，端口和目录映射明确属于QA，不宣称两台真实主机。除完整两阶段/恢复外，另让测试接收进程在实际nginx重载后、发送确认前退出：两份实际隔离和回执保留、journal停在orders_fenced、重复调用不产生第二次重载、无自动恢复，原文件和无关连接仍保留。业务停写及候选控制仍为明确合成边界，真实SSH授权独立验证。

`browser-first-cutover-ingress-session.mjs` 把已有本机入口生命周期接到受限 SSH 的双向标准输入/输出。控制端 `connectFirstCutoverIngressSession({binding,maintenanceEndsAtMs,siteDigest},io)` 只能连接既有 Vultr→Aliyun 身份/固定地址/严格主机指纹，使用 `holaday-cutover-v1 ingress <attempt>`，没有自定义主机、命令、环境、文件上传或重连参数。只暴露两阶段隔离、验证、同实例恢复、回执读取及结束会话；结束会话不清除发布锁。丢确认/协议错误停止该客户端，不重试动作、不恢复旧配置、不发送杀进程信号。

控制端必须提供真实 `journal.assertOwnership/readFirstCutoverEffects` 以及 `observeWriters/verifyOpenedIdentity`。接收端每次需要事实时按当前序号向同一控制端请求，控制端调用这些活接口，不缓存旧journal或在动作包里夹带成功报告。双端均为既有可信root部署进程；此机制不是抵御root主机被攻陷的方案，也不能让网页或CLI上传JSON取得部署权。帧有大小/顺序限制，读取、发送和结束等待受原绝对窗口约束。

接收端默认独立读取本机 `/var/lib/holaday-deploy/maintenance/first-cutover-approved.json` 与 `first-cutover-ingress-approved.json`；后者必须root、0600、非链接、单硬链接，目录0700。格式为 `{schemaVersion:1,host:'aliyun',binding,maintenanceEndsAtMs,ingress:{inventoryDigest,unknownIngress:[],files:[...]}}`，只允许已有Aliyun app/pay两个完整已审核站点。实际文件/链接及原字节仍由原安装器核验。清单完整字节摘要须与控制端受保护配置给出的siteDigest一致，操作期间重新读取，不能从操作请求替换清单。

`browser-cutover-channel.py` 的新源码增加此精确命令，但先要求私密 `channel/ingress/` 下的固定20个依赖模块和 `bundle.json` 完整集合。清单为 `{schemaVersion:1,files:{固定文件名:sha256}}`；每个模块root/0600/非链接且完整hash匹配，未知文件、缺依赖、路径穿越或篡改均拒绝。入口仍不提供安装功能，不重装密钥/authorized_keys/sshd。原probe/observe接口不变；生产仍是此前只读版本，这次没有传包或改线上强制命令。后续现场安装须单独核对候选、工具包摘要及有效审批，不能直接把源码变更当通道已上线。

验证分为两段，不能混称双机整切换：现有网络容器中，实际接收子进程通过流请求父进程持有的真实journal，完成三站点实际nginx/TLS隔离与恢复，保留无关长连接；配置端口、CA和业务/备份/候选观察为显式合成边界。另一个现有SSH容器使用真实sshd、原restrict强制入口、完整模块包和独立保护文件，完成无副作用attach/读取/结束，并拒绝缺包、审批权限放宽、依赖篡改及原所有shell/转发攻击。SSH段未运行nginx修改，网络段没有跨生产网络；完整双机site、writer事实、首次shell、停写备份恢复和发布验收仍需继续。

### 本机入口生命周期组装（2026-09-28）

`createFirstCutoverIngressLifecycle({binding,maintenanceEndsAtMs},io)` 复用原 fence store、文件安装、nginx 生效及 TLS 探测，返回 `fenceOrders()`、`fenceAll()`、`verifyFence()`、`restoreIngress(identity)`、`readFenceReceipt()`。现场调用方必须在持有原真实共享 journal 的 preflight/prepared 阶段建立实例；构造仅观察，不创建备份或改站点。之后分别要求 journal 的 orders_fenced、all_fenced、verified 意图。单次动作期间固定完整 journal 记录摘要，不能在阶段或子事件改变后继续副作用。

`io.journal` 必须是实际持锁对象；`readApprovedIngress` 来自受保护现场清单，完整配置在构造时封存并在每个效果边界重读比较。`observeWriters` 和 `verifyOpenedIdentity` 仍是必需的现场读接口，不接受默认零写入者或手工成功标志。恢复要求 journal 的真实候选 SHA/boot 与实际 serving/非 idle/需 reconciliation 状态一致。使用当前本机生成的持久回执，不接受上传回执，也不接管已有半途操作。

相同实例上的并发动作被拒绝。任一修改动作失败后，后续修改都停止；丢失重载确认不重试、不自动恢复。只读回执仍可核查（仍须原窗口、journal 和审批有效），其中 installing/restoring 不构成成功。生产默认使用 Linux/root、固定配置文件处理、真实 nginx/PID/proc 和 TLS；测试可注入受信底层 I/O，不存在把这些接口作为外部 JSON 授权的入口。

原 Linux 网络夹具已改为直接调用此生命周期，而非在夹具手动组装三个模块。它实际执行三个站点的本机文件、回执、重载、双栈 TLS、恢复及无关长连接保护；业务核清、备份/迁移/候选状态仍是明确的合成 journal 前置条件。三个站点在同一隔离容器里，不是双机现场效果通道，也不是完整 `createFirstCutoverHostAdapter` 的生产 site I/O。后续必须在完整现场适配中为各主机接上该实例、真实 writer/控制观察以及受限跨主机传输，不能将本段独立通过写成首次发布完成。

### 真实入口探测（2026-09-27）

`verifyCutoverFence` 未提供替代 `probeIngress` 时，默认调用同模块的 `probeCutoverIngress(approval, stage, io.ingressProbe)`。它只向三个已审核站点配置所描述的本机443端口发送请求：IPv4/IPv6、固定SNI/Host、正常证书验证、无凭据的无效回调，以及真实WebSocket Upgrade请求。不跟随重定向、不重试、不降级HTTP；每个请求最多5秒和64KiB响应。所有请求结束后才返回完整观察；超时、截断、错误证书或成功Upgrade拒绝整次观察。

业务前缀使用专用测试后缀，精确`/ws`保持原址，避免把`/healthz`精确健康例外误当成被隔离的业务前缀。结果保留实际HTTP状态和缓存头；原verify仍负责判断503/no-store或无效签名拒绝是否符合当前阶段。

现场适配必须另外提供`ingressProbe.observeWriters()`，返回同inventoryDigest下的新鲜`existingSockets / internalWriters / producersRunning / observedAtMs`。探测前后都读取，缺失、漂移、无效或过期拒绝；非零计数原样保留，不能从HTTP 503推导零写入者。它不自动实现双机观察合并、业务核清、nginx重载或完整生产适配。

隔离Linux验收现复用该生产探测器：实际nginx、证书、双栈和37个路由/监听组合，两阶段隔离后恢复原链接/UID501文件；不可信证书37项均拒绝。测试使用已有`holaday-first-cutover-network:qa`，只读挂载scripts/ops、`--network none --cap-add NET_ADMIN --cap-add SYS_PTRACE`；`holaday-cutover-ssh:qa`不含nft，不能用于此项。应用后端及非HTTP写入者计数仍为合成数据，本测试不是生产停写证明，也不访问PayPal服务。

### 退役后的联合观察（2026-09-27）

`createFirstCutoverRetirementObserver({reviews,binding,legacyDigest}, {journal,readPair,readFenceReceipts,now})` 在副作用发生前采集并封存原始双机基线，实算旧版摘要必须与批准一致。后续 `read()` 使用新鲜双机观察，并在读取前后核对同一真实 journal 和维护入口回执；不会把当前现场重新生成为批准基线。

- journal 的 `readFirstCutoverEffects()` 校验仍持有原锁、持久文件身份/权限/完整字节，返回事件及完整记录的 `recordDigest`。同阶段追加备份回执、manifest或bootstrap也会改变摘要，不能混入一次正在进行的观察。
- 完整具名主机的注册备份→删除意图→删除完成，才允许严格 `read()` 中原审核对应注册与进程树缺失；仍检查实际进程不存在，PID复用、进程回生、保留服务丢失均拒绝。
- `readRegistrationProgress(host)` 仅供原注册删除执行器的中途核对：Vultr生产者停止阶段，或Aliyun全隔离/停止意图阶段。返回带 `purpose: registration-progress` 的实际剩余注册清单，不是完成证明；只有精确删除意图已记录才解释对应对象消失，严格读取仍拒绝未完成批次。真实主流程在 `stopped` 意图后删除网关注册，因此journal接受该阶段，并阻止未完成批次推进到备份。
- `retireUnmanaged({maintenanceEndsAtMs}, operations)` 复用原 `captureLegacyRuntime` / `retireLegacyRuntime`。只处理审核过的Aliyun未托管网关完整清单，真实journal先写精确 `unmanaged-stop-intent`，随后经固定主机的 `signalPinned` 执行、连续两次观察退出，再写 `unmanaged-stopped`。`readUnmanagedProgress` 仅作中途观察；无意图、错身份、PID复用、回生均拒绝。中途失败保留意图、禁止重试和推进备份；该方法不自行证明业务已核清，`verifyFence` 必须由现场接口供给。
- 运行时目标的host来自两次一致的实采kernel hostname，不把SSH路由别名当真实hostname；绑定仍包含实际boot与进程启动身份。具名journal继续使用固定aliyun/vultr路由身份，两者不混用。
- 启动文件只解释本次已完成写入的精确新摘要、固定路径及安全原子替换元数据；备用文件原本不存在就必须仍不存在。实际写入器保留原属组，不因root进程创建临时文件而改变原属组；保留失败发生在替换前。
- `readFenceReceipts` 必须来自同一操作的受保护 fence store，按 `{host,receipt}` 返回，不接受CLI上传成功报告。只解释 `active` 回执对应的固定站点、同attempt生成路径、root:root/0600及完整生成字节；其他nginx来源保持原审核约束。未接此接口时空回执不会容忍任何入口文件变化。
- 返回来源指纹为当前实际字节，不是被规范化用于比较的旧指纹。原始配置/环境只留在闭包，不返回到公开报告。

`readWithCandidate(identity)` 在新鲜双机读取前后，分别通过实际维护控制socket和PM2/proc/4001/4002监听取得候选观察。候选必须匹配当前journal的SHA/实际boot，不能使用bootstrap seed；关闭态必须idle且无worker，开放态必须已有reconciliation标记。只从旧版对比中扣除精确已证明的新主程序/worker，额外进程、原PID复用及其他未知来源仍拒绝。`readFirstCutoverCandidateRuntime` 默认以真实Linux root执行固定runuser/候选控制工具，不接受外部成功报告。

入口恢复后仅接受同实例serving、all-writers且实际原文件完整还原的 `restored` 回执；半途restoring、身份变化及原文件漂移仍拒绝。kernel hostname保留原始大小写，用于与Python pidfd执行主机精确匹配，不按路由别名或转为小写。

这些是退役执行与阶段观察接口，不是完整生产site adapter。真实双机副作用传输、业务停写及外部工作仍需按原计划接线；不得把本接口返回无unknown等同于全部进程退出、入口隔离有效或可部署。

持久业务工作核查已由 `readFirstCutoverPersistedWork(context)` 接到原execution site：从原root私密批准配置取得数据库，使用候选mysql2独立连接；前后核对原journal、配置摘要、候选目录和窗口。现有 `readCutoverWorkScope` 与支付readiness共享十二表查询，覆盖真实 `dispatching`、探索/渲染/注销及计划/批量子项，保留未知状态与未清租约，不改历史行；任何缺表/截断/异常都不返回零工作。现场边界在入口/进程读前后调用，不接受外部零计数覆盖非空数据库结果。**这不是外部工作完成证明**：旧实例数据库归属、内存请求、浏览器副作用和provider轮询仍需独立核清，不能仅凭SQL或socket为零放行。专用合成MySQL验证入口为 `scripts/fixtures/browser-work-scope-mysql.mjs <专用QA容器名>`，仅接受原QA标签、loopback13316及无生产挂载；创建/清理自己的随机库，不对生产使用。

`scripts/fixtures/browser-registration-removal-linux.mjs` 使用真实PM2、UID998生产者、停止状态cron、主/备用dump、root journal，以及真实未托管网关与pidfd SIGTERM验证上述连接。Docker使用 `--init --cap-add SYS_PTRACE --network none`，源码只读挂载；不共享宿主PID或凭据。双机路由在单个隔离容器中模拟、业务隔离计数为QA固定值，不能冒充生产双机整流程。验证还包括PM2守护进程重启后仅恢复无关fixture。

本机生产者接线使用 `browser-first-cutover-registrations.mjs` 的 `retireLocalFirstCutoverProducers({binding,files,maintenanceEndsAtMs}, {journal,observer,verifyFence,now,sleep})`：`binding`只含attempt/inventoryDigest，files沿用受保护主备启动清单。仅Linux/root且实际内核主机名匹配Vultr已审核观察；原journal必须在producers_stopped意图阶段且尚无该主机退役事件。核清工作、核对完整注册与剩余时间后，复用原私密备份/主备替换和定向注册删除；全部事件直接写原journal并标记Vultr，最后由原观察器核验退出。只返回生产者阶段结果，不能冒充双机stopped。已有部分事件或丢失删除确认不重做，保留副本与锁。上述实体夹具现在直接调用该正式组合，不再自己编排两个写入器；业务核对及其他主机仍须完整site提供真实观察。

`scripts/fixtures/browser-retirement-observation-linux.mjs` 在无网络的一次性root Linux容器中，以实际 `removeSavedStartupEntries`、真实文件/属组998、真实持久journal和新读取的stat/字节验证连接，含真实磁盘篡改拒绝。主机/进程/PM2信息仍为合成场景，不能称为真实双机整流程演练。

`scripts/fixtures/browser-candidate-observation-linux.mjs` 验证默认候选读取器的实际PM2 6.0.14、UID998 Node、proc、双端口及Unix socket传输，并拒绝错误身份、真实孤儿进程和两次socket读取间状态变化。候选协议内容是明确的合成模型，不是完整应用或联合退役/隔离证明；`--without-control` 实际失败，不把无控制socket认作通过。

### 旧版身份与完整数据库比较（2026-09-27）

`readReviewedFirstCutoverLegacySource({reviews,inventoryDigest})` 将实际双机读取、原分类器和准备阶段的 `inspectLegacySource` 返回协议接在一起。只有两台主机都匹配受保护审核清单且没有unknown，才返回实算的旧版摘要；摘要绑定来源提交、采集代码、进程/启动时间、管理器、监听、保留对象及来源指纹，不从批准文件照抄摘要。时间刷新、采集进程更换、列表排序不改变旧版身份；真实进程或来源变化会改变绑定。**仍需现场适配从受保护配置提供reviews**，本函数不批准来源，也不是首次执行CLI。

`browser-first-cutover-mysql.mjs` 提供实际 MySQL 只读一致性快照及恢复比较。使用专用、无损类型配置的连接，前后核验server_uuid/database；覆盖表、视图、触发器、事件、存储过程及函数，检查完整列定义和全部原始行（重复行保留、顺序无关、二进制按字节）。返回摘要和对象清单，不返回业务值。源库/恢复库只规范化被引用的schema限定名及冗余utf8mb4声明，不改写SQL业务字面量；触发器对象重建时间不当作业务时间。

迁移后使用源快照的原始列投影比较所有历史业务列，允许新增列/表，不允许原列消失或旧值变化。非InnoDB、超过单表100万行、非法标识符、不安全整数/Date/未保持原文的JSON对象、读取失败及元数据漂移均拒绝，不截断采样。连接须启用 `dateStrings/supportBigNumbers/bigNumberStrings/jsonStrings`，禁止decimalNumbers；使用结束后回滚专用只读事务。调用方仍须证明停写/目标隔离，本模块不凭快照宣称停写。

上述比较器已接入真实age+mysqldump/mysql+原journal+全61SQL的合成集成测试，代替仅QA内的业务字段摘要；它不代表生产备份已执行。双机副作用适配、Mac运输、首次shell与整流程演练仍未完成。

同日后续：Mac运输已有 `pullFirstCutoverAgeBackup({source:{options,artifact},destination,expectedBackupDigest,expectedBytes})`，返回恢复机本地密文artifact，再交给 `decryptAgeBackupToFile`。`source.options` 和 `destination` 各自仅接受facility/directory/attempt，私钥不属于运输参数；两端工具路径/二进制摘要可不同，但attempt及公钥摘要须一致。配置仍由受保护site I/O提供，不可把CLI上传参数当作批准。隔离集成测试已接上这个实际运输代码，SSH替换为本地真实读取进程；另外用户明确授权后，真实Vultr→固定跳板→Mac无业务探针于UTC08:46:23通过，见[运输证据](browser-backup-recovery.md)。完整生产source/target计划、现场生命周期以及首次shell仍须组装，不能把无业务探针当停写后的真实数据库恢复。

### 双机只读通道（2026-09-27）

`readFirstCutoverHostPair()` 已使用真实 SSH 连接固定阿里云/Vultr目标，Vultr沿既有阿里云跳板进入。复用现有采集器，经stdin在远端Node内存执行，不安装远端文件；保持严格主机密钥校验、关闭agent/端口转发，不接受调用方替换目标地址或提供任意远端命令。凭据沿用既有SSH/askpass环境，不进入返回值或日志。

一次双机读取共享随机请求ID并分别绑定主机名、采集代码摘要和采集进程自身身份；两条读取全部结束才返回，任一失败或超过60秒有效期拒绝整组，不重试、不返回半份成功。Vultr另外在采集前后检查旧checkout的HEAD及已跟踪文件差异；这只证明旧源码来源，没有把Git HEAD当作内存中程序版本。原始结果含私密配置，仅交给受信调用方私密保存，不能直接打印到用户日志。

`classifyFirstCutoverHostPair({pair,reviews,inventoryDigest})` 将两台机器分别交给既有单机分类器，核对各自已审核的bootId和端口，不依赖数组顺序配对。它保留浏览器/其他应用的保留项，并把未审核、漂移、缺失的来源按主机汇总到`unknownLaunchers`。**不会生成review、自动批准来源或返回发布就绪结论**；当前生产完整review及生命周期I/O仍待组装。

实际只读验证：UTC `2026-09-27T07:39:43.984Z` 起采集成功，阿里云12进程/2注册/223来源，Vultr28进程/9注册/265来源；旧checkout `107857fe70503e30691073f267d87275596edb20`。原始结果保存在Mac私密目录，未提交源码仓库。此快照会过期，不能当后续停机许可或复用为实时readiness；这些数量也不表示488个来源已经审核。

以下 `io` 是受信代码接口，不是可上传的 JSON 或人工 true 开关。当前没有默认生产适配或首次执行 CLI；构造函数默认仍会拒绝缺失的观察器。

| 接口组 | 责任 |
| --- | --- |
| `inspectLegacySource` | 按完整受保护清单读取旧源码、实际进程、启动来源并返回绑定旧版摘要的实时观察，不能只读 Git HEAD。 |
| `lifecycle.fenceOrders / settleLegacy / stopProducers / fenceAll / stopLegacy` | 复用已实现的两阶段隔离、真实业务核对、定向停止、注册与主/备用启动文件处理；两主机必须共享同一操作绑定并各自验证本机事实。 |
| `lifecycle.assertStopped(context, previous)` | 重采当前停止证明，包含 `inventoryDigest / phase:stopped / observedAtMs / survivors / listeners / unknownLaunchers`；不能原样回送上次回执。 |
| `lifecycle.verifyFence(context)` | 合并真实入口探针和工作核对：`inventoryDigest / stage:all-writers / observedAtMs / existingSockets / internalWriters / producersRunning / unsettledWork / externalWork`；后五项必须为零。停进程不能替代停写。 |
| `lifecycle.readBackupPlan(context)` | 从受保护配置返回且仅返回 `sourceIdentity / isolatedTarget`；导出前由已有备份协调器再读两端身份。 |
| `backup` | 真实数据库身份、加密设施、导出、hash、隔离恢复、全对象/数据比对、隔离库完整迁移、schema 与业务摘要、源库复核。主流程固定注入当前时钟、实际 journal ownership、停写检查以及 `journal.bindBackupReceipt`，不能由调用方换成假回执。 |
| `evidence / publishEvidence` | 复用真实采集器与受保护证据发布。候选工具在构建后运行 prepare，关闭启动后 verify，open 前再采一次。 |
| `lifecycle.restoreIngress / resumeWorker / reconcile` | 恢复绑定入口、恢复指定 worker 和批准的持久启动配置、窗口支付与任务/浏览器探针核对；不得使用全局 PM2 save 替代定向处理。 |
| `lifecycle.holdMaintenance(context, result)` | 按实际阶段保持或恢复维护隔离，记录不确定状态，不清锁、不自动数据库回滚。 |

`context` 含原批准、binding、候选目录、应用 GID 和同一个真实 journal 对象。它是当前进程内的控制接口，不是可跨网络直接反序列化的授权对象。跨主机传输和远端 journal/观察器仍须在生产组装中提供。

主进程启动、readiness/control 命令使用固定 argv 和候选工具，以 UID 998 运行；迁移仍走现有全部编号 SQL runner。首次状态由已有初始化函数创建并绑定真实 bootstrap seed，不能用它冒充新进程 bootId。初始化和启动之间仍复核停止、入口与配置/迁移摘要。

## 已验证与尚未验证

### 已批准的九笔支付宝历史记录延期

2026-09-27用户明确批准：这九笔保持未核实、单独延期核对，不阻断本次上线。受保护inventory与数据库reader传入同一 `deferredAlipayPayments: { approvalRef: 'alipay-historical-20260927', recordDigests: [...] }`；九个摘要排序后JSON的SHA256固定为 `6e81aade39333ad180272497a70b06aeffb57194a643c525fde264684df69686`。采集器与应用readiness分别固定该完整集合；少一笔、替换、重复或加入新单都不能沿用批准。

历史身份指纹只包含原归档已有的表名、数字主键、provider、provider订单/capture ID、金额、币种、状态和UTC创建/更新时间；必须为维护窗口以前的pending/CNY/无capture支付宝payments记录。原归档没有external_id及metadata，不宣称这些字段已完成历史比对；现场完整选中行的fieldsDigest仍参加两次观察和数据库source绑定。新支付宝单照常查询，订单、回调、结算、权益不改，TRADE_CLOSED或未找到仍不伪装为已核验未支付。

可单独使用九笔批准，或与下方唯一PayPal批准同时使用（总计十笔）。两种批准互不扩展；此处不要求关闭新支付宝支付、不恢复PayPal访问。原始订单资料仍留私密归档，Git只包含摘要和合成测试。本段是实现契约，不是已经安装到生产的批准文件。

### 已批准的唯一 Sandbox 延期项

用户2026-09-27批准旧PayPal测试单延期；它仍未被支付方核验，不是已关闭或已支付。现场 `readHostInventory` 必须从受保护批准清单带入以下字段，并将实际新PayPal开关配置纳入 `configurationDigests`，不得凭空填写 `false`：

```json
{
  "paypalCheckoutEnabled": false,
  "deferredSandboxPayment": {
    "recordDigest": "75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95",
    "approvalRef": "paypal-sandbox-20260927"
  }
}
```

数据库适配将同一 `deferredSandboxPayment` 传入已有 `readCutoverDatabaseScope`。此函数只在完整分页/计数覆盖下将精确匹配行输出为 `deferredUnverified`；其他订单照常核验。不调用PayPal merchant解析器、OAuth或订单API，发现另一条PayPal记录即拒绝。`inventory.merchants` 与演练证据对应本次实际核验的商户，不为此延期项伪造PayPal商户或演练回执；原PayPal历史回调路径仍按两阶段入口隔离规则保护。指纹使用表名、外部ID、provider订单/capture ID、金额币种、状态、排序metadata键值和UTC创建/更新时间；报告只输出摘要，不含原订单号。实际该指纹已从私密历史归档生成，不能替换为任意测试单。

采集器和readiness双重固定此唯一记录，拒绝额外/重复/被改写的例外。`payments.scopeDigest/queriedScopeDigest` 仅对应须查询的订单；database source摘要另外绑定延期数组，provider-query摘要不冒充验证延期项。准备与开放前都重采，读前后变动即拒绝。没有延期时原V1报告语义不变。现场适配、备份恢复、首次shell仍需按上文接口完成；本段不是已安装生产配置。

新组合测试使用真实候选准备编排、临时文件 journal、证据采集器、备份协调器及首次状态文件；Git/构建、远端进程、业务/支付、数据库及文件属主是明确的合成边界。Linux Node 22 运行这些组合测试也不等于真实双主机切换。

尚未完成：实际受保护双机分类清单及上述生产接口组装、密文运输到指定 Mac 隔离库、生产停写后的真实备份恢复、历史任务/支付核清、持久入口与启动配置验收、首次 shell 入口、整项演练及独立审查。恢复私钥已于2026-09-27复制到用户指定的Yalei USB并实际解密验证，详见[保管记录](browser-backup-recovery.md)；介质未额外加密，待用户物理离线保管，不能替代生产恢复演练。不得据本页执行生产切换或宣称浏览器已上线。
