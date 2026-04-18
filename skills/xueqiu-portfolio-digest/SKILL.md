---
slug: xueqiu-portfolio-digest
name: 雪球自选股动态聚合
version: 0.1.0
description: 在雪球（用户已登录）聚合自选股当日动态：行情 + 相关新闻 + 自选讨论区热帖，结构化输出。
occupationTag: finance-research
entryUrls:
  - https://xueqiu.com/
  - https://xueqiu.com/S/
  - https://xueqiu.com/hq
riskFloor: low
hints:
  - "用户已在 Chrome 登录雪球（HOLA DAY 继承登录态，不做授权）。未登录 → awaiting_user 提示登录。"
  - "Skill 入口就是雪球自选股页（https://xueqiu.com/hq）；若用户意图明确到个股（例如茅台），commander 可 goto 对应的 https://xueqiu.com/S/SH600519 页直接聚合。"
  - "默认时间窗=今日（9:30 开盘到当前）；intent 指定则按指定（如近 3 日、本周）。"
  - "每只自选股采集：代码、名称、现价、涨跌幅、当日量比、相关新闻 top 3、雪球讨论区热帖 top 3。"
  - "单次采集上限：自选股 20 只（超过按涨跌幅排序取 top 20）+ 每股新闻 3 条 + 每股帖子 3 条。避免长任务。"
  - "输出结构化 JSON；commander 组装 Markdown（盘面综述 3-5 句 + 每股 mini-summary + 需要关注的异常）。"
caveats:
  - "雪球的持仓模块（组合 / 调仓）只读取可见数字，不触发任何调仓 / 交易 / 发帖动作。"
  - "雪球的行情数据延时（通常 15 分钟），结果里必须标注 delay；commander 不许基于雪球数据推断实时成交。"
  - "自选股页面有懒加载；需要 scroll 到列表末尾再 extract（上限 5 次 scroll）。"
  - "讨论区帖子有付费墙（付费专栏片段），Skill 只 extract 可见标题+预览前 100 字，不尝试解密或绕过付费。"
  - "雪球会对频繁抓取限流；Skill 在单次任务里对同一股代码不重复 goto，commander 规划时要避免把 20 只股都访问详情页。"
  - "合规：与 eastmoney-news-digest 同一红线——只分析、不建议、不给目标价；输出不许出现买/卖/止损/目标价/重仓/满仓等祈使词。见战略 v0.2 §7.3。"
allowedOrigins:
  - "xueqiu.com"
  - "*.xueqiu.com"
  - "*.snssdk.com"
---

# Skill: 雪球自选股动态聚合（xueqiu-portfolio-digest）

## 典型用户意图

> "看一下今天我自选股有什么值得关注的。"
> "过去 3 天我自选里涨得最多的 5 只，每只配一条利好新闻。"
> "帮我整理一下茅台今天的新闻和讨论区观点。"

commander 解析：**时间窗**、**范围**（全自选 / 特定股票 / 涨跌排名前 N）、**附加项**（新闻 / 讨论 / 研报）。

## 登录态检测

同金融姊妹 Skill：第一步 goto 后如果被重定向到 `xueqiu.com/login` 或弹出登录弹窗，直接 awaiting_user 提示"请在 Chrome 登录雪球"。用户登录完点 Resume 继续。

雪球的特殊情况：部分页面未登录也可见（但自选股为空），这种情况 Skill 要识别 extract 到的自选列表长度为 0 → awaiting_user + 提示"未登录或自选为空，请先登录或添加自选"。

## 高层规划模板（commander 参考）

1. `goto` https://xueqiu.com/hq （自选股列表页）
2. `wait` 列表首屏
3. `extract` 自选股列表（代码 / 名称 / 现价 / 涨跌幅 / 量比）
4. 若列表未加载完 → `scroll` 1-5 次直至列表末尾
5. commander 按 intent 过滤（top N / 特定代码 / 涨跌筛选），得到待聚合股代码集
6. 对每只待聚合股（上限 20）：
   - `goto` https://xueqiu.com/S/{code}
   - `wait` 个股页
   - `extract` 当日要闻区（top 3 新闻标题 + 发布时间）
   - `extract` 讨论区热帖 top 3（标题 + 作者 + 赞/评数 + 预览 100 字）
7. 回到自选列表；末步 commander 聚合为 JSON，组装 Markdown

## 风险标注

- 全 `risk: 'low'`（read-only）。
- `riskFloor: low`。
- 不触发任何写动作（发帖 / 点赞 / 关注 / 调仓 / 交易），Skill manifest 的 caveats 作为硬约束。
- 如果 commander 错把"发帖" / "调仓" / "关注"放进 plan：SafetyFilter（W3）会截断；本 Skill 的 caveats 兜一层。

## Selector 要点

| 目标 | role 优先 | text 备选 | css 兜底 |
|---|---|---|---|
| 自选股 tab | `tab` name="自选股" | "自选股" / "我的自选" | `.hq-nav [data-tab="favorites"]` |
| 自选列表行 | `row` / `listitem` | — | `.favorites-list .stock-item` |
| 股票代码单元 | — | — | `.stock-item .code` |
| 现价 / 涨跌 | — | — | `.stock-item .price`, `.stock-item .pct` |
| 个股页 · 当日要闻 | `tab` / `heading` | "要闻" / "新闻" | `.stock-detail .tab-news` |
| 个股页 · 讨论区 tab | `tab` name="讨论" | "讨论" / "帖子" | `.stock-detail [data-tab="discuss"]` |
| 讨论区帖子行 | `article` / `listitem` | — | `.discuss-list .post-item` |
| 付费墙提示 | — | "付费专栏" / "解锁" | `.post-item .paywall` |

W2 Day 4-5 真接入 Playwright-CRX 后抽到 `skills/xueqiu-portfolio-digest/selectors.json`。

## 输出 schema（commander 内部约定）

```json
{
  "window": { "label": "今日", "asOf": "2026-04-30T14:30:00+08:00", "dataDelayMin": 15 },
  "summary": "今日自选 18 涨 4 跌；新能源板块领涨；茅台新闻面清淡。",
  "stocks": [
    {
      "code": "SH600519",
      "name": "贵州茅台",
      "price": "1620.50",
      "pctChange": "+1.23%",
      "volumeRatio": 0.8,
      "news": [
        { "title": "...", "publishedAt": "2026-04-30T10:12:00+08:00", "url": "https://..." }
      ],
      "discuss": [
        {
          "title": "...",
          "author": "...",
          "likes": 87,
          "replies": 34,
          "previewSnippet": "...",
          "paywalled": false,
          "url": "https://..."
        }
      ]
    }
  ]
}
```

## 已知限制（Phase 0）

- 行情延时 15 分钟，commander 和 UI 都必须显式标注。
- 不抓研报 PDF（雪球自身很少挂；真要抓 Phase 1 加独立 skill）。
- 不做 K 线图 OCR。
- 不跨平台合并（不与 eastmoney-news-digest 的新闻去重；用户分别跑两个 Skill，commander 合并逻辑放 W3）。
- 讨论区付费帖直接跳过，只标 `paywalled: true`，不要尝试订阅 / 解码。

## 合规红线

- 只分析、不建议、不给目标价 —— 与 eastmoney-news-digest 同一红线（战略 v0.2 §7.3）。
- 输出 Markdown / JSON 中严格禁止 "买" / "卖" / "止损" / "加仓" / "满仓" / "目标价 X 元" 等祈使词。
- 涉及具体股票的讨论帖原文可引用，但不加二次评论判断（例如不要写 "X 网友分析得很对"）。
- 不缓存任何用户登录态 / Cookie / CSRF token —— 这些都在浏览器里，Skill 不触。

## 参考

- 战略 v0.2 §6.5 金融场景 + §7.3 股市合规红线
- 姊妹 skill：`eastmoney-news-digest`（宏观板块新闻 + 股吧）
- PoC §6.1 A 路径 Playwright-CRX 完全覆盖 goto/wait/extract/scroll
- W2 Day 3 daily report（本件）
