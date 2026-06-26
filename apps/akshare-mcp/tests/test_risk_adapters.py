"""④ 风险源 P2 修复：日期往前探（R1质押/R2商誉/R3预告）+ 预热 逻辑测试.

monkeypatch 全市场表函数（不依赖 akshare/pandas）；验探回**有界**（≤4周/≤4季）、命中即停、
都空兜底当期（不死循环）、预热返各表行数。akshare 在 adapters.py 内 try/except 守护。
"""

import pytest

from akshare_mcp import adapters as adp
from akshare_mcp.cache import _CACHE


@pytest.fixture(autouse=True)
def _clear_cache():
    _CACHE.clear()
    yield
    _CACHE.clear()


def test_quarter_ends_desc_bounded_and_descending():
    assert adp._quarter_ends_desc("20260331", 4) == [
        "20260331",
        "20251231",
        "20250930",
        "20250630",
    ]
    assert len(adp._quarter_ends_desc("20260331", 2)) == 2


def test_latest_pledge_date_probes_back_to_published(monkeypatch):
    calls: list[str] = []

    def fake_all(d: str):
        calls.append(d)
        return [{"股票代码": "600519"}] if d == "20260612" else []

    monkeypatch.setattr(adp, "_risk_pledge_all", fake_all)
    assert adp._latest_pledge_date("20260626") == "20260612"
    assert calls == ["20260626", "20260619", "20260612"]  # 当周→每周回退,命中即停


def test_latest_pledge_date_all_empty_falls_back_bounded(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(adp, "_risk_pledge_all", lambda d: calls.append(d) or [])
    assert adp._latest_pledge_date("20260626") == "20260626"  # 都空 → 返当周五(空集,优雅)
    assert len(calls) == 5  # 当周 + 回退4周 = 5 次,**有界无死循环**


def test_latest_goodwill_period_probes_back(monkeypatch):
    monkeypatch.setattr(adp, "_risk_goodwill_all", lambda p: [{"x": 1}] if p == "20251231" else [])
    assert adp._latest_goodwill_period("20260331") == "20251231"  # Q1空→回退到上年报


def test_latest_forecast_period_all_empty_fallback(monkeypatch):
    monkeypatch.setattr(adp, "_risk_forecast_all", lambda p: [])
    assert adp._latest_forecast_period("20260331") == "20260331"  # 都空 → 返当期(兜底)


def test_warm_risk_tables_returns_counts(monkeypatch):
    monkeypatch.setattr(adp, "_risk_pledge_all", lambda d: [{"a": 1}, {"a": 2}])
    monkeypatch.setattr(adp, "_risk_goodwill_all", lambda p: [{"b": 1}])
    monkeypatch.setattr(adp, "_risk_forecast_all", lambda p: [])
    out = adp.warm_risk_tables("20260626")
    assert out == {"pledge": 2, "goodwill": 1, "forecast": 0}
