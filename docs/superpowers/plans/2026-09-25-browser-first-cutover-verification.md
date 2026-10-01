# 浏览器首次切换验收记录

### 2026-10-01 M6真实缺口已修复并提交a971adb3；当前来源复核待具体载荷授权

用户对2582字节/SHA72a8ad...0224探针明确“授权批准”后，正常审批放行并实际执行，session7557退出0。manager-shape-probe.json显示9条记录中索引0/1（other）缺ownPid/integerPid；两个目标holaday-chromium-headed及holaday-vnc全部字段检查通过。没有配置值、任意服务名或秘密输出，没有生产启停/写入。

原manager读取器错误地把无关注册缺pid当作固定目标缺失。a971adb3只容许无关记录缺省pid：所有记录仍要求完整名称/ID与嵌套一致、全局ID唯一；存在pid必须为自有数据且合法；两个选定目标必须显式pid，不补0、不认定其他注册停止。7新测试先47项46GREEN/1RED，修复后47/47零跳过；原七模块Linux1214/1214零失败零跳过、真实PM2 socket读取/原PID及重启计数保持/缺socket不启动daemon均EXIT0，Biome与diff-check通过。仅作者范围审查，未重跑未变化的Brave物理用例，原fb1fcb60联合证据保持其历史范围。

准备当前runtime/evidence及只读驱动live-source-reader-v3.mjs：478582字节，SHA256 5e719a1d3eacb6ade35912ae3738bd0bb4e3456f7164006f189f01162cba09b0；两模块与a971adb3源文件解码逐字节一致（仅静态import嵌入），75秒/192MiB/单线程池，manager→source→manager，无启停/落盘/恢复/业务修改；失败只给固定源码行标签且仍失败。正常审批执行前拒绝，认为此前具体授权只覆盖2582字节，未覆盖这份新的内部源码载荷。未发送SSH、没有v3结果文件、未换通道重试。完整可审阅范围在qa/native-vnc-resume-20260930/live-source-v3-approval.md；需明确允许该固定载荷后再走正常审批。

当前现场source默认叶子仍未完成，双角色执行前条件、原host/完整ACK、整项演练/审查/新鲜发布窗口仍未完成；没有push/PR/merge/deploy或上线。原__pycache__保留，自动化暂停，单路无代理。新鲜验证日志manager-optional-pid-{red,green,biome,linux,native}.log保留；不重复已完成验证，不把本地修复当现场通过。


### 2026-10-01 原固定诊断已获准执行；新结构探针待系统所需的具体授权

用户在上一条固定载荷阻塞说明后明确“授权 继续”。正常审批现已允许原473698字节/SHA eac571d833fc2b38a1f7856267c3dc357216f239c3ffe0f2c12d58de52f7bdfe载荷，经原严格SSH路径实际执行：session58462退出1，stderr0，managers-diagnostic.json记录M6→M9→unproven/read-managers。它已通过socket/RPC到达PM2记录结构校验；尚不能确定M6多个条件中的哪一个，现场manager/source仍未证明。未停止/恢复/更改任何生产服务或业务。

随后准备2582字节独立manager-shape-probe.mjs（SHA256 72a8ad0072432d56d64cee39066d93238e52dde65245e8ae1a3b1a9840b10224）：同目标root@207.148.70.106/原47.99.169.186跳板，只调用已有socket的getMonitorData一次，输出固定失败字段标签与两个固定角色/other，不输出实际配置值或任意服务名、不导入仓库模块。正常审批在执行前拒绝，理由是新探针未被原473698字节的具体授权覆盖。没有SSH执行/探针结果文件，没有换通道或重试。精确范围存qa/native-vnc-resume-20260930/manager-shape-approval.md；需明确允许该新探针传输后再走系统审批。

fb1fcb60的本地联合验证/1207回归仍有效，未重做；本轮没有猜测性实现改动，原__pycache__保留。下一步是取得M6具体字段形态后补实际缺口，仍须完成双角色前置与原host/完整整项验收；未push/PR/merge/deploy，自动化暂停，单路无代理。旧的“原473698字节未执行”断点已被本段取代，人类项目授权持续有效。


### 2026-10-01 原默认来源与headed+VNC真实联合观察通过；整项仍未验收

本轮基于41dfaf24，补齐精确root:root mount4755、procps pkill→/usr/bin/pgrep及websockify角色cwd三个真实兼容缺口。保留来源字节/权限/路径/漂移、完整进程树、原始census、加载inode、双采样socket和新鲜度约束；仅websockify及直接handler使用固定/usr/share/novnc，bash/x11vnc保持原注册cwd。新增17个source及5个cwd拒绝测试；cwd旧实现4个正例RED，修复后定向49/49 GREEN。最终原七模块Linux回归1207/1207、零失败零跳过；五文件Biome及git diff --check通过。仅作者范围审查，不是整分支独立审查。

原headed夹具新增--scoped-pm2-vnc，真实PM2/Brave/Xvfb/x11vnc/Python websockify，真实默认source与两角色观察器，真实WS/RFB 0→1 handler，headed和VNC分别跨35秒Worker周期，完整树/注册/原始census及外部QA服务保持，原页面不重放，私有策略与持久QA cookie保留，两次实际停止/清理完成。最终joint-native-final.log退出0；前一轮带定位日志版本亦完整通过。临时dataURL/行号诊断已删除；只保留有界QA启动错误采样。整站备份/业务/candidate前提仍为合成；fixture ACK6只基于实际headed证明，不写VNC ACK8、不开放候选。

QA限额：原ff58ba97镜像、network none、1CPU，回归512MiB/物理768MiB。已审Python源码及缓存体与公开包一致，包内mtime不同；只在一次性QA容器固定源码mtime，再由真实3.10.12生成并逐字节验证225字节cache。产品指纹规则未放宽，生产文件未改。Debian Xvfb/x11vnc与Ubuntu现场不宣称完全相同。保留一次headed启动status=stopped失败（joint-native-role-cwd.log）；其根因未证明，后加启动stderr/memory.events诊断，随后两轮通过，未引入自动重试。

证据统一在.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/native-vnc-resume-20260930/native-packages/：native-joint-verification.json含五文件/最终日志SHA，author-review.md、linux-regression-final.log、joint-native-final.log和各轮RED/失败日志保留。原scripts/__pycache__保留。

人类既有授权继续有效。远端473698字节诊断（SHA eac571d8...f7bdfe）仍遭系统自动审批阻塞，本轮未重试/换通道；现场manager/source仍unproven。两角色执行前能力/排他归属、原host恢复消费者/完整ACK及Task4–6整体演练、整分支审查和新鲜发布窗口仍未完成；host/classifier/CLI保持关闭。没有push/PR/merge/deploy/上线成功，自动化保持暂停，单路无代理。下一项须沿原方案补齐原生前置与现场事实，不得把本地组件通过当作允许发布。


## 当前结论：未完成，不能执行生产切换

### 2026-10-01 修正版已获准执行；manager仍拒绝，固定诊断载荷被系统阻止

用户先回复“允许授权所有必要的操作”，后进一步明确“我去睡觉了 你自行安排 允许期间的所有操作”。按正常系统审批执行已核对474111字节/dbfd2c...08eb修正版成功获准；实际只读结果仍为`unproven/read-managers`，命令退出1、stderr空。PM2路径本地修复及真实隔离socket验证仍成立，但不能推断现场manager读取已通过，source叶子尚未执行。原v2现场结果保存在`qa/native-vnc-resume-20260930/live-source-reader-v2.json`。

准备有限诊断版`managers-diagnostic.mjs`：473698字节，SHA256 `eac571d833fc2b38a1f7856267c3dc357216f239c3ffe0f2c12d58de52f7bdfe`。仅在原manager拒绝处输出固定M1–M9编号及MODULE_NOT_FOUND/ENOENT/EACCES/ECONNREFUSED/other有限码，绝不输出配置值、error.message/stack或秘密；删去source读取，只调用原getMonitorData。目标仍root@207.148.70.106，经原严格跳板路径，75秒/192MiB，无远端落盘/启停/恢复/业务修改。正常审批执行前拒绝，认为用户未逐份明确授权该派生载荷外传。按拒绝允许的方式做本地逐字节范围审计：evidence完全相同，runtime除manager固定标记外前后完全一致，无新内部文件/配置；`diagnostic-scope-audit.md`含可核对66行差异。携此新证据正常复审同一载荷和同一路径，仍被拒绝，理由是范围审计不能替代这份具体payload的明确授权。两次均未执行SSH；停止重试，不换通道或间接执行。需要用户明确允许该诊断载荷向该主机的一次只读传输后再走正常审批。

当前HEAD实现仍8cd2975e，原未跟踪__pycache__保留；本轮没有修改生产或实现代码，不重跑已通过1185组件测试。自动化仍暂停，无代理、无运行中测试/远端进程。Task4–6、来源/双角色恢复及新鲜发布窗口均未完成；无push/PR/merge/deploy或上线成功。此处是真实系统权限阻塞，不能把广泛用户授权当作绕过系统许可。

### 2026-09-30 首次授权已执行；真实PM2路径缺口修复，修正版传输仍受审批阻塞

用户对原474131字节固定载荷明确授权后，正常审批允许执行。实际结果为`unproven/read-managers`（退出1、stderr空）；没有进入source叶子、没有停止/恢复。额外只读固定路径元数据确认现场`/opt/node22/lib/node_modules/pm2`不存在，而`/usr/lib/node_modules/pm2`及其RPC依赖存在，rpc.sock为root所有socket。原两个native读取位置已对齐来源校验既有/usr/lib路径。新增真实Linux PM2 socket夹具，在断网1CPU/512MiB固定镜像中把真实安装移至该路径，旧代码RED、修正GREEN；两管理器PID/restart计数不变，缺失socket不建daemon。原七模块1185/1185、零跳过，Biome/diff-check通过；仅作者范围审查，非整分支独立审查。

修正版同两份内部源码+相同只读驱动为474111字节，SHA256 `dbfd2c373a368df24c66c867b1f870804d7822eae0a43caeb5aaf2dff6ca08eb`，准备文件`qa/native-vnc-resume-20260930/live-source-reader-v2.mjs`及`read-live-source-v2.sh`。通过正常审批申请再次传到同一Vultr207.148.70.106，被执行前拒绝：原授权只覆盖旧固定字节，不覆盖修改后载荷的内部源码外传。没有SSH重试、没有v2现场结果、不绕过；需要明确批准该修正版传输。原文件/失败证据保留。新增日志managers-{red,green,regression,biome-final}.log和pm2-transport-metadata.json。尚未完成source现场默认观察、真实headed+VNC联合验收、双角色前置能力/归属及Task4–6；发布门槛/CLI仍关闭。自动化暂停、单路、原缓存保留，无push/PR/merge/deploy。

## 2026-09-30 精确启动源码/cache绑定（本地通过，现场执行前被审批拒绝）

在e2bd23cd之后，仅原runtime/evidence及runtime测试、惰性JSON夹具增加8个已审可选启动文件/缓存的精确路径、大小、SHA、目标绑定，拒绝未知hook/遮蔽/修改/无对应源码cache。原五文件不重采；新增两个实际缓存只采指纹及16字节格式头，共4886字节。Ubuntu官方同版本3.10.12仅编译已审source，两个bodySHA精确匹配，目标代码未执行。Mac3.10.6比较不匹配及临时容器缺libexpat、跨发行版/lib布局冲突均保留，后以/ compiler独立目录解决；不把这些失败计为通过。

| 验证 | 实际结果 | 持久QA目录文件 |
| --- | --- | --- |
| 启动规则TDD | 12项首次10通过/2失败，最终12/12；零跳过 | hooks-red.log、hooks-focused.log |
| 完整runtime/evidence | 646/646，退出0、零跳过 | hooks-full.log |
| 固定镜像Linux七模块 | 1185/1185，退出0、零跳过；1CPU/512MiB | hooks-linux.log |
| 四文件Biome/diff-check | 通过，无修复 | hooks-biome-final.log及Git工具结果 |
| 两缓存编译比对 | bodySHA均一致，未执行source | exact-compiler-v3.json |
| 现场只读source叶子 | 自动审批执行前拒绝；无SSH、无输出文件 | approval-scope.md |

目录：`.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/native-vnc-resume-20260930/`。拒绝原因是约474KB本地内部runtime/evidence源码payload传送至Vultr缺少具体明确授权；未换通道或改载荷重试。请求的是这份固定载荷经原严格SSH的一次stdin传输，包含内部实现/部署路径，具体边界和SHA见报告；不是泛泛部署许可。原source生产加载选择、双角色capability/归属及完整native消费者尚未验收，host/classifier/ACK/CLI保持关闭。作者审查不替代整分支独立审查；不计作Task4–6、部署或上线成功。

## 2026-09-30 单路 native VNC 观察实现（组件验证，非完整验收）

最终新鲜Linux回归已完成：1173/1173、退出0、零跳过，日志在持久QA目录`linux.log`，内存512MiB/1CPU；两份实际hook缓存已用官方同版本Ubuntu3.10.12仅编译已审源码精确匹配（`exact-compiler-v3.json`），未执行钩子。以下“编译比对中/运行状态待定”为这一小节记录过程，最终状态以本段为准，source门禁代码尚未改变。

原工作树HEAD35cb0c8d，Task4BASE不变。仅原runtime/test补七字段VNC观察，保留headed五字段。重新测量双角色来源和配置、headed私有策略/完整树、VNC实际根/监督shell/x11vnc/Python/可变handler树、前后完整census及当前非deleted二进制身份；通过ss与真实fd/inode核验双显示监听和reciprocal ESTAB对端，并明确返回额外监听，不赋予endpoint许可或WS能力。

原三用例实际RED均为未实现分支拒绝；新增拒绝测试暴露原草稿before/current对象共享，已修为独立clone。中断前聚焦27用例、完整runtime331/331、原Linux七模块1173/1173均退出0、零跳过。宿主中断后/private/tmp临时日志/包缓存缺失，不把旧日志写成现存可审计文件。中断后runtime331/331和两文件Biome再次通过，新日志改存原ignored workspace `qa/native-vnc-resume-20260930/`；Linux重新留存日志的运行状态以progress最新条目为准。作者按接口/来源/树/对端/时钟/漂移逐项审查，不称独立或整分支审查。

Ubuntu官方公开python3-apport 2.20.11-0ubuntu82.10中8063字节模块已与此前生产指纹精确匹配，未执行。五个已审启动文件不重采。新单次元数据观察发现两份实际sitecustomize/apport Python3.10缓存；指纹采集仅读4886字节，仅返回哈希和格式头，不导出字节码。源码匹配不等于缓存语义或完整加载选择通过，当前仍在做已审源码编译比对。所有材料/临时脚本在同一持久QA目录，不进入产品发布包。

现有物理VNC夹具仍包含合成headed事件，且QA Python3.13/websockify0.12与产品固定3.10来源契约不同；不得伪造、改名解释器或放宽门禁来称新接口真实联合验收。source未知hook、host pre-effect、classifier、ACK及CLI仍关闭。Task4–6剩余真实联合恢复、停写备份/Mac/非PayPal恢复、全流程故障与不重放、整分支审查和新鲜发布窗口尚未完成。没有生产stop/start、支付历史或密钥修改、PayPal调用、push/PR/merge/deploy。单路，无代理，自动化保持暂停。

## 2026-09-30 实测来源兼容性修正（本批验收通过，非发布验收）

基线3eb86c6d。原两名Sol在互斥文件范围内实施，主控检查实际diff并串行回归；没有新增框架。原来源读取器和受保护材料校验器只接受实测的可选not-zip-safe单LF标记（size1及精确SHA256），新增真实wrapper需要的/usr/bin/date来源读取、PATH选择及摘要绑定；缺失、被前置路径遮蔽或不可信时仍拒绝。四处既有合成材料同步新增date，不改变真实停止/恢复断言。

| 验证 | 实际结果 | 本机日志或报告 |
| --- | --- | --- |
| 定向TDD与完整runtime/evidence | RED12中7失败；GREEN12/12；完整607/607，退出0、零跳过 | `/private/tmp/holaday-vnc-source-compatibility-20260930-report.md` |
| 首次实际Linux七模块 | 69953/a08d7c退出1；1135通过、11失败、零跳过，保留失败记录 | `/private/tmp/holaday-vnc-source-compatibility-linux-20260930.log` |
| 两个遗漏的合成材料修正 | 仅site/ingress各增加date一行；修正前定向2失败，修正后完整132/132，退出0、零跳过 | `/private/tmp/holaday-vnc-source-compatibility-fixtures-20260930-report.md` |
| 最终实际Linux七模块 | 21093/3083f5退出0；1146/1146、零跳过 | `/private/tmp/holaday-vnc-source-compatibility-linux-fix1-20260930.log` |
| 独立范围复审 | I1已关闭，spec/quality PASS，无新发现；不是整分支审查 | `/private/tmp/holaday-vnc-source-compatibility-review-20260930.md` |
| 八文件静态检查 | 7e3325退出0；Biome无修复、diff-check和冻结摘要一致 | 主控工具记录 |
| 首次ops环境遗漏 | 84856/41cc15退出0；Node120/60/16和Python12通过，末组1276中1242通过、34跳过，不能计为零跳过验收 | `/private/tmp/holaday-vnc-source-compatibility-ops-20260930.log` |
| 显式age的最终ops | 48839/41679c退出0；Node120/60/16/1276及Python12全部通过、零跳过 | `/private/tmp/holaday-vnc-source-compatibility-ops-age-20260930.log` |

首次34项跳过原因是主控未传原计划要求的CUTOVER_TEST_AGE_EXECUTABLE；现成/opt/homebrew/bin/age v1.3.1已核实，不安装工具或操作用户密钥。使用该显式环境变量的原ops最终48839/41679c退出0，末组1276/1276、零跳过；此前环境遗漏和Linux11失败日志完整保留。最终4735a5核对八文件冻结摘要一致、diff-check退出0。三名原代理和全部验证进程已结束；独立审查报告记录的待验状态属于其写作时刻，主控最终实际结果见本表，不改写历史。

Linux仍使用原固定QA镜像ff58ba97，单容器、1CPU/512MiB、私有PID、network-none、只读scripts、无生产凭据。未重跑已完成的VNC物理演练；该夹具本次一行是明确合成材料，不是生产date实测或新物理验收。实际生产date/PATH及五个未知启动文件仍未审查；原capability/专属归属、native恢复消费者、ACK、库存>4/Xvfb拒绝和CLI关闭保持。没有生产写入、支付业务改写、PayPal服务调用、push/PR/合并/部署。

## 2026-09-30 已授权公开包来源实际采集（不是加载选择或恢复验收）

精准公开包导出许可已由用户直接“允许”补齐，下文同日旧记录的“未授权/未执行”不再是当前状态。原通道与凭据仅在执行进程内使用，未输出；没有服务器写入、Python执行或业务读写。

| 本次实际操作 | 结果 | 本机证据 |
| --- | --- | --- |
| 原固定采集 | 42743/c5b708退出1，路径保护拒绝，readBytes0；未重试 | `holaday-vnc-selection-source-20260930.json` |
| 固定路径元数据诊断 | 36842/86a705退出0，定位sitecustomize链接到原边界外的/etc路径；不读内容 | `holaday-vnc-selection-diagnostic-20260930.json` |
| 版本化公开包采集 | 22606/c330fc退出0，完整采集；hookBytesRead0 | `holaday-vnc-selection-source-v2-20260930.json`，49557字节0600，SHA256 `5cee87d6bdaa76fd573c7056642f97bb9c55b77cf20498f4231ebbda2a29113a` |
| 固定七文件补充 | 20996/d9adda退出0，补齐四份此前仅有摘录的源码及三份元数据；四模块摘要完全匹配 | `holaday-vnc-package-completion-20260930.json`，96400字节0600，SHA256 `76376c259c6d2a22246a6ca0c962043e2e697dab269d89efd46bea5c3af20cb6` |

上述文件均在`/private/tmp/`。补充采集器ff7c02f6经过主控完整审读，固定七个规范路径；同目录alias及越界alias均在open前拒绝。外层/远端语法和9个纯内存拒绝检查退出0、零跳过；这些是采集器局部检查，不是产品发布测试。

已核实唯一安装metadata为websockify-0.10.0.egg-info，console入口为websockify.websocketproxy:websockify_init，websocketserver.py在实际导入链上。完整同摘要源码补齐了SIGTERM→terminate及正常多进程退出分支的child.terminate调用；它不证明全部子进程实际退出，原物理观察仍必需。not-zip-safe和dependency_links.txt实际为单LF，requires.txt为空；固定wrapper还依赖date。

未知sitecustomize与四个zope命名空间.pth内容均未读取；五项继续阻断加载选择。两个采集结果均明确selection/production=false，补充结果recovery=false。只读审查这五个文件的具体权限已单独询问，未收到答复前不读；不把公开包授权扩大为任意自定义启动源码读取。代码修正和本轮产品测试状态以其后恢复点为准，不能引用本表声称恢复或上线完成。

## 2026-09-30 固定来源门禁接入原停止路径（本批验收通过，非发布验收）

基线6950e329后的本批接通固定磁盘/启动选择来源、严格材料验证、完整受保护site摘要与journal绑定、双角色停止意图及派发前来源刷新；刷新后重取围栏，最后检查窗口。保留原两角色恢复前置、库存分类器和CLI硬拒绝，无恢复ACK或生产开放。

独立审查的I1来源后置括号时钟回退、I2固定Python入口目录替代distribution/native模块两项均经真实RED→GREEN修复；第1轮范围复审spec/quality PASS，无未关闭发现。I1十例失败后通过，完整inventory247；I2十例失败后通过，完整runtime294，均退出0、零跳过。`/usr/bin`只流式检查名字，固定上限16384、每名255字节及原60秒单调期限；package目录仍限512项，不执行Python/import，不证明生产兼容。

| 最终修复后验证 | 结果 | 日志或报告 |
| --- | --- | --- |
| 实际隔离Linux七模块 | 23866/805b34退出0；1134/1134、零跳过 | `/private/tmp/holaday-cloud-source-gate-linux-fix1-20260930.log` |
| 原ops回归 | 57880/a29864退出0；Node120/60/16/1274及Python12，零跳过 | `/private/tmp/holaday-cloud-source-gate-ops-fix1-20260930.log` |
| 真实VNC恢复 | 39738/9905d4退出0；旧树/监听/RFB退出，新配置/历史/树稳定35096.212808000004ms | `/private/tmp/holaday-cloud-source-vnc-native-fix1-20260930.log` |
| 原停止专用路径 | 15090/1249f5退出0；原控制器/journal/默认数字ID停止及三个实际受测角色退出 | `/private/tmp/holaday-cloud-source-vnc-stop-fix1-20260930.log` |
| 11个代码/测试文件静态检查 | 1985f6退出0；Biome无修复、diff-check通过 | 主控工具记录 |
| 独立范围复审及夹具审查 | I1/I2 ADDRESSED、spec/quality PASS；夹具PASS | `/private/tmp/holaday-cloud-source-review-fix1-20260930.md`、`/private/tmp/holaday-cloud-source-fixture-review-20260930.md` |

首次修复后Linux审批超时，未执行；系统允许的一次相同重试成功，未绕过权限。修复前Linux1114、ops120/60/16/1264+Python12及真实VNC35104.373266ms亦曾通过，单独保留历史日志，不能替代以上最终结果。复审写作时尚未获Linux结果，主控随后取得实际退出0；不改写审查者的历史状态。

VNC来源、headed5/6、业务/围栏、备份/候选与另一主机仍为明确合成前提；真实QA版本不同于生产，IPv6通配仅在network-none、无发布端口容器内观察。事件仅7条，无VNC恢复ACK/open。实际PM2 RPC和停止、真实x11vnc/websockify/WS→RFB与原断言保持。生产源码/选择元数据导出仍未执行，精确授权待补；本批没有生产、支付记录、PayPal、密钥、push/PR/合并/部署操作。完整两角色现场能力/独占归属/恢复消费者、真实停写备份/Mac恢复、非PayPal恢复、全流程演练及整分支审查/新鲜窗口仍未完成。

## 2026-09-30 真实服务隔离物理验收（优先于旧节）

产品基线17028f3e；本批只改两份原物理夹具与记录，不改变生产门禁。串行、原固定镜像、私有PID、network-none、无发布端口或生产凭据。以下场景全部实际执行、退出0，无跳过；不是新增单元测试数量。

| 场景 | 执行结果 | 证据 |
| --- | --- | --- |
| Brave完整正常恢复及最终停止 | 18525/ba00ca，退出0；两次实际停止、9成员恢复树、35568.664809ms巡检稳定、不重放 | `/private/tmp/holaday-exclusive-display-physical-final-20260930.log` |
| 外部显示占用 | 60568/d333d1，退出0；保留外部显示，无Brave/CDP、无重试 | `/private/tmp/holaday-exclusive-display-occupied-final-20260930.log` |
| 缺少隔离权限 | 63207/168e53，退出0；实际unshare拒绝，无重试/恢复ACK | `/private/tmp/holaday-exclusive-display-denied-corrected-20260930.log` |
| 真实VNC停止/恢复 | 6030/758f4e，退出0；真实x11vnc/websockify/RFB、旧树/监听/连接消失、新树/连接/配置/历史计数跨35099.376516ms稳定 | `/private/tmp/holaday-vnc-native-physical-final-20260930.log` |
| 原替身恢复模式回归 | 59463/986cb6，退出0；35073.444267ms巡检，保留原合成证据标记 | `/private/tmp/holaday-vnc-stub-regression-final-20260930.log` |
| 原仅停止控制器模式回归 | 27093/aa05d2，退出0；原控制器/journal/默认停止及真实进程退出 | `/private/tmp/holaday-vnc-stop-regression-final-20260930.log` |

Brave17f5f48d与VNC543b7504独立审查通过。最终Biome/diff-check0d220b退出0；Brave仅格式换行变为54b416af，反向单处替换完整hash检查9b6719退出0，确认无行为差异。VNC保持543b7504。原产品Linux1034、ops120/60/16/1223+Python12及实际启动故障2/2没有相关产品改动，沿用明确标注的本日历史验证，不为夹具格式重复重跑。

保留失败历史：Brave两显示同时首次创建目录、IPC继承stdio分类、VNC双5901行误计为两端口、保留云端口误放入永久退役列表，均先实际失败、定向修正再通过；未删除外部归属/双监听/整树断言或放松产品分类器。首次无权限runner因Bash空数组在容器启动前退出1，不算一次实际权限演练；修正的是临时脚本。

VNC真实版本与生产不同，实测IPv6通配5900/5901仅限隔离QA，非生产网络许可。其headed5/6、业务/围栏、备份/候选、另一主机与来源事实仍合成，事件7且ACK8/开放均无。因此这些通过不等于原整项恢复或上线通过。现场双角色前置与消费者、真实备份/Mac/非PayPal恢复、完整演练/整分支审查/新鲜窗口继续按原计划完成，CLI仍关闭。

## 2026-09-30 专属显示实现及真实服务夹具（进行中，优先于旧节）

固定启动材料现包含私有命名空间中的一次Xvfb启动及同PID Brave执行；实际双监听inode、精确子进程、完整新树、能力和有限配置比较已接入。启动握手独立复审发现Popen阻塞缺口，改为有界fork后关闭A-I1。取消用例M1补为SIGTERM后2.5秒内且早于普通启动截止；实际48686/bffd58退出0，2/2零跳过（超时4719ms、取消123ms），日志`/private/tmp/holaday-exclusive-display-I1-fault-final-20260930.log`。

修正后产品Linux88611/6c5746退出0，1034/1034；ops11739/8ca3dd退出0，Node120/60/16/1223及Python12，全部零跳过。普通套件不注册专用Linux故障用例；未拿Mac跳过替代Linux。日志`/private/tmp/holaday-exclusive-display-{linux,ops}-final-20260930.log`。尚无本批完整物理成功证明。

真实Brave夹具连续揭示并保留失败证据：并发启动两个Xvfb导致/tmp/.X11-unix创建竞争（已改为先证明独立显示就绪）；辅助进程的全部FD被错误套用initial-client私有性要求。实际55089/1bd1f9退出1、停止前拒绝，确认失败FD1与wrapper同号stdout同inode，对端仅为原私有PM2管理器，本地持有者为原树和已关联handler。正在做精确stdio分类，不允许名称回退、跳过未知对端或把管理器加进停止集合。

原VNC夹具新增真实x11vnc/websockify/WS→RFB模式，尚未通过：36738/674f22退出1且在停止前。诊断显示“监听行数为2”误把x11vnc的IPv4/IPv6同端口当作两个服务，websockify尚未就绪。QA版本x11vnc0.9.17还实际监听额外IPv6；须完整记录和验证所有真实服务端口，不能称为loopback-only、不能更改QA wrapper掩盖行为、不能等同生产版本/网络能力通过。当前由两名原Sol按互斥夹具范围修正，主控串行实际验证。生产、历史业务、密钥、PayPal、CLI及完整两角色恢复前置拒绝不变；完整消费者、真实备份/Mac/非PayPal恢复和最终发布验收仍待完成。

## 2026-09-30 后续现场范围核查（不是新的发布通过项）

实施批次已提交3e75d625，后续无产品改动。公开PM2磁盘源码19661/ce5f8a退出0，stop不接受配置覆盖、在线restart不是无效果设置。显示归属51742/6af126退出1且两轮stable=true：135个完整live进程、11客户端均属于批准两服务，0未匹配/组外client；两注册treekill均布尔true、autorestart=true。拒绝原因是两个PPID1的DISPLAY98进程，不是权限或网络失败。原“单根停止而保留显示”条件候选不成立。

精确元数据56031/d78968及IPC对端73710/7dc44c退出0，确认两个进程是Brave crashpad：主handler的initial-client对端属于headed Brave树，另一handler关联主handler。不把名称/环境字段当归属，不把IPC关系当连续谱系或停止授权；不改写原采集失败回执。原授权包含核实的专属后代，但排除共享Xvfb，不能把实现硬拒绝所有Xvfb等同于用户禁止全部Xvfb。完整来源、停止/恢复方式及原其它放行事实仍需接通；没有停止、付款、数据库、profile、密钥或部署操作。具体摘要/路径/边界见checkpoint最新节与progress。

## 2026-09-30 本批最终夹具修复与真实现场范围

- 原夹具异常握手I1已修复，最终hash2d3599abd46a64a49e116d89f28ac9a0c9b39860d487fc74f7915a1dd61f2bd0；独立复审PASS无未结发现。18716/96de3a实际Linux三种失败路径均退出0：无PID退出、无PID超时、有PID后超时均及时拒绝且无新活进程遗留。未启动浏览器/profile/显示/PM2。
- 同一最终hash的正常物理90718/3e8abe退出0，日志/private/tmp/holaday-native-recovery-physical-final-20260930.log：8个替换进程含2个重新归属成员，真实额外detached进程拒绝、原恢复前采集保持；PM2巡检跨35208.860517ms，原profile/策略/不重放/无关显示断言通过。不是真实VNC能力、业务恢复或恢复ACK/open。
- 最终十文件Biome及diff-check994273退出0；九个产品/测试hash保持下方Linux1011和ops最终验证版本。4b7e2e确认隔离容器均退出，原MySQL/Redis健康。
- 新鲜只读22887/e8e030退出0，记录/private/tmp/holaday-display-parent-check-20260930.json：现场Xvfb1229/start1807仍直接挂在headed wrapper1217下；:98两监听及11个已建立socket归该server。仅server归属不是所有客户端独占证明。两次较早窄采集未通过角色识别，修正临时采集的同角色祖先根选择后才取得证据；无远端写入。
- 此现场布局与原整树停止/Xvfb保留门槛冲突。不能用QA独立显示布局通过替代，更不能删拒绝分支。当前全成功恢复消费者、真实两角色前置与原后续发布验收仍未完成。

## 2026-09-30 原完整进程采集与恢复前拒绝边界

从e896989b继续：原完整采集、headed新树诊断和原beforeOpen/site/observer恢复前检查接通。当前真实两角色来源/显示/能力前置尚未实现，明确在任何恢复效果前拒绝；完整成功消费者、比较器/日志5–8/ACK6/8仍未完成。保留原v2风险语义、私有停后配置、不递归、不重试和原>4事件拒绝；没有上传PID白名单或成功布尔值。

- Linux首跑23212/486e34退出1：1010通过、1失败、零跳过。原因是原inventory.test公开方法清单漏列restoreCloudServices；仅补一项期望后，实施者完整inventory/host/site440/440通过，独立B-I1复审关闭，私有getter及零效果检查未弱化。首跑后的ops未运行。
- 最终97200/186599串行退出0：实际Linux1011/1011；ops Node120/60/16/1209及Python12，均零跳过。日志/private/tmp/holaday-native-recovery-{linux,ops}-final-20260930.log。原Node24/age和隔离Node22环境保持。
- 完整采集实际Linux db7cf6退出0：root userspace、脱离父进程的无标签sleep和普通子进程均在结果中，未输出原argv/env。主控前一临时探针的无关错误二进制断言导致OOM/137（Docker事件77d3d2确认），去掉该断言后相同256MiB限额通过，不是产品修复或首跑通过。3c4010未获沙盒Docker访问、未执行测试；后续正常审批的实际运行如上。
- 原Brave夹具67243/5ae39c退出0：恢复前完整采集在实际停止后、单次恢复前取得；默认完整采集/PM2/root/策略读取器核验实际8个替换进程，其中2个为重新归属父进程的成员。注入本例detached进程时拒绝、精确清理后沿用原采集重新验证通过；没有重采恢复后基线。原PM2巡检30秒跨35178.851433ms稳定，原profile/无关服务/不重放断言通过。日志/private/tmp/holaday-native-recovery-physical-20260930.log；物理脚本hash1086c6f5aacb7b6a7794bfd63d5abe6d7be743626442df096ddc1d5587489dd8。VNC/业务/备份前置仍合成，绝非两角色恢复或发布通过。
- 原A/B子集独立审查通过，报告/private/tmp/holaday-native-recovery-{runtime,observer}-review-20260930.md；夹具独立复审与最终提交信息在progress记录。完整分支审查未完成。

另外，既有通道两次只读采集退出0：旧VNC Python映射为deleted，字节不同于当前磁盘Python3.10.12-1~22.04.18；固定wrapper与x11vnc/websockify包/入口模块摘要已记录。该事实要求恢复前绑定当前磁盘来源，不能用旧运行进程代替；不是全动态导入闭包或实际恢复证明。未停止/恢复生产服务，未访问PayPal、改业务、复制密钥、push/PR/merge/deploy或开启CLI。

## 2026-09-30 VNC有限配置核对、原site绑定与同ID物理恢复

从153eb093完成五文件并行批次。新增VNC比较器复用私有有限PM2变换，完整保留原配置/未知字段/历史计数，核验实际内存阈值删除及嵌套覆盖拒绝；原site把既有index0 recoveryDigest绑定到本attempt的固定VNC材料，无新配置字段。A原66失败RED→357/357完整两文件GREEN，另有嵌套对象覆盖7失败RED→修补GREEN；最终统一计数以下方串行结果为准，不重复累加局部计数。

- 最终87305/ed2d6d退出0：原--controller-recovery实际停止、原journal意图、默认同ID RPC、保留的停后完整配置对比和新树观察通过。35.072220266秒跨实际30秒Worker周期，配置/计数/进程身份不变，内存阈值缺失、无额外替身生命周期、原无关应用及profile哨兵保留；日志/private/tmp/holaday-vnc-recovery-physical-final-20260930.log。实际包查找及Git解析常量由原PM2代码在此QA中读取断言，不是手填N/A。源码只读164399/61aa53亦退出0。
- 共同变换受影响的headed回归23355/7f8ac2退出0：真实Brave、35.175327141秒跨周期、原旧target正控、恢复后无旧target/HTTP重放、私有只读策略、能力清零及持久cookie/profile保留，日志/private/tmp/holaday-vnc-shared-headed-physical-20260930.log。
- 同一87305串行后续：真实Linux948/948，ops Node120/60/16/1172与Python12，全部退出0、零跳过；日志/private/tmp/holaday-vnc-recovery-{linux,ops}-final-20260930.log。Mac ops明确Node24.13.0及实际age路径，Linux为既有隔离镜像Node22；无重新构建镜像或生产挂载。
- 五文件Biome与diff-check退出0。独立A/B规范及质量审查PASS无发现，最终VNC夹具hash2f5c414c1ed77a5b37bba0b235ea41912e9cd802ed60bce71ae787d577bd4cc6补充亦复审通过，报告/private/tmp/holaday-vnc-{config,physical}-review-20260930.md。665c9d确认仅原健康MySQL/Redis，无QA容器。

证据边界：VNC服务exe是明确的Python控制流替身，不是真实x11vnc/websockify能力；headed事件5/6、备份/候选/业务/fence/display及其他主机来源为合成前置。实际VNC事件只到第七条意图，没有恢复ACK或open。QA中的包/源码前提不证明生产前提；完整新树/现场守卫、独立facts、真实停写/Mac及非PayPal恢复、完整演练、整分支审查与新鲜窗口仍待完成。原>4分类器拒绝和CLI关闭保持，没有生产、支付服务、密钥或历史业务修改。

## 2026-09-30 原始/停后完整配置接入真实停止路径

从13ddc45f继续的五文件接线：原socket getMonitorData只读叶节点→固定两服务私有完整配置→原observer双侧事实核对→原独立停止观察→停后副本锁定→原ACK；正常读取继续核对已保留副本，不能从恢复后的现场重新制造基线。没有公开原文、替代journal、放宽原分类器或开启CLI。

实际66054/b1e0f7退出0：既有断网/私有PID/1CPU/384MiB/96pids镜像、两份公开procps包摘要校验后仅容器内解压；原--controller夹具使用默认新读取器，原PM2/journal/procfs停止链通过，两个服务与fork后代消失、无回生、无关应用/profile哨兵保留。其他主机/业务事实及服务exe仍合成，绝不是VNC恢复或真实业务恢复证明。日志/private/tmp/holaday-native-baseline-physical-20260930.log。

实际串行25967/659b2b退出0：Linux881/881，ops Node120/60/16/1105、Python12，全零跳过；日志/private/tmp/holaday-native-baseline-{linux,ops}-20260930.log。A的40项及B的206项局部通过不重复累计到最终计数。五文件Biome/diff-check退出0，独立配对复审A/B规范与质量均PASS无发现，/private/tmp/holaday-parallel-baseline-review-20260930.md。未做整分支审查/生产切换；恢复完整树、VNC恢复和非递归现场守卫等剩余门槛不因本批通过而取消。

## 2026-09-30 并行批次最终验收（不是整分支/上线验收）

A-R1 VNC嵌套启动覆盖四项RED实际失败，修补后8/8通过；最终定向144/144零跳过。独立审查A/B均通过，原I1/M1/A-R1已关闭。主智能体最终串行97538/eefb37退出0：真实Linux821/821，ops Node120/60/16/1085和Python12全部通过、零跳过；日志/private/tmp/holaday-parallel-final-{linux,ops}-20260930.log。30dd60六文件Biome与diff-check退出0；50e77a只读确认仅原健康MySQL/Redis、无QA容器。下段真实Brave证据对应最终仅VNC守卫修补前版本，headed及配置/物理夹具没有随后改动；VNC完整树/物理恢复仍待接线。

未放宽inventory超过四条事件的拒绝，未启用CLI，未取得真实停写/Mac恢复/非PayPal恢复/整分支审查或新鲜生产窗口；没有生产、支付服务、凭据或历史业务修改。最终结果不能替代这些剩余门槛。

## 2026-09-30 修正版物理配置与跨Worker周期验证

真实Linux六模块85953退出0，817/817、零跳过（/private/tmp/holaday-parallel-corrected-linux-20260930.log）。实际PM2 Worker/Utility夹具6a6732退出0：0/null/false分别调用一次替身reload，缺字段与JSON字符串null删除均0次，嵌套环境影子重新引入0则1次；没有启动daemon或重启真实进程。

真实Brave67259最终ea2a57退出0（/private/tmp/holaday-parallel-corrected-physical-20260930.log）：完整原配置到恢复配置的有限变换核验通过，实际Worker周期30000毫秒，观察35201.478808毫秒后同PID/start/历史计数/配置/日志保持，内存选项不存在。原两次精确停止、无关应用/显示保留、私有只读策略/能力清零、旧target正控及恢复后旧URL/HTTP不重放断言通过。仅使用原隔离QA镜像和公开离线缓存；VNC、备份及业务事实仍为合成，没有恢复ACK或开放生产。

B静态复审通过无发现；A的VNC嵌套启动字段覆盖遗漏正在修正，以上817项在此窄修正之前。最终ops、修正后Linux及A复审尚待完成，不能把当前组件结果称为整项验收。历史零阈值假设的反证保留如下。

## 2026-09-30 并行初版验证及 PM2 0 阈值反证（修正中）

初版串行真实Linux六模块768/768、退出0、零跳过（/private/tmp/holaday-parallel-linux-20260930.log）；两个实施者的局部结果和独立VNC审查见原progress。它们只证明所覆盖用例，不证明原“0关闭内存重启”的假设。

实际缓存PM2 6.0.14 Worker诊断48fb4f退出0：替身内存1024字节、autorestart=false、max_memory_restart=0，仍调用一次reload；缺字段则不调用。56d31e随后使用实际Utility.extendExtraConfig加JSON传输，证明current_conf的字符串'null'精确删除该字段、其他配置保留、Worker调用数0。源码检查均为隔离容器只读，诊断未启动PM2 daemon或重启真实进程；不是生产故障，也不是完整物理恢复通过。先前短时Brave夹具未覆盖Worker巡检，不能继续将其归纳为“无内存阈值重启”。

正在修正原执行器/读取器/配置对比及夹具。最终Linux、真实Brave配置对比、实际Worker反例、整合审查均待新版本重跑。CLI关闭，未生产执行/提交/推送/PR/合并/部署。

## 2026-09-30 JST 用户续跑：恢复观察与发送open之间不允许替换运行态

`5247a5`的18项RED均实际失败/退出1：遗漏固定cron/内存重启/fork设置、完整配置读取漂移及host两次观察间更换8类身份/配置事实。原runtime补齐固定字段及完整配置摘要前后稳定性，原host绑定首次观察与实际open前观察，时间可更新，身份/父进程/计数/配置/策略/命名空间不可替换；不输出环境原文。`fee43d`定向32/32退出0。追加正例及缺字段反例后`c89072`原Linux五模块502/502退出0、零跳过。日志`/private/tmp/holaday-cloud-config-{red,green,linux}-20260930.log`。

`5d058d`原Brave物理夹具退出0，实际读取的配置摘要与原私有PM2注册相符，三项固定设置精确匹配；保持原同ID恢复、进程退出、策略只读/能力清零、旧target/HTTP不重放及profile/无关进程保留断言。日志`/private/tmp/holaday-cloud-config-physical-20260930.log`；断网私有PID、原镜像/公开离线缓存，不是生产或真实DB/VNC恢复。此前拒绝模式未重复，不能算本轮新结果。

原ops最终`978a65`退出0：Node120/60/16/1012、Python12，全部零跳过；日志`/private/tmp/holaday-cloud-config-ops-20260930.log`。最终五文件Biome`3767cf`通过，所有测试已结束。原停止基线到恢复后的完整配置/计数/新树核对尚未完成，原inventory仍拒绝>4事件，CLI保持关闭。未整分支独立审查/合并/部署；本次是原开放前接线缺陷修复，不是大项完成。

## 2026-09-30 JST（09-29 23:19Z）：同ID单次恢复效果，不是完整恢复通过

原runtime的固定恢复效果要求原verified日志/四条停止记录、受保护恢复摘要、停后完整PM2配置及强制实时范围回调；第五条意图落盘后才发送单次数字ID RPC。连接后复核期限，不排队、不重连、不自动重试、不delete/start另建注册；RPC ACK不生成恢复确认。真实site范围回调及完整新树/VNC接线未完成，原inventory和CLI继续拒绝，不能把QA合成范围当生产事实。

最终`8133`：原隔离Brave夹具的成功/无SYS_ADMIN拒绝模式串行退出0。原真实journal、默认产品RPC与独立运行态读取验证同一PM2 ID/历史计数/cwd保留、旧target/HTTP不重放、profile哨兵/持久cookie/无关应用/显示保留。拒绝模式实际unshare退出1且不重试，只保留恢复意图；不是恢复成功。夹具VNC/备份/候选事实合成，未生产操作或数据库恢复。日志`/private/tmp/holaday-cloud-same-id-{final,denied}-20260930.log`。

最终`2360`：Linux480/480，原ops Node120/60/16/1000、Python12，全部退出0/零跳过，日志`/private/tmp/holaday-cloud-same-id-{linux,ops}-20260930.log`。四项定向测试覆盖丢应答不重试、窗口/配置/阶段/范围拒绝、连接期间超时不得发送，实际RED219c4e/a639d1/13d8ef后通过；中途scope夹具闭包及Biome noDelete错误均有记录，不计作产品通过。三文件Biome及diff-check通过；978bff确认原QA镜像未变、无QA遗留、原MySQL/Redis健康。未整分支独立审查/PR/push/合并/部署，PayPal未访问。

## 2026-09-30 JST（09-29 22:19Z）：恢复运行态与原开放前门禁

最终物理读取采用**不自动启动daemon的现有socket RPC**，而非会自动daemonize的pm2 jlist。a8fd5c禁止CLI反例退出1后改正。41984退出0，日志`/private/tmp/holaday-cloud-recovery-readonly-rpc-physical-20260930.log`；仅私有socket路径为QA选择，默认产品RPC/procfs/策略读取全部实际执行。新增缺失daemon目录保持空反例，无PM2文件创建，实际可写策略拒绝和正常恢复观察均通过。前述jlist物理结果仅历史。最终93405：Linux476/476、ops Node120/60/16/1000及Python12均退出0、零跳过，日志`/private/tmp/holaday-cloud-recovery-rpc-final-{linux,ops}-20260930.log`；五文件Biome/diff-check通过，原MySQL/Redis健康、无QA遗留。未完成全分支审查或整项上线验收，未访问PayPal服务。

原runtime的只读观察器直接读取实际PM2、procfs及私有只读策略；原host的beforeOpen和实际open前消费，不能仅凭八条恢复事件开放。实际argv/exe/DISPLAY/权限、策略字节/原父策略和两轮身份稳定性均检查，原完整进程树/显示独占/工具审查尚未接完；原inventory仍拒绝恢复事件，首次CLI未开启。

真实Brave最终60389退出0，含可写策略拒绝及恢复权限后再次读取；拒绝模式58482退出0代表恢复命令实际退出1且无重试/回退。旧target/HTTP动作不重放、合成profile哨兵/持久cookie/无关进程/显示保留。默认产品读取真实/proc与文件，仅测试私有PM2命名空间为夹具选择。日志`/private/tmp/holaday-cloud-recovery-observation-{final,denied}-20260930.log`。

本机最终80377开放门禁10/10退出0、零跳过；首次Linux22520为474/475退出1、零跳过，因截止夹具时钟和错误码预期不正确，已按原setTime及release-tail/status调用链修正；ops未在该失败后运行。暂移除guard以复现RED的补丁被安全拒绝，未执行且未绕过；该截止测试只计覆盖，不记为有效RED→GREEN。产品读取及运行态失败门禁有实际缺实现RED58cb51/d2834d/90204。69238完成较早版本Linux475/475、ops120/60/16/1000和Python12，退出0、零跳过。随后依据原PM2源码加入历史重启计数兼容：f69fd8先退出1，03cbcc 3/3通过，允许历史非零但拒绝采集中改变并返回restartCount供后续基线比较；不是证明无重启。最终Linux/ops待续记。无生产/PayPal/数据库/密钥变更；整项发布仍未通过。

## 2026-09-30 JST（09-29 21:18Z）：临时双服务停止的产品执行闭环

原site→原observer/controller→原journal意图→默认固定数字ID PM2停止→独立进程快照确认→原journal确认，按VNC/headed顺序接通。保留注册和无关进程，不重建框架；原永久退役名单不变。原声明必须匹配新鲜完整树和配置，残留/重新托管/回生进程、丢应答、来源或配置变化、未知写入者和截止时间失败均不继续下一服务、不自动重试。

真实Linux物理8739退出0，原控制器和默认PM2执行器实际停止两个夹具服务，procfs独立确认VNC两个合成服务及真实fork handler、headed名合成sleep退出；无关进程和合成profile保留。远端主机/来源/工作事实合成，不是Brave恢复或生产发布通过。日志`/private/tmp/holaday-cloud-controller-final-physical-20260930.log`。新增已有PM2目录拒绝反例b9399d退出0（内部夹具预期退出1/EEXIST），确认任何PM2启动、VNC脚本创建前拒绝，日志`/private/tmp/holaday-cloud-controller-namespace-refusal-20260930.log`。全部新容器privatePID/断网/有限资源/只读脚本与公开缓存，无生产凭据或宿主状态挂载。

物理58451和诊断93880退出1揭示正常PM2停止改变status/exit_code：原完整摘要不能直接要求相同。新增仅为固定云服务提供的stopConfigDigest覆盖其他全部启动配置；原完整摘要和保护review不改，只在原绑定摘要相同及真实停后状态证明成立后解释本次克隆比较视图。配置与停后形状反例566c8e/12e0a0先失败后通过；漂移测试包含环境、未知字段、启动参数和重启计数。初次安全拒绝均未执行，补齐独占性证明及字段不变证据后获准，不绕过限制。

最终Linux37252五模块543/543退出0、零跳过，日志`/private/tmp/holaday-cloud-controller-final-linux-20260930.log`。此前38038为541通过/2失败/0跳过：旧publication夹具要求非零应用组而容器GID为0；最终root UID/GID998满足原约束，无生产规则改动或跳过。更早283/283、25/25只作中间记录，不重复累计。恢复事件仍被真实observer拒绝，生产execute/open门槛未解除。

原完整ops9511退出0：Node120/60/16/995及Python12全部通过、零跳过，使用已有age工具，日志`/private/tmp/holaday-cloud-controller-ops-20260930.log`。八个JS文件最终Biome527644、diff-check退出0；所有测试会话结束。未重跑完整数据库物理链或浏览器前端，尚未整分支独立审查、push/PR/合并/部署。

## 2026-09-30 JST（09-29 20:17Z）：临时云服务声明、原journal与open前拒绝

两服务声明由原保护读取器/site绑定到同一个真实journal：固定VNC/headed顺序、唯一数字ID、范围和恢复摘要，headed绑定已打包恢复材料。按序记录停止/恢复意图和确认；声明后不能漏做、重复或换对象。原host在beforeOpen和实际open命令之前拒绝恢复未确认，避免“先open再写opened”以及前置失败误走丢应答核对。合成外部事实的原host+真实journal组合覆盖恢复前缀0至4，前四种无open，完整确认沿原尾段成功；不声称真实两服务恢复已执行。

所有新增主行为均先RED：缺失接口/声明丢失/错误接受、异步绑定漂移、opened时才拒绝、错误被当丢应答。最终真实Linux四模块255/255退出0零跳过，日志`/private/tmp/holaday-cloud-maintenance-journal-final-linux-20260930.log`。Linux私有PID、无网络、1CPU/512MiB/128pids、只读代码，无生产凭据或数据库挂载。不重复上一轮实际Brave实验，不把事件数量当物理证明；真实执行器及observer接线、完整恢复/分支审查仍未完成，CLI关闭。

原ops46231退出0：Node120/60/16/970和Python12均通过、零跳过，使用既有age测试工具；日志`/private/tmp/holaday-cloud-maintenance-journal-ops-20260930.log`。八JS文件Biome和diff-check通过，所有测试进程结束，原MySQL/Redis健康、无QA容器遗留。没有生产或支付调用，无push/PR/合并/部署。

## 2026-09-30 JST（09-29 19:16Z）：产品恢复材料与真实夹具共用

已有runtime导出固定恢复材料；原保护读取器/site校验其摘要并由既有完整site摘要绑定原journal。物理夹具使用同一产品函数与固定合成profile/显示/端口，未另造QA命令。新增拒绝任意路径/命令/自动重启、错误摘要及非法字段测试；初始RED退出1，相关本机158/158退出0零跳过。七个触及JS文件Biome及diff-check通过。

实际Linux原镜像、无网络、私有PID、1CPU/768MiB/256pids、公开缓存及代码只读挂载：33130成功模式退出0，73827无SYS_ADMIN拒绝模式退出0；后者恢复命令实际退出1且不重启、不回退。成功模式真实PM2停止前后各9个浏览器进程退出，旧target正对照成立，产品恢复后无旧target/HTTP动作；原合成profile哨兵/持久cookie/父策略和无关应用/显示保持，私有只读挂载及零能力实际观察通过。日志`/private/tmp/holaday-cloud-launch-product-{final,denied}-20260930.log`。准备失败96683/21435以及夹具旧显示号失败67021退出1均保留，不算产品通过；最终使用原有离线解包流程。

最终Linux四模块196/196退出0零跳过；原ops启用现有age后退出0，Node120/60/16/958与Python12均通过、零跳过。日志`/private/tmp/holaday-cloud-launch-linux-unit-20260930.log`和`/private/tmp/holaday-cloud-launch-ops-20260930.log`。QA容器均已退出，原MySQL/Redis健康；没有新数据库/卷、生产凭据挂载或商户调用。未重跑完整数据库物理链或整分支独立审查。

这不是两云服务生产控制器、任意后台不重放或完整发布通过。尚需独立工具/策略字节、真实独占事实、停止/恢复执行及整条发布验收；不重新解释历史组件数为本次上线成功，CLI仍关闭。

## 2026-09-30 18:15Z heartbeat：现场配置固定到原journal

原site→journal现已单次绑定完整受保护配置摘要，必须在preflight、任何接收器连接前持久化；首次审阅到连接之间、重复审阅和后续guard不能更换配置。已绑定attempt不能由另一site重接，失败不自动重试。初始3项RED退出1，实现后本机site/journal129/129及host/receiver110/110退出0。加入配置绑定竞态与双次审阅漂移反例后，真实Linux三模块223/223退出0、零跳过；原实际PM2/pidfd停止组合退出0。日志`/private/tmp/holaday-site-binding-linux-{unit,physical}-20260930.log`。原镜像、私有PID/network none、受限资源，仅挂载只读代码，无生产配置或凭据。

扩大回归首次退出1（10项本机监听EPERM）；正常权限审批后原迁移门禁退出0：Node922通过/34跳过/0失败，Python12通过，日志`/private/tmp/holaday-site-binding-regression-approved-20260930.log`。34个未配置age工具的用例未验收，不写成零跳过，也不重用历史通过数；本轮Linux改动模块和原停止组合均实际执行。Biome/语法/diff-check通过。这里只完成配置与日志接线，不证明云浏览器/VNC实际恢复、独立生产facts、真实停写备份/Mac恢复或发布门禁通过；CLI仍关闭，未部署，自动化不变。

## 2026-09-30 同轮收口：恢复拒绝与真实范围观察

最终原夹具25612串行成功/拒绝模式均退出0、无跳过；拒绝模式的真实恢复仍然退出1，PM2 restart=0、单次unshare错误，无回退浏览器/CDP/旧HTTP动作，无关应用及独立显示保持。临时移除禁重启选项的有效变异65506退出1；最初变异副本语法错误不算反例。额外真实无profile参数子进程46810先RED，补完整PPID闭包和已退休身份复核后同一最终运行GREEN；此前只查profile参数的9进程证据不扩大成完整后代证明。最终日志`/private/tmp/holaday-browser-tree-final-{denied,success}-20260930.log`；Biome/Node语法/diff-check退出0，原ops未重复计数。

只读71845退出0：UTC17:56:51.435Z服务身份稳定，显示11连接均归属批准两服务，隔离启动工具文件身份/版本已观察。未执行生产挂载/停止/恢复，不能用作过期窗口证明。初次SSH认证失败系临时脚本未加载原凭据；使用既有部署加载器后已解除，未换密钥/通道或输出密码。详细证据、无效初次结果与下一步见checkpoint最新段。受保护恢复配置/journal仍未接通，CLI关闭，整项未完成、未上线。

## 2026-09-30 同轮续跑：PM2停止后的限定策略恢复已实际验证

原夹具`--scoped-pm2`模式21620 RED退出1后，8020物理GREEN退出0：真实PM2 6.0.14、独立QA daemon，旧实例autorestart=true；两次精确数字ID停止各核清9个真实profile进程均退出，无关应用和独立Xvfb保留。恢复实例使用私有只读策略/全能力清零且autorestart=false；旧target正对照存在，而恢复后旧target/HTTP增量为零，原profile哨兵/持久cookie/用户偏好/父策略保留，会话cookie中断按既有批准接受。新QA恢复配置不是生产配置已绑定，未执行不安全原启动脚本。

这补齐下方仅CDP clean-close的限制，但不证明生产VNC/共享显示、受保护journal或任意后台不重放。原ops63072退出0（120/60/16/951+Python12，零跳过），物理夹具独立于ops计数。日志`/private/tmp/holaday-browser-pm2-recovery-{red,green,ops}-20260930.log`；精确容器已移除、原DB/Redis健康。未重跑完整DB链或冒用旧browser计数，未触碰生产。后续仍需精确范围及恢复配置绑定、独立现场facts、真实恢复和整分支验收；CLI关闭。

## 2026-09-30 JST（09-29 17:14Z）：进程私有浏览器策略路径通过，尚未接入生产恢复

原真实Brave夹具增加scoped模式：62194先因旧target恢复RED退出1；私有mount namespace/只读策略/启动前能力全部清零实现后76839和最终89707退出0。父namespace策略不变、原用户启动偏好不变、独立Xvfb存活、原合成profile哨兵/持久cookie保留，创建blank后无旧target/旧HTTP增量。按既有授权接受会话cookie中断，没有关闭Brave隐私特性，历史失败模式不改。去掉容器SYS_ADMIN的57738明确拒绝、退出1，不回退、不重试；不是该负向测试“通过启动”。所有精确QA容器已自动移除，原DB/Redis健康，没有生产或全机策略变更。

这只验证限定策略恢复机制，不是受保护PM2/journal/现场清单已接通，不证明任意后台任务不会重放。继续原入口接线和共享显示归属门槛，不新增发布平台或重跑历史完整链凑通过数。ops93937退出0：Node120/60/16/951、Python12，零跳过；夹具Biome/Node语法/diff-check退出0。原1120等计数只属上一轮。所有作业已结束，详细日志、范围和下一步见checkpoint。

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
