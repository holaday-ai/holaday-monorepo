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
| `get_stock_quote(symbol)` | 行情 — 实时（最新价/买卖盘） | 15s |
| `get_stock_kline(symbol, period, start_date, end_date, adjust)` | 行情 — 历史 K 线 | 300s |
| `get_stock_announcements(symbol, start_date, end_date)` | 公告（巨潮） | 1800s |
| `get_dragon_tiger(start_date, end_date)` | 龙虎榜 | 3600s |
| `get_northbound_flow()` | 北向资金流向 | 60s |
| `get_index_quote(market)` | 港/美股指数（hk/us） | 60s |

TTL 全部 env 可覆盖（`AKSHARE_MCP_TTL_*`，见 `.env.example`）。

## 结构

```
apps/akshare-mcp/
├── akshare_mcp/
│   ├── server.py     # FastMCP 工具 + 来源/时间戳/免责封装 + 错误降级
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

测试（仅缓存层，无需联网）：`pip install -e '.[dev]' && pytest`。

## 合规红线（数据层内置 + 每条结果重申）

- **只聚合 + 结构化，绝不给买卖建议、不预测股价**。
- 每条结果封装 `{ data, count, source, fetched_at, disclaimer }` ——
  带来源 + UTC 时间戳 + 固定免责。
- 接口失败优雅降级为 `{ error, data: [] }`，不抛崩 agent。

## 接入 HOLA DAY orchestrator

注册为 MCP server（stdio）。orchestrator 的 MCP provider 层 spawn
`python -m akshare_mcp.server`，a-share-analyst skill 通过这些工具取数 →
结合 skill 方法论出结构化解读（盘前/盘后简报、即时问答归因）。

## ⚠️ 落地前必做：核对 AkShare 接口名

AkShare 随版本改接口。部署时：

```bash
pip show akshare         # 看版本
```

按版本核对 `adapters.py` 里每个 `ak.*`（标了 `TODO(verify)` 的尤其）：
`stock_bid_ask_em` / `stock_zh_a_hist` / `stock_zh_a_disclosure_report_cninfo`
/ `stock_lhb_detail_em` / `stock_hsgt_fund_flow_summary_em` /
`stock_hk_index_spot_em` / `index_us_stock_sina`。对照
<https://akshare.akfamily.xyz/> 调整即可，工具契约不变。

## 待接（scaffold 之后）

自选股 CRUD、盘前/盘后简报模板 + 定时任务(BullMQ)、即时问答路由到
a-share-analyst skill —— 见 sprint plan 指令 2。
