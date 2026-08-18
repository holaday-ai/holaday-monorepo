"""Stock quote and intraday integrity tests without live upstream calls."""

import datetime
import json
import threading
from urllib.parse import quote

import pytest

from akshare_mcp import adapters as adp
from akshare_mcp.cache import clear_cache


class _TradingCalendarAk:
    def __init__(self, pd, dates):
        self._pd = pd
        self._dates = dates
        self.calls = 0

    def tool_trade_date_hist_sina(self):
        self.calls += 1
        return self._pd.DataFrame({"trade_date": self._dates})


@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        ("2026-08-16", "2026-08-14"),
        ("20260816", "2026-08-14"),
        ("2026-10-08", "2026-09-30"),
    ],
)
def test_latest_trading_day_resolves_weekends_compact_dates_and_holidays(
    monkeypatch, requested, expected
):
    pd = pytest.importorskip("pandas")
    fake = _TradingCalendarAk(
        pd,
        ["2026-08-13", "2026-08-14", "2026-09-29", "2026-09-30", "2026-10-09"],
    )
    monkeypatch.setattr(adp, "ak", fake)

    records, source = adp.latest_trading_day(requested)

    assert records == [
        {
            "requested_date": (
                datetime.datetime.strptime(requested, "%Y%m%d").strftime("%Y-%m-%d")
                if "-" not in requested
                else requested
            ),
            "latest_trading_date": expected,
        }
    ]
    assert source == "akshare:tool_trade_date_hist_sina"
    assert fake.calls == 1


def test_latest_trading_day_rejects_malformed_or_unresolvable_dates(monkeypatch):
    pd = pytest.importorskip("pandas")
    monkeypatch.setattr(adp, "ak", _TradingCalendarAk(pd, ["2026-08-14"]))

    with pytest.raises(adp.AkShareUnavailable):
        adp.latest_trading_day("16/08/2026")

    with pytest.raises(adp.AkShareUnavailable):
        adp.latest_trading_day("2020-01-01")


def test_screening_universe_preserves_source_fields_and_excludes_invalid_rows(monkeypatch):
    pages = {
        1: [
            {
                "symbol": "sh600519",
                "name": "贵州茅台",
                "trade": "1488.50",
                "changepercent": "1.20",
                "amount": "987654321",
                "turnoverratio": "0.75",
                "per": "21.50",
                "pb": "7.80",
                "mktcap": "1880000000000",
                "ticktime": "10:05:00",
            },
            {
                "code": "sz000001",
                "name": "ST平安",
                "trade": "11.25",
                "changepercent": "-0.40",
                "amount": "123456789",
                "turnoverratio": "1.25",
                "per": "6.20",
                "pb": "0.65",
                "mktcap": "218000000000",
                "ticktime": "10:05:01",
            },
            {
                "code": "sh600519",
                "name": "重复行",
                "trade": "1400",
                "changepercent": "0",
                "amount": "1",
            },
            {"code": "bad", "name": "无效代码", "trade": "10", "amount": "100"},
            {"code": "600000", "name": "无价格", "trade": "0", "amount": "100"},
        ],
        2: [],
    }
    calls = []

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    def fetch(url, *, params, timeout):
        calls.append((url, dict(params), timeout))
        return _Response(pages[int(params["page"])])

    clear_cache()
    monkeypatch.setattr(adp.requests, "get", fetch)

    rows, source = adp.get_screening_universe()

    assert source == "sina:Market_Center.getHQNodeData(full-market-screening)"
    assert calls[0][1]["sort"] == "amount"
    assert calls[0][1]["num"] == "100"
    assert [row["代码"] for row in rows] == ["600519", "000001"]
    assert rows == [
        {
            "代码": "600519",
            "名称": "贵州茅台",
            "最新价": 1488.5,
            "涨跌幅": 1.2,
            "成交额": 987654321.0,
            "换手率": 0.75,
            "市盈率TTM": 21.5,
            "市净率": 7.8,
            "总市值原值": 1880000000000.0,
            "行情时间": "10:05:00",
        },
        {
            "代码": "000001",
            "名称": "ST平安",
            "最新价": 11.25,
            "涨跌幅": -0.4,
            "成交额": 123456789.0,
            "换手率": 1.25,
            "市盈率TTM": 6.2,
            "市净率": 0.65,
            "总市值原值": 218000000000.0,
            "行情时间": "10:05:01",
        },
    ]


def test_screening_universe_fetches_full_pages_with_bounded_parallelism(monkeypatch):
    page_barrier = threading.Barrier(2, timeout=1.0)

    def row(code: str, amount: str) -> dict[str, str]:
        return {
            "code": code,
            "name": f"股票{code}",
            "trade": "10.00",
            "changepercent": "1.00",
            "amount": amount,
            "turnoverratio": "2.00",
            "per": "15.00",
            "pb": "1.50",
            "mktcap": "1000000000",
            "ticktime": "10:05:00",
        }

    pages = {
        1: [row(f"600{index:03d}", str(1000 - index)) for index in range(100)],
        2: [row("600100", "2000")],
        3: [row("600101", "1900")],
    }

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    def fetch(url, *, params, timeout):
        page = int(params["page"])
        if page in (2, 3):
            page_barrier.wait()
        return _Response(pages.get(page, []))

    clear_cache()
    monkeypatch.setattr(adp.requests, "get", fetch)

    rows, source = adp.get_screening_universe()

    assert source == "sina:Market_Center.getHQNodeData(full-market-screening)"
    assert len(rows) == 102
    assert [row["代码"] for row in rows[:2]] == ["600100", "600101"]


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


def test_quote_reuses_screening_snapshot_before_full_spot_fallback(monkeypatch):
    screening_row = {
        "代码": "601958",
        "名称": "金钼股份",
        "最新价": 22.59,
        "涨跌幅": -1.57,
        "成交额": 987654321.0,
        "换手率": 1.25,
        "市盈率TTM": 12.3,
        "市净率": 2.1,
        "总市值原值": 123456789000.0,
        "行情时间": "15:00:00",
    }

    def minute_unavailable(symbol):
        raise adp.AkShareUnavailable("分钟线暂不可用")

    def full_spot_must_not_run():
        raise AssertionError("warm screening snapshot must avoid the slow full-spot fallback")

    monkeypatch.setattr(adp, "_get_sina_minute_frame", minute_unavailable)
    monkeypatch.setattr(
        adp,
        "get_screening_universe",
        lambda: (
            [screening_row],
            "sina:Market_Center.getHQNodeData(full-market-screening)",
        ),
    )
    monkeypatch.setattr(adp, "_get_a_spot_records", full_spot_must_not_run)

    rows, source = adp.get_quote("601958")

    assert rows == [screening_row]
    assert source == "sina:Market_Center.getHQNodeData(full-market-screening,filter)"


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
                            "image": "https://np-newspic.dfcfw.com/download/D25000000000000000051_w1200h675.jpg",
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
            "新闻图片": "https://np-newspic.dfcfw.com/download/D25000000000000000051_w1200h675.jpg",
        }
    ]


def test_market_news_uses_a_market_specific_keyword_and_keeps_source_rows(monkeypatch):
    seen = []

    def fetch(keyword, *, page=1, page_size=20):
        seen.append(keyword)
        return [
            {
                "关键词": keyword,
                "新闻标题": f"{keyword} 的真实动态",
                "发布时间": "2026-08-08 10:00:00",
                "文章来源": "真实来源",
                "新闻链接": "https://finance.eastmoney.com/a/202608083838244001.html",
            }
        ]

    monkeypatch.setattr(adp, "_get_eastmoney_news", fetch)

    rows, source = adp.get_market_news("us")

    assert seen == ["美股"]
    assert source == "eastmoney:market-news-search(us)"
    assert rows == [
        {
            "关键词": "美股",
            "新闻标题": "美股 的真实动态",
            "发布时间": "2026-08-08 10:00:00",
            "文章来源": "真实来源",
            "新闻链接": "https://finance.eastmoney.com/a/202608083838244001.html",
            "市场": "us",
        }
    ]


def test_cn_market_news_uses_the_requested_source_page_for_every_broad_topic(monkeypatch):
    seen = []

    def fetch(keyword, *, page=1, page_size=20):
        seen.append((keyword, page, page_size))
        return [
            {
                "关键词": keyword,
                "新闻标题": f"{keyword} 的真实动态",
                "发布时间": "2026-08-08 10:00:00",
                "文章来源": "真实来源",
                "新闻链接": f"https://finance.eastmoney.com/a/{keyword}{page}{page_size}3838244001.html",
            }
        ]

    monkeypatch.setattr(adp, "_get_eastmoney_news", fetch)

    rows, source = adp.get_market_news("cn", page=2, page_size=3)

    assert [keyword for keyword, _page, _page_size in seen] == list(adp._CN_MARKET_NEWS_KEYWORDS)
    assert all(page == 2 and page_size == 20 for _keyword, page, page_size in seen)
    assert source == "eastmoney:market-news-search(cn)"
    assert len(rows) == 3
    assert {row["关键词"] for row in rows}.issubset(set(adp._CN_MARKET_NEWS_KEYWORDS))
    assert all(row["市场"] == "cn" for row in rows)


def test_cn_market_news_keeps_other_topics_when_one_upstream_search_fails(monkeypatch):
    def fetch(keyword, *, page=1, page_size=20):
        if keyword == "新能源":
            raise RuntimeError("temporary upstream failure")
        return [
            {
                "关键词": keyword,
                "新闻标题": f"{keyword} 的真实动态",
                "发布时间": "2026-08-08 10:00:00",
                "文章来源": "真实来源",
                "新闻链接": f"https://finance.eastmoney.com/a/{keyword}3838244001.html",
            }
        ]

    monkeypatch.setattr(adp, "_get_eastmoney_news", fetch)

    rows, _source = adp.get_market_news("cn", page=1, page_size=30)

    assert len(rows) == len(adp._CN_MARKET_NEWS_KEYWORDS) - 1
    assert "新能源" not in {row["关键词"] for row in rows}
    assert all(row["市场"] == "cn" for row in rows)


def test_market_news_collapses_syndicated_versions_of_the_same_event():
    rows = [
        {
            "新闻标题": "华东医药：KIO015获欧盟MDR CE认证",
            "新闻内容": "公司产品取得欧盟认证。",
            "发布时间": "2026-08-09 10:30:00",
            "文章来源": "来源甲",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000001.html",
        },
        {
            "新闻标题": "华东医药产品KIO015通过MDR认证并获CE标志",
            "新闻内容": "KIO015医疗器械通过认证。",
            "发布时间": "2026-08-09 10:20:00",
            "文章来源": "来源乙",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000002.html",
            "新闻图片": "https://np-newspic.dfcfw.com/download/D25000000000000000001_w210h154.jpg",
        },
        {
            "新闻标题": "华东医药上半年营收同比增长",
            "新闻内容": "这是另一项公司事件。",
            "发布时间": "2026-08-09 10:10:00",
            "文章来源": "来源丙",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000003.html",
        },
    ]

    result = adp._dedupe_market_news(rows)

    assert [row["新闻标题"] for row in result] == [
        "华东医药产品KIO015通过MDR认证并获CE标志",
        "华东医药上半年营收同比增长",
    ]


def test_market_news_collapses_percentage_event_without_merging_distinct_company_news():
    rows = [
        {
            "新闻标题": "立新能源上半年净利润同比增长715.75%",
            "发布时间": "2026-08-09 09:30:00",
            "文章来源": "来源甲",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000011.html",
        },
        {
            "新闻标题": "业绩快报：立新能源净利增715.75%",
            "发布时间": "2026-08-09 09:20:00",
            "文章来源": "来源乙",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000012.html",
        },
        {
            "新闻标题": "立新能源拟建设新能源项目",
            "发布时间": "2026-08-09 09:10:00",
            "文章来源": "来源丙",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000013.html",
        },
    ]

    result = adp._dedupe_market_news(rows)

    assert [row["新闻标题"] for row in result] == [
        "立新能源上半年净利润同比增长715.75%",
        "立新能源拟建设新能源项目",
    ]


def test_market_news_collapses_same_event_without_ascii_anchor():
    rows = [
        {
            "新闻标题": "明天“打新”宇树科技！A股“朋友圈”浮出水面",
            "发布时间": "2026-08-09 20:30:00",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000014.html",
        },
        {
            "新闻标题": "宇树科技即将开启申购，A股“朋友圈”浮出水面",
            "发布时间": "2026-08-09 19:57:00",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000015.html",
        },
        {
            "新闻标题": "宇树科技发布新一代机器人控制系统",
            "发布时间": "2026-08-09 19:40:00",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000016.html",
        },
    ]

    result = adp._dedupe_market_news(rows)

    assert [row["新闻标题"] for row in result] == [
        "明天“打新”宇树科技！A股“朋友圈”浮出水面",
        "宇树科技发布新一代机器人控制系统",
    ]


def test_article_image_extractor_accepts_only_trusted_images_inside_article_body():
    html = """
      <img src="https://np-newspic.dfcfw.com/download/D20000000000000000000_w145h95.jpg">
      <div id="ContentBody">
        <p>正文</p>
        <img src="https://webquoteklinepic.eastmoney.com/GetPic.aspx?nid=0.000001">
        <img data-original="//np-newspic.dfcfw.com/download/D25000000000000000001_w1200h675.jpg">
      </div>
      <img src="https://np-newspic.dfcfw.com/download/D20000000000000000002_w145h95.jpg">
    """

    assert adp._extract_article_source_image(html) == (
        "https://np-newspic.dfcfw.com/download/D25000000000000000001_w1200h675.jpg"
    )


def test_article_image_extractor_skips_low_resolution_and_document_shaped_images():
    html = """
      <div id="ContentBody">
        <img src="https://np-newspic.dfcfw.com/download/D25000000000000000011_w210h154.jpg">
        <img src="https://np-newspic.dfcfw.com/download/D25000000000000000012_w1080h1119.jpg">
        <img src="https://np-newspic.dfcfw.com/download/D25000000000000000013_w1080h495.jpg">
        <img src="https://np-newspic.dfcfw.com/download/D25000000000000000014_w1920h1080.jpg">
      </div>
    """

    assert adp._extract_article_source_image(html) == (
        "https://np-newspic.dfcfw.com/download/D25000000000000000014_w1920h1080.jpg"
    )


def test_source_cover_rejects_small_thumbnails_and_keeps_readable_landscape_media():
    assert adp._source_cover_image_url(
        "https://np-newspic.dfcfw.com/download/D25000000000000000021_w210h154.jpg"
    ) is None
    assert adp._source_cover_image_url(
        "https://np-newspic.dfcfw.com/download/D25000000000000000022_w926h585.jpg"
    ) == "https://np-newspic.dfcfw.com/download/D25000000000000000022_w926h585.jpg"


def test_news_image_enrichment_uses_article_body_and_does_not_refetch_declared_covers(monkeypatch):
    fetched = []

    class _Response:
        text = """
          <div id="ContentBody">
            <p>正文</p>
            <img src="https://np-newspic.dfcfw.com/download/D25000000000000000002_w1200h675.jpg">
          </div>
        """

        def raise_for_status(self):
            return None

    def fetch(url, *, headers, timeout):
        fetched.append((url, timeout))
        return _Response()

    monkeypatch.setattr(adp, "_stock_news_article_http_get", fetch)
    rows = [
        {
            "新闻标题": "已有来源封面",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000021.html",
            "新闻图片": "https://np-newspic.dfcfw.com/download/D25000000000000000003_w1200h675.jpg",
        },
        {
            "新闻标题": "正文包含来源图片",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000022.html",
        },
    ]

    result = adp._enrich_news_images(rows)

    assert fetched == [("https://finance.eastmoney.com/a/202608090000022.html", adp.STOCK_NEWS_ARTICLE_TIMEOUT_SECONDS)]
    assert result[0]["新闻图片"].endswith("D25000000000000000003_w1200h675.jpg")
    assert result[1]["新闻图片"].endswith("D25000000000000000002_w1200h675.jpg")


def test_news_image_enrichment_checks_syndicated_article_candidates(monkeypatch):
    fetched = []
    image_url = "https://np-newspic.dfcfw.com/download/D25000000000000000004_w1200h675.jpg"

    class _Response:
        def __init__(self, text):
            self.text = text

        def raise_for_status(self):
            return None

    def fetch(url, *, headers, timeout):
        fetched.append(url)
        if url.endswith("000032.html"):
            return _Response(f'<div id="ContentBody"><img src="{image_url}"></div>')
        return _Response('<div id="ContentBody"><p>无图正文</p></div>')

    monkeypatch.setattr(adp, "_stock_news_article_http_get", fetch)
    rows = adp._dedupe_market_news([
        {
            "新闻标题": "华东医药KIO015通过MDR认证并获CE标志",
            "新闻内容": "更完整但无图的摘要内容",
            "发布时间": "2026-08-09 10:30:00",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000031.html",
        },
        {
            "新闻标题": "华东医药产品KIO015获欧盟MDR CE认证",
            "新闻内容": "短摘要",
            "发布时间": "2026-08-09 10:20:00",
            "新闻链接": "https://finance.eastmoney.com/a/202608090000032.html",
        },
    ])

    result = adp._enrich_news_images(rows)

    assert len(result) == 1
    assert result[0]["新闻图片"] == image_url
    assert adp._ARTICLE_IMAGE_CANDIDATES_KEY not in result[0]
    assert fetched == [
        "https://finance.eastmoney.com/a/202608090000031.html",
        "https://finance.eastmoney.com/a/202608090000032.html",
    ]


def test_news_image_enrichment_replaces_an_unreadable_declared_thumbnail(monkeypatch):
    cover = "https://np-newspic.dfcfw.com/download/D25000000000000000044_w1200h675.jpg"

    class _Response:
        text = f'<div id="ContentBody"><img src="{cover}"></div>'

        def raise_for_status(self):
            return None

    monkeypatch.setattr(adp, "_stock_news_article_http_get", lambda *_args, **_kwargs: _Response())
    result = adp._enrich_news_images([{
        "新闻标题": "低清缩略图不应阻止寻找正文封面",
        "新闻链接": "https://finance.eastmoney.com/a/202608090000043.html",
        "新闻图片": "https://np-newspic.dfcfw.com/download/D25000000000000000043_w210h154.jpg",
    }])

    assert result[0]["新闻图片"] == cover


def test_market_news_uses_an_ascii_encoded_referer_for_chinese_keywords(monkeypatch):
    seen_headers = []

    class _Response:
        text = "callback(" + json.dumps(
            {
                "result": {
                    "cmsArticleWebOld": [
                        {
                            "title": "美股市场动态",
                            "date": "2026-08-08 10:00:00",
                            "mediaName": "真实来源",
                            "url": "https://finance.eastmoney.com/a/202608083838244002.html",
                        }
                    ]
                }
            },
            ensure_ascii=False,
        ) + ")"

    def fetch(url, *, params, headers, timeout):
        seen_headers.append(headers)
        return _Response()

    monkeypatch.setattr(adp, "_stock_news_http_get", fetch)

    rows, source = adp.get_market_news("us")

    assert source == "eastmoney:market-news-search(us)"
    assert rows[0]["关键词"] == "美股"
    assert seen_headers[0]["referer"].isascii()
    assert seen_headers[0]["referer"].endswith(f"keyword={quote('美股')}")


def test_market_news_rejects_unknown_market():
    with pytest.raises(adp.AkShareUnavailable, match="cn、us、hk"):
        adp.get_market_news("jp")


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
