"""Cache layer tests — the one piece testable without live AkShare."""

import time

from akshare_mcp.cache import TTLCache, cached, clear_cache


def test_set_get_hit():
    c = TTLCache()
    c.set("k", 42)
    val, hit = c.get("k", ttl=10)
    assert hit is True
    assert val == 42


def test_miss_on_unknown_key():
    c = TTLCache()
    val, hit = c.get("nope", ttl=10)
    assert hit is False
    assert val is None


def test_expiry():
    c = TTLCache()
    c.set("k", "v")
    # ttl=0 → already expired on the next read
    val, hit = c.get("k", ttl=0)
    assert hit is False
    assert val is None


def test_cached_decorator_dedupes_calls():
    clear_cache()
    calls = {"n": 0}

    @cached(ttl_seconds=10)
    def fetch(x):
        calls["n"] += 1
        return x * 2

    assert fetch(21) == 42
    assert fetch(21) == 42  # served from cache
    assert calls["n"] == 1  # underlying fn called once
    assert fetch(5) == 10  # different arg → fresh call
    assert calls["n"] == 2


def test_cached_distinct_kwargs():
    clear_cache()
    calls = {"n": 0}

    @cached(ttl_seconds=10)
    def fetch(symbol, period="daily"):
        calls["n"] += 1
        return f"{symbol}:{period}"

    fetch("600519", period="daily")
    fetch("600519", period="weekly")
    assert calls["n"] == 2  # period is part of the cache key


def test_cached_expiry_refetches():
    clear_cache()
    calls = {"n": 0}

    @cached(ttl_seconds=0.05)
    def fetch():
        calls["n"] += 1
        return calls["n"]

    assert fetch() == 1
    time.sleep(0.08)
    assert fetch() == 2  # TTL elapsed → refetched
