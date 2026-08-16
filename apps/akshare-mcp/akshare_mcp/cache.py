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
from typing import Any, Callable, Hashable, TypeVar

T = TypeVar("T")


class TTLCache:
    """Tiny thread-safe TTL cache keyed by an arbitrary hashable."""

    def __init__(self) -> None:
        self._store: dict[Hashable, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: Hashable, ttl: float) -> tuple[Any, bool]:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None, False
            stamped_at, value = entry
            if now - stamped_at > ttl:
                self._store.pop(key, None)
                return None, False
            return value, True

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
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Decorator: cache the wrapped fetch for `ttl_seconds`.

    Keyed by function identity + positional + keyword args, so each
    distinct query (symbol / date / period) caches independently.
    """

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            key = (fn, args, tuple(sorted(kwargs.items())))
            value, hit = _CACHE.get(key, ttl_seconds)
            if hit:
                return value  # type: ignore[return-value]

            with _FLIGHTS_LOCK:
                value, hit = _CACHE.get(key, ttl_seconds)
                if hit:
                    return value  # type: ignore[return-value]
                flight = _FLIGHTS.get(key)
                owns_flight = flight is None
                if flight is None:
                    flight = _Flight()
                    _FLIGHTS[key] = flight

            if not owns_flight:
                if not flight.event.wait(timeout=wait_timeout_seconds):
                    raise TimeoutError(
                        f"single-flight wait exceeded {wait_timeout_seconds:.3f}s"
                    )
                if flight.error is not None:
                    raise flight.error
                return flight.value  # type: ignore[return-value]

            try:
                value = fn(*args, **kwargs)
                _CACHE.set(key, value)
                flight.value = value
                return value
            except BaseException as exc:
                flight.error = exc
                raise
            finally:
                flight.event.set()
                with _FLIGHTS_LOCK:
                    if _FLIGHTS.get(key) is flight:
                        _FLIGHTS.pop(key, None)

        return wrapper

    return decorator


def clear_cache() -> None:
    """Test / ops helper — flush everything."""
    _CACHE.clear()
