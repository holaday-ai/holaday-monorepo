# 浏览器首次切换验收记录

## 当前结论：未完成，不能执行生产切换

## 2026-09-30：失败边界诊断通过，完整链单次通过但间歇根因未证实

原退休观察器新增固定元数据stderr诊断，不输出异常/凭据/业务原文，不修改放行条件或增加重试。四项反例RED退出1→GREEN4/4退出0；ops120/60/16/951+Python12、实际Linux inventory163/163均退出0且零跳过。完整原合成链7295退出0：启用worker、源90/目标90、原备份恢复/迁移/启动/核对、一开零关、无重放、锁释放；原缓存候选与本轮协调器组合，不是最终候选或生产支付恢复。精确QA数据库及卷已自动核对后清理，原MySQL/Redis健康，日志保留。成功时未保留完整stderr，因此不声称消除了所有瞬时拒绝；不再盲跑相同完整链。

最终42文件browser串行回归73362退出0：1120/1120，零失败/取消/跳过；日志`/private/tmp/holaday-observer-diagnostic-browser.log`。首次自动审核超时未执行，唯一重试才产生此结果。所有本轮作业结束。详细范围、日志及下一步见checkpoint最新段。云端精确恢复、独立现场facts、真实停写与非PayPal恢复、完整故障矩阵/整分支审查仍未齐备，CLI关闭，未push/PR/合并/部署。

## 2026-09-30：真实Brave恢复假设被否定，未交付生产恢复器

使用官方1.89.141/Chromium147.0.7727.102的arm64包、原无网络QA镜像和全新合成profile，不接触真实浏览器资料。同一旧会话在about:blank启动时恢复page target但未增加HTTP请求；silent启动初始空，创建新target后恢复旧target（43533退出1）；app窗口启动page数异常（77511退出1）。Brave默认冷启动清理会话cookie已通过磁盘元数据、启动边界及官方特性开关对照定位。QA全局RestoreOnStartup:5不恢复旧target但清理会话cookie（85040退出1）；原探索的“双cookie保留且无旧target”组合没有通过，不称作安全恢复实现。会话cookie保留不是追加发布门槛，原批准已接受云端会话中断；全机策略不符合精确服务范围，未在生产安装。

新增`browser-cloud-recovery-probe-linux.mjs`保留这些反例的可执行复现，不放宽失败断言，不纳入绿色ops计数，也不能证明任意service worker/后台重放安全。公开包摘要、所有早期依赖/正对照失败、清理及下一步见checkpoint最新段。未修改产品代码，未重跑整仓历史回归来制造新通过数；权限已解除，剩余为技术验收，不是再次索要固定源码审阅授权。生产未切换。

## 2026-09-30：获准源审阅、VNC停止夹具校准完成

用户“允许 都允许 别再问了”已解除两个固定启动脚本的正文审阅权限阻塞。只读54248/97948/7909退出0，源码副作用/display归属/实际包版本见checkpoint；这不是生产停止或恢复。生产Brave1.89.141，ps/pkill3.3.17；原headed脚本的profile会话删除、共享openbox改写及名称级kill仍不能直接用于安全恢复。

原PM2 6.0.14+合成VNC控制流新物理夹具，缺ps/pkill的11809/6981/39588退出1均列为无效环境结果，不证明生产缺陷。补真实Debian procps4.0.4后41741、格式化后32503退出0：两服务及fork后代全部退出、无回生、单次数字ID stop、无关进程/profile哨兵保持；缺依赖的前置拒绝另已断言通过。仅修改QA夹具，未引入新监督器或冻结生产进程。日志和离线依赖摘要/复现方式在checkpoint；只支持此合成结构，不是部署验收。64438原ops Node120/60/16/947+Python12零跳过退出0，新夹具不在该ops计数内。

下一步安全恢复必须验证不删除profile、不按名称杀共享程序及不自动恢复旧效果；原独立facts、现场执行、真实备份/Mac恢复、非PayPal恢复、完整最终验收与审查未完成。CLI关闭，生产未变更，权限不再是本轮阻塞。所有本轮测试已结束。

## 2026-09-29 14:39 UTC：已批准云端范围的只读恢复审计

68245/63646/43180/36581/84432五次逐步缩小问题的只读观察均退出0，无服务/数据改动。两项服务PM2自动重启开启、进程树16/4、同display :98；两份启动dump与live均只差pm_id。原headed脚本确认含会话目录删除与两条pkill，恢复安全性未通过；没有执行这些命令或读取profile内容。证据`/private/tmp/holaday-cloud-maintenance-fixed-targets-20260929.json`及同前缀分步JSON，详见checkpoint。后续正文审阅在本地补丁阶段被安全审核拒绝，未执行远端读取、未落盘脚本正文；需特定只读授权，不绕过。仅改原设计/清单/证据文档和忽略ledger，未改产品源码，故不重跑历史组件测试或冒用其通过数。范围批准已生效，但隔离、恢复、最终QA与生产切换仍未完成。

## 2026-09-29 14:27 UTC：一次完整首抛诊断通过，非最终验收

87744现有known-effect反例退出0，临时进程内Inspector校准能捕获底层evidence→runtime→site抛出位置；仅公开位置/固定代码，无端口、局部变量或载荷输出。99193全新完整隔离诊断退出0，source90/target90，真实worker轮询、单次open、无close/重放、两份启动文件和锁释放通过；无跳过。日志`/private/tmp/holaday-first-throw-calibration-20260929.log`与`/private/tmp/holaday-full-first-throw-20260929.log`。

不代表5532等间歇问题已修复或生产可部署。追踪影响调度，且成功路径父夹具没有落盘完整stderr，不能声称无可恢复异常。所有临时QA追踪/环境传递已撤掉，源码与64855c36一致；本轮仅保存诊断记录。驱动按精确标签清理本轮两个合成数据库容器/卷，所有作业结束，原服务、缓存和草稿不动。原恢复会话静态检查未支持并发重入假设，未据此添加重试或放宽门槛。

生产云端浏览器/VNC原保留范围仍需明确决定，独立facts及其后原真实恢复/支付恢复/整分支审查尚未完成。CLI仍关闭，无push/PR/merge/deploy。不要再以重复完整合成QA代替该范围决定及生产事实。

## 2026-09-29 14:08 UTC：失败边界最小组合验收，不是根因修复

仅原物理registration夹具新增`--execution-site-fence-repeat`，产品源文件不变。41106：20次原site+真实nginx/TLS+observer停止边界，退出0；30907：20次原`backup.inspectBackupFacility`（真实受保护文件/公开age检查、前后停止证明），退出0；随后合成已知未决工作使原site拒绝，事实移除仍锁存失败，journal未变、没有backupReceipt；89740：原`--execution-site-interruption`回归退出0。均零跳过，日志分别`/private/tmp/holaday-site-fence-composition3-20260929.log`、`/private/tmp/holaday-site-facility-composition-20260929.log`、`/private/tmp/holaday-site-original-interruption-20260929.log`。最后仅QA说明文本修正，Biome/node语法/diff-check通过；未重跑未修改的历史全套组件来充当新证据。

31106的回调模拟200/401不符、64654的观察器PID1拒绝均退出1，修正夹具接线和容器父进程后通过，不是原间歇拒绝的根因。诊断只有合成业务事实/双机拓扑/收件人语法；没有数据库、源备份、恢复、迁移、新候选、真实商户或生产停写证明。固定原QA镜像、私有PID/无网络、768MiB/1CPU、只读公开挂载、退出自动移除，全部测试已结束；原服务和缓存未改。

原5532等完整链失败仍未定位，不能宣称稳定发布。下一步只追踪完整链额外恢复会话/负载/阶段变化下的首次底层拒绝，以及原生产事实和发布门槛；不再重复本轮已完成最小组合。生产云端浏览器/VNC范围问题未获特定确认，CLI execute仍关闭，无push/PR/merge/deploy。完整命令、失败记录及恢复入口见同日checkpoint。

## 2026-09-29 13:48 UTC：完整隔离连续两轮通过，拒绝根因仍未关闭

- 5532退出1，源2/目标2：隔离恢复和比较后，备份设施再核验被site.run统一包装拒绝；未迁移/启动候选。`/private/tmp/holaday-site-attach-reject-20260929.log`及私密wuUXoZ/coordinator-diagnostic.log。包装层不是底层根因，不能称已定位修复。
- 4158、7127均退出0，源90/目标90：原完整恢复/迁移/新boot/两次preopen/单次open/nginx恢复/真实启用worker轮询/同进程核对/双启动文件/锁释放通过，close0、不重放。日志`/private/tmp/holaday-site-operation-cause-20260929.log`和`/private/tmp/holaday-cutover-underlying-rejection-20260929.log`。两个attempt全新、串行，均带临时诊断，不覆盖历史失败，不等于最终无诊断候选或生产支付恢复。
- 精简原nginx物理夹具56223退出0；移除全部产品临时诊断后60775退出0、零跳过：100次回执和新增20次连续原入口核验，原37条TLS拒绝、双栈/WS/恢复/无关长连接保持通过。最终`/private/tmp/holaday-repeat-fence-clean-20260929.log`。该精简路径未复现完整组合链拒绝。
- 唯一保留的实现差异是原QA夹具五行连续核验；Biome、node语法、diff-check退出0。全部产品源码及临时gateway stderr更改已恢复至本轮HEAD；不声称新的产品bug修复，也未重跑旧组件套件。

本轮各专属容器/合成卷已核实后清理，日志及恢复工件保留；所有测试结束。后续先收窄原site/入口/observer组合的最小复现，不再无新信息重复完整备份链。生产范围问题已单独列出、未获新选择；CLI、真实现场facts/恢复/非PayPal证据及整分支审查门槛均未解除，未push/PR/合并/部署。

## 2026-09-29 12:29 heartbeat：完整启用 worker 曾通过，稳定性仍未验收

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 原完整链，启用真实worker | 95243退出0，源90/目标90；恢复/迁移/newboot/preopen/open/入口恢复/真实worker poll/同进程reconcile/两份启动文件/锁释放均通过；带临时错误栈诊断 | `/private/tmp/holaday-ingress-full-reject-trace.log` |
| 移除产品临时诊断后的完整复验 | 34270退出1，源2/目标0；preflight拒绝、无停止/迁移/启动事件，后续缺报告ENOENT是次生错误 | `/private/tmp/holaday-enabled-worker-clean-final.log`；dd6sAD私密诊断 |
| 本轮首次备份边界复现 | 48985退出1，源2/目标0；入口会话先失败，导出期间retirement观察被拒绝 | `/private/tmp/holaday-observer-boundary-20260929.log`；irgezh私密诊断 |
| 原nginx夹具100次同会话回执 | 64924及41739最终无产品诊断复验均退出0零跳过；100次回执、37条TLS拒绝、双栈/WS/入口恢复与无关连接保持通过 | `/private/tmp/holaday-ingress-receipts-policy-mounted.log`、`/private/tmp/holaday-ingress-receipts-clean-final.log` |

上述一次完整通过不能覆盖前后失败；间歇性拒绝根因未确认，不宣称修复或稳定成功。精简命令最初缺`/ops`只读策略挂载的三次失败另行记录，不计产品回归；正确挂载后通过。产品三个临时诊断文件已恢复，交付仅两个QA夹具及证据文档，不重跑或冒用历史组件数作为新验收。两QA文件格式/语法/diff-check最终退出0（初次两处格式错误已修正）。精确QA容器和合成卷均清理，保留日志、恢复工件和原DB/Redis。生产维护范围、独立facts/执行入口、真实生产恢复、非PayPal恢复与最终整分支审查仍未完成；未上线。

## 2026-09-29 启用 worker 启动过渡（局部修复通过，完整链失败）

最终结果覆盖下方运行中记录：三种专用Linux物理场景通过，Linux183/183；15075退出0，browser1116/1116、ops120/60/16/947及Python12，均零失败/跳过。五MJS格式检查及diff-check退出0。日志`/private/tmp/holaday-worker-start-{physical-final,linux-final,browser-noskip,ops-noskip}.log`。86597先前因未传既有age路径，browser及ops末组各34跳过，已保留日志并用既有age补跑，不计为全通过。所有测试结束，QA专属容器/合成卷精确清理，私密日志和恢复工件保留。已确认修复的是worker shell→Node启动过渡及60秒预算越界；20817完整链仍因备份观察失败而未通过，尚未验证完整启用worker应用链，不准上线。定向自审不是最终独立整分支审查，未push/PR/合并/部署。

原Task6完整成功路径新增启用worker分支。新增QA配置前置错误修正后，完整链曾走到真实open/入口恢复但worker恢复失败；另两轮在更早备份/会话阶段失败，均保留且未宣称根因已关闭。详细轮次、日志和资源清理见checkpoint最新段。

原专用Linux夹具增加shell预检延迟，真实PM2已online而PID仍为bash时，原恢复函数错误地立即终止。物理反例89596退出1、单元反例退出1，修复后物理53071和单元检查退出0。仅启动一次后的只读就绪观察允许在原有期限内继续采集；不重复启动、不弱化最终身份/配置/所有权/启动文件证明。物理夹具的候选协议和业务负载是合成的，不是完整应用或生产恢复。完整应用链20817及最终串行回归尚未收尾，不计整项通过。

20817已退出1：source2/target90，隔离目标恢复/比较/迁移完成，但后续备份设施检查的retirement observer.read拒绝，尚未运行worker。日志`/private/tmp/holaday-enabled-worker-fixed-chain.log`及brKbyW私密诊断；原891e22cf资源已精确清理。该观察问题仍未查明，不归为worker修复成功。QA诊断只修参数遮蔽并覆盖实际失败的read入口。另补60秒预算读取越界反例RED→GREEN，保留错误boot/closed/main/config等拒绝与一次启动断言。最终串行回归86597待终态；不复用历史通过数作为本次结果。

## 2026-09-29 原完整隔离闭环：真实开放后丢回执

在等待上一轮浏览器维护范围决定期间，继续原 Task6 故障矩阵，不重复现场观察。仅扩展原两份QA夹具：`CUTOVER_QA_LOST_OPEN_ACK=1`只允许完整success模式；在原host的真实open控制命令成功返回后丢弃结果并抛错。原共享release-tail、host状态查询、journal、备份恢复、候选、nginx及核对代码不替换、不修改。断言真实open命令恰好1次、回执丢弃1次、之后至少有一次真实status查询、close为0、迁移/启动各1次、原旧外部动作效果始终1，最后reconciled且原锁释放。

**真实Linux/Mac隔离演练通过：session15610退出0。** 日志 `/private/tmp/holaday-lost-open-ack-connected.log`；同次源/目标各90表，原Mac age恢复及全部迁移、原双HTTPS入口恢复、实际数据及同boot核对通过。资源清单 `/private/tmp/holaday-stopped-source-efa53dab-0f29-45b8-bde1-9315c809eb14.json`，两个专属合成数据库/卷经原driver精确身份和标签核对后清理，协调器容器退出自清理；既有mysql/redis未动。无真实支付方访问、生产凭据、宿主PID或生产挂载。

使用原网络QA镜像`sha256:ff58ba973281d0804a90d92cee112ef1240386875f2584f975bf0bbf93893abf`及原MySQL镜像`sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`。私有PID、source/target各768MiB单核，协调器3GiB单核，共享的仅为本轮无外网QA源容器网络namespace；不并行跑其他重型任务。应用候选仍为缓存`6a46ee0fdf588034006e0a53a194b51d3c69608e`，协调器为当前分支；这不是最终发布候选、生产双机、enabled-worker或支付恢复验收。

这是原有行为的新组合覆盖，不宣称修复了生产缺陷，也不虚构RED。初次静态检查仅QA输出缩进不符退出1，格式化后两MJS检查退出0。后续串行回归session39098退出0：原42文件browser1116/1116；ops120/60/16/947及Python12，全部零失败/跳过。日志`/private/tmp/holaday-lost-open-ack-{browser,ops}.log`。最终两MJS Biome和diff-check退出0，所有本轮测试结束。新增原计划要求的deployment-checklist，明确八项阻断/未完成证据、候选与QA产物的区别，以及单次执行与失败核对边界。

主智能体按审查清单定向检查了原恢复会话、隔离目标、受保护入口和共享后半流程，未发现已确认的生产代码缺陷；这不是最终独立整分支审查。生产独立facts、浏览器执行隔离决定、受保护execute完整接线、真实停写备份/Mac恢复、非PayPal恢复及最终审查仍未完成；CLI关闭，未push/PR/合并/部署。

## 2026-09-29 prepare/preopen 独立 writer 来源接线修复

最终结果：79759退出0，browser1116/1116、ops120/60/16/947与Python12，全部零失败/跳过；48594最终Linux238/238退出0零跳过。三份最终日志`/private/tmp/holaday-readiness-writers-{browser,ops,linux}-final.log`。所有测试结束，两文件Biome、diff-check退出0；下方运行中说明已被本段取代。未重做真实MySQL/物理停止/恢复演练，未宣称完整现场facts或最终独立审查通过，无远端操作、支付方请求或部署。

最终阶段语义：prepare允许合法的已知写入者观察，preopen要求归零；新增反例先19通过/2失败退出1，修正后Linux238/238退出0零跳过（`/private/tmp/holaday-readiness-writers-linux-final.log`）。完整browser恢复原42文件清单后1116/1116退出0零跳过（`/private/tmp/holaday-readiness-writers-browser-final.log`），ops仍待收尾。此前41文件列表错误包含Linux专用integration，Mac1098通过/1失败退出1，不计全套通过，不改平台保护或冒充实际Linux物理演练。该修复只覆盖readiness独立来源消费，不是完整生产facts提供者；下方早期“回归运行中”状态由本段替代。

实际缺口在原 `site.evidence.readHostInventory`：批准的数据库管理来源只供入口检查使用，未被两个 readiness 阶段消费。原报告在活动事务/来源读取失败反例仍返回；RED15失败、退出1，日志 `/private/tmp/holaday-readiness-writers-red.log`。修复复用已有受保护来源，前后观察、范围/生产者数/最早时间绑定；保留 prepare 与 preopen 对既有连接的不同要求，不把独立数据库观察提升为全局 unknownWriters 证明。

首轮 site83/83退出0；最终真实Linux site/host/mysql238/238、零跳过、退出0，`/private/tmp/holaday-readiness-writers-linux.log`。原镜像只读脚本、无网络/私有PID/512MiB单核，退出自清理，不重做已完成的数据库物理夹具。两源码文件Biome和diff-check退出0。完整显式41文件browser回归session66135尚运行，另记最终结果；不以部分通过代表完成。现场facts/执行入口、真实恢复、非PayPal恢复及整分支审查仍未完成，CLI关闭，无生产变更。

## 2026-09-29 当前会话归属接线与现网只读证据（不是停写证明）

**最终串行结果（覆盖下方运行中记录）：** session26686退出0：browser1095/1095、Linux217/217、ops120/60/16/926及Python12，全部零失败/取消/跳过；原连接器/journal/真实MySQL/proc/ss隔离夹具亦退出0。七MJS Biome与diff-check退出0。本轮主智能体定向自查已修证据年龄，但不是整分支独立审查；没有生产写操作/PR/push/merge/deploy，CLI关闭，原Task4仍未完成。九个明确文件待保存提交；旧cache保留。

原MySQL reader→原proc/ss稳定观察→原受保护管理连接→site已接通。只唯一归属当前本地TCP会话；未归属、漂移、假冒事件线程或权限缺失不放行，原独立facts仍必需。标准事件线程按真实FOREGROUND识别。输出计数与身份摘要，保留`unknownWritersZeroProven:false`，不推导未来无法写入。原应用账号/权限/业务数据/支付、普通发布及CLI execute不变。

新功能RED→GREEN：初始54项，接线修正后22968为213/213；真实驱动字符串端口16081诊断后加规范字符串/非法格式反例，56/56；最早采集时间及site传播反例RED后92589为125/125。各GREEN退出0零跳过。最终217项真实Linux与原连接器/journal/MySQL/proc/ss隔离fixture已通过，session26686仍在继续完整42文件/ops回归，待收尾；日志`/private/tmp/holaday-session-owners-{linux,real-linux,browser,ops}-final.log`。

现网36610退出0，凭据仅服务器内部：同次5会话归属4TCP→2UID998进程+1真实MySQL事件线程，未归属0、事务/启用事件/复制活动0。原完整host观察器未替换；脱敏证据`/private/tmp/holaday-admin-writers-attributed-20260929.json`，读取器摘要及边界见checkpoint。本次在后续时间保守修复前采集，不声称最终部署候选/窗口验收，也不将全局unknownWriters填0。第一次工具权限审核超时未执行，唯一重试正常获批，无生产写操作。

失败记录保留：8631补丁误置导致site失败；36821隔离TCP账号未建，21869原默认驱动字符串端口未支持，16081诊断确认；12476完整回归受沙箱Unix socket EPERM影响1072通过/21失败；56316完整回归读到新年龄RED反例1092通过/2失败。均退出1、不计通过。最终重跑使用冻结的修复代码。隔离fixture仅manager/startup/nginx是合成边界，真实proc/ss/MySQL与默认保护读者不替换；不是生产双机/停写/恢复验收。所有本轮合成容器/卷按标签清理，可重建，既有数据库Redis不动。

## 2026-09-29 独立管理观察接线（非发布通过）

原host增加显式受保护管理观察，原site在`inventory.databaseObserver`绑定下把脱敏来源交给独立facts；不切换应用账号、不修改权限，不凭会话计数判断全局停写。固定Debian配置路径、摘要/文件身份、源UUID/库名、原journal与窗口均校验；原MySQL读者不改。新的site不能用回调零值盖过活动事务/事件/复制或缺失/陈旧/漂移来源；其他独立facts仍必须提供，CLI execute仍关闭。

RED：host98794退出1（缺导出）；site29337退出1（来源未接，新增10子例失败）。GREEN：host95947为91/91，site59175为62/62，退出0、零跳过。真实Linux/MySQL合成fixture在62353、73348退出0，原默认管理连接及查询器可见跨账号会话/跨库启用事件/未提交事务，应用账号保持原SELECT权限，撤销观察权限及配置漂移均拒绝。日志`/private/tmp/holaday-admin-writer-linux{4,5}-20260929.log`；使用已有镜像、无外网、无宿主PID/端口/生产配置，每轮独立合成数据及socket卷已精确清理。

失败不抹除：Mac路径别名夹具导致71614退出1后改canonical路径；Linux78277缺fixture legacyDigest、22047/51509元数据读者拒绝均退出1。后两轮根因未完全确定，随后避免连接初始化临时MySQL，最终PID1 mysqld及socket就绪才开始新测试。没有放宽产品检查或自动重试生产SQL。

最终85074退出0：browser1072/1072、ops120/60/16/903及Python12，全部零跳过；`/private/tmp/holaday-admin-writer-{browser,ops}-regression.log`。63974退出0：真实Linux受影响测试194/194零跳过，及最终原默认连接器/MySQL合成夹具通过，`/private/tmp/holaday-admin-writer-linux-{regression,final}.log`。五MJS Biome和git diff-check退出0。本轮资源已按精确标签清理，仅合成数据、可重建；既有mysql/redis保留。未宣称应用全套、整分支独立审查、生产停写或真实生产恢复通过；这些仍是后续门槛。没有PR/push/merge/deploy，旧36c42add离线包的历史结果不能当作新源码发布结果。

## 2026-09-29 已授权管理配置只读现场核查

用户明确授权后，正常审批通过。session86409配置存在性检查退出0；68945原`readCutoverMysqlWriters`实际生产只读采集退出0，源身份先与应用连接核对，现成管理配置只在Vultr内部使用，凭据不回传。直接全局PROCESS/EVENT与实际元数据覆盖通过；会话5、其他活动事务0、启用事件0、运行复制receiver/applier0。读取器未修改，只执行SELECT/SHOW，不改数据/权限/服务。首次因工作树未加载部署凭据未连接完成，指定既有主仓库配置后成功，未改服务器认证。

31446两遍只读TCP/proc会话归属观察退出0，4会话对应2个现有UID998/Node22 Holaday进程；该次另1未归属如实保留。56166专项核对退出0，确认其为MySQL `thread/sql/event_scheduler`，TYPE实际FOREGROUND而非临时诊断假设的BACKGROUND。三次采集各自带时间戳，不合并伪造成同次停写证明；内部线程当时没有启用事件也不能证明未来无写入源。证据`/private/tmp/holaday-admin-writers-{live,ownership,daemon}-20260929.json`，配置存在性`/private/tmp/holaday-admin-metadata-config-20260929.json`，均为脱敏私密文件，不含凭据/业务原文。

该特定权限阻塞已解除，既有自动化确认恢复ACTIVE，未开execute。临时采集尚非受保护现场adapter，unknownWriters零值、完整facts/恢复/最终候选验收仍未证明。没有新增产品源码或重跑组件套件，本段退出码指实际只读观察，不是整项测试通过。继续原计划，不重复索取同一授权。

## 2026-09-29 当前候选离线工具包验收（36c42add）

原闭包28/22/26模块、observer、固定NFT及原查询器编译产物合计85文件封装于`/private/tmp/holaday-first-cutover-tools-jxQvxN`，manifest SHA256`12fca5965758aa8fc8740f71858dd4874c4043371eacdf0d3ece660a37bb2144`，不含现场批准/凭据/私钥/商户元数据/facts。实际LinuxNode22 session94245退出0：85文件摘要、76个MJS路径导入、原ingress/gateway校验器每侧4项篡改拒绝和复原通过；原支付查询接线15/15，零失败/取消/跳过。日志`/private/tmp/holaday-fixed-tools-linux.log`。这是当前产物验证，不重计历史整套回归数量。

session11701退出0：用34个真实Git对象保留原候选SHA，在独立无网络Linux中调用原固定协调器入口；/proc/UID/argv/cwd、Git实际字节、toolDigest匹配通过，改模块并重算manifest、错误cwd、开放批准文件权限均拒绝；execute继续拒绝，无journal/service写入。日志`/private/tmp/holaday-fixed-entry-candidate-linux.log`。QA浅对象库只含需要的代码树/对象，codex/qa引用和批准在QA内部合成，不证明生产分支可达性、完整checkout/build或生产批准。两个容器均512MiB/1核/私有PID、无网络、不挂生产凭据，退出自动移除。临时校验脚本与包路径见checkpoint，未更改产品源码。

结果边界：工具封装/固定入口源检查已获当前产物证据，不能等价为独立现场facts、安装完成、真实生产备份/恢复、非PayPal恢复或独立整分支审查。既有数据库管理凭据路径权限拒绝尚未针对性解除，未重试或绕过；CLI仍关闭，未push/PR/合并/部署。后续文档提交不等于包的候选自动升级。

## 2026-09-29 查询响应流上限审查修复（基于1ea2922b）

原查单查询器先完整读响应再检查大小，256KiB未约束读取过程。两个合成ReadableStream反例先失败（69086，`/private/tmp/holaday-query-stream-red.log`，41通过/2失败）：原实现消费全部正文，没有在超限时取消。修复为按实际字节计数，超过上限立即取消/释放reader，单次查询、不保留超限原文；不依赖Content-Length。两个有效签名恰好256KiB正例仍保留完整原字节。仅改原查询器和原测试，不调用任何真实支付服务。

完整cn-payment suite103/103与类型检查均退出0；Linux Node22无网络/512MiB/1核原查询包接线15/15、零跳过、退出0，新包`/private/tmp/holaday-query-stream-bundle-C9PTLA/query.cjs`仅QA无凭据。日志`/private/tmp/holaday-query-stream-cn-{suite,typecheck}.log`及`/private/tmp/holaday-query-stream-linux.log`。42文件回归首轮1010通过/34跳过/退出0（age变量名误写），补跑正确开关后age35/35零跳过退出0；去重覆盖1044项，不伪称单轮零跳过，原始日志`/private/tmp/holaday-query-stream-{browser-regression,age-enabled}.log`保留。Biome/diff-check通过，所有session结束。

这是主智能体定向自审，不是119文件整分支独立审查。生产DB权限和独立事实/受保护安装/真实恢复门槛未消失，CLI保持关闭，前一物理成功候选不是本修改后的最终发布证明。

## 2026-09-29 同一次完整隔离成功链（基于04b4d1a1）

最终回归：session12708退出0，browser1044/1044，ops120/60/16/875及Python12，全部零失败/取消/跳过。日志`/private/tmp/holaday-success-late-{browser,ops}-corrected.log`；原三夹具静态检查及diff-check通过。下文“运行中／待更新”为过程记录，已被本段取代；全部测试session结束。只代表隔离接线与回归，不改变生产切换禁止结论。

后续结果：late-known-effect session66686退出0，源90/目标90，原hold仅关闭同一候选一次，两个HTTPS入口503，dirty/风险/锁保留，独立服务计数1。d35c5604源/目标/卷已driver精确核验清理。原受保护协调器Linux夹具因仍列旧22模块先退出1（`/private/tmp/holaday-coordinator-physical-closure-red.log`，原入口CUTOVER_COORDINATOR_UNPROVEN）；只补原28模块清单中的六个既有模块后session9123退出0（`/private/tmp/holaday-coordinator-physical-closure-green.log`）。实际Git候选字节/原固定入口/proc/UID/私密文件通过，修改工具及manifest仍拒绝，NFT策略漂移拒绝，execute继续unavailable且无journal/service写入；均为新的无网络512MiB私有容器，退出已自动移除，没有重建镜像。

回归命令操作失误单列：session35080的精简PATH漏掉rg，生成空文件数组，Node回退默认全仓发现。发现后定向SIGTERM已核实Node69414及包装shell69407，session退出143；日志`/private/tmp/holaday-success-late-browser-regression.log`保留，97pass/334fail/502cancelled不计本项通过，后续ops没有执行。日志明确中止于core-generation-review.test.ts导入，生产supercar冒烟脚本均在未执行取消集合；PayPal/Playwright入口为模块加载失败，非真实服务调用。已读取误收集的dist/test/db-helper.js：仅导出函数，没有顶层连接或迁移；其余已过用例为本地合成/静态契约。没有发现外部调用记录或遗留测试进程，Git仍只有本轮预期改动及原cache。纠正为先独立发现并校验42个允许文件，然后命令显式逐个列出，不依赖受限PATH中的rg或允许空列表；新session12708串行运行浏览器和ops，`/private/tmp/holaday-success-late-{browser,ops}-corrected.log`，结果待更新。错误运行不覆盖、不冒充全套验收。

session3117退出0，`/private/tmp/holaday-full-success-connected.log`。原host从准备、退休、备份和Mac隔离恢复、61SQL、新boot及两次preopen，经过一次open、实际nginx恢复和原worker=false启动保存，最终调用QA限定reconcile。该核对实际读取同源身份、原13表工作及支付范围两次，检查实际PM2、旧端口拒绝、候选health200和两个HTTPS只读未知路径404、相同serving/dirty身份；不是空成功回调。原transition返回reconciled、原finish释放锁，零close、风险摘要不变、外部效果1且不重放。源90/目标90，中文/BLOB/NULL/触发器/事件另由父夹具比对；原resource2a0520bc合成资源已核验清理。

此前success模式RED仅为允许模式断言退出1，发生在Docker/I/O之前（`/private/tmp/holaday-cutover-success-mode-red.log`），不把它称作完整行为RED。当前成功证据仅覆盖合成旧工作、共享命名空间的两个逻辑host、空支付范围和关闭worker；候选应用6a46ee0f与当前协调器分开记录，不证明生产独立facts、真实生产恢复、商户恢复或发布就绪。没有修改应用/包/锁文件；6a46ee0f到04b4d1a1的这些目录差异为空。

配对`late-known-effect`场景session66686仍运行，日志`/private/tmp/holaday-late-known-effect-connected.log`。仅在实际开放、入口恢复、原启动保存及数据库核对后，通过独立计数服务的只读接口发现具体unknown动作，要求原hold关闭同一dirty候选、双入口503、锁保留、无第二次动作。尚未计通过。两QA文件静态语法、Biome与diff检查退出0；完整串行回归待本轮最后修改后重跑。一次格式化审批超时未执行，唯一重试已成功，不是测试失败。

## 2026-09-29原启动保存接线（基于787607a0）

原两份QA文件新增after-worker。复用真实停止态cron和原定向注册移除，随后原resumeFirstCutoverCandidateWorker在worker=false配置下验证候选、保护日志并保存两份startup。只使用目录映射区分同一隔离命名空间中的两个逻辑主机，不伪造文件stat、进程、SQL、应用或journal；不能称独立生产双机或worker启用验收。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 新模式RED | 原允许模式拒绝after-worker，退出1，Docker/I/O之前；旧ID仅语法输入、未访问或复用 | `/private/tmp/holaday-native-worker-mode-red.log` |
| 首次接线 | session9807退出1，preflight拒绝空remove；源2/目标0，未迁移 | `/private/tmp/holaday-native-worker-connected.log`、opTWjm诊断 |
| 真实旧cron接线 | session2214退出1，producers_stopped；双逻辑主机归档目录冲突，未迁移 | `/private/tmp/holaday-native-worker-startup-connected.log`、ETf0aK诊断 |
| 独立启动及归档目录 | session10696退出0、源90/目标90；原完整链到实际startup保存后故障，一次close/两个HTTPS入口503/dirty保留、不重放 | `/private/tmp/holaday-native-worker-separated.log` |

失败轮269211c3与90ac80ff、成功轮74f1dbbe的源/目标/专属卷已核验精确清理，日志/私有恢复资料保留。原防覆盖规则和现场scope校验未改，不以empty/noop绕过。真实PID0 cron被原注册/启动文件移除函数处理；原候选worker=false函数实际执行readCandidate/PM2/log权限/两文件保存，原六条日志及实际文件摘要、无关行不变已断言。QA仍只有共享daemon的两个逻辑host，不声称候选startup已跨重启验证，也不声称worker=true已测。两QA文件Biome/diff-check退出0；完整串行回归session19015退出0，browser1044/1044、ops120/60/16/875及Python12，全部零跳过；browser+ops日志`/private/tmp/holaday-native-startup-{browser,ops}-regression.log`。所有测试session已结束。

## 2026-09-29真实nginx同次接线（基于17428802）

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 恢复身份回读receipt RED | 14通过/1失败，原pair拒绝递归通道；不是通过 | `/private/tmp/holaday-ingress-reentrant-red.log` |
| 受控中断订单围栏 RED | 11通过/1失败，原lifecycle漏接批准阶段 | `/private/tmp/holaday-ingress-interruption-red.log` |
| 两项修复及漂移反例，本机 | 31/31，退出0、零跳过 | `/private/tmp/holaday-ingress-host-pair-green.log` |
| 同组实际Linux | session18355，31/31，退出0、零跳过 | `/private/tmp/holaday-ingress-linux-regression.log` |
| 完整ops | 120/60/16/875及Python12，退出0、零跳过 | `/private/tmp/holaday-ingress-ops-regression.log` |
| 抽取原nginx夹具回归 | session9069退出0，真实TLS/双栈/WS/持有无关流/配置权限和软链接恢复；独立组件验收 | `/private/tmp/holaday-nginx-extraction-regression.log` |
| 同次入口完整链，十分钟QA窗口 | session74814退出1；源90/目标90，新关闭候选启动后超时、未open、未到预定worker故障点，不计通过 | `/private/tmp/holaday-ingress-callback-connected.log` |
| 全新十五分钟QA窗口 | session87732退出0；源90/目标90，同次原三站nginx实际恢复后worker边界注入故障，一次close、两应用入口503、dirty保留、不重放 | `/private/tmp/holaday-ingress-fresh-window.log` |

最终e70521ab新源/目标及专属卷已由driver核验清理，仅删除合成数据，日志/私有恢复资料保留；原MySQL/Redis未动。实际原备份/Mac恢复/源61SQL/seed/新关闭boot/两个preopen/open/入口restore均保留，原site/observer身份和文件验证未替换；assertRestored逐站核对原bytes/链接/uid/gid/mode及两个receipt身份，原close后draining、closeAcknowledged=false和needsReconciliation=true保持。原效果计数1、QA resurrect只含无关进程。九个代码文件Biome及diff-check退出0。该场景通过不是完整成功路径；未执行原worker/startup保存或reconcile，不标整项完成。

先前54138原fake ingress拒绝、72267旧age镜像缺nft、10557缺旧回调后端、63795额外4001监听被正确判未知，均退出1，不计通过、不重跑原attempt。仅修QA资源及维护端口映射，保留原生产监听分类门禁。以上失败对应合成数据库/专属卷已按精确身份清理，日志/私有恢复证据保留。network镜像无age，复用已停止prepared容器的公开age程序，不复制home或私钥、不新增镜像；私有网络允许NET_ADMIN以测试原nft规则，不使用宿主PID/网络或生产凭据。

产品修复限于阶段接线和避免原身份回调递归通信；receipt帧逐endpoint新采、仅持有回调可读，当前文件/进程/批准/journal/窗口仍须验证。两逻辑主机仍是同一隔离PID/netns，不冒充独立现场事实；真实worker/startup保存/reconcile、完整成功和生产恢复尚未验证，CLI execute仍关闭。

## 2026-09-29真实open后入口失败与dirty保留（基于514e8967）

原两份QA夹具增加after-open：完整复用原host迁移/启动/verify/beforeOpen/open/afterOpen，只有QA入口恢复边界在原site的真实serving身份核验后明确注入故障，不返回成功、不恢复实际nginx。不替换控制socket、进程观察或状态文件。原发布阶段仍verified，原site归一化错误CUTOVER_SITE_UNPROVEN，不能写成发布opened。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 新模式RED | 退出1，旧允许模式拒绝after-open；任何Docker/I/O前，未接触旧attempt | `/private/tmp/holaday-after-open-mode-red.log` |
| 同次真实open后入口故障 | session98831退出0，源90/目标90；原open一次、close一次；原site实际serving/dirty/同实例/无旧进程核验后故障；原失败日志保留dirty | `/private/tmp/holaday-after-open-connected.log` |

无认证未知GET `/qa-admission-probe` 在open后404、close后503，未调用任务创建或业务路由。原HTTP health200、tasks503；原status与持久失败观察均draining、needsReconciliation=true、closeAcknowledged=false，未把dirty清成false。原恢复资料/seed/新boot/journal绑定保留，旧效果1，无二次open/重放；QA PM2恢复仅无关进程。network-none且假key，无模型/支付/外部网络访问。最终1762297a源/目标/卷核验清理，只删除可重建合成数据，日志与私有恢复资料保留。

两MJS node语法、Biome及git diff --check退出0。原ops session40868退出0：120/60/16/869及Python12全部通过、零跳过，日志`/private/tmp/holaday-after-open-ops.log`；仅离线支付测试，没有调用PayPal。所有测试session结束。真实nginx恢复、worker/startup、reconcile、完整成功路径和生产/整分支验收仍未通过；本例不能证明生产双机独立事实。

## 2026-09-29同次原verify／beforeOpen和开放前故障（基于1a71aa12）

原host两个实际readiness步骤均保留；注入点位于原beforeOpen成功返回后、open之前。阶段verified，root发布的preopen报告绑定同一candidate/bootId，实际uid998消费者执行两次。QA逻辑主机共享私有PID命名空间，不冒充生产双机独立观察；支付/业务范围继续明确合成。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 旧模式拒绝RED | 退出1，新before-open不在原允许模式中；在任何Docker/I/O前拒绝 | `/private/tmp/holaday-preopen-mode-red.log` |
| 原主机投影RED | session5531退出1，实际候选online且源90目标90；readWithCandidate拒绝，未到故障注入点 | `/private/tmp/holaday-preopen-pair-red.log`、私有f9LZeE/coordinator-diagnostic.log |
| 投影修正后同次原链 | session18861退出0，原两次preopen验收成功后注入故障；一次close、零open，health200/tasks503，未重放；源90目标90 | `/private/tmp/holaday-preopen-connected.log` |

修正仅移动实际候选cwd对应的PM2/proc数据及真实ss监听到逻辑Vultr；原进程身份、UID998、exe/start/ppid/注册/监听由原classifier核验，不提供成功替身。原beforeOpen完成后才抛故障，未在open里抛错误当丢ACK路径。两份MJS语法/Biome/git diff --check退出0。最终和反例源/目标/卷精确核验后删除，仅合成数据可重建，日志/恢复证据保留。完整ops session84126退出0，120/60/16/869及Python12全部通过、零跳过，日志`/private/tmp/holaday-preopen-ops.log`；无实际入口恢复/worker/reconcile或整项成功结论。

## 2026-09-29原同次源迁移及候选关闭启动后故障（基于45ce6f79）

新增原QA显式after-start模式，原before-migration保留。原host的迁移/seed/start/control/物理观察均真实执行，只有verify被一次明确故障替换，故不计开放前验收或成功切换。候选6a46ee0f、协调器当前WIP，数据库/代码均隔离QA，外部工作和支付事实明确合成。

| 验证 | 实际结果 | 日志 |
| --- | --- | --- |
| 原模式拒绝新场景RED | 退出1，旧after-start/before-migration断言拒绝，源2目标0 | `/private/tmp/holaday-host-start-red.log` |
| 初次接线及诊断重跑 | 各退出1，源90目标90；候选启动失败，未到verify注入点，不计启动成功 | `/private/tmp/holaday-host-start-connected.log`、`/private/tmp/holaday-host-start-diagnostic.log` |
| 实际候选uid998 env模块正反例 | 旧localhost千问区域URL退出1（两项校验）；合法区域URL语法退出0。网络隔离、假key，无API调用 | `/private/tmp/holaday-host-start-env-red.log`、`/private/tmp/holaday-host-start-env-green.log` |
| 修正QA配置后链 | 退出1；实际新候选closed启动/seed/boot/原观察/注入点均通过，失败为测试误期待closed、真实返回draining | `/private/tmp/holaday-host-start-fixed-config.log` |
| 最终同次启动后故障 | session69825退出0；源90目标90；一次迁移/start/close，零open；draining及closeAcknowledged=false如实保留，实际health200/任务503，旧效果1不重放 | `/private/tmp/holaday-host-start-final.log` |

原close是准入关闭屏障，不承诺已得到空闲确认；测试未调用wait/reset或修改产品使状态变绿。真实Linux uid998候选boot与seed不同、日志绑定一致、backupReceipt保留。仅after-start QA配置增加必需启动字段，4001/4002遵守原observer契约。每次新attempt/窗口/源目标，不重跑旧SQL；失败和正常尝试资源均准确核验后清理，日志/私有恢复证据保留。只删除可重建的合成QA数据，无生产、PayPal或真实模型调用。

本轮原`pnpm test:ops`显式`CUTOVER_TEST_AGE_EXECUTABLE=/opt/homebrew/bin/age`，session19935退出0，日志`/private/tmp/holaday-host-start-ops.log`。两MJS Biome/node语法及git diff --check退出0。没有完整应用/整分支独立审查或生产切换结论。

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
