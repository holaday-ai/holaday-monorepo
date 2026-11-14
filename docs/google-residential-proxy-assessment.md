# 仅 Google 搜索走住宅代理：决策页

结论：可作为匿名 Google 搜索的独立、小额度试验；不能保证解除 Google 验证墙，也不能代替当前备用搜索引擎方案。本任务没有购买、配置或实测付费代理。

## 现有代码与范围

`apps/orchestrator/src/agent/browser-tools/domain-egress.ts` 已支持 `BROWSER_DOMAIN_PROXY_ENABLED`、`BROWSER_DOMAIN_PROXY_DOMAINS`、`BROWSER_DOMAIN_PROXY_URL`，按任务/域名派生固定会话标识、校验网络策略、限单次响应 5 MiB、禁用 service worker 并统计 HTTP payload 字节。媒体会被拦截，其他域名走现有出口。

配置项存在不等于已生产可用：需另行验证 CONNECT/IP 与 TLS 主机名、提供商的目标域限制、重定向和 Google 地区域名。当前域匹配包含子域；直接填 `google.com` 会同时涵盖账号等子域。试验应仅限匿名搜索及经审查的搜索主机，不让登录态、Cookie、私人文档经过第三方出口。Google 静态资源/地区重定向可能走不同出口，需要检查一致性。

## 月成本情景（美元，非报价）

当前官方价：Bright Data 的住宅代理页列出按量 $4/GB 促销价、原价 $8/GB，无月承诺；促销有券和有效期条件。[官方价格](https://brightdata.com/pricing/proxy-network/residential-proxies)。Oxylabs 当前列出 Starter $30/月、$6/GB，Basic $100/月、$5/GB，Flexible $500/月、$4/GB；部分 Google 域名受限，购买前须确认搜索目标可用。[官方价格与限制](https://oxylabs.io/pricing/residential-proxy-pool)。

假设每次搜索有 0.3–2 MB **实际经代理流量**，按 $4–8/GB 估算（图片缓存、页面变化会影响流量；这不是本任务测得的平均值）：

| 月搜索次数 | 估算流量 | 按量流量成本 |
|---|---:|---:|
| 1 万 | 3–20 GB | $12–160 |
| 10 万 | 30–200 GB | $120–1,600 |
| 100 万 | 300–2,000 GB | $1,200–16,000 |

还需计入最低套餐、税费、失败重试、隧道/计费口径差异、运维成本；现有 payload 计数不等于提供商账单。建议先以 5–10 GB 和日/月硬上限做另行授权的试验，不直接承诺大套餐。

## 成功率与风险

住宅出口仍可能共享、被滥用或被重新分类；固定会话可减少身份漂移，却不保证通过。Google 明确说明共享网络/VPN 的自动查询可能引发验证，并建议购买 IP 前先测试是否有既有封锁。[Google 官方说明](https://support.google.com/websearch/answer/86640?hl=en-GB)。保持真实验证码暂停，不接验证码代解、不伪造登录、不循环切换 IP 闯过验证。

需要评估代理供应链同意、第三方可见的搜索词/访问元数据、地域与数据跨境、供应商服务条款以及凭据管理。失败时保持明确的引擎来源与备用结果，不能声称已经读取 Google 卡片。

**BOSS 决策项：** 是否另批匿名搜索试验、选哪家经确认允许 Google 搜索的提供商、月流量与费用上限；本次不执行这些变更。
