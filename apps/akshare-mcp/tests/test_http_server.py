"""HTTP envelope reliability tests without starting FastAPI."""

import logging

from akshare_mcp import adapters as adp
from akshare_mcp import http_server
from akshare_mcp.cache import clear_cache


def test_cached_adapter_preserves_actual_fetch_timestamp():
    clear_cache()
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        return [{"最新价": 100}], "akshare:test"

    wrapped = http_server._cached_adapter(60)(fetch)
    first = http_server._safe(wrapped)
    second = http_server._safe(wrapped)

    assert calls["n"] == 1
    assert second["fetched_at"] == first["fetched_at"]


def test_trading_calendar_latest_route_preserves_source_and_fetch_timestamp(monkeypatch):
    monkeypatch.setattr(
        http_server,
        "_latest_tradecal",
        lambda requested: (
            [{"requested_date": requested, "latest_trading_date": "2026-08-14"}],
            "akshare:tool_trade_date_hist_sina",
            "2026-08-16T14:00:00+00:00",
        ),
    )

    result = http_server.trading_calendar_latest("2026-08-16")

    assert result["data"] == [
        {"requested_date": "2026-08-16", "latest_trading_date": "2026-08-14"}
    ]
    assert result["source"] == "akshare:tool_trade_date_hist_sina"
    assert result["fetched_at"] == "2026-08-16T14:00:00+00:00"


def test_error_envelope_is_attributed_timestamped_and_sanitized(caplog):
    def fetch():
        raise adp.AkShareUnavailable("upstream token=secret-value")

    with caplog.at_level(logging.WARNING, logger="akshare_mcp.http"):
        result = http_server._safe(fetch)

    assert result["source"] == "akshare:fetch"
    assert result["error_code"] == "AKSHARE_UNAVAILABLE"
    assert result["error"] == "真实数据源暂不可用"
    assert "secret-value" not in result["error"]
    assert "secret-value" not in caplog.text
    assert result["fetched_at"].endswith("+00:00")


def test_health_exposes_interface_error_counters():
    before = http_server.health()

    def fetch():
        raise adp.AkShareUnavailable("offline")

    http_server._safe(fetch)
    after = http_server.health()

    assert after["requests_total"] == before["requests_total"] + 1
    assert after["errors_total"] == before["errors_total"] + 1
    assert after["last_error_source"] == "akshare:fetch"


def test_health_counts_upstream_timeouts_without_exposing_raw_errors():
    before = http_server.health()

    def fetch():
        raise TimeoutError("socket timed out token=secret-value")

    result = http_server._safe(fetch)
    after = http_server.health()

    assert result["error_code"] == "UPSTREAM_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"] + 1
    assert after["single_flight_timeouts_total"] == before["single_flight_timeouts_total"]
    assert "secret-value" not in str(after)


def test_health_counts_a_timeout_wrapped_by_an_adapter():
    before = http_server.health()

    def fetch():
        try:
            raise TimeoutError("socket timed out token=secret-value")
        except TimeoutError as exc:
            raise adp.AkShareUnavailable("source unavailable") from exc

    result = http_server._safe(fetch)
    after = http_server.health()

    assert result["error_code"] == "UPSTREAM_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"] + 1
    assert "secret-value" not in str(after)


def test_health_counts_single_flight_wait_timeouts_separately():
    before = http_server.health()

    def fetch():
        raise TimeoutError("single-flight wait exceeded 15.000s token=secret-value")

    result = http_server._safe(fetch)
    after = http_server.health()

    assert result["error_code"] == "SINGLE_FLIGHT_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"]
    assert after["single_flight_timeouts_total"] == before["single_flight_timeouts_total"] + 1
    assert "secret-value" not in str(after)


def test_health_exposes_successful_source_fallbacks():
    before = http_server.health()

    def fetch():
        return [{"最新价": 100}], "akshare:stock_zh_a_spot(sina,filter,fallback)"

    result = http_server._safe(fetch)
    after = http_server.health()

    assert result["count"] == 1
    assert after["fallbacks_total"] == before["fallbacks_total"] + 1
    assert after["last_fallback_source"] == result["source"]


def test_background_prewarm_keeps_fast_rankings_and_slow_symbol_tables_warm(monkeypatch):
    calls = []

    monkeypatch.setattr(http_server, "_rank", lambda metric, limit: ([], "akshare:test", "now"))
    monkeypatch.setattr(adp, "refresh_symbol_table", lambda: calls.append("symbols"))
    monkeypatch.setattr(adp, "warm_risk_tables", lambda: calls.append("risks"))
    monkeypatch.setattr(http_server, "_safe", lambda fn, *args: calls.append((fn, args)))

    http_server._warm_market_caches_once()

    assert calls[0][1] == ("gainers", 8)
    assert calls[1:] == ["symbols", "risks"]


def test_background_prewarm_isolates_symbol_refresh_failure(monkeypatch, caplog):
    calls = []

    monkeypatch.setattr(http_server, "_rank", lambda metric, limit: ([], "akshare:test", "now"))

    def fail_symbols():
        calls.append("symbols")
        raise adp.AkShareUnavailable("symbol source offline")

    monkeypatch.setattr(adp, "refresh_symbol_table", fail_symbols)
    monkeypatch.setattr(adp, "warm_risk_tables", lambda: calls.append("risks"))
    monkeypatch.setattr(http_server, "_safe", lambda fn, *args: calls.append((fn, args)))

    with caplog.at_level(logging.WARNING, logger="akshare_mcp.http"):
        http_server._warm_market_caches_once()

    assert calls[0][1] == ("gainers", 8)
    assert calls[1:] == ["symbols", "risks"]
    assert "symbol-table prewarm failed" in caplog.text
