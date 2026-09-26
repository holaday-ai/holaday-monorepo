# 首次切换：真实主机只读核查与有限修正清单

## 2026-09-27：支付网络规则仅检查，不应用

候选新增固定4010/4011非loopback隔离策略，并接入本地维护流程（见checkpoint最新节）。本次现场只调用阿里云`nft --version`、前后两次只读规则摘要及`nft --check -f -`，使用严格SSH主机指纹、不转发agent。nft1.0.2接受策略；前后摘要同为`ba9a5a8d6eac1a04c281dd60469d784f95dcf783f525b9e4be8dea6043c9e39e`，没有写规则或关端口。记录`/tmp/holaday-payment-ingress-host-check.log`。

这证明当前工具/内核接受规则，不证明线上端口已隔离；上一次公网可达发现并未被本地代码改变。规则不自动开机恢复，生产入口及重启持久化仍待整项落实。未重新查询业务数据库或支付方、未停4011或现用网关。

## 2026-09-27 00:09–00:12 JST：支付端口公网旁路已实证

限定只读SSH、现有日志聚合与本机TCP探测，未修改线上配置、进程、防火墙或数据库，未调用支付方。

- 4010仍为PID1098048，当前604ddf17e84a发布，由PM2 id1启动；4011仍为965039→965055旧独立树，root、PPID1、083a6232aca7发布。采样前后start/cwd稳定。后者属于`session-31639.scope`，systemd状态为active/abandoned，不在当前PM2清单中。
- 4011的标准输出仍持有已经删除的`/tmp/holaday-cn-payment-candidate-health.log`。只读该已打开普通文件的55,295字节并输出聚合：95条JSON记录，2条healthz、88条其他URL记录；没有上述规范支付创建/回调路径记录。**这是现有日志样本，不是完整业务审计；不能证明从未处理支付或已经排空。** 文件名和会话形态支持“候选健康检查残留”的推断，但未找到原启动命令。
- 4011实际入口源码SHA256为`db77b882e5ac27b13aaf722e669d36042764fae8362c27f41f86eed3bb6953eade836`，与本地Git对象083a6232aca7中的入口完全相同，包含真实支付/短信/内部确认路径。其磁盘配置PORT=4010而实际监听4011，说明不能仅从磁盘配置推断运行端口；本轮未读取输出原始环境值。回调域名仍为hd-pay，内部桥接为holaday.ai。
- 当前启动脚本、PM2主备保存文件、所检查systemd顶层单元、cron及极短root历史中未发现4011引用。该有限搜索不是所有启动来源均已证明不存在。PM2现用支付及无关orangebench注册保持原状。
- IPv4/IPv6 iptables-save、nft ruleset均成功返回空规则，UFW inactive。**Mac对47.99.169.186:4010及:4011的两次TCP连接均成功。** 这证明采样时从本机网络存在公网直达路径；不是云安全组的完整审计，也不表示任意来源都可达。与实际通配监听相结合，原nginx维护屏障并不覆盖这两个直接入口。

本批修复仅作用于候选：cn-payment显式监听127.0.0.1，匹配已核对的同机nginx upstream和发布脚本健康检查；无通配监听配置开关。原始入口和旧进程不受本地改动影响。首次切换仍须先隔离旧实例的直接网络入口，保留按阶段允许的域名回调通道，再按精确清单退休旧进程；不能用新候选回环监听替代旧进程隔离证据，也不能凭这次调查自动停4011。

私密忽略归档：`qa/payment-lineage-20260927/`，目录0700、文件0600，含只读诊断脚本和脱敏结果，不含原始环境/日志/历史文本。完整主机分类、实际端口隔离、双主机host接线与恢复演练仍未完成。

## 2026-09-26 22:22–22:28 JST 支付来源核对（最新）

双主机只读SSH成功，未停服务、修改配置/数据库或调用支付方API。详细计数与限制见[支付证据](2026-09-25-browser-first-cutover-payment-evidence.md)。关键更新：PayPal待核对记录属于sandbox，但当前配置为live；国内旧记录未保存环境/商户身份，支付宝当前及旧网关配置均缺seller ID。不得直接把当前配置用于全部历史订单。

4011仍监听，PID965055，旧release；Node通过 `--env-file` 读取已配置的支付/桥接参数。内核初始环境未见变量不等于有效运行环境为空。4010 PID1098048、4001 PID733273仍与前次身份一致；本轮检查了采样前后start/cwd稳定性。尚未核清4011的完整入口责任，不能自动停用。指定dotenv源的存在性不证明完整启动来源已分类。

元数据与只读事务结果保存在本计划忽略QA的 `payment-binding-audit-20260926/`；无商户ID/订单号/密钥输出。本轮只增加诊断和记录，不重复宣称历史测试为新通过，也未完成实际host/provider组装或部署。

## 2026-09-26 17:12–17:21 JST 恢复核查（历史）

本节优先于下方09:48历史快照。用户已授权当前大项的实施、PR、必要合并、部署和验证；不能据此跳过真实放行检查或自动清理历史业务记录。

### 连接与完整入口资料

- 本机到两台主机的22端口TCP探测成功，直连Vultr SSH在banner交换阶段超时；阿里云直接SSH成功。从阿里云读取Vultr的公开SSH banner立即成功，随后使用已有凭据、严格双主机指纹校验、禁止agent转发的SSH中转执行Vultr `true`成功。未修改VPN、防火墙、sshd或任何服务器配置。该结果证明替代读取路径可用，不确定直连故障的具体网络根因。
- 中转第一次尝试、阿里云路径元数据第一次采样均因本机自动审批超时而未执行；各按工具允许重试一次后成功。不能把审批超时当服务器拒绝。
- 取得两台主机完整 `nginx -T` 和原始站点文件。三个HOLADAY站点原文件摘要与本文件第2节一致；阿里云两个正确站点名均含 `.orangebench.tech`，缩写路径不存在，不应继续猜路径。
- 新增只读 `readCutoverNginxSnapshot` 已接入现有主机采集器：读取两次nginx测试输出、逐文件规范路径/属主/权限/原始字节摘要，并复核源文件与软链接目标未变。不会把UID501发布文件当成root可覆写文件，也不允许人工上传报告替代采集。原文只用于私密证据。
- 实际采集器在Vultr取得17个源文件（20,992字节），阿里云12个（19,337字节）；后者仍有一个UID501的hd-app发布文件。隔离Linux Node22.20/root下真实nginx采集也通过。`nginx -T`证明磁盘配置可解析，**不证明当前worker已加载该版本**；实际fence/reload/探针接线仍需完成。
- 4010/4011仍由Node PID1098048/965055监听，仍未取得4011公网/内部旁路职责的完整证明；不自动停止。

### 数据库只读事务事实

采样08:15:16 UTC：

| 范围 | 新鲜结果 | 不能据此推断 |
| --- | --- | --- |
| 未解决任务 | 1条 `running`，`origin=explorer`；创建/更新时间均为2026-06-24 16:29:22.664 UTC；无session/plan、无普通task_events/task_steps | 不是零工作，不能直接改为完成/失败或删除 |
| Explorer关联轨迹 | 3次navigate、11次click；22次LLM调用；最后动作16:31:14.695、最后调用16:31:21.028 UTC | 无普通步骤不等于未发生浏览器执行；历史点击外部结果尚未核清 |
| 待核对支付 | PayPal 1、微信3、支付宝9，均有provider_order_id；partner支付为空 | pending不是已付款或确定未付款；仍需支付方只读核对 |
| 生产者计划 | 2条active scheduled_tasks，当前due=0；最早next_run=2026-09-27 01:07:07.626 UTC；planned_task_runs与batch_tasks为空 | 当前未到期不等于可以忽略未来派发 |
| 注销请求 | 1条cancelled | 不代表注销worker的启动来源已停用 |

首次步骤统计误用了不存在的 `task_steps.updated_at`，返回ER_BAD_FIELD_ERROR；检查既有schema后改为created_at/started_at/completed_at，再执行完整只读事务通过。没有修改schema或业务数据。后续沿真正Explorer路径补查 `task_action_captures` / `llm_calls`，保留错误和修正证据，不能把第一次部分查询成功说成全部通过。

候选现有 `apps/orchestrator/scripts/explore-sites.ts` 会创建origin=explorer/running行，再best-effort更新终态；源码还记载了历史CLI异常退出遗留running的情况。这与现场形态相符，但尚未将确切旧版本、退出日志及外部结果关联到该行，故仅为调查方向，不是终态修复依据；本轮未改Explorer代码或历史记录。

### 私密证据索引

原文保存在本机0600文件，且已原样复制至本计划 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/host-audit-resume-20260926/` 私密归档目录（0700，五份文件均0600）。不提交到Git，不输出凭据、任务正文、用户ID或订单号：

| 文件 | SHA256 |
| --- | --- |
| `/tmp/holaday-vultr-nginx-collector.json` | `a9675919f7b289ffac9003e0019316a3250a356e02cffa69644a061a72ad30c8` |
| `/tmp/holaday-aliyun-nginx-collector.json` | `e905bc9d600f38924d91b055156202945d0abedeb19420108b652d9a5cf2c8be` |

业务聚合原始证据：`/tmp/holaday-live-work-via-jump.json`（含最初字段错误）、`/tmp/holaday-live-work-via-jump-final.json`（修正）、`/tmp/holaday-live-work-explorer-followup.json`（真实轨迹补查）；私密归档保留同名副本。缺失时重新只读采集，不可仅从本文生成ready报告。部署前必须重新采集，不能复用本次时间戳。

新鲜回归：采集器40/40；浏览器发布脚本288/288（包含正常部署shell的6项）；完整test:ops退出0（120/50/16/65及shell）；两个触碰MJS的Biome与diff-check通过。Linux Node22.20全套初次39/40，既有publisher fixture使用process.getgid()导致root组0被正确拒绝；改为以UID/GID998运行原测试后40/40，不修改产品条件或断言。真实root nginx采集另行实测通过。对应日志 `/tmp/holaday-nginx-observation-{targeted-final,browser-final,ops-final,linux,linux-suite,linux-suite-final}.log`；本轮未重跑orchestrator/cn-payment完整应用测试，不复用旧结果冒称新验证。

本节收口的是连接恢复、完整配置采集和业务事实核查。Task4完整host/nginx隔离/多主机DB/provider/readiness/shell接线，Task5恢复演练与外部支付证据，Task6整流程/独立审查均未完成。未push/PR/merge/deploy，未停服务、修改线上配置/DB、支付结算/权益/额度、UI、模型路由或扩展。

## 09:48–09:51 JST 历史快照

核查：2026-09-26 09:48–09:51，Asia/Tokyo。用户在明确只读范围后回复“继续”。分支 `codex/browser-release-candidate-20260925`，HEAD `844c2ced779fa360b62e2bfbdd87d4909d13b8a0`，Task 4 本地改动尚未提交。

结论：现场资料已补充，但现有首次切换适配器不能直接用于这两台主机。此前 243 项脚本与 Linux 组件通过证明的是已覆盖的行为，不证明实际部署形态已全部适配。下列四项是既有切换路径的适配差异，不新增浏览器、支付或 UI 功能。

## 1. 已核实的现场事实

| 范围 | 现场事实 | 对切换的影响 |
| --- | --- | --- |
| Vultr 主应用 | PID 733273，UID998，`/opt/node22/bin/node`，监听 4001/4002，旧 cwd；PM2 id271，autorestart=true | 可继续使用精确旧应用身份；仍需实际工作核查 |
| Vultr 注销 worker | PID67648，UID998，PM2 id272，kill_timeout=660000ms，memory restart=536870912，autorestart=true | 当前 first-runtime 的 600000ms 上限及 memoryRestart=0 条件不适配；不能填零或伪造为停用 |
| PM2 管理器 | 两台实际管理器均为 `/usr/bin/node`；Vultr PM2 6.0.14 | 当前要求管理器 exe=`/opt/node22/bin/node` 的假设错误；应用身份和管理器身份必须分开 |
| 阿里云现用支付网关 | PM2 id1 根 PID1097924 → dash1098031 → tsx1098032 → Node1098048 → esbuild1098060；五个进程 UID0，Node 为 `/usr/bin/node`，监听4010 | 不是 UID998 单 Node 进程树，不能用现有 main/worker 假身份套用 |
| 阿里云旧网关 | 965039→965055，UID0，`/usr/bin/node`，旧 release，父根 PPID1，仍监听 `*:4011`；不在本次 PM2 应用清单中 | 属独立旧树；不能因未见当前请求就自动判为废弃或停止 |
| 支付入口 | `hd-pay.orangebench.tech` 的 HTTPS `location /` → `127.0.0.1:4010` | 当前有效 nginx 配置没有4011字面引用；不等于证明公网直连被阻止、业务已废弃或可以停用 |
| 文件清理计划 | `holaday-files-cron` 当前 stopped/PID0，仍有 `0 * * * *`；相同条目存在 PM2 保存文件 | 当时没有活 PID 不等于取消未来派发，必须纳入生产者范围 |
| 文件清理实际代码 | 线上文件与候选 `src/files/cleanup-cron.ts` SHA256 都为 `5fe36b8971563f9e8c3aa384fca9d8ff259af5fc5cc66af3a375c36e4eab59fc`，调用 storage.delete 和 taskFiles UPDATE | 是会写文件/数据库的任务，不可仅凭外层启动脚本未出现 DELETE 字样忽略 |
| 其他 Holaday 进程 | Vultr headed-browser 子树16个进程，VNC子树4个进程，另有 akshare Python服务 | 需要区分业务写入/外部执行依赖与保留服务；不能全局停止 PM2 或直接排除不认识的对象 |
| 启动持久化 | Vultr pm2-root active+enabled；阿里云 pm2-root inactive+enabled，但独立 daemon 仍活着且有保存条目 | 不能只检查 systemd active 就推断有无管理器或重启来源 |

两次 ss 采样在目标端口仅见 LISTEN；这不是持续排空、外部工作结束或未来不派发的证明。本次不查询业务数据库，不核对历史订单，不读取浏览器页面或登录资料。

PM2 6.0.14 的本机安装源码默认停止值为 1600ms / SIGINT，但允许环境覆盖；本次没有将源码默认值冒充 daemon 最终有效配置。

## 2. 实际入口与当前解析能力的差异

- Vultr `/etc/nginx/sites-enabled/holaday` → `/etc/nginx/sites-available/holaday`，UID0/0644。文件 SHA256：`c2372d3ed03847c794e3e49501ee5890a12e9c2c876b95dfadeeee585340897f`。
- 阿里云 `hd-pay.orangebench.tech` → `/etc/nginx/sites-available/hd-pay.orangebench.tech`，UID0/0644。SHA256：`ffe595e8fc106be4fc4148bc054e348dcc05d59c773efe30e7b090bdad590261`。
- 阿里云 `hd-app.orangebench.tech` → `/opt/holaday-edge/releases/20260905035410-30748/ops/aliyun-edge/nginx-hd-app.conf`，实际文件 UID501/0644。SHA256：`65973c9afc53c484ce7e2becbe013de3622adeb6d77723a29cefd1ef6dfcec4c`。不能当作 `/etc/nginx` 内 root 私有可覆写原文件。
- 现有配置含多 listen、多 server_name、TLS include、静态 try_files、正则资源 location；Vultr 还存在直接到6080的 `/vnc/`。现有窄 nginx fence parser 会拒绝这些形态，这是未适配，不应简单删除其拒绝检查。
- 大陆入口 `/api/`、screencast、VNC WS、`/ws` 转发到 Vultr；只改其中一个入口不能证明全部业务写入已隔离。

此处文件摘要来自原文件字节。`nginx -T` 输出分段带额外换行，其分段摘要仅用于输出一致性，不等于原文件摘要。

## 3. 固定修正清单（部分本地实现，不是生产授权）

后续本地进展：第1项的管理器/网关完整身份、首次helper和660000ms显式超时适配已实现，含整批停止预算校验。254项脚本回归、Python7+4及Linux组件实测通过；详细边界见checkpoint。第2项启动来源、第3项实际nginx和第4项接线整体验证仍未完成。当前仍拒绝 memoryRestart 非零和 cron 存在的对象，不把真实配置归零。

1. **实际身份适配**：首次路径区分 main/worker、管理器、网关完整树；精确绑定观测的 UID/exe/cwd/启动时间和批准对象。不能全局允许 root/任意exe，也不能改普通升级或候选 UID998 规则。核清默认/显式停止超时与重启来源。
2. **完整生产者处理**：把无当前 PID 但有未来调度的 files-cron 纳入；注销 worker 的 memory restart 与长超时按真实配置处理。其他浏览器/VNC/akshare服务需明确保持或纳入，不能“未知即无关”。
3. **真实入口隔离**：以两个站点和支付入口的实际拓扑设计最小配置变更与回退；保留静态资源/TLS/现有路径，不用任意 nginx 文本重写。单独覆盖旁路端口、现有 WS 与内部转发；4011 无 nginx 路由不能替代防火墙/安全组证明。
4. **接线后整体验证**：将这些现场形态转成脱敏 fixture，实际 host/journal/evidence/readiness 接通后，再做隔离 Linux/MySQL 全流程与整分支审查。现有成功数字不作为该步骤已完成的依据。

部署时仍需重新采样并逐一批准实际操作对象、配置摘要、窗口及恢复方式。本次不扩大为支付重构、浏览器重写或全局服务整改。

## 4. 证据与边界

### 后续本地启动来源核验（不是生产变更）

在一次性、无网络、私有PID容器内，以本次新建 `/tmp/holaday-pm2-startup-*` 专用PM2_HOME运行PM2 6.0.14。日志 `/tmp/holaday-task4-pm2-startup-characterization.log`，脚本在本计划QA目录 `pm2-startup-characterization.mjs`，退出0：

1. `stop <id> --watch` 后，带加速cron的测试进程确实再次启动，无关测试进程PID不变。
2. `delete <id>` 后跨过两个cron时点未再出现目标，其他进程不受该操作影响；但主保存文件和备份保存文件仍有该目标。
3. 仅该专用测试daemon的恢复会从未改主文件重新启动目标；故意破坏测试主文件时，备用文件也能单独恢复目标。
4. 在测试主备文件中移除该目标后，再恢复只启动保留的无关测试应用。此处是原理验证，不是具有生产文件保护、独立主备比较和journal绑定的实际适配器。
5. 对真实Worker.js控制定时器/异步采样边界：旧内存采样能对仍登记为stopped的对象调用reload；从其内部注册表移除后则不再调用。该项是依赖行为测试，不冒充真实生产内存竞态重现。

这解释了为何不能把 memoryRestart 填零、把 PID0 当永久停用，也不能用一次 `pm2 save` 当作精确清理证明。核验当时尚未写入生产路径；后续用户已批准本地实现，主备文件处理和真实journal已完成隔离验证，现场运行注册删除与全host组合仍未实现。

**已获准本地实现的最小策略：** 仅首次切换，在入口/未结工作/精确对象核验通过并完成私密备份后，按批准唯一PM2 id移除旧对象运行注册；同时精确移除主备启动文件中已批准、摘要绑定的旧对象条目。每个文件单独核对原始摘要与保留条目，不能把一份文件整体覆盖另一份；无关应用、daemon、systemd保持不动，不运行全局delete/kill/save。每个副作用前记录intent，不确定结果不自动重试/回启旧版。完整树、存活监听及各启动来源再次复核后才能迁移。

这是从“停止”扩展到“移除旧注册及定向修改自启动记录”的操作策略，用户已回复“允许”确认本地实现和隔离测试，不再重复请求；不授权修改线上服务。部署时仍逐项批准实际对象、文件摘要、维护窗口和恢复责任。现场删除入口未接完前，首次runtime对cron/memory非零的阻断保持不变。

脱敏原始结果保存在本计划忽略目录 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/host-audit-20260926/`：

| 文件 | SHA256 |
| --- | --- |
| vultr.json | `0deec7f0ae1b9f259227dc4fc1bc5ee69f080df16e170d7f5aa97ed8daf687dc` |
| aliyun.json | `dfd5b2a8301572010ad94a5d3cb3a8dff266d241a817b04c754132b03aa3f0d0` |
| vultr-followup.json | `0dfffbf21757a825eaec5e1f06b0146511c3da518479f53074c7313c5a74b143` |
| aliyun-followup.json | `da2410abb92b00ef217de6887046a727b6ba673bc3c042a78a1a918fdad74280` |
| vultr-metadata.json | `465cc17e959aac9f700f48ee670fd239407190f7786f914abac1bf35665a15d9` |

五次 SSH 均完成，严格验证已知主机指纹，使用已有凭据且未输出凭据；只读取 `/proc`、ss、PM2 jlist/保存元数据、systemd元数据、nginx -T 和指定脚本/代码摘要。未上传或执行部署程序、reload/stop/restart 服务、修改线上配置、连接业务数据库、创建/查询/扣款/退款支付、改变额度、UI、模型路由或扩展。只读诊断可能产生正常 SSH/服务日志，不宣称服务器字节级无变化。

本轮没有修改产品或停止实现，也没有重跑上轮已通过测试；243项通过属于上一轮记录。Task 4 仍未完成，未提交/push/merge/deploy。
