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


def test_health_exposes_successful_source_fallbacks():
    before = http_server.health()

    def fetch():
        return [{"最新价": 100}], "akshare:stock_zh_a_spot(sina,filter,fallback)"

    result = http_server._safe(fetch)
    after = http_server.health()

    assert result["count"] == 1
    assert after["fallbacks_total"] == before["fallbacks_total"] + 1
    assert after["last_fallback_source"] == result["source"]
