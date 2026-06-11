"""Thin AkShare adapter layer.

This is the ONLY place that names AkShare functions. AkShare renames /
moves interfaces between releases, so when wiring this up run
`pip show akshare` and verify each `ak.<fn>` below against
https://akshare.akfamily.xyz/ for the installed version — the tool
contracts in server.py stay stable while these calls get adjusted.

VERIFIED 2026-06-12 on **Vultr (207.148.70.106)** against **akshare 1.18.64** (实跑):
  ⚠️ push2.eastmoney.com 从 Vultr **不可达**（RemoteDisconnected ×4，非瞬时；
     交接 §1「Vultr 可达」前提作废——step① 大概只看了 HTTP 302/200 没看真实数据调用）。
     受影响并已改走 **sina**（不同基础设施，实测可达）：
       quote   stock_bid_ask_em        → stock_zh_a_spot(filter)
       kline   stock_zh_a_hist         → stock_zh_a_daily(末2行算涨跌幅)
       A股指数  stock_zh_index_spot_em  → stock_zh_index_spot_sina(取 sh000001/sz399001/sz399006)
       港股指数  stock_hk_index_spot_em  → stock_hk_index_spot_sina
  可达（保留）: 公告 cninfo / 龙虎榜+解禁+北向 datacenter-eastmoney / 美股+A股 sina。
  美股 index_us_stock_sina 返历史 OHLCV（date/open/high/low/close/volume）→ 末2行算隔夜涨跌幅。
  北向 stock_hsgt_fund_flow_summary_em: 2024-08 后**北向(沪/深股通)成交净买额=0.0 停披露**
    （南向港股通仍有值）→ 渲染器把北向 0.0/null 当不可得整行省略，禁用过期口径。
  详见 apps/akshare-mcp/README「已知限制」+ memory reference_ashare_vultr_data。

Scope (per the sprint plan, intentionally NARROW — 股民每日信息 only):
  行情      get_quote / get_kline
  公告      get_announcements
  龙虎榜    get_dragon_tiger
  北向资金  get_northbound_flow
  港美A股指数 get_index_quote
  解禁      get_share_unlock

Compliance: this is a DATA layer only — aggregation, never advice. Every
result is wrapped with source + timestamp + disclaimer by server.py. No
buy/sell signals, no price prediction.
"""

from __future__ import annotations

import datetime
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
        raise AkShareUnavailable("akshare 未安装或导入失败，请 `pip install akshare`")
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
    """末 2 行 close 环比涨跌幅（百分比，2 位）。任一不可用 → None。可单测。"""
    prev = _to_float(prev_close)
    last = _to_float(last_close)
    if prev is None or last is None or prev == 0:
        return None
    return round((last - prev) / prev * 100, 2)


def sina_prefix(symbol: str) -> str:
    """6 位 A股代码 → sina 带交易所前缀（sh/sz/bj）。已带前缀则原样返回。"""
    s = symbol.strip().lower()
    if s.startswith(("sh", "sz", "bj")):
        return s
    if s[:1] == "6":
        return f"sh{s}"
    if s[:1] in ("0", "3"):
        return f"sz{s}"
    if s[:1] in ("4", "8", "9"):
        return f"bj{s}"
    return f"sh{s}"


# --- 行情（quote: sina spot 过滤；push2 stock_bid_ask_em 从 Vultr 不可达） ----
def get_quote(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """实时行情快照（最新价 / 涨跌幅 / 成交额）。symbol 形如 '600519'。

    走 sina 全市场 spot 再按代码过滤（push2 stock_bid_ask_em 从 Vultr 不可达）。
    注：全市场快照较重，④ 即时问答可后续换更轻的单只 sina 实时接口。
    """
    a = _require_ak()
    df = a.stock_zh_a_spot()
    recs = _records(df, limit=6000)
    code = symbol.strip()
    hit = [r for r in recs if str(r.get("代码", "")).endswith(code)]
    return hit[:1], "akshare:stock_zh_a_spot(sina,filter)"


def get_kline(
    symbol: str,
    period: str = "daily",
    start_date: str = "",
    end_date: str = "",
    adjust: str = "qfq",
) -> tuple[list[dict[str, Any]], str]:
    """日 K 线（sina）。返末行 = 当日表现，含末2行算的涨跌幅。

    push2his stock_zh_a_hist 从 Vultr 不可达 → 改 stock_zh_a_daily（sina）。
    sina daily 列 date/open/high/low/close/volume/amount **无涨跌幅**，故末2行算。
    period 仅 daily（周/月线非简报所需，暂不支持）。
    """
    a = _require_ak()
    sina_sym = sina_prefix(symbol)
    sd = start_date or (datetime.date.today() - datetime.timedelta(days=25)).strftime("%Y%m%d")
    kwargs: dict[str, Any] = {"symbol": sina_sym, "start_date": sd, "adjust": adjust or "qfq"}
    if end_date:
        kwargs["end_date"] = end_date
    df = a.stock_zh_a_daily(**kwargs)
    rows = _records(df.tail(2), limit=2) if (df is not None and len(df) > 0) else []
    if not rows:
        return [], "akshare:stock_zh_a_daily(sina)"
    last = rows[-1]
    prev_close = rows[-2].get("close") if len(rows) >= 2 else None
    mapped = {
        "日期": last.get("date"),
        "收盘": _to_float(last.get("close")),
        "开盘": _to_float(last.get("open")),
        "最高": _to_float(last.get("high")),
        "最低": _to_float(last.get("low")),
        "成交额": _to_float(last.get("amount")),
        "涨跌幅": pct_change(prev_close, last.get("close")),
    }
    return [mapped], "akshare:stock_zh_a_daily(sina,末2行算涨跌幅)"


# --- 公告 ------------------------------------------------------------
def get_announcements(
    symbol: str, start_date: str = "", end_date: str = ""
) -> tuple[list[dict[str, Any]], str]:
    """个股公告（巨潮）。symbol 形如 '600519'。"""
    a = _require_ak()
    # Verified on Vultr (akshare 1.18.64): 35 rows, cols 代码/简称/公告标题/
    # 公告时间/公告链接. cninfo source reachable from Vultr.
    kwargs: dict[str, Any] = {"symbol": symbol}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date
    df = a.stock_zh_a_disclosure_report_cninfo(**kwargs)
    return _records(df), "akshare:stock_zh_a_disclosure_report_cninfo"


# --- 龙虎榜 ----------------------------------------------------------
def get_dragon_tiger(start_date: str, end_date: str = "") -> tuple[list[dict[str, Any]], str]:
    """龙虎榜明细。日期形如 '20260611'。end_date 省略时同 start_date。

    Verified on Vultr: 含 `解读` 列（akshare 自带一行中性解读）+ 代码/名称/上榜原因/
    涨跌幅/龙虎榜净买额/市场总成交额 等。datacenter-eastmoney 从 Vultr 可达。
    """
    a = _require_ak()
    df = a.stock_lhb_detail_em(start_date=start_date, end_date=end_date or start_date)
    return _records(df), "akshare:stock_lhb_detail_em"


# --- 北向资金 --------------------------------------------------------
def get_northbound_flow() -> tuple[list[dict[str, Any]], str]:
    """北向资金流向汇总（沪股通 + 深股通）。

    ⚠️ 2024-08 后北向成交净买额停披露（实测 = 0.0）；南向港股通仍有值。
    渲染器据此把北向 0.0/null 整行省略。datacenter 从 Vultr 可达。
    """
    a = _require_ak()
    df = a.stock_hsgt_fund_flow_summary_em()
    return _records(df), "akshare:stock_hsgt_fund_flow_summary_em"


# --- 港 / 美 / A股指数 ------------------------------------------------
US_INDICES = [(".INX", "标普500"), (".DJI", "道琼斯"), (".IXIC", "纳斯达克")]
# sina A股指数 spot 的代码（push2 stock_zh_index_spot_em 从 Vultr 不可达）。
CN_INDEX_CODES = ["sh000001", "sz399001", "sz399006"]  # 上证指数 / 深证成指 / 创业板指


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
    """G3: A股三大指数实时 spot（sina）。上证指数 / 深证成指 / 创业板指。"""
    a = _require_ak()
    df = a.stock_zh_index_spot_sina()
    rows = _records(df, limit=500)
    order = {c: i for i, c in enumerate(CN_INDEX_CODES)}
    picked = [r for r in rows if str(r.get("代码")) in order]
    picked.sort(key=lambda r: order.get(str(r.get("代码")), 99))
    return picked


def get_index_quote(market: str) -> tuple[list[dict[str, Any]], str]:
    """港 / 美 / A股主要指数行情。market: 'hk' | 'us' | 'cn'。"""
    m = market.lower()
    if m == "hk":
        # push2 stock_hk_index_spot_em 从 Vultr 不可达 → sina（渲染器按名称取恒生指数）。
        a = _require_ak()
        df = a.stock_hk_index_spot_sina()
        return _records(df, limit=80), "akshare:stock_hk_index_spot_sina"
    if m == "us":
        # G1: 标普(.INX)/道指(.DJI)/纳指(.IXIC)，sina 历史末 2 行算隔夜涨跌幅。
        return _us_indices(), "akshare:index_us_stock_sina(.INX/.DJI/.IXIC,末2行)"
    if m == "cn":
        # G3: 上证指数/深证成指/创业板指 实时 spot（sina）。
        return _cn_indices(), "akshare:stock_zh_index_spot_sina"
    raise AkShareUnavailable(f"未知市场 '{market}'，仅支持 hk / us / cn")


# --- 解禁（G2；新股 / 财经日历留 backlog） ---------------------------
def get_share_unlock(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """个股限售解禁安排（批次 / 解禁时间 / 数量）。symbol 形如 '600519'。"""
    a = _require_ak()
    df = a.stock_restricted_release_queue_em(symbol=symbol)
    return _records(df), "akshare:stock_restricted_release_queue_em"
