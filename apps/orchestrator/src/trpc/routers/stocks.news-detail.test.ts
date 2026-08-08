import { describe, expect, it } from 'vitest';
import { stocksRouter } from './stocks.js';

describe('stocks newsDetail', () => {
  it('returns the source summary without attempting an unverified source URL', async () => {
    const caller = stocksRouter.createCaller({
      userId: 'usr_stock_reader',
      db: {},
      logger: { warn: () => undefined },
    } as never);

    await expect(caller.newsDetail({
      url: 'https://example.com/unverified-source',
      sourceName: '公开来源',
      publishedAt: '2026-08-08T10:00:00.000Z',
      summary: '来源侧已返回的摘要。',
    })).resolves.toMatchObject({
      contentStatus: 'source-summary',
      summary: '来源侧已返回的摘要。',
    });
  });
});
