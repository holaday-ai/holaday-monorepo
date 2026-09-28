# 首次切换实施断点：真实文件安装与站点隔离已验证，Task 4 整流程接线未完成

日期：2026-09-26（Asia/Tokyo）。本地实施中，未部署。

最新授权：2026-09-26 用户表示“我要出去一下 你自行安排任务 允许期间的所有操作 包含PR 部署 验证”。当前浏览器上线大项允许自主实施、PR、必要合并、部署与验证；下方历史“仅本地/未授权部署”限制已被本次授权取代。授权不等于验收通过；必须完成剩余真实接线、恢复演练与发布门槛，不得修改历史业务记录来伪造通过。

## 最新恢复点（优先于下方历史段落）

### 2026-09-29 4.R2继续：旧版本能力缺口绑定现场源码，真实只读核对通过

承接`d27db17b`，Task4原BASE`844c2ced`不变。原collector增加固定旧版本`107857fe70503e30691073f267d87275596edb20`的六文件能力核对（http/index/router/task-queue/batch-executor/browser-pool）：两遍真实字节哈希、固定物理路径、普通文件及有界读取、前后元数据一致；错误、版本/字节改变、超时不能解释成unobservable。只返回源版本/时间/能力摘要；不执行旧应用、不采集业务内容。六文件对应已审查的“无完整in-flight接口”缺口，不声称覆盖全部依赖、运行时实例、外部工作或零活动。

原Mac/Vultr现场采集传输在Git前后核对之间读取该证明；原双机分类器仅接受Vultr与pair一致的源版本，不能把Aliyun证明移作旧源证明。v2 site的prepare/preopen和停止边界独立要求实际证明匹配批准摘要，保留到原证据与fenceDigest；v1不要求此证明，其他未审查版本只能得到缺失而不能放行v2。独立facts.observeWork/observeWriters/settleLegacy/reconcile仍为必需，没有把批准摘要或数据库空集变成knownExternalWork/unknownWriters零值。

两项针对性RED明确失败（退出1），接线后通过。首轮完整browser为995/996，一项stdin测试替身缺新能力接口；同步原替身并验证仅Vultr读取后，采集器32/32通过。最终完整browser **996/996**、实际Linux Node22 UID998四组 **360/360**、ops **120/59/16/845 + Python12**，全部退出0、零跳过。九MJS Biome、diff检查干净。日志`/tmp/holaday-capability-{red,green,observer,browser,browser-final,linux,ops}.log`。

已有QA镜像默认root读取器无I/O替身、无网络、只读挂载旧Git六文件归档，实际文件验证退出0（`/tmp/holaday-capability-source.log`、归档`/private/tmp/holaday-capability-source.wxoEeg/`）。原真实ss/PM2/pidfd/gateway/journal停止夹具退出0（`/tmp/holaday-capability-physical.log`）；该夹具能力/业务/入口/另一主机仍是明确合成事实，不能称完整切换或生产恢复演练。容器已自动移除，实时Docker仅原健康MySQL/Redis。

**UTC 2026-09-28 15:27:27.613实际现场只读验证成功**：通过原阿里云跳板使用既有本地凭据，仅在Vultr执行Git HEAD/clean前后核对和上述默认六文件双读；源版本仍107857fe，能力摘要`8eae2e6ebcaab8d92eb5694bb6f8f89923a23005888342309278fcc35ac35a72`。脱敏证明`/private/tmp/holaday-capability-live.7PBCUb/proof.json`，退出0，不重试、没有安装文件/改配置/重启/SQL/支付方访问。它是当时源码证据，**不是维护窗口、当前无工作或可部署证明**，未来必须重采。

本轮没有push/PR/合并/部署，没有重跑应用全套、独立整分支审查或完整成功/故障流程。CLI execute继续关闭；原cache、PayPal、历史支付/商户/恢复私钥/USB、UI与扩展均未改。原夜间自动化安排不暂停。R2/Task4–6仍未完成；下一步直接接剩余独立knownExternalWork/unknownWriters与恢复入口事实，不能再重做能力核对、13表摘要或TCP模块；随后原6.R3完整演练、首次执行、真实停写备份/Mac恢复及非PayPal恢复证据和整分支审查。

### 2026-09-29 睡前再次授权：恢复原线程夜间续跑

用户明确要求“继续 我去睡觉了 你自行推进 允许期间的所有操作”。据此通过应用原自动化接口，将既有`holaday`每小时heartbeat由PAUSED恢复为ACTIVE，仍只运行本线程，不新建任务或重复自动化。工具已确认ACTIVE；该确认只代表安排已恢复，不代表后续运行、部署或上线已完成。本条覆盖下方“自动化暂停”的历史记录，其他门槛不变。

当前实现锚点`75c6852c`，工作树仅原未跟踪` scripts/__pycache__/ `（保留）。本轮只更新续跑安排和恢复记录，没有产品代码修改、重新测试、生产操作或支付方访问。已通过结果仍属上一轮证据，不改称本轮新验收。

续跑必须推进原Task4–6闭环：先将独立现场capability/knownExternalWork/unknownWriters与恢复来源接到原facts，再做原6.R3完整成功/故障/不重放演练、受保护首次执行入口、真实停写备份/Mac恢复、非PayPal恢复证据及整分支审查。不要再次重做13表数据库证明、TCP观察、商户、密钥或通道。CLI execute保持关闭，直到完整验收与新鲜维护窗口齐备；必要实施、提交、push、PR、合并、部署及验证在本大项授权内，付款/退款/历史业务改写/PayPal访问和绕过系统权限仍不在范围。每轮保存实际进展，普通状态保持安静，大项完成、关键失败或真正需要用户处理时通知；确实无任何可推进工作则暂停自动化并报告，不循环重复失败。

### 2026-09-29 4.R2继续：原现场观察链增加既有TCP连接证据

承接`7313bfbc`。原主机采集只有监听端口，无法据此证明既有WS已经隔离；现在同一次主机采集中实读两次`ss -H -antp`，原双机分类器按各自主机已批准服务端口保留连接证据。IPv4/IPv6、无进程归属、监听已消失的连接仍计入；半关闭连接仍阻断，只有LISTEN/TIME-WAIT不算可继续派发的连接。选中连接前后变化、输出损坏、采集错误不能归零。

显式v2首次中断的原site边界另外要求双机新鲜连接证据均为零，即使外部writer回调声称零也不能覆盖实测。每台主机的连接摘要随原停止边界进入journal的`fenceDigest`。这只是**宿主网络命名空间、批准服务端口的补充入口证据**，不是内存任务排空、外部效果已核清、其他命名空间隔离或完整writer适配器；原独立facts仍必须提供。没有增加强关线上连接操作，存在活动连接时继续阻断。

四项RED已实际复现，关联三文件325/325通过；最终浏览器回归993/993、Linux Node22 UID998关联回归325/325，全部零跳过、退出0。原Linux物理夹具实读`ss`看到保留的4011连接（独立于合成writer=0），关闭本例自己的连接后，原gateway/journal/PM2/pidfd定向停止及无关启动条目保留验收通过，退出0。双逻辑主机共用隔离QA网络命名空间，业务和入口事实仍为合成，不能称生产或完整切换演练。日志`/tmp/holaday-tcp-{red,green,browser,linux,physical}.log`；RED命令的tail掩盖shell退出码，日志明确4失败，不记录成退出0通过。

七个MJS Biome及diff检查干净。运维完整回归首次权限审核超时未执行；唯一原样重试获准后已完成：120/59/16/842及Python12全部通过、零跳过、退出0（`/tmp/holaday-tcp-ops.log`）。所有测试结束，一次性QA容器自动移除；实时Docker仅原MySQL/Redis且健康。没有访问生产、SSH、数据库业务写入或支付方；不重做通道/密钥/商户。CLI execute仍关闭，自动化仍暂停，原Task4 BASE保持`844c2ced`。R2/Task4–6未完成；下一步仍为真实capability/knownExternalWork/unknownWriters及独立恢复来源事实接线，再完成原完整成功/故障演练、真实恢复和整分支审查，不重做已通过的数据库摘要或TCP观察。

### 2026-09-28 4.R2继续：持久恢复来源已由真实只读事务生成并消费

承接`c5804391`。原13表查询不变，v2默认host读取器现从同一专用只读事务生成恢复来源摘要，覆盖查询选择、实际阻断记录和观察时间；v1返回结构不变。`pendingReplay`是保守的持久恢复阻断记录数，不是已证明会被重放的动作数量，更不是内存/支付方请求总数。原site在停止前后及prepare/preopen报告中，将实采摘要与独立工作来源摘要、批准候选绑定；缺失、非零、过期、读取异常或第二次出现阻断项均不得登记中断回执。先校验独立证据再组合，不能对undefined取hash制造有效证明。

已观察三个RED：原读取器/host缺少实采恢复证明、site在缺证明时仍登记回执；实现后关联三文件238/238通过。新增缺失、摘要损坏、非零、后读新增、过期、读取失败六类拒绝。真实MySQL8的原夹具已覆盖实际13表：选中记录变化会改变摘要，同一选择/观察时间稳定，查询不修改记录。`/tmp/holaday-r2-persisted-proof-mysql.log`退出0；本例随机库、容器`holaday-first-cutover-qa-7ae3b920d165c804`和专用网络已清理，原MySQL/Redis保留。

最终browser **989/989**、LinuxNode22/UID998关联三组 **238/238**，退出0、0跳过；日志`/tmp/holaday-r2-persisted-proof-{browser,linux}.log`。真实PM2/pidfd/gateway session原物理链路通过，`...-physical.log`退出0；其中业务/入口/另一主机仍是合成数据，不能冒充全流程现场事实。八MJS Biome及diff-check通过。部署脚本回归 **120/59/16/838 + Python12**通过，0跳过、退出0，`...-ops.log`；所有本轮测试已退出。

**尚缺的是独立现场来源，不是再做13表查询。** `facts.observeWork`仍需绑定旧版能力缺口、已识别外部工作和实际写入者；新摘要不能用DB空集替代它，也不证明源代码已经在生产核验。继续原受保护现场适配与6.R3完整不重放/成功故障演练，再完成真实停写备份/Mac恢复、非PayPal恢复证据及整分支审查。R2/Task4–6未完成；原Task4 BASE844c2ced不变，CLIexecute关闭、自动化暂停。没有生产/SSH/PayPal/商户/密钥操作，没有push/PR/合并/部署；原缓存保留。

### 2026-09-28 4.R2续跑：中断分支已接到真实停止；现场事实与完整切换仍未完

承接`865b81ce`，原Task4 BASE844c2ced不变。新增实际接线：site→host→原停止/注册删除/备份前检查共同消费带类型的未知观察及持锁journal回执，停止前后均核查持久工作；不把未知转成0。原ingress/inventory允许中断意图阶段但不将意图当停止结果；报告保留完整前后观察，普通报告拒绝夹带风险字段。新候选真实boot在原candidate_started意图内单次原子绑定后才能进入readiness，风险记录不丢。调度器明确要求v2窗口，旧版/未指定窗口不能靠adapter返回中断分支。

恢复来源按现有源码审阅：application-main受控启动跳过旧启动恢复，task queue是新建内存队列，持久化落在TaskRepository；ws重连、task_steps与planned runner的恢复入口仍独立存在。发现父任务完成/暂停不能证明执行中子步骤已结束，原只读工作范围补入task_steps（共13表），不改任何历史状态。真实隔离MySQL8先RED（漏执行子步骤）再GREEN；覆盖已结束父记录、独立子记录、未知/NULL、过期租约、截断和缺表拒绝。日志`/tmp/holaday-r2-replay-mysql-{red,green}.log`，退出1/0；临时数据库及专用容器/网络已清理，既有MySQL/Redis未动。

原物理夹具增加中断模式，在已有隔离Linux镜像完成真实gateway session、root保护日志、启动文件、PM2单对象与pidfd停止；无关进程仍存活，PM2重启只恢复无关项，中断风险/回执保留。`/tmp/holaday-r2-physical-interruption-final.log`退出0。入口、业务/恢复来源/capability观察和另一主机是合成数据，不能写成双机现场停止或支付恢复通过。首次启动把观察器置为PID1而被身份校验拒绝，改容器私有`--init`后通过，未放宽产品限制；容器均自动移除。

最终本机browser **987/987**、实际LinuxNode22/UID998十组 **569/569**，均退出0、0跳过；日志`/tmp/holaday-r2-browser-final2.log`、`/tmp/holaday-r2-linux-final.log`。版本混用反例RED→GREEN，transition+host114/114。最初Mac21项socket EPERM是沙箱限制；获本地测试权限后只剩旧断言12表（实际13表），同步数量并明确断言task_steps查询后最终全绿。20个MJS Biome和diff-check通过。原ops **120/59/16/836 + Python12**全部通过、0跳过、退出0，`/tmp/holaday-r2-ops.log`；未重跑已完成的应用8602项。所有本轮测试进程已退出。

**下一步精确范围：** 继续原4.R2的受保护现场`facts.observeWork`及实际恢复来源摘要/pendingReplay组合（目前现场仍无默认适配器，不能填合成0），再接原6.R3完整成功/故障/不重放演练和Task4–6剩余现场工具闭包/单次入口、真实停写备份与Mac恢复、非PayPal恢复证据、整分支审查。本轮不能标R2/Task4/大项完成，CLI execute仍关闭、自动化PAUSED。无生产SSH/停机/支付/PayPal操作，无push/PR/合并/部署；原缓存和无关内容保留。原计划差异已批准，不重复询问风险/计划，不重建已完成模块。

### 2026-09-28 差异计划已批准：4.R1风险证据链已验证，继续4.R2

用户对`834022c7`回复“继续”，已开始原工作树串行实施，不再等待计划确认。审批v2→原持锁journal→采集/发布→索引/context→readiness首次专用命令已接入：风险摘要固定绑定原五字段、旧源、窗口、责任人与窄范围批准；中断观察必须实际写盘才能进入停止意图；备份、seed和新boot保留残余风险。普通/v1路径不接受此例外。尚未接完4.R2实际停止分支，不是可执行现场发布。

新增测试均已先观察到预期失败。当前本机browser973/973退出0、0跳过；其后补了“进入中断阶段不能退回prepare报告”限制，关联collector113/113及实际LinuxNode22/UID998三文件222/222退出0、0跳过。应用入口/readiness/证据读取69/69，orchestrator类型检查退出0。日志`/tmp/holaday-interruption-r1-{browser,collector-final,linux,ts,typecheck}.log`。真实临时文件/journal/索引与Linux属主路径是本轮证据；外部主机、停止、恢复回执仍为合成边界测试，不能冒充现场停写/恢复通过。

最终验证：应用前置Node73/73、orchestrator507文件8602通过/1条件跳过，退出0；跳过的是`authenticated diagnostic child`，父测试真实调用该专属子进程，不能把它计成独立恢复演练。日志`/tmp/holaday-interruption-r1-app-full.log`。显式合成DB65534/Redis65533、2GB堆且排除integration；更正初始“单worker”记录：配置中的maxThreads=4优先于--maxWorkers=1，后续显式`--no-file-parallelism`并固定线程池上下限1，不重跑已通过全套制造重复劳动。

自审的prepare阶段限制与日志返回独立副本均经RED→GREEN；最终原ops套件120/59/16/824与Python12通过、0跳过、退出0，`/tmp/holaday-interruption-r1-ops.log`。最后修正后的LinuxNode22/UID998三文件222/222通过、0跳过、退出0，`/tmp/holaday-interruption-r1-linux-final.log`。最终typecheck退出0，十个改动代码/测试文件Biome和diff-check通过。两次apply_patch审核超时均未执行，按工具允许各原样重试一次成功；无权限绕过。所有回归进程及临时QA已结束，未挂生产凭据/宿主PID，原数据库Redis未动。

4.R1本地提交后直接继续4.R2工作观察/停止分支，再做6.R3及原Task4–6真实闭环，不等待重复批准。4.R1只是可验证的协议/证据单元，不是完整可上线流程；整分支独立审查仍待Task6。Task4BASE844c2ced不变、自动化仍暂停、CLIexecute关闭；没有push/PR/合并/部署或远端变更，原缓存保留。

### 2026-09-28 第 0 节已获书面确认：原计划差异待审阅

用户对 `527db416` 的原设计第 0 节明确回复“确认”。已更新设计状态，依 writing-plans 技能在原 `2026-09-25-browser-first-cutover-implementation.md` 增补差异执行单，未另建计划或重置 Task4 BASE844c2ced。保留原 Native/主智能体串行方式：4.R1绑定首次批准/journal/报告，4.R2接工作观察/停止/物理停写分支，6.R3接原完整演练及未完现场闭环。已完成模块不重建；范围级未知不能替代支付、持久工作或写入隔离证据。

这是设计确认后的计划阶段，不是再次等待风险选择或第0节确认；下一步只需审阅本轮新写的计划差异，再按原方式实现。自动化保持PAUSED，CLI execute仍关闭；本轮未写产品代码、未启动测试/容器/SSH、无生产操作。未访问PayPal、未重核商户/密钥/USB、未改历史数据/UI/扩展/模型；原 `scripts/__pycache__/` 保留。原计划Task4–6的大项缺口仍在，不把三个差异执行单写成全部剩余任务或发布完成。

计划自审覆盖新旧协议不可混用、意图和效果回执分离、支付覆盖缺口拒绝、新候选自身dirty拒绝、恢复来源不重放及实际Linux验证。发现默认Vitest排除integration、WS恢复测试会写库，已把命令改为专用配置并要求无`.env*`隔离快照和本例DB/Redis，不能使用默认现有服务。文档路径检查19项退出0，唯一尚未存在的完整集成测试已明确标为原Task6待创建；无意外缺失/占位符，`git diff --check`退出0。本轮仅三份原文档提交，SDD ledger同步，未跑产品测试，不复用89b7b02b历史测试数量为新验收。

### 2026-09-28 风险选择已委托：原设计第 0 节待书面确认

承接本地 `89b7b02bdcfd929611ecf1c234451cc62c683b6e`。用户对“首次维护是否接受中断未落库请求、未知外部结果不自动重放”的具体选择回复“你决定”。选择一次性受控中断，并写入原 `docs/superpowers/specs/2026-09-25-browser-first-cutover-design.md` 第 0 节；不是再次请求用户选择同一方向。本轮仅书面修订，未改实施计划或代码、未运行测试/远端操作，尚无该修订的实现或停机权限依据。

核心边界：允许不可枚举旧内存请求的范围级风险保持未知，独立记录批准及停止事实；不伪造 `activeRequests/externalWork=0` 或 `legacy_settled`。已知未决任务/子记录/租约/外部操作、未知写入源及非豁免支付仍阻断；真实停写、备份恢复、候选自身干净与完整验收均不降低。只扩原首次 journal/readiness 协议，普通维护不接受风险分支；不增加队列/平台，不改业务记录。最终报告必须保留可能丢失或已有外部效果的风险，不能宣称无损。

下一步只需用户审阅原设计第 0 节书面修订；确认后沿原实施计划补对应阶段/接口/测试差异并选择原串行执行方式，不重做既有部分。按方案评审技能，书面修订未确认前不写实现计划或代码。原自动化保持 PAUSED，CLI execute 仍关闭；Task4 BASE844c2ced不变，Task4–6及大项未完成。无push/PR/合并/部署；PayPal、商户/密钥/USB、历史业务记录、UI/扩展/模型及原cache均未动。下方“风险选择尚无答复”已由本段取代，但不得把选择委托等同于已审阅本轮新文档。

文档自审已核对旧条款覆盖范围、未知值与零值区别、支付观测缺口不能豁免、候选自身状态与旧残余风险区别。`git diff --check`退出0；无新增产品测试（纯文档，无测试跳过计数）。本轮提交仅原设计与本断点，忽略的SDD ledger同步；原实现计划、执行代码和历史业务数据均无变更。

### 2026-09-28 21:30 JST 续跑：现场工作核清发现两类历史状态误报

用户先批准最小观测/排空方案评审，随后“继续”。沿原计划只读检查现状；没有批准以未知工作中断换取放行，也没有安装旧版补丁。Git起点`b650f9e0`，Task4 BASE仍为844c2ced。自动化仍暂停，不把继续核查解释为后台循环重启。

双机原主机采集器成功，私密原文位于`/private/tmp/holaday-live-host-observer-pDMZJO/`；主程序、注销worker、现用支付网关与4011旧实例仍在。files-cron当前PID0但保留每小时调度，不能当作已退休。首次采集未加载候选工作树不存在的凭据文件而认证失败（退出1），归档`...-B8yvUw/`；明确指定原主目录`.env.deploy.local`后同一只读入口成功（退出0），没有重新生成密钥或安装通道。UTC12:23:50现场只读核实Git仍为`107857fe70503e30691073f267d87275596edb20`，explorer-browse、explorer-browse-runner、planned-tasks router、planned-runner四份源码SHA与该Git原文完全一致。主/worker身份前后稳定，连接计数非零；这些均不是内存工作或外部副作用归零证明。

UTC12:22:28原`readCutoverWorkScope`在专用只读事务报告13条：10条`exploration_runs:halted_sensitive`、3条`planned_tasks:archived`。普通任务全为终态；两条scheduled active均未到期，最早UTC2026-09-29 01:07:14.024；注销请求只有cancelled、steps只有skipped。没有查询支付表、任务正文、用户资料或调用provider。核对真实源码：halted_sensitive在await浏览函数返回后持久化，浏览runner finally尝试清理上下文；archived清空nextRunAt且调度只选择active。**清理失败可能仍有残余浏览器/外部工作，因此状态分类不代替独立工作核查。**

Task4 Ruling：原只读工作分类漏识别这两个已有历史状态，最小修正仅为各自允许列表补一个精确值；不改业务记录，不豁免其他halted状态、NULL、未知状态、活动子run/item或未释放租约。误判代价是漏报真实工作，故独立内存/外部工作门槛原样保留，不能把本修正用于直接停机。原SQL夹具新增不可变历史、活动子记录和未知halt状态断言，真实Linux MySQL8服务器/本机Node24客户端先后独立RED两个状态，再完整GREEN退出0。初次QA internal网络未发布端口、连接拒绝，不能计RED；定向重建本轮临时QA为原专用bridge/回环端口后才得到断言RED。测试限1CPU/768MB、无生产挂载，最终随机库及临时容器/匿名卷/网络已清理，原MySQL/Redis未动。

UTC12:28:39修正后再次只读采集，persisted unsettled=0；前后普通任务/计划/注销状态聚合完全一致，非全字段一致或零写入证明。`/private/tmp/holaday-legacy-work-review-qEc0le/{work.json,work-after.json}`保存脱敏观察；该目录也保留临时采集脚本和测试日志。两次快照不是维护窗口报告、不能未来复用为ready。Linux证据/真实age测试144/144、0跳过退出0；完整browser首次949通过/34跳过（未设置age路径），补指定已有age后最终983/983、0跳过；日志分别`linux.log`、`browser.log`、`browser-final.log`。最终SQL夹具`mysql-final.log`退出0；两MJS Biome与diff-check通过。完整`pnpm test:ops`为120/59/16/816及Python12，退出0、0跳过，`ops-final.log`；所有本轮测试/SSH已退出。没有重跑应用全套或整分支独立审查。

剩余阻塞不是13条新任务：原site仍要求`facts.observeWork`独立证明activeRequests/externalWork/unknownWriters；旧版无该接口，数据库空集和TCP计数不能代填零。真实停写/备份恢复、非PayPal恢复演练、首次execute与整流程审查均未完成。不得再次无限加组件来替代这一前提；如改变首次停机的风险标准，必须明确向用户说明具体中断/未知结果处理并获得批准。尚未push/PR/合并/部署，execute仍关闭；PayPal、历史订单、商户/密钥/USB、UI/扩展/模型及原cache均未动。

### 2026-09-28 本轮最终断点：代码15e3ac4f，独立应用验证完成，等待范围选择

失败收尾八文件已本地提交`15e3ac4f`；原Task4 BASE844c2ced不变。完整应用验证使用内置Node24.19.0、单worker/2GB堆、显式合成DB/Redis地址：前置Node73/73；orchestrator **507文件、8599通过、1跳过**，退出0，`/tmp/holaday-hold-orchestrator-node24.log`。跳过的是`playwright-executor.cdp-auth.test.ts`的`authenticated diagnostic child`，仅在专属子进程环境启用，父用例正常调用并通过；不能把该跳过说成恢复演练通过。cn-payment **8文件99/99**退出0，`/tmp/holaday-hold-cn-full.log`；cn-payment/orchestrator类型检查及orchestrator构建均退出0，`/tmp/holaday-hold-types-build.log`。这些不替代Linux整流程、实际停写恢复、真实商户回调与整分支审查。

初次应用全套实际用了系统Node25.6.0，前置73通过后长时间未产出文件结果；只读采样后定向终止本次Vitest，退出143，保留`/tmp/holaday-hold-orchestrator-full.log`及`/tmp/holaday-hold-vitest-sample.txt`。Node24也有较长启动/收集时间，最终完整通过；**未证明Node25是原因**，首次运行不能计通过。cn-payment命令首次系统审批超时未执行，一次原样重试获准。所有测试/构建已退出，不留本轮验证进程。

已向用户提出一个必要选择，尚无答复：**是否接受先评审最小旧版观测/排空补充方案**。原因是原已批准设计明确不先改旧版本，而已核实旧版没有完整在途工作的观测接口；继续健康检查、DB空集或组件用例不能填补这个发布前提。不能据宽泛部署授权自行降低门槛、允许中断未知工作或偷偷部署旧版补丁。后续关键现场接线/完整演练依赖这项范围决定，停止在此，不继续按未解决前提扩建。

原自动化`holaday`已通过应用工具设为**PAUSED**，保留原名称/提示/周期/目标线程；暂停是等待范围确认，**不是完成上线**。恢复时先读取用户对范围的明确答复及本断点，再决定原计划最小修订，不重做本轮hold/worker/备份模块或已有商户/密钥/通道。仍无push/PR/合并/部署，CLI execute关闭；PayPal全部延期、原九笔/单笔例外不变；原`__pycache__`及无关内容保留。

### 2026-09-28 续跑：失败收尾真实状态与原日志接通

承接`d8975db4`，原Task4 BASE不变。原site.holdMaintenance现在默认使用原固定status命令，独立核对同一candidate/boot，写入持锁journal的failureObservation；允许在维护/核对期限后进行保护性只读观察，不重开入口、不重试关闭、不修改业务、不释放锁。closed/draining/blocked/serving/unknown分别保留；已落盘失败不能继续登记成功。原phase保持，记录责任引用及原核对截止时间，不保存原始错误/业务内容。

两个实际串联缺陷已先RED再修复：host忽略site独立hold结果而误保留closeAcknowledged=true；tail关闭应答丢失后外层hold再次发送close（RED观测2次而非1）。现在使用独立结果，并在同实例第一次关闭发出前记录单次尝试，不因未知应答自动重发。没有改普通升级路径或增加回滚引擎。

新鲜完整browser及两入口**983/983**、Linux六组**337/337**、原ops**120/59/16/816 + Python12**，全部退出0、0跳过，日志`/tmp/holaday-hold-{browser-final,linux-final,ops}.log`。真实既有QA镜像的runuser/socket/PM2及原文件journal验证退出0：`/tmp/holaday-hold-physical.log`；超期仍记录同boot关闭事实，锁保留，重复/继续成功拒绝。**控制状态与工作负载为明确合成，不是生产关停或完整应用恢复证明**。七MJS格式检查、shell语法、diff-check通过；未重跑应用全套/独立整分支审查。本轮全部验证结束、QA临时容器自动移除，只有原MySQL/Redis；进度文档首次审批超时明确未执行，一次原样重试获准。仅本地提交准备，未推送/PR/合并/部署，execute仍关闭。

只读拓展检查旧Git `107857fe...`：`/trpc/health`也只有status/time；browserPool.stats虽有注释声称供health/ops，但没有实际路由调用；TaskQueue inFlight、batch executor inFlight均为内部变量。因此旧版内存工作不能由两个health或DB空集证明。不是新的服务器故障，也不能靠继续增加组件测试解决；须在原审批范围内找到真实独立工作依据，若必须改变旧版观测/允许中断，则先明确方案范围，不能默认填零。

仍待原独立旧源DB归属/内存请求/browser/provider/writer事实、reconcile实际闭环、受保护工具安装与首次execute、真实停写备份/Mac恢复及非PayPal恢复证据、整流程故障矩阵/整分支审查。PayPal/历史订单/商户/密钥/USB/UI/扩展不动，原cache保留。普通模块通过不是整项完成。

### 2026-09-28 续跑：同实例 worker 恢复与原启动清单双文件持久化接通

承接`80545eb6`，Task4原BASE844c2ced不变。原site.lifecycle.resumeWorker已有默认真实适配：在受保护配置、同一verified journal/候选boot、真实主进程和双机旧源观察器约束下，只启动配置启用的UID998 worker一次，使用原运行时读者与原日志权限脚本；不使用全局PM2 save、不重启或删除无关应用，启动应答未知不重试。

持久化复用原`removeSavedStartupEntries`的双文件编辑器，不另建保存引擎：分别保留primary/fallback的无关原始对象（包括超出JS安全整数的原文），追加实际同实例PM2配置；只按PM2现有序列化去除instances/pm_id/prev_restart_delay。独立candidate-startup私密备份、原journal六步意图/完成事件绑定候选boot，备用文件先写；不存在的备用文件只创建0600、root:root新文件，不复制另一份的无关条目。未完成双文件事件不能登记opened。重复/文件篡改/不安全元数据保持拒绝。

原retirement观察器已衔接完整candidate-startup链与旧retirement摘要，并检查新内容真实哈希、属主/权限/链接/metadata；只解释这两份文件的合法改变，原review与实际source摘要仍保留。先观察合法保存被旧观察器拒绝RED，再修此接线；partial、字节/权限/属主/链接篡改、另一台机器变化仍拒绝。host新增直接import的startup模块已加入原固定工具闭包及通道模块列表，仅本地源码，未重新安装生产通道。

新鲜验收：完整browser+两发布入口**978/978**；实际Linux六组**332/332**；原ops**120/59/16/811 + Python12**，全部退出0、0跳过。日志`/tmp/holaday-worker-{browser-final,linux,ops}.log`。13MJS Biome、shell语法与diff-check通过。已有task3镜像真实PM2/proc/runuser/socket、原journal/文件I/O两种组合均退出0：`/tmp/holaday-worker-physical-final.log`（worker开、两文件原有）、`/tmp/holaday-worker-disabled-physical.log`（worker关、备用缺失），主进程/无关PID与重启数不变、独立原文保留、重复拒绝。**工作负载/候选控制协议、旧源双机事实与早期备份回执为合成夹具，不是生产或完整应用恢复/发布证明**。本轮未重跑依赖Git安装的固定入口物理夹具；当前工具闭包由默认模块加载和原coordinator契约测试覆盖，不能把上一提交物理入口日志冒充本次。

保留失败证据：初次全量Mac978项957通过21失败，均sandbox Unix socket EPERM（`/tmp/holaday-worker-browser.log`）；获准按原代码重跑后全过，未改产品权限。首次格式化sandbox拒绝无改动，获准后完成格式化；四处noDelete改为无副作用过滤/测试undefined，未放宽保护。测试命令均结束；临时QA容器自动回收，只含可再生成合成数据；最终docker只有原MySQL/Redis。原cache/草稿、数据库/Redis、支付/PayPal/商户配置/密钥/USB/UI/扩展均未动。

未push/PR/合并/部署；CLI execute仍关闭，Task4–6未完成。下一步**不要重做worker/备份/通道/商户**：继续原独立旧源DB归属、内存请求/浏览器/provider和writer事实，开放后reconcile与失败hold的实际适配、受保护工具安装和首次execute，再做真实停写备份/Mac隔离恢复、非PayPal恢复证据、完整成功/故障演练、整分支审查。后续进展以Git和ledger为准，自动化继续本线程。

### 2026-09-28 续跑：原备份协调器完整site I/O、回执与关闭时序接通

承接`00c71983`，原Task4 BASE844c2ced不变。原site.backup已接入源身份/设施、实际单次导出、原密文摘要和字节数固定、同一Mac恢复会话restore/snapshot/migrate/verify、原全对象比较器、源不变检查与原journal sealReceipt。新增源全量快照读者复用原受保护配置/专用连接，前后核查源身份、原journal和实际停写，不采样、不接收上传摘要。原工具闭包增加该mysql读者，仅本地代码，未重新安装生产通道。

完整协调器+真实文件journal测试先发现合法bindBackupReceipt改变recordDigest，导致最后恢复身份检查拒绝。保留原最后检查，只给backup_verified阶段恢复会话提供排除自有backupReceipt的scope投影；全文件字节/inode/属主核验仍保留，默认读者仍是完整摘要，外部回执篡改和阶段漂移均拒绝。原host在生产migration_started之前等待finishRecovery最终应答，关闭未知保持不确定，不重试恢复/迁移。源/目标/密文字节漂移、迁移回执错误、业务变化、关闭未知的串联故障用例通过；外部DB/crypto/transport在此契约测试仍为合成边界。

真实MySQL8中，正式源快照适配→实际mysqldump/age/原取回/恢复→原完整对象/数据比较及源快照前后不变通过：`/tmp/holaday-source-snapshot-physical.log`退出0。源/恢复在同一临时实例两个合成库，不能替代独立Mac目标或生产停写；独立目标/原61迁移实测见上一恢复点。当前没有完成生产源到Mac的正式全流程演练。

最终完整browser含两发布入口**965/965**、实际Linux五组**194/194**、ops**120/59/16/799 + Python12**，全部退出0、0跳过。日志`/tmp/holaday-backup-composition-{browser,linux-final,ops}.log`。12MJS Biome、shell语法及diff-check通过。原固定入口/proc/候选Git字节闭包实测退出0：`/tmp/holaday-backup-composition-entry-linux-verified.log`，仍拒绝execute、releaseReady=false。未跑应用全套或整分支独立审查。

保留失败证据：Linux初次194项15失败（14缺策略只读挂载、1临时目录noexec），补QA挂载后全过，未改产品；入口前两次既有镜像均无Git、尚未到被测步骤，查历史确认以前在一次性容器临时安装Git，复用既有镜像按同样方式安装后断网测试通过，未重建镜像。新增故障测试最初错误期待失败site仍能成功detach，修正测试为保留关闭未知，未放宽产品。临时源MySQL容器a1625008及匿名卷已回收；固定入口容器4f0c14cb亦定向回收，只含可再生成合成数据。原MySQL/Redis、缓存、私钥/USB、PayPal与历史业务不动。

没有push/PR/merge/部署。下一步勿再拆写备份模块：继续剩余独立旧源DB归属/在途工作/writer事实、worker定向持久恢复、reconcile/hold，受保护工具安装与首次execute；再做真实停写备份/Mac恢复、非PayPal恢复证据、完整成功/故障演练与整分支审查。Tasks4–6尚未完成，自动化继续同线程。

### 2026-09-28 续跑：同一恢复会话接通原全量快照、61迁移与业务校验

承接`05fb4206`，Task4原BASE844c2ced不变。不是新建迁移/备份引擎：恢复worker复用`readCutoverMysqlSnapshot`、原`checkMaintenanceSchema`与原`apply-numbered-migrations.ts`独立ESM包及全部61原SQL。固定无dotenv工具副本`/opt/holaday-recovery`绑定Node/入口/全部文件摘要与原迁移manifest；元数据`runtime:{manifestDigest,nodeDigest,toolDigest}`随原Mac清单摘要批准，不放inventory、不生成批准。已有Linux Node22.20.0已实际在纯MySQL8镜像执行通过，无新依赖安装或镜像重建。

原recovery-session增加snapshot/migrate/verify，只有恢复完成后可取快照、仅快照后可单次迁移、再以原列投影核对业务；缺工具批准、错序、重复、迁移失败、业务漂移会终止会话。默认Mac调用器在原scope回调及实际目标检查前后核验固定Node/入口/manifest，`env -i`固定参数，只连接目标内socket，无任意SQL/命令入口。原runner启动前排他落盘并同步migration-started标记；失败/未知不重试、不强杀后重跑，不输出原SQL诊断或生成backup成功回执。

实际新目标的同一子进程管道+原文件journal+age认证fd恢复→原全量快照→61迁移→原schema/历史列业务摘要通过，`/tmp/holaday-recovery-session-all61.log`退出0。仍是合成数据、源SSH与物理停写事实合成，**不是Vultr生产停写备份/完整源库恢复比较/发布通过**。先前独立阶段同样通过，日志`/tmp/holaday-recovery-runtime-physical-final.log`；初次`physical.log`退出1因Docker cp保留MacUID501，摘要一致且迁移标记不存在，仅修正专属QA工具属主后继续首次迁移，未重试未知SQL。QA builder只是夹具，不是正式安装入口。

TDD缺失runtime/worker/入口/快照/会话操作RED→GREEN；空库快照夹具初次被原比较器拒绝，改为真实契约要求的非空对象清单，未放宽比较器。最终Mac新增两组33/33；实际Linux四组**82/82**、完整browser及两发布入口**960/960**、ops**120/59/16/794 + Python12**，全部退出0、0跳过。日志`/tmp/holaday-recovery-runtime-{linux,browser,ops}.log`。九MJS Biome、shell语法与diff-check通过；未跑应用全套或声称整分支独立审查。几次自动审批超时均明确未执行、只重试一次后获准，未绕过权限。

本轮两个合成QA目标attempt`0af41bb2-987e-4901-b9c0-8a2291e5ccf5`和`5e299e59-666d-44ab-8d7a-fcda9ca9e412`及各自专用卷已精确清理，早期兼容性探针亦已清理；原MySQL/Redis、scripts/__pycache__、真实密钥/USB/PayPal/订单不动。没有push/PR/merge/部署，CLI execute继续关闭。

下一步直接补原backup完整I/O，不重做恢复端：在原`withApprovedCutoverDatabase`/source配置和journal/物理stopped检查下读源全量快照，使用原`compareCutoverMysqlSnapshots`对照会话snapshot；把源identity/facility/hash、会话restore/migrate/verify、源不变检查接入原`backupAndRestoreCheck`与原journal sealReceipt。仍需受保护工具闭包/安装及首次入口、独立旧源工作/数据库归属事实、worker定向持久化、reconcile/hold、真实恢复与非PayPal证据、完整成功/故障演练及整分支审查。Tasks4–6尚未完成，自动化继续原范围。

### 2026-09-28 续跑：原协调器管道上的Mac恢复会话与真实子进程演练

承接 `724cd827`，Task4原BASE844c2ced不变。新增恢复会话端点复用原 `createFirstCutoverSessionWire`，没有新增SSH引擎、反向登录或第二协调器：Mac父进程消费原协调器SSH的stdout/stdin，Linux端使用同一连接。固定attach/inspect/restore/detach与单次restore；每次导入内部scope检查沿连接回原协调器。原site新增 `recovery.assertScope(publicScope)`，核验同一原journal、受保护执行清单、backup_verified阶段、不变effects记录与实际停写观察器；并非Mac上传stopped布尔值。

Mac元数据0700目录/0600当前用户单链接文件与预先批准摘要绑定；私钥及identityFile路径不上传。**摘要放在原execution.site.backupRecoveryDigest，不能放inventory**：元数据本身含binding.inventoryDigest，内嵌会造成循环摘要。原无此字段的scope仍能读，但不能授权恢复。程序只读批准，不自动造清单。

先观察七个缺失接口RED，site回调及受保护scope外部摘要绑定RED后GREEN。真实子进程演练发现detach结束回执与最后异步journal核验的EOF竞态，保留现场只读检查确认合成数据已导入（行/trigger/event各1），不重试原SQL；新增可靠RED，补detached确认握手后用全新目标验收通过。`/tmp/holaday-recovery-session-physical.log` 为失败证据，`/tmp/holaday-recovery-session-physical-final.log` 退出0：真实子进程管道、原文件journal、默认禁网Docker目标检查、age认证fd导入、UTF8/BLOB/NULL/trigger/event和重复拒绝均通过。源SSH及物理停写事实在此夹具仍合成，**不是Vultr/Mac真实跨机全流程或生产恢复证明**。

新鲜验证：Mac三组 **67/67**、实际Linux同组 **67/67**；完整browser含两个发布入口 **934/934**；ops **120/59/16/768 + Python12**，全部退出0、0跳过。日志 `/tmp/holaday-recovery-session-{binding,linux,browser,ops}.log`。七MJS Biome、shell语法、diff-check通过。最初测试监听器提前消费管道导致握手丢失，修正夹具tap并精确停止仅本轮测试PID32910/32913；该中断不计通过。QA卷删除曾因--rm异步移除未结束被拒绝，Linux当时未启动；只读确认容器消失/卷无引用后完成清理和验证，非未知SQL重试。

两个目标attempt `397a8c88-3216-4a41-b941-3a8c1aa0413c`（结束握手失败）及 `84026b17-422c-4c8b-b4bc-75fb1a4f3d96`（通过）的专用容器/卷均已移除，只含可再生成合成数据；原MySQL/Redis、缓存、私钥/USB/支付与历史业务不动。全部验证进程结束。没有push、PR、merge或部署，CLI execute继续关闭。

下一步不要重写恢复端点：将该会话接入原backup完整I/O及首次入口（实际工具闭包/受保护元数据安装仍未做），复用原 `readCutoverMysqlSnapshot/compareCutoverMysqlSnapshots`、全部61SQL原runner、schema/业务对比和journal回执。现有纯MySQL目标没有Node工具，须明确批准的隔离执行工具/副本；runner会主动读dotenv，所以隔离副本不得含 `.env*`，不能仅清环境变量。继续原独立工作/写入事实、定向worker持久化、reconcile/hold及完整成功/故障演练/整分支审查；Tasks4–6尚未完成。

### 2026-09-28 同轮接线复核：原备份协调器与site导出契约修正

Mac恢复端七文件已提交 `4bf74aeab23836da0557583b7d4d8c053e71ea72`。继续串联时发现上一轮site导出接口接收了错误的参数形状：原 `backupAndRestoreCheck` 实际传 `{binding,facility}`，site却比较整份backupPlan与维护截止时间，因此单独测试通过但原协调器接入会拒绝。

新增测试直接把真实 `site.backup.exportDatabase` 交给原备份协调器及真实文件journal，先观察 `CUTOVER_BACKUP_UNPROVEN` RED，再只修site契约；保留同一次attempt/物理停写/源身份约束，并在导出前后检查批准加密设施与返回密文profile一致。没有放松原协调器或重写备份流程。数据库/恢复/迁移在这条契约测试中明确为合成边界，不据此宣称真实完整恢复。测试最初误用effects投影读取receipt，已改为核对原journal文件；未改产品journal行为。

新鲜结果：site **41/41**；实际Linux site/host **105/105**；browser与首次入口 **919/919**；ops **120/59/16/760 + Python12**（含普通入口7项），全部退出0、0跳过。日志 `/tmp/holaday-source-contract-{green,linux,browser-final,ops}.log`。第一轮browser遗漏age环境配置有33项跳过，不计验收；随后配置 `/opt/homebrew/bin/age` 重跑通过。两MJS Biome、syntax、diff-check通过。

仍停留Task4–6实施，下一步及发布阻塞与下节一致：跨Mac/Vultr受保护恢复会话、原全量比较/61迁移及真实工作归属与完整演练尚缺。没有推送、PR、合并或部署；执行入口继续关闭，原缓存保留。下方历史925项是上一代码快照的组合验收，不覆盖本次修复。

### 2026-09-28 续跑：Mac恢复端真实隔离目标检查与固定fd导入

承接 `92898dd1`，Task4原BASE844c2ced不变。原backup模块已接入实际Docker目标检查：完整容器/镜像ID、同attempt标签、独占本地卷、无网络/端口/host绑定/特权/设备、资源上限及真实MySQL身份；首次导入要求空库、无其他业务库/连接且事件关闭。原age解密只在完整认证、私有文件发布及inode检查后提供只读fd；固定mysql socket命令单次消费该fd，前后复核目标与调用方scope。失败不自动重试SQL或删除目标。

`restoreFirstCutoverAgeBackup` 复用原pull/decrypt，仅返回目标身份，必须提供真实 `assertScope`，不生成恢复通过回执。Mac/Vultr同一协调器会话绑定、受保护恢复清单、原全量snapshot比较、全部61项迁移及原journal回执仍未接通，不能用fixture的合成scope上线。

新鲜验证：完整browser **925/925**；实际Linux age/backup **62/62**；ops **120/59/16/759 + Python12**，全部退出0、0跳过。日志 `/tmp/holaday-recovery-browser.log`、`/tmp/holaday-recovery-linux.log`、`/tmp/holaday-recovery-ops.log`。五MJS Biome、diff-check通过。实际Mac无网络MySQL8目标完成原age→传输→认证fd导入，验证UTF8/BLOB/NULL/trigger/event及重复导入拒绝，日志 `/tmp/holaday-recovery-target-physical.log` 退出0；源SSH与scope在该fixture仍是明确合成边界，不是生产/完整迁移恢复证明。

专用QA容器和带本次attempt标签的卷已精确移除（仅可再生成合成数据）；最终docker仅原mysql/redis，所有验证进程结束，原 `scripts/__pycache__/` 保留。未触碰生产、真实私钥、PayPal或历史订单。未push/PR/merge/deploy；Task4–6未完成，execute保持关闭。

下一步：沿原计划连接受保护Mac元数据与同一Vultr协调器scope，再复用原snapshot比较、61迁移/业务比较与journal回执；继续独立旧源在途/写入事实、定向worker持久化、reconcile/hold、首次入口和完整故障演练/整分支审查。不重做导出、加密、目标fd导入、通道、密钥或商户核查。

### 2026-09-28 续跑：实际 mysqldump 导出接入原 age / host / site

承接 `2a8ca2d3`；Task4原BASE844c2ced不变。`site.backup.exportDatabase` 已连接原host/source计划与同一受保护配置，原age适配新增实际mysqldump生产者。批准清单增加 `backupSource: {facility,directory,executable,executableDigest}`；只在原backup_verified意图、同一journal/源身份/绝对窗口与物理stopped条件下执行一次。固定完整数据及routine/event/trigger导出，等待stdout与进程退出双成功后，再核验源库/配置/停写才发布密文；无重试、无生产明文备份、无提前恢复回执。不是另建加密、密钥、传输或发布框架。

凭据仅写入先排他创建、立即取消目录链接的空0600描述符，再继承给本次dump；不放argv/env/诊断，不留命名凭据文件，不声称内存专用或管理员不可读。使用原恢复公钥；不支持的URL选项（含尚未接通的TLS参数）或控制字符直接拒绝，不降级忽略。只有本地代码，尚未安装生产工具/清单或导出生产库。

新鲜验证：host/site **104/104**；完整browser **922/922**；实际Linux四组 **163/163**；ops **120/59/16/756 + Python12**，全部退出0、0跳过。日志 `/tmp/holaday-source-{site-green,browser,linux,ops}.log`；八MJS Biome与diff-check通过。五个age生产者、host绑定、两个site接线测试均观察缺失方法RED后GREEN；覆盖晚退出失败、摘要不符、源/配置/journal漂移、忙碌及禁止重试。没有重跑应用全套或声称整分支审查通过。

真实MySQL8.0.46测试运行正式source适配与真实mysqldump、age、原密文读写/解密，再导入同一隔离实例的另一个QA库；特殊字符密码、中文、BLOB、NULL和例程/事件/触发器名称清单通过，源行不变：`/tmp/holaday-source-mysql-final2.log`退出0。夹具为 `scripts/fixtures/browser-source-backup-mysql.mjs`；target UUID、journal/stopped前置和配置路径投影仍合成，SSH换为运行原读取器的独立子进程；**不是Mac目标隔离、全61迁移或生产停写恢复证明**。沿用既有QA镜像，无新安装/镜像重建/宿主PID/生产凭据挂载。

QA修正记录：只读目录内嵌套挂载在容器启动前失败，核实无遗留后修正；合成账号localhost与实际127.0.0.1不符、启用binlog时低权限账号不能建trigger，均在测试夹具修正（既有QA管理员以该用户DEFINER建对象，不增加账号SUPER或改全局设置）。本地pnpm未暴露esbuild，直接使用现有0.25.12可执行文件打包QA依赖，无依赖安装。两次自动审批超时均明确未执行后只重试一次，未绕过权限。测试容器68c94bc4（e9784b15309ca621）在随机库/账号finally清理后停止并--rm移除其合成卷；原MySQL/Redis与原缓存不动。

**下一步：** 源导出已接上，勿再重做。继续原 `backupAndRestoreCheck` 的实际Mac目标身份/隔离、取回与恢复、原全对象比较器和全部迁移、回执现场I/O，以及原worker定向持久启动/reconcile/hold和工具安装/execute。旧来源DB归属及内存请求/浏览器/provider/writer独立事实仍须真实解决，不能以SQL空或healthz代替。生产协调器运行在Vultr，Mac恢复不能假设远端直接访问Mac文件；必须在原执行链中明确实际恢复端的调用与返回验证，不能手填restored或搬私钥到服务器。完整成功/失败演练与整分支审查仍未完成。

Task4–6未完成，CLI execute继续关闭；没有push/PR/merge/部署，无PayPal/历史业务/支付权益/生产配置/密钥/UI/扩展变更。原 `scripts/__pycache__/` 保留；当前heartbeat继续同线程，不暂停自动化或创建重复任务。

### 2026-09-28 续跑：备份计划连接实际源库身份与原 stopped 观察

承接 `5b2fb301`。原 site 的 `readBackupPlan` 现在有默认现场读者，不再必须由外部回调手填返回值。复用现有受保护 `inventory.backupPlan: {sourceIdentity,isolatedTarget}` 与原专用数据库连接，核对完整清单/候选配置摘要、同一 journal 的 `backup_verified` 意图阶段，两次实际读取源库 `@@server_uuid/DATABASE()`；源库不符、阶段漂移、查询或连接关闭失败均拒绝。site 调用前后独立执行原物理 stopped 检查，未生成备份回执、未提前证明恢复成功。按已定 Mac 恢复路径拒绝源库与目标共用 serverUuid；目标仍是待独立核验的批准身份，不把 metadata 当隔离证明。

缺失host方法、缺失site默认接线两项RED→GREEN；host/site **101/101**，完整browser **914/914**，Linux四组 **148/148**，ops **120/59/16/748 + Python12**，均退出0、0跳过。日志 `/tmp/holaday-backup-{plan-red,site-red,site-green,plan-linux,plan-browser,plan-ops}.log`。真实MySQL8.0合成库验证源身份匹配、错误批准源拒绝及数据不变，退出0：`/tmp/holaday-backup-plan-mysql.log`；沿用原十二表/支付只读夹具，不查询商户或动生产数据。临时容器 `holaday-first-cutover-qa-a645c19e052fb381` 与合成匿名卷已移除，原MySQL/Redis不动。一次ops启动时上一browser会话尚未交付退出结果；随后进程核验browser已结束，仅ops运行，不再启动并发重型任务。不是应用全套、真实源库备份或目标恢复/迁移验收。

**下一步仍为原闭环，不重做已完成读者：** 备份设施及实际导出→Mac隔离恢复的现场I/O、原 worker 定向持久启动/reconcile/hold、工具安装和首次execute；在此前继续解决独立旧来源DB归属、在途请求/浏览器/provider及writer观测。只读核对旧Git `107857fe...` 的 `TaskQueue` 接口仅有enqueue/signalSlotFreed/size/snapshot/stop，`inFlight`是闭包内变量、snapshot仅排队项；`http.ts` 的 `/healthz` 仅status/env/time/executor。这些接口不能直接作为全部内存工作已空的证据，不能填默认零值或用新候选协议冒充旧实例。未改旧运行程序、未增加调试端口或发送进程信号。

Task4原BASE844c2ced不变；Task4–6未完成，CLI execute仍关闭。PayPal/历史订单/商户核查/恢复密钥/只读通道/UI/浏览器产品代码均未动；没有push/PR/merge/部署。保留原 `scripts/__pycache__/`。

### 2026-09-28 续跑：原签名查单器接入同一阿里云 gateway 会话

承接 `76ea3b23`，Task4 BASE844c2ced不变。本轮补上 site 的第五个 readiness 回调 `queryOrders`，经原 gateway 会话调用既有 `apps/cn-payment/scripts/payment-cutover-query.ts`。同一 journal/审批/清单/绝对窗口，prepare 与 preopen 不改变原时序；客户端只响应 ownership/effects，只收七字段脱敏观察。请求先核对整批 SQL 选中行，PayPal/重复/商户环境冲突/行摘要变化在任何商户请求前拒绝。业务原文与凭据不回 Mac，不修改订单、回调或权益。

新增 `browser-first-cutover-payments.mjs` 是该原查询器的固定现场适配，不是新支付实现。原阿里云 release 的 `.env`、微信证书/私钥/验证公钥路径及摘要由受保护 gateway metadata 固定；清单完整 JSON 摘要与同一 inventoryDigest 绑定。固定全依赖 CJS 包 `/var/lib/holaday-deploy/channel/payment-cutover-query.cjs` root/0600，由批准摘要锁定；签名响应只在原主机 root/0700 私密目录中排他创建、fsync、回读核验，即使后续不确定也保留，不自动重试。gateway 精确模块闭包增加此适配；独立查询包不放入该模块目录。旧 scope 无支付 metadata 时仍可做原退役，但不能通过查单。

先观察缺失方法 RED，再完成站点/gateway/原查询器组合。独立打包后新增合成签名测试失败，实测 external 包10,561字节、全依赖包2,452,516字节，确认为共用1MiB读取上限所致；仅固定摘要锁定的查询包上限改8MiB，配置/凭据仍1MiB，补超限拒绝测试。支付宝/微信都运行原 SDK 签名与验签，微信证书由临时合成测试密钥生成，不是重新生成生产或恢复密钥。保留失败日志 `/tmp/holaday-query-providers.log`，修正后通过。测试现直接用默认程序包加载器，不替换查询器。

本轮没有实际商户调用、生产安装、服务修改、数据库写入、真实备份恢复或部署。真实配置/程序包尚未安装。PayPal及精确十笔延期不动，历史商户核查/私钥保管/只读通道不重做，原 `scripts/__pycache__/` 保留。

本轮验证：browser **912/912、0跳过、退出0**（`/tmp/holaday-query-browser.log`）；ops前三组 **120/59/16** 与Python **12** 通过，初次末段因未传 `CUTOVER_TEST_AGE_EXECUTABLE` 跳过27项，保留 `/tmp/holaday-query-ops.log`，只补跑原末段后 **746/746、0跳过、退出0**（`/tmp/holaday-query-ops-gate-final.log`）。默认查询包加载器的最终隔离Linux五组 **150/150、0跳过、退出0**（`/tmp/holaday-query-linux-final.log`），容器禁网/UID998/768MiB/单CPU，无生产凭据或宿主PID；文件路径和属主投影仍是测试夹具，不冒充真实安装。原 SDK 查询器 **41/41、退出0**（`/tmp/holaday-query-original-sdk.log`）。真实受限sshd/ssh两角色/默认身份/审批篡改拒绝 **退出0**（`/tmp/holaday-query-ssh.log`）；SSH段验证实际通道与模块加载，不是跨生产网络商户调用。八MJS Biome、两shell语法与diff-check通过。未重跑应用全套、实际MySQL恢复、nginx整链或整分支独立审查。

**仍需继续原Task4–6：** 独立真实旧来源/数据库归属、内存请求/浏览器/provider工作及连接/writer读者；原 backup 设施/source/target现场配置、定向 worker 持久启动、reconcile/hold；工具准备安装与首次execute；真实停写备份→Mac隔离恢复→非PayPal恢复证据，完整成功/故障演练及整分支审查。当前CLI `--execute`仍拒绝，不能把本轮查单接线或组件数量当发布完成。不要重建原 site、查询 SDK、通道或密钥，也不要用DB空集/健康状态冒充所有内存工作为零。

### 2026-09-28 同轮继续：原数据库支付核对接入同一现场与专用连接

上一批已提交 `32c5f8c8`，未push。继续原Task4，site新增 `readDatabaseScope`，默认调用 `readFirstCutoverPaymentScope`，复用原 `readCutoverDatabaseScope`、十二表查询与既有受保护候选配置/专用连接 guard。prepare/preopen都使用原journal、原绝对窗口和原scope，不提前登记verified。清单必须有摘要绑定的 `paymentWindowStartMs`；原商户列表每个非PayPal provider只能有一个明确映射，缺失、多义、行内环境冲突拒绝。此映射不是历史商户归属证据；真实签名查单仍独立必需。唯一PayPal及九笔支付宝延期对象原样传入原指纹逻辑，额外PayPal拒绝，不查询其API。

专用mysql2连接固定UTC参数，保留时间/大数/JSON原文，只读一致性快照后ROLLBACK并关闭；错误不输出连接或订单细节。复用原SQL夹具验证实际MySQL8.0下的UTC窗口选取（宿主TZ=Asia/Tokyo）、精确毫秒/JSON、原记录不变及环境冲突拒绝；夹具是随机合成库，无商户调用/生产凭据，不是实际恢复演练。临时容器与其匿名卷已清理，原MySQL/Redis未动。`/tmp/holaday-payment-site-mysql-final.log`退出0，十二工作表实际SQL回归同样通过。

两个缺失方法RED→GREEN，另补原十笔延期/额外记录回归；相关三组 **207/207**，browser **892/892**，ops **120/59/16/726及Python12**，均0跳过、退出0。日志 `/tmp/holaday-payment-site-{red,green,browser,ops}.log`。六MJS Biome、两shell语法、diff-check通过。整host组合中的DB/备份/另一主机仍是显式合成边界；本轮只对新增SQL连接补实际MySQL验证，未重跑应用全套、全量迁移恢复或整分支审查。

最终源码另在实际隔离Linux UID998通过 **207/207，0跳过、退出0**，日志 `/tmp/holaday-payment-site-linux-final.log`。所有测试会话结束。

下一步从**原 `queryPaymentOrder` 的真实凭据/历史商户归属/私密原文保留绑定及独立work/writer事实**继续，不重做四个已接通readiness读者或已完成商户历史查询。仍需backup设施/source/target、worker定向持久启动、reconcile/hold、工具安装/execute、实际停写备份及Mac隔离恢复/非PayPal恢复、完整成功故障矩阵和整分支审查。原Task4BASE844c2ced不变，Tasks4–6仍未完成，execute仍关闭，无PR/合并/部署或生产业务变更；原cache与自动化保留。

### 2026-09-28 续跑：原 readiness 主机清单与受保护恢复证据接入现场

承接 `01e32ba6`，Task4 原 BASE844c2ced不变。现有 execution site 的 `readHostInventory`、`readFenceState`、`readRehearsalArtifacts` 已一同接入原 host/collector。清单只接受原批准 inventoryDigest 对应的完整 metadata；实际旧生产者由原双机 observer 以 host/pid/start/role 精确映射，并夹读独立业务事实，拒绝 PID 复用、未知来源、忙碌、陈旧、窗口或 journal 漂移。preopen 使用 start 返回身份，仍只由原 verify 后写 verified，不提前登记成功。

恢复证据直接复用原 root 私密文件读取器，绑定同一 candidate/config/inventory 与原商户集合，不调用支付方、不生成“已恢复”标记。collector 继续验证恢复覆盖及 reconcileBy。受保护 execution scope 允许携带原批准 inventory；兼容旧五字段 scope 仅用于原有退役路径，缺 inventory 时新 readiness 明确拒绝，不能生成新清单来重置批准。

新增十二项 RED→GREEN；相关 site/host/ingress 回归 **114/114**，实际隔离 Linux UID998 五组 **368/368**，均0跳过、退出0。原物理夹具新增默认受保护 scope/恢复文件与真实进程观察的消费，成功及真实删除丢ACK两模式退出0，原 PM2/pidfd/journal/无关进程与启动条目保持；**商户 metadata/业务/另一逻辑主机仍为合成，不是支付恢复或完整生产演练**。日志 `/tmp/holaday-inventory-{site-green,linux-final,site-physical,site-lost-ack}.log`。最终 browser **889/889**、ops **120/59/16/723及Python12**，0跳过、退出0，日志 `/tmp/holaday-inventory-{browser-final,ops-final}.log`。六MJS Biome、两shell语法和diff-check通过；未重跑应用全套/实际MySQL恢复/nginx整链/整分支审查。

剩余按原 Task4–6：独立旧来源与DB归属、内存请求/browser/provider和writer事实；原 DB/payment readiness 读者接入；真实备份设施/source/隔离target；worker定向持久启动、reconcile/hold；工具安装及首次execute；真实停写备份/Mac隔离恢复/非PayPal恢复、完整成功故障演练和整分支审查。新三个读者只是接线，不替代这些现场事实。execute仍关闭、未push/PR/合并/部署，PayPal/支付记录/密钥/UI/扩展未动，原cache保留，自动化继续。

### 2026-09-28 续跑：候选启动后的 readiness 与恢复入口身份接线

承接 `433948f3`，Task4 原 BASE844c2ced不变。原 execution site 现提供 `evidence.readFenceState(scope)`，直接给已有 host/collector 使用。prepare 只返回原受审基线的实际观察，不假装已停写；preopen 使用 host 从 start 得到的真实 identity，进入已有 `observer.readWithCandidate`，核对关闭、idle、无 worker、无旧进程/管理注册/监听者，并保留独立业务事实与两侧十二表读取。`candidate_started` 的 journal 此时仍无 identity；测试确认只在 verify 后由原 tail 写入 verified，不添加状态机或提前成功记录。

入口恢复不再依赖尚未实现的 `facts.verifyOpenedIdentity`，而使用现有默认 `readFirstCutoverCandidateRuntime`（真实 control/status → runtime → status）及同一双机 observer。必须为 journal 中已验证的同一 candidate/boot、serving、needsReconciliation=true、idle=false，且旧运行时未回生才交给原 ingress 恢复。失败仍由原 host/tail 精确关闭、保留 journal，不重试开放或恢复。scope 绑定完整原窗口/责任人，观察期间 journal 必须不变。SQL时间也纳入最老证据时间，不用空SQL推断内存工作。

新增十项站点回归先看到缺失 evidence 接口 RED，后 GREEN。另有三项 **真实 host + collector + journal + tail + site 的合成集成**（成功、候选观察失败、开放后观察失败），外部主机/业务DB/备份仍合成，不冒充完整现场演练。实际隔离 Linux 四组 **262/262、0跳过、退出0**：`/tmp/holaday-candidate-linux.log`。原实际 PM2/受保护文件/journal/pidfd 退役成功及丢ACK均退出0：`/tmp/holaday-candidate-site-{physical,lost-ack}.log`。原默认候选读者的真实 runuser/UID998/PM2/proc/4001+4002/socket、错误身份、状态翻转、孤儿进程拒绝与无关PID保持也退出0：`/tmp/holaday-candidate-control-physical.log`；候选协议为合成，不是完整应用。三MJS Biome、两个shell语法、diff-check通过。

完整 browser 首轮因沙箱禁止临时 Unix socket 返回 EPERM，退出1，保留 `/tmp/holaday-candidate-browser-final.log`；按权限流程获准重跑，不改代码门槛。最终 browser **877/877**、ops **120/59/16/711 + Python12**，均退出0、0跳过，分别为 `/tmp/holaday-candidate-browser-approved.log`、`/tmp/holaday-candidate-ops-final.log`。所有测试已退出；隔离容器受限内存/CPU、无hostPID/生产凭据，均自动清理，运行列表仅原 holaday-mysql/mysql8.4 和 holaday-redis/redis7.4。未重跑应用全套、真实MySQL恢复、nginx全链或整分支审查，不沿用历史结果冒充本轮门槛。

下一步是**剩余真实 site 事实与原首次 execute 的闭环**，不是重做候选观测或再加控制框架：实际旧来源/DB归属、在途请求/浏览器/provider及连接/writer；readiness完整host inventory/商户metadata、backup设施/source/target；恢复worker/持久启动和reconcile/hold；工具安装及execute；真实停写备份/Mac隔离恢复/非PayPal恢复，完整成功故障矩阵及整分支审查。只读旧 Git 源码 `107857fe70503e30691073f267d87275596edb20` 确认 `/healthz` 只有健康/env/time/executor，不能当在途工作证据；原 TaskQueue 的 inFlight 是内存计数。现有普通 host 的 `resumeWorker` 含全局 `pm2 save --force`，首次共享主机不能原样复制，需要沿原定向启动条目机制保持无关应用。以上仅定位待接线点，未改旧生产程序或引入新功能。Task4–6仍未完成、execute仍拒绝；未push/PR/合并/部署，支付/PayPal/密钥/UI/扩展不动，原`__pycache__`保留，自动化继续本线程。

### 2026-09-28 续跑：真实数据库工作观察接入原现场边界

承接 `1454c352`，原Task4 BASE844c2ced不变。本轮沿旧版Git对象 `107857fe70503e30691073f267d87275596edb20` 核对已存在的探索、视频渲染、注销工作表及计划派发状态，不改这些产品功能。发现原readiness数据库查询只看四类工作表，而且 `planned_task_runs` 的真实 `dispatching` 状态被漏掉；真实MySQL反例返回空数组，日志 `/tmp/holaday-work-dispatch-red.log`。

现有 `browser-cutover-evidence.mjs` 内共用十二表只读查询：普通任务、旧调度、计划运行、批量、独立探索、视频渲染attempt/version、注销request/step、计划/批量子项及计划父项。按实际终态/静止态排除，派发中、未知状态、未清租约（即使过期）保留为未解决；不自动过期、取消或清洗历史行。NULL、缺表、达到100行上限、非法ID/状态、读时钟倒退/超60秒或回滚失败均拒绝。支付readiness复用同一查询及原单次只读事务；原精确一笔/九笔延期和商户逻辑不变。

`readFirstCutoverPersistedWork` 复用原受保护候选配置、候选目录与持有的journal，校验配置摘要/窗口/归属前后不变，使用候选mysql2新建独立连接，read-only repeatable-read后ROLLBACK并关闭，错误不泄漏数据库细节。不调用商户/provider、不自动加载其他.env。原execution site默认使用这个实际读者，在入口/进程观察两侧各读一次；不能由 `facts.observeWork` 的零值盖过数据库工作。已有物理退役夹具显式标注其数据库边界仍为合成，不冒充全业务闭环。

新 `scripts/fixtures/browser-work-scope-mysql.mjs` 已在专用Linux MySQL8.0容器真实验证十二类查询、dispatching、过期租约、未知/NULL、上限和缺表拒绝，并逐表验证读取未改数据，最终退出0：`/tmp/holaday-work-real-mysql-final.log`。这是只含实际查询列的合成SQL夹具，不是全量迁移schema或生产恢复。随机QA库已清理，专用容器 `holaday-first-cutover-qa-742918bd094fcaa1` 已移除；既有MySQL/Redis未动。Linux Node22三组179/179、0跳过、退出0（UID/GID998），日志 `/tmp/holaday-work-linux-uid998-final.log`。第一次误用root组触发原证据发布夹具拒绝，保留失败 `/tmp/holaday-work-linux-final.log`，未放宽产品条件。原实际PM2/受保护scope/接收端/journal/pidfd退役与仅无关应用回生回归退出0，日志 `/tmp/holaday-work-site-physical.log`。

**仍未完成整项**：该读者只证明批准数据库里的持久工作状态，不能推导内存请求、浏览器外部动作或provider轮询已结束，也不能单独证明旧进程用的就是本次批准数据库。独立实际旧来源/业务/连接/writer观察、readiness与控制尾段/backup设施完整绑定、首次工具安装/execute、真实停写备份/Mac隔离恢复/非PayPal恢复、整流程及整分支审查仍待完成。下一步从这些真实提供者接线继续，不重建十二表读者/原site/通道/密钥，不再只增加组件数量。CLI execute保持拒绝，Tasks4–6不标完成。无生产连接、业务记录/支付/PayPal/密钥变更，无PR/合并/部署；原 `scripts/__pycache__/` 保留。

最终全browser **864/864**、ops **120/59/16/698及Python12**，均退出0、0跳过；日志 `/tmp/holaday-work-browser-complete.log`、`/tmp/holaday-work-ops-final.log`。八MJS的Biome、原四shell语法、diff-check通过。真实删除后丢ACK模式也退出0，日志 `/tmp/holaday-work-site-lost-ack.log`，保留已发生删除、不重试/继续未托管信号/出具错误stopped证明。应用全套、全量迁移恢复、实际双机业务整链及整分支独立审查本轮未跑，不能借本批结果宣称这些通过。

后续接线的具体接口注意点已查明：原release tail在`candidate_started`先start→verify/readiness，之后才persist verified identity，顺序不能倒置。新候选启动后的readiness必须把它从host传入的真实identity交给已有 `observer.readWithCandidate(identity)`；不能沿用site现有仅旧进程阶段的 `readFenceProgress()`，也不能仅从尚无identity的journal推断候选。已有 `readFirstCutoverCandidateRuntime` 会真实control-status/完整runtime/status夹读，可复用于开放身份事实；无需另建控制器/状态机或提前写verified。十二表读者只补齐DB维度，下一轮应接此完整readiness/control段及剩余事实，不重做本轮SQL夹具。

### 2026-09-28 夜间续跑：原现场生命周期接线与实体退役成功／丢确认演练

承接 `dd44cb82`，Task4原BASE844c2ced不变。新增 `createFirstCutoverExecutionSite`，把原双机入口、固定网关会话、真实生产者退役及retirement observer接到**同一个原journal**。先连接两个会话再建立完整基线；运行时身份包含控制器、两接收端和两条本机SSH；工作核清、生产者停止、网关启动条目处理、全停写及网关退役沿原顺序执行，不新建另一套状态机。失败不重复动作；退出反向尝试关闭两个句柄，关闭结果不明不冒充成功。业务／writer／控制／备份事实仍为必须提供的可信读者，未补默认零值。

复用既有root私密文件读取器增加固定 `first-cutover-execution-approved.json`，绑定原候选、attempt、配置、迁移、清单、legacyDigest和绝对截止；只接受三处既有nginx入口、主／备两份PM2启动文件和批准的main／worker／cron名称。现场组合已默认使用该真实文件读取器；不会从CLI接受路径或命令，也不会因为文件可读就认定业务排空。

接线发现并修正两处接口缺口：

1. 原入口只有全停写复查，停止生产者前无法新鲜验证“新任务关闭、回调仍通”。新增只读 `verifyOrders`，复用原围栏验证、不重载、不重复修改；穿过原本地／固定远端／双机pair。
2. 真实Linux组合在 `stopped / registration-backup-intent` 暴露围栏回调误用严格完成观察。新增 `readFenceProgress`，仅由持有的journal阶段／事件选择原progress分类器，明确返回非完成的双机观察；严格 `read()` 和最终 `assertStopped` 要求不变。真实失败日志 `/tmp/holaday-site-physical-{red,diagnostic}.log` 保留。Vultr／Aliyun删除中及未托管停止中的missing-method RED后GREEN，未知来源仍拒绝。

实体夹具复用原Linux镜像及 `browser-registration-removal-linux.mjs`：`--execution-site` 使用默认受保护文件读取、真实固定网关接收进程、原journal、真实启动文件／PM2／pidfd；准备阶段网关仍在线，退役成功后两个旧网关退出、无关PID不变、PM2重启只恢复无关应用。`--execution-site-lost-ack` 在真实删除后断开确认，保留删除记录，不重复删除、不继续向未托管网关发信号、不出具stopped证明。**另一逻辑主机、入口和业务事实仍为合成边界，不是生产双机停写或整流程验收。** 两模式退出0，日志 `/tmp/holaday-site-physical-{final,lost-ack}.log`。

真实nginx／双栈／TLS／WS夹具已在orders_fenced和producers_stopped调用新复查，并验证原回执不变；两段围栏、恢复原链接／UID501与共享旧长连接保持通过。真实SSH固定入口、两类接收端／客户端身份及越权拒绝回归通过。日志 `/tmp/holaday-site-ingress-physical-final.log`、`/tmp/holaday-site-ssh-final.log`，均退出0。实际Linux八组288/288、最终浏览器及两入口847/847，均0跳过、退出0；日志 `/tmp/holaday-site-linux-final.log`、`/tmp/holaday-site-browser-complete.log`。最终ops **120/59/16/681及Python12**，0跳过、退出0，日志 `/tmp/holaday-site-ops-complete.log`；不用早期不含新scope读者的680项。十MJS的Biome、四shell语法及diff-check通过。应用全套、真实MySQL恢复和整分支独立审查本轮未重复运行。

确切接续：现场生命周期已组合，但独立真实业务／连接／外部工作事实读者、readiness与控制尾段、backup实际设施仍需接上；不能只凭SQL零行／ss零连接假定排空。固定工具包安装及首次CLI `--execute` 仍未开放，需与这些读者及原host组成完整流程；保留原20模块check包和24模块网关包的职责，不把新site漏出最终执行包。然后继续真实停写备份／Mac隔离恢复／非PayPal恢复证据、全成功与故障流程和整分支审查。既有合成MySQL／61SQL／age演练已完成，不为增加通过数重做；原商户、密钥和通道不重建。

原生产者实体路径最终回归退出0：实际UID998 worker退出、停止态cron移除、未托管网关pidfd退出、无关PID保持及仅无关服务回生；日志 `/tmp/holaday-site-producers-final.log`。所有测试会话已结束、一次性QA容器自动移除。无生产连接／安装／服务／数据库／支付／PayPal／密钥变更，无PR／合并／部署；Task4–6未完成，不标上线成功。原 `scripts/__pycache__/` 保留，自动化继续本线程。

### 2026-09-28 夜间续跑：控制器来源、固定检查入口与真实 Linux 身份

承接 `ebf85ec1`，Task4原BASE844c2ced不变。`createFirstCutoverCoordinatorIdentity` 现在验证固定候选目录中的20个模块、root私密manifest和原NFT依赖，并逐文件核对真实Git候选对象及批准分支可达性。控制器只读取自身内核PID，不接收CLI提供的PID；完整argv/固定entry/attempt、root四UID、exe/cwd/boot/start/parent/cgroup均核对并绑定句柄生命周期。批准内容与绝对窗口不可在句柄存活期间更换，时间倒退、关闭中读取、来源漂移或失败均拒绝。分类器只增加精确`coordinator`角色，允许与两端会话/本机SSH一起作为独立执行进程；不豁免未知子进程/监听者，不删除原快照，不更改旧review或legacyDigest。

原host增加直接`--check <attempt>`入口；新增计划中的`deploy-browser-first-cutover.sh <candidate> <attempt> [--check]`复用既有凭据加载，严格主机指纹、固定SSH argv、远端空环境、单次只读调用，无上传/重试/回退。只返回`coordinator-source-inspection`且`releaseReady:false`；**`--execute`在凭据加载前明确拒绝，完整site尚未接齐，因此这仍不是可部署的首次执行CLI。** 工具检查依赖预先安装的固定候选工具包和受保护批准，不能把源码检查当作准备、停写或发布成功。

真实隔离Linux中使用默认读者（非伪造/proc或Git），固定入口、实际候选Git字节、root权限、实际进程argv、关闭执行入口验证通过。即使修改工具同时更新manifest摘要，只要不符Git候选仍拒绝；NFT漂移、错误cwd及审批权限也拒绝，未创建维护journal或调用服务效果。QA初次在准备阶段因既有task3镜像无Git而ENOENT退出，日志`/tmp/holaday-self-linux-physical.log`保留；之后复用同一镜像，只在一次性容器安装Git、关闭eth0后实测，不重建镜像、不挂生产凭据、不使用hostPID。最终实体日志`/tmp/holaday-self-linux-physical-final.log`退出0。真实SSH两种固定接收入口及来源/权限/转发拒绝回归退出0，日志`/tmp/holaday-self-ssh-final.log`。

最终浏览器及两种发布入口 **832/832**、实际Linux四组 **227/227**（coordinator/inventory/host/首次shell），均退出0、0跳过，日志`/tmp/holaday-self-browser-final.log`与`/tmp/holaday-self-linux-final.log`。完整ops最终退出0，**120/59/16/666及Python12**，无跳过；日志`/tmp/holaday-self-ops-final.log`，不用较早652项结果。六个MJS的Biome、四个shell语法及diff-check通过。未重跑应用全套、真实MySQL恢复、nginx实体退役全链或整分支独立审查，不将历史结果列为本批新鲜门槛。

剩余明确：完整site需把现有自身份句柄、入口pair、网关会话、retirement observer和原journal接到同一生命周期；真实业务/writer/control读者、停写备份与隔离恢复、非PayPal恢复、首次实际execute及准备安装、完整成功/故障演练与整分支审查仍待完成。不要重建这些已有模块、扩展通用部署框架或重复商户/通道/密钥核查。全部本轮操作为本地或临时QA，未连接生产、未改服务/数据库/支付/PayPal/密钥，无PR/合并/部署；原`__pycache__`保留，Task4–6未完成，自动化继续本线程。

### 2026-09-28 夜间续跑：SSH 客户端归属与已连接会话的基线接线

承接 `2dec13dd`，Task4原BASE844c2ced不变。两种固定会话复用同一SSH启动边界，只从自己实际启动的ChildProcess读取两次内核身份；核对完整argv、root UID、父PID、启动时间、boot、exe、cwd与cgroup，后续身份必须保持一致。新增`readTransportIdentity()`返回绑定原attempt/candidate/config/migration/inventory/site的Vultr客户端身份；断连、关闭、过期或核验失败不重连、不重发、不发信号，身份失败关闭通信流。原同步远端接收身份接口不变，入口pair另提供本机身份读者，允许在隔离回调中读取而不递归占用SSH流。

原分类器只增加精确的Vultr `ingress-ssh/gateway-ssh` 类型；未知子进程、监听者、进程/父身份改变和错误主机/绑定仍拒绝，原始快照不删除、旧review与legacyDigest不改。root双机采集改为远端只读SSH退出后再采本机，两端仍各读一次并等结果，不自动重试；Mac管理员路径保持原并发，原新鲜度限制保持。

修复原流程两处实际接线问题：①已连接接收端会让初始source/baseline判为未知，现将同一活句柄及完整批准绑定放在基线实际采集前后验证；②实体退役演练发现未托管停止阶段重新分类旧基线时遗漏其执行身份，现保留基线当时的不可变身份，重分类时复用，不拿后来身份改写历史。第二处先由实际Linux失败发现，再以单元`attached-baseline`复现RED，修复后完整实体网关退役通过。

新增Linux实体模式`--gateway-session-baseline`在原journal处于preflight时先连接真实接收进程，再建立原observer，随后实际准备/PM2删除/pidfd退出；两个网关按序退出、无关PID保留、PM2重启只恢复无关应用。原丢ACK与无归属拒绝模式仍通过。真实SSH固定入口夹具使用正式spawn/内核读者，仅映射隔离QA地址与密钥路径；两个客户端与接收端身份、真实/proc argv摘要、关闭后拒绝均通过。实体nginx/TLS两阶段隔离、恢复及无关长连接保持通过。业务计数、逻辑另一主机仍为明确QA合成，这不是整双机停写或发布完成。

最后修复后完整browser **797/797**、实际Linux九组 **344/344**、完整ops **120/59/16/631及Python12**，均退出0、0跳过；上述实体基线/网关退役、真实SSH、nginx/TLS及两种拒绝模式退出0。日志`/tmp/holaday-coordinator-{browser-final,linux-final,ops-final,ssh-final,ingress-final}.log`及`/tmp/holaday-coordinator--gateway-session-{lost-ack,observed-executor}.log`。初始实体失败保留在`/tmp/holaday-coordinator-baseline-physical.log`，对应RED见`/tmp/holaday-coordinator-unmanaged-baseline-red.log`。11个MJS的Biome、现有shell语法、diff-check通过；不沿用较早796项结果。

确切下一步：**Vultr协调器自身的固定入口/受保护工具来源与生命周期归属仍未接通**，不能把root或Node一律豁免。将这项与原首次CLI/完整site一起接合，沿用已有会话客户端、接收端、基线及原journal；不要再新建通用发布引擎。还需实际业务/writer/control读者、停写备份与隔离恢复、非PayPal恢复证据、完整成功/故障演练与整分支审查。当前首次CLI仍不存在，不能生产执行，Tasks4–6未完成。无生产SSH/安装/服务/DB/支付/PayPal/密钥操作，无PR/合并/部署；原`__pycache__`保留，自动化继续本线程。未运行应用全套、真实MySQL恢复或整分支独立审查。

本批验证补充：原生产者默认实体模式也已退出0，日志`/tmp/holaday-coordinator-producers-ptrace-final.log`。首次QA调用漏加跨UID读取所需的容器`SYS_PTRACE`，在退役前读UID998的`/proc/cwd`报EACCES；按已有隔离配置补齐后通过，未放宽代码，也未使用宿主PID。失败日志`/tmp/holaday-coordinator-producers-final.log`保留。所有测试已退出。

### 2026-09-28 夜间续跑：接收端真实进程身份接入原观察器

承接 `260710c0`，原Task4 BASE844c2ced不变。本批解决下方恢复点中**远端接收进程**被误判为未知的问题，不宣称所有执行进程已接齐。两个固定SSH接收端从自身`/proc`两次读取完整身份，核对固定入口/attempt argv、root UID、实际exe/cwd、启动时间、父PID、boot及cgroup。已固定SSH入口校验的执行包仍是来源信任边界，不防御已被攻破的root。会话句柄提供绑定原批准范围的身份副本；关闭、断连、过期或身份改变后拒绝继续使用。

原retirement observer在每次完整主机观察前后核对同一批活会话身份，分类器单列`executionProcesses`。原始快照保留，旧review、legacyDigest与journal不重写；只有精确匹配的本次接收端被单独分类，未知子进程不继承豁免。错主机boot/attempt/candidate、PID身份漂移、监听端口、PM2归属、进程消失、观察中归属变化、把旧review进程冒充新执行者均拒绝。双入口组合暴露同步身份读取，不递归占用正在执行的通信会话。

原Linux网关成功夹具现**实际包含接收进程**并向原observer提供活句柄：准备仍保留两网关，停止后真实PM2/pidfd退出、原journal完整、无关PID保持、重启只恢复无关服务通过。不给归属证据的`--gateway-session-observed-executor`仍在任何启动文件修改前拒绝；实际删除后丢ACK仍不重发/不继续信号。真实sshd默认入口分别核对两种接收端的内核argv摘要并完成attach/detach；该SSH夹具不执行支付网关停止。实际nginx/TLS夹具仍使用明确的映射入口，其新增身份读者读取真实内核字段，但固定生产入口来源验证由上述SSH夹具单独证明，不冒称生产整链。

验证：新增关键场景先RED后GREEN，最终browser **778/778**、Linux八个专项组 **294/294**，均0跳过、退出0；Linux本批选组不同于上一批300项，不能按数字判断退步。完整ops **120/59/16/612 + Python12**，0跳过、退出0。实体网关成功、丢ACK、未归属拒绝、原生产者默认路径、真实SSH和nginx/TLS两阶段隔离/恢复/无关长连接均退出0。日志 `/tmp/holaday-executor-{browser-final,linux-final,ops-final,ssh,ingress-physical-final,lost-ack-final,unowned-final,producers-final}.log`。12个MJS的Biome、相关shell语法与diff-check通过。

两处实体测试失败已定位并保留证据：网关QA原proc数据漏掉生产采集器已有的cgroup，补读真实字段；入口QA新增UID正则误写成三列，改为真实四列。未删身份字段或放宽生产条件。单元首轮两处测试设置错误也修正：必须先connect才能访问句柄；原observer会复制review，因此旧身份冲突需放进原baseline而非事后修改测试对象。失败与RED日志保留在`/tmp/holaday-executor-*`；不将这些初次失败写成产品回归已通过。

**确切下一步仍是完整现场接线**：Vultr协调器自身及持久SSH客户端尚需真实来源/身份/生命周期归属，当前分类支持的是Aliyun两个接收端；原生产采集器会保留所有Node/holaday进程及子树，禁止忽略它们或自动扩展旧review。随后补实际业务/连接/writer读者、同锁完整site与首次CLI、真实停写备份/隔离恢复、非PayPal恢复证据、完整成功/故障演练和整分支独立审查。上述未完成前不能部署。不要重写已接好的会话、网关退役、商户、密钥或只读通道。本批无生产SSH/安装/服务/DB/支付/密钥/PayPal操作，无PR/合并/部署；原缓存保留，应用全套/真实MySQL恢复/整分支独立审查本批未跑，Task4–6未完成，自动化继续本线程。

### 2026-09-28 夜间续跑：固定远端网关调用已接通；完整现场仍受执行进程归属约束

承接 `961f7cfd`，原Task4 BASE844c2ced不变。新增固定 `gateway <attempt>` SSH会话，独立于入口会话，复用已有有界通信及受保护清单读取。直接调用上一批本机网关准备/退役函数；Vultr原journal和retirement observer仍负责事件与原始身份摘要，Aliyun接收端独立重读固定启动清单和批准窗口。未托管退役由原observer编排、接收端执行原pidfd helper，嵌套期间只允许必要的只读核对；无通用远端命令、复制日志、自动重连或不明结果重试。

新增会话10项回归含真实临时权限文件、空回执/范围漂移/丢确认/重复操作拒绝，先RED后GREEN。原Python强制入口支持独立24模块固定闭包（原入口20模块不变），含启动文件与signal helper。实体Linux独立接收进程使用原journal/observer、真实PM2与pidfd：准备后4010/4011均存活，停止阶段两者退出，无关PID保持，PM2重启仅恢复无关应用；独立丢ACK容器证明真实删除后不再信号或重发。实际sshd验证固定命令、原journal、独立批准及文件篡改拒绝。此处业务计数、另一逻辑主机以及受控进程清单仍属QA合成，不是完整现场成功。

**已确认的整链接线缺口，不能忽略：** `--gateway-session-observed-executor`将真实接收进程加入观察后，原observer正确拒绝新未知进程，准备阶段零启动事件、文件未变、两端口仍200。当前成功夹具未包含这个新增执行进程，不能拿其成功代表生产可执行。后续完整site必须精确绑定本次可信协调器、接收端及其受控子进程的身份/来源/生命周期，并保留原始观察；禁止过滤快照、泛化“所有root/Node可信”、伪造review或原legacyDigest。本次未改变分类门禁。原journal、legacy baseline及信号代码不需重写。

实体入口回归首轮失败：此次Docker调用漏挂原只读`/ops`，当前版本与HEAD对照都在nginx执行前失败。定位到固定nft策略读取后，补齐`--mount .../ops,dst=/ops,readonly`通过；临时诊断已移除，干净再次运行退出0。这也暴露执行包缺少资源预检：现强制入口启动前校验固定相邻`ops/aliyun-edge/holaday-payment-ingress.nft`、原字节摘要、root私密目录/文件。缺策略测试真实RED→GREEN；实际SSH缺失/篡改资源拒绝通过。策略规则/字节未变，无生产安装。

最终同口径browser **763/763**、Linux相关八组 **300/300**，均0跳过、退出0；实际网关成功/丢ACK/未知执行进程拒绝三个模式、真实SSH、真实TLS/nginx两阶段/恢复/无关长连接均退出0。最新全ops **120/59/16/597 + Python12**、0跳过、退出0。日志：`/tmp/holaday-gateway-session-{browser-final,linux-final,disconnect-final,observed-executor,ingress-final}.log`、`/tmp/holaday-gateway-policy-{ssh-final,ops-final}.log`；保留失败日志`/tmp/holaday-gateway-session-ingress-regression.log`、`/tmp/holaday-gateway-ingress-baseline.log`、策略RED日志。五MJS Biome、shell语法、diff-check通过。不宣称应用全套、真实MySQL恢复或整分支独立审查已通过。

确切接续：先完成上述执行进程精确归属与完整site读者接线，复用已完成固定双会话、入口与网关模块；再接首次CLI、真实停写备份/隔离恢复、非PayPal恢复证据、完整成功/故障演练与整分支审查。首次CLI和完整site仍不可用于生产。PayPal/商户/密钥保管/只读通道不重做，无生产SSH/服务/DB/支付/密钥操作，无PR/合并/部署；原缓存保留，Task4–6未完成，自动化保持本线程继续。

### 2026-09-28 夜间续跑：阿里云网关准备与实际退役已接为两阶段本机调用

承接本地 `fd97b24e`，原Task4 BASE844c2ced不变。在原registrations模块增加 `prepareLocalFirstCutoverGateway` 与 `retireLocalFirstCutoverGateways`，沿用原启动文件、PM2注册、pidfd及retirement observer/journal。前者只在producers_stopped备份和移除批准的启动条目，保留活网关；后者只在stopped、全隔离/工作核清后依次移除托管注册和原未托管网关。核对真实本机内核主机名、原journal、绝对截止、新鲜观察；有部分效果就拒绝重新执行。没有放宽journal阶段或给未接线的业务观察补零。

六个新场景先因缺方法RED、实施后GREEN；追加“启动条目已不存在”拒绝回归。该追加测试最初错误期望可成功，实际追查原startup/journal/inventory三处契约均要求至少一个批准的真实启动文件变化，故只修测试，未修改生产门禁。单元覆盖实际临时文件/原字节备份、准备不误停、提前停止/忙碌/错误主机/启动文件漂移拒绝及删除后丢确认不重试。

复用原 `browser-registration-removal-linux.mjs` 的 `--gateways` 模式：真实root网关、PM2、/proc、4010/4011监听、原journal及pidfd；准备后两个网关仍200，stopped后托管与未托管退出，无关PID不变，PM2重启只恢复无关应用。独立 `--gateways-lost-ack` 容器在真实删除后抛丢确认，确认删除意图保留、未托管网关仍200、不再删除或继续信号。默认生产者/停止态cron/未托管网关模式也复验通过。业务计数与另一逻辑主机明确为QA合成，不是双机业务停写或发布完成。

本批最终browser **753/753**、Linux相关六组 **277/277**，均0跳过、退出0；三个独立实体模式均退出0。日志 `/tmp/holaday-gateway-site-browser-complete.log`、`/tmp/holaday-gateway-site-linux-final.log`、`/tmp/holaday-gateway-site-linux-lost-ack.log`、`/tmp/holaday-gateway-site-producer-regression.log`。三MJS Biome、现有shell语法、diff-check通过。最终全ops **120/59/16/587 + Python9**、0跳过、退出0，日志 `/tmp/holaday-gateway-site-ops-complete.log`；早先586项不含最后拒绝测试，以本最终结果为准。所有测试已退出，一次性容器自动移除。

确切接续：这两个函数仅是Aliyun本机执行组合，尚未通过固定SSH接入完整site。原retirement observer应继续持有原Vultr journal及原始进程身份摘要；不能复制/伪造日志，不能把 `observer.retireUnmanaged` 简化为空成功。固定远端执行须同时支持受保护启动清单、实时原journal写入及原observer管理的未托管退役；避免在入口会话的writers回调内递归读取同一会话。当前20模块入口包尚不含registrations/startup/Python signal，不能只加远端动词就声称可部署。随后仍需真实业务/连接/writer观察、完整site与首次CLI、停写备份/隔离恢复、非PayPal恢复证据、全流程成功/故障演练及整分支审查。不要重建已完成的入口/退役模块、商户、通道或密钥。

无生产连接/安装/服务/数据库/支付/PayPal/密钥操作；无PR/合并/部署。未重跑应用全套、MySQL恢复或整分支审查。原`__pycache__`保留，Task4–6仍未完成，夜间自动化保持本线程续跑。

### 2026-09-28 夜间续跑：生产者启动记录与运行注册已接为正式调用

双机入口与host会话接线已保存本地提交 `77ee22ac`，本批接续原Task4、BASE844c2ced不变。在已有registrations模块增加 `retireLocalFirstCutoverProducers`，直接接原journal、retirement observer、启动文件备份/替换及真实PM2删除器；固定本机Vultr内核主机身份，工作核清必须发生在启动文件修改前。完整匹配原main/worker/停止态cron，不允许借该接口处理阿里云网关或无关名称；有本次部分事件就拒绝重新执行，丢删除确认不补发。返回值仅是生产者阶段，不冒充双机stopped。

7个新场景含真实临时文件、原字节备份、大整数保留、主机/阶段/忙碌/越界拒绝及删除后丢确认；先见缺方法RED再GREEN。另一个真实RED发现“全观察对象相等”误把正常采样时间前进当漂移，改为原capture验证完整身份/范围及新鲜度后比较无时间戳的capture；未忽略实际状态漂移。原Linux实体夹具已删除自行编排启动清理/注册删除的代码，直接调用正式组合，实际UID998生产者退出、停止态cron移除、无关PID保持、备份与主机标记journal成立、PM2重启后只恢复无关应用通过；同时原未托管网关pidfd测试保持通过。业务fence计数及另一个主机仍为合成，不等于真实双机业务停写。

本批浏览器与部署入口完整同口径 **745/745**、0跳过、退出0，日志 `/tmp/holaday-producer-site-browser-complete.log`；Linux专项 **180/180**、0跳过且实体退役/回生演练退出0，日志 `/tmp/holaday-producer-site-linux-final.log`。三个MJS的Biome、shell语法、diff-check通过。新组合测试已补入原test:ops门禁，最终全命令退出0，**120/59/16/579 + Python9**、0跳过，日志 `/tmp/holaday-producer-site-ops-complete.log`；不要把较早未含该测试的565项当最终门禁。测试均已结束、一次性容器自动移除。全部操作仍限本地及隔离容器，无生产连接/改动、PayPal、密钥或历史业务修改；未重跑应用全套/真实MySQL恢复/整分支审查。

确切下一步：完整site在attach内创建已有入口pair和retirement observer；stopProducers调用上述正式组合，真实独立业务/连接/writer观察需补齐，不能将fixture的零计数带入生产，且不能在入口会话writers回调递归读取该会话。还需阿里云受保护网关退役效果、同锁首次CLI、停写备份/隔离恢复、非PayPal恢复证据及完整成功/故障演练和全分支审查。Task4–6仍部分完成，无PR/合并/部署，不反复重做商户/密钥或这些已接通模块。夜间自动化保持续跑。

### 2026-09-28 夜间续跑：双机入口与现场会话生命周期接线

承接 `39452d1b`，Task4原BASE844c2ced不变。在原入口会话模块组合本机Vultr与固定SSH的Aliyun两个生命周期：同一实际journal、受保护三站点范围、跨两端同一记录版本及原绝对截止时间；隔离Vultr→Aliyun，恢复Aliyun→Vultr。两端回执分别绑定主机，全局writer计数要求一致而非相加；任意一端确认不明就锁住后续效果，不重试或自动恢复。实际writer/control观察仍是必需项，不以零值补齐。

原host补必要的 `lifecycle.attach/detach`：持有真实日志锁、候选暂存后且首次readiness前建立现场会话；恢复入口及worker后、维护窗口内结束执行会话，再做可延长的只读补核对。初始化失败不开始隔离，结束确认不明不解锁、不重复结束；失败收尾仍保持日志所有权。只读补核对必须使用独立观察路径，writer回调不能递归调用同一个进行中的远端会话。

实际Linux夹具已调用正式双机组合，本机路径与独立接收进程分别操作各自私密文件和回执；真实nginx/TLS两阶段隔离、恢复、六次重载期间无关长连接保持通过。单容器共享nginx和网络命名空间，不冒充两台生产机器。另一个独立容器实测接收进程在隔离已重载后丢ACK：两个实体回执保留，后续动作被拒、未再次重载/恢复、无关连接保持。业务核清/备份/候选前置仍明确合成，不是整链成功证据。

最终browser **737/737**，完整ops **120/59/16/565 + Python9**；实际Linux **136/136** 加实体双入口演练，真实sshd/Python9及固定入口断言通过。上述均0跳过、退出0。日志 `/tmp/holaday-ingress-pair-browser-complete.log`、`/tmp/holaday-ingress-pair-ops-complete.log`、`/tmp/holaday-ingress-pair-linux-complete.log`、`/tmp/holaday-ingress-pair-ssh-final.log`；丢ACK实体日志 `/tmp/holaday-ingress-pair-lost-ack-final.log`，该项在host生命周期改动前通过、相关入口代码此后未变。六个MJS的Biome、shell语法、diff-check通过。初次实体失败是QA清单携带fs.Stats原型而非生产JSON；以独立诊断确认后只修QA，不放宽生产范围比较。原RED/失败日志保留。

没有生产SSH/安装/服务/DB/支付/PayPal/密钥操作，未重跑应用全套、MySQL恢复或整分支审查；原`__pycache__`保留。本轮仍是Task4局部接线，Task4–6未完成、无生产首次CLI、不能部署。下一步从新的attach持有journal入口组合已有现场观察/退役模块，补真实业务/writer/control读者、完整site provider及首次CLI，再完成停写备份恢复、非PayPal恢复证据、全链故障演练和整分支审查。不要重建已通过的入口会话、商户或恢复密钥。自动化继续本线程。

### 2026-09-28 夜间续跑：固定 SSH 入口会话已验证，未安装生产

承接 `152f5755`，原Task4 BASE844c2ced不变。已有入口生命周期现可通过固定 `holaday-cutover-v1 ingress <attempt>` 会话调用；接收端独立读取root受保护审批与两个阿里云入口清单，控制端按序实时调用原journal、writer及候选观察器。没有上传配置/命令、任意主机、重新连接或不确定动作重试。固定20模块的工具包及每文件摘要必须验证；仅源码增加新命令，生产强制入口/身份/authorized_keys/sshd仍保持原只读版本。

13项会话测试含缺实现、虚假成功值、重复动作、审批拒绝后未关闭流、发送阻塞超时的实际RED→GREEN，另有范围/序号/丢ACK/超长输入回归；Python固定包与命令测试9项。最终完整browser **722/722**，ops **120/59/16/550 + Python9**，均0跳过、退出0。实际Linux专项 **68/68** 及独立接收进程的真实journal/nginx/TLS/两阶段隔离/原配置恢复/无关长连接全部通过；真实sshd独立测试固定包、独立审批、持有journal的控制端attach/read/detach和缺包/改审批权限/篡改拒绝通过，退出0。日志 `/tmp/holaday-ingress-session-{browser,ops,network,ssh}-final.log`。触及MJS的Biome、shell语法、diff-check通过；重型验证串行，全部退出。

证据边界：网络段包含明确合成业务/备份/候选观察，SSH段只读、不运行nginx修改；两段不等于完整双机业务切换。未重跑应用全套、MySQL恢复或整分支独立审查。没有生产SSH、服务/DB/支付/PayPal/密钥修改；原 `scripts/__pycache__/` 保留。当前仍无完整生产site adapter或首次执行CLI，Task4–6部分完成，不能上线。

接续优先完成原首次执行入口与完整site接线、真实writer/control/退役效果、停写备份与隔离恢复、非PayPal恢复证据、整链成功/故障演练及全分支审查；不重做这次已验证的入口会话或商户/密钥。新入口在完整site缺失时必须拒绝，不得以未接线入口或组件测试替代发布验收。夜间自动化继续本线程。

### 2026-09-28 夜间续跑：本机入口生命周期已接合，双机现场执行仍待完成

承接 `b6f9263b`，Task4 原 BASE844c2ced不变。在原 `browser-first-cutover-host.mjs` 增加 `createFirstCutoverIngressLifecycle`，直接组合已有 fence store、文件隔离、正式 nginx 及 TLS 探测。构造只观察；原真实 journal 的阶段意图、完整记录摘要、受保护入口清单在效果边界核验。隔离、全隔离、同实例恢复每项一次，禁止并发和不确定重载的重试；错误保留 installing/restoring 文件，不伪装成功。实际 writer 与候选控制观察仍为必需接口。没有新增通用命令/RPC或修改已安装只读通道。

新增十项测试：真实临时文件/链接/journal/回执的完整入口循环、未写意图、审批漂移、确认丢失、错误boot、操作中阶段漂移、并发、关闭态候选、生存写入者及缺观察器/过期。最初6项因缺方法RED；实施后测试真实journal拒绝缺manifest，定位为新夹具缺原有前置步骤，补合成manifest/backup/bootstrap后通过，未放宽原journal。额外4项为接线回归。原Linux实体夹具改为消费新生命周期，不再手动拼接三个模块。真实网络/进程/文件；业务核清、备份和候选仍是明确合成前置条件，不能当整流程或双机现场成功。

本轮完整browser709/709、0跳过，`/tmp/holaday-ingress-lifecycle-browser.log`；完整ops退出0，120/59/16/537及Python7全部通过、0跳过，`/tmp/holaday-ingress-lifecycle-ops.log`。Linux首次及格式化后最终复验均55/55、0跳过、退出0，实体三站点隔离/恢复/无关长连接通过，最终`/tmp/holaday-ingress-lifecycle-linux-final.log`。三代码文件Biome、shell语法和diff-check通过。重型验证串行且均已结束，无生产SSH/服务/数据库/支付/PayPal/密钥操作，未重跑应用全套、MySQL恢复及整分支审查；旧`__pycache__`保留。

下一步不是复做nginx/HTTP/商户/密钥：将这个本机实例接入固定双机现场效果处理（原通道仍仅probe/observe），提供真实受保护现场审批及writer/control观察；继续完整site I/O、首次执行入口、真正停写备份/隔离恢复、非PayPal恢复证据与整链故障演练/全分支审查。当前Task4–6仍部分完成，不调用task-done、不推为可发布候选。夜间自动化保持原ACTIVE续跑，无需重复询问已授权动作。

### 2026-09-28：正式 nginx 生效接线完成，保留共享站点连接

承接`ea873cc4`、Task4原BASE844c2ced，新增固定nginx测试/重载与Linux进程观察，接入现有apply和restore的默认I/O。原成对注入接口保留；半套替代接口、缺窗口、过期或非Linux/root在文件修改前拒绝。完整配置、同一journal/回执及master/服务代际核对后只发送一次reload；超时/丢确认不重试、不stop/quit、不强制终止worker。

实施中的“所有旧nginx worker必须消失”判据经复查收窄：共享主机还承载无关服务，不能让其长连接阻塞HOLADAY切换或强制断开。两个明确RED后改为新服务代际稳定、旧代际进入graceful shutdown；已在退出的旧代际自然消失不算配置漂移。HOLADAY自己的旧WS/内部写入仍由独立实际停写证据证明，此观察器不伪报零写入。裁决已记原ledger，不扩建业务功能。

原Linux实体夹具已删除代办重载的实现，调用正式默认PID/proc读取和重载控制器，仅映射容器合成配置路径。首次读跨UID的`/proc/<worker>/exe`遇EACCES，定位后给本例隔离容器添加SYS_PTRACE；没有放宽代码或使用宿主PID。最终Node22/Linux45/45、0跳过；实际三站点双栈TLS、两阶段维护、恢复原UID501/inode/链接及恢复后HTTP响应通过。真实无关长连接在旧worker内贯穿整个过程、恢复后仍可继续收发。镜像`holaday-first-cutover-network:qa`身份`sha256:ff58ba973281d0804a90d92cee112ef1240386875f2584f975bf0bbf93893abf`，无外网、scripts/ops只读、无生产凭据。日志`/tmp/holaday-nginx-linux-complete.log`。

最终浏览器699/699、0跳过，日志`/tmp/holaday-nginx-browser-complete.log`；最终全ops退出0，120/59/16/527及Python7全部通过、0跳过，日志`/tmp/holaday-nginx-ops-complete.log`。触及四MJS的Biome及shell语法/diff检查通过。没有生产SSH/安装/服务/数据库/支付操作，没有PayPal访问或密钥改动；旧`__pycache__`保留。应用全套、真实MySQL恢复和全分支审查未在本批重跑。当前只完成nginx这段正式效果接线，不是完整site adapter、首次CLI或整条发布完成；Task4/5/6仍部分完成，后续继续双机受保护效果处理、停写备份恢复及整体演练/审查，不能重复已完成商户和密钥工作。

### 2026-09-27：入口探测接入实际网络，整条首次发布仍未完成

承接`9ee8f795`，Task4原BASE844c2ced不变。把Linux夹具独有的HTTP验证责任接入现有`browser-first-cutover-fence.mjs`，`verifyCutoverFence`默认使用真实TLS探测；原注入接口保留。只探测三个已审核站点的固定本机路由，真实WS握手、无效回调、严格TLS、超时/响应上限/无重定向/不重试。写入者证据必须另行提供新鲜观察，不能默认零；完整site I/O仍未接完。

实体测试先暴露错误QA镜像缺nft，换用已有network镜像而非降低端口隔离门槛；随后发现业务`/healthz`误命中精确健康例外，复用原夹具后缀策略并先补RED。另补时钟在起始时刻以上回拨的真实RED→GREEN。测试增加WS升级拒绝、响应挂起超时、截断/超长、范围拒绝、实际非零计数和默认消费路径。WS负向测试的升级socket清理曾阻塞测试退出，修正测试资源清理；未改产品判定。

最终实际nginx/TLS/IPv4/IPv6两阶段及恢复通过，37个不可信证书请求均拒绝；原文件链接、UID501与inode保留。日志`/tmp/holaday-ingress-probe-linux-final.log`。模拟应用后端和写入者计数不构成整站停写证明。完整浏览器689/689、0跳过，日志`/tmp/holaday-ingress-browser-final.log`；全ops最终退出0，120/59/16/517和Python7项全部通过、0跳过，日志`/tmp/holaday-ingress-ops-final.log`。修改途中旧ops加载旧实现遇到新增RED，已在代码固定后完整重跑，不沿用混合结果。触及代码Biome、shell语法和diff-check通过。

没有生产SSH、服务/数据库/支付写入或PayPal访问，没有更新已安装通道；旧Mac/USB/服务器密钥及原`__pycache__`保留。应用全套、MySQL恢复、全分支审查未在本批重跑。Task4/5/6仍部分完成，下一步仍是完整受保护现场效果接口、首次CLI、实际停写备份恢复/非PayPal恢复证据和整流程审查，不能将本组件成功称为上线完成。

### 2026-09-27：专用通道已获准、安装并接入真实双机观察

最新“允许”已解决下方历史凭据授权等待。Vultr独立生成新ED25519身份，私钥仅留原机；阿里云追加绑定来源/固定命令/restrict的公钥，原授权先备份并完整保留。不复制既有Mac或恢复密钥，不改sshd、不重启服务。具体路径、摘要、公钥指纹及撤销边界见 `docs/ops/browser-first-cutover-host.md` 的专用通道段落。

新增Python入口和安装函数先RED→GREEN；真实隔离sshd验证probe/observe、篡改及命令/文件传输/转发/PTY/错误来源/rc拒绝。测试镜像曾因/tmp授权路径及copyfile丢失Node可执行位失败，分别修正夹具私密目录和保留文件权限，没有放宽产品限制。生产新身份probe/observe和七类拒绝实测通过；原始证据仅保留在Mac私密临时目录。

现有 `readFirstCutoverHostPair` 的Linux root默认路径已改为Vultr本机 + 阿里云专用SSH；保留Mac管理员审计路径与全部绑定/时效/失败不重试检查。首次组合观察返回UNPROVEN，原文不足以归因；一次脱敏阶段诊断、之后一次最终无诊断观察均成功，不宣称已定位首次失败根因、不放宽门槛。最终观察 `1790518727337`，源码 `58511139b884091781bafd78bcd98cdab3972916135857730cc073e114f0d218`，原checkout `107857fe70503e30691073f267d87275596edb20`，Aliyun12/Vultr30相关进程。后者包含实际控制端进程，未擅自过滤或审批未知来源。

新鲜验证：浏览器679/679、0跳过；Linux root专项Python7/7、Node31/31，隔离真实sshd全部断言通过。初次误设age测试变量导致27项跳过，已使用 `CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age` 完整重跑，不以跳过算通过。完整ops最终退出0，末组507/507、0跳过，新Python7项进入常规门槛；两份MJS的Biome、shell语法和diff-check通过。日志 `/tmp/holaday-channel-{browser,ops}-complete.log`。本轮未修改应用代码，未重跑应用全套、真实MySQL恢复或全分支审查，不沿用旧通过结果作为本轮整体验收。工作树保留既有 `scripts/__pycache__/`；Task4原BASE844c2ced不变。

仅部署了受限只读工具通道，未发布候选应用、未改业务进程/数据库/订单/支付配置，PayPal没有访问。Task4/5/6仍未完成：完整受保护现场清单和副作用I/O、首次CLI、真实停写备份/隔离恢复、非PayPal外部恢复证据、整流程及全分支审查。下一步沿原host/transition接固定效果处理器，不重新审计已通过通道、不重建发布引擎，也不把本组件成功称作上线大项完成。

### 2026-09-27：9139e277已提交，跨主机凭据边界待明确

九笔延期补丁已本地提交 `9139e277`，无push/PR/合并/部署。工作树仅剩原有 `scripts/__pycache__/`。后续只读检查从Mac known_hosts提取已信任的Aliyun ED25519公有记录，经stdin供Vultr上的SSH本次读取（StrictHostKeyChecking=yes，未写known_hosts、未传密码/私钥）；主机密钥校验通过后，BatchMode认证返回 `Permission denied (publickey,password)`。因此之前缺主机信任之外，现成无人值守服务器间认证也不可直接使用；不是Aliyun网络不可达。

执行计划的安全敏感变更规则要求先明确新的凭据边界。待用户批准的窄提案：Vultr新建独立部署SSH身份，私钥仅留原机root私密目录，Aliyun仅安装公钥并绑定固定发布helper、来源IP、禁止PTY/交互shell及转发；不复用/复制Mac登录私钥或恢复私钥，不给通用root shell。helper必须先本地验收后才安装受限授权，远端命令范围仍受原候选、清单、journal和维护窗口约束。本提案尚未实施、未生成密钥或写authorized_keys。

也未自行恢复旧的暂停夜间自动化；该历史prompt仍指向旧工作树和9月13日进度，不能拿来继续本轮。所有本轮测试/SSH和审查子智能体均已结束。跨主机通道不是唯一工程缺口：完整site I/O、首次CLI、真实停写恢复、外部支付恢复及整流程验收/全分支审查仍须完成，不将此授权描述成“允许就能马上上线”。

### 2026-09-27：九笔支付宝延期授权已落实，原发布大项继续

用户“允许”明确批准之前提问中的九笔历史支付宝延期；之后“我要出去一下 你自行推进”继续授权本大项推进，不需再问相同许可。由3b14c2d0继续，原Task4 BASE844c2ced不变。collector与应用readiness独立固定九笔集合，数据库reader要求全九笔匹配原身份，完整选中行摘要参加读前后核验；额外新单正常查询。与旧PayPal单笔批准独立共存。原订单、权益、回调、结算及查询器状态解释未改；PayPal没有访问。

离线复核两个原私密归档九笔行数组一致，固定集合摘要6e81aade39333ad180272497a70b06aeffb57194a643c525fde264684df69686；不是新鲜生产观察。最初collector/application测试先RED，代码实现后通过；补测覆盖UTC SQL日期、PayPal排在支付宝之后、仅支付宝、当前external_id/metadata全行绑定、窗口内新单unknown阻断。审查无阻断发现，两项非阻断覆盖建议已补。审查仅本补丁，不是整分支审查。

最终browser659/659、Linux专项98/98无跳过；应用507文件8599通过/1既有CDP条件跳过，最终readiness43/43与typecheck通过，build退出0。全ops退出0（120/59/16/493），发生在最后补充测试之前，之后完整browser和Linux专项重跑通过。触及四代码文件Biome/diffcheck通过。日志 /tmp/holaday-alipay-{browser-final3,linux-final,app-full,ops,build}.log。首次权限自动审核超时未执行，原样允许重试一次成功；夹具误含PayPal、传scope误当数组及测试数组类型/lint错误均已修正，无产品边界放宽。

为完成真实接线，只读验证Mac既有严格SSH跳板可到Vultr；Vultr再连Aliyun在主机密钥校验处拒绝（缺已知ED25519），尚未到凭据认证，不能据此断言密码或网络失败。没有关闭校验、新增信任、复制密钥、改服务或部署。原Task4–6仍缺完整site I/O、首次入口、全流程演练、真实停写恢复及外部支付恢复证据；不是只剩延期授权。下一步继续这些工程接线，不重做已通过的商户或密钥步骤。

### 2026-09-27：中途退役与候选观察实体回归通过，继续现场组装

承接 `fad920ad`，原Task4 BASE `844c2ced` 不变。新增具名注册删除中途观察、同一journal的未托管网关意图/退出记录；真实生命周期在 `stopped` 意图后删除网关注册，已修正对应阶段许可并阻止未完成记录推进备份。未托管退役仍复用原pidfd SIGTERM及连续退出核对，不增加数字PID/强杀回退。kernel hostname实采且保持原大小写，实际Aliyun混合大小写主机名先触发拒绝，RED测试后修复精确校验。

候选观察现已使用实际控制socket、PM2/proc和4001/4002双端口前后核对；严格匹配journal SHA/真实boot，排除bootstrap替身、原PID复用、额外孤儿。恢复入口仅允许同实例serving和原配置字节/身份完全还原，半途恢复不放行。接口详情及边界见现场接线文档。

本批新验证：完整浏览器 **649/649**、全ops退出0（末组 **484/484**）、Linux关联 **290/290**、Python **8/8**，均0跳过。Linux实际PM2 worker/停止cron/主备用dump/共享journal、未托管Node网关及pidfd SIGTERM实体测试通过，重启fixture daemon只恢复无关应用。候选实体QA由Sol在限定单文件范围实现，父任务独立重跑退出0：真实PM2/UID998/proc/监听/socket；协议状态仍是合成模型，不能当整应用或整条双机切换。日志 `/tmp/holaday-cutover-phases-{browser-final,ops,linux-final}.log`，Docker无网络、源码只读、结束自动移除。

生产仅只读：两机采集经混合大小写修正后成功，观察时间戳 `1790504585971`，采集源SHA `fd94aa8ff2727fc8120fcee8ca4af4f6f5c8bc28daa94364ce532a73e3903aa1`，原checkout仍 `107857fe70503e30691073f267d87275596edb20`，Aliyun12进程/2注册、Vultr28/9。没有停服务、改配置/数据库/支付或读取私钥；此快照会过期，不是488来源已审核或停机许可。未重复微信核查、密钥复制或PayPal操作。

**Task4–6仍未完成，不能部署：** 完整受保护site I/O、双机副作用与Mac恢复协调、首次shell、真实整流程及恢复/支付证据、整分支审查仍待完成。已向用户提出精确9笔历史支付宝pending单独延期的选择，尚无答复；现规则仍阻断，不改数据、不自动套用PayPal例外。当前代码回归不是整项验收。原 `scripts/__pycache__/` 保留。

### 2026-09-27：同一操作的退役事后观察接通，保留整项未完成状态

承接 `dbbcffdd`，沿用原Task4 BASE `844c2ced`。没有重新核对商户、查询订单、支付或登录PayPal；微信历史签名证据继续使用下节记录。

新增 `createFirstCutoverRetirementObserver`：在副作用前核对实算旧版摘要并保留原审核基线，之后将真实持久journal的具名主机事件、维护入口回执与新鲜双机快照对齐。正常完成的注册/进程树删除、精确启动文件替换、active维护配置不再因与退役前状态不同而一律失败；意图未完成、进程仍存活/回生、无关服务丢失、来源漂移、跨主机/attempt混用、采集期间日志/入口变化仍拒绝。详情及限制见[现场接口](../../ops/browser-first-cutover-host.md)。

独立Sol只读审查发现两项P2，已先复现RED后修复：①同阶段journal写入原投影不变，增加完整持久字节 `recordDigest`；②原属组非0的启动文件被root临时文件替换后属组丢失，实际写入器在rename前保留原GID并检查。同一审查席复查确认这两项解除，仅认可本批提交，不认可整项合并或部署。另补基线采集期间维护回执变化的真实RED→GREEN。

最终完整浏览器测试 **608/608，0跳过**，`/tmp/holaday-retirement-browser-with-age.log`（显式 `CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age`，临时合成密钥）；离线只读挂载Linux关联测试 **183/183，0跳过**，`/tmp/holaday-retirement-linux-final.log`。完整 `test:ops` 退出0，组120/59/16及后续416通过、27个未设置age环境的条件跳过；这27项已在上述完整浏览器测试实际执行通过，不能把ops本身说成无跳过。最终8代码文件Biome和diff-check通过；本轮未重跑应用全量/数据库恢复，因为未改应用、SQL、数据库比较或加密运输实现。

新增隔离实体文件QA `scripts/fixtures/browser-retirement-observation-linux.mjs` 实际执行startup写入器与持久journal，验证root:998原文件替换后仍保留GID998、剩余对象字节不变、缺失备用文件仍缺失、新鲜事后读取通过、随后真实磁盘篡改被拒绝。无网络、最小CHOWN能力、一次性容器，退出0并自动移除，日志 `/tmp/holaday-retirement-physical-linux.log`。双机进程/PM2数据仍为合成场景，**不是整流程生产演练**。

初次本地全量回归遇到既有Unix socket沙箱EPERM，授权重跑；首次Biome写文件也需外部worktree权限后重跑。没有为这些环境限制放宽代码。最终全量测试已覆盖其后补丁。唯一原有未跟踪 `scripts/__pycache__/` 保留。无生产服务、数据库、支付、密钥、UI、扩展、模型路由变更；没有PR/合并/部署。

**下一步仍按原Task4–6**：连接完整受保护site I/O，特别是在途stop轮询、无管理器网关退出、候选启动/恢复入口后的新身份观察，以及实际source/restore计划和首次shell；完成真实整流程Linux成功/故障矩阵与非PayPal恢复门槛，再做全分支审查及首次切换。本次接口只覆盖已完成退役的事后观察，不能单独填充整个 `readHostInventory`，不能把无unknown当停写/全部退出/已隔离。Task4/5/6仍部分完成，不新增旁支或重做已验证事项。

### 2026-09-27：微信历史证据收口，原配置复用

用户纠正“以前测试过，不要重复劳动”。已从两个原支付release只读找回相同AppID/商户号，并与9月26日线上配置指纹相符；不要再问用户要相同编号，不把微信当新接入。原微信completed1/pending3本轮取得4份真实签名查单：1SUCCESS金额/币种/交易号与本地一致，3CLOSED无交易号且省略金额；前后DB范围与配置稳定，没有任何付款/业务写入。关闭响应缺amount暴露的是新增只读查询工具兼容问题，非原支付失败；仅修改查询器与测试，16新增覆盖、缺字段用例RED→GREEN，国内支付99/99与types、脚本严格tsc、Biome通过。原始签名证据离线复验3closed+1settled，没有重复外部查单。详见[支付证据最新节](2026-09-25-browser-first-cutover-payment-evidence.md)。

下方历史“微信商户资料仍缺”不再代表当前编号/历史订单核查状态。它们仍不能替代首次切换恢复演练，Task4/5/6依旧部分完成，Task4 BASE844c2ced不变。下一工程项仍为双机现场I/O及退役后阶段观察、首次shell，随后真实全流程Linux矩阵/支付恢复/整分支审查与候选清单。此轮未实现这部分host接线、未部署，不把支付核清偷换为整项上线完成。PayPal延期、唯一旧任务取消、原密钥保管均不重做。

### 2026-09-27：真实跨机密文运输通过；支付演练同意，商户资料仍缺

从8c6f0572继续，用户“同意”批准本人小额付款演练，具体金额/步骤仍需先确认；未付款/退款/建单，PayPal不恢复。后续“允许和授权所有需要的操作”明确回应真实无业务探针请求，包含本大项必要操作；不等于允许绕过微信站点工具安全策略或代替用户付款。

在既有age/backup模块补齐源密文读取、私密接收与固定SSH下载，源/目标绑定attempt、公钥摘要、文件摘要和准确字节数，等待SSH最终退出才发布密文。拒绝私钥/额外host参数，错误/截断/超长/EOF后失败不返回可解密artifact，不自动覆盖或重试。实际MySQL安全路径现在先传到独立恢复目录再解密导入；私钥只放恢复目录。新增12项测试先RED后GREEN，无新RPC框架、支付路径或部署绕过项。

完整发布回归577/577、ops120/59/16/408及shell全部通过、0跳过；Linux Node22 UID998离线相关54/54；真实age+传输+MySQL恢复+原61SQL为2/2。应用Node73/73、Vitest507文件8597通过/1既有CDP条件跳过；types/build退出0，4文件Biome和diff-check通过。初次发布回归受沙箱Unix socket EPERM影响11失败，获准重跑后577全通过，未改测试/放宽校验。首次传输代码patch权限审核超时未执行，工具允许后精确重试成功。日志 `/tmp/holaday-backup-transfer-{browser-final,ops-final,linux,mysql,types,app,build}.log`，RED/失败日志保留。测试容器与网络58f941be92d760a3已核对标签清理，原3306MySQL/Redis未动。

真实探针首次被权限审核拒绝，未绕过；取得上述具体用户授权后执行成功。UTC08:46:23.446，276字节密文SHA50289a79...ba2240，经正式SSH链路从Vultr下载到Mac并用原本地私钥解密逐字一致。服务器只新增一个无业务加密探针目录，完整路径/摘要/实际代码SHA见[恢复证据](../../ops/browser-backup-recovery.md)。不含生产数据、无DB/订单/权益/服务/部署操作，私钥未上传。QA脚本和原始证据不提交Git，不再把该探针授权作为阻塞。

Task4/5/6仍部分完成，原BASE844c2ced不变。剩余固定完成线：完整受保护site I/O/阶段观察与首次shell、真实整流程Linux成功/故障矩阵、非PayPal商户及支付恢复证据、全分支独立审查/最终候选清单/生产切换。运输组件和探针不是整项完成；没有PR/合并/部署声明。唯一旧任务取消、Sandbox延期、密钥USB保管不重做，保留原__pycache__。

### 2026-09-27：双机 journal 与数据库比较本轮收口，整项仍未完成

承接本轮完整MySQL比较/旧版来源绑定，修复整链组合中的实际接口冲突：原journal仅支持单机一组startup/registration事件，而两台主机存在同路径、同数字PM2 ID。现在按固定host分别跟踪事件，保存同一持久时间序列；Vultr生产者与Aliyun网关可在各自正确阶段退役。单机旧接口保留，但不允许混合本地/具名主机模式。全部已开始批次必须完整，重复/错误payload/未知host拒绝。它不是实际SSH副作用已执行，也不能代替现场适配证明两机全部目标。

4项新增测试先RED后GREEN；最终完整浏览器565/565、0跳过，全ops退出0（120/59/16/396及shell）。Linux Node22、UID998、离线、仅只读scripts挂载的相关106/106通过。最后再跑真实age+MySQL恢复及全61SQL，2/2通过、0跳过，源库不变，危险0042样本仍拒绝。日志 `/tmp/holaday-two-host-journal-{browser,ops,linux,mysql}.log`。专用容器 `holaday-first-cutover-qa-742db619c836ef50` 和网络已按标签核对并移除；上一个921a88d73f6be025也已清理。现有3306MySQL/6379Redis未动。本节未重新宣称应用全量测试，应用Node73/Vitest8597及types/build结果属于紧邻前一批明确记录。

剩余完成线固定为原Task4–6：①完整现场I/O、Mac密文运输/恢复及首次shell；②真实整流程Linux成功/故障矩阵；③非PayPal支付外部证据；④独立整项审查、候选/部署清单及获准后的生产切换。不得新增旁支功能、复做密钥保管/唯一旧任务取消、把组件测试数量当发布成功。生产商户截图及用户本人小额支付演练仍待用户输入，微信后台工具策略拦截不得绕过；没有支付/退款或生产变更。

Task4 BASE仍844c2ced，Task4/5/6均部分完成。保存本轮确定的代码与证据，不使用task-done或任何发布通过标记。生产现场接线和整流程验收尚有工程工作，不能向用户解释为“只剩支付授权”。

### 2026-09-27：完整数据库比较与旧版身份绑定通过，微信后台工具访问被拦截

用户要求“继续 直到这一大项完成”；本段不宣称整项完成。恢复自7277eb66、同一隔离分支，Task4原BASE844c2ced不变，没有另开分支或重做已完成的密钥备份、单任务取消、PayPal延期。

新增正式MySQL快照/比较器，接入实际加密备份协调器的合成恢复测试，核对表/视图/触发器/事件/过程/函数、完整列和行、迁移后所有原始业务列，而非只比较少数支付字段。只读事务结束ROLLBACK，无损类型和业务字面量保护；61SQL未改。首次真实测试暴露database别名未引用的1064语法错误，定位后修复；危险0042样本仍必须拒绝且全快照不变。新增21项比较器用例；最终真实age+MySQL+61SQL为2/2、退出0，日志 `/tmp/holaday-cutover-current-mysql.log`。

旧版来源读取函数将真实双机通道、既有受保护review分类、准备阶段返回协议组合，摘要实算绑定旧提交/物理进程/管理器/监听/来源；时间刷新和采集PID更换不改身份，来源或PID启动时间变化会改摘要。7项用例先缺函数RED后GREEN，相关110/110。生产review仍未完成，未自动生成“全部已批准”的清单；只读检查旧归档的部分启动入口，不等于新鲜全依赖审查。双机副作用/阶段观察、跨Mac恢复运输和首次CLI仍缺，不能把新增函数当完整site adapter。

最终验证：浏览器561/561无跳过；全ops120/59/16/392及shell退出0、无跳过；Linux Node22离线只读scripts、UID998为78/78；应用Node73与Vitest507文件8597通过/1既有 `playwright-executor.cdp-auth.test.ts` 条件跳过；typecheck/build退出0，触及5代码文件Biome通过。第一次ops正好在新增来源测试的RED阶段读到缺函数，退出1，随后完整最终ops退出0，旧失败日志保留。日志 `/tmp/holaday-cutover-current-{browser,ops,linux,mysql,build}.log`、`/tmp/holaday-mysql-adapter-{app-all,types}.log`。测试容器 `holaday-first-cutover-qa-921a88d73f6be025` 和专用网络已移除；现有3306 MySQL/Redis未动。

浏览器核验按只读流程，未访问PayPal。清单工具第一次请求头策略加载失败，按工具要求重试后取得Chrome标签列表；随后尝试打开 `https://pay.weixin.qq.com/` 被site-safety策略明确拒绝，且工具禁止换浏览器/CDP/命令行或间接通道绕过。未打开微信商户页面、未读取商户配置/交易、未登录、未付款。这不是微信账户密码错误或Holaday故障。需要用户自行在商户后台提供商户号/AppID核对截图（不要密钥），本任务不能绕过工具策略访问该站。另已异步询问用户是否愿意本人完成小额支付恢复演练，尚无答复；不得将此前模型测试费授权外推为代付款/退款许可。

仍未完成的大项：完整site I/O及首次入口、整流程Linux演练/失败矩阵、非PayPal外部支付恢复证据、全分支独立审查与部署清单、实际生产停写备份/切换。没有生产服务/配置/数据库/支付/权益/额度/浏览器profile/私钥变更，没有PR/合并/部署，不新增旁支产品功能。下一步接已有模块的真实现场操作链，不再以组件通过数量代替完成定义；微信外部证据只走用户提供的安全输入。

### 2026-09-27：原自动化方案继续，双机只读通道进入正式模块

用户明确“我认为你要实现的自动化系统的方向是对的，按原方案来完成”。不采用上一轮讨论的手工切换替代；按原Task4–6收口，PayPal延期、已取消的唯一旧任务、恢复私钥USB保管结论保持，不重做、不扩项。Task4 BASE仍为844c2ced，恢复前HEAD63cd1386，既有`scripts/__pycache__/`保留。

本次在既有first-host内实现真实`readFirstCutoverHostPair`：固定目标/跳板、严格SSH主机校验、stdin运行既有collector、随机请求绑定、自身PID身份、双机全量返回及最后统一时效检查，失败不重试。Vultr旧checkout前后HEAD/已跟踪diff检查只证明源码来源。既有inventory增加双机配对，复用单机分类器、核对boot，保留所有unknown；没有生成或自动批准生产review。新增observer测试进入日常`test:ops`。

真实只读调用成功：UTC07:39:43.984起，旧checkout107857fe70503e30691073f267d87275596edb20，collectorSHA30d6dc866a3f7563e0e5dde7c0206fa7f74fb0e583849b65b72204e8561d306a。阿里云12进程/2PM2注册/223来源，Vultr28进程/9注册/265来源；原始`/private/tmp/holaday-first-site-pair-Cuj0Xo/pair.json`在0700目录、0600文件。没有写远端文件、停服务、改nginx/防火墙、读写业务库或访问任何支付方。该历史快照不是部署时的有效许可，source数量不是审核通过数量。

TDD：首次15个observer用例因缺函数RED；双机分类11新用例RED；checkout绑定与实际stdin载荷3RED，随后通过。基线129/129，新专项50/50；完整浏览器533/533无跳过（显式已有age），Linux Node22.20离线只读scripts/UID998为50/50、容器自动移除。全量ops结果待本段后续记录。触及4个MJS文件Biome最终通过，初次2个测试用delete风格错误改为等价缺字段夹具，无生产校验放宽。日志`/tmp/holaday-first-site-{baseline,red,classifier-red,source-red,targeted,browser,ops,linux22}.log`。

最终ops退出0：120/59/16/364和全部shell检查通过，0跳过；上方“待后续记录”已由本结果替代。文档patch首次权限审核超时、未执行，按工具许可原样重试一次成功。所有测试和SSH会话已退出，Linux容器已自动移除；应用TS/前端/模型/支付结算/额度代码未修改，本轮未重跑应用全套，不复用上一轮结果。先提交本次接线及证据，不把它标成整个分支验收完成。

仍未完成：生产受保护完整分类清单及阶段变化观察、双机副作用I/O/首次shell、真实停写后的备份恢复、剩余非PayPal外部证据、全流程演练与全分支审查。当前只读通道与分类不是整个Task4完成，也不是自动化系统已部署。不得把上方真实读取成功改述为双机切换成功。

### 2026-09-27：唯一 PayPal Sandbox 延期例外已批准并落实到候选

用户回复“可以”明确批准上一轮提案：只将已知旧Sandbox测试单保留为“未核验、上线后处理”，不再阻塞本次发布。不是所有PayPal/测试单豁免，也不是恢复登录、商户/API核查的许可。下方“延期提案待确认”已失效。设计、计划、支付证据与host接线契约已同步。

本地采集器和应用readiness只接受固定记录指纹 `75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95`、批准引用 `paypal-sandbox-20260927`，需要受保护inventory绑定且新PayPal支付关闭。读库函数保持完整计数和分页，精确旧记录单列deferredUnverified；其余订单仍要求真实核验，出现其他PayPal记录直接拒绝，不访问PayPal解析器/API。延期项参与数据库source摘要与两次稳定性比对，provider-query摘要只绑定实际查询的订单，不伪造未核验项的回执。

本轮从旧私密归档离线复核固定指纹并通过实际reader（仅数据库边界使用测试double），未读生产数据库/SSH/浏览器或访问支付方。这不证明当前生产记录仍未改变，部署现场仍需只读比对。测试先见缺失延期支持的RED，再见“换成另一记录仍通过”的RED；实现后采集器87项、两组readiness46项通过。初次Vitest被工作树写权限拒绝，获准后运行；另一次权限审核超时未执行，原样重试成功。无支付状态、权益、额度、SQL、UI、扩展或模型路由修改，无部署。

最终验证：完整浏览器505/505无跳过（首次未指定age有15项跳过，显式指定已有age后完整重跑）；完整ops退出0，分组120/59/16/336和shell均通过、无跳过。orchestrator Node73/73，Vitest507文件8597通过/1既有`HOLADAY_SYNTHETIC_CDP_DEBUG_CHILD`条件跳过；类型检查、构建、触及四源码/测试文件Biome和diff-check通过。Linux Node22.20.0采集器87/87无跳过：第一次容器默认root运行使测试夹具applicationGid=0，被既有发布器正确拒绝；定位后仅改用镜像已有UID/GID998重跑成功，无生产校验放宽。容器无网络、仅只读挂载scripts、无生产凭据、结束自动清理。

日志：`/tmp/holaday-deferred-{browser-final,app-all,types,build,ops-final,linux22-final}.log`；失败/RED日志同前缀保留。Linux镜像ID `sha256:43e32ddaf0de5743635ec79acd32940d32151fd495ad6e642100b935fd3776bf`。全部本轮测试会话已退出，既有`__pycache__`保留；源码验证不等于真实支付方核验、线上隐藏已部署或完整首次切换演练通过。

仍未完成：Task4真实双机现场I/O与首次shell、Task5生产新鲜备份/隔离恢复及剩余非PayPal支付外部证据、Task6完整演练与全分支审查。Task4原BASE844c2ced不变，禁止重新取消已处理旧内部任务或重新复制私钥。本轮限定变更完成后沿此固定列表接续，不把延期专项当整项上线就绪。

### 2026-09-27 15:59 JST：已授权的旧内部任务取消完成，PayPal 全部暂停

用户“2允许 不是不弄paypal了吗？”明确批准仅取消 `tsk_r3W3wh5LMNbJcgGDRi22D`，随后确认 PayPal 登录失败、暂不处理。**不再访问 PayPal 页面、登录、订单查询、商户配置或 API**；下方历史继续登录/等待取消授权的下一步已失效。PayPal 新支付仍按候选关闭；历史订单不改状态、不删除、不伪报验证通过。

生产预检 UTC06:53:51：任务仍为6月24日内部 explorer/running，原行摘要 `cae3886f4c98e77dd9cb62515b60d590513811e29fe71ea7ef49c539bcde32f4`，14条操作、22条LLM调用、0条事件。一次性脚本固定目标，在行锁和原行/关联记录摘要匹配后，事务仅更新 status/updated_at/completed_at 并插入 `task.cancelled` 事件；四表均 InnoDB，tasks/task_events 无触发器。未扩大普通用户取消接口、冒充用户、重跑或改成成功。

先验证缺模块RED，再用独立 MySQL8.0 合成库测试：原行变化、错误origin、关联费用变化均拒绝；事件插入失败整体回滚；成功只改变目标；重复执行拒绝、无重复事件。1项包含上述断言的真实数据库集成测试通过，无跳过，不是全套产品测试。

UTC06:58:36.178 生产事务提交；独立只读连接 UTC06:59:38.315 验证状态 cancelled，原行仅三个预期字段改变，事件恰好新增1条 `tev_cancel_explorer_20260927`。14条操作摘要 `f93e6a117185216ce31f511b8ff70dcb55d084e6888f21a20c525459e4a1b27f`、22条LLM记录摘要 `8a1b33379f6001ee13a7e6338791353279707c56725aa864e3bfa13d2a673270` 前后完全一致。只处理这条内部残留，不证明六月历史根因或全部外部副作用。

私密原始证据、一次性代码与测试：`/private/tmp/holaday-explorer-cancel-85Gvr3/`；before.json SHA `299c588a741a1adc5e928c684916d95bc6e6368880a9c2f83467a592c074dbf8`，after.json SHA `25930d5bb78ff8b2a6749de685f338bd5b20053bbb74d48081f9b75bd568513b`，cancel.cjs SHA `f041a3555dedba171a6a50ac1c5871d7bcc752ace8078d94e08fa1facc1aa32a`。执行意图及回执均排他创建/fsync；禁止重跑已提交的一次性命令。未查询支付表、未改支付/权益/额度、未停生产服务、未部署。既有 `scripts/__pycache__/` 保留。

当前发布代码仍要求全部支付范围已核清，不能自行把历史 Sandbox unknown 设成已核验。已提出**仅精确旧 Sandbox 测试单以“未核验、上线后处理、原记录保留”延期，不阻塞本次发布**的范围调整，等待用户明确决定；未修改门槛或订单。完整host现场I/O、备份恢复/首次shell/整项验收仍沿原Task4/5/6继续，未声称大项完成，不重新做Task1–3。

### 2026-09-27：续期依赖只读核查及旧任务处置边界

从`ef05fe4d`继续，没有重复复制私钥、重做Task1–3或增加发布框架。PayPal Chrome登录页仍未登录；浏览器清单首次请求头策略加载失败，工具提示重试后恢复，实际页面仍为邮箱表单，不是Chrome权限永久失效。已重新保留该页，未猜测账户/密码、解验证码或调用支付接口。

两机启动依赖定向核查结果见[主机审计](2026-09-26-browser-host-readonly-audit.md)顶部：三域名实际采用Certbot，Vultr为nginx installer，Aliyun为webroot。空hook目录不能证明没有配置并发影响。原始私密归档`/private/tmp/holaday-renewal-dependencies-xsb3TU`。没有更新证书、停调度或改nginx/PM2；完整来源批准和现场接线仍未完成。

检查候选现有`tasks.abort`与`TASK_ACTIVE_STATUSES`发现普通取消接口不接受旧explorer的`running`，且接口按当前user/origin限定；不能为这条历史记录放宽普通用户接口或伪造调用者。已明确请求仅将`tsk_r3W3wh5LMNbJcgGDRi22D`标为已取消、保留动作与费用记录、不重跑/不改成功的定向处置许可。等待用户明确回答；本轮没有数据库写入，也未实现未经批准的修复命令。原6月运行版本和全部外部副作用仍未被此源码检查证明。

修正host说明中“仍待可写私钥介质”的过期描述。仅核查/文档变化，未重跑产品测试，未PR/合并/部署；旧`__pycache__`保留。下一步需在原Sandbox登录/商户依据和精确旧任务处置授权到位后完成相应核对；独立的完整host/恢复/首次shell/整项验收继续沿原计划，不能声称本次已接线完成。

### 2026-09-27：授权的旧记录核查与 Yalei 私钥副本

从 `2c1334854663ef1728fd552f6187b6812142a6f4` 继续。用户“都允许 私钥副本存到U盘 Yalei”明确回复上一轮三个问题：单条旧 PayPal Sandbox 记录及商户归属只读核查、单条6月24日 explorer 操作记录只读核查、独立 USB 私钥副本。不是改订单/任务终态或进行扣款的授权；不重复请求这三项许可。

Yalei 副本已完成：`/Volumes/Yalei/HOLADAY-recovery-20260927`，原私钥、公钥、无业务数据探针逐字节相同，U盘私钥导出公钥一致且实际探针解密成功，Mac原件保留。恢复说明已写入并读回。该盘为未额外加密的 ExFAT，已提醒安全弹出、物理离线保管；没有格式化、改盘权限或自动卸载。详见[密钥记录](../../ops/browser-backup-recovery.md)。不要再把“未提供可写备份盘”列为阻塞；真正生产备份及隔离恢复仍待执行。

UTC `06:18:03.159` 在 Vultr 用只读一致性事务核查精确两条业务记录。原始结果仅在 Mac 0700目录/0600文件 `/private/tmp/holaday-authorized-legacy-review-zDa2mv/review.json`。旧任务明确为 Figma 免登录只读探索，14条记录是3次导航/11次点击，未见填写或支付记录；采集为best-effort且动作序号不连续，不能推为完整零副作用证明。任务仍running，未取消、重跑或改为成功。

旧 PayPal pending 为4月26日 Sandbox $9.90，无capture ID，metadata只保存sandbox环境。当前配置为Live且缺少独立merchant ID，不能混用凭据验证旧单。已按授权恢复一次 Chrome 开发者后台核查；初次登录页只显示Logo，刷新一次后显示邮箱登录表单，没有有效登录态。页面已保留并请用户自行登录，未输入未知账户、解验证码、改密码、创建应用或调用支付API。详见[支付证据](2026-09-25-browser-first-cutover-payment-evidence.md)。

本轮无产品代码变化或新增产品测试通过声明；生产只读，无服务/配置/订单/权益/额度写入，无部署。新QA只读脚本忽略、不提交；原`__pycache__`保留。Task4/5/6及整分支审查仍未完成。下一步继续真实来源/依赖审查、双机现场I/O与恢复接线；旧任务需要明确处置授权，PayPal需要原Sandbox应用/商户依据，不以自动清理记录放行。

### 2026-09-27：原始主机清单接到既有定向退出接口，整项仍未部署

本轮从 `cd7046f9` 继续同一 Task4/BASE。新增 `browser-first-cutover-inventory.mjs`：用真实主机快照和逐对象/来源审查，把受管目标、未托管目标、保留的浏览器/VNC/其他服务分开，输出可供现有 `captureLegacyRegistrations` / `captureLegacyRuntime` 校验的清单。未知或漂移对象保留为阻塞，不从列表中过滤掉。该模块不批准执行、不停止服务、不生成就绪回执，尚不是完整双机 site adapter。

修复接线实测暴露的缺口：采集器提供与删除接口一致的 PM2 配置摘要和显式停止超时，采集末尾复查 PM2，配置/环境/cron/PID漂移拒绝，只有堆/延迟仪表的变化不算配置变更。另只读核对实际 daemon 版本、已安装 PM2 6.0.14 的默认参数及 daemon 环境中的两项停止参数，不输出其他环境。主服务 4002 WebSocket 监听必须和 4001 一起纳入 Vultr 范围，阿里云仍必须同时覆盖4010/4011。没有新增部署绕过开关。

双机在 UTC05:50:30/36 实采成功，Mac私密归档 `.../holaday-live-host-observer-bA6yUF`。候选分类（不是执行批准）：Aliyun当前网关5个进程，保留orangebench3个；旧4011两个未托管进程仍待职责核清。Vultr主进程/worker两个目标、PID0但仍小时调度的files-cron注册；保留24个其他进程。源码/版本最终复核见下方追加结果。原始来源仍须完整审查，不能由程序生成全部“已审”理由来消除未知项。

UTC05:54:18仅查询任务与调度，明确排除全部支付表：6月24日explorer任务仍running，14次浏览器操作、22次模型调用，未自动取消或改终态；2个未来计划仍active。已一次性询问旧PayPal记录的只读核查许可、单条explorer操作记录核查许可，以及可写离线私钥备份位置；回复前不恢复相关动作。旧PayPal问题沿用此前证据，未在本轮访问支付方或查询支付表。

测试：首次完整浏览器回归476通过/15条件跳过；发现未设置既有age测试变量后重跑，492/492通过、无跳过。清单22项含正向接入原capture函数、未知进程/来源/监听拒绝、完整树与保留浏览器、4002遗漏等。Linux Node22针对性109/109通过。完整ops退出0（120/59/16/330及shell）；orchestrator完整测试退出0（Node73，Vitest507文件8595通过/1既有CDP条件跳过）。最后daemon版本核验后的最终日志为 `/tmp/holaday-inventory-browser-final2.log`，其他日志 `holaday-inventory-{application,ops,linux}.log`。无新MySQL全流程/生产备份/整分支审查通过声明。

剩余必须按一项收口：受保护的真实清单与启动依赖审查、双机生命周期/数据库/支付/备份传输的实际I/O和首次shell入口、真实恢复/支付演练、整项审查和部署。当前不能把“单元/应用测试通过”当成“首次切换已完成”。保留既有 `scripts/__pycache__/`；没有生产配置、服务、防火墙、数据库、支付、浏览器profile或私钥变更。

最终双机实采UTC06:04:32/37再次成功，运行daemon与安装版本一致，归档 `.../holaday-live-host-observer-aJmL6H`，摘要见主机核查。最后代码版浏览器492/492、Linux109/109均通过，无跳过；五MJS Biome及diff-check通过。未把未审来源数量归零，未写受保护上线批准文件。

最后完整ops重跑退出0（120/59/16/330及shell，无跳过），`/tmp/holaday-inventory-ops-final.log`；全部SSH/测试会话已结束，Linux测试容器自动删除。本地八文件检查点，不含原始证据/密钥/忽略QA/旧缓存；不创建或宣称可部署PR。

### 2026-09-27 14:24 JST：启动来源采集接入，双机实际主备差异核实

继续同一Task4/BASE，不重做备份或新建发布框架。原evidence模块加入固定范围 `readCutoverStartupSnapshot` 并接入真实host采集；PM2主备、有效systemd源文件/本地与运行时树、系统与用户cron、rc.local及实际启动脚本双读校验，原文只留Mac。两台主机实际成功，原始归档 `.../holaday-live-host-observer-9ILKHc` 及准确摘要/范围见[主机核查](2026-09-26-browser-host-readonly-audit.md)顶部。实采观察器身份单独记录，不按root Node名称猜排除。

现场裁决：Aliyun支付只在主dump中，备用只有orangebench；Vultr主备都有stopped但仍按小时调度的files-cron，因此沿已有定向条目处理接口，不用全局PM2save/delete/kill。旧headed-browser启动脚本清理会话恢复文件；保留浏览器进程，不随应用一起重启，不把会话文件等同Cookie。无服务/配置/业务修改，无浏览器profile或私钥读取，无部署。完整职责分类/双机I/O/恢复/历史业务/首次shell/整项审查仍未完成，Task4/5/6仍部分完成。

测试：新增函数缺失RED后实现；再实测五个启动依赖遗漏RED，加入真实已观察路径后GREEN。最终Mac证据72/72、全部浏览器发布脚本461/461；Linux Node22证据72/72，容器root:998、无网络、只读源码、临时/tmp，结束自动删除。首次Linux为71/72：既有publisher夹具取默认容器GID0而产品要求正数applicationGid；核清后仅调整容器GID998，未放宽产品校验或删除用例。原完整ops先跑退出0；新增证据文件接入日常ops门槛后另记最终结果。没有应用全量或新MySQL整流程通过声明。

两次权限审核超时均未执行：浏览器回归命令和五条固定路径patch，各按工具许可原样重试一次成功；SSH只读两次均成功。保留既有`__pycache__`。本次包含上轮未提交的精确root-crontab缺失修正与记录，未覆盖其他改动。

最终门槛已完成：加入evidence后完整`pnpm test:ops`退出0（120/59/16/299及shell，均无跳过），日志`/tmp/holaday-startup-observer-ops-final.log`；两MJS Biome、Node/bash语法与diff-check通过。所有本轮SSH/测试进程已退出，Linux容器已自动删除。五个跟踪文件作为本地检查点保存，未push/PR/合并/部署，未将此子项标为整个首次切换完成。

### 2026-09-27 13:58 JST：具体只读授权已获准，双机快照成功

用户明确回复“允许上述只读采集”，前节权限阻塞已解除；经严格SSH传送原采集模块在两台指定主机内存执行，原始结果只存Mac私密临时目录。首次Vultr成功、阿里云拒绝，诊断确认为root无个人crontab的code1被误判；按TDD新增13项，真实RED4项，最小修复精确缺失识别、显式present字段和前后复核，权限/异常输出/中断仍拒绝。

修正后阿里云与Vultr均实际成功，UTC04:58:35/04:58:40，源码SHA`4c054eefe12f88ec8ab49b423b5a5e2087435453805d42bb6b5e73818aa48b83`，原始文件`/private/tmp/holaday-live-host-observer-sVf60k/{aliyun,vultr}.json`，0700目录/0600文件。事实和摘要见[主机核查](2026-09-26-browser-host-readonly-audit.md)顶部；4010/4011仍在，Aliyun PM2 unit inactive但enabled，不能据此跳过持久启动源。没有停服务、改配置/防火墙、读取数据库或支付方、读取恢复私钥、部署应用。

针对性59/59、完整浏览器448/448通过且无跳过，两MJS Biome通过。首次全浏览器11项Unix socket EPERM，获准后原样完整重跑通过；不是代码失败被忽略。完整`pnpm test:ops`最终退出0，日志`/tmp/holaday-host-crontab-{red,browser,browser-final,ops}.log`；ops初次权限审核超时未执行，按许可原样重试一次成功。diff-check通过，所有SSH/测试会话已退出；本轮未重跑应用全套、Linux或MySQL演练，不复用历史数字。已有`__pycache__`保留，Task4原BASE844c2ced不变，Task4/5/6仍部分完成。下一步沿现有适配接口分类真实进程/启动源/路由并组装双机，不重做age/主流程；观察器自身身份及系统cron/其他用户等仍需覆盖，现有历史快照不能当部署实时许可。

### 2026-09-27 13:17 JST：现场基础摘要刷新，完整只读采集等待具体授权

从`fdc8249b`继续。仅阿里云既有脱敏诊断实际执行成功，观察时间`2026-09-27T04:17:33.411Z`：4010仍由PID1098048监听、现用PM2 id1的根进程1097924及包装树存在；4011仍为独立965039→965055旧树，身份/路径与此前一致。现用`orangebench`仍online，PM2 daemon仍在；阿里云`pm2-root.service`显示inactive/dead，不应与Vultr此前active状态混为一谈。采样时4010/4011 established计数为0、iptables-save为空；不代表完整排空、业务无副作用或公网入口已隔离。没有停止/修改任何服务，也未查业务数据库或支付方。

准备的忽略诊断脚本`qa/live-host-observer-20260927.mjs`拟将现有`browser-cutover-evidence.mjs`经严格SSH传入两台主机的Node内存，只调用只读采集器，完整结果留Mac私密临时目录。该远程命令被自动权限审核拒绝，理由为完整内部源码载荷及接收地址缺少具体用户授权。随后只读核对`deploy-cn-payment.sh:7`和`deploy-current.sh:27`分别固定这两个生产目标；附证据原样重审仍被拒绝。未换通道、未缩减/改写远程载荷绕过拒绝，也未执行该脚本、创建其临时归档或远端文件。

已向用户异步明确请求：允许将上述采集器发送至阿里云`47.99.169.186`及Vultr`207.148.70.106`只读采集进程/端口/启动与nginx配置，原始结果仅留Mac私密目录；等待实际答复，预选项不构成同意。下一步获准后运行这次原样验证，不重做主流程/age或扩大支付操作。此轮只有基础只读核查和文档，未新增产品代码/测试通过结果，Task4/5/6仍部分完成；保留既有缓存与未提交的本次记录。

### 2026-09-27：首次主流程与既有模块接通，真实双机现场适配仍未完成

从`6eee28fd`继续，新增`createFirstCutoverHostAdapter({attempt},io)`，复用真实候选准备、同一journal、证据采集、备份协调器/回执、首次状态与共用transition尾段。受保护批准提供全部身份和窗口；不伪造旧boot，不增加成功开关或默认生产执行。接口与剩余生产组装见[主流程说明](../../ops/browser-first-cutover-host.md)。Task4原BASE不变，Task4/5/6仍部分完成。

本次真实RED：18项初始组合用例因缺factory失败；补充停写丢失用例证明原接线仅查退出、不查入口，修复后通过；另4项证明过期/残留socket/内部writer未拒绝及并发stage进入两次，修复为完整停写复核与await前保留一次性动作。主机测试53/53通过，实际临时journal/回执/bootstrap文件参与；远端执行、数据库与支付仍合成，不冒充真实双机演练。迁移超时不重跑，已知dirty候选关闭，恢复入口超时仍close，reconcile意图不等于成功，丢open ACK不重复open均覆盖。

本轮完整`node --test scripts/browser-*.test.mjs`为435/435、Linux Node22无网络只读源码组合173/173、完整`pnpm test:ops`退出0（120/59/16/227及shell），全部无跳过。Linux使用已有age QA镜像且容器自动删除，无生产挂载/网络/密钥；未新增MySQL现场或应用全套测试声明。日志`/tmp/holaday-first-host-{wiring-red,fence-red,boundaries-red,wiring-final,browser,linux,ops}.log`。两个MJS已格式化；新增三组进入日常运维门槛。一次测试patch自动审批超时未执行，按工具许可原样重试一次成功。

最终格式化后再次完整回归：`browser-final.log`435/435、`ops-final.log`全套退出0、两个MJS Biome检查无修改、Node/bash语法和diff-check通过。所有测试会话已退出；按镜像只读确认无残留本轮测试容器。没有将本批测试数与上轮不同命令的测试数直接作增量比较。

裁决：factory参数收窄为已批准attempt，避免重引CLI可覆盖候选/窗口；现场接口保持强制、无默认值，未连接时在构建/锁之前拒绝，代价是此批接线仍不能作为生产CLI。完整双机controller/受保护清单/transport/真实恢复目标/旧任务及支付核对/首次shell/整项独立审查仍是下一阶段，不能重复已经完成的age或主流程工作。本轮无SSH、生产数据导出/修改、真实私钥读取或再生成、PR/合并/部署；既有`__pycache__`保留。

### 2026-09-27：实际age文件适配已接入原MySQL备份恢复编排

从`c9e30a68`继续，没有重新生成/读取用户恢复私钥，没有生产连接。新增窄文件适配`browser-backup-age.mjs`，从原backup模块导出：固定工具/公钥摘要、规范私密目录/文件、独占partial和不覆盖发布、源进程完成要求、密文hash、完整age认证后才发布verified SQL。无自研加密格式、自动keygen、生产CLI或成功布尔；缺host的真实停写/隔离证明仍拒绝。解密失败可能保留私密明文前缀，不能导入，须由已绑定恢复流程处理；不上传私钥到生产。

既有合成MySQL安全用例已替换QA AES为实际age文件I/O、真实mysqldump流和认证后启动mysql导入，随后仍全对象/全行/业务字段/全61SQL及真实journal回执核验。新鲜MySQL2/2通过，危险0042样本拒绝与原SQL风险证据保留；16项实际age用例通过；Linux Node22无网络只读源码age/backup/journal66/66通过；完整浏览器回归413/413通过。首次浏览器回归11项Unix socket EPERM，授权后原样完整重跑通过；Biome首次受沙箱阻止写入，授权格式化后4文件检查通过。日志`/tmp/holaday-age-{red,permissions-red,final,mysql,types,browser-final2,linux-final,ops-final,orchestrator-final}.log`。原输入/输出权限测试RED发现输出模式变化未拒绝，修复后GREEN，没有削弱断言。

最终完整test:ops退出0（120/59/16/120及shell），后台类型检查、4文件Biome/shell语法/diff-check通过。后台默认全套本轮实际退出0：前置Node73通过，Vitest507文件8595通过/1既有跳过；默认全套仍不包含上面的独立MySQL集成，二者分别计数。新QA容器/网络`holaday-first-cutover-qa-c271a9d7fe690ab2` / `holaday-cutover-mysql-c271a9d7fe690ab2`已移除，删除前确认临时库为0，Linux测试容器自动删除，所有本轮测试会话已退出。既有3306/Redis和缓存保留，镜像留作复现。

范围裁决：复用正式批准的age工具格式，将实际文件I/O接入既有编排测试，而不是把上轮加密探针冒充备份回执；代价是恢复机需私密plaintext暂存并验证足够空间。Task4/5/6仍未完成，完整双主机host/运输/Mac隔离目标/首次shell及整项审查尚待组装；离线副本待可写专用介质。未改历史SQL、结算/权益/额度、UI、模型或扩展，未导出生产数据、PR、合并或部署。

### 2026-09-27：用户允许密钥保管方案，真实公钥链路已配置和验证

用户对上轮恢复私钥留Mac、另做离线副本、服务器只留公钥明确回复“允许”。无需再次请求同一授权。实施详情及恢复须知见[恢复密钥记录](../../ops/browser-backup-recovery.md)：Mac FileVault已开启，独立age密钥已生成于仓库外用户0700目录，私钥0600未打印/上传；Vultr仅安装发行版age包、新建root0700目录并收到公钥与无业务数据探针。公钥及密文双端摘要一致，Mac真实解密/仅公钥拒绝/篡改拒绝/截断拒绝及权限检查均通过。

SMARTLINK已核实为只读FAT12设备，未写入或改变挂载；独立离线副本尚未完成，等待可写专用介质和明确路径。主站mysql/nginx/PM2启动时间未变，未导出数据库、停写、变更订单/支付/配置或部署应用。安装曾因既有父目录为0755而在子目录创建前停止，核对后保留原权限仅创建0700子目录；不是把失败冒充全部成功。Homebrew自动清理旧包缓存/临时残留已告知用户。

本轮仅设施配置与人类文档，未修改产品代码，未新增产品测试结果。已有完整host/首次shell/真实备份恢复/整流程审查缺口仍在；探针不能当生产备份回执。此前“密钥保管等待授权”和“未安装工具”状态已被本节取代，Task4/5/6仍未完成，原BASE与缓存保留。

### 2026-09-27：生产备份设施已核查，恢复密钥保管待确认

从`8025b554`继续。12:25–12:27 JST双主机严格SSH只读核查成功，详见[主机核查](2026-09-26-browser-host-readonly-audit.md)顶部。Vultr具备MySQL/mysqldump8.0.46、Docker、99G可用磁盘；现有私密backups目录只有两份环境配置副本，不是数据库备份。限定路径和调度检查未找到已配置加密/恢复设施，不能外推为全机或云端均无备份。默认socket认证拒绝，未取得数据库身份；既有应用凭据未尝试，不称凭据失效。

这一步等待恢复密钥保管选择：可提供已有设施/加密公钥，或确认专用私钥由用户Mac及独立离线备份保管，生产只留公钥；隔离解密恢复路径也须据此接线。不擅自生成生产密钥，不把QA内存密钥当真实保管方案。未导出业务数据、创建恢复环境、安装软件、停止服务、修改生产配置/规则/订单；所有SSH已退出。本轮仅文档证据更新，无新增测试通过声明，无PR/合并/部署；Task4/5/6仍未完成，BASE保持844c2ced，原缓存保留。

### 2026-09-27：备份编排接入真实发布记录和MySQL组合测试

从`ccdd269b`继续。新增计划内`browser-first-cutover-backup.mjs`，协调受信host的停写、身份/窗口/锁复核、已批准加密设施、export/hash/restore/全对象比对、隔离库迁移、schema/业务字段及源库复核、回执封存。缺少任何真实I/O或设施就拒绝，不接受成功布尔、自动加密密钥、重试/回滚或生产CLI默认执行。实际生产host/加密设施/隔离目标仍未接入，不能把摘要返回值本身当验证事实。

发现并处理既有阶段语义：`backup_verified`原本先persist再执行，因此只是意图。首次journal新增不可重复的`bindBackupReceipt`，复用真实私密文件/fsync/原子rename；未有匹配本次绑定的回执时禁止`migration_started`。普通升级条件未变。范围裁决及代价：回执增记恢复目标/加密设施/schema/业务摘要，旧首次fixture需显式合成回执，真实host必须提供已验证产物；不能以阶段名冒充通过。首次transition已有失败保持维护路径与本模块组合测试通过。

MySQL安全样本已使用真实编排、真实文件journal、实际mysqldump/mysql、QA一次性AES-GCM密文文件、完整对象/数据比对、全部61SQL和实际schema/业务核验；最终2/2通过，风险样本保留原入口拒绝和0042事实。仅本例隔离容器/合成数据，绝非生产备份或正式密钥保管方案。Linux Node22无网络只读源码容器内备份/journal50/50通过；Mac完整浏览器发布397/397通过，类型检查及5文件Biome/shell语法/diff-check通过。新增备份单测接入既有test:ops迁移门槛，不留只可手工运行的回归。

最终完整test:ops退出0（120/59/16/104及shell）；日志`/tmp/holaday-backup-{coordinator-mysql,coordinator-types,browser-final,linux-final,ops-final}.log`。本轮合成MySQL容器`holaday-first-cutover-qa-64b039e2d85a71fc`及专用网络、随机库、临时密文和文件journal均已清理，既有holaday-mysql/Redis仍运行；Linux测试容器自动移除，所有本轮测试会话退出，镜像留供复现。原`scripts/__pycache__/`未动。

初次缺模块RED后实现；真实journal先出现“没有回执也能进入migration_started”的RED，再修复。格式化首次delete提示已修正。一次追加测试补丁权限审核超时未执行，精确重试后成功，不是权限被永久拒绝。Task4/5/6仍未完成；下一步是实际生产host/设施配置、双主机事实和首次shell，最后整流程/独立审查。未改原SQL、应用支付/权益/额度、UI、模型路由和扩展，未连接生产或修改安全组，无PR/合并/部署。本轮应用全量未重跑，不复用上轮8595数字。

### 2026-09-27：0042风险接入真实迁移入口，拒绝而非改写历史数据

从`1b48f90b`继续。既有编号runner在任何写入SQL前及0042前只读检查支付完成时间；已完成记录缺时间、旧表缺列且存在已完成记录、读取失败或status列缺失均返回`MIGRATION_PAYMENT_TIME_UNPROVEN`。新库/仅未付款旧表/完整时间数据可继续。检查置于现有manifest绑定的runner中，两个发布路径均受约束；不另加独立预检框架或绕过开关。代价是命中风险的旧库必须另审迁移策略，不能直接用旧SQL回填。原61个SQL、支付结算/权益/额度、生产数据均未改。

实际隔离MySQL回归RED为旧入口遇危险数据仍resolve；修复后最终2/2通过，安全样本全61SQL及schema/业务保留通过，危险样本及缺列旧表均拒绝且完整快照不变。一次性恢复库单独执行原0042仍证明updated_at漂移，未将该风险改判安全。第一次修复后演练在夹具遗留索引处失败，修正合成旧表后通过。8项入口用例由7失败1通过至8通过；应用及脚本显式类型检查通过，触碰文件Biome和diff-check通过。详细解释/复现见[MySQL说明](../../../scripts/fixtures/cutover-mysql-README.md)。

最终后台完整test退出0：前置Node73通过，Vitest507文件8595通过/1既有跳过；该默认配置仍不包含integration，真实MySQL另跑2/2通过。完整test:ops退出0（120/59/16/73及shell），后台类型检查和额外脚本类型检查均退出0；三个触碰TS文件Biome/diff-check通过，原SQL差异为空。日志`/tmp/holaday-payment-migration-{orchestrator,ops,types,script-types}.log`及`/tmp/holaday-payment-migration-guard-final.log`。一次Biome字符串模板提示已修正，最初被该错误短路的类型命令已实际重跑通过。没有全仓lint、应用build、完整Linux双主机验收或独立整分支审查声明。

新建专用本地容器/网络和随机库已清理，原MySQL3306/Redis保留；所有本轮测试退出。没有生产连接、安全组修改、支付方API、部署或历史记录清理。Task4/5/6仍未完成，完整host/双主机事实/加密备份适配/首次shell与整流程审查仍待接线；本轮不是上线放行。Task4 BASE仍844c2ced，不重跑已完成UI/扩展/模型工作。

### 2026-09-27：控制台登录恢复，云侧4010/4011放行原因已核实

从`fb655e74`继续。用户完成阿里云登录后，真实控制台确认目标杭州ECS与安全组，目标实例聚合入站规则含优先级1、0.0.0.0/0、TCP1–65535允许，另有优先级100的SSH/RDP/ICMP允许。具体资源、证据限制、官方优先级及组内互通语义见[主机核查](2026-09-26-browser-host-readonly-audit.md)顶部；不要再把登录权限作为阻塞。没有安全组修改、远程命令、生产写入或部署。

后续最小云侧方案为保留现有允许，只对4010/4011增设同优先级窄拒绝；不重建通用防火墙或直接删除全TCP规则。规则持久化尚未实际落实，关联ECI/其他入口及组内互通、已建立连接仍须核清，不能称完整入口隔离。Task4/5/6状态不变；上轮0042反例和合成恢复结果不重跑、不抹掉。该轮仅观察和记录，无新增测试通过声明。

### 2026-09-27：完整 SQL 隔离恢复验证及 0042 风险边界

从 `f1a63318` 继续。阿里云 ECS 控制台已用 Computer Use 在 Chrome 打开，但当前需要用户登录；安全组尚未读取/修改，不得声称已持久化端口隔离。没有新增开机防火墙框架，已有运行时 nft 组件不重做。

并行推进既定 Task5 中不依赖云登录的真实 MySQL 核验，新增 `ordinary-first-cutover.mysql.integration.test.ts` 与[复现说明](../../../scripts/fixtures/cutover-mysql-README.md)。复制现有 runner/全部61个SQL到无dotenv的临时源码快照，独立loopback13316容器、随机source/restore库、真实dump/restore、表/列/全表数据及view/trigger/event/procedure核对；随后在恢复库重放完整SQL，验证关键业务字段和维护schema，并确认源库不变。

最终结果1通过/1失败：当前已观察支付形态通过；缺失完成时间的已完成订单明确RED，0042回填completed_at会触发updated_at改为迁移时刻。保持历史SQL和断言不变，不将反例改成expected-failure绿色。线上只读事务 `2026-09-27T02:27:51.322Z` 得 completed2、缺完成时间0，pending13；目前快照不命中该风险，不等于维护停写后仍可放行。真实备份/迁移适配器需要零缺失的鲜明前置检查或另行审查迁移策略，仍未接入。

本例测试环境最初内部Docker网络不发布端口，未执行SQL；随后恢复对比暴露显式字符集/触发器重建时间的非业务差异，改为同时核对真实列元数据并只规范化这两项后，才取得真实业务RED。初次类型tuple推断、finally/lint问题均在测试文件修正。日志 `/tmp/holaday-first-restore-{initial,run2,run3,final}.log`；不是生产备份、加密或完整迁移无条件通过。临时数据库、容器及网络均已清理，既有本机MySQL/Redis未动。

Task4仍部分完成，Task5仅新增合成恢复与条件风险证据，Task6未完成；没有实现完整首次host/shell/跨主机执行，也没有生产写入、支付方API调用、PR、合并或部署。PayPal新支付继续暂停，支付/权益/额度、原SQL、UI/模型/扩展和既有`__pycache__`未改。

本轮最终默认后台测试命令退出0，Vitest506文件、8587通过/1既有跳过；该默认配置不包含上述集成测试，不能合并成全绿声明。最终类型检查退出0，新增TS文件Biome与diff-check通过。日志 `/tmp/holaday-first-restore-orchestrator-full.log`、`/tmp/holaday-first-restore-types-final2.log`。所有本轮测试/SSH进程均退出；Chrome阿里云登录页保留供用户登录。下一步在登录后只读核对目标ECS安全组范围，同时继续完整host接线；最终备份/迁移门槛必须处理本节已明确的0042前置条件，不重做已完成的dump演练或默认后台全量。

### 2026-09-27：旧支付端口隔离接入现有nginx维护流程

从`4bdaca7b`继续。新增固定Aliyun支付端口nft策略及窄执行器`browser-payment-port-fence.mjs`，不增加通用防火墙配置接口。实际`aliyun-pay-20260926`站点profile在orders:installing持久意图之后、nginx替换之前调用；沿用同一journal归属和fence store窗口。规则字节SHA256固定，先`--check`再单次create事务，已有同名表直接拒绝、不接管/flush/重试；失败保留规则和意图。两阶段验证在HTTP探针前后核对内核完整表/链/规则，恢复nginx前后同样复核且不删除屏障。未知scope不自动扩展到其他主机或端口。

策略仅阻断非loopback入站TCP4010/4011，inet同时覆盖IPv4/IPv6，不改变默认主机策略、SSH或其他端口。候选本机监听修复仍保留。**这不是生产防火墙已生效，也不是完整隔离证明。** 规则目前仅运行时有效，未设置开机恢复；重启将使证据失效，生产切换仍须核清持久化网络入口/重启策略、本机写入和全主机清单。

验证：新增接线用例先出现8项真实断言RED（原流程忽略网络隔离），加上未经审查规则字节RED后修复；专项最终25通过。完整浏览器发布366/366、完整test:ops退出0（120/59/16/73及shell）；5个触碰MJS的Biome和diff-check通过。测试初版规则文件不存在而失败，随后`--without-policy`负对照在实际可达网络上按拒绝断言失败，最后实际策略通过。初次Biome两处参数重赋值已修正，不隐去失败。

真实Linux验证两层均通过：①两个临时容器的内部双栈网络中，新连接及已建立keep-alive直连被拒绝，IPv4/IPv6 loopback和nginx转发保留，22/443/8080测试监听及无关nft表不变，重复安装原子拒绝；22只是HTTP测试监听，不冒称真实SSH登录验收。②既有站点fixture使用真实文件journal/fence store、真实nft和nginx，orders/all-writers/restore通过，原链接和UID501源inode不变；后台及非HTTP工作状态仍为替身，不是整部署。测试容器/专用网络已清理，镜像保留供复现。

Aliyun现场仅执行`nft --check -f -`及规则摘要读取：实际nft1.0.2检查通过，前后摘要均`ba9a5a8d6eac1a04c281dd60469d784f95dcf783f525b9e4be8dea6043c9e39e`。没有应用规则、关闭端口或停服务。日志`/tmp/holaday-payment-ingress-{red,red2,green,final,host-check}.log`、`/tmp/holaday-port-{fence-wiring-red,fence-wiring-green,policy-red,policy-green}.log`、`/tmp/holaday-network-{browser-final,ops-final,site-linux-final}.log`；README补充镜像构建和复现命令。

Task4仍未完成：下一步完整双主机inventory/host适配、实际业务及provider证据、网络持久化/重启边界和首次shell，再进行Task5备份恢复及Task6整流程/审查。BASE仍为844c2ced。本轮未改支付/权益/额度/SQL/UI/模型/扩展，也未重跑应用套件；不复用上轮83/8587等数字。PayPal新支付继续延后。未PR/合并/部署，不称为可上线。

### 2026-09-27：4010/4011公网旁路定位，候选网关限制本机监听

从`6b3030e0`继续。已实证从Mac能TCP连接阿里云公网4010和4011，主机nft/iptables规则空、UFW未启用；nginx没有4011路由不再是可据以放行的假设。4011来自旧083a发布，输出仍占用已删除的candidate-health日志、会话abandoned，入口源摘要与Git一致；推断是健康检查残留，但日志样本和有限启动来源搜索不证明完全无业务。详情见[现场核查](2026-09-26-browser-host-readonly-audit.md)最新节。没有停服务或改防火墙。

最小候选修复：`apps/cn-payment/src/index.ts`固定监听127.0.0.1，日志增加host；现有同机nginx和健康检查使用该地址，无需更换支付协议、商户配置或端口。更新旧路由测试的listen替身参数签名。新增真实Express/HTTP Server测试，端口由系统随机分配，不带支付凭据、不发支付/桥接请求：修复前真实地址为`::`（RED），修复后IPv4 loopback且本机无副作用GET返回404（GREEN），最后关闭真实服务器。

新鲜验证：国内支付完整8文件83项通过、cn-payment类型检查通过、三个触碰TS文件Biome及diff-check通过。首次测试因fixture缺少LOG_LEVEL初始化失败，补齐测试配置后重跑取得真实监听断言RED；不把初始化错误当回归证据。日志`/tmp/holaday-cn-loopback-{red,red2,suite,types}.log`。本轮未重跑工作台/后台整套或Linux双主机演练，不复用历史通过数字。

PayPal默认隐藏的新checkout逻辑保持不变；没有订单/权益/额度/SQL/UI/扩展/模型路由更改或真实支付调用。线上4010/4011仍是旧通配监听，**本地修复不等于线上已隔离**。Task4继续处理旧实例入口隔离及完整host组装；历史业务核对、Task5恢复和Task6整体验收仍待完成。本批不是可部署结论，Task4 BASE仍为844c2ced。

### 2026-09-26至27日：用户确认PayPal新支付延后，候选默认隐藏入口

从`f49c0a26`继续。用户明确要求“paypal支付可以先隐藏，上线后再优化”，并确认同时关闭新订单、保留历史订单处理。新增独立`PAYPAL_CHECKOUT_ENABLED`，只有显式true才允许新支付，缺失/false/空值/无效值关闭。`payment.options`关闭时返回paypal=false且不提供SDK配置，复用现有PlanPage条件渲染；`createOrder`/`createAddonOrder`在DB/provider副作用之前拒绝。`PAYPAL_ENABLED`、适配器创建、capture、历史查询、webhook实现和权益/额度算法未改。样例配置明确新开关false；没有读写真实凭据或生产配置。

新支付开通/体验验收延后，不再作为本次上线功能；历史sandbox/live身份、未解决交易和恢复风险仍需独立核清，不能因隐藏入口而过滤历史记录或改变readiness结论。设计、实施计划和支付证据顶部已同步范围。本地实现完成不等于线上已隐藏，部署清单须确认新开关关闭且历史适配器配置不被误关。

新路由用例先RED（6失败：options仍公开、两种订单仍能创建）再GREEN。最终支付路由/HTTP回调43项通过，明确关闭checkout时已有capture/验签/匹配金额结算保留；旧结算规则未修改。现有PlanPage组件新增两项行为锁定测试：套餐和加量包均保留支付宝按钮，且不挂载PayPal SDK；页面/状态专项23项、工作台整套257文件2508项通过。后台完整test命令通过，Vitest506文件8587通过/1既有跳过，前置Node测试同样通过；orchestrator类型检查已通过。页面证据为happy-dom组件测试，非真实浏览器/线上付款验收。

过程限制：首次Vitest沙箱临时配置写入EPERM，限定权限后成功；产品补丁首次自动审批超时未执行，一次精确重试成功。新测试的tRPC Context联合类型错误和非空断言lint已修正，没有降低断言或类型门槛。工作台类型检查另发现`tasks.ts`三处既有未使用回调参数，仅清除这三个形参，不改变runTaskBackground调用或执行逻辑；最终工作台完整类型检查退出0，任务执行/后台回执/排空/计费专项5文件39项通过。上方后台全套在这三处参数清理前运行，清理后未再跑全套。四个支付/页面测试相关TS文件Biome与diff-check通过，未对巨大tasks.ts全文件重排或宣称全仓lint通过。日志`/tmp/holaday-paypal-pause-{red,red2,red3,green,targeted-final,orchestrator-full,web-targeted,web-full,types,types-final,web-types,web-types-final,task-regression}.log`。参数清理和本段记录的补丁各遇一次审批超时未执行，各一次精确重试成功。全部测试已退出，无后台测试或浏览器会话遗留。

Task4–6仍未完成，未PR/合并/部署；当前改动不涉及真实支付调用、扣款、退款、旧订单状态、SQL、浏览器扩展或模型路由。后续继续完整首次切换接线与恢复演练，不重开PayPal登录/新支付优化，也不能以本次局部成功宣称整体可上线。

### 2026-09-26：全主机观测补齐实际子进程树

从`11f9fe8f`继续Task4接线检查，发现`readCutoverHostSnapshot`在建立父子关系前就按UID/argv过滤，会漏掉实际网关的shell/esbuild等非Node后代。现先观察用户态进程身份，再从既有Holaday/UID998/Node范围递归纳入后代；Node另按真实exe识别，避免进程标题被改写后漏采。无关树不并入目标；返回值仍不包含原始argv或环境。启动来源/入口采样结束后重新观察整棵相关树，新增、重新挂父、PID复用及cgroup漂移均拒绝。此结果是有界观测，不是进程冻结、完整主机分类或允许停止的证明。

六个新增用例实际RED→GREEN；采集器46/46，完整浏览器发布回归355/355、完整`pnpm test:ops`退出0，三个触碰MJS的Biome与diff-check通过。首次浏览器全套因沙箱禁止Unix socket而在client测试中EPERM失败，限定提权完整重跑后通过，未修改业务或测试断言来绕过。新增可复现`fixtures/browser-host-tree-linux.mjs`在既有无网络、私有PID Linux镜像中用真实/proc验证shell/sleep后代及中途新增子进程拒绝；PM2/nginx/systemd命令读者为替身，不能称为Linux主机整流程。fixture清理lint问题已修正并重跑最终版本。

日志：`/tmp/holaday-host-tree-{red,green,browser,browser-final,ops,linux,linux-final}.log`。没有生产连接、停服务、配置/数据库写入、支付/权益/额度/UI/模型/扩展修改；PayPal继续暂停。测试进程已退出，一次性容器自动移除，预存`__pycache__`未动。本轮未重跑应用全套。

**Task4仍未完成，BASE844c2ced不变。** 后续仍需受保护全主机清单和来源分类、真实双主机/DB/provider组装、首次host余下阶段及显式shell；然后Task5备份恢复/支付演练、Task6整流程及一次全分支审查。4011的入口责任仍未证明，不能因本轮补齐进程采集就擅自停止。候选准备无需重做；本轮没有PR、合并或部署。

### 2026-09-26：首次候选准备接入真实journal，复用普通发布准备逻辑

从`04a8f3ce`继续。普通host抽出共用的配置策略、候选环境和`stageReleaseCandidate`，首次host新增`prepareFirstCutoverCandidate({attempt}, io)`：从固定受保护批准文件读取实际绑定，先验证旧来源、配置、UID/GID及目标不存在，再取得同一个真实首次journal/reserved attempt，随后克隆、固定分支提交、校验祖先关系、detached checkout、配置落盘、安装及构建、绑定完整迁移清单。构建后再次核对HEAD与detached状态。每次命令前后检查锁和截止时间；首次路径还复核批准文件、构建后旧来源及配置漂移。失败只关闭文件句柄，保留锁与部分候选，不自动重试或清理。

本段不调用nginx、PM2、迁移或应用控制命令。成功仍停留在journal的preflight，返回同一个journal供后续完整host使用；不写prepared/ready、不伪造旧bootId。生产旧来源观察器`inspectLegacySource`的默认组装尚未实现，缺少时在锁和克隆之前报`CUTOVER_HOST_OBSERVER_REQUIRED`，没有JSON成功开关或可执行部署入口。

新鲜验证：共用候选准备12项、首次批准/准备24项、普通host27项，共63项通过；最终全部浏览器发布脚本349/349，完整`pnpm test:ops`退出0（120/59/16/73及shell）；四个触碰MJS的Biome和diff-check通过。真实临时Git仓库验证clone/fetch/祖先/detached/旧checkout不变；其中安装和构建仍为边界替身，不冒称真实产品构建或Linux整流程。首次组合用真实批准文件读取与journal，Mac测试仅root身份模拟。两个时间测试初次失败来自替换已复制的时钟函数，修正为可变时钟值后通过，未放宽产品检查。新增构建后HEAD变化/重新挂分支用例实际RED→GREEN。

日志`/tmp/holaday-candidate-stage-red.log`、`/tmp/holaday-first-preparation-{red,green,green2,final-targeted}.log`、`/tmp/holaday-candidate-final-head-red.log`、`/tmp/holaday-first-preparation-{browser,ops}-final2.log`。任务脚本首次自动审批超时未执行；默认权限写忽略目录被拒后，经限定权限成功刷新说明。真实Git测试补丁首次审批超时未执行，精确重试一次成功。

**Task4仍未完成，BASE仍为844c2ced。** 下一步是实际来源/全主机清单观察器、两台主机与DB/provider接线，以及首次host其余阶段和shell；候选准备段不替代这些缺口。Task5恢复/支付演练和Task6整流程/独立审查也仍未完成。本轮无生产连接或部署，无支付/权益/额度/SQL/UI/扩展/模型路由改动；PayPal继续暂停，已核实的两笔支付宝超时关闭不重复调查。应用全套及Linux整流程本轮未运行。

### 2026-09-26 23:12 JST：支付宝商户明细核对

从本地提交`c39b36e2`继续，浏览器只读核对9笔订单：两笔关闭订单详情均明确为“超时关闭”，列表退款金额0、支付时间空；7笔在原始订单号与8月4日至6日创建时间范围内未检出，与签名API相符。完整事实见支付证据最新节及忽略QA的`alipay-console-order-observation.json`。这解决了两笔关闭原因的UI核对，不再重复调查；7笔保留范围限定，未改本地pending或查询器unknown分类。

无产品代码、生产配置或业务状态修改，无退款/关单/账单批量导出，无新应用测试声明。PayPal保持暂停且仍在最终待核验项中。下一步继续Task4既定完整host/双主机/DB/provider接线；后台人工观测不能代替自动证据适配器，也不能用它免除Task5恢复演练和Task6整流程审查。当前仍未部署。

### 2026-09-26 23:04 JST：真实支付宝查询已完成，PayPal按用户要求暂停

只读核对9笔支付宝历史pending，最终9/9响应验签通过：7笔ACQ.TRADE_NOT_EXIST、2笔TRADE_CLOSED；不能由此自动改本地状态或放行，仍需限定交易/退款记录对照。4010/4011指定磁盘配置的AppID都匹配后台已核实基础应用、公钥相同。两次DB只读快照9行一致，非隔离/零写入证明。完整事实见支付证据最新节，原始含订单数据仅在忽略QA私密保存。

发现并修正发布查询器的GBK验签缺陷：原始响应字节可验签，先decode再UTF-8重编码则失败。仅查询脚本改为原字节RSA-SHA256验证与base64原文留档，分类不变、微信协议不变、业务支付路径不动。GBK合法/篡改回归先RED再GREEN；专项25、cn-payment整套82通过，应用和脚本显式类型检查、两个文件Biome/diff-check通过。首次Vitest缓存权限失败用no-cache解决；不冒称全仓验证。

用户要求PayPal稍后做，本轮未访问其后台/订单/API，不再请求登录。PayPal remains pending，不排除出最终门槛。无支付状态/权益/额度更改或线上配置部署；真实provider调用共19次，只读，全部SSH/测试已退出。下一步核对这9笔的商户交易/退款历史，同时继续Task4完整host/双主机接线与恢复演练；不要重做本次编码修正或把历史unknown改为完成。

### 2026-09-26 22:41 JST：支付宝后台身份核实

用户扫码登录后，Chrome开放平台/商家平台只读核查成功：当前4010的AppID摘要匹配已上线基础应用；商家APPID绑定清单包含该应用，商户号与收单账号一致。不是仍在开发中的HOLADAYPAY01。完整身份只在忽略QA `payment-binding-audit-20260926/alipay-console-observation.json` 私密保存；已可作为后续查询的独立预期身份来源，未写入线上.env。历史9笔支付宝订单、4011历史应用绑定仍未核验，不是支付门槛完成。

PayPal验证后返回暂时错误，现为密码登录页；等待用户完成登录，尚无sandbox后台证据。浏览器仅只读，没有展开密钥、付款、修改设置/订单或部署。记录优先于下方“支付宝商户身份缺来源”的旧结论；其他Task4/5/6缺口不变。

### 2026-09-26 22:28 JST：支付绑定真实输入缺口

从 `4ee2963d` 继续只读现场核查，未改产品实现。两台SSH和Vultr数据库只读事务成功；不要再把浏览器/SSH权限当作当前阻塞。PayPal pending 1条明确标记sandbox，而当前主站配置live；微信pending3、支付宝pending9的metadata缺环境/商户字段。当前及旧国内网关缺支付宝seller ID，当前PayPal配置缺merchant ID；本机限定配置路径也没有sandbox凭据。详见 `2026-09-25-browser-first-cutover-payment-evidence.md` 最新节。

4011并非“环境为空的无用服务”：Node使用 `--env-file`，磁盘.env存在微信/支付宝/内部桥接配置，仍监听；不得自动停用。旧任务/支付状态均未修改。现有query helper仍要求正确环境与独立商户身份，不允许用live凭据查sandbox后把404当关闭，或从同一响应反填预期身份。

下一步需要原sandbox应用/商户受保护配置、支付宝seller及历史应用绑定依据；可在已登录商户后台核对，不让用户在聊天里发密钥。其余Task4真实完整host/双主机组装、Task5恢复演练与Task6整流程仍未完成。本轮无产品测试/新增通过数字、无push/PR/merge/deploy；生产仅只读，所有SSH退出。脱敏证据保存在本计划QA `payment-binding-audit-20260926/`，已有 `scripts/__pycache__/` 保留。

### 2026-09-26 首次入口隔离的持久阶段回执

在首次 host 中新增 `createFirstCutoverFenceStore`，替换 nginx 演练原先的内存 receipt。固定 root0700目录下每attempt一个0600记录；先记录 installing/restoring 意图再由现有 fence 执行动作，阶段只能按 orders installing/active → all-writers installing/active → restoring/restored 前进。绑定真实 journal 的 attempt、candidate/config/migration/inventory，恢复必须对应本候选且 bootId 不变。文件范围与原文/备份摘要不变，只有进入 all-writers 时允许新的生成摘要。

真实文件写入和目录同步、写后重读、所有权与截止时间复查均已实现；旧记录不续跑，文件缺失、替换、内容或权限变化、硬/软链接、失锁、窗口到期均拒绝。失败保留现场，不清锁、不自动恢复。锁仅排除协作式并发部署，不宣称操作系统级条件事务或抵抗其他root写入；回执本身也不证明隔离有效，仍由现有探针和独立写入事实核验。

新增10项文件测试通过，原批准清单加本模块共22项通过，完整浏览器发布回归325/325通过。既有隔离 Linux Node22/nginx 演练已换用真实 `acquireReleaseJournal` + 默认root文件回执：两阶段/TLS/IPv4/IPv6/透传/静态页/恢复通过，原 UID501源与链接链保留。初次 Linux 接线暴露默认磁盘IO没有采用fs，修正后通过；不隐藏失败记录。该演练仍使用合成批准清单、应用后端及非HTTP工作事实，只证明本段实际组合，不是生产整流程。日志 `/tmp/holaday-fence-store-{red,host-green,linux-red,linux-final,browser-final,ops-final}.log`。三个MJS的Biome及diff-check通过，完整 `pnpm test:ops` 退出0（120/59/16/73及shell）。最终格式版本的Linux演练再次通过。全部测试会话已退出，一次性容器自动移除。

**Task4依然部分完成。** 完整受保护 inventory/分类、双主机协调、DB/provider默认读者、首次host主体与shell仍未完成，Task5恢复/支付证据及Task6整流程审查仍待完成；普通入口继续明确拒绝未安装的生产证据适配。没有连接生产、停机、发布或改历史业务记录；未改支付结算/权益/额度、模型路由、UI或扩展。本轮应用全套未重跑。

### 2026-09-26 普通发布 evidence/readiness 接线

普通 host 已改为取得真实 journal/attempt、绑定 inventory 摘要，完成候选构建及迁移清单绑定后，再执行真实 `collectCutoverEvidence` → 证据发布 → 候选源码的 readiness。prepare 和两次 preopen 都重新采集，不复用上一次报告；CLI 传入 command/attempt/candidate/config/migration/inventory，verify 再携带新 bootId。普通 shell 新增必需环境变量 `HOLADAY_HOST_INVENTORY_SHA256`；参数不完整在 SSH 前拒绝，legacy 拒绝与远端不重试保持。

主机事实接口固定为 `io.evidence.readWindow(binding)` 及 `readHostInventory(context)`、`readDatabaseScope(context)`、`queryOrders(scope,context)`、`readRehearsalArtifacts(context)`、`readFenceState(context)`；context 含本次绑定、stage、固定 window 及 preopen identity。发布默认使用真实 root `publishCutoverEvidence`，journal 所有权与窗口在采集/CLI 前后复核。窗口只读取一次，不随 preopen 延长；过期或失锁不开放。真实文件 journal 已与 host/collector 组合测试，不再仅用固定 attempt。

**此处仅完成普通路径的消费端接线，仍不是可运行的生产整流程。** 上述事实接口的生产默认组装尚未安装；默认 host 会明确返回 `MAINTENANCE_EVIDENCE_ADAPTER_REQUIRED`，在创建发布锁、构建及关服务之前拒绝。不得用操作员 success JSON、既有报告或测试数据填补它。首次 host、双主机事实/入口阶段协调、DB/provider 实际适配、首次 shell 及 Task5/6 仍待完成。正常 shell 使用已安装 driver，因此首次切换必须安装包含新参数契约的候选；不能直接拿新 shell 调用历史旧 driver 并宣称兼容。

新测试先确认旧参数/顺序失败，新增维护窗口到期 RED→GREEN；真实 journal 测试最初因 Mac `/var` 到 `/private/var` 的目录别名被正确拒绝，fixture 改用 realpath，未放宽生产检查。浏览器发布回归315/315、隔离 Linux Node22 host27/27通过；后者仅 journal 为真实文件，进程/外部服务为模拟边界，不是 Linux 整切换验收。三个触碰MJS的Biome、shell语法和diff-check通过。完整 `pnpm test:ops` 退出0，应用侧readiness三文件57/57通过；应用全套本轮未重跑。日志 `/tmp/holaday-host-evidence-*`。全部测试已退出，隔离容器已自动移除。本轮未连接生产、未部署、未改支付结算/权益/额度、模型路由、UI或扩展。

### 2026-09-26 root 文件安装层接线

新增 `browser-first-cutover-ingress-files.mjs`，提供原 fence 链使用的 readConfig/backupOriginal/readBackup/replaceConfig，Linux 演练已换用该实现的真实默认 fs，不再用测试写文件回调代替安装。root 原配置和 UID501 的 Aliyun release 一律不改；只原子替换 sites-enabled 下批准的启用链接，临时配置在 root 0700 的独立 attempt 目录。源内容/UID/GID/模式/完整链接链绑定；原文备份与原链接清单均0600并同步落盘。旧 attempt、备份硬链接、权限异常、源/链接/待安装文件/持久意图变化及超期均拒绝；不自动恢复或重试。

12项真实文件测试通过，浏览器发布回归306/306通过。Linux Node22真实 root/UID501两级链接 + nginx 两阶段/TLS/恢复再次通过，原文件 inode/归属/内容保留。日志 `/tmp/holaday-ingress-files-{green-final,browser-final,linux-final}.log`。测试最初发现自己的 rename 会改变 symlink ctime，已保留 inode/设备等身份而重新采纳该次自有 rename 后的 ctime；其他时刻仍全元数据核验。暂存内容篡改与最终异步校验跨越截止时间均先RED再修复通过。一次文件编辑自动审批超时未执行，精确重试成功。

**仍是 Task4 部分完成，不是已部署：** 实际受保护 inventory/阶段读写、完整 ingress 分类、双主机协调、DB/provider IO、主 host/readiness/shell 仍待接线；Task5备份恢复/迁移/外部支付、Task6整流程/独立审查仍未完成。此模块以受信 host 提供的批准、journal/阶段接口为边界；隔离测试的这些接口及非HTTP写入事实是模拟值。检查与 rename 不构成系统级条件事务，host 仍须排除并发部署。未修改应用支付/权益/额度、UI、模型路由或浏览器扩展。

最终门槛：完整 `pnpm test:ops` 退出0（120/50/16/65及shell，`/tmp/holaday-ingress-files-ops-final.log`）；三个触碰MJS的Biome和diff-check通过。应用全量测试未重跑。阿里云新增只读SSH成功确认启用链接文本为 `/etc/nginx/sites-available/hd-app.orangebench.tech`，该路径再链接 `/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf`，源归属501:50/0644，与适配一致。没有线上写入/reload；没有DB/provider调用。全部测试/SSH进程已退出、隔离容器自动移除，预存 `scripts/__pycache__/` 保留；未push/PR/merge/deploy。

### 2026-09-26 三站点真实 nginx 隔离适配

在原 `browser-first-cutover-fence.mjs` 的 apply/verify/restore 链内接入三份实采配置，不替换普通解析器。每份完整 SHA 固定；来源有漂移、路由/监听缺失、健康分类被扩大时，写入前拒绝。修改仅插入业务拒绝及精确例外，保留静态站点、重定向、双栈监听和 TLS 配置。

已核实并处理支付链依赖：orders 阶段保留微信/支付宝通知、PayPal webhook、普通与 partner 内部结算确认接口；网关健康检查使用的主站支付桥接健康接口亦保留。all-writers 再关闭回调/结算入口。不给短信登录或健康前缀下任意路径放行。Vultr 原 `/api/` 的前缀剥离在新精确 location 中保持一致。

真实 Linux nginx 两阶段和精确恢复已通过：IPv4/IPv6、阿里云→主站链式 TLS、原始请求体/查询参数/头透传、静态资源、默认 Host、WebSocket 新连接和精确回调边界。测试先发现 fixture 备份字段命名错误并修正；继而实测证明 reload ACK 不等于所有 worker 生效，旧 worker 的200被正确拒绝，fixture 改为观察旧 worker 退场后再验证。无生产连接/命令、停机或数据库/支付操作。

复现入口 `scripts/fixtures/browser-site-fence-linux.mjs`；只读挂载源码、`--network none`、临时证书/最小 TLS include、本地模拟应用。非 HTTP 写入事实与开放身份为模拟值；不能称为已有连接清空、支付验签或整流程实机通过。已检查的三个无密钥站点源纳入 `scripts/fixtures/cutover-nginx/`，完整主机采集和无关站点仍私密忽略。生成器只支持已审查 SHA，未据此批准覆盖 UID501 的 Aliyun release 软链接目标。

**下一步固定范围：** 实际 root 配置安装/恢复（含 Aliyun 软链接处理）、完整入口分类和 host/readiness/shell 接线；随后 Task5 新鲜加密备份/隔离恢复、迁移与外部支付证据，最后 Task6 整流程和一次全分支审查。Task4 尚未完成，不能部署；不重做前三项，不重开 UI/模型路由/结算规则修改。

最终新鲜结果：浏览器发布回归294/294（`/tmp/holaday-site-fence-browser-final2.log`）；完整 `pnpm test:ops` 退出0（`/tmp/holaday-site-fence-ops-final.log`）；真实 Linux 最终版本两阶段/恢复再次通过（`/tmp/holaday-site-fence-linux-final2.log`）。三个 MJS 文件 Biome 检查和 diff-check 通过。应用全量测试未在本轮重跑。所有测试会话已退出，容器自动删除；没有后台 SSH 或测试工作遗留。原 `scripts/__pycache__/` 未动；本轮无 push/PR/merge/deploy。

### 2026-09-26 17:12–17:21 JST 现场恢复与采集器增补

不要继续把SSH不可用列为当前唯一阻塞。阿里云直连成功；Vultr直连在banner阶段超时，但经阿里云端到端SSH中转成功，双主机StrictHostKeyChecking=yes且不转发agent。已有授权未变，没有改VPN、防火墙、sshd或线上服务。中转与元数据采样各一次自动审批超时未执行，各允许重试后成功。

在原 `browser-cutover-evidence.mjs` 增加 `readCutoverNginxSnapshot`，接入默认主机采集器。两次nginx测试输出、全部源字节、实际软链接目标、属主/权限/摘要及文件漂移检查均保存，不再只留路由摘要。真实Vultr17源、阿里云12源（含UID501的hd-app release），均成功；root Linux真实nginx亦通过。该结果是磁盘配置观测，不是运行中worker已加载或fence已有效的证明。完整源在本计划私密QA目录 `host-audit-resume-20260926/`，0700/0600；不提交原文。

重新只读核对数据库：1条running来自explorer，2026-06-24创建，无session/plan/普通事件步骤，但有14条真实动作（3 navigate/11 click）及22次LLM调用；不是空记录，不能自动改终态或删除。13条pending支付（PayPal1/微信3/支付宝9）仍需支付方核对；2条active计划未到期；4010/4011仍监听。最初steps查询误用updated_at导致ER_BAD_FIELD_ERROR，已对照schema修正并完整重跑；详细证据见host-readonly-audit最新节。

新鲜验证：采集器40/40，浏览器发布脚本288/288（含正常部署shell6项），完整test:ops退出0（120/50/16/65及shell），两个MJS Biome与diff-check通过。Linux Node22.20初次全套39/40因既有publisher fixture在root下使用GID0；按非root应用组前提以UID/GID998跑同一测试后40/40。未放宽生产条件；真实root默认采集另有成功验证。日志 `/tmp/holaday-nginx-observation-*`。应用全量测试未本轮重跑；不把下方历史8579/80项当作本轮新结果。

仅本地采集实现、测试与记录变化；生产只读，无部署/停机/DB更新/支付调用，也未push/PR/merge。Task4/5/6仍不完整，不能发布。接下来直接使用已保留的完整源实现真实入口适配与host/readiness接线，再做备份恢复及外部支付证据；不要重做Task1–3或再次猜站点路径。旧explorer的终态需要确切执行归属/外部结果依据，不能为了放行在脚本中自动清理。

### 2026-09-26 自主推进批次

已完成受保护的 PM2 运行注册定向移除组件：`browser-first-cutover-registrations.mjs`。实际配置备份为 root 私密文件，按唯一 pm_id 执行 delete，动作前/后进入共享 journal；窗口、身份、在途工作、主备启动残留、备份损坏、无关注册变化、回生及结果不明均拒绝继续。支持实测 PM2 6.0.14、开启内存重启的 worker、已停止/PID0 的文件 cron，不把它们伪装成已禁用重启。普通停止路径拒绝使用该类 capture。

真实 Linux 最终演练通过：UID998 worker 退出、监听消失、cron 注册移除、无关 PID 不变、真实日志六条注册事件；测试 daemon 重启仅恢复保留应用。可复现 fixture 已纳入 `scripts/fixtures/browser-registration-removal-linux.mjs`，使用既有隔离镜像 `holaday-first-cutover-task3:qa`，源码挂载 `/source`；需私有 PID namespace、SYS_PTRACE 仅用于容器内跨 UID 观察，禁止生产挂载/网络。日志 `/tmp/holaday-registration-linux-final.log`。这是实际组件验证，不是双主机/DB/支付整流程验证。

演练先暴露了 PM2 `axm_monitor` 遥测字段持续变化导致的误拒绝。现仅排除该遥测字段，完整环境、启动路径、调度、重启策略和进程身份仍参与核验；原始私密备份仍保留全部配置。对应回归 RED→GREEN；空捕获清单误成功也已 RED→GREEN 修复。运行注册备份与主备启动文件备份是两个独立目录，均保留失败现场，不自动回滚或重试。

本轮最终结果：浏览器脚本 278/278；完整 test:ops 退出0（120/50/16/65及 shell）；orchestrator 506文件、8579通过/1既有跳过；cn-payment 7文件80通过且类型检查通过；现有普通/partner 支付幂等专项40通过。新增12条回调等待/失败应答行为锁定测试，不修改结算实现；首次 CN 测试遇 Vitest 缓存写权限 EPERM，已授权完整重跑通过。七个触碰的脚本/测试及新增Linux复现脚本 Biome 与 diff-check通过。Python首次7项/普通4项本批重跑通过（`/tmp/holaday-registration-python-{first,normal}.log`）。

生产只读预检未取得新数据：Vultr SSH 多次在 banner/认证阶段超时；即使仅执行 true 也未完成。终止了本次悬挂的本机 SSH 客户端，未向服务器业务进程发信号。Aliyun 的 true 探测两次自动审批超时，均未执行，不能说该主机不可达。公开 `https://holaday.ai/healthz` 返回200，仅证明该健康请求成功，不代表浏览器或切换就绪。未修改生产服务/配置/数据库。

**仍未完成：** Task4 的完整 host adapter、真实 nginx 拓扑接线、跨主机/DB/provider IO、普通入口新参数/证据顺序和 shell；Task5 新鲜加密备份/隔离恢复、完整迁移及外部支付证据；Task6 整流程与独立审查。历史审计仅保存 nginx 路由摘要，不含完整站点配置，不应猜测重写。下一步先恢复 SSH 只读通道并读取实际配置及在途工作，接续这些固定范围；不要再请求已授予的 PR/部署权限，也不要把网络恢复等同于代码已经就绪。

以下为此前恢复点历史，尚未实现运行注册删除的说法已被本段取代。

用户已回复“允许”，批准定向移除运行注册与主备启动条目的**本地实现和隔离测试**，不要再次请求同一授权；仍不授权线上操作。当前完成其中的主备文件处理与真实journal接线，运行注册的受保护生产删除入口尚未实现，不能把下面的测试PM2命令称为产品入口。

新增 `scripts/browser-first-cutover-startup.mjs`：仅 `/root/.pm2/dump.pm2` 和 `.bak`，两文件独立摘要和条目摘要匹配；备份在root私密 `maintenance/startup-<attempt>` 下，排他创建、同步写盘及写后重读核验。无关条目保留原始字节（包括JS无法精确表示的大整数）；缺失备用文件明确记录为缺失，不复制主文件补齐。恢复副本损坏、路径/权限/硬链接异常、源漂移、超期、初始时钟无效、旧attempt都拒绝；失败保留备份/部分状态，不自动恢复或重试。摘要重查后替换并不是操作系统级跨文件事务；仍依赖主机适配器排除并发配置写入，不能宣称抵抗恶意root。

`journal.recordStartupEvent` 只允许first-cutover的 `producers_stopped` intent阶段，严格绑定attempt/inventory和脱敏字段，顺序记录backup意图/结果、fallback及primary替换意图/结果；未完成的文件步骤阻止继续all_fenced。普通路径不能记录该事件。当前是每台主机/本次journal的一批主备文件，跨主机汇总、运行注册备份/定向删除、隔离/现场scope验证与主host组合仍待接线；不会仅凭本函数返回就认定停止完成。

新鲜验证：startup文件/journal组合测试及浏览器全套最终结果见 `/tmp/holaday-startup-browser-final.log`；完整test:ops退出0，`/tmp/holaday-startup-ops-final.log`。一次较早ops运行撞上新增journal测试的RED阶段而失败，已在实现后完整重跑通过，不隐去该历史。隔离Linux实际root备份/文件替换与真实共享journal六条事件通过；测试级定向delete后无关进程PID保持，测试daemon恢复只拉起保留应用。日志 `/tmp/holaday-startup-files-linux-final.log`。运行注册删除目前仅在QA脚本，没有生产删除适配器。未连接或修改生产、数据库、支付/额度、UI或扩展，未提交/push/merge/deploy。

历史上一轮：启动来源机制核验完成，当时等待停用策略决定（现已获准）。实际PM26.0.14隔离演练证明 stop 后cron会回生、delete运行注册不清主备保存记录、主/备用记录均可恢复目标；同时清理测试目标的主备记录后只恢复无关测试应用。真实Worker模块的可控异步采样测试证明stopped注册仍可触发内存reload、已移除注册不会。日志 `/tmp/holaday-task4-pm2-startup-characterization.log`，退出0；容器已自动移除，没有生产连接或变更。

建议：私密备份后，首次路径只定向移除批准旧对象的PM2运行注册及主备启动条目，每文件单独摘要/CAS/保留条目核验，记录先于副作用，无关应用与daemon不动；不执行全局save/delete/kill、不自动回启旧版。该策略比此前的仅stop扩大了操作类型，已向用户请求**仅本地实现和隔离测试**确认，尚未获得该新增授权，不落生产路径代码。完整提案与证据见host-readonly-audit第4节。不要重复调查已证明的stop/cron问题，收到同意后从定向注册/保存记录处理的TDD继续。此前254项等是上一轮回归，本轮未重跑或新增产品通过声明。

本轮按四项固定清单继续，完成首次路径的进程身份适配：管理器 `/usr/bin/node` 与应用 Node22 分离；网关 root Node/dash/同 release esbuild 完整树校验，未托管 root 网关仅允许固定支付 release 应用目录下的系统 Node，并保留 pidfd SIGTERM。main/worker UID998、普通升级 helper 和候选身份规则未改。管理器替换、跨 release、混用 UID 身份及孤儿子进程均拒绝。

显式停止超时支持真实 660000ms，首次停止相对窗口上限为900000ms；整批 PM2 超时总和加两次物理复核预算不足时，首个停止前拒绝，不缩短实际超时。完整 host 尚须与已批准绝对维护窗口取交集，不能从相对上限推出生产停机授权。worker 的 memory restart 和 files-cron 定时来源仍保持阻断，未填零、未绕过。

本轮新鲜验证：浏览器运维脚本254/254，Python首次7/7、普通4/4，完整 `pnpm test:ops` 退出0（`/tmp/holaday-task4-host-shape-ops.log`），两个触碰MJS的Biome和diff-check通过。Linux Node22.20.0/PM2 6.0.14 实测系统Node管理器定向停止、root网关pidfd TERM及4011释放、无关应用存活、UID998状态文件和两阶段nginx恢复；日志 `/tmp/holaday-task4-host-shape-linux-final.log`。x64 esbuild完整形态是单元fixture，不是arm64容器的真实esbuild运行证明；journal/工作计数仍合成，不是Task6整流程。测试均已结束，一次性容器已移除。

下一步仍在Task4：核实并实现 files-cron/memory restart/保存启动记录的定向停用与回生复核，不能仅凭 stopped/PID0 宣称已禁用。PM2本地源码显示 cron 是独立注册，异步内存采样后的reload也能启动停止进程；普通 stop 不足以证明所有启动来源关闭。接着做真实nginx入口适配及host/evidence/readiness接线。Task5/6和整分支审查未完成，不能部署。本轮只改本地四个首次runtime/signal实现与测试、记录和隔离QA；未连接或改变生产，未改数据库、支付结算/权益/额度、UI、模型路由或扩展，未提交/push/merge/deploy。

后续用户回复“继续”，已批准并完成两台主机的限定只读核查（09:48–09:51 JST）。见[真实主机核查与四项固定修正清单](2026-09-26-browser-host-readonly-audit.md)，不要再次询问相同只读权限。4010支付路由已明确；4011仍监听但未见 nginx 字面路由，不能直接判为可停用。PM2管理器/网关UID与exe、完整树、files-cron未来调度、worker超时/内存重启及 nginx 实际文件形态均与原合成假设存在差异。下一步基于该证据做首次路径专用适配，不能放宽普通升级/候选UID998，也不能全局停PM2。本次未修改生产状态或产品代码，未新增通过测试声明。

用户已批准生产者优先停止顺序，已实现和隔离验证，不要再次询问该顺序，也不要重做 Task 1–3。HEAD / Task 4 BASE 仍为 `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`；Task 4 未提交、未标完成，Task 5/6 未开始。

- orders 隔离与工作核查 → 精确停止批准生产者 → all-writers 隔离与全局停止复核。生产者回执与最终 stopped 分开，不能复制/篡改后使用，也不重复向已停止进程发信号。真实 Linux Node22/PM2、pidfd、权限与 nginx 组件复测通过，日志 `/tmp/holaday-producer-order-linux.log`；主机事实/journal/root IO 仍部分合成，不是整流程证明。
- prepare 只要求核清批准对象，不再要求停机后才可能出现的零生产者状态；仅允许与 inventory 完全匹配的 main/worker，未知写入、外部工作、未解决记录仍拒绝。preopen 要求全局隔离和旧生产者为零。证据采集 36/36。
- 首次 transition 必须提供绝对维护窗口、补核对截止和负责人；实际副作用前重查时限/时钟倒退，构建或迁移不强杀、不重跑，保护性 close/hold 不因超时禁用。transition + 共用 tail 54/54。
- normal journal 可绑定 inventoryDigest；首次 journal 允许受保护批准清单预留 UUID，真实锁/新记录使用该值，历史记录永不覆盖，普通路径不能指定 attempt。journal 16/16。
- `browser-first-cutover-host.mjs` 目前只实现固定 root 保护清单读取，不是完整 host adapter。测试 12/12：Mac 实文件验证，只有 UID 模拟为 root。尚无可执行生产入口。
- 最后一次 journal 增补与格式修正后的浏览器运维脚本 243/243，日志 `/tmp/holaday-task4-final-browser.log`；`pnpm test:ops` 全命令退出 0，日志 `/tmp/holaday-task4-final-ops.log`，先前审批超时已不再阻塞。十个本轮 MJS 文件 Biome check 与 diff-check 通过；不宣称全仓 lint 通过。测试均已退出，无后台测试遗留。

此前资料不足与只读权限请求已被09:48–09:51核查取代；不再重复请求。现场快照仍不是部署时的批准清单，4011责任/旁路可达性及完整启动来源仍需绑定实际操作范围；读取不等于批准停止对象。

剩余 Task 4：完整 first host、真实多主机分类/DB/provider/root fencing IO、普通 host 的 acquire→采集发布→候选 readiness 新参数、显式 shell。Task 5/6、真实支付方演练和独立审查仍未完成，不能部署。Docker Desktop 为隔离测试在本机启动，一次性 QA 容器已自动移除，daemon 保持运行。两个 `scripts/__pycache__/` 缓存未纳入交付。未改线上进程、配置、数据库、支付/权益/额度、UI、模型路由或扩展；未 push/merge/deploy。

## 本次继续进度（Task 3）

- 已实现首次/普通 journal 互斥、独立引导种子、身份核对与 PM2 定向停止边界、未托管进程 pidfd SIGTERM、两阶段 nginx 配置生成/校验/恢复、首次 closed 状态初始化。
- 新鲜本地验收：全部浏览器脚本 160/160；Task 3 其中 runtime 22、fence 8、journal 11（含原有测试）；Python 首次 helper 5、普通 helper 4 均通过；六个触碰的 MJS 文件 Biome 与 diff-check 通过。`pnpm test:ops` 全命令退出 0（Node 分组 120、46、16、53，附属 shell 检查通过）。
- 日志：`/tmp/holaday-first-cutover-task3-final.log`、`/tmp/holaday-first-cutover-task3-ops.log`。一次全量脚本运行出现 11 个既有 socket 测试 EPERM，批准本机临时 socket 权限后全部通过；未为此修改产品代码。
- 隔离 Linux 组件实测已通过，日志 `/tmp/holaday-first-cutover-task3-linux.log`：真实 Node 22.20.0 / PM2 6.0.14 下，开启自动重启且忽略普通停止信号的批准目标被定向停止，无关应用保持存活；未托管 UID998 进程通过真实 pidfd SIGTERM 退出；首次状态目录/文件的 UID998、0700/0600 通过；真实 nginx 两阶段 503、无效签名回调探针、no-store 和原配置恢复通过。完整记录与合成 QA 位于该计划 `.superpowers/sdd/.../qa/`，不是生产部署工具。
- QA 环境修正：容器需 SYS_PTRACE 才能读取另一 UID 的 `/proc` 身份，仍无宿主 PID、网络、生产凭据或端口映射；镜像 Python 位于 `/usr/local/bin`，仅在镜像补齐 `/usr/bin/python3` 路径。产品停止规则未改。容器已自动移除。
- 组件的主机观察、root 文件操作与 journal 回调尚需 Task 4 连接真实适配器；Task 6 整流程与独立审查仍未完成。下述较早“Task 3 尚未写实现”为历史断点，不代表此更新后的代码状态。

## 历史断点：Task 4 当时停止顺序待确认（已被上方批准与实现取代）

Task 3 已完成并登记，HEAD `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`。Task 4 的八个脚本/测试文件尚未提交：新增共用 release-tail、首次 transition 及测试；普通 host/transition 接入共用后半段与开放前后核查。首次 host、命令入口、真实证据接线、绝对截止时间仍未完成。

新鲜回归：新增流程 46 条 RED→GREEN，普通路径接线后四组 90 条通过；格式整理后全部浏览器脚本 210/210 通过，日志 `/tmp/holaday-first-cutover-task4-browser-final.log`。Task 4 的 `pnpm test:ops` 两次自动审批均超时，命令未执行，不能沿用 Task 3 结果称其通过。Biome 仅剩原 host/host-test 已存在的三项 useSingleVarDeclarator；diff-check 通过。

当前实现的顺序存在循环：`retireLegacyRuntime` 与实际命令边界在任何停止前都要求 `all-writers` 且 `producersRunning=0`，但首次流程自身需要停止旧版后台生产者，部分调度与主进程共存。尚无已批准、已验证的旧版独立暂停机制；不能把 fixture 的零计数当真实证据。这是本地接线发现的前置条件冲突，不是新的线上故障结论。

已向用户请求：是否允许在关闭新任务/订单入口、核清在途及外部工作后，先定向停止批准的生产者（必要时包含承载调度的主进程），再验证全局零写入。仅本地实现/隔离测试，不自动修改任务/订单、不把未知工作视为零、不操作生产。尚未收到此项确认，现有停止条件保持不变。

下一步从这里接：先取得上述顺序决定，再实现 Task 4 的真实 host/受保护清单、journal attempt 与证据绑定、候选 readiness 命令、shell 和截止时间；不要重做 Task 1–3。Task 5/6、支付方真实演练与全分支独立审查仍未完成，不能部署。当前没有运行测试或遗留容器；`scripts/__pycache__/` 为本轮 Python 测试生成的两个缓存文件，未纳入交付。

局部接口裁决：first adapter 增加必需的 `reconcile(identity)`，否则终态只有名称没有开放后核对；共用尾段的 closeAcknowledged 只接受同实例协议1且 closed 的回执，不以调用未抛错代替证明。对应代价：缺少真实核对/回执的适配器继续拒绝完成。

## 较早断点历史与证据（Task 2 时）

- 工作树：`/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo`。
- 分支：`codex/browser-release-candidate-20260925`；本次断点前代码 HEAD：`c37ddbd9bc5f96321dfb9f6a6bdbd72cda6a5943`。
- Task 1：候选/配置/迁移/操作记录绑定的 readiness 和受保护证据读取，提交 `96dc4929`。
- Task 2：国内支付及 PayPal 只读查询、主机/数据库证据采集与原子发布原语，提交 `c37ddbd9`。生产适配器接线仍属于 Task 3/4；完整外部支付演练证据仍属于 Task 5，不能把注入 IO 或签名测试样本当生产事实。
- 最新本地检查：证据采集测试 33 条、国内查询 23 条、PayPal 查询 18 条通过；浏览器脚本回归 125 条通过；国内支付全套 68 条通过；orchestrator 全套 8,579 条通过、1 条既有跳过。类型检查及脚本专项严格类型检查通过。
- 日志：`/tmp/holaday-first-cutover-task2-final.log`、`/tmp/holaday-first-cutover-task2-browser-regression.log`、`/tmp/holaday-first-cutover-task2-cn-final.log`、`/tmp/holaday-first-cutover-task2-orchestrator-full.log`。
- Task 3 已读任务说明，尚未写实现。Task 4–6、Linux 全流程演练和独立审查未完成。

## 发现的计划冲突

批准设计禁止自动 SIGKILL；Task 3 进一步规定通过 pidfd 固定进程身份后只发 SIGTERM。与此同时，它要求禁止旧 PM2 实例自动重启。

[PM2 官方说明](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/)规定标准停止先发 SIGINT，超时后发 SIGKILL。更改初始信号不等于禁止超时强杀。

检查上游实现的结论：

- [stopProcessId/restartProcessId](https://github.com/Unitech/pm2/blob/master/lib/God/ActionMethods.js)：停止会修改管理器状态并调用 killProcess；重启虽然合并配置，但随后实际停止/重启，不是对当前进程无副作用地禁用重启。
- [killProcess/processIsDead](https://github.com/Unitech/pm2/blob/master/lib/God/Methods.js)：使用数字 PID 发信号，并有超时 SIGKILL 路径。
- [RPC 接口](https://github.com/Unitech/pm2/blob/master/lib/Daemon.js)：所检查的接口未找到受支持的单应用、不中断进程的 autorestart 更新方法。stopWatch 只处理文件监视；全局停止标志/停止整个 daemon 不是本次允许的替代方案。

以上是官方文档和上游源码依据，**未在本次重新核实线上 PM2 版本或配置**。不能据此声称线上特定版本已实测，也不能把本地预设 `autorestart:false` 当作解决现有自动重启实例的证明。

## 待用户决定的最小调整

建议允许首次引导中增加独立的“PM2 定向停止”路径：只针对身份、管理器和进程树已核实的批准对象，接受 PM2 已明确核对的正常停止信号和超时强制结束行为。前提是入口已隔离、未解决工作为零；其他应用和整个 PM2 daemon 不动。未托管进程与普通发布原有 pidfd 停止路径不放宽。

风险：超时强制结束可能中断未识别的在途工作；PM2 自身数字 PID 停止不提供 pidfd 的相同保障。因此不能沿用“只 SIGTERM、绝不强杀”的承诺，也不能未经确认便实现为默认路径。实际版本、超时、树边界、其他重启来源或旧工作归属不清时仍拒绝切换。

这只是设计变更建议，尚未批准，不是生产停机授权。若用户不接受，则保留限制，重新选择首次停机方式，不能用隐藏补丁改 PM2 或模拟成功跳过。

## 下一条执行指令

用户决定后，先更新设计/计划中的对应停止约束，再从 Task 3 开始 RED→GREEN；不要重做 Task 1/2。沿用 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/progress.md` 中的接口裁决。全部本地验收与整分支审查完成后，另行提交部署清单。

未触碰：生产进程/配置/数据库、支付结算与权益规则、额度、UI、模型路由、浏览器扩展安装。未 push、merge 或部署。当前没有由本轮遗留的运行测试或容器。
