# 首次切换支付证据：局部行为已验证，外部恢复未验证

2026-09-26。不得据此放行生产或宣称真实支付方重投成功。

## 本地已验证

- 网关新增12条行为锁定测试：微信/支付宝 × 普通订阅/partner充值 × 成功/Promise拒绝/未确认。结算 Promise 未完成时不应答；成功后才成功应答；失败保持原非成功结果。支付、权益和额度实现未修改。
- `pnpm --filter @holaday/cn-payment test`：7文件、80通过，退出0；类型检查退出0。日志 `/tmp/holaday-cutover-payment-characterization-final.log`、`/tmp/holaday-cutover-payment-types-final.log`。
- 原普通与 partner 幂等专项：`src/http.payment.test.ts`、`src/partner/payment-confirm-service.test.ts`，2文件40通过，退出0；覆盖现有重复确认与权益行为，不新建结算路径。日志 `/tmp/holaday-cutover-payment-idempotency.log`。
- 此处网关验签和远端桥接使用测试替身，不能作为商户真实签名、网络恢复或重投时间的证据。原业务代码正确，因此行为锁定用例直接GREEN，没有人为破坏结算代码制造失败。

## 未取得的放行事实

1. 生产当前全部活动任务/历史支付逐条核对：Vultr只读SSH连接未成功，不能沿用昨日聚合作当前事实。
2. 真实商户/代码/配置绑定的回调失败与恢复重投，或独立查询加现有幂等补结算能力的实际演练。
3. 最终写入隔离后的新鲜加密备份、隔离恢复、全部61条SQL与0042行为核验。

没有进行生产付款、capture、退款、权益补发、订单改状态或测试额度修改。用户本轮已授权推进PR/部署/验证，但这些验收条件仍未满足。
