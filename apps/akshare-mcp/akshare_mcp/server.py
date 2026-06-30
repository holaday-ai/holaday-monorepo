"""AkShare MCP server (thin wrapper) — A股股民每日信息数据层.

Exposes a NARROW set of read-only A-share / 港美股 data tools over MCP,
each backed by a per-interface TTL cache. The HOLA DAY orchestrator (or
the a-share-analyst skill) consumes these instead of reverse-engineering
东方财富's private endpoints.

Tools (scope fixed by the sprint plan; 选1扩展版 +cn 指数 +解禁):
  get_stock_quote        行情 — 实时
  get_stock_kline        行情 — 历史 K 线
  get_stock_announcements 公告
  get_dragon_tiger       龙虎榜
  get_northbound_flow    北向资金
  get_index_quote        港 / 美 / A股指数（hk / us / cn）
  get_share_unlock       个股解禁（G2）

Compliance (red lines, enforced here + restated in every envelope):
  - 只聚合 + 结构化，绝不给买卖建议、不预测股价
  - 每条结果带 source + fetched_at + 固定免责声明

Run:  python -m akshare_mcp.server   (stdio MCP transport)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from . import adapters as adp
from .cache import cached

mcp = FastMCP("akshare-cn")

DISCLAIMER = (
    "数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。"
)


def _envelope(records: list[dict[str, Any]], source: str) -> dict[str, Any]:
    return {
        "data": records,
        "count": len(records),
        "source": source,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
    }


def _safe(fn: Callable[..., tuple[list[dict[str, Any]], str]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run an adapter, wrap success in an envelope, degrade errors to a
    structured payload (the agent should surface, never crash)."""
    try:
        records, source = fn(*args, **kwargs)
        return _envelope(records, source)
    except adp.AkShareUnavailable as exc:
        return {"error": str(exc), "data": [], "count": 0, "disclaimer": DISCLAIMER}
    except Exception as exc:  # noqa: BLE001 - any akshare/network failure
        return {
            "error": f"接口调用失败: {exc}",
            "data": [],
            "count": 0,
            "disclaimer": DISCLAIMER,
        }


# Cached fetches — one TTL per interface (the plan's "每个接口加缓存层").
_quote = cached(adp.TTL_QUOTE)(adp.get_quote)
_intraday = cached(adp.TTL_INTRADAY)(adp.get_intraday)
_kline = cached(adp.TTL_KLINE)(adp.get_kline)
_announce = cached(adp.TTL_ANNOUNCE)(adp.get_announcements)
_lhb = cached(adp.TTL_LHB)(adp.get_dragon_tiger)
_north = cached(adp.TTL_NORTHBOUND)(adp.get_northbound_flow)
_index = cached(adp.TTL_INDEX)(adp.get_index_quote)
_unlock = cached(adp.TTL_UNLOCK)(adp.get_share_unlock)


@mcp.tool()
def get_stock_quote(symbol: str) -> dict[str, Any]:
    """A股个股实时行情（最新价 / 买卖五档 / 涨跌幅等）。

    symbol: 6 位代码，如 '600519'（贵州茅台）、'000001'（平安银行）。
    仅聚合公开行情，不构成投资建议。
    """
    return _safe(_quote, symbol)


@mcp.tool()
def get_stock_intraday(symbol: str) -> dict[str, Any]:
    """A股个股真实分钟线。只返回数据源实际分钟点，不补齐、不外推。"""
    return _safe(_intraday, symbol)


@mcp.tool()
def get_stock_kline(
    symbol: str,
    period: str = "daily",
    start_date: str = "",
    end_date: str = "",
    adjust: str = "qfq",
) -> dict[str, Any]:
    """A股个股历史 K 线。

    period: daily / weekly / monthly。
    start_date / end_date: 'YYYYMMDD'，留空取默认区间。
    adjust: qfq(前复权) / hfq(后复权) / ''(不复权)。
    """
    return _safe(_kline, symbol, period=period, start_date=start_date, end_date=end_date, adjust=adjust)


@mcp.tool()
def get_stock_announcements(
    symbol: str, start_date: str = "", end_date: str = ""
) -> dict[str, Any]:
    """个股公告列表（巨潮）。symbol: 6 位代码。日期 'YYYYMMDD' 可省。"""
    return _safe(_announce, symbol, start_date=start_date, end_date=end_date)


@mcp.tool()
def get_dragon_tiger(start_date: str, end_date: str = "") -> dict[str, Any]:
    """龙虎榜明细。start_date 'YYYYMMDD'；end_date 省略时同 start_date。"""
    return _safe(_lhb, start_date, end_date)


@mcp.tool()
def get_northbound_flow() -> dict[str, Any]:
    """北向资金流向汇总（沪股通 + 深股通净流入等）。"""
    return _safe(_north)


@mcp.tool()
def get_index_quote(market: str) -> dict[str, Any]:
    """港 / 美 / A股主要指数行情。

    market: 'hk'（恒指等）/ 'us'（标普/道指/纳指，含隔夜涨跌幅）/
    'cn'（上证指数/深证成指/创业板指 实时 spot）。
    """
    return _safe(_index, market)


@mcp.tool()
def get_share_unlock(symbol: str) -> dict[str, Any]:
    """个股限售解禁安排（批次 / 解禁时间 / 数量）。symbol: 6 位代码。

    用于盘前简报「今日关键事项」。新股 / 财经日历暂未覆盖（backlog）。
    """
    return _safe(_unlock, symbol)


def main() -> None:
    """Entry point — stdio MCP transport."""
    mcp.run()


if __name__ == "__main__":
    main()
