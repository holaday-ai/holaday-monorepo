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

⚠️ 选1扩展版新增（**待 Vultr 实跑核对 akshare 1.18.64 函数名 + 列名**）：
  - G1 美股三大指数 .INX/.DJI/.IXIC（index_us_stock_sina 各调一次），末 2 行算隔夜涨跌幅。
  - G3 A股三大指数 stock_zh_index_spot_em(symbol="沪深重要指数")，按名称取 上证指数/深证成指/创业板指。
  - G2 个股解禁 stock_restricted_release_queue_em(symbol)。新股 / 财经日历留 backlog。
  - 北向 stock_hsgt_fund_flow_summary_em：2024-08 后净买额披露规则变更，**Vultr 真接第一件事就是验当天返回**，
    若净买额不可得 → 消费侧（渲染器）降级为成交额或移除，禁用过期口径。

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
TTL_UNLOCK = _ttl("UNLOCK", 3600)

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


def _to_float(v: Any) -> float | None:
    """宽松转 float（None / 非数 → None）。"""
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def pct_change(prev_close: Any, last_close: Any) -> float | None:
    """末 2 行 close 环比涨跌幅（百分比，2 位）。任一不可用 → None。G1 核心逻辑，可单测。"""
    prev = _to_float(prev_close)
    last = _to_float(last_close)
    if prev is None or last is None or prev == 0:
        return None
    return round((last - prev) / prev * 100, 2)


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


# --- 港 / 美 / A股指数 ------------------------------------------------
US_INDICES = [(".INX", "标普500"), (".DJI", "道琼斯"), (".IXIC", "纳斯达克")]
CN_INDEX_NAMES = ["上证指数", "深证成指", "创业板指"]


def _us_indices() -> list[dict[str, Any]]:
    """G1: 标普/道指/纳指 隔夜收盘 + 涨跌幅（sina 历史末 2 行 close 环比）。"""
    out: list[dict[str, Any]] = []
    a = _require_ak()
    for sym, name in US_INDICES:
        try:
            df = a.index_us_stock_sina(symbol=sym)
        except Exception:  # noqa: BLE001 - 单指数失败不拖垮整段
            continue
        rows = _records(df.tail(2), limit=2) if (df is not None and len(df) > 0) else []
        if not rows:
            continue
        last = rows[-1]
        prev_close = rows[-2].get("close") if len(rows) >= 2 else None
        out.append(
            {
                "名称": name,
                "代码": sym,
                "收盘": _to_float(last.get("close")),
                "涨跌幅": pct_change(prev_close, last.get("close")),
                "日期": last.get("date"),
            }
        )
    return out


def _cn_indices() -> list[dict[str, Any]]:
    """G3: A股三大指数实时 spot（上证指数 / 深证成指 / 创业板指）。"""
    a = _require_ak()
    df = a.stock_zh_index_spot_em(symbol="沪深重要指数")
    rows = _records(df, limit=200)
    order = {n: i for i, n in enumerate(CN_INDEX_NAMES)}
    picked = [r for r in rows if str(r.get("名称")) in order]
    picked.sort(key=lambda r: order.get(str(r.get("名称")), 99))
    return picked


def get_index_quote(market: str) -> tuple[list[dict[str, Any]], str]:
    """港 / 美 / A股主要指数行情。market: 'hk' | 'us' | 'cn'。"""
    m = market.lower()
    if m == "hk":
        a = _require_ak()
        df = a.stock_hk_index_spot_em()
        return _records(df), "akshare:stock_hk_index_spot_em"
    if m == "us":
        # G1: 标普(.INX)/道指(.DJI)/纳指(.IXIC)，sina 历史末 2 行算隔夜涨跌幅。
        return _us_indices(), "akshare:index_us_stock_sina(.INX/.DJI/.IXIC,末2行)"
    if m == "cn":
        # G3: 上证指数/深证成指/创业板指 实时 spot。
        return _cn_indices(), "akshare:stock_zh_index_spot_em(沪深重要指数)"
    raise AkShareUnavailable(f"未知市场 '{market}'，仅支持 hk / us / cn")


# --- 解禁（G2；新股 / 财经日历留 backlog） ---------------------------
def get_share_unlock(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """个股限售解禁安排（批次 / 解禁时间 / 数量）。symbol 形如 '600519'。"""
    a = _require_ak()
    df = a.stock_restricted_release_queue_em(symbol=symbol)
    return _records(df), "akshare:stock_restricted_release_queue_em"
