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
