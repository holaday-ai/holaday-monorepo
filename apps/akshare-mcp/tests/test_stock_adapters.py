"""Stock quote and intraday integrity tests without live upstream calls."""

import datetime
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from akshare_mcp import adapters as adp
from akshare_mcp.cache import clear_cache


class _MinuteAk:
    def __init__(self, pd, rows):
        self._pd = pd
        self._rows = rows
        self.spot_calls = 0

    def stock_zh_a_minute(self, symbol, period="1", adjust=""):
        assert symbol == "sh600519"
        assert period == "1"
        assert adjust == ""
        return self._pd.DataFrame(self._rows)

    def stock_zh_a_spot(self):
        self.spot_calls += 1
        raise AssertionError("single-symbol quote must not fetch the full-market table")


def test_quote_prefers_single_symbol_minute_source(monkeypatch):
    pd = pytest.importorskip("pandas")
    clear_cache()
    fake = _MinuteAk(
        pd,
        [
            {"day": "2026-07-30 15:00:00", "close": "99.0", "volume": "30", "amount": "2970"},
            {"day": "2026-07-31 09:31:00", "close": "100.0", "volume": "10", "amount": "1000"},
            {"day": "2026-07-31 09:32:00", "close": "101.0", "volume": "20", "amount": "2020"},
        ],
    )
    monkeypatch.setattr(adp, "ak", fake)

    rows, source = adp.get_quote("600519")

    assert source == "akshare:stock_zh_a_minute(sina,1m,latest)"
    assert rows == [
        {
            "代码": "600519",
            "最新价": 101.0,
            "涨跌幅": 2.02,
            "成交量": 30.0,
            "成交额": 3020.0,
            "行情时间": "2026-07-31 09:32:00",
        }
    ]
    assert fake.spot_calls == 0


def test_intraday_uses_latest_returned_trading_day(monkeypatch):
    pd = pytest.importorskip("pandas")
    clear_cache()
    latest_session = (
        datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
        - datetime.timedelta(days=1)
    ).isoformat()
    fake = _MinuteAk(
        pd,
        [
            {"day": f"{latest_session} 09:31:00", "close": "100.0", "volume": "10", "amount": "1000"},
            {"day": f"{latest_session} 09:32:00", "close": "101.0", "volume": "20", "amount": "2020"},
        ],
    )
    monkeypatch.setattr(adp, "ak", fake)

    rows, source = adp.get_intraday("600519")

    assert source == "akshare:stock_zh_a_minute(sina,1m)"
    assert [row["时间"] for row in rows] == [
        f"{latest_session} 09:31:00",
        f"{latest_session} 09:32:00",
    ]


def test_intraday_rows_keep_latest_session_and_sort_dedupe():
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame(
        [
            {"day": "2026-07-30 14:59:00", "close": "90"},
            {"day": "2026-07-31 11:31:00", "close": "999"},
            {"day": "2026-07-31 09:31:20", "close": "100"},
            {"day": "2026-07-31 15:01:00", "close": "999"},
            {"day": "2026-07-31 13:00:00", "close": "102"},
            {"day": "2026-07-31 09:31:50", "close": "101"},
        ]
    )

    rows = adp._intraday_rows(frame)

    assert [(row["时间"], row["最新价"]) for row in rows] == [
        ("2026-07-31 09:31:50", 101.0),
        ("2026-07-31 13:00:00", 102.0),
    ]


def test_rankings_share_one_full_market_cold_fetch(monkeypatch):
    pd = pytest.importorskip("pandas")
    clear_cache()
    calls = {"n": 0}
    calls_lock = threading.Lock()
    started = threading.Event()
    release = threading.Event()

    class _SpotAk:
        def stock_zh_a_spot(self):
            with calls_lock:
                calls["n"] += 1
            started.set()
            assert release.wait(timeout=2)
            return pd.DataFrame(
                [
                    {"代码": "sh600519", "名称": "贵州茅台", "最新价": 1500, "涨跌幅": 1.2, "成交额": 10},
                    {"代码": "sz000001", "名称": "平安银行", "最新价": 10, "涨跌幅": -0.5, "成交额": 20},
                ]
            )

    monkeypatch.setattr(adp, "ak", _SpotAk())

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [
            pool.submit(adp.get_stock_rankings, metric, 2)
            for metric in ("gainers", "losers", "amount")
        ]
        assert started.wait(timeout=1)
        time.sleep(0.05)
        release.set()
        results = [future.result(timeout=2) for future in futures]

    assert all(len(rows) == 2 for rows, _source in results)
    assert calls["n"] == 1
