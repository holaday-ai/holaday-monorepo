# 首发 Skill 战略调整 · 2026-04-21

> 对 `BROWSER_AGENT_PRODUCT_STRATEGY_v0.2.md` §11 "Phase 0 首批 3 个 Skill" 的调整。原文件保留为史料，本件是 active 决策来源。

## 变更

| 项 | 原 (v0.2) | 调整后 |
|---|---|---|
| 首发场景 1 | 电商运营（淘宝/千牛） | **抖音运营** |
| 首发场景 2 | 金融研究员 | **金融分析**（东方财富资讯聚合先落地） |
| 首发场景 3 | 客服（千牛客服汇总） | 暂缓，留在 SDK 参考模板位置 |

## 为什么

1. **淘宝不是增长平台了**。中国电商格局已经往抖音/拼多多倾斜，千牛生态的新增用户曲线平了。HOLA DAY 是新产品，首发要跟着增量用户走。
2. **金融分析是单用户价值最高的场景**。研究员 / 散户每天的资讯整理是高频刚需，且不需要 B 端账号授权。
3. **纯网页端**。东方财富 + 股吧不需要卖家账号；抖音罗盘需要商家授权。**Day 6 的 end-to-end demo 选 eastmoney 正是看中这个低门槛**。

## 对仓库的影响

- `skills/taobao-qianniu-inbox/` **不删**。作为 Skill SDK 的参考模板保留，W2 SkillLoader 会用它做 golden test。
- 新增 `skills/eastmoney-news-digest/SKILL.md`（金融研究员，occupationTag=finance-research）。
- 下一个 skill 目标：**抖音罗盘概览**（电商运营）。等商家账号授权模型在 Phase 1 确定后再落地。
- `BROWSER_AGENT_PRODUCT_STRATEGY_v0.2.md` 保留历史；真正生效的首发顺序以本件为准。

## Phase 0 首发 Skill 清单（生效）

1. ✅ `eastmoney-news-digest`（Day 6 落地）
2. ⏳ `douyin-compass-overview`（抖音罗盘概览，待 Phase 1 商家授权方案）
3. 🗂️ `taobao-qianniu-inbox`（保留为 SDK 模板，不计入首发 3 个 skill 的计数）

## 合规提醒

金融场景上线必带 §7.3 的红线：**只分析、不建议、不给目标价**。Skill manifest 的 caveats 已写死；commander system prompt 在下一版加同样的硬约束。
