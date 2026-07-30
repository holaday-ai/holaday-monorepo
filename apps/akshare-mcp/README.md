# akshare-mcp

Thin **MCP wrapper over [AkShare](https://akshare.akfamily.xyz/)** for A股
股民每日信息. Sprint plan 指令 2 的数据层 —— **改用 AkShare 而非逆向东方
财富私有接口**（BOSS 修订）。参考 `lijinly-akshare_mcp_server` 形态裁剪成
薄版：固定的窄接口范围 + 每个接口一层缓存。

> Scaffold 状态：结构 / 工具契约 / 缓存 / 合规封装齐全；`adapters.py` 里的
> AkShare 函数名是**最佳已知值，落地前须按安装版本核对**（见下）。

## 接口范围（窄，仅股民每日信息）

| MCP 工具 | 用途 | 缓存 TTL |
|---|---|---|
| `get_stock_quote(symbol)` | 行情 — 单股票分钟快照（最新价/成交量/成交额） | 15s |
| `get_stock_kline(symbol, period, start_date, end_date, adjust)` | 行情 — 历史 K 线 | 300s |
| `get_stock_announcements(symbol, start_date, end_date)` | 公告（巨潮） | 1800s |
| `get_dragon_tiger(start_date, end_date)` | 龙虎榜 | 3600s |
| `get_northbound_flow()` | 北向资金流向 | 60s |
| `get_index_quote(market)` | 港/美/A股指数（hk/us/cn） | 60s |
| `get_stock_rankings(metric, limit)` | A股榜单（gainers/losers/amount） | 300s |
| `get_share_unlock(symbol)` | 个股限售解禁（G2） | 3600s |

个股 quote 与分时图共享 `stock_zh_a_minute(sina)` 单股票缓存；榜单继续使用
`stock_zh_a_spot(sina)` 全市场缓存。单股票分钟源失败时 quote 才退回全市场真实快照。
TTL 全部 env 可覆盖（`AKSHARE_MCP_TTL_*`，见 `.env.example`）。

## 结构

```
apps/akshare-mcp/
├── akshare_mcp/
│   ├── server.py     # FastMCP 工具 + 来源/时间戳/免责封装 + 错误降级
│   ├── http_server.py # 同机 HTTP transport，供 orchestrator 直取
│   ├── adapters.py   # ← 唯一调用 ak.* 的地方（版本敏感，集中于此）
│   └── cache.py      # 进程内 TTL 缓存（stdlib，无 Redis 依赖）
├── tests/test_cache.py
├── pyproject.toml / requirements.txt / .env.example
```

`server.py` 的工具契约稳定；AkShare 改接口名时只动 `adapters.py`。

## 运行

```bash
cd apps/akshare-mcp
python -m venv .venv && . .venv/bin/activate
pip install -e .          # 或 pip install -r requirements.txt
python -m akshare_mcp.server   # stdio MCP transport
```

HTTP transport（生产使用，同机 orchestrator 直取；只监听 `127.0.0.1`，不可对公网暴露）：

```bash
cd apps/akshare-mcp
python -m akshare_mcp.http_server
curl -fsS http://127.0.0.1:8848/healthz
curl -fsS 'http://127.0.0.1:8848/stock-rankings/gainers?limit=3'
```

测试（仅缓存层，无需联网）：`pip install -e '.[dev]' && pytest`。

本地或生产 smoke：

```bash
AKSHARE_HTTP_URL=http://127.0.0.1:8848 scripts/smoke-akshare-mcp.sh
```

## 合规红线（数据层内置 + 每条结果重申）

- **只聚合 + 结构化，绝不给买卖建议、不预测股价**。
- 每条结果封装 `{ data, count, source, fetched_at, disclaimer }` ——
  带来源 + UTC 时间戳 + 固定免责。
- 接口失败优雅降级为 `{ error, data: [] }`，不抛崩 agent。

## 接入 HOLA DAY orchestrator

生产链路采用薄 HTTP：orchestrator 通过 `AKSHARE_HTTP_URL`
（默认 `http://127.0.0.1:8848`）直取 akshare-mcp，a-share-analyst skill 和
股票任务页复用同一批确定性数据。不要把该 HTTP 服务暴露到公网；它是无鉴权的同机数据服务。

部署：

```bash
scripts/deploy-akshare-mcp.sh
scripts/deploy-current.sh akshare
scripts/deploy-current.sh orchestrator # 会先部署 akshare-mcp，再部署 orchestrator
scripts/deploy-current.sh both         # SPA + akshare-mcp + orchestrator
```

PM2 进程名：`akshare-mcp-http`。日志默认写入 `/var/log/holaday/akshare-mcp-http.*.log`。

## ⚠️ 已知限制（2026-06-12 Vultr `207.148.70.106` 实测 akshare 1.18.64）

**真实环境验证换来的知识——不要再信交接文档「push2 从 Vultr 可达」的旧前提**
（step① 大概只看了 HTTP 302/200，没看真实 akshare 数据调用）。

1. **`push2.eastmoney.com` 从 Vultr 不可达**（`RemoteDisconnected` ×4，非瞬时，疑 IP
   层封）。原走 push2/push2his 的 4 个接口已在 `adapters.py` 改走 **sina**（不同基础
   设施，实测可达）：

   | 用途 | 原（push2，死） | 现（sina，活） |
   |---|---|---|
   | 行情 quote | `stock_bid_ask_em` | `stock_zh_a_minute` 单股票分钟快照；失败退 `stock_zh_a_spot` |
   | 日 K 线 | `stock_zh_a_hist` | `stock_zh_a_daily`（末 2 行算涨跌幅） |
   | A股指数 spot | `stock_zh_index_spot_em` | `stock_zh_index_spot_sina`（取 sh000001/sz399001/sz399006） |
   | 港股指数 spot | `stock_hk_index_spot_em` | `stock_hk_index_spot_sina`（按名称取恒生指数） |

   仍可达（未动）：公告 `..._cninfo`、龙虎榜/解禁/北向 `..._em`(datacenter)、美股 `index_us_stock_sina`。

2. **北向资金净买额自 2024-08 停披露**：`stock_hsgt_fund_flow_summary_em` 的北向（沪股通/
   深股通）`成交净买额` 实测恒为 `0.0`（南向港股通仍有值）。**`0.0` 不是真零，是「停披露」**
   —— 消费侧（简报渲染器）把北向 0.0/null 整行省略，**禁用过期口径上线**。该接口仍提供
   上涨/下跌数(breadth)、相关指数 + 涨跌幅 等有效字段。

3. **龙虎榜含官方 `解读` 列**：`stock_lhb_detail_em` 自带一行中性解读（如「主力做T」），
   零成本接入盘后简报（非我们生成，合规）。

4. **全市场榜单只提供可验证字段**：当前可稳定取得涨幅榜、跌幅榜、成交额榜；
   换手率榜源暂未纳入，不用模拟字段补假数据。消费侧应禁用换手率 tab 或展示数据源说明。

> 升级 AkShare 后用 `pip show akshare` 看版本，对照 <https://akshare.akfamily.xyz/>
> 核对 `adapters.py` 里的 `ak.*`（集中于此，工具契约不变）。

## 待接（scaffold 之后）

自选股 CRUD、盘前/盘后简报模板 + 定时任务(BullMQ)、即时问答路由到
a-share-analyst skill —— 见 sprint plan 指令 2。
