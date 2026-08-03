"""Stock quote and intraday integrity tests without live upstream calls."""

import datetime

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


@pytest.mark.parametrize(
    ("metric", "expected_sort", "expected_asc", "expected_codes"),
    [
        ("gainers", "changepercent", "0", ["300001", "600001"]),
        ("losers", "changepercent", "1", ["600001", "300001"]),
        ("amount", "amount", "0", ["600001", "300001"]),
    ],
)
def test_rankings_use_one_sorted_sina_page(
    monkeypatch,
    metric,
    expected_sort,
    expected_asc,
    expected_codes,
):
    clear_cache()
    calls = []

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "symbol": "sz300001",
                    "code": "300001",
                    "name": "特锐德",
                    "trade": "12.30",
                    "changepercent": "4.50",
                    "amount": "1000",
                    "ticktime": "10:01:02",
                },
                {
                    "symbol": "sh600001",
                    "code": "600001",
                    "name": "邯郸钢铁",
                    "trade": "8.10",
                    "changepercent": "-2.00",
                    "amount": "3000",
                    "ticktime": "10:01:01",
                },
            ]

    class _Requests:
        def get(self, url, *, params, timeout):
            calls.append((url, params, timeout))
            return _Response()

    class _FullMarketMustNotRun:
        def stock_zh_a_spot(self):
            raise AssertionError("rankings must not fetch every A-share page")

    monkeypatch.setattr(adp, "requests", _Requests(), raising=False)
    monkeypatch.setattr(adp, "ak", _FullMarketMustNotRun())

    rows, source = adp.get_stock_rankings(metric, 2)

    assert len(calls) == 1
    url, params, timeout = calls[0]
    assert url.startswith("https://")
    assert params["page"] == "1"
    assert params["sort"] == expected_sort
    assert params["asc"] == expected_asc
    assert 2 <= int(params["num"]) <= 80
    assert timeout > 0
    assert [row["代码"] for row in rows] == expected_codes
    assert source == f"akshare:sina-stock-rankings({metric})"
