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
import re
import threading
import time
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


# 简报投递窗口去重：08:30/15:30 同时 N 个用户任务触发时，市场级 + 个股共享
# 数据只真实拉取一次，其余命中缓存。故简报用到的接口 TTL 全 ≥ 600s(10min)，
# 覆盖投递窗口（BOSS 要求）。QUOTE(15s) 仅 ④ 即时问答用，保持实时。
TTL_QUOTE = _ttl("QUOTE", 15)
TTL_KLINE = _ttl("KLINE", 600)
TTL_ANNOUNCE = _ttl("ANNOUNCE", 1800)
TTL_LHB = _ttl("LHB", 3600)
TTL_NORTHBOUND = _ttl("NORTHBOUND", 600)
TTL_INDEX = _ttl("INDEX", 600)
TTL_UNLOCK = _ttl("UNLOCK", 3600)
TTL_TRADECAL = _ttl("TRADECAL", 86400)  # 交易日历日内基本不变，缓存 1 天

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


def _strip_market_prefix(code: str) -> str:
    """'sh600519'/'sz000001'/'bj920000' → '600519' 等；已是 6 位则原样。"""
    c = code.strip().lower()
    if len(c) > 6 and c[:2].isalpha():
        return c[2:]
    return c


def refresh_symbol_table() -> int:
    """同步拉全量代码名称表填缓存（~70s，prewarm 调）。返回条数。"""
    global _symbol_table, _symbol_ts, _symbol_refreshing
    a = _require_ak()
    try:
        df = a.stock_zh_a_spot()
        table: dict[str, str] = {}
        for rec in df[["代码", "名称"]].to_dict("records"):
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
