# Phase 1 指令 #2 — A股每日信息聚合 · ②③④ 交接

> 接 step① 之后。**新 session 模型用 Opus**（CRUD + 定时任务是常规实现，不烧 Fable 5）。
> 起手：通读本文 + sprint plan 指令2（在 `docs/HOLADAY_PHASE1_SPRINT_PLAN.md`，若缺则向 BOSS 索取）+ 看 `apps/akshare-mcp/` scaffold。

## 0. 定位（重申）

不是做投研工具，是做**股民的每日信息员工**：盘前簡报 / 盘后复盘 / 即时问答（异动归因、财报/公告解读）。数据层改用 **AkShare 不逆向东财**（BOSS 修订）。

## 1. 已完成（step①，commit 链 `6f967e6` scaffold + `a0c5839` 核对）

**scaffold 位置：`apps/akshare-mcp/`**（参考 lijinly-akshare_mcp_server 裁剪的薄版 Python MCP server）。

6 个 MCP 工具（`akshare_mcp/server.py`，每个带 TTL 缓存 + `{data,count,source,fetched_at,disclaimer}` 封装 + 错误优雅降级）：

| 工具 | 用途 | TTL | akshare 函数 |
|---|---|---|---|
| `get_stock_quote(symbol)` | 行情实时 | 15s | `stock_bid_ask_em` |
| `get_stock_kline(symbol,period,start_date,end_date,adjust)` | K线 | 300s | `stock_zh_a_hist` |
| `get_stock_announcements(symbol,start_date,end_date)` | 公告(巨潮) | 1800s | `stock_zh_a_disclosure_report_cninfo` |
| `get_dragon_tiger(start_date,end_date)` | 龙虎榜 | 3600s | `stock_lhb_detail_em` |
| `get_northbound_flow()` | 北向资金 | 60s | `stock_hsgt_fund_flow_summary_em` |
| `get_index_quote(market)` | 港/美股指数 | 60s | `stock_hk_index_spot_em` / `index_us_stock_sina` |

结构：`server.py`(工具) · `adapters.py`(唯一调 `ak.*`，版本敏感) · `cache.py`(进程内 TTL，单测过)。TTL 全 env 可覆盖（`AKSHARE_MCP_TTL_*`）。

**akshare 核对结论（`a0c5839`，实跑 akshare 1.18.64）：**
- **7 个函数名全部有效，无重命名。**
- 公告 / 龙虎榜 / 北向 / 美股指数 实测返数；quote/kline/港股指数 走
  `push2.eastmoney.com`——本机代理不可达，但**从 Vultr 可达**
  （push2→302 / push2his→200）= **部署位置全部源 OK**。
- `index_us_stock_sina` 返的是历史 OHLCV，adapters 已改**取末行=最新收盘**。

## 2. ②③④ 顺序 + 停点

**② 自选股 CRUD**
- **复用现有「收藏/stars」架构**（sprint plan 指令2 要求）。先摸 `apps/orchestrator/src/db/schema/`（找 stars/favorites/收藏 相关，参考 migration 0012 phase16_stars_projects）+ 对应 tRPC router。
- 能复用 stars 表（star 一个股票代码）就**不开新表**；若必须新表 → 见 §3 migration 铁律。
- 交付：用户股票清单的增/删/查（tRPC），SPA 入口可后置。

**③ 盘前/盘后简报模板 + BullMQ 定时**
- 盘前簡报（8:00-9:15 推/定时）：隔夜外围 3 行 + 自选股相关公告摘要 + 今日关键事项（解禁/新股/数据）。
- 盘后复盘（15:00 后推/定时）：大盘+自选股当日表现 + 龙虎榜/北向异动(与自选股相关) + 自选股新公告解读。
- 复用现有定时任务系统（scheduled-runner / Phase 26 BullMQ）。
- 数据全走上面 6 个 MCP 工具。

**④ 即时问答路由到 a-share skill（Skill Router 首个实际场景）**
- "宁德时代今天为什么跌" → 行情+新闻+公告交叉归因；"看比亚迪年报" → 结构化解读。
- 路由到 `skills/a-share-analyst/`（已存在，见 memory `project_p0_expert_skills_2026-05-28`）。

**⛔ 停点（BOSS 指令）**：**简报内容出第一版就停**，交 BOSS + Claude 看内容质量，**通过再继续**。不要一口气把 ②③④ 全凿完不回头。

## 3. migration 铁律（必须遵守）

摸完收藏架构后，**无论复用还是新表，schema 方案先报 BOSS 确认再 apply**。
- `DEPLOY_CHECKLIST.md` RULE 1：**先在线上库 apply migration，再部署/重启代码**（drizzle 生成的 SQL 含 schema 全部列，顺序反了 "Unknown column" 500 打挂线上）。
- 任何 migration / Aliyun 配置 / 破坏性操作 **必须先问 BOSS**（`docs/DEPLOY_RUNBOOK.md` §3）。

## 4. RULE 0 + 部署约定（`docs/DEPLOY_RUNBOOK.md`）

- 共享 clone：部署脚本 `git reset --hard` 清未提交改动。提交永远 `git add <具体路径>` **绝不 `-A`**；先 `git status` 看树。
- `.claude/ qa-artifacts/ skills/{a-share-analyst,content-creator,marketing-expert}/` 约定 untracked，**别动**。
- browse skill 偷加 `.gitignore` 的 `.gstack/`，提交前 `git checkout -- .gitignore`。
- orchestrator 部署默认 BOSS-gated；deploy-orchestrator.sh 已修好（`--update-env` + 进程内 key 校验 + 失败回滚）。
- 凭据：仓库根 `.env.deploy.local`（`set -a && source .env.deploy.local && set +a`）。Vultr `207.148.70.106`，env 在 `apps/orchestrator/.env`（pm2 重读）。

## 5. 合规红线（数据层 + skill 层都守）

只聚合不荐股 · 每条带来源+时间戳 · 固定免责声明 · 不预测股价。（数据层 envelope 已内置；skill 输出也要守。）

## 6. 接 orchestrator MCP provider（落地点）

akshare-mcp 是独立 Python MCP server（`python -m akshare_mcp.server`，stdio）。orchestrator 的 MCP provider 层（找 `mcp-providers.ts` / `.mcp.json` 约定）注册它；a-share skill 通过工具取数。落地前：在 Vultr 上 `pip install -e apps/akshare-mcp` 或建独立 venv，确认 6 工具实跑返数（push2.eastmoney 已验从 Vultr 可达）。
