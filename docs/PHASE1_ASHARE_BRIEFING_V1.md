# Phase 1 指令 #2 ③ — A股盘前/盘后简报 · 内容 v1（评审用）

> **⛔ 这是 BOSS 指令的「停点」交付物。** 简报内容出第一版即停，交 BOSS + Claude
> 评审「内容质量 / 版式 / 合规 / 数据缺口」，**通过再继续**（定时投递 + ④ 即时问答）。
>
> 关联：交接 `docs/PHASE1_ASHARE_HANDOFF.md`、数据层 `apps/akshare-mcp/`。
> 渲染器实现 `apps/orchestrator/src/agent/a-share/`（types / renderer / fixtures / test）。

---

## 1. 这一版做了什么 / 没做什么

**做了（②③ 的「内容引擎」部分，已本地验证）：**
- **② 自选股 CRUD** —— `watchlists` 表 + tRPC `list/add/remove/update`（幂等增删、唯一键防重复）。
  schema/migration 已写（`0032`），**线上未 apply**（migration 铁律，待 BOSS 批）。
- **③ 简报模板 + 确定性渲染器** —— 盘前/盘后两篇，纯函数渲染，每行带来源+时间戳，
  固定免责，**不预测、不荐股**。下方第 4 节是**渲染器的真实输出**（非手写 mock，
  `tsx scripts/render-briefing-sample.ts` 可复现；13 个单测含合规哨兵）。

**没做（待本评审通过后继续）：**
- ❌ 真接 AkShare MCP 取数（§6 落地点；本机不可达 push2.eastmoney，需 Vultr）。
- ❌ 定时投递（复用 in-process `scheduled-runner`，**非 BullMQ**——见 §6）。
- ❌ 通知投递（inbox + 企业微信/飞书 webhook）。
- ❌ ④ 即时问答路由到 `skills/a-share-analyst/`。

> **为什么先停在「内容」**：3 个数据缺口（§5）会决定要不要先扩 akshare-mcp 工具，
> 直接影响简报能覆盖到什么。先把内容/版式/合规定下来，再投钱做投递管线，省返工。

---

## 2. 设计取向：确定性模板（合规优先）

简报 v1 **不走 LLM 自由生成**，走**确定性模板拼装**：

| 维度 | 确定性模板（v1 选用） | LLM 自由生成（未选） |
|---|---|---|
| 数字可溯源 | ✅ 每个数字来自某个工具 envelope | ⚠️ 可能臆造 |
| 不预测/不荐股 | ✅ 模板里根本不存在建议措辞 | ⚠️ 需 prompt 约束 + 事后校验 |
| 来源+时间戳 | ✅ 每行强制带 | ⚠️ 易漏 |
| 可回归测试 | ✅ 单测哨兵锁死合规 | ⚠️ 难 |

> LLM 的「解读 / 异动归因 / 财报解读」属 **④ 即时问答** + **简报 v2 增强**，须单独合规评审
> （bounded：只对已抓取的公告正文做摘要，不外推、不给观点）。v1 的「解读」= 中性结构化罗列。

---

## 3. 模板结构 · 每段 → 工具映射

### 盘前简报（拟 08:00–09:15 投递）
| 段 | 内容 | 数据来源工具 | 状态 |
|---|---|---|---|
| 一、隔夜外围 | 标普500 收盘 + 恒生指数涨跌幅 | `get_index_quote('us')` `('hk')` | ⚠️ G1 |
| 二、自选股相关公告 | 每只股近 3 条公告（标题+时间+巨潮链接） | `get_stock_announcements(symbol)` | ✅ |
| 三、今日关键事项 | 解禁/新股/数据 | —（无工具，关键词兜底） | ⚠️ G2 |

### 盘后复盘（拟 15:00 后投递）
| 段 | 内容 | 数据来源工具 | 状态 |
|---|---|---|---|
| 一、大盘资金面 | 北向资金净买额（兼作大盘代理） | `get_northbound_flow()` | ⚠️ G3 |
| 二、自选股当日表现 | 收盘/涨跌幅/成交额表格 | `get_stock_kline(symbol)` 末行 | ✅ |
| 三、龙虎榜/北向异动 | 自选股命中的龙虎榜（按代码过滤） | `get_dragon_tiger(today)` | ✅ |
| 四、自选股新公告 | 当日新公告罗列 | `get_stock_announcements(symbol)` | ✅ |

合规封装（每篇）：标题 + 日期(周几) + 生成时间 → 各段带「来源 X · 抓取 HH:MM」→ 结尾固定免责。

---

## 4. 渲染器真实输出（示例数据）

> ⚠️ 下方为**示例数据**渲染（fixtures，非实时行情），仅供评审内容/版式/合规。
> 示例自选股：贵州茅台(600519) / 宁德时代(300750) / 平安银行(000001)。

### 4.1 盘前简报

```markdown
# 📋 HOLA DAY · A股盘前简报
**2026-06-11（周四）** ｜ 生成于 08:30

## 一、隔夜外围
- 标普500（.INX）：收 5,433.21（来源 akshare:index_us_stock_sina(latest) · 抓取 08:25）
  - ⚠️ G1 隔夜涨跌幅暂缺：us 工具现取末 1 行，算涨跌幅需末 2 行；且暂缺道指/纳指。
- 恒生指数：18,756.40，+0.92%（来源 akshare:stock_hk_index_spot_em · 抓取 08:25）

## 二、自选股相关公告
**贵州茅台（600519）**
- 06-10 贵州茅台2025年年度权益分派实施公告 — [巨潮](http://www.cninfo.com.cn/...example1)
- 06-09 贵州茅台关于召开2025年年度股东大会的通知 — [巨潮](http://www.cninfo.com.cn/...example2)
  （来源 akshare:stock_zh_a_disclosure_report_cninfo · 抓取 08:26）
**宁德时代（300750）**
- 近期无新公告
**平安银行（000001）**
- 06-10 平安银行关于部分董事离任的公告 — [巨潮](http://www.cninfo.com.cn/...example3)
  （来源 akshare:stock_zh_a_disclosure_report_cninfo · 抓取 08:26）

## 三、今日关键事项（解禁 / 新股 / 数据）
> ⚠️ G2 数据缺口：解禁 / 新股 / 经济数据日历当前 6 个 MCP 工具未覆盖。
> v1 仅从自选股公告标题提取「疑似」事项（关键词命中），完整日历需新增数据源。
- 贵州茅台（600519）：贵州茅台2025年年度权益分派实施公告（疑似「权益分派」）
- 贵州茅台（600519）：贵州茅台关于召开2025年年度股东大会的通知（疑似「股东大会」）

---
> **免责声明**：本简报仅聚合公开市场信息，不构成任何投资建议，不预测涨跌；数据来源 AkShare（可能延迟或有误），请以交易所及上市公司公告为准。
```

### 4.2 盘后复盘

```markdown
# 📊 HOLA DAY · A股盘后复盘
**2026-06-11（周四）** ｜ 生成于 15:30

## 一、大盘资金面
> ⚠️ G3 数据缺口：A股三大指数（上证/深证/创业板）暂无对应 MCP 工具，以北向资金作市场资金面参考。
- 沪股通：净买额 25.30 亿元
- 深股通：净买额 16.88 亿元
  （来源 akshare:stock_hsgt_fund_flow_summary_em · 抓取 15:25 ｜ 单位以接口为准）

## 二、自选股当日表现
| 名称 | 代码 | 收盘 | 涨跌幅 | 成交额 |
| --- | --- | ---: | ---: | ---: |
| 贵州茅台 | 600519 | 1,580.00 | +1.23% | 38.20亿 |
| 宁德时代 | 300750 | 198.50 | -0.85% | 41.00亿 |
| 平安银行 | 000001 | 11.30 | +0.45% | 12.00亿 |

（来源 akshare:stock_zh_a_hist · 抓取 15:25）

## 三、龙虎榜 / 北向异动（与自选股相关）
- 宁德时代（300750）：日跌幅偏离值达7%的证券 ｜ 龙虎榜净买额 1.20亿
  （来源 akshare:stock_lhb_detail_em · 抓取 15:25）

## 四、自选股新公告
**贵州茅台（600519）**
- 06-11 贵州茅台2025年年度权益分派实施公告 — [巨潮](http://www.cninfo.com.cn/...example4)
  （来源 akshare:stock_zh_a_disclosure_report_cninfo · 抓取 15:26）
**宁德时代（300750）**
- 近期无新公告
**平安银行（000001）**
- 近期无新公告

---
> **免责声明**：本简报仅聚合公开市场信息，不构成任何投资建议，不预测涨跌；数据来源 AkShare（可能延迟或有误），请以交易所及上市公司公告为准。
```

---

## 5. 数据缺口（vs 交接 wishlist）—— ⭐需 BOSS 决策

6 个 MCP 工具覆盖不到交接模板里的 3 处，**直接影响简报完整度**：

| # | 缺口 | 现状兜底 | 补法（需扩 akshare-mcp） |
|---|---|---|---|
| **G1** | 隔夜外围只有标普500(.INX) 收盘，**无涨跌幅、缺道指/纳指** | 只显示标普收盘 + 提示 | us adapter 取**末 2 行**算涨跌幅；加 `.DJI/.IXIC` |
| **G2** | **解禁 / 新股 / 经济数据日历**无任何工具 | 从公告标题关键词提「疑似」 | 加工具：`stock_share_unlock`(解禁) / 新股日历 / 财经日历 |
| **G3** | **A股三大指数**（上证/深证/创业板）无工具 | 用北向资金当资金面代理 | 加工具：`stock_zh_index_spot_em` 或 sina 指数 |

**决策选项**：
- **(A)** 先扩 akshare-mcp 补 G1/G3（小，各 1 个 adapter；最影响每日观感），G2 暂留关键词兜底 → 再继续投递管线。
- **(B)** v1 就按现状（带缺口提示）上，3 个缺口列入 backlog，先把投递+④打通。
- **(C)** 其他（BOSS 指定优先级 / 砍某段）。

---

## 6. 通过评审后的「继续」计划（落地路径）

1. **真接数据层（交接 §6）**：Vultr 上 `pip install -e apps/akshare-mcp`，orchestrator 起子进程
   连 stdio MCP（**当前 orchestrator 无任何外部 MCP 接入，是新路**——需确认 Agent SDK 的 MCP 形式）。
   渲染器的注入点已留好（types 即工具 envelope 形状）。
2. **定时投递**：复用 `apps/orchestrator/src/agent/scheduled-runner.ts`（in-process 轮询，**非 BullMQ**；
   交接写 BullMQ 但实际系统是这个）。建两条 `scheduled_tasks`（盘前 daily 08:30 / 盘后 daily 15:30，
   `timezone='Asia/Shanghai'`），dispatch 回调识别简报 intent → 取自选股 → 调工具 → 渲染。
3. **投递**：复用 notifications（inbox + 企业微信/飞书 webhook），把渲染 markdown 作 message。
4. **④ 即时问答**：`expert-workflow-registry` 加 a-share matcher，路由到 `skills/a-share-analyst/`；
   行情+公告+龙虎榜交叉（异动归因走 LLM，须合规约束）。

---

## 7. 评审请关注

1. **版式/段落**：四段够不够？顺序对不对？盘前要不要加「自选股隔夜 ADR/港股」？
2. **「解读」边界**：v1 公告只罗列标题（中性）。要不要 v2 加 bounded LLM 摘要？合规怎么守？
3. **数据缺口**：§5 选 A / B / C？
4. **合规措辞**：免责声明文案、来源标注格式（`来源 X · 抓取 HH:MM`）是否 OK？
5. **投递渠道**：默认推哪？（App 内 inbox / 企业微信 / 飞书）

> 评审 OK 后我按 §6 继续；migration `0032` 的线上 apply 仍单独走 BOSS 确认（先库后码）。

---

## 8. 选1扩展版执行结果（2026-06-11，评审通过后）

BOSS 评审通过并选「1 扩展版」。已落地（本地验证：typecheck 0 错、16 简报测 + watchlist 9 测 + akshare pct 测全绿、biome 干净）：

| 项 | 改动 | 缺口状态 |
|---|---|---|
| ② 预留列 | `watchlists` 加 `alert_config_json JSON NULL`（提醒阈值用，本期不实现/不暴露） | — |
| **G1** | akshare-mcp `get_index_quote('us')` 返 标普(.INX)/道指(.DJI)/纳指(.IXIC)，sina 末2行算隔夜涨跌幅 | ✅ 已补 |
| **G3** | `get_index_quote('cn')` 返 上证/深证成指/创业板指 实时 spot（最新+涨跌幅+成交额） | ✅ 已补 |
| **G2** | 新增 `get_share_unlock(symbol)` 个股解禁；**新股/财经日历仍 backlog** | 🟡 部分 |
| dev/prod | 渲染器加 `mode`；prod（默认/用户版）剥离全部 `[dev]` 诊断；dev 保留 | — |
| 版式 | 盘后首段「大盘速览」＝指数→成交额→北向；龙虎榜/成交额/北向单位统一「亿元」 | — |
| ⚠️北向降级 | 渲染器检测净买额不可得→降级为成交额并明确标注（2024-08 口径变更，禁用过期口径），含单测 | — |

> **akshare 新函数（index_us_stock_sina .DJI/.IXIC、stock_zh_index_spot_em、stock_restricted_release_queue_em）+ 列名/单位均标 VERIFY on Vultr**（akshare 1.18.64 实跑核对，同 step① 纪律）。注意单位陷阱：cn 指数成交额为「元」(÷1e8)，北向汇总为「亿元」(不除)——真接须核对。

### 8.1 prod（用户版）盘前

```markdown
# 📋 HOLA DAY · A股盘前简报
**2026-06-11（周四）** ｜ 生成于 08:30

## 一、隔夜外围
- 美股：标普500 5,433.21（+0.62%） ｜ 道琼斯 39,200.00（+0.51%） ｜ 纳斯达克 17,050.30（+0.85%）（来源 akshare:index_us_stock_sina(.INX/.DJI/.IXIC,末2行) · 抓取 08:25）
- 恒生指数：18,756.40，+0.92%（来源 akshare:stock_hk_index_spot_em · 抓取 08:25）

## 二、自选股相关公告
**贵州茅台（600519）**
- 06-10 贵州茅台2025年年度权益分派实施公告 — [巨潮](http://www.cninfo.com.cn/...example1)
- 06-09 贵州茅台关于召开2025年年度股东大会的通知 — [巨潮](http://www.cninfo.com.cn/...example2)
  （来源 akshare:stock_zh_a_disclosure_report_cninfo · 抓取 08:26）
**宁德时代（300750）**
- 近期无新公告
**平安银行（000001）**
- 06-10 平安银行关于部分董事离任的公告 — [巨潮](http://www.cninfo.com.cn/...example3)
  （来源 akshare:stock_zh_a_disclosure_report_cninfo · 抓取 08:26）

## 三、今日关键事项（解禁 / 公告提示）
**限售解禁**
- 贵州茅台（600519）：06-20 解禁（流通市值 18.96亿元）
**公告关键词提示**
- 贵州茅台（600519）：贵州茅台2025年年度权益分派实施公告（疑似「权益分派」）
- 贵州茅台（600519）：贵州茅台关于召开2025年年度股东大会的通知（疑似「股东大会」）

---
> **免责声明**：本简报仅聚合公开市场信息，不构成任何投资建议，不预测涨跌；数据来源 AkShare（可能延迟或有误），请以交易所及上市公司公告为准。
```

### 8.2 prod（用户版）盘后

```markdown
# 📊 HOLA DAY · A股盘后复盘
**2026-06-11（周四）** ｜ 生成于 15:30

## 一、大盘速览
- 指数：上证指数 3,125.40（+0.42%） ｜ 深证成指 9,842.70（+0.18%） ｜ 创业板指 1,987.30（-0.25%）
- 成交额：上证指数 4350.00亿元 ｜ 深证成指 3800.00亿元 ｜ 创业板指 1600.00亿元
  （来源 akshare:stock_zh_index_spot_em(沪深重要指数) · 抓取 15:25）
- 北向资金：沪股通 净买额 +25.30亿元 ｜ 深股通 净买额 +16.88亿元（来源 akshare:stock_hsgt_fund_flow_summary_em · 抓取 15:25）

## 二、自选股当日表现
| 名称 | 代码 | 收盘 | 涨跌幅 | 成交额 |
| --- | --- | ---: | ---: | ---: |
| 贵州茅台 | 600519 | 1,580.00 | +1.23% | 38.20亿元 |
| 宁德时代 | 300750 | 198.50 | -0.85% | 41.00亿元 |
| 平安银行 | 000001 | 11.30 | +0.45% | 12.00亿元 |

（来源 akshare:stock_zh_a_hist · 抓取 15:25）

## 三、龙虎榜（自选股上榜）
- 宁德时代（300750）：日跌幅偏离值达7%的证券 ｜ 龙虎榜净买额 +1.20亿元
  （来源 akshare:stock_lhb_detail_em · 抓取 15:25）

## 四、自选股新公告
**贵州茅台（600519）** …（同盘前格式）

---
> **免责声明**：（同上）
```

> dev 版在此基础上多 `[dev]` 诊断行（如「[dev] G2 …新股日历/财经数据日历仍 backlog」、北向降级诊断）。
> 复现：`pnpm --filter @holaday/orchestrator exec tsx scripts/render-briefing-sample.ts`。

### 8.3 §6 集成 — 已建（可测）vs 待 Vultr（gated）

**已建 + 本地单测（transport-agnostic 组合层）：**
- `agent/a-share/akshare-client.ts` —— `AkshareClient` 接口（6+1 工具契约）+ `StubAkshareClient`（传输未接入时返 error envelope，简报优雅降级不崩）。
- `agent/a-share/briefing-service.ts` —— `listWatchlistForUser(db,uid)` + `buildPremarketBriefing` / `buildPostmarketBriefing`（watchlist→并发取数→prod 渲染出 markdown，注入 client/now 可测）。
- `briefing-service.test.ts`（6 测）：组合正确、北京日期、龙虎榜 compact 日期、Stub 降级、空自选股、dev 透传。

**待 Vultr（gated，须实跑/部署/BOSS）：**
1. **传输实现**（`AkshareClient` 真身）—— orchestrator **无 @modelcontextprotocol/sdk**，候选：(a) 引入 MCP SDK + spawn `python -m akshare_mcp.server` stdio；(b) akshare-mcp 之上加薄 FastAPI，HTTP 直取。**确定性简报不走 LLM**，倾向 (b) 更简单可控。**需 BOSS 拍板 a/b**。
2. **scheduled-runner 分支**（`index.ts:385` dispatch 回调）—— 识别简报 intent（拟 sentinel `__ashare_premarket__`/`__ashare_postmarket__`）→ 调 briefing-service → `notify()` 写 inbox + webhook。需定 dispatch 回调对「非 task 投递」的返回值契约（last_task_id 语义）。
3. **两条 `scheduled_tasks`**：盘前 daily 08:30 / 盘后 daily 15:30，`timezone='Asia/Shanghai'`（每用户 opt-in 还是系统级？需定）。
4. **⚠️ item4 北向口径**：Vultr 真接**第一件事**实测 `stock_hsgt_fund_flow_summary_em` 当天返回——确认净买额字段在否。渲染器已内置降级（净买额缺→成交额+标注），但**禁止用过期口径上线**。
5. **新 akshare 函数 Vultr 实跑核对**（G1/G3/G2 的 .DJI/.IXIC、stock_zh_index_spot_em、stock_restricted_release_queue_em）+ 单位（cn 成交额「元」vs 北向「亿元」）。
6. **migration `0032` 线上 apply**（含 `alert_config_json`）+ orchestrator 部署 —— 均 BOSS-gated，先库后码。
