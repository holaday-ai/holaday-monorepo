"""Stock quote and intraday integrity tests without live upstream calls."""

import datetime
import json

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


def test_intraday_rows_drop_provider_bar_ahead_of_current_market_minute():
    pd = pytest.importorskip("pandas")
    frame = pd.DataFrame(
        [
            {"day": "2026-08-04 10:55:00", "close": "21.92"},
            {"day": "2026-08-04 10:56:00", "close": "21.96"},
            # Sina can expose the still-forming bar with the next minute label.
            {"day": "2026-08-04 10:57:00", "close": "21.96"},
        ]
    )

    rows = adp._intraday_rows(
        frame,
        now=datetime.datetime(2026, 8, 4, 10, 56, 56),
    )

    assert [row["时间"] for row in rows] == [
        "2026-08-04 10:55:00",
        "2026-08-04 10:56:00",
    ]


def test_stock_news_keeps_only_linked_articles_with_source_timestamps(monkeypatch):
    calls = []

    class _Response:
        text = "callback(" + json.dumps(
            {
                "result": {
                    "cmsArticleWebOld": [
                        {
                            "title": "多伦科技<em>发布</em>新产品",
                            "content": "公司发布了面向市场的新产品。",
                            "date": "2026-08-07 11:30:00",
                            "mediaName": "真实来源",
                            "url": "https://finance.eastmoney.com/a/202608073834244063.html",
                            "image": "https://source.example/cover.jpg",
                        },
                        {
                            "title": "缺少原文链接的条目",
                            "content": "不应进入结果。",
                            "date": "2026-08-07 11:20:00",
                            "mediaName": "真实来源",
                            "url": "",
                            "image": "https://source.example/ignored.jpg",
                        },
                    ]
                }
            },
            ensure_ascii=False,
        ) + ")"

    def fetch(url, *, params, headers, timeout):
        calls.append((url, params, headers, timeout))
        return _Response()

    monkeypatch.setattr(adp, "_stock_news_http_get", fetch)

    rows, source = adp.get_stock_news("603528")

    assert calls[0][3] == adp.STOCK_NEWS_TIMEOUT_SECONDS
    assert calls[0][1]["param"]
    assert source == "eastmoney:stock-news-search"
    assert rows == [
        {
            "关键词": "603528",
            "新闻标题": "多伦科技发布新产品",
            "新闻内容": "公司发布了面向市场的新产品。",
            "发布时间": "2026-08-07 11:30:00",
            "文章来源": "真实来源",
            "新闻链接": "https://finance.eastmoney.com/a/202608073834244063.html",
            "新闻图片": "https://source.example/cover.jpg",
        }
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


def test_rankings_reject_all_zero_provider_placeholder(monkeypatch):
    clear_cache()

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "symbol": "bj920000",
                    "code": "920000",
                    "name": "占位股票",
                    "trade": "0",
                    "changepercent": "0",
                    "amount": "0",
                    "ticktime": "09:07:00",
                },
            ]

    class _Requests:
        def get(self, _url, *, params, timeout):
            assert params["node"] == "hs_a"
            assert timeout > 0
            return _Response()

    monkeypatch.setattr(adp, "requests", _Requests(), raising=False)

    with pytest.raises(adp.AkShareUnavailable, match="可验证的真实行情"):
        adp.get_stock_rankings("gainers", 1)
