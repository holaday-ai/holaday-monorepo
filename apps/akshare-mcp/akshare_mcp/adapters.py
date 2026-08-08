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
import json
import os
import re
import threading
import time
from typing import Any
from urllib.parse import quote, urlparse

import requests

try:
    import akshare as ak  # type: ignore
except Exception:  # pragma: no cover - akshare optional at import time
    ak = None  # type: ignore

from .cache import cached as _cached  # ④ 风险源全市场 按date 共享缓存


# --- per-interface TTLs (seconds), env-overridable -------------------
def _ttl(name: str, default: int) -> int:
    raw = os.environ.get(f"AKSHARE_MCP_TTL_{name}")
    if raw and raw.isdigit():
        return int(raw)
    return default


# 简报投递窗口去重：08:30/15:30 同时 N 个用户任务触发时，市场级 + 个股共享
# 数据只真实拉取一次，其余命中缓存。故简报用到的接口 TTL 全 ≥ 600s(10min)，
# 覆盖投递窗口（BOSS 要求）。QUOTE(15s) 仅 ④ 即时问答用，保持实时。
TTL_QUOTE = _ttl("QUOTE", 15)
TTL_INTRADAY = _ttl("INTRADAY", 15)
TTL_KLINE = _ttl("KLINE", 600)
TTL_ANNOUNCE = _ttl("ANNOUNCE", 1800)
TTL_STOCK_NEWS = _ttl("STOCK_NEWS", 900)
TTL_LHB = _ttl("LHB", 3600)
TTL_NORTHBOUND = _ttl("NORTHBOUND", 600)
TTL_INDEX = _ttl("INDEX", 60)
TTL_PULSE = _ttl("PULSE", 600)
TTL_UNLOCK = _ttl("UNLOCK", 3600)
TTL_TRADECAL = _ttl("TRADECAL", 86400)  # 交易日历日内基本不变，缓存 1 天
TTL_FUND = _ttl("FUND", 86400)  # 财报季度才变，缓存 1 天
TTL_VAL = _ttl("VAL", 3600)  # 估值日级，缓存 1 小时
TTL_RISK = _ttl("RISK", 21600)  # ④ 风险源(质押/商誉/预告)粗粒度变更，缓存 6h
TTL_RANK = _ttl("RANK", 60)
TTL_SPOT = _ttl("SPOT", 300)
STOCK_NEWS_TIMEOUT_SECONDS = max(1.0, float(os.environ.get("AKSHARE_MCP_STOCK_NEWS_TIMEOUT", "8")))

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


def _retry(fn: Any, attempts: int = 3, sleep: float = 1.2) -> Any:
    """重试网络抖动（ths IncompleteRead / cninfo ConnectionError 等间歇性失败）。末次仍败则抛。"""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - 网络抖动统一重试
            last = e
            if i < attempts - 1:
                time.sleep(sleep)
    if last is not None:
        raise last
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
def _hydrate_symbol_table_from_spot(recs: list[dict[str, Any]]) -> None:
    """Reuse the full-market spot payload to keep symbol search warm."""
    global _symbol_table, _symbol_ts
    table: dict[str, str] = {}
    for rec in recs:
        code = _strip_market_prefix(str(rec.get("代码", "")))
        name = str(rec.get("名称", "")).strip()
        if code and name and name != "nan":
            table[code] = name
    if not table:
        return
    with _symbol_lock:
        _symbol_table = table
        _symbol_ts = time.time()


@_cached(TTL_SPOT)
def _get_a_spot_records() -> list[dict[str, Any]]:
    """Fetch and cache full A-share spot rows once per process TTL window."""
    a = _require_ak()
    df = a.stock_zh_a_spot()
    recs = _records(df, limit=6000)
    _hydrate_symbol_table_from_spot(recs)
    return list(recs)


@_cached(TTL_INTRADAY)
def _get_sina_minute_frame(symbol: str) -> Any:
    """Single-symbol Sina minute payload shared by quote and chart requests."""
    a = _require_ak()
    return a.stock_zh_a_minute(symbol=sina_prefix(symbol), period="1", adjust="")


def get_quote(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """实时行情快照（最新价 / 成交量 / 成交额）。symbol 形如 '600519'。

    优先走单只 Sina 分钟线，避免每只股票触发 5500+ 行全市场快照。分钟线
    不直接提供昨收，涨跌幅留空，由上层已有日线基准计算。Sina 分钟接口异常时
    才退回真实全市场 spot；不生成模拟价格。
    """
    code = symbol.strip()
    try:
        minute_frame = _get_sina_minute_frame(code)
        minute_rows = _intraday_rows(minute_frame)
        if minute_rows:
            latest = minute_rows[-1]
            latest_date = str(latest["时间"])[:10]
            previous_date = next(
                (date for date in reversed(_intraday_dates(minute_frame)) if date < latest_date),
                None,
            )
            previous_rows = (
                _intraday_rows(minute_frame, expected_date=previous_date)
                if previous_date
                else []
            )
            change_pct = pct_change(
                previous_rows[-1]["最新价"] if previous_rows else None,
                latest["最新价"],
            )
            if change_pct is None:
                raise AkShareUnavailable("分钟线缺少上一交易日收盘")
            volume = sum(
                value
                for value in (_to_float(row.get("成交量")) for row in minute_rows)
                if value is not None
            )
            amount = sum(
                value
                for value in (_to_float(row.get("成交额")) for row in minute_rows)
                if value is not None
            )
            return [
                {
                    "代码": code,
                    "最新价": latest["最新价"],
                    "涨跌幅": change_pct,
                    "成交量": volume,
                    "成交额": amount,
                    "行情时间": latest["时间"],
                }
            ], "akshare:stock_zh_a_minute(sina,1m,latest)"
    except Exception:  # noqa: BLE001 - fall through to the other real source
        pass

    recs = _get_a_spot_records()
    hit = [r for r in recs if str(r.get("代码", "")).endswith(code)]
    return hit[:1], "akshare:stock_zh_a_spot(sina,filter,fallback)"


_SINA_A_RANK_URL = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "Market_Center.getHQNodeData"
)


def _sina_ranking_rows(metric: str, limit: int) -> list[dict[str, Any]]:
    """Fetch one server-sorted Sina page instead of crawling every A-share page."""
    sort_field, ascending = {
        "gainers": ("changepercent", "0"),
        "losers": ("changepercent", "1"),
        "amount": ("amount", "0"),
    }[metric]
    page_size = min(80, max(20, limit * 2))
    timeout = max(1.0, float(os.environ.get("AKSHARE_MCP_SINA_RANK_TIMEOUT", "15")))
    params = {
        "page": "1",
        "num": str(page_size),
        "sort": sort_field,
        "asc": ascending,
        "node": "hs_a",
        "symbol": "",
        "_s_r_a": "page",
    }

    try:
        response = _retry(
            lambda: requests.get(_SINA_A_RANK_URL, params=params, timeout=timeout),
            attempts=2,
            sleep=0.4,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:  # noqa: BLE001 - normalize upstream transport/parser errors
        raise AkShareUnavailable("新浪排行真实数据暂不可用") from exc

    if not isinstance(payload, list):
        raise AkShareUnavailable("新浪排行真实数据格式异常")

    rows: list[dict[str, Any]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        code = _strip_market_prefix(str(raw.get("code") or raw.get("symbol") or ""))
        name = str(raw.get("name") or "").strip()
        price = _to_float(raw.get("trade"))
        change = _to_float(raw.get("changepercent"))
        amount = _to_float(raw.get("amount"))
        # Before the session Sina can return a syntactically valid page whose
        # rows have a code/name but every market value is zero. Treat that as
        # unavailable rather than letting it replace a verified ranking.
        if (
            not re.fullmatch(r"\d{6}", code)
            or not name
            or price is None
            or price <= 0
            or change is None
            or amount is None
            or amount <= 0
        ):
            continue
        rows.append(
            {
                "代码": code,
                "名称": name,
                "最新价": price,
                "涨跌额": _to_float(raw.get("pricechange")),
                "涨跌幅": change,
                "买入": _to_float(raw.get("buy")),
                "卖出": _to_float(raw.get("sell")),
                "昨收": _to_float(raw.get("settlement")),
                "今开": _to_float(raw.get("open")),
                "最高": _to_float(raw.get("high")),
                "最低": _to_float(raw.get("low")),
                "成交量": _to_float(raw.get("volume")),
                "成交额": amount,
                "时间戳": str(raw.get("ticktime") or "").strip(),
            }
        )

    if not rows:
        raise AkShareUnavailable("新浪排行未返回可验证的真实行情")

    if metric == "amount":
        rows.sort(key=lambda row: _to_float(row.get("成交额")) or 0, reverse=True)
    elif metric == "losers":
        rows.sort(key=lambda row: _to_float(row.get("涨跌幅")) or 0)
    else:
        rows.sort(key=lambda row: _to_float(row.get("涨跌幅")) or 0, reverse=True)
    return rows[:limit]


def get_stock_rankings(metric: str = "gainers", limit: int = 20) -> tuple[list[dict[str, Any]], str]:
    """A股全市场榜单。由新浪服务端排序后只取首页真实数据。"""
    m = (metric or "gainers").strip().lower()
    if m not in {"gainers", "losers", "amount"}:
        raise AkShareUnavailable("不支持的榜单类型，仅支持 gainers/losers/amount")
    cap = max(1, min(int(limit or 20), 50))
    return _sina_ranking_rows(m, cap), f"akshare:sina-stock-rankings({m})"


def get_kline(
    symbol: str,
    period: str = "daily",
    start_date: str = "",
    end_date: str = "",
    adjust: str = "qfq",
    days: int = 0,
) -> tuple[list[dict[str, Any]], str]:
    """日 K 线（sina）。默认返末行 = 当日表现，含末2行算的涨跌幅（①盘面用，不变）。

    push2his stock_zh_a_hist 从 Vultr 不可达 → 改 stock_zh_a_daily（sina）。
    sina daily 列 date/open/high/low/close/volume/amount **无涨跌幅**，故末2行算。
    period 仅 daily（周/月线非简报所需，暂不支持）。
    **P3 F走势**：days>0 → 返近 days 交易日 **raw 序列**（日期/开盘/最高/最低/收盘/成交量/成交额，
    时间升序），F1-F4 本地纯算。同源 stock_zh_a_daily，零新数据源；停牌/新股不足返空（不崩）。
    """
    a = _require_ak()
    sina_sym = sina_prefix(symbol)
    if days and days > 0:
        sd2 = (datetime.date.today() - datetime.timedelta(days=int(days * 1.5) + 15)).strftime(
            "%Y%m%d"
        )
        df = a.stock_zh_a_daily(symbol=sina_sym, start_date=sd2, adjust=adjust or "qfq")
        if df is None or len(df) == 0:
            return [], "akshare:stock_zh_a_daily(sina,series,空)"
        series = [
            {
                "日期": r.get("date"),
                "开盘": _to_float(r.get("open")),
                "最高": _to_float(r.get("high")),
                "最低": _to_float(r.get("low")),
                "收盘": _to_float(r.get("close")),
                "成交量": _to_float(r.get("volume")),
                "成交额": _to_float(r.get("amount")),
            }
            for r in _records(df, limit=days + 30)
        ]
        return series, "akshare:stock_zh_a_daily(sina,series)"
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


def get_intraday(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """A股真实分钟线。返回最近交易日的实际分钟点，不补齐、不外推。"""
    a = _require_ak()
    cn_today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    today = cn_today.strftime("%Y-%m-%d")
    start = f"{(cn_today - datetime.timedelta(days=21)).isoformat()} 09:30:00"
    end = f"{today} 15:00:00"
    errors: list[str] = []

    if hasattr(a, "stock_zh_a_minute"):
        try:
            df = _get_sina_minute_frame(symbol)
            rows = _intraday_rows(df)
            if rows:
                return rows, "akshare:stock_zh_a_minute(sina,1m)"
        except Exception as exc:  # noqa: BLE001 - try next AkShare adapter
            errors.append(f"stock_zh_a_minute: {exc}")

    if hasattr(a, "stock_zh_a_hist_min_em"):
        try:
            df = a.stock_zh_a_hist_min_em(
                symbol=symbol,
                start_date=start,
                end_date=end,
                period="1",
                adjust="",
            )
            rows = _intraday_rows(df)
            if rows:
                return rows, "akshare:stock_zh_a_hist_min_em(1m)"
        except Exception as exc:  # noqa: BLE001 - try next AkShare adapter
            errors.append(f"stock_zh_a_hist_min_em: {exc}")

    if hasattr(a, "stock_intraday_sina"):
        try:
            df = a.stock_intraday_sina(symbol=sina_prefix(symbol), date=cn_today.strftime("%Y%m%d"))
            rows = _intraday_rows(df, expected_date=today, allow_time_only_date=True)
            if rows:
                return rows, "akshare:stock_intraday_sina(tick,last-per-minute)"
        except Exception as exc:  # noqa: BLE001 - report all attempted real sources
            errors.append(f"stock_intraday_sina: {exc}")

    detail = "; ".join(errors) if errors else "AkShare 当前版本未提供可用分钟线接口"
    raise AkShareUnavailable(f"分钟线暂不可用: {detail}")


def _intraday_rows(
    df: Any,
    expected_date: str | None = None,
    allow_time_only_date: bool = False,
    *,
    now: datetime.datetime | None = None,
) -> list[dict[str, Any]]:
    if df is None or len(df) == 0:
        return []
    shanghai = datetime.timezone(datetime.timedelta(hours=8))
    current = now or datetime.datetime.now(shanghai)
    if current.tzinfo is not None:
        current = current.astimezone(shanghai).replace(tzinfo=None)
    current_minute = current.replace(second=0, microsecond=0)
    candidates: list[tuple[datetime.datetime, dict[str, Any]]] = []
    source = df.tail(MAX_ROWS * 20) if hasattr(df, "tail") else df
    for raw in _records(source, limit=MAX_ROWS * 20):
        time_value = _intraday_time_value(raw)
        price = _to_float(
            raw.get("收盘")
            or raw.get("最新价")
            or raw.get("价格")
            or raw.get("close")
            or raw.get("price")
            or raw.get("成交价格")
        )
        if price is None or time_value is None:
            continue
        time_text = str(time_value)
        date_match = re.search(r"(\d{4})[-/]?(\d{2})[-/]?(\d{2})", time_text)
        if not date_match:
            if not expected_date or not allow_time_only_date:
                continue
            row_date = expected_date
        else:
            row_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}"
        if expected_date and row_date != expected_date:
            continue
        time_match = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", time_text)
        if not time_match:
            continue
        hour = int(time_match.group(1))
        minute = int(time_match.group(2))
        second = int(time_match.group(3) or 0)
        minute_of_day = hour * 60 + minute
        if not (
            9 * 60 + 30 <= minute_of_day <= 11 * 60 + 30
            or 13 * 60 <= minute_of_day <= 15 * 60
        ):
            continue
        try:
            timestamp = datetime.datetime.fromisoformat(
                f"{row_date} {hour:02d}:{minute:02d}:{second:02d}"
            )
        except ValueError:
            continue
        # Sina can label the still-forming bar with the next minute. Never let
        # that provider convention become a future quote or chart point.
        if timestamp.replace(second=0, microsecond=0) > current_minute:
            continue
        row = {
            "时间": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "最新价": price,
            "成交量": _to_float(raw.get("成交量") or raw.get("volume")),
            "成交额": _to_float(raw.get("成交额") or raw.get("amount")),
        }
        candidates.append((timestamp, row))

    if not candidates:
        return []
    latest_date = expected_date or max(timestamp.date() for timestamp, _ in candidates).isoformat()
    latest = [
        (timestamp, row)
        for timestamp, row in candidates
        if timestamp.date().isoformat() == latest_date
    ]
    latest.sort(key=lambda item: item[0])
    by_minute: dict[str, dict[str, Any]] = {}
    for timestamp, row in latest:
        by_minute[timestamp.strftime("%Y-%m-%d %H:%M")] = row
    rows = list(by_minute.values())
    # A 股分钟线最多约 240 点；保留尾部实际交易点，避免大响应拖慢前端。
    return rows[-260:]


def _intraday_time_value(raw: dict[str, Any]) -> Any:
    return (
        raw.get("时间")
        or raw.get("日期")
        or raw.get("day")
        or raw.get("time")
        or raw.get("datetime")
        or raw.get("ticktime")
        or raw.get("成交时间")
    )


def _intraday_dates(df: Any) -> list[str]:
    """Return ascending source dates from the bounded minute-data window."""
    if df is None or len(df) == 0:
        return []
    source = df.tail(MAX_ROWS * 20) if hasattr(df, "tail") else df
    dates: set[str] = set()
    for raw in _records(source, limit=MAX_ROWS * 20):
        match = re.search(
            r"(\d{4})[-/]?(\d{2})[-/]?(\d{2})",
            str(_intraday_time_value(raw) or ""),
        )
        if match:
            dates.add(f"{match.group(1)}-{match.group(2)}-{match.group(3)}")
    return sorted(dates)


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
    # ⚠️ 日期窗口内无公告时 cninfo 返空表，akshare 内部对缺列做选列抛
    # KeyError("None of [...] are in the [columns]")——这是「窗口内无新公告」
    # 的常态，不是异常。捕获返**空集**（非 error），渲染器据 count=0 显示
    # 「无新公告」而非把原始异常泄漏成「数据暂不可用」。
    try:
        df = a.stock_zh_a_disclosure_report_cninfo(**kwargs)
    except (KeyError, TypeError, IndexError, AttributeError):
        return [], "akshare:stock_zh_a_disclosure_report_cninfo(窗口内无公告)"
    if df is None or len(df) == 0:
        return [], "akshare:stock_zh_a_disclosure_report_cninfo"
    return _records(df), "akshare:stock_zh_a_disclosure_report_cninfo"


# --- 个股新闻 --------------------------------------------------------
_STOCK_NEWS_SEARCH_URL = "https://search-api-web.eastmoney.com/search/jsonp"
_STOCK_NEWS_CALLBACK = "jQuery35101792940631092459_1764599530165"


def _stock_news_http_get(url: str, *, params: dict[str, str], headers: dict[str, str], timeout: float) -> Any:
    """Use the same public Eastmoney endpoint as AkShare, but with a deadline."""
    from curl_cffi import requests as curl_requests

    return curl_requests.get(url, params=params, headers=headers, timeout=timeout)


def _stock_news_params(symbol: str) -> dict[str, str]:
    query = {
        "uid": "",
        "keyword": symbol,
        "type": ["cmsArticleWebOld"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": 20,
                "preTag": "<em>",
                "postTag": "</em>",
            }
        },
    }
    return {
        "cb": _STOCK_NEWS_CALLBACK,
        "param": json.dumps(query, ensure_ascii=False),
        "_": "1764599530176",
    }


def _stock_news_text(value: object) -> str:
    return re.sub(r"</?em>", "", str(value or "")).replace("\u3000", "").strip()


def _stock_news_image_url(value: object) -> str | None:
    image_url = str(value or "").strip()
    if not image_url:
        return None
    parsed = urlparse(image_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return image_url


def _get_eastmoney_news(keyword: str) -> list[dict[str, Any]]:
    """Fetch source-backed Eastmoney news for one stock or market keyword.

    AkShare's wrapper does not set a network deadline and drops the search
    response's declared image field. Calling the public endpoint directly keeps
    the same source while preventing one stuck request from exhausting workers.
    """
    response = _stock_news_http_get(
        _STOCK_NEWS_SEARCH_URL,
        params=_stock_news_params(keyword),
        headers={
            "accept": "*/*",
            # curl_cffi requires header values to be Latin-1. Query params are
            # UTF-8 encoded separately, but the referer must be ASCII too.
            "referer": f"https://so.eastmoney.com/news/s?keyword={quote(keyword)}",
            "user-agent": "Mozilla/5.0",
        },
        timeout=STOCK_NEWS_TIMEOUT_SECONDS,
    )
    raise_for_status = getattr(response, "raise_for_status", None)
    if callable(raise_for_status):
        raise_for_status()
    body = str(getattr(response, "text", ""))
    start = body.find("(")
    end = body.rfind(")")
    if start < 0 or end <= start:
        raise AkShareUnavailable("东方财富新闻返回格式异常")
    payload = json.loads(body[start + 1:end])
    result = payload.get("result") if isinstance(payload, dict) else None
    source_rows = result.get("cmsArticleWebOld") if isinstance(result, dict) else []
    if not isinstance(source_rows, list):
        raise AkShareUnavailable("东方财富新闻结果格式异常")

    rows: list[dict[str, Any]] = []
    for source_row in source_rows[:MAX_ROWS]:
        if not isinstance(source_row, dict):
            continue
        title = _stock_news_text(source_row.get("title"))
        published_at = _stock_news_text(source_row.get("date"))
        url = _stock_news_text(source_row.get("url"))
        if not title or not published_at or not url:
            continue
        row = {
            "关键词": keyword,
            "新闻标题": title,
            "新闻内容": _stock_news_text(source_row.get("content")),
            "发布时间": published_at,
            "文章来源": _stock_news_text(source_row.get("mediaName")) or "东方财富",
            "新闻链接": url,
        }
        image_url = _stock_news_image_url(source_row.get("image"))
        if image_url:
            row["新闻图片"] = image_url
        rows.append(row)
    return rows


def get_stock_news(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """Fetch source-backed Eastmoney news for an A-share stock code."""
    return _get_eastmoney_news(symbol), "eastmoney:stock-news-search"


_MARKET_NEWS_KEYWORDS = {
    "cn": "A股",
    "us": "美股",
    "hk": "港股",
}


def get_market_news(market: str) -> tuple[list[dict[str, Any]], str]:
    """Fetch source-backed news for the requested A-share, US, or HK market."""
    normalized = str(market or "").strip().lower()
    keyword = _MARKET_NEWS_KEYWORDS.get(normalized)
    if not keyword:
        raise AkShareUnavailable("不支持的市场新闻类型，仅支持 cn、us、hk")
    rows = _get_eastmoney_news(keyword)
    for row in rows:
        row["市场"] = normalized
    return rows, f"eastmoney:market-news-search({normalized})"


# --- 龙虎榜 ----------------------------------------------------------
def get_dragon_tiger(start_date: str, end_date: str = "") -> tuple[list[dict[str, Any]], str]:
    """龙虎榜明细。日期形如 '20260611'。end_date 省略时同 start_date。

    Verified on Vultr: 含 `解读` 列（akshare 自带一行中性解读）+ 代码/名称/上榜原因/
    涨跌幅/龙虎榜净买额/市场总成交额 等。datacenter-eastmoney 从 Vultr 可达。

    ⚠️ 当日龙虎榜收盘后晚间才披露：盘中/当日早些时候查会无数据。akshare 在该日
    无榜单时内部对 None 取下标抛 `'NoneType' object is not subscriptable`——这是
    「尚未发布」的常态，不是异常。捕获该情形返回**空集**（非 error），让渲染器据
    count=0 显示「尚未发布 / 无上榜」，而非把原始异常泄漏给用户。
    """
    a = _require_ak()
    try:
        df = a.stock_lhb_detail_em(start_date=start_date, end_date=end_date or start_date)
    except (TypeError, KeyError, IndexError, AttributeError):
        # akshare 对空响应取下标/取列失败 → 当日榜单尚未发布，视为空集。
        return [], "akshare:stock_lhb_detail_em(当日无数据)"
    if df is None or len(df) == 0:
        return [], "akshare:stock_lhb_detail_em(当日无数据)"
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


# --- 市场温度计 + 板块主线（v2 盘后；逐源 try/except，部分失败不拖垮整段）-------
# ⚠️ Vultr 实测（akshare 1.18.64，2026-06-13）逐个可达性：
#   stock_zt_pool_em / _dtgc_em(跌停) / _zbgc_em(炸板)  → 可达（含 date 参数取历史）
#   stock_board_industry_summary_ths(同花顺)            → 可达（板块涨跌+净流入+涨跌家数+领涨股）
#   ⛔ stock_board_industry_name_em / stock_individual_fund_flow_rank → 从 Vultr **不可达**
#      （push2.eastmoney RemoteDisconnected）→ 改走上面的 ths 汇总替代（BOSS 逐个先验要求）。
#   两市成交额 = 上证综指(sh000001)+深证综指(sz399106) spot 成交额（sina 可达）。
#   ❌ 成交额环比% / 个股主力净流入：无 Vultr 可达源（index daily 仅 volume 无 amount；
#      个股资金流 push2 不可达）→ 不在 v2 出（同北向停披露的「禁用不可得口径」红线）。
SZ_COMP_INDEX = "sz399106"  # 深证综指（两市成交额用，覆盖全深市；深证成指 sz399001 仅成份）


def _zt_agg(date_compact: str) -> dict[str, Any]:
    """涨停池聚合：家数 / 最高连板 / 连板梯队(≥2) / 行业分布 top3。失败 → zt_count=None。"""
    a = _require_ak()
    try:
        rows = _records(a.stock_zt_pool_em(date=date_compact), limit=2000)
    except Exception:  # noqa: BLE001 - 单源失败不拖垮整段
        return {"zt_count": None}
    lianban = [int(_to_float(r.get("连板数")) or 0) for r in rows]
    ladder: dict[str, int] = {}
    for lb in lianban:
        if lb >= 2:
            ladder[str(lb)] = ladder.get(str(lb), 0) + 1
    ind: dict[str, int] = {}
    for r in rows:
        nm = str(r.get("所属行业") or "").strip()
        if nm and nm != "None":
            ind[nm] = ind.get(nm, 0) + 1
    top_ind = sorted(ind.items(), key=lambda kv: -kv[1])[:3]
    return {
        "zt_count": len(rows),
        "max_lianban": max(lianban) if lianban else 0,
        "ladder": ladder,
        "top_industries": [{"行业": k, "家数": v} for k, v in top_ind],
    }


def _two_market_amount() -> float | None:
    """两市成交额（原始「元」）= 上证综指(sh000001)+深证综指 spot 成交额。任一缺则尽力求和。"""
    try:
        a = _require_ak()
        recs = _records(a.stock_zh_index_spot_sina(), limit=600)
    except Exception:  # noqa: BLE001
        return None
    want = {"sh000001", SZ_COMP_INDEX}
    total, got = 0.0, False
    for r in recs:
        if str(r.get("代码")) in want:
            v = _to_float(r.get("成交额"))
            if v is not None:
                total += v
                got = True
    return total if got else None


def get_zt_pool_summary(date: str) -> tuple[list[dict[str, Any]], str]:
    """盘前回顾用：某交易日涨停池聚合（家数/连板梯队/行业分布）。date 'YYYYMMDD'。"""
    return [_zt_agg(date.replace("-", ""))], "akshare:stock_zt_pool_em(agg)"


def _board_summary() -> dict[str, Any]:
    """同花顺行业汇总 → 涨跌家数 / 大盘净流入(亿) / 板块涨跌前5(+领涨股)。失败 → 字段 None。"""
    try:
        a = _require_ak()
        brecs = _records(a.stock_board_industry_summary_ths(), limit=200)
    except Exception:  # noqa: BLE001
        brecs = []
    if not brecs:
        return {
            "up_count": None,
            "down_count": None,
            "net_inflow_yi": None,
            "sectors_up": [],
            "sectors_down": [],
        }

    def _sec(r: dict[str, Any]) -> dict[str, Any]:
        return {
            "板块": str(r.get("板块") or ""),
            "涨跌幅": _to_float(r.get("涨跌幅")),
            "领涨股": str(r.get("领涨股") or ""),
            "领涨股涨跌幅": _to_float(r.get("领涨股-涨跌幅")),
        }

    srt = sorted(brecs, key=lambda r: _to_float(r.get("涨跌幅")) or 0.0)
    return {
        # 净流入单位为「亿元」（同花顺即时净流入；实测单行 ±十~百亿量级），直接求和。
        "up_count": sum(int(_to_float(r.get("上涨家数")) or 0) for r in brecs),
        "down_count": sum(int(_to_float(r.get("下跌家数")) or 0) for r in brecs),
        "net_inflow_yi": round(sum(_to_float(r.get("净流入")) or 0.0 for r in brecs), 2),
        "sectors_up": [_sec(r) for r in srt[::-1][:5]],
        "sectors_down": [_sec(r) for r in srt[:5]],
    }


def get_market_pulse(date: str, prev_date: str = "") -> tuple[list[dict[str, Any]], str]:
    """盘后市场温度计 + 板块主线（单行聚合，逐源容错；纯指标，无周期定性标签）。date 'YYYYMMDD'。

    prev_date 给定时附带上一交易日涨停家数 zt_count_prev（温度计「涨停X(昨Y)」对比，BOSS 样张）。
    """
    dc = date.replace("-", "")
    a = _require_ak()
    out: dict[str, Any] = {}
    out.update(_zt_agg(dc))  # zt_count / max_lianban / ladder / top_industries
    if prev_date:
        out["zt_count_prev"] = _zt_agg(prev_date.replace("-", "")).get("zt_count")
    try:
        out["dt_count"] = len(_records(a.stock_zt_pool_dtgc_em(date=dc), limit=2000))
    except Exception:  # noqa: BLE001
        out["dt_count"] = None
    try:
        out["zb_count"] = len(_records(a.stock_zt_pool_zbgc_em(date=dc), limit=2000))
    except Exception:  # noqa: BLE001
        out["zb_count"] = None
    zt, zb = out.get("zt_count"), out.get("zb_count")
    out["zhaban_rate"] = (
        round(zb / (zt + zb) * 100, 1) if isinstance(zt, int) and isinstance(zb, int) and (zt + zb) > 0 else None
    )
    out.update(_board_summary())  # up_count/down_count/net_inflow_yi/sectors_up/sectors_down
    out["two_market_amount"] = _two_market_amount()
    return [out], "akshare:zt_pool+dtgc+zbgc+board_summary_ths+index_spot_sina"


# --- ④ 基本面 + ⑤ 估值（Phase 2 全景速览 step1；Vultr 实测可达）-------------
# ⚠️ 逐个先验（push2 教训）：stock_individual_info_em / stock_a_indicator_lg 从 Vultr
#   不可达/不存在 → 用以下可达替代（实测 2026-06-14，迪生力 603335 真调）：
#     ④ 基本面 → stock_financial_abstract_ths(同花顺)：净利/营收+同比增速、销售毛利率、
#        净资产收益率(ROE)、资产负债率；按报告期取最新季(含 2026Q1)，按年度取近 3 年趋势。
#     ⑤ 估值   → stock_zh_valuation_baidu(百度)：市盈率(TTM)/市净率 当前 + 近五年序列→历史分位；
#        行业分位 = stock_industry_change_cninfo(个股→行业大类) + stock_industry_pe_ratio_cninfo
#        (行业静态 PE 中位)。财报为 CAS 法定口径；时效标注=最新报告期 / 估值截至当日。
def _parse_ths_num(v: Any) -> float | None:
    """同花顺字符串值 → float。'1.71亿'→1.71e8、'4883.46万'→4.88e7、'12.40%'→12.40、false/''→None。"""
    if v is None or v is False:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "")
    if s in ("", "False", "false", "--", "—", "nan", "None"):
        return None
    s = s.rstrip("%")  # 百分比保留数字本身（12.40% → 12.40）
    mult = 1.0
    if s.endswith("亿"):
        mult, s = 1e8, s[:-1]
    elif s.endswith("万"):
        mult, s = 1e4, s[:-1]
    try:
        return float(s) * mult
    except ValueError:
        return None


def _fundamentals_row(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "report_period": str(r.get("报告期")),
        "revenue": _parse_ths_num(r.get("营业总收入")),
        "revenue_yoy": _parse_ths_num(r.get("营业总收入同比增长率")),
        "net_profit": _parse_ths_num(r.get("净利润")),
        "net_profit_yoy": _parse_ths_num(r.get("净利润同比增长率")),
        # P1：扣非净利润（判断利润是否靠非经常性损益）。
        "deduct_net_profit": _parse_ths_num(r.get("扣非净利润")),
        "deduct_net_profit_yoy": _parse_ths_num(r.get("扣非净利润同比增长率")),
        "gross_margin": _parse_ths_num(r.get("销售毛利率")),
        "net_margin": _parse_ths_num(r.get("销售净利率")),
        "roe": _parse_ths_num(r.get("净资产收益率")),
        "debt_ratio": _parse_ths_num(r.get("资产负债率")),
        # P1：每股经营现金流（判断利润含金量）。
        "ocf_per_share": _parse_ths_num(r.get("每股经营现金流")),
        # P2：基本每股收益（C1 现金含量 = 每股经营现金流/基本每股收益；R4 近似总股本 = 净利润/基本每股收益）。
        "eps_basic": _parse_ths_num(r.get("基本每股收益")),
    }


def _ths_sorted(df: Any) -> Any:
    """同花顺财报 df 按「报告期」升序排序（防不同股票排列不定 / head 截断取错期）。返回 None / df。"""
    if df is None or len(df) == 0:
        return None
    d = df.copy()
    d["_rk"] = d["报告期"].astype(str)
    return d.sort_values("_rk")


def get_fundamentals(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """④ 基本面：**真正最新一期**（按报告期排序取 max，非 head 截断）+ 季度环比 + 近 3 年趋势。

    ⚠️ P0 修：原 `_records(head 80)` 对长上市史个股（如驰宏 600497 共 95 期）会截断掉最新几期、
    取成 2022 中报。改为按报告期日期排序取真正最新一期，头部时效标与趋势年份口径才一致。
    """
    a = _require_ak()
    try:
        rep = _ths_sorted(_retry(lambda: a.stock_financial_abstract_ths(symbol=symbol, indicator="按报告期")))
    except Exception:  # noqa: BLE001
        rep = None
    try:
        ann = _ths_sorted(_retry(lambda: a.stock_financial_abstract_ths(symbol=symbol, indicator="按年度")))
    except Exception:  # noqa: BLE001
        ann = None
    src = rep if rep is not None else ann
    if src is None:
        return [], "akshare:stock_financial_abstract_ths(无数据)"
    latest = _fundamentals_row(src.iloc[-1].to_dict())
    # P2 A3 毛利率同比：当期销售毛利率 − 上年同期（src 多期里按 _rk 找 年-1 同月日）。零新字段、零新源。
    try:
        rp = str(src.iloc[-1].get("报告期"))
        gm_cur = _parse_ths_num(src.iloc[-1].get("销售毛利率"))
        prev_rk = f"{int(rp[:4]) - 1}{rp[4:]}" if len(rp) >= 4 and rp[:4].isdigit() else ""
        prev_match = src[src["_rk"] == prev_rk] if prev_rk else src.iloc[0:0]
        gm_prev = _parse_ths_num(prev_match.iloc[0].get("销售毛利率")) if len(prev_match) else None
        latest["gross_margin_yoy"] = (
            round(gm_cur - gm_prev, 2) if (gm_cur is not None and gm_prev is not None) else None
        )
    except Exception:  # noqa: BLE001
        latest["gross_margin_yoy"] = None
    # P1 季度环比（按单季度，最新单季 vs 上一单季；看加速/减速）。
    try:
        sq = _ths_sorted(_retry(lambda: a.stock_financial_abstract_ths(symbol=symbol, indicator="按单季度")))
        if sq is not None and len(sq) >= 2:
            cur, prev = sq.iloc[-1].to_dict(), sq.iloc[-2].to_dict()
            np_c, np_p = _parse_ths_num(cur.get("净利润")), _parse_ths_num(prev.get("净利润"))
            rv_c, rv_p = _parse_ths_num(cur.get("营业总收入")), _parse_ths_num(prev.get("营业总收入"))
            latest["net_profit_qoq"] = (
                round((np_c - np_p) / abs(np_p) * 100, 2)
                if (np_c is not None and np_p not in (None, 0))
                else None
            )
            latest["revenue_qoq"] = (
                round((rv_c - rv_p) / abs(rv_p) * 100, 2)
                if (rv_c is not None and rv_p not in (None, 0))
                else None
            )
    except Exception:  # noqa: BLE001
        pass
    trend3y = (
        [_fundamentals_row(r) for r in ann.tail(3).to_dict("records")] if ann is not None else []
    )
    return [{**latest, "trend3y": trend3y}], "akshare:stock_financial_abstract_ths(report+annual+quarter)"


def _pctile(series: list[float | None], cur: float | None) -> float | None:
    """cur 在序列中的历史分位（%，≤cur 占比）。空/None → None。"""
    vals = [v for v in series if isinstance(v, (int, float))]
    if not vals or cur is None:
        return None
    below = sum(1 for v in vals if v <= cur)
    return round(below / len(vals) * 100, 1)


def _baidu_series(symbol: str, indicator: str, period: str = "近五年") -> tuple[list[float | None], str | None]:
    try:
        df = _retry(lambda: ak.stock_zh_valuation_baidu(symbol=symbol, indicator=indicator, period=period))
    except Exception:  # noqa: BLE001
        return [], None
    if df is None or len(df) == 0:
        return [], None
    vals = [_to_float(x) for x in df["value"].tolist()]
    last_date = str(df["date"].iloc[-1])
    return vals, last_date


def get_valuation(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """⑤ 估值：PE(TTM)/PB 当前 + 近五年历史分位 + 行业静态 PE 中位（行业分位）。symbol '603335'。"""
    _require_ak()
    pe_series, pe_date = _baidu_series(symbol, "市盈率(TTM)")
    pb_series, pb_date = _baidu_series(symbol, "市净率")
    pe = pe_series[-1] if pe_series else None
    pb = pb_series[-1] if pb_series else None
    out: dict[str, Any] = {
        "pe_ttm": pe,
        "pb": pb,
        "pe_pctile_5y": _pctile(pe_series, pe),
        "pb_pctile_5y": _pctile(pb_series, pb),
        "as_of": pe_date or pb_date,
        "industry": None,
        "industry_pe_median": None,
    }
    mv_series, _ = _baidu_series(symbol, "总市值", "近一年")
    out["total_mv_yi"] = mv_series[-1] if mv_series else None
    # 行业分位：个股 → 行业大类（中上协口径）→ 行业静态 PE 中位。
    try:
        today = datetime.date.today().strftime("%Y%m%d")
        chg = _records(
            _retry(
                lambda: ak.stock_industry_change_cninfo(
                    symbol=symbol, start_date="20200101", end_date=today
                )
            ),
            limit=10,
        )
        ind_name = str(chg[-1].get("行业大类") or "").strip() if chg else ""
        if ind_name and ind_name not in ("nan", "None"):
            out["industry"] = ind_name
            for d in (today, "20260612"):  # cninfo 按特定披露日；今日无则退近期已知日
                pe_rows = _records(
                    _retry(lambda d=d: ak.stock_industry_pe_ratio_cninfo(symbol="证监会行业分类", date=d)),
                    limit=400,
                )
                hit = [r for r in pe_rows if str(r.get("行业名称")).strip() == ind_name]
                if hit:
                    out["industry_pe_median"] = _to_float(hit[0].get("静态市盈率-中位数"))
                    break
    except Exception:  # noqa: BLE001
        pass
    return [out], "akshare:zh_valuation_baidu(PE/PB+5y分位)+industry_pe_cninfo"


# --- ④ 风险信号雷达（R1-R5；按date取全市场→date 共享缓存，再按 symbol 过滤）------
# 数据源全为东财 datacenter(_em，Vultr 实测可达，≠ push2)；空结果 akshare 抛 KeyError →
# 兜成空集(无数据≠不可达)；避开慢分页函数(hold_management_detail_em 340页 /
# gpzy_pledge_ratio_detail_em 252页 不用)，只用按date单次调用。
def _recent_friday(ref: str) -> str:
    """ref 'YYYYMMDD' → ≤ref 的最近周五（质押按周五口径披露）。"""
    d = datetime.date(int(ref[:4]), int(ref[4:6]), int(ref[6:8]))
    return (d - datetime.timedelta(days=(d.weekday() - 4) % 7)).strftime("%Y%m%d")


def _latest_report_period(ref: str) -> str:
    """ref 'YYYYMMDD' → 最近已披露报告期(假设 ~45 天披露滞后)的季末 'YYYYMMDD'。"""
    d = datetime.date(int(ref[:4]), int(ref[4:6]), int(ref[6:8]))
    cutoff = d - datetime.timedelta(days=45)
    cands = [
        datetime.date(y, m, dd)
        for y in (d.year, d.year - 1)
        for (m, dd) in ((12, 31), (9, 30), (6, 30), (3, 31))
        if datetime.date(y, m, dd) <= cutoff
    ]
    best = max(cands) if cands else datetime.date(d.year - 1, 12, 31)
    return best.strftime("%Y%m%d")


def _quarter_ends_desc(ref_period: str, n: int) -> list[str]:
    """≤ ref_period('YYYYMMDD' 季末) 的季末日期，新→旧，取 ≤n 个（报告期往前探用，有界无死循环）。"""
    base = datetime.date(int(ref_period[:4]), int(ref_period[4:6]), int(ref_period[6:8]))
    cands = sorted(
        (
            datetime.date(yy, m, dd)
            for yy in range(base.year, base.year - 3, -1)
            for (m, dd) in ((12, 31), (9, 30), (6, 30), (3, 31))
            if datetime.date(yy, m, dd) <= base
        ),
        reverse=True,
    )
    return [d.strftime("%Y%m%d") for d in cands[:n]]


def _norm_code(symbol: str) -> str:
    return symbol.strip().lstrip("shz").zfill(6)


def _by_symbol(recs: list[dict[str, Any]], symbol: str) -> list[dict[str, Any]]:
    if not symbol:
        return recs
    s = _norm_code(symbol)
    return [r for r in recs if str(r.get("股票代码", "")).zfill(6) == s]


@_cached(TTL_RISK)
def _risk_pledge_all(query_date: str) -> list[dict[str, Any]]:
    a = _require_ak()
    try:
        return _records(a.stock_gpzy_pledge_ratio_em(date=query_date), limit=6000)
    except (KeyError, TypeError, IndexError, AttributeError):
        # 未披露日期 akshare 返 None/空 → _records 触 TypeError('NoneType' subscript)/KeyError 等 → 空集
        # （非网络错；网络错放行给上层 _safe → error envelope）。探回逻辑据此继续往前找已披露日。
        return []


@_cached(TTL_RISK)
def _latest_pledge_date(ref_friday: str) -> str:
    """从 ref_friday 当周五往前每周回退(≤4周,有界无死循环)找首个有质押数据的披露日；都空返当周五。
    质押按周五口径披露但有滞后，当周常未出 → 探回到最近【已披露】周，R1 才真 fire。"""
    base = datetime.date(int(ref_friday[:4]), int(ref_friday[4:6]), int(ref_friday[6:8]))
    for k in range(5):  # 当周 + 回退 4 周
        fri = (base - datetime.timedelta(days=7 * k)).strftime("%Y%m%d")
        if _risk_pledge_all(fri):
            return fri
    return ref_friday


def get_risk_pledge(ref_date: str, symbol: str = "") -> tuple[list[dict[str, Any]], str]:
    """R1 股权质押(质押比例)。ref_date 'YYYYMMDD'→最近【已披露】周五口径；symbol→过滤个股。"""
    recs = _risk_pledge_all(_latest_pledge_date(_recent_friday(ref_date)))
    return _by_symbol(recs, symbol), "akshare:stock_gpzy_pledge_ratio_em"


@_cached(TTL_RISK)
def _risk_goodwill_all(period: str) -> list[dict[str, Any]]:
    a = _require_ak()
    try:
        return _records(a.stock_sy_em(date=period), limit=6000)
    except (KeyError, TypeError, IndexError, AttributeError):  # 未披露期 None/空 → 空集（同质押）
        return []


@_cached(TTL_RISK)
def _latest_goodwill_period(ref_period: str) -> str:
    """从 ref_period 季末往前探(≤4季)找首个有商誉数据的报告期；都空返 ref_period。"""
    for p in _quarter_ends_desc(ref_period, 4):
        if _risk_goodwill_all(p):
            return p
    return ref_period


def get_risk_goodwill(ref_date: str, symbol: str = "") -> tuple[list[dict[str, Any]], str]:
    """R2 商誉(商誉占净资产比例 + 上年商誉)。ref_date→最近【有数据】报告期；symbol→过滤。"""
    recs = _risk_goodwill_all(_latest_goodwill_period(_latest_report_period(ref_date)))
    return _by_symbol(recs, symbol), "akshare:stock_sy_em"


@_cached(TTL_RISK)
def _risk_forecast_all(period: str) -> list[dict[str, Any]]:
    a = _require_ak()
    try:
        return _records(a.stock_yjyg_em(date=period), limit=9000)
    except (KeyError, TypeError, IndexError, AttributeError):  # 未披露期 None/空 → 空集（同质押）
        return []


@_cached(TTL_RISK)
def _latest_forecast_period(ref_period: str) -> str:
    """从 ref_period 季末往前探(≤4季)找首个有业绩预告数据的报告期；都空返 ref_period。"""
    for p in _quarter_ends_desc(ref_period, 4):
        if _risk_forecast_all(p):
            return p
    return ref_period


def get_risk_forecast(ref_date: str, symbol: str = "") -> tuple[list[dict[str, Any]], str]:
    """R3 业绩预告(预告类型/业绩变动幅度)。ref_date→最近【有数据】报告期；symbol→过滤。"""
    recs = _risk_forecast_all(_latest_forecast_period(_latest_report_period(ref_date)))
    return _by_symbol(recs, symbol), "akshare:stock_yjyg_em"


def get_risk_insider(symbol: str) -> tuple[list[dict[str, Any]], str]:
    """R4 董监高持股变动(减持=变动数<0)。沪市 sse / 深市 szse(交易所直连，实测可达)。"""
    a = _require_ak()
    code = _norm_code(symbol)
    try:
        if code.startswith("6"):
            df = a.stock_share_hold_change_sse(symbol=code)
            src = "akshare:stock_share_hold_change_sse"
        else:
            df = a.stock_share_hold_change_szse(symbol=code)
            src = "akshare:stock_share_hold_change_szse"
        return _records(df, limit=200), src
    except KeyError:
        return [], "akshare:stock_share_hold_change(无数据)"


def warm_risk_tables(ref_date: str = "") -> dict[str, int]:
    """预热 3 张风险全市场表(质押最近披露周 / 商誉·预告最近有数据报告期)入进程缓存。
    冷取全市场表慢(>1min/张)→ 此函数只在 akshare-mcp 启动 + 周期(<TTL_RISK)后台调，
    使查询命中热缓存、客户端 10/25s 内秒回。返回各表行数(0=该期暂无数据)。"""
    ref = ref_date or datetime.date.today().strftime("%Y%m%d")
    pl = _risk_pledge_all(_latest_pledge_date(_recent_friday(ref)))
    gw = _risk_goodwill_all(_latest_goodwill_period(_latest_report_period(ref)))
    fc = _risk_forecast_all(_latest_forecast_period(_latest_report_period(ref)))
    return {"pledge": len(pl), "goodwill": len(gw), "forecast": len(fc)}


# --- 交易日历（P1：非交易日不投递简报） -----------------------------
def is_trading_day(date_str: str) -> tuple[list[dict[str, Any]], str]:
    """`date_str` 是否 A股交易日（周末/节假日 = False）。date 形如 'YYYY-MM-DD' 或 'YYYYMMDD'。

    `tool_trade_date_hist_sina` 返历史+未来全部交易日（sina，Vultr 可达）。返单行
    `[{date, is_trading_day}]` 走统一 envelope。简报 dispatch 据此非交易日 skip。
    """
    a = _require_ak()
    target = date_str.replace("-", "").strip()
    df = a.tool_trade_date_hist_sina()
    dates = {str(d).replace("-", "") for d in df["trade_date"].astype(str)}
    return [{"date": date_str, "is_trading_day": target in dates}], "akshare:tool_trade_date_hist_sina"


# --- 全量代码名称表 + 短名搜索（④ 即时问答 M2） ---------------------
# ⚠️ stock_info_a_code_name 从 Vultr **不可达**（ConnectionReset，同 push2）。
# 改用 sina stock_zh_a_spot（实测可达，5526 只，但一次拉取 ~70s）。故**日级缓存
# + 后台刷新**：search 读内存表（不阻塞请求）；表空时异步触发刷新本次返空；prewarm
# 每日开盘前调 refresh_symbol_table()（长超时）填表。代码去交易所前缀（sh600519→600519）。
_symbol_lock = threading.Lock()
_symbol_table: dict[str, str] = {}  # code(无前缀) -> name
_symbol_ts: float = 0.0
_symbol_refreshing = False
_CJK_RUN = re.compile(r"[一-鿿]{2,}")

# 短名窗口停用词（E16 修）：常见时间/大盘/问句词不得作为个股名匹配种子，否则
# 「查今天A股三大指数收盘」里的「今天」会命中「今天国际(300532)」。这些 2~3 字
# 窗口虽是某些个股名子串，但作为查询里的普通词出现时绝非个股指向 → 跳过。
_NAME_SEARCH_STOPWORDS = {
    "今天", "明天", "昨天", "今日", "明日", "昨日", "前天", "后天", "上午", "下午",
    "现在", "最近", "今年", "去年", "市场", "大盘", "指数", "股市", "股票", "个股",
    "行情", "收盘", "开盘", "涨幅", "跌幅", "两市", "板块", "龙头", "资金", "主力",
    "北向", "南向", "沪深", "为啥", "怎么", "多少", "全部", "所有", "最新", "三大",
}


def _strip_market_prefix(code: str) -> str:
    """'sh600519'/'sz000001'/'bj920000' → '600519' 等；已是 6 位则原样。"""
    c = code.strip().lower()
    if len(c) > 6 and c[:2].isalpha():
        return c[2:]
    return c


def refresh_symbol_table() -> int:
    """同步拉全量代码名称表填缓存（~70s，prewarm 调）。返回条数。"""
    global _symbol_table, _symbol_ts, _symbol_refreshing
    try:
        table: dict[str, str] = {}
        for rec in _get_a_spot_records():
            code = _strip_market_prefix(str(rec.get("代码", "")))
            name = str(rec.get("名称", "")).strip()
            if code and name and name != "nan":
                table[code] = name
        with _symbol_lock:
            _symbol_table = table
            _symbol_ts = time.time()
        return len(table)
    finally:
        with _symbol_lock:
            _symbol_refreshing = False


def _ensure_table_async() -> None:
    """表空时非阻塞触发一次后台刷新（避免重复）。"""
    global _symbol_refreshing
    with _symbol_lock:
        if _symbol_refreshing:
            return
        _symbol_refreshing = True

    def _run() -> None:
        try:
            refresh_symbol_table()
        except Exception:  # noqa: BLE001 - 后台刷新失败下次再试
            global _symbol_refreshing
            with _symbol_lock:
                _symbol_refreshing = False

    threading.Thread(target=_run, daemon=True).start()


def search_symbol(query: str, limit: int = 5) -> tuple[list[dict[str, Any]], str]:
    """问句 → 个股 [{code,name}]。全名命中优先；否则中文窗口短名命中（取最具体）。

    表空（冷启/未刷新）→ 异步触发刷新 + 本次返空集（调用方退化为代码/自选股解析）。
    """
    with _symbol_lock:
        table = dict(_symbol_table)
    if not table:
        _ensure_table_async()
        return [], "akshare:stock_zh_a_spot(symbol-table warming)"

    # 1) 全名命中：name 是 query 子串（长名优先）。
    full = [{"code": c, "name": n} for c, n in table.items() if n and n in query]
    if full:
        full.sort(key=lambda r: -len(str(r["name"])))
        return full[:limit], "akshare:stock_zh_a_spot(name-in-query)"

    # 2) 短名：query 的中文窗口（长 4→2）是某 name 子串，且该窗口在全表命中数 ≤4（够具体）。
    best: dict[str, tuple[int, int, str]] = {}  # code -> (窗口长, -命中数, name)
    for run in _CJK_RUN.findall(query):
        seen: set[str] = set()
        for win_len in (4, 3, 2):
            for i in range(len(run) - win_len + 1):
                w = run[i : i + win_len]
                if w in seen:
                    continue
                seen.add(w)
                if w in _NAME_SEARCH_STOPWORDS:
                    continue  # 普通词（今天/大盘/指数…）不作个股名匹配种子（E16）
                matches = [(c, n) for c, n in table.items() if w in n]
                if not 1 <= len(matches) <= 4:
                    continue
                for c, n in matches:
                    key = (win_len, -len(matches))
                    if c not in best or key > best[c][:2]:
                        best[c] = (win_len, -len(matches), n)
    ranked = sorted(best.items(), key=lambda kv: kv[1][:2], reverse=True)
    out = [{"code": c, "name": b[2]} for c, b in ranked[:limit]]
    return out, "akshare:stock_zh_a_spot(short-name window)"
