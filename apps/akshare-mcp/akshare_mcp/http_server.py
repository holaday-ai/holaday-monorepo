"""Thin FastAPI HTTP transport over the akshare adapters.

确定性简报（③）不走 LLM → orchestrator 直接 HTTP 取数（非 MCP-stdio；orchestrator
无 @modelcontextprotocol/sdk）。复用 adapters + 进程内 TTL cache，envelope 与 MCP
server.py 完全一致 `{data,count,source,fetched_at,disclaimer}`（错误优雅降级）。

Run（Vultr，仅监听 127.0.0.1，由 orchestrator 同机直取，不对外暴露）：
    uvicorn akshare_mcp.http_server:app --host 127.0.0.1 --port 8848

合规：DATA 层 only —— 只聚合，不荐股、不预测；每条结果带来源+时间戳+免责。
"""

from __future__ import annotations

import functools
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import requests
from fastapi import FastAPI

from . import adapters as adp
from .cache import cached

DISCLAIMER = "数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。"
_LOGGER = logging.getLogger("akshare_mcp.http")
_OPS_LOCK = threading.Lock()
_OPS: dict[str, Any] = {
    "requests_total": 0,
    "errors_total": 0,
    "timeouts_total": 0,
    "single_flight_timeouts_total": 0,
    "fallbacks_total": 0,
    "last_success_at": None,
    "last_error_at": None,
    "last_error_source": None,
    "last_fallback_at": None,
    "last_fallback_source": None,
}


def _install_default_requests_timeout(timeout_seconds: float | None = None) -> None:
    """Bound AkShare's requests calls while preserving explicit timeouts."""
    timeout = timeout_seconds
    if timeout is None:
        timeout = float(os.environ.get("AKSHARE_MCP_HTTP_TIMEOUT", "15"))
    timeout = max(float(timeout), 1.0)

    current_request = requests.sessions.Session.request
    if getattr(current_request, "_akshare_default_timeout", False):
        return

    @functools.wraps(current_request)
    def request_with_default_timeout(
        session: requests.Session,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> requests.Response:
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = timeout
        return current_request(session, method, url, **kwargs)

    setattr(request_with_default_timeout, "_akshare_default_timeout", True)
    requests.sessions.Session.request = request_with_default_timeout


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_hint(fn: Callable[..., Any]) -> str:
    name = getattr(fn, "__name__", "unknown")
    return f"akshare:{name}"


def _record_operation(
    *,
    source: str,
    succeeded: bool,
    fallback: bool = False,
    timeout_kind: str | None = None,
) -> None:
    now = _utc_now()
    with _OPS_LOCK:
        _OPS["requests_total"] += 1
        if succeeded:
            _OPS["last_success_at"] = now
            if fallback:
                _OPS["fallbacks_total"] += 1
                _OPS["last_fallback_at"] = now
                _OPS["last_fallback_source"] = source
        else:
            _OPS["errors_total"] += 1
            if timeout_kind == "upstream":
                _OPS["timeouts_total"] += 1
            elif timeout_kind == "single_flight":
                _OPS["single_flight_timeouts_total"] += 1
            _OPS["last_error_at"] = now
            _OPS["last_error_source"] = source


def _timeout_kind(exc: BaseException) -> str | None:
    """Classify wrapped transport timeouts without exposing their messages."""
    current: BaseException | None = exc
    saw_timeout = False
    visited: set[int] = set()
    while current is not None and id(current) not in visited:
        visited.add(id(current))
        message = str(current).lower()
        if message.startswith("single-flight wait exceeded"):
            return "single_flight"
        type_name = type(current).__name__.lower()
        if isinstance(current, TimeoutError) or "timeout" in type_name or "timed out" in message:
            saw_timeout = True
        current = current.__cause__ or current.__context__
    return "upstream" if saw_timeout else None


def _timeout_response(
    *,
    exc: BaseException,
    source_hint: str,
    started: float,
) -> dict[str, Any] | None:
    timeout_kind = _timeout_kind(exc)
    if timeout_kind is None:
        return None
    error_code = "SINGLE_FLIGHT_TIMEOUT" if timeout_kind == "single_flight" else "UPSTREAM_TIMEOUT"
    _record_operation(
        source=source_hint,
        succeeded=False,
        timeout_kind=timeout_kind,
    )
    _LOGGER.warning(
        "akshare adapter timeout source=%s elapsed_ms=%.1f timeout_kind=%s",
        source_hint,
        (time.monotonic() - started) * 1000,
        timeout_kind,
    )
    return {
        "error": "真实数据源响应超时",
        "error_code": error_code,
        "data": [],
        "count": 0,
        "source": source_hint,
        "fetched_at": _utc_now(),
        "disclaimer": DISCLAIMER,
    }


def _envelope(
    records: list[dict[str, Any]],
    source: str,
    fetched_at: str | None = None,
) -> dict[str, Any]:
    return {
        "data": records,
        "count": len(records),
        "source": source,
        "fetched_at": fetched_at or _utc_now(),
        "disclaimer": DISCLAIMER,
    }


def _cached_adapter(
    ttl_seconds: float,
    *,
    stale_while_revalidate_seconds: float = 0.0,
) -> Callable[[Callable[..., tuple[list[dict[str, Any]], str]]], Callable[..., tuple[list[dict[str, Any]], str, str]]]:
    """Cache adapter data together with the time the upstream fetch completed."""

    def decorator(
        fn: Callable[..., tuple[list[dict[str, Any]], str]],
    ) -> Callable[..., tuple[list[dict[str, Any]], str, str]]:
        @cached(
            ttl_seconds,
            stale_while_revalidate_seconds=stale_while_revalidate_seconds,
        )
        @functools.wraps(fn)
        def fetch(*args: Any, **kwargs: Any) -> tuple[list[dict[str, Any]], str, str]:
            records, source = fn(*args, **kwargs)
            return records, source, _utc_now()

        return fetch

    return decorator


def _safe(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> dict[str, Any]:
    """Run an adapter, wrap success; degrade any error to a structured payload."""
    started = time.monotonic()
    source_hint = _source_hint(fn)
    try:
        result = fn(*args, **kwargs)
        if len(result) == 3:
            records, source, fetched_at = result
        else:
            records, source = result
            fetched_at = None
        _record_operation(source=source, succeeded=True, fallback="fallback" in source.lower())
        return _envelope(records, source, fetched_at)
    except adp.AkShareUnavailable as exc:
        timeout_response = _timeout_response(
            exc=exc,
            source_hint=source_hint,
            started=started,
        )
        if timeout_response is not None:
            return timeout_response
        _record_operation(source=source_hint, succeeded=False)
        _LOGGER.warning(
            "akshare adapter unavailable source=%s elapsed_ms=%.1f error_type=%s",
            source_hint,
            (time.monotonic() - started) * 1000,
            type(exc).__name__,
        )
        return {
            "error": "真实数据源暂不可用",
            "error_code": "AKSHARE_UNAVAILABLE",
            "data": [],
            "count": 0,
            "source": source_hint,
            "fetched_at": _utc_now(),
            "disclaimer": DISCLAIMER,
        }
    except TimeoutError as exc:
        timeout_response = _timeout_response(
            exc=exc,
            source_hint=source_hint,
            started=started,
        )
        if timeout_response is not None:
            return timeout_response
        raise AssertionError("TimeoutError must have a timeout classification") from exc
    except Exception as exc:  # noqa: BLE001 - any akshare/network failure
        timeout_response = _timeout_response(
            exc=exc,
            source_hint=source_hint,
            started=started,
        )
        if timeout_response is not None:
            return timeout_response
        _record_operation(source=source_hint, succeeded=False)
        _LOGGER.warning(
            "akshare adapter failure source=%s elapsed_ms=%.1f error_type=%s",
            source_hint,
            (time.monotonic() - started) * 1000,
            type(exc).__name__,
        )
        return {
            "error": "真实数据源调用失败",
            "error_code": "UPSTREAM_FAILURE",
            "data": [],
            "count": 0,
            "source": source_hint,
            "fetched_at": _utc_now(),
            "disclaimer": DISCLAIMER,
        }


# Cached fetches — one TTL per interface (same as server.py).
_quote = _cached_adapter(adp.TTL_QUOTE)(adp.get_quote)
_intraday = _cached_adapter(adp.TTL_INTRADAY)(adp.get_intraday)
_kline = _cached_adapter(adp.TTL_KLINE)(adp.get_kline)
_announce = _cached_adapter(adp.TTL_ANNOUNCE)(adp.get_announcements)
_stock_news = _cached_adapter(adp.TTL_STOCK_NEWS)(adp.get_stock_news)
_market_news = _cached_adapter(adp.TTL_STOCK_NEWS)(adp.get_market_news)
_lhb = _cached_adapter(adp.TTL_LHB)(adp.get_dragon_tiger)
_north = _cached_adapter(adp.TTL_NORTHBOUND)(adp.get_northbound_flow)
_index = _cached_adapter(adp.TTL_INDEX)(adp.get_index_quote)
_unlock = _cached_adapter(adp.TTL_UNLOCK)(adp.get_share_unlock)
_tradecal = _cached_adapter(adp.TTL_TRADECAL)(adp.is_trading_day)
_latest_tradecal = _cached_adapter(adp.TTL_TRADECAL)(adp.latest_trading_day)
# v2 简报：温度计+板块(含即时 ths/指数 spot)→ 短 TTL 覆盖投递窗口；涨停回顾(prevday 历史)→ 长 TTL。
_pulse = _cached_adapter(adp.TTL_PULSE)(adp.get_market_pulse)
_ztsum = _cached_adapter(adp.TTL_LHB)(adp.get_zt_pool_summary)
# Phase 2 全景速览 step1：④ 基本面（季度级长缓存）+ ⑤ 估值（日级缓存）。
_fund = _cached_adapter(adp.TTL_FUND)(adp.get_fundamentals)
_val = _cached_adapter(adp.TTL_VAL)(adp.get_valuation)
_rank = _cached_adapter(adp.TTL_RANK)(adp.get_stock_rankings)
_screening_universe = _cached_adapter(
    adp.TTL_SPOT,
    stale_while_revalidate_seconds=max(
        0.0,
        float(os.environ.get("AKSHARE_MCP_SCREENING_STALE_SECONDS", "900")),
    ),
)(adp.get_screening_universe)

app = FastAPI(title="akshare-cn-http", docs_url=None, redoc_url=None)


@app.get("/health")
@app.get("/healthz")
async def health() -> dict[str, Any]:
    """Serve liveness without consuming the sync adapter worker pool."""
    return _health_snapshot()


def _health_snapshot() -> dict[str, Any]:
    """Return compact adapter interruption counters for operations."""
    with _OPS_LOCK:
        ops = dict(_OPS)
    return {
        "status": "ok",
        "adapter_ready": adp.ak is not None,
        **ops,
    }


@app.get("/index/{market}")
def index_quote(market: str) -> dict[str, Any]:
    """market: 'hk' | 'us' | 'cn'。"""
    return _safe(_index, market)


@app.get("/announcements/{symbol}")
def announcements(symbol: str, start_date: str = "", end_date: str = "") -> dict[str, Any]:
    """start_date/end_date: 'YYYYMMDD'。不传日期时 cninfo 返历史默认页（多为旧公告）；
    简报按日期窗口取（盘前近 24h / 盘后当日），由 service 传范围。cache 按 args 分键。"""
    return _safe(_announce, symbol, start_date, end_date)


@app.get("/stock-news/{symbol}")
def stock_news(symbol: str) -> dict[str, Any]:
    """个股真实新闻（东方财富），仅返回带发布时间与原文链接的文章。"""
    return _safe(_stock_news, symbol)


@app.get("/market-news/{market}")
def market_news(market: str, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    """市场真实新闻。market: cn（A股）| us（美股）| hk（港股）。"""
    return _safe(_market_news, market, page=page, page_size=page_size)


@app.get("/unlock/{symbol}")
def share_unlock(symbol: str) -> dict[str, Any]:
    return _safe(_unlock, symbol)


@app.get("/kline/{symbol}")
def kline(symbol: str, days: int = 0) -> dict[str, Any]:
    """days>0 → 近 days 交易日 raw 序列(P3 F走势 本地算)；默认 0 = 末2行(①盘面，不变)。
    cache 按 (symbol, days) 分键（序列与单行各自缓存）。"""
    return _safe(_kline, symbol, days=days)


@app.get("/quote/{symbol}")
def quote(symbol: str) -> dict[str, Any]:
    return _safe(_quote, symbol)


@app.get("/intraday/{symbol}")
def intraday(symbol: str) -> dict[str, Any]:
    """真实分钟线；仅返回数据源实际分钟点，不补齐、不外推。"""
    return _safe(_intraday, symbol)


@app.get("/stock-rankings/{metric}")
def stock_rankings(metric: str, limit: int = 20) -> dict[str, Any]:
    """metric: gainers | losers | amount。换手率源暂不可得，不提供假数据。"""
    return _safe(_rank, metric, limit)


@app.get("/screening-universe")
def screening_universe() -> dict[str, Any]:
    """全市场筛选初筛快照；只返回新浪源提供的行情/估值字段。"""
    return _safe(_screening_universe)


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


@app.get("/trading-calendar/latest")
def trading_calendar_latest(on_or_before: str) -> dict[str, Any]:
    """Return the latest A-share trading date on or before the requested date."""
    return _safe(_latest_tradecal, on_or_before)


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


@app.post("/risk-warm")
def risk_warm() -> dict[str, Any]:
    """预热 3 张风险全市场表(质押/商誉/预告)入进程缓存。冷取慢(>1min/张) → 由启动钩子 + 周期后台
    调；命中后客户端秒回。手动触发(部署后/补热)也走此端点。返回各表行数。"""
    try:
        counts = adp.warm_risk_tables()
        return {"data": [counts], "count": 1, "source": "risk-warm", "disclaimer": DISCLAIMER}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"接口调用失败: {exc}", "data": [], "count": 0, "disclaimer": DISCLAIMER}


def _warm_market_caches_once() -> None:
    """Warm independent ranking, screening-universe, and risk snapshots."""
    _safe(_rank, "gainers", 8)
    try:
        # The screening universe also hydrates the symbol table, avoiding a
        # second 5,500-row Sina crawl during the same prewarm cycle.
        screening = _safe(_screening_universe)
        if isinstance(screening, dict) and screening.get("error"):
            adp.refresh_symbol_table()
    except Exception:  # noqa: BLE001 - each cache must warm independently
        _LOGGER.exception("akshare screening-universe prewarm failed")
    try:
        adp.warm_risk_tables()
    except Exception:  # noqa: BLE001 - each cache must warm independently
        _LOGGER.exception("akshare risk-table prewarm failed")


def _market_cache_refresh_interval_seconds() -> float:
    """Keep the expensive screening snapshot fresh before its TTL expires."""
    fresh_ttl = max(float(adp.TTL_SPOT), 1.0)
    default_interval = min(240.0, fresh_ttl * 0.8)
    configured = float(
        os.environ.get(
            "AKSHARE_MCP_MARKET_PREWARM_INTERVAL_SECONDS",
            str(default_interval),
        )
    )
    return min(max(configured, 0.1), fresh_ttl * 0.9)


@app.on_event("startup")
def _prewarm_risk_on_startup() -> None:
    """启动后台预热市场快照与风险表，daemon 线程不阻塞 startup。"""

    def _loop() -> None:
        while True:
            try:
                _warm_market_caches_once()
            except Exception:  # noqa: BLE001 - 预热失败不影响服务
                _LOGGER.exception("akshare background prewarm failed")
            time.sleep(_market_cache_refresh_interval_seconds())

    threading.Thread(target=_loop, daemon=True).start()


def main() -> None:
    """Entry point — 仅监听本机回环，由同机 orchestrator 直取。"""
    import uvicorn

    _install_default_requests_timeout()
    port = int(os.environ.get("AKSHARE_HTTP_PORT", "8848"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
