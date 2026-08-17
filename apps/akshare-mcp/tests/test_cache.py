"""Cache layer tests — the one piece testable without live AkShare."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

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


def test_cached_single_flights_concurrent_cold_miss():
    clear_cache()
    calls = {"n": 0}
    calls_lock = threading.Lock()
    started = threading.Event()
    release = threading.Event()

    @cached(ttl_seconds=10)
    def fetch(symbol):
        with calls_lock:
            calls["n"] += 1
        started.set()
        assert release.wait(timeout=2)
        return f"quote:{symbol}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch, "600519") for _ in range(8)]
        assert started.wait(timeout=1)
        time.sleep(0.05)
        release.set()
        assert [future.result(timeout=2) for future in futures] == ["quote:600519"] * 8

    assert calls["n"] == 1


def test_cached_follower_timeout_is_bounded_without_canceling_owner():
    clear_cache()
    started = threading.Event()
    release = threading.Event()

    @cached(ttl_seconds=10, wait_timeout_seconds=0.05)
    def fetch(symbol):
        started.set()
        assert release.wait(timeout=2)
        return f"quote:{symbol}"

    with ThreadPoolExecutor(max_workers=2) as pool:
        owner = pool.submit(fetch, "600519")
        assert started.wait(timeout=1)
        follower = pool.submit(fetch, "600519")
        began = time.monotonic()
        try:
            with pytest.raises(TimeoutError, match="single-flight wait exceeded"):
                follower.result(timeout=1)
            assert time.monotonic() - began < 0.5
        finally:
            release.set()
        assert owner.result(timeout=1) == "quote:600519"


def test_cached_serves_bounded_stale_while_one_background_refreshes():
    clear_cache()
    calls = {"n": 0}
    calls_lock = threading.Lock()
    refresh_started = threading.Event()
    release_refresh = threading.Event()

    @cached(ttl_seconds=0.03, stale_while_revalidate_seconds=1.0)
    def fetch():
        with calls_lock:
            calls["n"] += 1
            call_number = calls["n"]
        if call_number == 1:
            return "snapshot-v1"
        refresh_started.set()
        assert release_refresh.wait(timeout=2)
        return "snapshot-v2"

    assert fetch() == "snapshot-v1"
    time.sleep(0.06)

    began = time.monotonic()
    assert fetch() == "snapshot-v1"
    assert time.monotonic() - began < 0.1
    assert refresh_started.wait(timeout=1)

    assert fetch() == "snapshot-v1"
    assert calls["n"] == 2

    release_refresh.set()
    deadline = time.monotonic() + 1
    value = fetch()
    while value != "snapshot-v2" and time.monotonic() < deadline:
        time.sleep(0.01)
        value = fetch()

    assert value == "snapshot-v2"
    assert calls["n"] == 2


def test_stale_window_expires_instead_of_serving_forever(monkeypatch):
    clock = {"now": 100.0}
    monkeypatch.setattr("akshare_mcp.cache.time.monotonic", lambda: clock["now"])
    cache = TTLCache()
    cache.set("universe", "snapshot-v1")

    clock["now"] = 106.0
    assert cache.get_state("universe", ttl=5, stale_ttl=5) == ("snapshot-v1", "stale")

    clock["now"] = 111.0
    assert cache.get_state("universe", ttl=5, stale_ttl=5) == (None, "miss")
