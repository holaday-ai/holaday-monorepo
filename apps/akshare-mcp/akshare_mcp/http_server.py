"""Thin FastAPI HTTP transport over the akshare adapters.

确定性简报（③）不走 LLM → orchestrator 直接 HTTP 取数（非 MCP-stdio；orchestrator
无 @modelcontextprotocol/sdk）。复用 adapters + 进程内 TTL cache，envelope 与 MCP
server.py 完全一致 `{data,count,source,fetched_at,disclaimer}`（错误优雅降级）。

Run（Vultr，仅监听 127.0.0.1，由 orchestrator 同机直取，不对外暴露）：
    uvicorn akshare_mcp.http_server:app --host 127.0.0.1 --port 8848

合规：DATA 层 only —— 只聚合，不荐股、不预测；每条结果带来源+时间戳+免责。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import FastAPI

from . import adapters as adp
from .cache import cached

DISCLAIMER = "数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。"


def _envelope(records: list[dict[str, Any]], source: str) -> dict[str, Any]:
    return {
        "data": records,
        "count": len(records),
        "source": source,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
    }


def _safe(fn: Callable[..., tuple[list[dict[str, Any]], str]], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run an adapter, wrap success; degrade any error to a structured payload."""
    try:
        records, source = fn(*args, **kwargs)
        return _envelope(records, source)
    except adp.AkShareUnavailable as exc:
        return {"error": str(exc), "data": [], "count": 0, "disclaimer": DISCLAIMER}
    except Exception as exc:  # noqa: BLE001 - any akshare/network failure
        return {"error": f"接口调用失败: {exc}", "data": [], "count": 0, "disclaimer": DISCLAIMER}


# Cached fetches — one TTL per interface (same as server.py).
_quote = cached(adp.TTL_QUOTE)(adp.get_quote)
_kline = cached(adp.TTL_KLINE)(adp.get_kline)
_announce = cached(adp.TTL_ANNOUNCE)(adp.get_announcements)
_lhb = cached(adp.TTL_LHB)(adp.get_dragon_tiger)
_north = cached(adp.TTL_NORTHBOUND)(adp.get_northbound_flow)
_index = cached(adp.TTL_INDEX)(adp.get_index_quote)
_unlock = cached(adp.TTL_UNLOCK)(adp.get_share_unlock)
_tradecal = cached(adp.TTL_TRADECAL)(adp.is_trading_day)
# v2 简报：温度计+板块(含即时 ths/指数 spot)→ 短 TTL 覆盖投递窗口；涨停回顾(prevday 历史)→ 长 TTL。
_pulse = cached(adp.TTL_INDEX)(adp.get_market_pulse)
_ztsum = cached(adp.TTL_LHB)(adp.get_zt_pool_summary)
# Phase 2 全景速览 step1：④ 基本面（季度级长缓存）+ ⑤ 估值（日级缓存）。
_fund = cached(adp.TTL_FUND)(adp.get_fundamentals)
_val = cached(adp.TTL_VAL)(adp.get_valuation)

app = FastAPI(title="akshare-cn-http", docs_url=None, redoc_url=None)


@app.get("/health")
@app.get("/healthz")
def health() -> dict[str, str]:
    """pm2 smoke check 用（/healthz，照 orchestrator 模式）。"""
    return {"status": "ok"}


@app.get("/index/{market}")
def index_quote(market: str) -> dict[str, Any]:
    """market: 'hk' | 'us' | 'cn'。"""
    return _safe(_index, market)


@app.get("/announcements/{symbol}")
def announcements(symbol: str, start_date: str = "", end_date: str = "") -> dict[str, Any]:
    """start_date/end_date: 'YYYYMMDD'。不传日期时 cninfo 返历史默认页（多为旧公告）；
    简报按日期窗口取（盘前近 24h / 盘后当日），由 service 传范围。cache 按 args 分键。"""
    return _safe(_announce, symbol, start_date, end_date)


@app.get("/unlock/{symbol}")
def share_unlock(symbol: str) -> dict[str, Any]:
    return _safe(_unlock, symbol)


@app.get("/kline/{symbol}")
def kline(symbol: str) -> dict[str, Any]:
    return _safe(_kline, symbol)


@app.get("/quote/{symbol}")
def quote(symbol: str) -> dict[str, Any]:
    return _safe(_quote, symbol)


@app.get("/dragon-tiger/{start_date}")
def dragon_tiger(start_date: str) -> dict[str, Any]:
    """start_date: 'YYYYMMDD'。"""
    return _safe(_lhb, start_date)


@app.get("/northbound")
def northbound() -> dict[str, Any]:
    return _safe(_north)


@app.get("/trading-day/{date}")
def trading_day(date: str) -> dict[str, Any]:
    """date: 'YYYY-MM-DD' 或 'YYYYMMDD' 是否 A股交易日（P1 非交易日不投递）。"""
    return _safe(_tradecal, date)


@app.get("/market-pulse/{date}")
def market_pulse(date: str, prev_date: str = "") -> dict[str, Any]:
    """date 'YYYYMMDD'。盘后市场温度计(涨停/跌停/炸板/连板/涨跌家数) + 板块主线 + 大盘净流入(单行聚合)。
    prev_date 给定 → 附带上一交易日涨停家数(温度计「涨停X(昨Y)」对比)。cache 按 (date,prev_date) 分键。"""
    return _safe(_pulse, date, prev_date)


@app.get("/zt-pool-summary/{date}")
def zt_pool_summary(date: str) -> dict[str, Any]:
    """date 'YYYYMMDD'。某交易日涨停池聚合（盘前回顾上一交易日涨停梯队用）。"""
    return _safe(_ztsum, date)


@app.get("/fundamentals/{symbol}")
def fundamentals(symbol: str) -> dict[str, Any]:
    """④ 基本面：营收/净利+同比增速、毛利率、ROE、负债率（最新报告期）+ 近 3 年趋势。"""
    return _safe(_fund, symbol)


@app.get("/valuation/{symbol}")
def valuation(symbol: str) -> dict[str, Any]:
    """⑤ 估值：PE(TTM)/PB 当前 + 近五年历史分位 + 行业静态 PE 中位（行业分位）。"""
    return _safe(_val, symbol)


# ④ 风险信号雷达：质押/商誉/预告 全市场按 date 共享缓存（内部 _risk_*_all @cached），
# endpoint 直 _safe(adp.get_risk_*, date, symbol)（按 symbol 过滤后结果小，不再二次缓存）。
@app.get("/risk-pledge/{date}")
def risk_pledge(date: str, symbol: str = "") -> dict[str, Any]:
    """R1 股权质押(质押比例)。date 'YYYYMMDD'(内部取≤date 最近周五)；symbol 过滤个股。"""
    return _safe(adp.get_risk_pledge, date, symbol)


@app.get("/risk-goodwill/{date}")
def risk_goodwill(date: str, symbol: str = "") -> dict[str, Any]:
    """R2 商誉(占净资产比例 + 上年商誉)。date 'YYYYMMDD'(内部取最近报告期)；symbol 过滤。"""
    return _safe(adp.get_risk_goodwill, date, symbol)


@app.get("/risk-forecast/{date}")
def risk_forecast(date: str, symbol: str = "") -> dict[str, Any]:
    """R3 业绩预告(预告类型/业绩变动幅度)。date 'YYYYMMDD'(内部取最近报告期)；symbol 过滤。"""
    return _safe(adp.get_risk_forecast, date, symbol)


@app.get("/risk-insider/{symbol}")
def risk_insider(symbol: str) -> dict[str, Any]:
    """R4 董监高持股变动(减持=变动数<0)。沪 sse / 深 szse 交易所直连。"""
    return _safe(adp.get_risk_insider, symbol)


@app.get("/symbol-search/{query}")
def symbol_search(query: str) -> dict[str, Any]:
    """问句 → 个股 [{code,name}]（④ 短名解析）。表空时返空 + 异步刷新，不阻塞。"""
    return _safe(adp.search_symbol, query)


@app.post("/symbol-table/warm")
def symbol_table_warm() -> dict[str, Any]:
    """同步刷新全量代码名称表（~70s，prewarm 每日开盘前调一次）。"""
    try:
        n = adp.refresh_symbol_table()
        return {"data": [{"count": n}], "count": 1, "source": "akshare:stock_zh_a_spot", "disclaimer": DISCLAIMER}
    except adp.AkShareUnavailable as exc:
        return {"error": str(exc), "data": [], "count": 0, "disclaimer": DISCLAIMER}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"接口调用失败: {exc}", "data": [], "count": 0, "disclaimer": DISCLAIMER}


def main() -> None:
    """Entry point — 仅监听本机回环，由同机 orchestrator 直取。"""
    import os

    import uvicorn

    port = int(os.environ.get("AKSHARE_HTTP_PORT", "8848"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
