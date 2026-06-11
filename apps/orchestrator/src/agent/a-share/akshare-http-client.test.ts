/**
 * §6c — HttpAkshareClient 单测（注入 mock fetch，不联网）.
 */

import { describe, expect, it } from 'vitest';
import { HttpAkshareClient } from './akshare-http-client.js';

interface Route {
  ok?: boolean;
  status?: number;
  body?: unknown;
  throws?: boolean;
}

function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const r = routes[path] ?? { ok: false, status: 404 };
    if (r.throws) throw new Error('network down');
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
  return { fetchImpl, calls };
}

const okEnv = {
  data: [{ 名称: '上证指数', 最新价: 3987.01 }],
  count: 1,
  source: 'akshare:stock_zh_index_spot_sina',
  fetched_at: '2026-06-12T07:25:00Z',
  disclaimer: 'x',
};

describe('HttpAkshareClient', () => {
  it('GET /index/cn → 透传 envelope，URL 正确', async () => {
    const { fetchImpl, calls } = mockFetch({ '/index/cn': { body: okEnv } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848/', fetchImpl });
    const r = await c.getIndexQuote('cn');
    expect(r).toEqual(okEnv);
    expect(calls[0]).toBe('http://127.0.0.1:8848/index/cn'); // 末尾斜杠已规整
  });

  it('各方法打到对应路径（含编码）', async () => {
    const body = { data: [], count: 0, source: 's', fetched_at: 'x', disclaimer: 'y' };
    const { fetchImpl, calls } = mockFetch({
      '/announcements/600519': { body },
      '/unlock/600519': { body },
      '/kline/600519': { body },
      '/quote/600519': { body },
      '/dragon-tiger/20260612': { body },
      '/northbound': { body },
    });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    await c.getStockAnnouncements('600519');
    await c.getShareUnlock('600519');
    await c.getStockKline('600519');
    await c.getDragonTiger('20260612');
    await c.getNorthboundFlow();
    expect(calls).toEqual([
      'http://127.0.0.1:8848/announcements/600519',
      'http://127.0.0.1:8848/unlock/600519',
      'http://127.0.0.1:8848/kline/600519',
      'http://127.0.0.1:8848/dragon-tiger/20260612',
      'http://127.0.0.1:8848/northbound',
    ]);
  });

  it('非 200 → error envelope（优雅降级）', async () => {
    const { fetchImpl } = mockFetch({ '/northbound': { ok: false, status: 503 } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    const r = await c.getNorthboundFlow();
    expect(r.error).toContain('HTTP 503');
    expect(r.data).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('网络抛错 → error envelope（不崩）', async () => {
    const { fetchImpl } = mockFetch({ '/kline/600519': { throws: true } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    const r = await c.getStockKline('600519');
    expect(r.error).toContain('network down');
    expect(r.data).toEqual([]);
  });
});
