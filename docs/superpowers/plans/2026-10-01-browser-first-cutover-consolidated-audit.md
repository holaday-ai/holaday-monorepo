当前完整逐场账与私有持久证据指针：[续跑矩阵机器账](2026-10-02-browser-first-cutover-resumed-matrix-evidence.json)。最后所有本例数据库均stopped/OOMfalse，角色均无残留；不再运行重型。

## 当前集中修复与验收恢复点 / 2026-10-02

固定九场真实隔离host矩阵9/9通过；末场late-known-effect新鲜QA修正版exit0/768.79s，实际观察与内层拒绝标记各一次，原hold/双入口拒绝/锁保留/效果单次断言通过。

已通过before-migration、after-start、before-open、after-open、after-ingress、after-worker、lost-open-ack、enabled-worker、late-known-effect，每场独立fresh pair、真实命令/exit0、原尾部断言、精确资源清理/无残留均分列机器账。不同源码冻结版本通过诊断与QA-only轻量合同桥接，不冒称一次同源整场全通过。当前机器账 `2026-10-02-browser-first-cutover-resumed-matrix-evidence.json`；最终51源码冻结见 `2026-10-02-browser-first-cutover-source-freeze-late-known-qa.json`。

历史LOCAL_ENTRY、RECOVERY_SITE_SOURCE、FENCE_PORTS_AFTER及更早attach/fences拒绝根因仍未证明。固定原因诊断只是补齐观测，后续成功不能证明这些根因已修。after-worker 734.55s场已到指定注入，但尾部读错Aliyun dump，QA修正两份批准Vultr文件映射后744.83s场整体0；late-known-effect 773.84s场实际SITE码与QA内部KNOWN期望冲突，真实site/journal合同证明原边界归一化且不重放，新增固定发现/拒绝标记后只重验该场。全部原exit1保留。

源码HEAD `fa443fe092dd106e7612186e7038c070e5035765`，草稿PR238保持；继承候选范围不隐藏。当前未提交脚本修正与QA应用candidate `b43dd03132658d9c13875f050e2c27e584b61e33`、QA旧source `434f1b1666d02ebda444a2c3ff78e679e549a35f` 分别绑定。root已独立审本批接口/期限/失败收尾/诊断及逐场结果，继承651文件未逐行全审仍为审查范围限制。

普通应用506非PayPal文件8584通过/1原helper跳过、cn-payment103、类型/build/ordinary7/真实opt-in MySQL3、两角色原生前置与恢复及脚本2013总1979通过/34条件跳过+独立age35均复用原实际账，未重跑。非PayPalops按原exit1与16-name补跑分列，不冒称整条exit0；PayPal全部延期。当前重型唯一串行，CPU1、编译2GiB/180s→host768MiB/900s，整个续跑固定累计swap基线3473.62MiB、free<35%或累计增>256MiB只取消本方，不逐场重置。

本项范围是原§8固定首次切换验收与开放后最小浏览器执行探针。完整任务路由、多页/上传/Canvas/受控池扩建和广泛成功率不新增为本次门槛。QA成功仍采用显式业务facts，默认production-facts实际SQL实现+合成后端/签名响应组合不等于生产provider整项证明。

生产放行尚需最终真实工作/写入归属、非延期支付恢复材料及同候选/配置/清单/商户/代码/期限绑定、同次生产停写后备份恢复、新鲜批准/来源/锁/窗口。用户必要交付授权持续有效，不重复索要泛化授权；授权不是这些事实。九笔历史支付宝单独延期、PayPal全部延期、四笔历史微信签名核查已完成；本轮不重复旧核查，最终窗口按默认范围执行必要新鲜只读观察。微信历史查询文档及普通/partner幂等合同可复用为分层依据，但原两份provider-results与旧专项日志当前缺失，未找到已知持久副本；不能把历史文字/合同填成受保护恢复artifact。支持retry-proven或query-and-existing-settlement-proven，不强加新付款或单一重投。确切缺少原文/恢复与对应结算及不重复权益材料，详见payment-evidence当前节。

以下dated记录为历史，不覆盖本节当前状态。

# 2026-10-01 统一发布链路审计与修复账

## 当前冻结交付 / 2026-10-01

代码集中实现完成，生产验收仍未满足。原树HEAD/QA应用candidate `b43dd031`；最终协调器/测试/QA源码逐文件SHA见 `2026-10-01-browser-first-cutover-source-freeze.json`，应用build不冒称本次dirty脚本提交验收。root接手统一review/commit/push/draft PR；尚未合并或部署。

真实隔离full-host成功场exit0/673s（QA业务facts），unknown/known原入口均exit0；最新真实物理retirement→site scope→recovery attach/inspect/close短链exit0/98.24s，无dump/迁移/候选。历史fullhost attach/两次fences拒绝根因未解释；本次未复现不能写作已修根因。

固定9场 before-migration/after-start/before-open/after-open/after-ingress/after-worker/lost-open-ack/enabled-worker/late-known-effect **均未取得最终完整故障验收**。before-migration早期真实注入已到达，但整场exit1来自QA闭句柄断言；另一场早于注入attach拒绝；最新777c场主动资源取消，功能未验收。QA尾部schema1/2可选candidate事件已按真实journal返回修正并补2条真实reader回归。所有旧attempt/卷/日志保留，不重放。

本次新重型已暂停：宿主Docker约9GiB驻留及累计swap约3.7GiB风险下主动停止精确本方role和两个DB，未证明OOM根因，非权限拒绝；用户mysql/redis与未知进程未动。无重型仍在跑。下一恢复先核对宿主/Docker资源与累计swap趋势，再以新fresh pair/预设窗口按固定9场串行继续；普通CPU1/512MiB，host768MiB/900s，编译2GiB/180s，pressure/swap取消阈值保留，不重跑已通过正常应用/原生验证。

普通应用8584pass/1helper skip、cn-payment103、类型/build/ordinary7/MySQL3及原生两角色均已有独立账；脚本2013总1979pass34条件skip+独立age35，非PayPalops组合证据保持原整条exit1。最终受影响轻量7合同exit0；40个触及JS格式/语法、5个Python无pycache语法、3个bash -n、diffcheck均0。完整命令/日志SHA见evidence。

生产外部工作/非PayPal恢复和重复权益、默认production facts整项、完整浏览器路由/成功率、真实批准/来源/锁/新鲜窗口仍缺；PayPal全部延期。既有必要交付授权有效，但授权不是现场事实或放行证据。

下文保留历史dated记录；旧运行/硬拒绝/计数不是当前结论。



## 当前结论：代码集中接通，生产仍blocked

本批HEAD/QA应用candidate为 `b43dd031`，协调器/fixture是未提交独立源码包。证据以 [机器账](2026-10-01-browser-first-cutover-evidence.json)、[应用完整文件账](2026-10-01-browser-first-cutover-application-coverage.json) 和 [可复现QA入口](2026-10-01-browser-first-cutover-qa-reproduction.md) 为准；各次运行不能相加成同一次端到端验收。

| 检查 | 本次实际结论 | 层级/限制 |
|---|---|---|
| 双角色默认原生前置/恢复/8事件 | exit0，真实Brave+x11vnc/Python与最小独有about:blank结果 | 隔离Linux，pyc真实缺席只读；非生产同次证明/完整任务路由 |
| 脚本统一回归 | 2013总/1979pass/0fail/34条件skip；独立age补跑35pass | 合同；保留初次skip和独立运行边界 |
| failure-tail/默认facts/probe/preflight | 315pass；新模块31pass；安全QA日志1pass | 真实journal合同；实际SQL实现+合成查询后端/签名SDK响应，非真实支付方 |
| 正常应用 | 非PayPal506文件8584pass/1原child-only helper skip；cn-payment103pass | 固定Node22.23.2；完整文件/CLI名称并集见机器账。已发生18个PayPal离线单元单列，不重跑 |
| 类型/build/普通维护/MySQL | cn-payment类型、orchestrator build/全量noEmit、ordinary7与MySQL3分别exit0 | 独立真实运行；资源失败历史保留；非整站release |
| nonPayPal ops | 原整条exit1保留；SSH环境修正后Python12/Node1340通过，17fixture缺项 | 原真实失败保留；明确16非PayPal补跑exit0，剩余PayPal1延期，未宣称整条exit0 |
| QA源准备 | 原61SQL当前基线90表/92对象、原行与trigger/event通过；原reader真实mysql2 exit0 | 不是旧schema升级证据；helper仅本例新空源，目标仍空 |
| 真实full-host整链 | fresh成功场exit0/约673s，真实新boot/open/nginx/reconcile/锁释放；unknown/known原入口分别exit0 | 原host/停止/备份/61SQL/open协议真实，业务facts为明确QA-only；不替代默认production facts整项 |
| 原Task6故障矩阵/生产 | [14类分层矩阵](2026-10-01-browser-first-cutover-failure-matrix.md)；9场固定故障/ACK/worker矩阵未完成，因累计宿主资源风险主动暂停，生产未执行 | 真实外部工作/非PayPal恢复/重复权益、新鲜批准/来源/锁/窗口未齐；PayPal全部延期 |

下面是历史dated过程；其中旧缺实现/旧not-run不代表当前代码状态。root已独立风险审查关键应用实现、接口和证据；继承651文件未逐行全审，root本批收口审查完成，继承651文件逐行全审限制保留。

## 历史过程与逐项审计

基线 b43dd031；原 Task4 BASE 844c2ced779fa360b62e2bfbdd87d4909d13b8a0。
工作树 browser-release-candidate；恢复草稿保留。原方案和已批准受控中断范围继续有效。

以下8组为启动本批时的已核实缺口基线；进度与最终证据以其后dated记录及覆盖清单为准。

| 组 | 已核实源码断点 / 修复位置 | 接受标准 | 现有证据 / 本次验证 | 真正现场条件 |
|---|---|---|---|---|
| 1 | runtime OldBrowserAssociations 返回事实未接 host/inventory；scopeDigest仅PPID；停止后filtered pair无法证明exec后退出 | 原审查已含成员，关联事实绑定原source/display/socket；停止前复核，不事后采纳；完整census证明原PID退出 | 草稿34定向、七模块1460为历史组件；需新增跨层及PID exec反例 | 新鲜旧源、完整review及同次关联事实 |
| 2 | u_seq草稿实现兼容已在runtime，fixture追加待跑 | 保留双端kind一致并入摘要；联合native实测 | 34/1460历史，通过不等于新包通过 | 原生Brave/PM2版本及加载材料 |
| 3 | evidence readHostProcesses掩盖ENOENT类别；Census两遍完全等且display/association再比较整机census；全机读取叠加多次 | 有限只读完整重采，绝不从失败采样删进程或伪造零；身份漂移/权限错误继续拒绝，预算/时钟不重置 | 新增瞬时ENOENT重采、持续churn、身份/权限失败测试；原full现场display拒绝 | 能在预算内取得真实完整事实；未知写入者仍分类阻断 |
| 4 | host restoreCloudServices在vacancy后无条件hardthrow；runtime两角色启动和native readers存在 | 两角色加载/动态源码/能力/私有policy材料在intent5前真实验证；不能用boolean或删守卫替代 | 原context/source/vacancy组件、真实joint历史；新完整前置和host验收未运行 | 独立native可执行能力和加载证明 |
| 5 | inventory events>4；bindCloudRows只原online/stopped且restartCount冻结；site入口恢复要求ACK8；journal已支持8 | 同journal intent5→一次headed→原生/有限配置→ACK6→intent7→一次VNC→原生/有限配置→ACK8；丢ACK不重放；各消费者接通 | 新增有序消费、漂移、丢ACK矩阵 | 真实恢复树/配置、scope/window/fences/work持续绑定 |
| 6 | site强制注入readCoordinatorIdentity及facts四方法；host与shell拒绝execute；identity仅--check；facts.observeWriters与DB归属不能从空事务代填零 | 受保护清单/固定通道/同次锁与窗口接原site；独立facts完整组装；check无副作用 | 已存在persisted/admin/payment/backup真实readers；完整默认facts尚缺 | 已知外部工作及支付覆盖证据不能由代码凭空创建 |
| 7 | 原Task4–6完整演练/备份Mac/61SQL/支付/故障矩阵及正常回归未齐 | 实际命令/退出码/源码摘要；synthetic/native/真实生产证据分列；不跳过可隔离部分 | 历史组件不可等价本次整包验收 | 生产停写加密备份及Mac目标；非PayPal真实签名恢复/重投重复权益；新鲜批准窗口 |
| 8 | 忽略native缓存丢失、准备入口不可复现；candidate-selection及deployment账陈旧 | 跟踪最小准备验证入口/版本/hash；保留原候选来源及草稿；仅明确文件提交 | 本次脚本/证据待建立；Docker QA镜像sha ff58ba97…可用 | 主代理最终独立整分支审查，之后真实发布放行 |

补充接口核对：
- journal阶段已阻止all_fenced前少ACK4、opened前少ACK8；应复用，不新建日志。
- site readRecoveryFacts特意避免普通boundary递归；恢复中prefix5/7必须由专用消费者处理。
- sourceGate仍用原PM2字段，恢复后源码来源不应改成当前新argv自证；原source绑定保留。
- inventory review clone允许已证明停止的精确删行；恢复新树只能在原角色scope及native proof内有限纳入，绝不能接受未知新writer。
- 执行入口不能早于facts及恢复消费者完整接通；缺外部证据时应具体失败，不仅删除execute拒绝。
- host afterOpen核对和site reconcile尚需独立业务事实；不能自行settle旧业务或支付。

状态：统一审计完成；集中实现及验证进行中。PayPal延期，不改SQL、结算、历史数据、密钥；不恢复自动化、不创建代理/分支/工作树。最终独立审查由主代理执行。

本次代码进展：ENOENT整份重采20项通过；旧关联scope和完整退出账已接host/inventory。完整退出读取在恢复stopped baseline再次执行，原恢复测试调用次数及拒绝位置按真实顺序修正，13项相关测试通过。


## 集中包验证更新（2026-10-01，未完成发布验收）

组1–6代码断点已统一接通：原关联scope/full census退出、u_seq、有限ENOENT重采、双角色真实私有namespace前置、原8事件消费者与未知/丢ACK拒绝、默认facts/CLI/固定来源接线。阶段整包另修正afterOpen→resumeWorker→owned reconciled读取→finish/detach；效果维持原维护截止，只读晚期严格绑定原reconcileByMs/同候选/owned journal。支付采样上界为min(原维护截止,实际采样时点)，不虚构opened时间；已开放后的合法新工作不作为旧遗留全库零值门。

新增默认facts逐项按真实reader形状对齐；前fence行政非零是真实观察，停写由原阶段门执行。默认site+实际SQL最小隔离后端涵盖维护截止前后，两端真实receipts晚读/晚effect拒绝，实际签名query组合与未知detach/ACK路径均通过。完整host隔离演练的业务facts仍为明确QA替身，不等于生产默认facts端到端验收。

- 当前统一Linux脚本：2013总，1979过，0失败，34 age opt-in跳过；日志 /private/tmp/holaday-consolidated-final-unit-results.log。
- 明确/usr/bin/age补跑：35/35，0跳过；日志 /private/tmp/holaday-consolidated-age-results.log。闭合上述34项，不重跑整包。
- 真正native整链退出0：/private/tmp/holaday-native-both-role-final.log；新增readFirstCutoverCloudNativePreflight双角色实际1465ms通过且在intent前，真实headed/35s稳定/本次自建about:blank执行与关闭/VNC实际RFB/35s稳定/原8事件全部通过。镜像sha256:9e621ebc26bb61a71c514889adfd297c8286db70f8d95d66460ce6c942f500f3。QA缓存始终真实只读缺席，符合原可选cache契约；未复制生产pyc，不声称逐字节生产缓存复刻。此native证明无candidate open。
- 仅触及JS Biome格式、node --check、三Python py_compile（缓存另置tmp）、git diff --check已过；最后新增QA路径调整须最终再查。
- 冻结锁文件Linux依赖离线恢复退出0：/private/tmp/holaday-offline-install.log；可复用 /private/tmp/holaday-full-host-workspace，依赖链接仅指自身；缓存 /private/tmp/holaday-full-host-cache-mhrl_6u2。普通重型始终512MiB/CPU1/heap192，首次1GiB准备被明确归属停止且记录，非OOM，不再提限。
- 61原迁移runtime打包退出0：/private/tmp/holaday-runtime-output/holaday-recovery-pack-CL9jEt，runtimeDigest b6853507198b46b5f9ca808b9b23625ac5dc00e9f6dfb33b60d4d9be3988deeb，migrationDigest dd989a28fd9728b2f3f68bac80a29576b28cfa5863b7dc1641f72914c60fdb42。

组7完整host成功/故障隔离路径仍在执行，未标通过。Task6 cn-payment/orchestrator单worker test/typecheck/build、ordinary-maintenance integration、非PayPal ops、opt-in MySQL尚须账列实际结果，不能以脚本数替代。根test:ops含PayPal，按用户延期不整条执行。真实停写备份、真实支付重投/重复权益、浏览器任务成功率及新鲜发布窗口仍为整项验收外部条件。


### 正常回归与整项harness当前实测（仍未完成）

cn-payment实际单worker/禁fileParallelism回归8文件103项全过，CPU1/512MiB/heap192；日志 /private/tmp/holaday-cn-payment-test.log，state另存。原候选+同冻结锁Linux依赖，没有借用主repo源码或测试结果。

完整host QA真实推进过隔离目标检查、固定依赖安装、原stageReleaseCandidate git clone/fetch/父版本祖先验证和真实orchestrator build，尚未到完整backup/migration/open成功。环境预检修正QA-only PATH含sbin、Node root归属、volume mount（无HostConfig.Binds）、MySQL默认event_scheduler=ON改本次空容器启动OFF；源QA必须与候选不同，真实source434f1b1666d02ebda444a2c3ff78e679e549a35f→candidate b43dd031，仅审计文档差异。所有拒绝守卫保留；每次进入harness均新鲜独立attempt，未在失败恢复目标上重放恢复/迁移。旧本方闲置DB已核实attempt/ID/镜像后停止，卷保留。

build实际诊断：192堆、256堆（容器均512MiB）均V8堆上限exit134；正常host净化为MAINTENANCE_COMMAND_FAILED，未把无细节拒绝冒称已验收。主代理基于实时内存余量批准一次硬1GiB/heap768/CPU1/180秒：33秒仍exit134，OOMKilled=false，采样进程RSS最大971224KiB；证据 /private/tmp/holaday-orchestrator-build-budget.log 和 -state.json。未未经复核自动提限。新的2GiB/heap1536一次预算已被主代理据最新实测批准，要求free<35%或本次swap增加>256MiB立即只停止本方容器；此刻尚未执行，不能记通过。

Linux正常orchestrator全套发生现有native用例/usr/bin/clang缺席（原用例Darwin -bundle/-undefined dynamic_lookup与固定headers）。有多组真实PASS但测试完成停止推进，按主代理指示核实本方label/ID/镜像停止，记录取消/未完成而非全量通过；日志 /private/tmp/holaday-orchestrator-test.log 与 -cancel-reason.json。后续必须按平台拆分，不能改断言凑Linux通过。Mac物理候选归档+同锁依赖副本建立，3544 symlink全在QA树内，.bin主repo绝对路径已换为QA，无借用主repo源码。现成Node25.6/headers25.6/clang用于Mac native回归，版本差异须独立标注；该测试此刻实际运行中，未记通过。未修改/usr/local或用户浏览器。

### 2026-10-01 正确解释器与真实host新结果

- 官方固定Mac Node22.23.2，独立候选 `b43dd03132658d9c13875f050e2c27e584b61e33` 的 browser-pool 全23文件401测试通过，exit0/201.83s/peak RSS332768KiB/零跳过。命令：`python3 /private/tmp/holaday-mac-node22-full-native.py`（单worker、heap256、UV1、V8pool1、600秒、进程组RSS512MiB）。日志 `/private/tmp/holaday-mac-node22-full-native.log` SHA256 `015e5626759dd714286e5590f674989fc8b9f7f6cccad91faa48857c79b5fa5a`；receipt `/private/tmp/holaday-mac-node22-full-native-receipt.json`。现有 `/usr/local/include/node` 为Node25 NAPI头文件，未修改系统路径。原Node25的394过/7失败为不受支持解释器负例，不能与本次拼接。
- QA nginx helper漏传原reconcileByMs已修；生产两端输入、attach输出与固定protected scope均已复核携带该字段。新鲜attempt `28244103-8d14-441c-8f5e-4e0954f865db` 实际通过attach、停写/启动源退役持久事件、实际导出加密hash及Mac隔离恢复，最终backup-compare外层 `CUTOVER_SITE_UNPROVEN`，exit1约359秒。不能据外层码断言数据差异；尚未迁移/启动新候选/open。日志 `/private/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/holaday-recovery-target-YEtHBy/coordinator-diagnostic.log` SHA256 `e81c6e5ad969071ed18dc28e61170b0f18584649e47dba16e7fb3ec29369e7f1`。
- 此attempt实际编译通过后cgroup从2147483648降至536870912，OOMKilled=false，host free59–63%，swap无增加。RSS采样旧版本Docker top缺PID列而无值，如实保留；已按实际pid,rss格式修下一次runner，未为采样重跑。监控任意异常统一清理本次进程组并留runnerError/cleanupError失败回执。两台闲置QA DB按ID/attempt/镜像验证已停止，卷保留。
- 普通orchestrator真实vitest配置文件集合共507，其中上述原生23及普通484分13批，每批600秒；清单 `/private/tmp/holaday-mac-node22-test-file-coverage.json`，普通结果继续逐批收录，不将未执行或中止计为通过。

### 2026-10-01 应用覆盖与失败收尾更新

- 正确 Node22.23.2 的原配置507文件覆盖已收齐：非PayPal506文件8584通过、1个仅由父用例调用的子进程专用配置跳过；已发生的PayPal单文件18项仅离线单元，未访问外部且不重跑。仓内精确文件、日志SHA、CLI选中名称覆盖账为 `2026-10-01-browser-first-cutover-application-coverage.json`。资源中止批次未充作通过；4项 TypeScript 编译型审计独立受控预算，CLI10个名称按5组串行全部通过。
- failure-tail 整包正常审核落盘：原绑定 recovery 单次 detach 在业务失败后仍核对原scope、ownership、stopped及不可变恢复锚点；只豁免已校验的failureObservation及派生digest。第二hold仅读取本次已持久同一失败记录，不覆盖、不重发效果；记录缺失/漂移拒绝，失去detach ACK不重试，第二finish保持原锁。一般journal守卫与恢复/迁移重放禁令未放宽。
- 实际命令 `python3 /private/tmp/holaday-tail-contracts-run.py`，固定QA镜像36e1b694…、CPU1/512MiB/heap192、Node22.23.2，site/host/recovery-session/journal/release-tail 五文件315/315通过，exit0、零跳过；日志 `/private/tmp/holaday-tail-contracts-stage-final.log`，receipt `/private/tmp/holaday-tail-contracts-stage-final-receipt.json`。新增QA-only诊断只输出固定阶段和错误码，不输出数据库行值。
- 新fresh host总预算在开始前设900秒，compile180秒/2GiB后降512MiB；当前正在执行，不能记作成功。typecheck、ordinary-maintenance integration、opt-in MySQL及非PayPal ops仍待串行完成。
