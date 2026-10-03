# 浏览器首次切换：恢复密钥保管记录

日期：2026-09-27。用户已明确允许“专用恢复私钥保存在Mac、另做离线副本、服务器只留加密公钥”。本页记录已执行的设施准备，不是数据库备份回执或部署放行。

## 已配置

- 工具：采用[age官方工具](https://github.com/FiloSottile/age)的原生X25519公钥加密，不复用SSH/API凭据、不自制加密格式。Mac为Homebrew安装的v1.3.1；Vultr为Ubuntu签名仓库`1.0.0-1ubuntu0.1`，CLI报告1.0.0。版本不同，已用真实跨机器样本验证互通；没有声称这是全部版本兼容证明。
- Mac根目录：`/Users/yaleiqi/.holaday-recovery/browser-cutover-20260927`。目录0700，`identity.txt`、`recipient.txt`均0600，属当前用户；已核验无目录软链接、文件单链接和FileVault开启。私钥没有输出到聊天、进入仓库或上传生产机。POSIX权限和FileVault不防御已登录用户/本机管理员被攻陷。
- 主站目录：`/var/lib/holaday-deploy/recovery-20260927`，root0700；仅`recipient.txt`公钥和`custody-probe.age`无业务数据密文，均root0600。既有父目录root0755未改变，不把它错误地当作原有0700目录。
- 公钥文件SHA256（两端一致）：`baf365f52438199cab89c46393b7ef5a66db3c21502013cb3268bca53d4bad99`。
- 无业务数据样本密文SHA256（主站与Mac一致）：`4c5a6e3b6464748c5da5b03485f56a0421e70ac4402f68ceec2ac8418524b7c5`。该样本不包含数据库、环境配置、个人资料或商户信息。

## 本轮实际验证

主站使用公钥生成242字节密文，传回Mac后仅在内存解密，与固定探针文本逐字比较。下列检查均通过：

1. 完整密文可由Mac恢复私钥解密。
2. 只有公钥时解密失败，未输出明文。
3. 密文末字节被改动时解密失败，未输出明文。
4. 密文截短12字节时解密失败，未输出明文。
5. 本地目录/文件权限、属主、单链接及传输摘要符合本节记录。

篡改/截断仅在内存操作，没有覆盖样本或密钥。不是产品回归套件，没有重跑或复用历史397项/真实MySQL2项来冒充本轮结果。

安装前模拟确认主站只新增age，不升级其他包。安装设置`NEEDRESTART_MODE=l`，只列出既有重启提示，未安排系统/服务重启；随后实际核对mysql、nginx、pm2-root均active，主进程启动时间分别仍为2026-09-01、09-15、07-27。首次目录准备因父目录实际0755而拒绝；age已经安装，没有重装，核实事实后仅新建0700子目录。

Mac Homebrew安装自动清理了旧下载缓存、日志和临时安装残留；不是项目或用户业务文件清理。磁盘信息查询一度卡住，仅终止了已核对PID的本轮diskutil查询，未卸载或改磁盘。其返回的SMARTLINK为只读FAT12设备，不能用作本次离线副本；没有往其复制任何文件。

## 2026-09-27：Yalei 独立介质副本已完成并验证，待物理离线保管

用户明确指定“都允许 私钥副本存到U盘 Yalei”。实际核实 `/Volumes/Yalei` 为外接、可移除、可写 USB，ExFAT，卷 UUID `BBE18ECA-095F-301A-8A8E-CC7EC334F01D`。未格式化、改挂载方式、覆盖原文件或操作 SMARTLINK。

在新目录 `/Volumes/Yalei/HOLADAY-recovery-20260927` 排他复制 `identity.txt`、`recipient.txt`、`custody-probe.age`，逐文件同步写盘；保留 Mac 原件。已验证三个文件逐字节相同、U盘私钥导出的公钥与原件一致、公钥文件摘要符合上文记录，并实际使用 U 盘私钥解密探针，与 Mac 私钥解密结果相同且非空。密钥及探针明文未输出到日志或聊天，私钥未上传服务器。另写入并读回 `恢复说明.txt`，包含换 Mac 的保管和验证步骤。

**ExFAT 不提供这里所需的磁盘加密和持久 Unix 权限保护，副本未额外加密。** 已明确提醒用户安全弹出后离线、独占保管；拿到 U 盘的人可能读取私钥。没有擅自设置口令、擦除或加密整盘；也未自动卸载可能承载其他工作的介质。当前只证明独立介质上的副本可恢复，不证明它已经物理断开或完成生产数据库恢复。

不要删除当前Mac密钥、将整个目录提交Git、上传生产服务器或放入未经确认的云同步目录。没有经过验证的另一份私钥时，Mac原件丢失会使该公钥加密的备份无法恢复。

## 仍待接线，不可用探针替代

### 2026-09-28：恢复端实际隔离目标检查与导入

原 `browser-first-cutover-backup.mjs` 新增 `inspectFirstCutoverRecoveryTarget` / `restoreFirstCutoverAgeBackup`，不另建备份或加密引擎。目标由批准元数据固定 `{containerId,imageId,volume,attempt,identity}`：完整容器ID、镜像ID、同attempt专用命名卷及实际 `{serverUuid,database}`。恢复函数不创建、清空、停止或删除任何数据库/容器。

导入前后都检查：容器运行且非特权/宿主PID；network=none、无开放端口、无宿主挂载/额外能力/设备；唯一local专用卷的标签一致且没有其他容器引用；固定资源上限及不自动重启；环境仅允许镜像字段和隔离MySQL初始化字段。数据库必须身份匹配、没有其他业务schema/连接，event_scheduler=OFF；首次导入要求目标库没有表/视图/例程/事件。未知或不符合条件直接拒绝，不能按名称碰原MySQL。

恢复仍由原密文拉取、hash/完整age认证负责。`decryptAgeBackupToFile` 的可选消费回调只在认证、同步发布与inode核验完成后拿到固定只读fd；保持fd打开，消费后再次核验文件字节。正式消费者用固定 `docker exec` 参数把fd送入精确目标的mysql socket客户端，禁用local-infile/自动重连并开启batch binary-mode。只等待一次进程结束，不自动重放SQL，不在失败时删除部分恢复结果。恢复私钥和明文均不上传源服务器。

恢复端必须由原协调器提供实时 `assertScope` 检查，**不得以空回调启用生产执行**。本方法只返回已实测目标身份，不产生backupReceipt；原全对象/数据比较、全61SQL与schema/历史字段核验、原journal回执仍须完成。固定目标信息须来自受保护批准，不能把本次探测输出自动当批准。

### 同一协调器连接上的恢复端会话（实现中，未安装/启用生产入口）

`browser-first-cutover-recovery-session.mjs` 复用现有 `createFirstCutoverSessionWire`，不启动另一个SSH、反向连接或协调器。Mac父进程将原SSH子进程stdout/stdin交给 `serveFirstCutoverRecoverySession`；Vultr原协调器在同一stdin/stdout使用 `connectFirstCutoverRecoverySession`。协议允许attach/inspect/restore/snapshot/migrate/verify/detach；恢复后才能取全量快照，快照后才能单次迁移，迁移后才可校验原始列投影，业务摘要变化拒绝。结束回执后等待协调器完成最后一次异步日志核验并确认detached，再由调用方关闭管道。重复/错序、失联、身份或批准漂移均终止会话，不重试导入或迁移。

Mac受保护目录下 `first-cutover-<attempt>.json` 使用0700目录、当前用户0600单链接文件，检查无软链接、文件身份及预先批准SHA256。结构为 `{schemaVersion:1,binding,maintenanceEndsAtMs,sourceOptions,sourceIdentity,destination,identityFile,target,runtime?}`；`sourceOptions`、`destination` 沿用原 `{facility,directory,attempt}`，target沿用上一节完整目标。runtime是 `{manifestDigest,nodeDigest,toolDigest}`，随整份Mac批准摘要绑定；缺失时只允许原导入，不允许快照/迁移验收。私钥及identityFile路径不经过会话传输。该保管不防御Mac当前用户/管理员被攻陷。

创建顺序：先批准原inventory和binding；再形成Mac清单摘要；最后将摘要绑定到原受保护 **execution.site.backupRecoveryDigest**（与gatewaySiteDigest同级）。不能把摘要放进inventory：Mac清单本身含binding.inventoryDigest，否则产生循环摘要。程序只读，不自动生成批准。

Linux端实时回调使用原 `site.recovery.assertScope(publicScope)`；publicScope只包含binding、维护截止、scopeDigest、源身份、隔离目标身份。它绑定原持有journal、原受保护site和原物理停写观察器，且只在backup_verified意图阶段、同一effects记录有效，不接受Mac上传的stopped标志。恢复函数内部所有scope检查均沿该连接回到此回调。

2026-09-28新增真实子进程夹具已验证原文件journal、同一会话管道、真实禁网Docker/age导入、原全量快照、原61项迁移和原schema/历史列业务比较：`/tmp/holaday-recovery-session-all61.log`退出0。源SSH和物理停写事实仍为合成边界。后续已补齐下节原备份适配器的源库比较/回执接线；正式工具安装及首次CLI入口仍未完成，不能把这个会话验收称为跨主机生产演练或发布通过。

### 原备份协调器的完整站点接线（2026-09-28，本地实现）

原 `site.backup` 现在提供 `backupAndRestoreCheck` 的全套实际默认 I/O：源身份及设施→单次加密导出→密文摘要/字节数固定→原 Mac 会话恢复→源/目标原完整快照比较→目标原批准迁移→schema/历史列业务核对→源摘要不变→原 journal 回执。源快照复用原受保护配置与专用连接，完整读取前后核对原 journal、配置、源身份和现场停写观察器，不接受上传摘要或抽样数据。

回执由原 host 的 `journal.bindBackupReceipt` 写入，site 不造回执。原协调器保留写入后的最后一次身份/停写核查；为支持合法回执追加，恢复会话只在 `backup_verified` 阶段使用原 journal 的专用 scope 投影：只排除 `backupReceipt` 的自有追加，全文件字节/inode/属主校验仍在，阶段、事件及其他字段不变。默认读取仍是完整记录摘要，外部改写回执也会拒绝。

原 host 在生产迁移阶段之前调用 `finishRecovery`，等待同会话最终关闭应答。失败或应答丢失保持不确定，不重新恢复/迁移或因已有回执继续生产迁移。数据/目标/密文字节漂移、目标迁移回执不符、业务变化和关闭未知均有原协调器+真实文件 journal 的串联测试；其中数据库/加密/传输是明确合成边界。

另在真实隔离 MySQL8 中验证正式源快照适配、实际 mysqldump/age/取回/恢复与原全对象摘要比较，源快照前后相同：`/tmp/holaday-source-snapshot-physical.log`退出0。这个源测试仍用同一临时实例的两个随机合成库，不能当作独立 Mac 目标或生产停写证明；独立目标、原61项迁移的实测证据见上一节。完整源站点到 Mac 目标的正式现场演练仍待完成。

恢复目标固定工具树为 `/opt/holaday-recovery`，含现有Linux Node22、`recovery-tool.mjs`、原runner的独立ESM包及原TS/contract、全部原SQL和`runtime.json`。runtime清单绑定每个文件摘要及原`buildMaintenanceMigrationManifest`摘要；仅允许固定树，目录0700、当前执行用户私密普通单链接文件，禁止软链接、`.env*`和额外依赖/文件。Mac调用前后检查Node/入口/清单摘要与实际隔离目标，再通过`env -i`固定参数执行，不接受任意命令或数据库地址。库连接固定目标内MySQL socket，原runner的DATABASE_URL也固定该socket；不接触工作区dotenv。

迁移调用在启动原runner前排他创建并同步`migration-started.json`和目录；即使迁移失败或回执丢失也保留，禁止原目标重试。子进程不因观察超时或输出量被强杀后重跑，原SQL诊断不外泄。worker只返回原快照/摘要，不能生成发布通过或backup回执；原备份协调器仍须比较源库、确认源不变并封存原journal。

`scripts/fixtures/build-recovery-runtime-qa.mjs`只为QA复用现有esbuild/Node构建无凭据副本，不是生产安装器或批准生成器。实际QA发现Docker复制保留Mac UID501，root检查正确拒绝，且只读确认未生成迁移标记；仅修正合成QA工具树属主后通过。正式准备阶段必须显式验证属主与摘要，不能据此放宽校验。旧下节“未跑全迁移”是早期夹具历史，不覆盖本轮同会话61迁移证据。

本轮Mac实测用新建禁网MySQL8合成库、独有卷和临时QA密钥，真实Docker检查/age/固定fd导入通过，并验证中文/BLOB/NULL/trigger/event及重复导入拒绝。源SSH换为执行原读取器的本机子进程，协调器回调明确合成；没有运行全迁移，没有访问生产数据库/恢复密钥，也不代表完整双机发布通过。夹具位于 `scripts/fixtures/browser-recovery-target-qa.mjs`，日志 `/tmp/holaday-recovery-target-physical.log`。

### 2026-09-27：密文运输接口及获准的真实主机探针通过

既有age适配新增 `streamAgeBackupArtifact` / `receiveAgeBackup`；既有backup模块提供 `pullFirstCutoverAgeBackup`。来源与接收端分别使用自己的已批准工具/公钥配置，绑定同一attempt、公钥摘要、密文摘要和准确字节数。默认下载固定走严格主机密钥验证的阿里云跳板→Vultr SSH，不接受额外host或私钥字段；SSH只承载经过显式字段选择的公钥配置、读取代码和密文，Mac恢复私钥不上传。

源文件在传输前后复核，接收端使用0700目录/0600排他partial，核对完整文件并等待远端进程退出成功后才发布密文。短传输、超长、摘要变化或EOF后的进程失败均保留partial，不能进入解密；不自动重试或覆盖。解密继续沿用完整age认证后才提供verified SQL的规则。该接口不创建恢复回执、不证明生产停写、不自动选择/批准数据库目标。

新增12项传输/通道用例先RED后GREEN，Mac与无网络Linux实际age/文件/子进程相关54/54通过；网络层在自动化测试中替换为本地真实Node子进程，执行的读取载荷不变，不能声称真实SSH已经验证。合成MySQL恢复测试已改为源/恢复独立目录和独立公钥文件，私钥仅在恢复目录，通过真实密文读取子进程接收后再解密、导入及执行全部61SQL，2/2通过。

首次权限审核拒绝创建真实探针QA脚本，要求明确授权生产文件系统新增目录/加密文件。未绕过；随后用户针对该具体请求回复“允许和授权所有需要的操作”，获准后才创建脚本并执行。UTC `2026-09-27T08:46:23.446Z` 实测通过：原服务器公钥加密固定无业务文本→正式固定SSH下载→Mac原有私钥解密→逐字一致。不是用本地子进程替代网络的测试，也不是生产数据库备份。

探针attempt `a6f4b92c-3cf6-4619-b862-d53c21119869`；密文276字节，SHA256 `50289a795d58189d9e043181b316d28b260b1e6498ab4826c1a749ac7fba2240`；实际读取代码摘要 `d96a979598b8fe7b85b2022a090082282ccf40974d6795fd9bfbcb667ddae3dd`。服务器仅新增 `/var/lib/holaday-deploy/recovery-20260927/transfer-probe-a6f4b92c-3cf6-4619-b862-d53c21119869` 的私密目录与该密文；Mac证据在 `/private/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/holaday-transfer-live-kI3tWB`，保留intent/source/result及探针文件。没有上传私钥、重新生成密钥、读取生产数据库、改订单/权益、启停服务或发布代码。

具体探针授权已满足，不再重复索取同一许可。完整site I/O、受保护生产备份计划、首次shell和整流程Linux演练仍未完成，探针不产生backup_verified回执。微信站点工具策略禁止访问仍然有效，不因广泛授权而绕过。

- 2026-09-27后续：新增实际age文件I/O并接入合成MySQL的原编排，已验证真实流式导出、完整认证后导入及全部SQL。对应`scripts/browser-backup-age.mjs`，配置要求独立固定工具摘要/公钥摘要；`encryptionProfileDigest`标识age格式与公钥，而各主机工具二进制各自核验，允许已验证Mac/Linux版本互通。生产必须从受保护配置读取这些值，不能现算摘要后自称获批。
- 导出回调必须等待源进程退出，不能以stdout EOF代替mysqldump成功；失败不产生最终文件。解密失败可能留下已解密前缀的私密`.partial`，它**不是可导入备份**；仅完整认证及复核成功才返回`.verified.sql`。使用文件描述符传递私钥，不输出密钥或子进程原始诊断；只终止本函数创建的age辅助进程，不停止数据库/服务。该文件适配本身不证明生产停写、离线保管或数据库隔离。
- 当前`backupAndRestoreCheck`尚无完整生产host I/O；工具/公钥安装没有自动启用数据库导出、定时备份、停写或迁移。
- 真正导出只在既定停写/身份/窗口证明满足后进行。使用公钥加密的流只落受保护密文文件；生产私钥不存在，不在主站执行解密恢复。
- 密文取回Mac，在明确绑定且无生产挂载/凭据/外部出站的独立MySQL实例内恢复、核对全对象/数据并执行批准SQL。隔离目标、恢复输入及失败留存须先接入现有编排，不能把明文管道直接接向生产mysql。
- 独立介质私钥副本已按上节验证；真实停写备份、完整恢复比较、迁移验证和回执绑定仍未完成。不得用密钥探针写`backup_verified`成功回执、停止线上服务或开放候选。

Task4/5/6仍未完成；继续使用既有计划及BASE，不重新生成恢复密钥或重做已通过的合成MySQL演练。
