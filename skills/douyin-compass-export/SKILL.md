---
slug: douyin-compass-export
name: 抖音罗盘数据导出
version: 0.1.0
description: 在抖音电商罗盘（商家已登录会话）按时间窗导出商品/直播/流量核心指标为结构化数据。
occupationTag: ecommerce-ops
entryUrls:
  - https://compass.jinritemai.com/
  - https://compassmobile.jinritemai.com/
riskFloor: low
hints:
  - 用户已在 Chrome 中登录商家号（HOLA DAY 不引入任何授权层，继承已登录会话）。
  - 如果首次 goto 被重定向到 passport.snssdk.com 或 sso.jinritemai.com 的登录页，立即 awaiting_user 弹出"请先在 Chrome 登录抖音商家号"。
  - 默认时间窗=昨日；intent 里明确指定则按指定（如"近 7 天"、"本周"、"上月"）。
  - 默认导出维度：商品分析（商品曝光/点击/下单）+ 直播分析（开播场次/观看/GMV）+ 流量分析（渠道来源）。
  - intent 若只提一类（"只拉直播"）则跳过其他 tab。
  - 结果一律结构化 JSON，由 commander 组装 Markdown；不截图不 OCR。
caveats:
  - 罗盘页面大量数字用 WebGL/Canvas 渲染的图表，Skill 只读 DOM 文本 + table 数据，不做像素 OCR。
  - 部分报表需要"点击导出" → 弹出下载；Phase 0 改为直接 extract 页面上可见的汇总行，不依赖下载链。
  - 某些高级分析 Tab（例如"达人带货"）需要商家加盟主状态；未加盟则 Tab 不存在，Skill 应 extract 到 0 行而不报错。
  - 罗盘的时间筛选控件经常改版；selector 走 role → text → css 三层兜底，必要时 selfHeal。
  - 不生成销售建议、不推荐商品、不触发任何写动作（发消息/改价/上下架等）。仅读。
allowedOrigins:
  - "*.jinritemai.com"
  - "*.snssdk.com"
  - "*.douyin.com"
---

# Skill: 抖音罗盘数据导出（douyin-compass-export）

## 典型用户意图

> "把昨天直播间的 GMV 和观看人数拉一下。"
> "导出近 7 天店铺的商品销售汇总。"
> "这周直播场次 + 流量渠道来源。"

commander 解析时提取：**时间窗**、**维度**（商品/直播/流量）、**店铺/品牌限定**（默认当前登录账号绑定的店铺）。

## 登录态检测（关键）

HOLA DAY 不做抖音授权——**强依赖用户在 Chrome 已登录商家号**。Skill 执行的第一步必须是登录态判定：

1. `goto` https://compass.jinritemai.com/
2. `wait` 页面加载
3. 检查 URL：如果落到 `*.passport.snssdk.com/*/login` / `sso.jinritemai.com` / 页面标题含"登录 / 账号"，则：
   - 返回 `status: awaiting_user`，payload 里塞一条明确 prompt：
     > **请先在 Chrome 里登录抖音商家号**（https://compass.jinritemai.com/ 左上角"登录"）。登录完成后点 Resume 继续。
4. 用户登录 + Resume 后重新从 step 1 开始（commander 收到 resume 会重发 dispatch）。

这是 HOLA DAY 产品定位的核心演示——"继承已登录会话 + 需要时暂停求助"。不要试图在 Skill 里替用户填账号密码。

## 高层规划模板（commander 参考）

1. `goto` https://compass.jinritemai.com/
2. `wait` 主页 Dashboard 可见（或登录页 → awaiting_user，见上）
3. `click` 时间筛选控件 → 按 intent 选择时间窗
4. `extract` 首页上所有可见的汇总卡片（GMV / 订单 / UV / 转化率等，带时间窗口标签）
5. 对每个请求的维度：
   - 商品分析：`click` "商品分析" tab → `wait` → `extract` 表格前 N 行
   - 直播分析：`click` "直播分析" tab → `wait` → `extract` 场次列表
   - 流量分析：`click` "流量分析" tab → `wait` → `extract` 渠道占比
6. commander 聚合 → Markdown 输出（表格 + 3-5 句综述）

## 风险标注

- 全 `risk: "low"`，全 `riskFloor: low`。
- 登录页触发 awaiting_user 不是高危——是**操作前置条件不满足**。在 UI 上也应与"高危确认"区分开（W2 弹窗 copy 里"请登录"而非"确认下一步"）。
- 如果 commander 错把"修改价格 / 上架 / 群发"类写动作放进 plan：SafetyFilter（W3）会截断；本 Skill 的 prompt 明确写了不做写动作。

## Selector 要点

| 目标 | role 优先 | text 备选 | css 兜底 |
|---|---|---|---|
| 登录页检测 | — | "登录" / "账号登录" | `form[action*="login"]`、`a[href*="passport"]` |
| 时间筛选按钮 | `button` name="时间" / "筛选" | "昨日" / "近 7 天" / "本月" | `.compass-header [data-testid="date-picker"]` |
| 时间窗 tab（不要硬编码一种写法）| `tab` name="近 7 天" / "最近7天" / "7天" / "7日" / "Last 7 days" | 同左（至少 3 个候选） | `[class*='tab'][aria-label*='7']` |
| 商品分析 tab | `tab` name="商品分析" | "商品分析" | `.compass-nav [data-tab="product"]` |
| 直播分析 tab | `tab` name="直播分析" | "直播分析" | `.compass-nav [data-tab="live"]` |
| 流量分析 tab | `tab` name="流量分析" | "流量分析" | `.compass-nav [data-tab="traffic"]` |
| 汇总卡片数值 | — | "GMV" / "订单数" / "UV" | `.summary-card .value` |

W2 会把这个表抽到 `skills/douyin-compass-export/selectors.json`。

## 输出 schema（commander 内部约定）

```json
{
  "shop": "XX 旗舰店",
  "window": { "label": "昨日", "from": "2026-04-27T00:00:00+08:00", "to": "2026-04-27T23:59:59+08:00" },
  "summary": {
    "gmv": "128,450",
    "orders": 213,
    "uv": 18200,
    "conversionRate": "1.17%"
  },
  "product": [
    { "sku": "...", "name": "...", "exposures": 8200, "clicks": 420, "orders": 12, "gmv": "..." }
  ],
  "live": [
    { "sessionAt": "2026-04-27T20:00:00+08:00", "durationMin": 125, "viewers": 3400, "gmv": "..." }
  ],
  "traffic": [
    { "channel": "推荐流量", "uv": 9200, "share": "50.5%" }
  ]
}
```

最终 Markdown 由 commander 渲染；Skill 只约定 JSON 形状。

## 已知限制（Phase 0）

- 只读；不触发任何写动作。
- 不解析 Canvas/WebGL 图表，不做 OCR。
- 登录必须用户自己完成；Skill 不保存任何凭证（.env.local 里也没有抖音侧 token）。
- 单次抓取上限：商品 50 行 + 直播 20 场 + 流量 10 渠道，避免超时。
- 不跨店铺聚合（用户切店铺后再跑一次）。

## 合规提醒

- 只做数据整理，**不做经营建议**（如"建议降价 X 元"、"建议主推 A 商品"）。
- 不做对账类关键数字的二次加工（比如计算"真实净利"），避免被用户误当成财务结论。
- 对外展示的数字保留两位小数 + 原单位，避免无意篡改。

## 参考

- 战略 v0.2 §5.4（技术栈 HOLA DAY 与 OrangeBench 独立，schema 兼容）
- 战略 Pivot 2026-04-21（首发场景从淘宝转向抖音 + 金融）
- PoC §6.1 A 路径：Playwright-CRX 覆盖 goto/click/extract/wait，本 Skill 完全在其能力范围内
- 姊妹 skill：`eastmoney-news-digest`（金融资讯）作为只读场景的另一参考
