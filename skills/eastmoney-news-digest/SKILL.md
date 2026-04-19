---
slug: eastmoney-news-digest
name: 东方财富资讯聚合
version: 0.1.0
description: 按板块或关键词聚合东方财富的行业新闻 + 股吧热帖，结构化 Markdown 输出。
occupationTag: finance-research
entryUrls:
  - https://www.eastmoney.com/
  - https://quote.eastmoney.com/
  - https://guba.eastmoney.com/
riskFloor: low
hints:
  - 只读场景，不下单、不发帖、不登录密码；用户已登录免登态。
  - 聚合范围默认"今日"，除非 intent 里写了时间窗。
  - 每条新闻保留：标题、来源、发布时刻、摘要（前 2-3 句）、原文 URL。
  - 股吧热帖只保留：帖子标题、作者、发帖时刻、点赞数、回复数、URL。
  - 输出 Markdown，顶部给 3-5 句"今日板块综述"，然后分组列新闻与帖子。
  - 单次抓取上限：新闻 20 条 + 股吧 15 条，避免长任务。
caveats:
  - 东方财富的页面结构在不同板块下略有差异；selector 走 role → text → css 三层兜底。
  - 股吧列表懒加载（滚动触发）。需要适度 scroll 再 extract。
  - 节假日和盘前盘后，热榜数据可能少；commander 不要期望一定抓到 20 条。
  - 不抓评论区主体，只取帖子的标题/计数；进入详情页是可选步骤（仅在 intent 需要原文时）。
  - 合规红线：只做信息聚合，**不**生成买卖建议、不给目标价。战略文档 §6.5 / §7.3。
allowedOrigins:
  - "eastmoney.com"
  - "*.eastmoney.com"
---

# Skill: 东方财富资讯聚合（eastmoney-news-digest）

## 典型用户意图

> "帮我整理今天半导体板块的要闻。"
> "北向资金今日动向，配 3 条股吧最热帖。"
> "新能源车板块这周主要政策和研报重点。"

commander 解析时提取：**板块**（关键词）、**时间窗**（默认今日）、**附加项**（股吧热帖 / 研报 / 北向）。

## 高层规划模板（commander 参考）

1. `goto` https://www.eastmoney.com/ 或板块入口（例如 https://quote.eastmoney.com/sh000016.html）
2. `wait` 首页资讯列表可见
3. `extract` 首页 / 板块页上的今日要闻列表（标题 + 链接 + 时间）
4. 可选：对 Top N 条 `goto` 详情页 → `extract` 正文摘要 → 返回列表
5. `goto` https://guba.eastmoney.com/list,{板块代码}.html 或通用热榜
6. `wait` + `scroll` 若干次 让热帖列表展开到 ≥ 请求数量
7. `extract` 热帖列表（标题 + 作者 + 时间 + 点赞 + 回复 + URL）
8. commander 组装：综述（3-5 句）+ 新闻分组 + 股吧热帖分组 → Markdown

## 风险标注

- 所有步骤默认 `risk: "low"`，整个 Skill 的 riskFloor=low。
- 有一个例外：如果 intent 出现"下单 / 买入 / 卖出 / 委托"等关键词，commander 必须**拒绝**（返回空 plan 或一个礼貌拒绝步）。Phase 0 由 SafetyFilter（W3）统一处理；本 Skill 只需在输出中明确"只做资讯整理，不提供操作建议"。

## Selector 要点（ResilientSelector 建议）

| 目标 | role 优先 | text 备选 | css 兜底 |
|---|---|---|---|
| 首页 · 今日要闻列表 | — | "今日要闻" / "热点资讯" | `.news-list li` |
| 单条新闻标题 | `link` + 可见文本 | — | `.news-list li a.title` |
| 板块页 · 公告 Tab | `tab` + name="公告" | "公告" | `.tab-list [data-tab="ann"]` |
| 股吧 · 热榜切换 | `button` + name="热榜" | "热榜" | `.guba-nav .hot` |
| 帖子行 | `row` / `listitem` | — | `.guba-list .article_list_item` |
| 点赞 / 回复数 | — | — | `.count-like`、`.count-reply` |

Selector 文件 W2 会抽到 `skills/eastmoney-news-digest/selectors.json` 由 SkillLoader 加载。

## 输出 schema（commander 组装，非 Skill 强制）

```json
{
  "board": "半导体",
  "window": { "from": "2026-04-20T00:00:00Z", "to": "2026-04-20T15:00:00Z" },
  "summary": "今日半导体指数小幅承压；政策面 …；龙头 …。",
  "news": [
    {
      "title": "...",
      "source": "证券时报",
      "publishedAt": "2026-04-20T09:12:00Z",
      "excerpt": "...",
      "url": "https://..."
    }
  ],
  "guba": [
    {
      "title": "...",
      "author": "...",
      "postedAt": "2026-04-20T08:00:00Z",
      "likes": 87,
      "replies": 204,
      "url": "https://..."
    }
  ]
}
```

最终输出到用户的 Markdown 由 commander 渲染；本 Skill 约定"内部数据形状"。

## 已知限制（Phase 0）

- 不做跨日趋势、不做行情 K 线抓取（另立 skill）。
- 股吧不抓帖子正文，只抓列表。正文抓取在 Phase 1 加。
- 板块代码 → URL 映射表在 Phase 0 用小写入库（commander 问时给到），Phase 1 可做动态解析。
- **合规**：结果文本里严格禁止"买 / 卖 / 止损 / 目标价 / 重仓"等祈使词；commander 有 system-prompt 指令，Skill 约定 caveat 提醒。

## 参考

- 战略文档 v0.2 §6.5（金融场景）+ §7.3（股市合规红线：只分析不建议）
- PoC 技术选型 §6.1 A 路径：本 Skill 的 goto/click/extract 全部在 Playwright-CRX 能力范围内
- 姊妹参考：`skills/taobao-qianniu-inbox/SKILL.md` 保留作为 Skill SDK 模板（电商客服模板）
