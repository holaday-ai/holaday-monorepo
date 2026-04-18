---
slug: taobao-qianniu-inbox
name: 千牛客服汇总
version: 0.1.0
description: 汇总过去 24 小时未回复的千牛客服消息，并按买家分组输出摘要。
occupationTag: ecommerce-customer-service
entryUrls:
  - https://qianniu.1688.com/
  - https://work.taobao.com/
riskFloor: low
hints:
  - 用户已在 qianniu.1688.com 登录；不要触发二次验证。
  - 优先从左侧"待处理"入口进入，而非主页搜索。
  - 聚合 24h 内买家消息，每个买家最多保留最近 3 条文本，不复制图片/订单截图。
  - 输出按"买家ID -> 最近消息预览 + 未回数"的结构供店长审核。
caveats:
  - 千牛 DOM 经常小改版；selector 应 role → text → css 三层 fallback。
  - 页面有 iframe 嵌套，需要在具体 panel 内 scope 搜索。
  - 某些企业店铺未回消息会超过 200 条，需分页滚动汇总。
---

# Skill: 千牛客服汇总

## 用户意图（典型）

> "汇总过去 24 小时千牛里我没回复的买家消息，分到每个店铺，告诉我谁最急。"

## 高层规划模板（commander 参考，不是固定 plan）

1. `goto` https://qianniu.1688.com/ （若已在千牛，可跳过）
2. `click` 左侧导航 · 待处理（或 text="未回复"）
3. `wait` 消息列表首屏加载完成
4. `extract` 当前可见的未回消息列表，字段：买家 ID、最近消息预览、未回数、最后消息时间
5. 如果页面支持筛选，`click` 近 24h；否则在 `extract` 后过滤时间
6. `scroll` 或翻页直到收集完所有 24h 内未回消息（上限 500 条）
7. `extract` 最终聚合：每个买家的最近 3 条消息预览
8. 返回结果（非浏览器动作，commander 负责包装）

## 风险标注

- 全部步骤默认 `low`。无支付、无群发、无改密。
- 若 commander 决定自动回复或群发 → 必须 `risk: "high"` 并 `requiresConfirm: true`，即使 Skill 自身的风险等级是 low。

## Selector 要点（ResilientSelector 建议）

| 目标 | role 优先 | text 备选 | css 兜底 |
|---|---|---|---|
| 侧栏 · 未回消息 | `navigation` + name="未回复" | "未回复" / "待处理" | `.qn-sidebar [data-type="unreplied"]` |
| 消息列表项 | `listitem` | — | `.qn-message-list .msg-item` |
| 买家 ID 文本 | — | — | `.msg-item .buyer-id` |
| 最后一条消息 | — | — | `.msg-item .latest-text` |

## 预期输出 schema（非本 Skill 强制，commander 按需）

```json
{
  "windowHours": 24,
  "totalUnreplied": 42,
  "byBuyer": [
    {
      "buyerId": "b_xxx",
      "shop": "XX旗舰店",
      "unrepliedCount": 7,
      "lastAt": "2026-04-18T03:12:00Z",
      "recentPreviews": ["这个件还能发吗?", "在么?", "急"]
    }
  ]
}
```

## 已知限制（Phase 0）

- 不支持自动回复（等 Skill 的 dogfood 反馈后再加）。
- 不跨店铺聚合（用户自己切店铺时再跑一次）。
- 表情 / 图片 / 订单卡片一律丢弃，仅保留文本摘要。
