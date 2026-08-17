"""Per-interface TTL cache.

The plan requires a cache layer on every interface: real-time data
(行情 / 北向资金 / 指数) gets a short TTL, slow-changing data (公告 /
龙虎榜 / K线) a longer one. Keeping it in-process + stdlib-only keeps
the wrapper "thin" — no Redis dependency for v1. Swap `_CACHE` for a
shared store later if the MCP server is scaled to multiple processes.
"""

from __future__ import annotations

import functools
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Hashable, Literal, TypeVar

T = TypeVar("T")
CacheState = Literal["fresh", "stale", "miss"]


class TTLCache:
    """Tiny thread-safe TTL cache keyed by an arbitrary hashable."""

    def __init__(self) -> None:
        self._store: dict[Hashable, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: Hashable, ttl: float) -> tuple[Any, bool]:
        value, state = self.get_state(key, ttl=ttl, stale_ttl=0)
        return value, state == "fresh"

    def get_state(
        self,
        key: Hashable,
        ttl: float,
        stale_ttl: float,
    ) -> tuple[Any, CacheState]:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None, "miss"
            stamped_at, value = entry
            age = now - stamped_at
            if age <= ttl:
                return value, "fresh"
            if stale_ttl > 0 and age <= ttl + stale_ttl:
                return value, "stale"
            self._store.pop(key, None)
            return None, "miss"

    def set(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.monotonic(), value)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_CACHE = TTLCache()


@dataclass
class _Flight:
    event: threading.Event = field(default_factory=threading.Event)
    value: Any = None
    error: BaseException | None = None


_FLIGHTS: dict[Hashable, _Flight] = {}
_FLIGHTS_LOCK = threading.Lock()


def cached(
    ttl_seconds: float,
    wait_timeout_seconds: float = 15.0,
    stale_while_revalidate_seconds: float = 0.0,
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator: cache the wrapped fetch for `ttl_seconds`.

    Keyed by function identity + positional + keyword args, so each
    distinct query (symbol / date / period) caches independently.
    """

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        stale_ttl = max(0.0, stale_while_revalidate_seconds)

        def execute_refresh(
            key: Hashable,
            flight: _Flight,
            args: tuple[Any, ...],
            kwargs: dict[str, Any],
        ) -> T:
            try:
                refreshed = fn(*args, **kwargs)
                _CACHE.set(key, refreshed)
                flight.value = refreshed
                return refreshed
            except BaseException as exc:
                flight.error = exc
                raise
            finally:
                flight.event.set()
                with _FLIGHTS_LOCK:
                    if _FLIGHTS.get(key) is flight:
                        _FLIGHTS.pop(key, None)

        def refresh_in_background(
            key: Hashable,
            flight: _Flight,
            args: tuple[Any, ...],
            kwargs: dict[str, Any],
        ) -> None:
            try:
                execute_refresh(key, flight, args, kwargs)
            except BaseException:
                # A stale value remains usable until its bounded stale window
                # expires. The next stale read may start another refresh.
                return

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            key = (fn, args, tuple(sorted(kwargs.items())))
            value, state = _CACHE.get_state(key, ttl_seconds, stale_ttl)
            if state == "fresh":
                return value  # type: ignore[return-value]

            with _FLIGHTS_LOCK:
                value, state = _CACHE.get_state(key, ttl_seconds, stale_ttl)
                if state == "fresh":
                    return value  # type: ignore[return-value]
                flight = _FLIGHTS.get(key)
                owns_flight = flight is None
                if flight is None:
                    flight = _Flight()
                    _FLIGHTS[key] = flight

                if state == "stale":
                    if owns_flight:
                        threading.Thread(
                            target=refresh_in_background,
                            args=(key, flight, args, kwargs),
                            name=f"cache-refresh-{fn.__name__}",
                            daemon=True,
                        ).start()
                    return value  # type: ignore[return-value]

            if not owns_flight:
                if not flight.event.wait(timeout=wait_timeout_seconds):
                    raise TimeoutError(
                        f"single-flight wait exceeded {wait_timeout_seconds:.3f}s"
                    )
                if flight.error is not None:
                    raise flight.error
                return flight.value  # type: ignore[return-value]

            return execute_refresh(key, flight, args, kwargs)

        return wrapper

    return decorator


def clear_cache() -> None:
    """Test / ops helper — flush everything."""
    _CACHE.clear()
