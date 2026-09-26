# 首次切换支付证据：局部行为已验证，外部恢复未验证

2026-09-26。不得据此放行生产或宣称真实支付方重投成功。

## 本地已验证

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
