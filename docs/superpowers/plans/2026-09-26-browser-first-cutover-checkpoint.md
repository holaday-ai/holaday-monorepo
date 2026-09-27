# 首次切换实施断点：真实文件安装与站点隔离已验证，Task 4 整流程接线未完成

日期：2026-09-26（Asia/Tokyo）。本地实施中，未部署。

最新授权：2026-09-26 用户表示“我要出去一下 你自行安排任务 允许期间的所有操作 包含PR 部署 验证”。当前浏览器上线大项允许自主实施、PR、必要合并、部署与验证；下方历史“仅本地/未授权部署”限制已被本次授权取代。授权不等于验收通过；必须完成剩余真实接线、恢复演练与发布门槛，不得修改历史业务记录来伪造通过。

## 最新恢复点（优先于下方历史段落）

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
