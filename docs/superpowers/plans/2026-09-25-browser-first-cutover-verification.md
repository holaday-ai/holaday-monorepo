# 浏览器首次切换验收记录

## 当前结论：未完成，不能执行生产切换

## 2026-09-29原host至真实源备份/Mac恢复同次故障链（基于75760ffe）

原恢复父夹具六参数、原Linux物理夹具、原host/site/journal/backup/恢复工具均复用。增加`CUTOVER_QA_HOST=1`和只读公开缓存路径，恢复后的故障只能为`before-migration`。不是源SQL成功或新候选启动：在原host第一次调用源迁移命令前抛错；此时实际恢复回执必须已落盘、journal为migration_started，无bootstrapSeed。断言计数恰为1及原归一化错误`MAINTENANCE_RELEASE_FAILED`，不自动重试。真实候选6a46ee0f与当前协调器源码分开记录，现场/支付scope仍合成。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 原组合未接的RED | 退出1；真实离线安装成功后命中原fullHost/sourceQa互斥断言，源2表目标0表 | `/private/tmp/holaday-host-recovery-red-ready.log` |
| 首次接通链 | 退出1；实际源导出/恢复/61SQL/回执均已完成，源2表目标90表；测试误期待未归一化故障文本，不能计通过 | `/private/tmp/holaday-host-recovery-connected.log` |
| 最终原host同次故障链 | 退出0；原host准备/停止/真实备份/恢复/61SQL/回执后故障一次，源2表目标90表，未seed/start/open，效果计数1 | `/private/tmp/holaday-host-recovery-final.log` |

前两次bootstrap失败另记于red.log和diagnostic.log：overlay目录fs.rename EXDEV，不是产品门禁失败；改QA启动为mv保留占位后继续。诊断只写私有0600限长16KiB文件，不输出业务行/密钥。每次尝试新源/目标/attempt/窗口，没有重用不明SQL结果；失败资源逐一身份核验清理，最终正常资源由原driver核验清理。仅删除可重建合成QA数据，日志/备份资料保留。两MJS Biome/node语法/diff检查退出0。完整ops关联回归本轮另附最终结果，不冒称生产/整分支验收。

最终原`pnpm test:ops`（显式QA age）：120/60/16/869及Python12，退出0、零跳过；`/private/tmp/holaday-host-recovery-ops.log`。仅离线支付回归，不调用PayPal/商户/模型服务。本次没有修改生产模块，没有新鲜整分支独立审查、完整应用成功率或部署通过结论。

原非host六参数入口兼容性回归亦退出0：`/private/tmp/holaday-host-recovery-legacy-regression.log`，parseEnv仍正确消费原单行配置；同次停止/真实备份/恢复/61SQL/回执后原明确尾段拒绝，源2表目标90表，未seed/start/open/replay。该8bda1020资源记录的源/目标/卷经driver核验清理，仅合成QA数据；新host和原入口两例的日志/私有恢复证据均保留。两MJS最终静态检查和diff-check退出0。

## 2026-09-29原host准备与同日志物理停止（基于bc6cc0f3）

原`browser-first-cutover.integration.test.mjs`新增`CUTOVER_QA_LOST_EFFECT_CASE=host`。需要保留的QA Git/build环境；原unknown/known仍用新原age镜像容器。host模式直接使用原host所有方法，不预建journal、不替换stage/migrate/start；attach接原site/receiver。原Git候选6a46ee0f、源ede74e47，协调器为当前源码副本；真实锁定安装/tsc、完整61SQL manifest、uid998 v2报告读取、原风险绑定/startup/注册/pidfd停止，同attempt到缺备份拒绝。空数据库/支付事实、另一主机与入口仍明确合成，没有源备份/恢复/候选启动或生产效果。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 新断言对旧预建journal | 退出1，准确命中`QA_ORIGINAL_HOST_REQUIRED`，b40不等于真实候选 | `/private/tmp/holaday-original-host-red-actual.log` |
| 原host正式Linux集成入口 | 1/1，退出0、零跳过；约60.9秒；备份缺失保持维护，无receipt/seed/open，site锁定不得重出证明，旧外部效果仍1，QA resurrect只恢复无关服务 | `/private/tmp/holaday-original-host-final.log` |
| 原unknown Linux入口 | 1/1，退出0、零跳过 | `/private/tmp/holaday-original-host-unknown.log` |
| 原known Linux入口 | 1/1，退出0、零跳过 | `/private/tmp/holaday-original-host-known.log` |
| 不加SYS_PTRACE对照 | 原unknown 1/1，退出0、零跳过；不支持“需要扩大权限”的推测 | `/private/tmp/holaday-original-host-nocap.log` |

诊断失败完整保留，不混入通过数：red.log为PPID0不符观察契约；red-final.log为/source软链接使接收端入口未执行；first.log为未提供合成数据库/支付scope；connected.log与diagnostic-clean.log为30分钟QA窗口超出原未托管停止剩余15分钟限制（原限制不改）；window-fixed.log已真实停止但测试错误要求失败锁定site再次出证明，修正为验证拒绝与独立停止/端口证据。中间一次finally错误遮蔽清理，diagnostic.log出现ETXTBSY；仅停止/重启精确QA容器终止遗留合成进程，修正夹具finally保留失败退出码且继续清理。无产品代码修复或放宽门禁。完整ops回归结果待本轮补充。

全部旧尝试文件与锁保留，未清锁续跑。候选工具实际从/source运行（真实目录），继承上轮fixed PATH修复；本轮没有重新安装环境或构建镜像，没有支付/模型API或生产凭据访问。本模式当前与sourceQa组合显式互斥，原Mac恢复需要随后接入，不能称完整6.R3或首次发布完成。

本轮最终原`pnpm test:ops`：120/60/16/869及Python12，全命令退出0、零跳过，日志`/private/tmp/holaday-original-host-ops.log`；两MJS Biome/node语法及diff-check退出0。PayPal测试仅离线假SSH，不访问其服务。没有新增完整浏览器/应用成功率或独立整分支审查结论。

## 2026-09-29原host候选构建与低权限readiness（基于6a46ee0f）

实际Debian/Node22、原host自己持锁并stage；候选6a46ee0f、源ede74e47、全61SQL摘要`dd989a28fd9728b2f3f68bac80a29576b28cfa5863b7dc1641f72914c60fdb42`。新增夹具必须显式`CUTOVER_QA_STAGE=1`，Docker/root、固定只读QA origin和新文件排他创建；不是生产入口。schema1外部facts为合成、商户为空；不证明v2现场观察或真实支付恢复。实际tsc退出0，不以产物存在或mock build作为唯一依据。执行工具使用本轮源码副本，候选仍为上述已存在提交，最终发布还须重新固定完整工具/候选摘要。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 最初真实stage及缺失证据拒绝诊断 | 退出0；clone/install/tsc/原journal通过，按预期拒绝未配置readiness；未调用原生消费者 | `/private/tmp/holaday-host-stage-red.log` |
| 首次真实uid998消费者 | 退出1；定位固定PATH找不到`/usr/sbin/runuser`，不是验收通过 | `/private/tmp/holaday-host-stage-ready.log` |
| 固定PATH回归RED | 1项失败、退出1、零跳过；确切PATH断言 | `/private/tmp/holaday-stage-path-red.log` |
| 修复PATH后真实消费者 | 退出1；已进入消费者，QA父目录0700导致EACCES；未放宽生产门禁 | `/private/tmp/holaday-host-stage-fixed.log` |
| 最终真实host stage、原证据发布/uid998读取及权限反例 | 退出0；正常读取→0600拒绝→0640恢复读取，journal保留preflight/锁，无候选启动/SQL | `/private/tmp/holaday-host-stage-final.log` |
| 普通/首次host关联Mac回归 | 102/102，退出0，零跳过 | `/private/tmp/holaday-stage-path-regression.log` |
| 同两组实际Linux Node22回归 | 102/102，退出0，零跳过 | `/private/tmp/holaday-stage-path-linux-regression.log` |
| 最终原ops回归 | 120/60/16/869及Python12，整命令退出0，零跳过 | `/private/tmp/holaday-stage-path-ops-final.log` |

准备工具只在独立QA容器内安装，原镜像未重建，网络下载仅公开构建依赖；后续断网缓存构建。无生产配置/密钥/socket/hostPID/宿主端口。所有合成尝试的锁、候选和报告完整保留，不清锁续跑；正常场景的测试模型端点只指127.0.0.1:1且rollout=off，没有调用模型/支付API。最终新fixture的默认正反例已实跑，额外`--expect-missing-evidence`选项尚未单独重跑（最初缺证据诊断是临时夹具，不混写成最终夹具完整覆盖）。三文件Biome及diff-check退出0。只修共用候选PATH，没有新增生产执行能力；原6.R3全链、生产facts/恢复/非PayPal/整分支审查及发布仍未完成。

ops初次在默认沙箱中退出1：本地HTTP/WS监听127.0.0.1被EPERM拒绝（10失败），且未显式启用age导致34跳过；此记录`/private/tmp/holaday-stage-path-ops.log`不是代码RED或通过。正常申请仅本地测试所需权限并显式传`CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age`后，上表最终全命令退出0、零跳过；没有绕过拒绝或调用真实支付服务（PayPal相关脚本仅离线假SSH回归）。全部测试session已结束；核对标签/完整ID/无活跃测试后停止并保留专属QA容器，原两个健康MySQL/Redis仍运行。没有完整应用/浏览器成功率重测或独立整分支审查结论。

## 2026-09-29同attempt物理停止→真实源导出→Mac隔离恢复（基于ede74e47）

复用原`browser-recovery-target-qa.mjs`六参数模式，增加`CUTOVER_QA_RETIREMENT=1`；错误回执反例再加`CUTOVER_QA_OMIT_RECEIPT=1`。原握手三参数模式、独立源Mac协调器模式和未知/已知Linux停止入口均保留。原停止镜像、MySQL8镜像和`holaday-recovery-pack-lkZ2Vd`不变；新Mac打包mysql2仅提供QA数据库连接，不替换源导出/快照/迁移实现。mysqldump为缓存MySQL镜像真实客户端，版本8.0.46，Debian原库满足其依赖；不复制生产配置或恢复私钥。

每例新建两份带独立attempt标签的MySQL容器及卷，network-none/无宿主端口/1CPU/768MiB/256PIDs/event_scheduler=OFF。Linux停止容器1CPU/512MiB/256PIDs，私有PID、原SYS_PTRACE，网络仅共享该合成源容器的孤立命名空间，不能到公网；恢复目标未与协调器共享网络、卷或进程。只读scripts/ops/client挂载，原保护要求不放宽。源预置原两张表、中文/BLOB/NULL、触发器和禁用事件；Mac恢复目标必须空。源配置使用实际root:0600的maintenance-target.env和原保护读取器。数据流是实际mysqldump→age→原密文读取器（QA docker exec替代SSH）→Mac认证解密→原独立恢复工具/61SQL→原receipt。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 首个同Linux attempt完整备份段 | 退出0；真实停止/恢复/回执通过，未接候选尾段明确拒绝 | `/private/tmp/holaday-stopped-source-first.log` |
| 最终版本及独立业务值/原受保护配置检查 | 退出0；源保持2表，目标61迁移后90表；旧外部效果1，未重放 | `/private/tmp/holaday-stopped-source-final.log` |
| 初始漏回执反例 | 预期退出1，实际目标90表而原日志检查失败 | `/private/tmp/holaday-stopped-source-mutant.log` |
| 最终漏回执反例 | 预期退出1，明确`QA_DURABLE_RECEIPT_MISSING,AssertionError`；不是环境依赖失败 | `/private/tmp/holaday-stopped-source-mutant-final.log` |
| backup/host/site/recovery-session/mysql/journal六文件串行回归 | 244/244，退出0，零跳过 | `/private/tmp/holaday-stopped-source-regression.log` |

本轮临时资源驱动和精确清理脚本保留`/private/tmp/holaday-stopped-source-{qa,cleanup}.mjs`，各次资源ID/attempt/卷记录在同前缀UUID JSON。驱动不重试导入：失败保留容器供观察，另行核验后清理；成功读取源/目标表数后清理本例资源。三参数及六参数的具体调用方式可从原QA夹具参数读取；runtime仍用原builder生成并以root:root/0700复制进专属目标。恢复目标软件闭包、候选清单和原迁移摘要均校验。

附带调查如实记录：首次镜像格式命令因镜像无Entrypoint字段退出1，仅查询模板错误；改用实际容器命令核对OS/ldd/client。等待恢复期间怀疑Node22文件流关闭，独立无秘密小文件探测退出0，原正常流程随后通过，**没有所谓产品流关闭故障或相应修复**。一次只读探测遇到QA已自动移除，退出1。以上均非功能验收或有效RED。

仍未使用原host完整stage/候选安装、源上线迁移、实际新应用启动/readiness/open、其他主机及所有业务事实；新模式只闭合“物理停止到持久备份回执”，不与旧组件结果相加为整发布通过。没有重跑完整browser/应用套件或独立整分支审查，没有生产操作/部署。

最终串行回归：原Linux未知/已知入口各1/1、退出0、零跳过，日志`/private/tmp/holaday-stopped-source-{unknown,known}-regression.log`。原`pnpm test:ops`的120/59/16/868及Python12全部退出0、零跳过，日志`/private/tmp/holaday-stopped-source-ops.log`（含原离线PayPal假SSH测试，没有调用PayPal服务）。两MJS Biome/node语法与git diff检查退出0。所有测试会话结束；两次正常和两次反例各自的新源/目标及卷已按精确ID/标签/归属清理，另删除了仅提取客户端的未启动QA容器和空匿名卷。仅删除可重建合成数据，私有QA恢复证据/资源记录/日志保留。Docker最终仅原健康`holaday-mysql`和`holaday-redis`，无生产变更、无全分支验收或发布结论。

## 2026-09-29同attempt物理停止到Mac恢复会话（基于30eedbea）

仅改原两个QA夹具，不改产品/部署模块。Mac父端运行原恢复服务器，Linux端复用`holaday-first-cutover-age:qa`（镜像ID `43e32ddaf0de5743635ec79acd32940d32151fd495ad6e642100b935fd3776bf`）及原物理停止夹具、transition/site/journal。每例新Linux容器，无网络/宿主端口，1CPU/512MiB/256PIDs、私有PID，SYS_PTRACE只限容器既有进程检查，scripts/ops只读挂载；不挂Docker socket或Mac密钥。独立MySQL8目标按原严格目标契约持有专属卷、1CPU/768MiB，无网络且全程无导入。

在原目标夹具三个参数后不传runtime/source参数，显式`CUTOVER_QA_RETIREMENT=1`；负例另设`CUTOVER_QA_RECOVERY_DRIFT=1`。从repo根运行，保留原PATH/TMPDIR/age参数。父端只将公开scope给Linux子进程，candidate/config/manifest/inventory/attempt相等有实际断言；Linux完成真实停止后，每次恢复检查调用原site动态检查，而非固定true。正例目标身份检查完成仍保持`backup_verified`失败意图、无receipt/候选/open。负例第三次检查加入合成已知动作，拒绝必须发生在绝对窗口之前，计数仍1、QA resurrect不恢复旧目标。源身份占位仅为握手；没有执行源导出或恢复，不能与上一轮结果相加为完整发布。

正常最终日志`/tmp/holaday-retirement-recovery-final.log`退出0；已知动作及新增新鲜窗口断言日志`/tmp/holaday-retirement-recovery-known-final.log`退出0；清理修正后的`/tmp/holaday-retirement-recovery-known-cleanup.log`退出0，实际约15秒结束（日志创建到完成06:33:26–06:33:41 JST），不再等满120秒。原Linux入口未知/已知各1/1、退出0、零跳过，日志`/tmp/holaday-retirement-recovery-{unknown,known}-regression.log`。静态Biome/node语法/diff检查通过。完整新host安装/源导出/恢复/应用启动/开放仍未运行。

初次`/tmp/holaday-retirement-recovery-first.log`退出1，因为直接把观察夹具作为容器PID1，违反已有pid>1/ppid>=1契约；这是QA调用错误不是产品RED。改为复用原文档中的Node父进程spawnSync，镜像/身份校验不变。第一次故障案例虽然在新鲜窗口内拒绝，但继承stdin仍在读取，使容器等满120秒；最终QA在journal/远端清理之后暂停自己继承的stdin，不修改原wire。清理前调查镜像缺少ps，退出127；随后容器已退出导致只读/proc检查报不存在，退出1，均不算验收通过。

最终原`pnpm test:ops`：120/59/16/868及Python12，退出0、零跳过，`/tmp/holaday-retirement-recovery-ops.log`；两MJS Biome/node语法/diff检查退出0。没有运行完整browser/应用全套或独立审查。所有会话已退出；最后核对专属目标仍0表后，删除本轮QA容器及专属卷，只移除空测试设施；原MySQL/Redis健康，日志及受保护QA临时元数据保留。

## 2026-09-29独立源/目标备份恢复段（基于8e83ea76）

只扩展原`scripts/fixtures/browser-recovery-target-qa.mjs`，生产模块未改。新参数形式为原四参数后追加`sourceContainerId sourceAttempt`；两容器都须先按原隔离契约建立，容器和卷均有对应attempt标签、不同serverUUID、无网络/端口/绑定挂载，1CPU/768MiB/256PIDs，event_scheduler=OFF。源仅预置夹具的两张合成表、中文/BLOB/NULL、触发器和禁用事件；目标必须空。每次导入使用新目标，不重跑失败或已迁移目标。

使用原`build-recovery-runtime-qa.mjs`新编译工具包，目标及源工具目录必须root:root/0700，原manifest及全文件闭包校验不放宽。本轮包`holaday-recovery-pack-lkZ2Vd`，runtimeDigest=`b6853507198b46b5f9ca808b9b23625ac5dc00e9f6dfb33b60d4d9be3988deeb`，migrationDigest=`dd989a28fd9728b2f3f68bac80a29576b28cfa5863b7dc1641f72914c60fdb42`。源工具仅snapshot，不运行迁移；mysqldump流直接交age，无明文SQL文件。Mac父进程保管QA私钥，子进程仅公开scope；不是生产SSH/真实恢复私钥测试。

| 本轮验证 | 结果 | 日志 |
| --- | --- | --- |
| 原备份协调器→独立真实源导出→原恢复会话→快照比较→61迁移→业务/源未变→原日志回执 | 两次新目标退出0，无跳过分支 | `/tmp/holaday-recovery-distinct-green-verified.log`、`/tmp/holaday-recovery-distinct-final.log` |
| `CUTOVER_QA_OMIT_RECEIPT=1`：QA适配器只返回成功、没有落盘 | 预期退出1，`QA_COORDINATOR_FAILED: AssertionError`；目标90表证明迁移已执行，实际日志无backupReceipt/候选/open | `/tmp/holaday-recovery-distinct-receipt-mutant.log` |
| 原backup/recovery-session/mysql/journal四文件串行回归 | 119/119，退出0，零跳过 | `/tmp/holaday-recovery-distinct-regression.log` |
| 触及MJS Biome、node --check、git diff --check | 退出0 | 本轮命令结果 |

初始失败不掩盖：旧模式试跑`holaday-recovery-seal-red.log`在工具目录0755处失败，没有达到新增回执断言，不算有效RED；第一独立源运行`holaday-recovery-distinct-first.log`已完成迁移并实际写回执，但测试错误读取不含回执的effects投影，退出1，已改为受保护日志原文件断言；另一个新目标`holaday-recovery-distinct-green.log`在初始目标检查拒绝（卷未贴attempt标签、表数0），改为另建标签完整目标，没有放宽保护或重放SQL。最终故障消息只输出白名单错误码，不输出子进程原始数据/密钥；即使父会话失败也等子进程退出。

协调器运行在Mac Node24.19；真实MySQL/快照/迁移工具运行在Linux，不能写成整个协调器已Linux通过。物理停止、host安装、现场facts、候选与open仍未接入本模式；journal阶段是夹具设定。此处不能与另一次停止演练结果相加为同attempt完整成功。未运行完整browser/ops/应用全套或整分支审查。所有本轮QA容器/卷仅含合成数据，身份核实后清理，日志保留；原服务未改。没有生产备份、部署或任务完成结论。

2026-09-29续跑（基于`e994cfd0`）：原6.R3预定Linux入口现串联真实transition/site/journal及PM2/pidfd停止，新增非支付HTTP动作已发生但响应丢失的未知/已知配对。只覆盖停止与故障保留段，未覆盖完整恢复/新候选开放；详见下方“丢响应物理演练”。不重试被拒绝的数据库管理凭据查找，现场独立facts仍未具备。

2026-09-29后续核查（基于`21b0fac6`）：真实应用数据库账号缺全局PROCESS，事务/复制状态查询被拒绝，只见同账号4个Sleep连接；不证明未知写入者为零。原host现可调用严格权限覆盖的独立MySQL观察器，但它只覆盖数据库这一来源，原site的完整独立facts仍待组合，生产权限没有更改。新鲜browser1019/1019、Linux关联115/115及真实LinuxNode22/MySQL五项权限/跨账号/跨库事件/事务反例均通过、零跳过、退出0；详见checkpoint最新段。并未执行全切换、生产备份、ops/应用全套或部署。

本轮权限语义依据：[MySQL PROCESS及全局权限](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html)、[事件可见性与EVENT权限](https://dev.mysql.com/doc/refman/8.0/en/events-privileges.html)、[复制总applier状态](https://dev.mysql.com/doc/refman/8.0/en/performance-schema-replication-applier-status-table.html)。实现不把局部EVENT授权的空集合或权限异常当全服务器空集合；全局EVENT也有管理能力，不能为读取而静默授予应用账号。两遍元数据采集不是事务隔离或持续禁止重连的证明。

本文件承接原实施计划Task6/6.R3，不是新计划。2026-09-29本轮实现基于`b9454ca1`，Task4原BASE仍为`844c2ced779fa360b62e2bfbdd87d4909d13b8a0`。已通过组件不能替代完整成功/故障演练，`--execute`仍明确拒绝。

| 验收范围 | 状态 | 本轮证据与限制 |
| --- | --- | --- |
| 三组原WS重启恢复 | passed | 真实MySQL迁移/合成记录、JWT和WebSocket；新增受控/旧版配对后9/9，退出0、零跳过 |
| 原队列持久化回归 | passed | 54/54，退出0、零跳过 |
| 受控候选不重派发旧执行步骤 | passed | 同一真实存储样本，旧模式派发一次、受控模式不派发，任务与步骤完整行不变；只覆盖WS恢复入口 |
| 固定协调器/现场编排/transition工具模块闭包 | passed | 28个固定模块离开检出目录可真实导入；Mac及Linux Node22均完成针对性核验，身份/缺模块等19项通过 |
| 保留的headed浏览器观察 | passed | 仅当时只读观察成功；不是已隔离、没有注入脚本或没有外部请求的证明 |
| 独立knownExternalWork/unknownWriters现场来源 | blocked | 原facts仍无完整默认现场实现；不以空白页、数据库空集或源码能力证明填零 |
| 6.R3全流程成功/故障/丢响应不重放 | partial | 已接真实transition/site停止及故障保留段，独立HTTP计数为1；恢复/候选/open尾段明确拒绝，完整成功与晚到故障仍未运行 |
| 实际生产停写备份→Mac隔离恢复 | not-run | 既有合成MySQL/age历史通过不改称生产恢复；本轮不重做密钥和已有组件 |
| 非PayPal支付恢复证据、整分支审查 | not-run | 历史商户查询不是恢复演练；PayPal继续全部延期 |
| PR / 合并 / 部署 / 上线 | not-run | 本轮没有执行；分别验收，不合并成“发布成功” |

## 丢响应物理演练：2026-09-29停止/故障段

入口是原计划中的`scripts/browser-first-cutover.integration.test.mjs`，不是新框架。真实LinuxNode22.20/PM2 6.0.14，缓存镜像`holaday-first-cutover-age:qa`，无网络/宿主端口/生产挂载/凭据，私有PID，1CPU/512MB；SYS_PTRACE仅限该容器内既有跨UID进程观察。只读挂载当前scripts和ops。每个案例新容器，结束自动删除该容器合成进程/数据，不触碰原MySQL/Redis。

| 本次验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 未知旧请求：真实动作后断响应→停止→恢复未配置而保留失败 | 1/1，退出0，零跳过；计数1、风险摘要保留、QA resurrect不恢复旧进程 | `/tmp/holaday-lost-effect-unknown-verified.log` |
| 已知未决动作：拒绝中断，不进入停止 | 1/1，退出0，零跳过；site拒绝码、旧健康端口仍200、计数1 | `/tmp/holaday-lost-effect-known-site-contract.log` |
| 临时副本移除已知动作保护 | 0/1，退出1，零跳过；实际错误进入backup_verified，阶段断言捕获 | `/tmp/holaday-lost-effect-mutant.log` |
| 原`--execution-site-interruption`物理模式 | 退出0；ss/真实受保护日志/PM2/pidfd停止与无关进程恢复断言通过 | `/tmp/holaday-lost-effect-original-physical-verified.log` |
| 原`pnpm test:ops` | 120/59/16/868及Python12，全部退出0、零跳过 | `/tmp/holaday-lost-effect-ops.log` |
| 两个触及MJS Biome、git diff --check | 退出0 | 本轮命令结果 |

不宣称本轮重跑完整browser1019、应用全套、类型检查或独立整分支审查；未改应用/生产模块。原ops的固定测试列表不包含新Linux入口。手工Mac广义`browser*.test.mjs`枚举必须排除`*.integration.test.mjs`，再单独运行下列真实Linux案例；入口在Mac/缺少场景变量时硬失败，没有用skip替代Linux验证。

在当前工作树执行，两例串行、每例新容器，任一失败立即退出：

```bash
cutover_workspace=/Users/yaleiqi/.codex/worktrees/browser-release-candidate/holaday-monorepo
for cutover_case in unknown known; do
  docker run --rm --network none --cpus=1 --memory=512m --cap-add SYS_PTRACE \
    -e "CUTOVER_QA_LOST_EFFECT_CASE=$cutover_case" \
    --mount "type=bind,src=$cutover_workspace/scripts,dst=/source,readonly" \
    --mount "type=bind,src=$cutover_workspace/ops,dst=/ops,readonly" \
    holaday-first-cutover-age:qa \
    /opt/node22/bin/node --test /source/browser-first-cutover.integration.test.mjs || exit "$?"
done
```

原模式用Node父进程`spawnSync`启动`/source/fixtures/browser-registration-removal-linux.mjs --execution-site-interruption`，把子退出码原样传回；不能直接让观察夹具成为容器PID1，因为原身份契约要求pid>1、ppid>=1。新入口天然由node:test派生子进程，满足此约束。

初始失败保留：`/tmp/holaday-lost-effect-linux-first.log`退出1、0/2，分别是夹具误读journal摘要为完整before对象，以及同容器第二案例残留PM2路径；已按实际摘要形态断言、每例改独立新容器，未改生产校验。`/tmp/holaday-lost-effect-original-physical.log`退出1来自上述PID1启动错误，父子结构复核通过。追加拒绝码断言时错误期待内部MAINTENANCE码，`/tmp/holaday-lost-effect-known-verified.log`退出1、0/1；核对真实site.run统一包装为CUTOVER_SITE_UNPROVEN后只修预期，最终site-contract日志通过。初次Biome的独立block、label、模板及导入排序4项失败已在测试代码修正。上述夹具/调用错误不是产品RED；只有临时模块缺失保护的变异属于有效反例。

**尚缺：** 这里的阶段名backup_verified是失败发生时的预写意图，不是恢复通过。真实failureObservation记录新候选not-started、关闭未确认；没有fake backup/migrate/start/verify/open成功。其他主机、入口、业务/SQL/恢复来源观察仍是明确的合成依赖。原6.R3完整成功、候选dirty、开放后已知动作关闭及不重放、真实停写备份/Mac恢复、非PayPal恢复证据和整分支审查均未完成。下一轮应复用此入口接剩余尾段，不重做计数器/停止组件。

## 应用恢复：环境与可复现边界

本轮最终串行回归：browser998/998；原ops120/59/16/847及Python12；全部退出0、零跳过。日志`/tmp/holaday-recovery-closure-browser-final.log`、`/tmp/holaday-recovery-closure-ops.log`。类型检查在1536MB堆OOM后、QA容器清理后，以2GB堆串行完成、退出0，`/tmp/holaday-recovery-typecheck-final.log`。不重跑/冒称此前8602项应用全套为本轮新证据。所有本轮测试进程均已退出。

源码快照：`/private/tmp/holaday-recovery-snapshot.152nsH`，由当前提交的apps/orchestrator、packages及工作区配置归档创建，排除全部`.env*`；复用现有依赖，无安装。执行前使用`env -i`，仅传合成DATABASE_URL/REDIS_URL/JWT、PATH、NODE_ENV、TZ、WS_PORT=39500和HTTP_PORT=39501。测试明确使用`vitest.integration.config.ts`，singleFork/非文件并行；应用运行于Mac Node，数据库运行于Linux容器，**不是Linux应用进程验收**。

专用资源标签`holaday.qa=recovery-0c24df2bc9ea998f`：新MySQL仅发布127.0.0.1:13316，新Redis仅发布127.0.0.1:16379，独立网络，无宿主绑定/生产凭据。数据库`holaday_0c24df2bc9ea998f_integration`只含本例合成数据；测试结束后核实标签并停止本例两个`--rm`容器、移除专用网络，合成库随一次性卷清除，不保留恢复用途。原holaday-mysql/holaday-redis保持健康且未操作。

在快照apps/orchestrator内执行的测试主体：

```sh
node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run \
  --config vitest.integration.config.ts \
  src/ws/restart-recovery.integration.test.ts \
  src/ws/restart-recovery-executing.integration.test.ts \
  src/ws/restart-recovery-transient.integration.test.ts --maxWorkers=1
node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run \
  src/agent/task-queue-persistence.test.ts --maxWorkers=1
```

不能直接在含真实dotenv的检出目录或默认3306/6379执行以上命令。首次未修改测试8/8日志`/tmp/holaday-recovery-ws-first.log`；最终9/9日志`/tmp/holaday-recovery-ws-final.log`；队列54/54日志`/tmp/holaday-recovery-queue.log`。

受控用例使用真实DrainController/状态文件、真实DB/JWT/WS，仅开放授权回调为显式合成成功，不冒充发布readiness。使用真实welcome及有序WS标记等待可观察输出，不把连接被拒绝/任意短暂sleep当成不重放。QA副本中唯一移除`state.work.controller`恢复保护后，strict=true收到实际click派发，1失败/3通过、退出1；恢复原保护后全部9项通过。日志`/tmp/holaday-recovery-strict-mutant-authorized.log`。原实现从未移除保护；变异仅发生在临时副本并已恢复。

第一次变异运行被沙箱阻止连接13316，hook失败及4项跳过，退出1；不计RED或验收。获准本地测试网络后才得到上述断言失败。类型检查1536MB首轮退出134（JS堆OOM），不算通过，最终结果见最新checkpoint。

## 工具安装范围核对

原22模块集合能导入检查入口，但未包含现场site/transition所需的6个现有模块。现将gateway-session、payments、recovery-session、registrations、site、transition绑定到原固定清单，继续要求完整集合、真实候选Git字节、文件权限和二次身份校验。不增加任意模块入口、默认facts、工具安装或生产执行权限；远端工具、native helper及运行时MySQL依赖仍各自核验，模块导入成功不代表它们已经安装可运行。

清单契约先出现15失败/4通过（`/tmp/holaday-coordinator-site-closure-red.log`），补齐正式清单后19/19。真实Linux Node22、已有QA镜像、无网络、只读scripts/ops、限1核512MB：19/19、零跳过、退出0（`/tmp/holaday-coordinator-site-closure-linux-verified.log`）。独立子进程导入真实28文件；身份校验用例的/proc/Git/UID依然是夹具，不能说完成真实受保护部署。

Linux前两轮导入探针分别错误触发CLI、使用不存在的argv[1]被原realpath保护拒绝（各18/19、退出1）；改为实际独立probe文件后通过，未放宽产品入口保护。完整浏览器回归首轮995/998、退出1：两个原发布夹具在env-i省略TMPDIR后继承/tmp的wheel组而拒绝，另一失败是上述已修探针；显式用户临时目录后的最终结果见checkpoint。

## 现场与恢复来源事实

UTC2026-09-28T16:18:20.951Z，沿既有阿里云跳板到Vultr，只读两次9223监听归属和本地`/json/list`。只返回数量/摘要：1个page、1个about:blank、其他目标0；监听前后稳定。没有导航、页面内容、cookie、profile、关闭页面、业务SQL或提供商调用。证明`/private/tmp/holaday-browser-source-observation.Q34mom/proof.json`，退出0；此时点证据不作为未来维护窗口凭据，也不说明空白页面没有执行脚本/外部副作用。

候选源码恢复入口核对：application-main受控启动跳过旧启动扫描/rehydration；WS executing在controller存在时禁止重新派发，本轮已用真实DB验证；队列只持久化状态，不会凭持久行重建原闭包。planned-runner仍有运行任务恢复入口，必须由实际生产者暂停/开启顺序及持久来源核对约束，不能仅凭启动扫描被跳过宣称所有恢复来源均已隔离。

下一步仍沿原4.R2/6.R3：完成独立现场facts及首次工具/单次入口接线，再做完整真实成功/故障闭环与恢复、非PayPal证据及整分支审查。不要重复13表、TCP、能力源码、密钥、商户或本文件已通过的恢复组件来替代缺失工作。
