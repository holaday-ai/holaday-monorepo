## 当前微信既有completed内部no-op已验证 / 2026-10-02

session47822实际exit0；`holaday-wechat-existing-completed-noop-v3-result.json` SHA256 `a5eedfd4c692e6430a70a50298ffd200c5fa1e9639bd5dbc230a8a16e0280925`。只发送一次既有微信完成记录的内部确认：confirmCalls=1，HTTP200/ok=true/deduped=true，reviewRequired=false/retained=false；确认前后payment、user完整行及全部quota行仅在内存比较完全不变（私有回执记录安全HMAC/权益字段），internalNoopProven=true。未访问provider、未新付款、未重投延期支付宝、未改历史记录；禁止重发本次请求，远端固定operation `wechat-existing-completed-20261002-noop-01` 的单次intent/回执保留。

先前v2 session15499实际exit1、confirmCalls=0，在LOADED_SOURCE_BINDING拒绝，未连接DB/创建远端intent/发HTTP：worker三份dist磁盘时间晚于worker启动，不能冒称其为已加载版本。v3明确loadedScope仅main，workerLoadedUnproven=true；已绑定主进程PID1176716/start574742934及实际http/env/DB/schema/logger源码，worker保持进程身份观察，未宣称worker磁盘代码已加载。worker或其它并发业务变化若影响精确目标全行会使快照不一致并拒绝成功。本次局部范围不放行浏览器整项。

独立logger补丁及既有9/9隔离矩阵不重做。本轮14份明确证据及manifest共15个文件已持久保存于 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/wechat-existing-completed-noop-20261002/`，root已独立核验0700目录、0600文件和全部摘要；manifest SHA256 `62f6013fb335aa2b0eb39db53b5308d2720bdc14207bb70e7efa7c33c6e11b45`。原失败attempt、payload、wrapper、result、stderr、本地独占intent均不覆盖。

本次补齐的是这条已完成微信结算的真实重复内部确认不重复权益/额度证据，可成为原query-and-existing-settlement-proven的settlement/transcript材料一部分；不是支付方通知重试、provider查询或gateway整体恢复实证。仍缺原恢复包中可重验的真实provider query及恢复transcript与当前候选/config/inventory、merchant/environment/code、原reconcile期限的绑定；支付宝对应实际恢复材料未齐，completed=0不新增付款门槛。默认facts仍要求受保护rehearsal清单及各商户transcriptDigest/queryDigest/settlementDigest（或retry路径），不能用本次微信一条记录替代支付宝或全清单。

旧明确原文路径仍是 `/private/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/holaday-wechat-readonly-6IIU4v/provider-results.json`、同父目录 `holaday-wechat-readonly-BpLN76/provider-results.json`，以及 `/tmp/holaday-wechat-closed-settlement-final.log`、`/tmp/holaday-cutover-payment-idempotency.log`；前轮已核这些原文缺失，不重复广扫。指定 `/var/lib/holaday-deploy/evidence-private` 前轮ENOENT只证明该精确目录缺席，不称所有来源穷尽。后续原授权的新鲜精确provider只读观察与材料组装需按真实范围审查，不重查密钥/商户、不制造历史写入或虚假时间。PR238仍draft未合并，整browser未部署，recoveryProven=false、releaseAcceptance=false。下方为历史恢复点，以本节为当前状态。

## 当前独立logger补丁已部署验收 / 2026-10-02

用户明确批准本次精确顺序例外：先独立发布 `7b53058d` 最小脱敏补丁并受控重启旧主服务一次，再继续支付恢复验证；这不批准整browser候选提前部署或跳过其余门槛。实际效果session93862只执行一次stop与一次start，两RPC ACK均true，logger已替换为SHA256 `6267b11797b532cfa6469e977c53bf894d834dd1a360af92ddee0d7e07f59451`。新主进程PID1176716/start574742934、UID998、原TSX入口与cmd摘要不变；4001归属该主进程且health200，worker及其他四个共享进程身份保持。发布与观察工具未直接执行业务写SQL，未调用confirm/provider。

原效果器exit1停在NEW_IDENTITY：合并配置摘要由旧c9f773变为b51093，不能仅凭该拒绝声称发布失败或配置值改变。后置session17126实际完成源码10/config3/Git同107857fe且仅logger脏/共享身份/端口归属及一次非秘密header日志探针；唯一对应请求已脱敏为[Redacted]且fake值不在该行。session79138的实际PM2 fclone见证全部九字段及env深度相等，复制后摘要精确复原旧c9f773，只有env键枚举顺序不同；root组合审查确认独立补丁验收成立。后置结果SHA256 `79e7efb7173bbebe74aedb6c8f273fe880698ab2f7bd4964336184a307281719`，clone结果SHA256 `8ce4fc2941b7d8952749dd051e40e32999f5b59b39cf9492b4d433fd6f042b72`。旧零副作用失败及实际stop/start后的raw失败回执均保留，不改写退出码，不重复重启或日志探针。

本轮明确私有证据存放于 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/logger-independent-release-20261002/`（不入Git）；远端唯一attempt `logger-redaction-3a0cc0c9affd4902878d80659c1ac9d9` 的旧文件备份与journal保留。旧9/9隔离矩阵仍仅是已记载源码的既有脚本验收，未重跑且不冒称当前完整应用验收。PR238仍draft、未合并，整browser候选未部署，`releaseAcceptance=false`。

下一步仅准备微信既有completed记录的精确单次内部幂等确认草稿，供root审查；新鲜完整body/记录及当前loaded源码绑定、确认前后支付/用户权益/额度一致须由本次执行独立证明。内部no-op不等同provider恢复能力或整项验收。支付宝真实恢复材料仍未齐，completed=0不是新增付款门槛；不触碰延期九笔支付宝、PayPal、新付款或密钥商户重复核查。下方原“未修logger/不得提前重启”状态保留为历史，已被本次明确例外与实测结果取代。

## 当前微信no-op前置与logger修复恢复点 / 2026-10-02

本轮session60614实际exit1，私有结果 `holaday-wechat-noop-readonly-preflight-result.json` SHA256 `702035c70f8cecb59b98cf96bc004fec6df6c3aadf7e3bae55e75bad91314c46`。部分只读前置取得19份文件，确证实际线上 `config/logger.ts` 缺少 `x-internal-secret` 脱敏；随后pino库读取在SOURCE_STAT拒绝，具体文件metadata原因尚未证明。完整前置未通过，尚未连接DB、调用confirm或provider，也未完成本轮精确body/实际loaded版本证明，不能把此前快照与本轮部分读取拼成完整成功。三份本轮payload/result/manifest已私有持久保存于 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/wechat-noop-preflight-20261002/`（0700/0600、hash核验）；旧15份支付观察证据保持。

候选最小logger修复已独立review并提交 `7b53058d`：仅 `apps/orchestrator/src/config/logger.ts` 新增一个敏感header脱敏项，以及现有 `logger.test.ts` 的真实HTTP日志断言。固定Node22.23.2、单worker、heap192、60秒/512MiB本方进程组预算下，RED为1项失败（fake共享header原值进入日志），GREEN为1项通过；GREEN实际0.66秒、峰值RSS160816KiB。两文件Biome和diffcheck通过。测试日志/回执 `/private/tmp/holaday-logger-{red,green}.log` 与对应 `-receipt.json` 已由root校验源码/日志摘要并私有持久保存；独立清单为 `holaday-logger-redaction-test-evidence-20261002.json`，上述qa/wechat-noop-preflight-20261002目录现为8份文件（原3份加测试4份及清单1份），0700/0600及hash均已核验。

旧9/9矩阵及既有应用验证仍是各自已记录源码的隔离证据；当前候选应用logger字节已改变，不再声称应用字节仍与b43基线完全相同，也不把旧结果称为本次全部应用重验。此次仅运行上述有意义的logger单文件RED/GREEN，不重跑旧矩阵或应用全套。

当前具体依赖冲突：已观察的liveconfirm请求先经过未修线上logger，敏感header可能进入请求日志，因此不能发送共享密钥。候选修复需由实际运行进程加载才生效；原spec第17/23/48行及prepare阶段readRehearsalArtifacts仍要求支付恢复前置，不允许为取得证明先跳过门槛补丁重启旧服务。当前原query-and-existing-settlement-proven路径尚未找到已审可替代微信入口或完整真实材料；这不是永久不可实现结论，后续应解决该具体顺序/材料问题，不能用跳过logger、改日志等级、直接调用handler或未审热修制造证明。支付宝completed=0仍不是新付款门槛，不新增付款或重投延期历史单。

PR238仍draft，未合并、未部署，releaseAcceptance=false；本轮无生产配置/业务写入、服务重启、provider或确认调用。下方保留各历史来源与状态，当前以本节为准。

## 当前生产只读观察恢复点 / 2026-10-02

源码交付仍为 `f52d3c4d1a43e5e9c5a7ddd6d270a53308a66886`，文档回执为 `7db9a7ae`；固定隔离矩阵9/9及85份验收证据不变。PR238仍draft，未合并、未部署；releaseAcceptance=false。旧权限等待已由本轮正常审批后的实际执行取代，不再作为当前阻塞。以下观察没有调用provider、confirm或写入业务，也没有重新核查商户/密钥。

| 实际session | exit | 结果与SHA256 |
| --- | --- | --- |
| 81691 | 1 | `holaday-payment-startup-readonly-result.json`：`65ad4566de3db19b72a8f291eb9e568652e497768264368fe82a885123227b1b`；PROCESS_SOURCE_SCOPE，未读源码/连接DB |
| 83860 | 0 | `holaday-payment-startup-readonly-fixed-startup-paths-result.json`：`dcc291aa39607b5526b07a3ede8941bf4cc065898dd791fc971bd707cf25d001`；两个实际角色、九份启动/应用源码 |
| 57043 | 1 | `holaday-payment-completed-readonly-result.json`：`0e789c09b064972a453976db89b3a00c74a6a738eb6ad7bda5cc20406d8fa7ce`；18份源码读取完成，声明配置路径symlink拒绝，DB未连接 |
| 2435 | 0 | `holaday-payment-completed-readonly-config-links-result.json`：`c4f895b71bee637481ed914992617bca149aa4f67e0036ae8c23059ab749d38e`；18份源码、声明配置稳定链接检查及数据库READ ONLY事务完成 |

最后快照：微信completed=1/pending=3，支付宝completed=0/pending=9；微信captureUnique及candidateFieldsPreliminary为true。计数9不证明与批准延期的九笔精确身份/字段集合匹配；初步字段检查不等于确认请求就绪。启动身份、源码磁盘摘要与配置来源前后稳定，不单独证明内存加载源码版本，也不证明候选已部署。

上述11份明确观察证据及manifest共12份私有文件已持久保存在本原树 `.superpowers/sdd/2026-09-25-browser-first-cutover-implementation/qa/payment-readonly-resume-20261002/`（父0700、文件0600、摘要核验、ignored）；清单为 `holaday-payment-readonly-resume-evidence-20261002.json`。结果原路径均为 `/private/tmp/` 下对应文件；私有原行/源码不加入Git。

尚未完成的是原要求的实际非PayPal恢复能力及对应既有结算、不重复权益证据：`retry-proven` 的真实transcript/retry材料，或 `query-and-existing-settlement-proven` 的真实transcript/query/settlement材料，并绑定候选、配置、清单及窗口。旧微信provider-results与幂等日志原文缺失仍保留历史结论，不能由新只读快照替代。原设计第68–70行仅延期九笔支付宝订单，未豁免恢复能力；非延期集合为空可据实记录，但空集合不证明恢复能力。支付宝completed=0不是新增付款门槛，不要求新付款或重投延期历史单。

微信已有完成记录提供进一步审查no-op的候选；执行前仍须独立绑定完整请求字段，确认实际加载源码及completed终态/删除竞态边界，并核对原完成分支前后支付、权益、额度不变。当前未执行确认，不将其记为恢复证明。最终新鲜发布窗口按默认精确范围做必要只读queryOrders、停写、备份及后续核对是既有授权步骤，不新增泛化授权要求。

指定恢复材料目录的补充观察：session90228实际exit1，结果 `holaday-payment-rehearsal-metadata-result.json` SHA256 `c4203f7c63fe8ac45fc58f591c86a4208b743643126620c61bdbb905b78c79bd`，固定原因DIRECTORY/ENOENT；生产 `/var/lib/holaday-deploy/evidence-private` 当时不存在，未读取任何artifact。这是实际执行结果，非权限拒绝；仅证明该精确目录缺席，不声称其它来源已穷尽。payload/result及独立supplemental manifest另存上述私有证据目录，合计15份，原12份清单不覆盖。原非PayPal实际恢复及结算/不重复权益材料缺口仍未完成；不增加“必须新付款”条件。

下方保留历史恢复点与历史结论；当前状态以本节为准。

当前完整逐场账与私有持久证据指针：[续跑矩阵机器账](2026-10-02-browser-first-cutover-resumed-matrix-evidence.json)。最后所有本例数据库均stopped/OOMfalse，角色均无残留；不再运行重型。

## 当前非PayPal恢复材料与历史证据可复用范围 / 2026-10-02

用户已允许九笔历史支付宝单独延期，PayPal全部延期；四笔历史微信签名查询已在2026-09-27完成，本轮不重复旧核查、不重新要求编号或重做商户/密钥核查；最终窗口按默认范围执行必要新鲜只读观察。历史结论保留：1笔SUCCESS对应已有完成记录、3笔CLOSED，未改订单/权益。该历史核查不自动等于本次切换恢复验收。

限定原文指针核对发现以下文件当前不存在：`holaday-wechat-readonly-6IIU4v/provider-results.json`（历史SHA663f52f8…）、`holaday-wechat-readonly-BpLN76/provider-results.json`（历史SHA4b447853…）、`/tmp/holaday-wechat-closed-settlement-final.log`、`/tmp/holaday-cutover-payment-idempotency.log`。本任务已知ignored QA文件名清单无wechat/rehearsal/settlement持久副本；不广扫凭据、不访问provider。历史文档可引用已完成结论，但不是可重验签名原文。既有应用完整回归可复用为结算/重复确认合同，不冒称生产实际恢复或对应权益变化实证。

默认reader `readCutoverRehearsalArtifacts` 要求root受保护`/var/lib/holaday-deploy/evidence-private/rehearsal-<configDigest>.json`及摘要命名JSON文件：retry-proven需transcriptDigest+retryDigest；query-and-existing-settlement-proven需transcriptDigest+queryDigest+settlementDigest。真实文件字节SHA须匹配，同candidate/config/inventory和merchant/environment/code绑定，recoveryUntilMs覆盖原reconcileByMs。不是强制新付款或支付方重投；已有真实查询+现有结算/重复权益证明齐全且期限适用时可以复用。当前缺的是可重验原始查询材料、实际恢复/已有结算对应及不重复权益证明的完整材料包与本次绑定，不能预断只缺摘要，也不能从历史文字生成假的文件/时间。

可在授权范围内取得的下一步是恢复已知证据保管处的原字节（若有独立持久来源），或在最终新鲜窗口按原默认只读清单执行当前非延期订单观察并核实既有结算证据；本轮不为补旧材料重复上述四历史单核查；最终窗口按默认范围执行必要新鲜只读观察，不重做商户/密钥核查、不补结算/权益、不新付款。本次未做生产读取，因此不声称该材料包存在或已通过。

当前安全取得能力：现有queryOrders可在最终窗口按默认精确集合取得新的签名查询，数据库scope reader可只读观察既有结算字段；这些是原授权执行步骤。现有readCutoverRehearsalArtifacts只验证已有材料，仓内写入该清单的入口仅隔离QA fixture，没有生产真实恢复材料生成器。单次当前结算快照不能证明恢复后重复通知没有重复权益，旧历史结论也不能替代已丢签名原文。当前不能安全生成的具体材料是实际恢复/对应结算与重复权益观测的transcript原文及其settlementDigest（或真实retryDigest）；未证明存在独立持久来源，不为此付款、改历史、补结算、改时间或重复商户/密钥核查。已有原始材料若另有已知保管来源可只读取回并核hash，当前不泛化等待授权。

以下为历史记录。

# 首次切换支付证据：局部行为已验证，外部恢复未验证

2026-09-26。不得据此放行生产或宣称真实支付方重投成功。

## 2026-09-27：九笔历史支付宝延期已获用户批准

用户回复“允许”明确批准上述九笔未核实历史记录单独延期、不阻断本次上线，取代之前待确认的问题。两笔后台显示超时关闭、七笔查单及后台未找到的历史观察不变；不能由此认定未付款。复用原 `alipay-scope-before.json` 与 `alipay-scope-recheck.json`，没有重复商户查询或修改历史记录。

实现沿用 `deferredUnverified`，批准引用 `alipay-historical-20260927`；固定九笔身份摘要集合的排序JSON SHA256为 `6e81aade39333ad180272497a70b06aeffb57194a643c525fde264684df69686`。数据库reader要求全部九笔仍匹配历史身份；采集器及应用readiness独立钉住完整集合，当前全行摘要绑定两次观察。新增订单照常核验，名单变化拒绝沿用。原归档不含external_id/metadata，历史比对不声称覆盖这两项。详见现场接线文档。

这是明确延期，不是支付核清、真实恢复演练或发布完成。PayPal继续禁止访问，唯一旧Sandbox批准独立保留。剩余Task4–6接线与整项验收继续推进。

## 2026-09-27：微信4笔历史订单已取得真实签名核对结果

使用本次会话核实的原配置和现有只读查询器，在两次只读数据库事务之间执行4次微信商户订单GET查询。没有访问商户后台、改变登录或配置，也没有创建、支付、关单、退款、补结算或PayPal操作。2026-09-27 09:14:51 UTC开始的支付方结果：4/4 HTTP200且真实签名验证通过；商户号、AppID与商户订单号逐一一致。数据库前后完整被选字段一致，两个原网关的进程身份、配置及所用签名/验证文件摘要在核查期间不变。

| 本地记录 | 支付方状态 | 已核清的结果 |
| --- | --- | --- |
| completed 1笔 | SUCCESS | 金额、币种、交易号与本地结算记录一致，判定settled；本地完成时间2026-08-04 15:14:56.168，是原微信测试的历史记录，不是本轮新付款 |
| pending 3笔 | CLOSED | 签名及商户/应用/订单身份一致，无transaction_id；响应未返回amount，不能声称已核对不存在的金额；按微信关闭状态解释为closed，本地pending原样保留 |

首次查询器将后三笔保留unknown，原因是本次新增运维工具把所有状态的amount都视为必填，而真实Native CLOSED响应省略该字段。微信官方[Transaction类型](https://github.com/wechatpay-apiv3/wechatpay-go/blob/main/docs/payments/Transaction.md)将amount标为可选，[Native状态说明](https://pay.wechatpay.cn/doc/v3/merchant/4012791891)区分未支付转CLOSED与支付成功转REFUND。只修`payment-cutover-query.ts`：签名和精确三项身份通过、无本地结算、无transaction_id时允许CLOSED省略amount；若amount提供则仍须合法且匹配。SUCCESS/NOTPAY仍要求金额，错误商户/金额/签名、退款、冲突结算仍拒绝或unknown。没有修改原微信接入、回调、结算、权益或额度规则。

16项回归新增，其中真实缺字段形态先RED（unknown而非closed）后GREEN，错误签名/三项身份/金额/币种/本地结算及其他状态覆盖保留。没有重复请求支付方：09:17:17 UTC以原验证配置离线回放刚保存的4份签名原文，使用各自原观测时间，结果为3closed+1settled。离线回放不是新的动态支付观察，也不是实际回调重投或生产切换恢复演练。

私密证据目录均0700、文件0600，原文/订单号不提交Git：

- 原始核查：`/private/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/holaday-wechat-readonly-6IIU4v`，`provider-results.json` SHA256 `663f52f8ca5e30a0fc159269b87e5ed87d994977dd1fe60a24584dbe38e3409e`；包含查询前后scope。
- 离线重验：`/private/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/holaday-wechat-readonly-BpLN76`，`provider-results.json` SHA256 `4b44785356d91922ef3767b2e5ae14c1f5c8f21f2677f491d2139ff57fe0b166`，原观测时间保留；回放源码摘要`7dc7dd1372e3c33e2f48c77e17014a3af73e1ebef03c585d0c81d5c613d53cd0`。

本轮国内支付完整8文件99/99通过；应用typecheck与查询器/测试显式严格tsc通过，触及2文件Biome通过。首次全套在沙箱中监听用例`src/index-listener.test.ts`失败，带本机临时监听权限后同一全套通过，没有改该测试或监听逻辑；第一次QA在本地esbuild解析退出，未连接服务器，改为复用已安装tsx的构建依赖后执行4次查询。日志`/tmp/holaday-wechat-closed-{red,green,suite,suite-final,types}.log`保留。

既有普通/partner结算幂等专项2文件40/40通过，日志`/tmp/holaday-wechat-closed-settlement-final.log`；首次Vitest配置临时编译被工作树EPERM阻止，获准后完整运行。该套件中的PayPal为原有本地合成用例，没有访问真实PayPal。阶段观察相关原有inventory/journal基线68/68通过，但本轮没有修改这两个模块，不能把基线描述为新完成的现场接线。

**已收口的是原微信编号与4笔历史订单核查，不是Task4–6或支付恢复演练。** 不再要求用户重复提供编号或重做微信接入；最终切换时仍需按原计划检查当时的新鲜订单集合。本次没有生产发布。

## 2026-09-27：复用原微信配置和历史完成记录，不重新接入

用户提供原编号并提醒微信此前已测试。09:03:45 UTC只读核对4010/4011对应两个既有release的指定.env：AppID与商户号完全一致，且与9月26日4010启动环境已保存的SHA256逐一匹配。用户提供的编号实际对应`WX_MCHID`，不是`WX_APPID`；已在会话中返回准确字段，不改环境配置。AppID摘要为`5ab10623050828fc36fb20c00ec80494c766d1e1abac693f927959482318a76b`，商户号摘要为`91d1e9e6f8e09826510ae309c82625f22ba3edca6c0797fe82cf5b594f0c94d9`。完整编号不纳入Git。

9月26日13:27:49 UTC的只读数据库证据包含微信completed 1笔（有provider capture ID）、pending 3笔。因此不能再将微信描述为“从未接入/未测试”，也不再要求用户重复提供这组编号。用户要求避免重复劳动：历史接入和配置证据复用；本次只补尚未取得的支付方订单对照、切换恢复证据和发生变化后的必要检查。

上述来源是用户输入、现有服务器配置和历史数据库记录，不是商户后台截图，也不单独证明实际支付方状态或失败重投。微信商户后台的工具策略拒绝仍有效，不换通道访问该后台；既有只读订单查询与后台身份取证区分。PayPal全部延期不变。本节未创建订单、付款、退款、关单、补权益、修改配置或部署。

## 2026-09-27 最新授权：用户本人小额支付演练同意，尚未执行

用户对上一轮“小额测试由你本人付款，金额先确认”的请求回复“同意”。允许安排用户本人完成的非PayPal测试付款；具体金额、商品/权益、时点及验证步骤仍须先说明并确认。不是代理代付款、退款、直接补发权益或改历史订单的许可。本次没有创建订单、收付款或调用退款接口。

微信商户平台被当前浏览器工具的安全策略拒绝访问，禁止改用其他浏览器/CDP/命令行/API绕过。仍需用户自行提供商户号/AppID核对截图，不含密钥；当前没有该截图或商户归属验证结果。PayPal全部延期的范围保持。用户同意测试不等于商户绑定或外部回调恢复证据已经通过，也不免除本地现场接线及整流程工程工作。

## 2026-09-27 最新用户范围：PayPal 全部延期，不再要求登录

后续用户已明确回复“可以”，批准下述单条历史Sandbox延期提案。此批准替代本节的历史“提案待确认”：已批准记录指纹固定为 `75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95`，引用 `paypal-sandbox-20260927`。只读数据库比对用于确保未扩大对象，不能恢复支付方查询；状态、费用、权益原样保留。候选采集器与应用readiness现实现独立 `deferredUnverified` 记录及摘要，不把它算成已查单；实际生产host接线与部署尚未完成，不能声称线上门槛已生效。

用户“2允许 不是不弄paypal了吗？”及“是的 paypal登录有问题 登不上”明确撤回继续排查 PayPal 的方向。此节优先于下方历史授权与下一步：不再浏览/登录 PayPal，不读订单、商户配置或调用API；保留原记录，候选新支付继续关闭。本轮没有访问支付表或支付方。

提案前的门槛要求完整范围、unresolved=0；新支付关闭本身并不豁免历史 Sandbox 单。现已按上述明确批准区分“需支付方核验的订单集合”和“唯一未核验延期项”；真实支付、支付宝/微信及其余门槛不变。不得把延期写成支付成功、未支付或验证通过，也不能以此重新启动PayPal核查。

## 2026-09-27：旧 PayPal 只读核查获准，开发者登录待完成

用户“都允许 私钥副本存到U盘 Yalei”明确批准上轮请求的旧Sandbox订单及商户归属只读核查，因此本节替代下方历史“完全暂停PayPal核查”。新支付仍延后；不恢复checkout，不进行capture、关单、退款、改订单或权益补发。

UTC `06:18:03.159` 在 Vultr 以只读一致性事务核查精确一条pending PayPal记录：创建于 `2026-04-26T14:46:28.990Z`，金额990美分USD，无capture ID，metadata仅有`env: sandbox`。当前应用dotenv为Live、client ID/secret存在但merchant ID缺失；只记录存在性及client ID摘要，不输出凭据。事务最后ROLLBACK，订单号、引用号和动作原文只留 `/private/tmp/holaday-authorized-legacy-review-zDa2mv/review.json`，目录0700/文件0600，不提交Git。

通过 Chrome 打开 `https://developer.paypal.com/dashboard/applications/sandbox`，实际重定向登录页。初次仅Logo，刷新一次后显示邮箱/手机号和下一步，没有已登录开发者后台；保留页面并请用户完成登录。未猜测账户、读取浏览器密码、完成验证码、重置登录、创建新应用或访问支付API。尚未取得原Sandbox应用/商户身份，不能用Live配置查询后把not-found解释成未支付。

本节没有新的支付状态判定或恢复演练通过结论。下一步从登录后的原Sandbox应用与商户依据继续，再使用已有只读订单查询器；不扩大到全账户流水或生产支付操作。产品代码未改，未重跑产品测试。

## 最新范围：PayPal新支付延后，历史交易核对保留

2026-09-26用户确认隐藏PayPal套餐/加量包入口并禁止新建订单；采用独立`PAYPAL_CHECKOUT_ENABLED`，不因隐藏入口而关闭历史适配器、capture或回调。新支付开通与体验验收不再是本次上线功能门槛；下方旧sandbox订单和live配置的事实仍待核清，不自动豁免、不改状态、不做真实扣款或补结算。现有回调验签与恢复条件不降低。上线时须验证新订单API拒绝且options不暴露可用入口；代码验证不等于线上已隐藏。

## 本地已验证

2026-09-27补充：真实MySQL备份恢复及完整61个SQL已在合成库执行，当前已观察支付形态通过；缺失completed_at的completed订单反例失败，因为0042连带刷新updated_at。完整结果为1通过/1失败，不是全量迁移验收通过。线上只读聚合为completed2/缺失0、pending13（观测时间02:27:51Z）；仍需隔离停写后的新证据。见[复现及限制](../../../scripts/fixtures/cutover-mysql-README.md)。没有修改SQL、订单或结算规则。

- 网关新增12条行为锁定测试：微信/支付宝 × 普通订阅/partner充值 × 成功/Promise拒绝/未确认。结算 Promise 未完成时不应答；成功后才成功应答；失败保持原非成功结果。支付、权益和额度实现未修改。
- `pnpm --filter @holaday/cn-payment test`：7文件、80通过，退出0；类型检查退出0。日志 `/tmp/holaday-cutover-payment-characterization-final.log`、`/tmp/holaday-cutover-payment-types-final.log`。
- 原普通与 partner 幂等专项：`src/http.payment.test.ts`、`src/partner/payment-confirm-service.test.ts`，2文件40通过，退出0；覆盖现有重复确认与权益行为，不新建结算路径。日志 `/tmp/holaday-cutover-payment-idempotency.log`。
- 此处网关验签和远端桥接使用测试替身，不能作为商户真实签名、网络恢复或重投时间的证据。原业务代码正确，因此行为锁定用例直接GREEN，没有人为破坏结算代码制造失败。

## 未取得的放行事实

1. 生产当前全部活动任务/历史支付逐条核对：Vultr只读SSH中转已恢复，已取得数据库聚合和下方环境/字段存在性事实；尚未取得支付方逐条结果。不要继续以SSH不通作为阻塞，也不能把数据库pending当作确定未付款。
2. 真实商户/代码/配置绑定的回调失败与恢复重投，或独立查询加现有幂等补结算能力的实际演练。
3. 最终写入隔离后的新鲜加密备份、隔离恢复、全部61条SQL与0042行为核验。

没有进行生产付款、capture、退款、权益补发、订单改状态或测试额度修改。用户本轮已授权推进PR/部署/验证，但这些验收条件仍未满足。

## 2026-09-26 22:22–22:28 JST：实际配置和历史订单绑定核对

本轮只读SSH、指定配置文件元数据及数据库只读事务，没有调用支付方API或修改业务状态。原始脱敏事实存于本计划忽略QA目录 `payment-binding-audit-20260926/`，仅计数、布尔、路径、摘要，不含密钥、订单号、商户ID或用户信息。

### 已核实

- PayPal的历史记录共2条，metadata.env都明确为 `sandbox`：pending 1条、completed 1条，只有completed带capture ID。当前4001启动环境与实际dotenv文件均配置 `PAYPAL_ENV=live`。**不能用现有live配置核验历史sandbox订单，也不能把测试订单误当正式收款。** sandbox标签不等于支付方已证明关闭，不能据此自动排除pending。
- 微信pending 3条、completed 1条；支付宝pending 9条；partner充值表为空。国内支付metadata未保存environment/env；递归检查的标准商户/app身份字段在这些记录中均未找到。此处仅是存储字段存在性检查，不是证明所有历史证据都不存在。
- 4010当前网关和4011旧网关的指定.env均有微信、支付宝和内部桥接配置；支付宝模式为production，但均缺少 `ALIPAY_SELLER_ID`，没有找到替代seller/merchant字段。4010磁盘中被检查的支付字段与启动环境相同。
- 4011使用Node的 `--env-file`；`/proc/.../environ`的启动快照未出现这些变量，**不能解释为运行时没有支付配置**。其仍监听4011，来源为旧支付release，责任及旁路可达性尚未核清，不自动停止。
- 4001初始环境及三个既有dotenv候选路径中，只有应用 `.env.local` 存在；PayPal ID/secret存在，merchant ID、webhook ID及显式enabled值未找到。仅说明所检查来源，不以此单独推断历史版本的实际启用行为。
- 限定检查本机主仓/候选现有应用.env及.env.local，没有找到PayPal sandbox凭据或支付宝seller ID。未扫描浏览器密码、其他项目或无关凭据目录。

### 接线结论与剩余输入

既有查询器要求独立商户身份和正确环境；不能从待验证订单响应反填“预期商户”自证，也不能把当前国内配置直接当作8月历史订单的既定绑定。需要找到原PayPal sandbox应用/商户的受保护配置，以及支付宝seller身份和历史应用绑定依据。可由已登录商户后台核对并安全配置，不要求用户在聊天中粘贴密钥。取得前，支付查询组装仍明确未完成。

本轮没有新增产品代码或测试通过数量。上述实时核查不替代Task5的真实失败/恢复演练、最终隔离备份恢复、迁移验证，也不代表Task4整流程或Task6完成。既有explorer running记录仍待单独核清；没有清理订单/任务来放行。

## 2026-09-26 22:41 JST：支付宝商户身份已从后台核实

用户完成支付宝登录后，使用既有Chrome登录态只读查看开放平台及商家平台。开放平台列表显示已上线的基础应用；其AppID与22:24的4010启动配置摘要精确匹配。名为HOLADAYPAY01的另一网页应用仍为开发中，不能仅凭名称选它替换现有配置。商家平台的APPID绑定清单含实际线上应用；商户信息页的商户号和收单账号一致（均尾号9327），主体与开放平台绑定商家一致。开发设置显示接口加签方式已设置，未展开或导出密钥。

**此前“支付宝seller身份无独立来源”的缺口已解决。** 完整身份值仅保存在本计划忽略QA的 `payment-binding-audit-20260926/alipay-console-observation.json`（父目录0700、文件0600），不是环境变量或已生效线上配置。它是经登录后台的人工/浏览器观测，不是支付方签名订单证据。未查询9笔历史订单、未核实旧4011 AppID或历史下单绑定，不能据此宣称支付门槛通过。服务器配置、支付设置、订单和权益均未修改。

PayPal用户截图的人机验证为已打勾，但后续页面返回“暂时无法完成请求”，随后回到需要密码的登录页；尚未进入开发者后台或取得sandbox商户信息。没有重复解验证码、重置密码、修改网络设置或更换账户。已保留PayPal登录页和支付宝实际应用/商户信息页供继续。

## 2026-09-26 23:04 JST：支付宝9笔真实查询与GBK验签修正

用户明确要求PayPal稍后处理；本轮不再访问PayPal页面、读取其订单或调用其API，该项仍待核验，绝非已通过或被排除。

### 现场结果

Vultr只读事务取得9笔支付宝pending订单；随后在阿里云现有支付主机，用现有密钥执行 `alipay.trade.query`。密钥留在服务器，未写线上配置或安装代码。4010/4011指定.env的AppID均与已核实商户后台的线上基础应用一致，支付宝公钥相同、模式production；查询前后进程start/cwd和文件摘要稳定。此处证明采样配置一致，不能单独证明8月每笔下单时配置或4011无其他职责。

最终采样14:03:52 UTC，9/9响应验签成功：

| 数量 | 支付方结果 | 已核实与限制 |
| --- | --- | --- |
| 7 | `40004 / ACQ.TRADE_NOT_EXIST` | 原始响应验签通过，回显订单号匹配；无交易金额或seller_id，不能解释为确定未付款或自动删除本地pending |
| 2 | `10000 / TRADE_CLOSED` | 验签、订单号、金额匹配；响应无seller_id，直接商户查询由独立后台身份和匹配AppID绑定；关闭仍可能涉及退款，不自动转为无风险closed |

两次数据库只读快照的9行全部相同。第二快照在最终查询前，**不是最终查询后数据库冻结或全系统零写入的证明**。查询器仍将这两类结果保留为unknown，不为放行改本地订单状态。支付宝对交易关闭的定义包括未付款超时和付款后全额退款，参见[官方业务通知说明](https://developer.alibaba.com/docs/doc.htm?articleId=106448&docType=1&treeId=193)。后续需要限定这些订单的商户交易/退款记录对照，不扩大为全账户流水导出。

### 实测缺陷与最小修正

初次9笔中7笔中文错误响应无法验签。单笔对照确认响应头为 `text/html;charset=GBK`；仅正确解码再用SDK的UTF-8重编码验签仍失败。对保留字节在服务器离线验证：原始GBK正文验签true、GBK解码后UTF-8重编码false、直接UTF-8读取false，定位到查询器 `Response.text()` 与SDK `checkResponseSign` 的UTF-8假设。

仅修改 `apps/cn-payment/scripts/payment-cutover-query.ts` 及测试：保存contentType和原始字节base64，用SDK原有envelope切片对原字节做RSA-SHA256验签，再按受支持字符集解码解释；不跳过验签，不改变状态分类，不改业务支付/回调/权益路径。私密Alipay archive现在是 `{contentType, bodyBase64}`，rawDigest覆盖完整archive；微信存档协议未改。

新增GBK真签名和篡改用例：先RED（合法GBK响应失败），再GREEN；保留真实SDK和Node crypto，仅替换网络。支付网关完整7文件82/82通过，专项25/25通过，应用typecheck与脚本/测试显式tsc均退出0，两个文件Biome及diff-check通过。初次测试存在Vitest缓存目录EPERM，改用 `--no-cache` 后重新确认RED/GREEN，不改产品权限；格式检查最初2处不符，修正后通过。日志 `/tmp/holaday-alipay-bytes-{red-no-cache,green,suite-final}.log`。

共19次只读支付宝调用（初次9、字符集对照1、最终9），无自动循环重试。单笔对照首次工具审批超时未执行，按工具允许精确重试一次成功。原始证据保存在忽略QA `payment-binding-audit-20260926/`，父目录0700、文件0600；有真实订单及响应，不提交Git。`alipay-provider-query-final.json`、`alipay-scope-{before,recheck}.json`、`alipay-charset-probe.json`、`alipay-offline-signature.json`均保留；旧失败证据不覆盖。

本轮没有付款、capture、关单、退款、补结算、权益/额度变更、服务停止、部署或PayPal访问。只完成真实支付宝查询和局部查询器修正；Task4完整接线、Task5财务处置/恢复演练与Task6整体验证仍未完成，不能宣称可部署。

## 2026-09-26 23:12 JST：商家后台逐单核对

复用已登录Chrome，只查询上述9个商户订单号，筛选为按创建时间、2026-08-04 00:00:00至2026-08-06 23:59:59、全部状态。页面说明可查2025-09-26以后的订单，所选日期在范围内。订单模块初次加载较慢，刷新一次后正常；没有改网络、登录或安全设置。

- 两笔API返回TRADE_CLOSED的订单，在列表各查到1条，金额均99.00元、退款金额0.00元、支付时间为空。分别打开详情后均明确显示**交易关闭（超时关闭）**，结束时间为8月20日10:23和21:43（页面显示时间）。此前对这两笔“超时还是退款关闭”的具体疑问已有后台依据，不再重复要求同一页面证明。详情金额占位符不解释为零。
- 其余7笔逐个商户订单号查询均显示“未查询到相关数据”，与签名接口ACQ.TRADE_NOT_EXIST一致。但该结论仅限已核实商户、指定创建日期及订单号；不扩展为跨账户、跨日期绝对没有收款，也不自动清理本地pending。

完整订单号、交易号、筛选和详情观测只保存在忽略QA `payment-binding-audit-20260926/alipay-console-order-observation.json`，不含买家身份或密钥。此记录是登录后台UI观测，不是假装为支付方签名、完整账务流水或机器放行证据。没有导出全账户账单、提交退款或改数据库；既有query helper仍保持原分类。

本轮只增加核对记录，无产品代码改动、无新增应用测试通过声明、无支付方直连API调用或生产写入。PayPal仍按用户要求暂停。Task4完整双主机/数据库/provider组装、Task5恢复演练/剩余支付依据、Task6整流程与独立审查仍未完成；本节不代表已具备部署条件。
