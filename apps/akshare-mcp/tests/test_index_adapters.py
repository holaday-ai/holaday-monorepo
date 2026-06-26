"""adapter 逻辑测试（G1 US 涨跌幅 + G3 A股指数 sina 过滤 + kline sina + 前缀）。

`pct_change` / `sina_prefix` 纯逻辑随处可跑；用到 `_records` 的经 pandas（随
akshare 安装），本地无 pandas 时 `importorskip` 跳过，CI / Vultr 跑。

adapters.py 现含 `from .cache import ...`（④ 风险源缓存）→ 按文件 importlib 加载会因相对
导入失败；改包导入（akshare 在 adapters.py 内 try/except 守护，本地无 akshare 也能 import）。
"""

import pytest

from akshare_mcp import adapters as adp


@pytest.mark.parametrize(
    "prev,last,expected",
    [(5400, 5433.21, 0.62), (200.5, 198.5, -1.0), (100, 100, 0.0), ("39000", "39200", 0.51)],
)
def test_pct_change(prev, last, expected):
    assert adp.pct_change(prev, last) == expected


def test_pct_change_guards():
    assert adp.pct_change(None, 100) is None
    assert adp.pct_change(100, None) is None
    assert adp.pct_change(0, 100) is None  # 除零保护
    assert adp.pct_change("x", 100) is None  # 非数


def test_sina_prefix():
    assert adp.sina_prefix("600519") == "sh600519"  # 沪
    assert adp.sina_prefix("000001") == "sz000001"  # 深
    assert adp.sina_prefix("300750") == "sz300750"  # 创业板
    assert adp.sina_prefix("830799") == "bj830799"  # 北交所(8)
    assert adp.sina_prefix("sh600519") == "sh600519"  # 已带前缀


class _FakeAk:
    """最小 fake akshare：按调用返回预置 DataFrame。"""

    def __init__(self, pd):
        self._pd = pd

    def index_us_stock_sina(self, symbol):
        if symbol == ".INX":
            return self._pd.DataFrame(
                {"date": ["2026-06-09", "2026-06-10"], "close": [5400.0, 5433.21]}
            )
        if symbol == ".DJI":
            return self._pd.DataFrame(
                {"date": ["2026-06-09", "2026-06-10"], "close": [39000.0, 39200.0]}
            )
        # .IXIC 仅一行 → 涨跌幅 None
        return self._pd.DataFrame({"date": ["2026-06-10"], "close": [17000.0]})

    def stock_zh_index_spot_sina(self):
        # sina A股指数 spot：代码带 sh/sz 前缀，渲染器/adapter 按代码过滤。
        return self._pd.DataFrame(
            {
                "代码": ["sh000001", "sh000300", "sz399006", "sz399001"],
                "名称": ["上证指数", "沪深300", "创业板指", "深证成指"],
                "最新价": [3100.0, 4000.0, 2000.0, 9800.0],
                "涨跌幅": [0.5, 0.1, -0.3, 0.2],
                "成交额": [3.2e11, 5.0e11, 1.1e11, 2.8e11],
            }
        )

    def stock_zh_a_daily(self, symbol, start_date=None, end_date=None, adjust=None):
        # 末 2 行 close 1272 → 1279（涨跌幅由 adapter 算）。
        return self._pd.DataFrame(
            {
                "date": ["2026-06-10", "2026-06-11"],
                "open": [1270.0, 1272.12],
                "high": [1275.0, 1282.88],
                "low": [1268.0, 1266.91],
                "close": [1272.0, 1279.0],
                "volume": [2000000, 2535198],
                "amount": [3.0e9, 3230008220.0],
            }
        )


def test_us_indices(monkeypatch):
    pd = pytest.importorskip("pandas")
    monkeypatch.setattr(adp, "ak", _FakeAk(pd))
    rows = adp._us_indices()
    by = {r["名称"]: r for r in rows}
    assert [r["名称"] for r in rows] == ["标普500", "道琼斯", "纳斯达克"]
    assert by["标普500"]["收盘"] == 5433.21
    assert by["标普500"]["涨跌幅"] == 0.62
    assert by["道琼斯"]["涨跌幅"] == 0.51
    assert by["纳斯达克"]["涨跌幅"] is None  # 仅一行无法算环比


def test_cn_indices_filters_and_orders(monkeypatch):
    pd = pytest.importorskip("pandas")
    monkeypatch.setattr(adp, "ak", _FakeAk(pd))
    rows = adp._cn_indices()
    # 按代码 sh000001/sz399001/sz399006 过滤(剔除沪深300)，规范排序 上证→深证→创业板
    assert [r["名称"] for r in rows] == ["上证指数", "深证成指", "创业板指"]


def test_get_kline_sina_computes_pct(monkeypatch):
    pd = pytest.importorskip("pandas")
    monkeypatch.setattr(adp, "ak", _FakeAk(pd))
    recs, src = adp.get_kline("600519")
    assert len(recs) == 1
    r = recs[0]
    assert r["收盘"] == 1279.0
    assert r["涨跌幅"] == round((1279.0 - 1272.0) / 1272.0 * 100, 2)  # 末2行算
    assert r["成交额"] == 3230008220.0
    assert "sina" in src
