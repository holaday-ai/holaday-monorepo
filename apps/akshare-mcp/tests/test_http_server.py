"""HTTP envelope reliability tests without starting FastAPI."""

import inspect
import logging
import threading
import time

import requests

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


def test_screening_cached_adapter_serves_stale_timestamp_while_refreshing():
    clear_cache()
    calls = {"n": 0}
    calls_lock = threading.Lock()
    refresh_started = threading.Event()
    release_refresh = threading.Event()

    def fetch():
        with calls_lock:
            calls["n"] += 1
            call_number = calls["n"]
        if call_number == 1:
            return [{"代码": "600519", "版本": "v1"}], "akshare:test"
        refresh_started.set()
        assert release_refresh.wait(timeout=2)
        return [{"代码": "600519", "版本": "v2"}], "akshare:test"

    wrapped = http_server._cached_adapter(
        0.03,
        stale_while_revalidate_seconds=1.0,
    )(fetch)
    first = http_server._safe(wrapped)
    time.sleep(0.06)

    began = time.monotonic()
    stale = http_server._safe(wrapped)
    assert time.monotonic() - began < 0.1
    assert stale["data"][0]["版本"] == "v1"
    assert stale["fetched_at"] == first["fetched_at"]
    assert refresh_started.wait(timeout=1)

    second_stale = http_server._safe(wrapped)
    assert second_stale["fetched_at"] == first["fetched_at"]
    assert calls["n"] == 2

    release_refresh.set()
    deadline = time.monotonic() + 1
    refreshed = http_server._safe(wrapped)
    while refreshed["data"][0]["版本"] != "v2" and time.monotonic() < deadline:
        time.sleep(0.01)
        refreshed = http_server._safe(wrapped)

    assert refreshed["data"][0]["版本"] == "v2"
    assert refreshed["fetched_at"] != first["fetched_at"]
    assert calls["n"] == 2


def test_market_prewarm_interval_is_shorter_than_screening_fresh_ttl():
    interval = http_server._market_cache_refresh_interval_seconds()

    assert 0 < interval < adp.TTL_SPOT


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


def test_screening_universe_route_preserves_standard_envelope(monkeypatch):
    monkeypatch.setattr(
        http_server,
        "_screening_universe",
        lambda: (
            [
                {
                    "代码": "600519",
                    "名称": "贵州茅台",
                    "最新价": 1488.5,
                    "成交额": 987654321.0,
                    "市盈率TTM": 21.5,
                }
            ],
            "sina:Market_Center.getHQNodeData(full-market-screening)",
            "2026-08-17T02:05:00+00:00",
        ),
        raising=False,
    )

    result = http_server.screening_universe()

    assert result["count"] == 1
    assert result["data"][0]["代码"] == "600519"
    assert result["source"] == "sina:Market_Center.getHQNodeData(full-market-screening)"
    assert result["fetched_at"] == "2026-08-17T02:05:00+00:00"
    assert "error" not in result


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


def test_health_route_does_not_depend_on_the_sync_worker_pool():
    assert inspect.iscoroutinefunction(http_server.health)


def test_default_requests_timeout_is_injected_without_overriding_explicit_timeout(monkeypatch):
    observed_timeouts = []

    def fake_request(_session, _method, _url, **kwargs):
        observed_timeouts.append(kwargs.get("timeout"))
        return object()

    monkeypatch.setattr(requests.sessions.Session, "request", fake_request)

    assert hasattr(http_server, "_install_default_requests_timeout")
    http_server._install_default_requests_timeout(7)

    session = requests.Session()
    session.get("https://example.test/default")
    session.get("https://example.test/explicit", timeout=3)

    assert observed_timeouts == [7, 3]


def test_health_exposes_interface_error_counters():
    before = http_server._health_snapshot()

    def fetch():
        raise adp.AkShareUnavailable("offline")

    http_server._safe(fetch)
    after = http_server._health_snapshot()

    assert after["requests_total"] == before["requests_total"] + 1
    assert after["errors_total"] == before["errors_total"] + 1
    assert after["last_error_source"] == "akshare:fetch"


def test_health_counts_upstream_timeouts_without_exposing_raw_errors():
    before = http_server._health_snapshot()

    def fetch():
        raise TimeoutError("socket timed out token=secret-value")

    result = http_server._safe(fetch)
    after = http_server._health_snapshot()

    assert result["error_code"] == "UPSTREAM_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"] + 1
    assert after["single_flight_timeouts_total"] == before["single_flight_timeouts_total"]
    assert "secret-value" not in str(after)


def test_health_counts_a_timeout_wrapped_by_an_adapter():
    before = http_server._health_snapshot()

    def fetch():
        try:
            raise TimeoutError("socket timed out token=secret-value")
        except TimeoutError as exc:
            raise adp.AkShareUnavailable("source unavailable") from exc

    result = http_server._safe(fetch)
    after = http_server._health_snapshot()

    assert result["error_code"] == "UPSTREAM_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"] + 1
    assert "secret-value" not in str(after)


def test_health_counts_single_flight_wait_timeouts_separately():
    before = http_server._health_snapshot()

    def fetch():
        raise TimeoutError("single-flight wait exceeded 15.000s token=secret-value")

    result = http_server._safe(fetch)
    after = http_server._health_snapshot()

    assert result["error_code"] == "SINGLE_FLIGHT_TIMEOUT"
    assert after["timeouts_total"] == before["timeouts_total"]
    assert after["single_flight_timeouts_total"] == before["single_flight_timeouts_total"] + 1
    assert "secret-value" not in str(after)


def test_health_exposes_successful_source_fallbacks():
    before = http_server._health_snapshot()

    def fetch():
        return [{"最新价": 100}], "akshare:stock_zh_a_spot(sina,filter,fallback)"

    result = http_server._safe(fetch)
    after = http_server._health_snapshot()

    assert result["count"] == 1
    assert after["fallbacks_total"] == before["fallbacks_total"] + 1
    assert after["last_fallback_source"] == result["source"]


def test_background_prewarm_keeps_rankings_screening_universe_and_risks_warm(monkeypatch):
    calls = []

    monkeypatch.setattr(http_server, "_rank", lambda metric, limit: ([], "akshare:test", "now"))
    monkeypatch.setattr(
        http_server,
        "_screening_universe",
        lambda: ([], "akshare:screen", "now"),
    )
    monkeypatch.setattr(adp, "warm_risk_tables", lambda: calls.append("risks"))
    monkeypatch.setattr(http_server, "_safe", lambda fn, *args: calls.append((fn, args)))

    http_server._warm_market_caches_once()

    assert calls[0][1] == ("gainers", 8)
    assert calls[1][1] == ()
    assert calls[2:] == ["risks"]


def test_background_prewarm_falls_back_to_symbol_table_on_screening_error_envelope(monkeypatch):
    calls = []

    monkeypatch.setattr(http_server, "_rank", lambda metric, limit: ([], "akshare:test", "now"))
    monkeypatch.setattr(
        http_server,
        "_screening_universe",
        lambda: ([], "akshare:screen", "now"),
    )

    def safe(fn, *args):
        if fn is http_server._screening_universe:
            return {"error": "真实数据源暂不可用", "data": [], "count": 0}
        return {"data": [], "count": 0}

    monkeypatch.setattr(http_server, "_safe", safe)
    monkeypatch.setattr(adp, "refresh_symbol_table", lambda: calls.append("symbols"))
    monkeypatch.setattr(adp, "warm_risk_tables", lambda: calls.append("risks"))

    http_server._warm_market_caches_once()

    assert calls == ["symbols", "risks"]


def test_background_prewarm_isolates_screening_refresh_failure(monkeypatch, caplog):
    calls = []

    monkeypatch.setattr(http_server, "_rank", lambda metric, limit: ([], "akshare:test", "now"))

    def fail_screening():
        calls.append("screening")
        raise adp.AkShareUnavailable("screening source offline")

    monkeypatch.setattr(http_server, "_screening_universe", fail_screening)
    monkeypatch.setattr(adp, "warm_risk_tables", lambda: calls.append("risks"))

    def safe(fn, *args):
        calls.append((fn, args))
        return fn(*args)

    monkeypatch.setattr(http_server, "_safe", safe)

    with caplog.at_level(logging.WARNING, logger="akshare_mcp.http"):
        http_server._warm_market_caches_once()

    assert calls[0][1] == ("gainers", 8)
    assert calls[2:] == ["screening", "risks"]
    assert "screening-universe prewarm failed" in caplog.text
