"""Thin AkShare adapter layer.

This is the ONLY place that names AkShare functions. AkShare renames /
moves interfaces between releases, so when wiring this up run
`pip show akshare` and verify each `ak.<fn>` below against
https://akshare.akfamily.xyz/ for the installed version — the tool
contracts in server.py stay stable while these calls get adjusted.

VERIFIED 2026-06-11 against **akshare 1.18.64** (实跑核对):
  - 全部 7 个函数名有效（无重命名）。
  - 实测返数: 公告(cninfo) / 龙虎榜 / 北向资金 / 美股指数(sina) ✓
  - 走 push2.eastmoney.com 的 3 个（quote / kline / 港股指数）从本机代理
    不可达（ProxyError）—— 函数名 OK，**部署位置须确认 push2.eastmoney.com
    可达**（国内/新加坡多数可达；本机环境有代理拦截）。
  - 美股 index_us_stock_sina(".INX") 返的是**历史 OHLCV**（date/open/high/
    low/close/volume），非实时 spot —— get_index_quote 取末行=最新收盘。

Scope (per the sprint plan, intentionally NARROW — 股民每日信息 only):
  行情      get_quote / get_kline
  公告      get_announcements
  龙虎榜    get_dragon_tiger
  北向资金  get_northbound_flow
  港美股指数 get_index_quote

Compliance: this is a DATA layer only — aggregation, never advice. Every
result is wrapped with source + timestamp + disclaimer by server.py. No
buy/sell signals, no price prediction.
"""

from __future__ import annotations

import os
from typing import Any

try:
    import akshare as ak  # type: ignore
except Exception:  # pragma: no cover - akshare optional at import time
    ak = None  # type: ignore


# --- per-interface TTLs (seconds), env-overridable -------------------
def _ttl(name: str, default: int) -> int:
    raw = os.environ.get(f"AKSHARE_MCP_TTL_{name}")
    if raw and raw.isdigit():
        return int(raw)
    return default


TTL_QUOTE = _ttl("QUOTE", 15)
TTL_KLINE = _ttl("KLINE", 300)
TTL_ANNOUNCE = _ttl("ANNOUNCE", 1800)
TTL_LHB = _ttl("LHB", 3600)
TTL_NORTHBOUND = _ttl("NORTHBOUND", 60)
TTL_INDEX = _ttl("INDEX", 60)

# Row caps so a single tool call can't dump thousands of rows into the
# model's context.
MAX_ROWS = int(os.environ.get("AKSHARE_MCP_MAX_ROWS", "50"))


class AkShareUnavailable(RuntimeError):
    """Raised when akshare isn't importable or an interface call fails."""


def _require_ak() -> Any:
    if ak is None:
        raise AkShareUnavailable(
            "akshare 未安装或导入失败，请 `pip install akshare`"
        )
    return ak


def _records(df: Any, limit: int = MAX_ROWS) -> list[dict[str, Any]]:
    """DataFrame → JSON-safe list[dict], capped + NaN-cleaned."""
    if df is None:
        return []
    try:
        import pandas as pd  # noqa: F401  (akshare pulls pandas)

        capped = df.head(limit)
        # to_dict('records') keeps column order; cast non-serialisable
        # (Timestamp / numpy) via str fallback.
        out: list[dict[str, Any]] = []
        for row in capped.to_dict(orient="records"):
            clean: dict[str, Any] = {}
            for k, v in row.items():
                try:
                    import math

                    if isinstance(v, float) and math.isnan(v):
                        clean[str(k)] = None
                        continue
                except Exception:
                    pass
                clean[str(k)] = v if _json_safe(v) else str(v)
            out.append(clean)
        return out
    except Exception as exc:  # pragma: no cover
        raise AkShareUnavailable(f"结果解析失败: {exc}") from exc


def _json_safe(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


# --- 行情 ------------------------------------------------------------
def get_quote(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """实时行情（买卖盘 + 最新价）。symbol 形如 '600519' / '000001'。"""
    a = _require_ak()
    # Name verified (akshare 1.18.64). Source = push2.eastmoney.com —
    # confirm reachable from the deploy host. Alt: ak.stock_zh_a_spot_em()
    # then filter by 代码 == symbol (heavier, all-market snapshot).
    df = a.stock_bid_ask_em(symbol=symbol)
    return _records(df), "akshare:stock_bid_ask_em"


def get_kline(
    symbol: str,
    period: str = "daily",
    start_date: str = "",
    end_date: str = "",
    adjust: str = "qfq",
) -> tuple[list[dict[str, Any]], str]:
    """历史 K 线。period: daily/weekly/monthly；adjust: qfq/hfq/''。"""
    a = _require_ak()
    kwargs: dict[str, Any] = {"symbol": symbol, "period": period, "adjust": adjust}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date
    df = a.stock_zh_a_hist(**kwargs)
    return _records(df), "akshare:stock_zh_a_hist"


# --- 公告 ------------------------------------------------------------
def get_announcements(
    symbol: str, start_date: str = "", end_date: str = ""
) -> tuple[list[dict[str, Any]], str]:
    """个股公告（巨潮）。symbol 形如 '600519'。"""
    a = _require_ak()
    # Verified (akshare 1.18.64): 35 rows, cols 代码/简称/公告标题/
    # 公告时间/公告链接. cninfo source reachable from most locations.
    kwargs: dict[str, Any] = {"symbol": symbol}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date
    df = a.stock_zh_a_disclosure_report_cninfo(**kwargs)
    return _records(df), "akshare:stock_zh_a_disclosure_report_cninfo"


# --- 龙虎榜 ----------------------------------------------------------
def get_dragon_tiger(
    start_date: str, end_date: str = ""
) -> tuple[list[dict[str, Any]], str]:
    """龙虎榜明细。日期形如 '20260611'。end_date 省略时同 start_date。"""
    a = _require_ak()
    df = a.stock_lhb_detail_em(
        start_date=start_date, end_date=end_date or start_date
    )
    return _records(df), "akshare:stock_lhb_detail_em"


# --- 北向资金 --------------------------------------------------------
def get_northbound_flow() -> tuple[list[dict[str, Any]], str]:
    """北向资金流向汇总（沪股通 + 深股通）。"""
    a = _require_ak()
    df = a.stock_hsgt_fund_flow_summary_em()
    return _records(df), "akshare:stock_hsgt_fund_flow_summary_em"


# --- 港美股指数 ------------------------------------------------------
def get_index_quote(market: str) -> tuple[list[dict[str, Any]], str]:
    """港/美股主要指数实时行情。market: 'hk' | 'us'。"""
    a = _require_ak()
    m = market.lower()
    if m == "hk":
        df = a.stock_hk_index_spot_em()
        return _records(df), "akshare:stock_hk_index_spot_em"
    if m == "us":
        # Verified: index_us_stock_sina returns HISTORICAL OHLCV — take
        # the latest row as the current close (盘前看隔夜收盘够用).
        df = a.index_us_stock_sina(symbol=".INX")
        latest = df.tail(1) if (df is not None and len(df) > 0) else df
        return _records(latest), "akshare:index_us_stock_sina(latest)"
    raise AkShareUnavailable(f"未知市场 '{market}'，仅支持 hk / us")
