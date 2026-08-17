import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnapshotAkshareClient } from './snapshot-akshare-client.js';

const payload = {
  generatedAt: '2026-08-16T13:55:00.000Z',
  dataAsOf: '2026-08-11',
  watchlistStocks: [
    {
      symbol: '603528',
      name: '多伦科技',
      market: 'A',
      price: '6.38',
      changePct: 1.11,
      spark: [6.32, 6.38],
      sparkLabels: ['2026-08-11 09:30:00', '2026-08-11 15:00:00'],
      tradeDate: '2026-08-11',
      turnoverAmount: 70_000_000,
      volume: 10_000,
    },
  ],
  marketIndices: [{ name: '上证指数', price: '3634.44', changePct: 0.13, turnover: '5000.00亿元' }],
  sectors: [{ name: '半导体', changePct: 3.2, leader: '兆易创新', flow: '领涨', spark: [] }],
  news: [
    {
      category: '新闻',
      publishedAt: '2026-08-11 14:00:00',
      title: '多伦科技发布新产品',
      symbols: ['603528'],
      source: '证券时报',
      url: 'https://example.com/news/1',
      summary: '公开来源摘要',
    },
  ],
};

describe('SnapshotAkshareClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serves only quote, intraday, index, and selected news from the bound payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));
    const client = new SnapshotAkshareClient(payload);

    await expect(client.getStockQuote('603528')).resolves.toMatchObject({
      source: 'stock-snapshot:quote:603528',
      fetched_at: payload.generatedAt,
      data: [{ 代码: '603528', 名称: '多伦科技', 最新价: 6.38, 涨跌幅: 1.11 }],
    });
    await expect(client.getStockIntraday('603528')).resolves.toMatchObject({
      source: 'stock-snapshot:intraday:603528',
      data: [
        { 时间: '2026-08-11 09:30:00', 最新价: 6.32 },
        { 时间: '2026-08-11 15:00:00', 最新价: 6.38 },
      ],
    });
    await expect(client.getStockKline('603528')).resolves.toMatchObject({
      data: [{ 日期: '2026-08-11', 收盘: 6.38, 涨跌幅: 1.11 }],
    });
    await expect(client.getIndexQuote('cn')).resolves.toMatchObject({
      source: 'stock-snapshot:index:cn',
      data: [{ 名称: '上证指数', 最新价: 3634.44, 涨跌幅: 0.13 }],
    });
    await expect(client.getStockNews?.('603528')).resolves.toMatchObject({
      data: [{ 新闻标题: '多伦科技发布新产品', 文章来源: '证券时报' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a bounded evidence-unavailable envelope for missing evidence and symbols', async () => {
    const client = new SnapshotAkshareClient(payload);

    await expect(client.getFundamentals('603528')).resolves.toMatchObject({
      data: [],
      error_code: 'SNAPSHOT_EVIDENCE_UNAVAILABLE',
    });
    await expect(client.getStockQuote('600519')).resolves.toMatchObject({
      data: [],
      error_code: 'SNAPSHOT_EVIDENCE_UNAVAILABLE',
    });
    await expect(client.getStockAnnouncements('603528')).resolves.toMatchObject({
      data: [],
      error_code: 'SNAPSHOT_EVIDENCE_UNAVAILABLE',
    });
  });
});
