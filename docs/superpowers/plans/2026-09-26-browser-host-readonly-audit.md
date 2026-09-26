# 首次切换：真实主机只读核查与有限修正清单

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
