/**
 * §6c — HttpAkshareClient 单测（注入 mock fetch，不联网）.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAkshareClient, resetAkshareCircuitBreakersForTests } from './akshare-http-client.js';

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
  afterEach(() => {
    resetAkshareCircuitBreakersForTests();
  });

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
      '/stock-news/600519': { body },
      '/market-news/us?page=1&page_size=20': { body },
      '/unlock/600519': { body },
      '/kline/600519': { body },
      '/quote/600519': { body },
      '/stock-rankings/gainers?limit=10': { body },
      '/dragon-tiger/20260612': { body },
      '/northbound': { body },
      '/trading-calendar/latest?on_or_before=2026-08-16': { body },
    });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    await c.getStockAnnouncements('600519');
    await c.getStockNews('600519');
    await c.getMarketNews('us');
    await c.getShareUnlock('600519');
    await c.getStockKline('600519');
    await c.getStockRankings('gainers', 10);
    await c.getDragonTiger('20260612');
    await c.getNorthboundFlow();
    await c.getLatestTradingDay('2026-08-16');
    await c.getStockRankings('gainers', 10);
    expect(calls).toEqual([
      'http://127.0.0.1:8848/announcements/600519',
      'http://127.0.0.1:8848/stock-news/600519',
      'http://127.0.0.1:8848/market-news/us?page=1&page_size=20',
      'http://127.0.0.1:8848/unlock/600519',
      'http://127.0.0.1:8848/kline/600519',
      'http://127.0.0.1:8848/stock-rankings/gainers?limit=10',
      'http://127.0.0.1:8848/dragon-tiger/20260612',
      'http://127.0.0.1:8848/northbound',
      'http://127.0.0.1:8848/trading-calendar/latest?on_or_before=2026-08-16',
      'http://127.0.0.1:8848/stock-rankings/gainers?limit=10',
    ]);
  });

  it('非 200 → error envelope（优雅降级）', async () => {
    const { fetchImpl } = mockFetch({ '/northbound': { ok: false, status: 503 } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    const r = await c.getNorthboundFlow();
    expect(r.error_code).toBe('UPSTREAM_HTTP');
    expect(r.error).not.toContain('HTTP 503');
    expect(r.data).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('网络抛错 → error envelope（不崩）', async () => {
    const { fetchImpl } = mockFetch({ '/kline/600519': { throws: true } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });
    const r = await c.getStockKline('600519');
    expect(r.error_code).toBe('UPSTREAM_UNAVAILABLE');
    expect(r.error).not.toContain('network down');
    expect(r.data).toEqual([]);
  });

  it('同一路由组连续失败三次后熔断，第四次不再发起 fetch', async () => {
    const { fetchImpl, calls } = mockFetch({
      '/quote/600519': { ok: false, status: 503 },
      '/index/cn': { body: okEnv },
    });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(c.getStockQuote('600519')).resolves.toMatchObject({
        error_code: 'UPSTREAM_HTTP',
      });
    }
    await expect(c.getStockQuote('600519')).resolves.toMatchObject({
      data: [],
      error_code: 'CIRCUIT_OPEN',
    });
    expect(calls.filter((url) => url.endsWith('/quote/600519'))).toHaveLength(3);

    await expect(c.getIndexQuote('cn')).resolves.toEqual(okEnv);
    expect(calls.at(-1)).toBe('http://127.0.0.1:8848/index/cn');
  });

  it('在同一 AkShare 基址的 client 实例之间共享熔断状态', async () => {
    const { fetchImpl, calls } = mockFetch({ '/quote/600519': { ok: false, status: 503 } });
    const first = new HttpAkshareClient({ baseUrl: 'http://shared-circuit-test', fetchImpl });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await first.getStockQuote('600519');
    }

    const nextRequest = new HttpAkshareClient({
      baseUrl: 'http://shared-circuit-test',
      fetchImpl,
    });
    await expect(nextRequest.getStockQuote('600519')).resolves.toMatchObject({
      error_code: 'CIRCUIT_OPEN',
    });
    expect(calls).toHaveLength(3);
  });

  it('将 malformed envelope 计为失败并在同组熔断', async () => {
    const { fetchImpl, calls } = mockFetch({ '/stock-news/600519': { body: {} } });
    const c = new HttpAkshareClient({ baseUrl: 'http://127.0.0.1:8848', fetchImpl });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(c.getStockNews('600519')).resolves.toMatchObject({
        data: [],
        error_code: 'UPSTREAM_INVALID',
      });
    }
    await expect(c.getStockNews('600519')).resolves.toMatchObject({
      error_code: 'CIRCUIT_OPEN',
    });
    expect(calls).toHaveLength(3);
  });

  it('④ 风险端点用 riskTimeoutMs(25s)、非风险用 timeoutMs(10s)：差异化超时', async () => {
    vi.useFakeTimers();
    const aborted = new Set<string>();
    // 永不 resolve，只在 signal abort 时 reject（模拟冷缓存全市场慢取）。
    const hangFetch = (url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          aborted.add(url);
          rej(new Error('aborted'));
        });
      });
    const c = new HttpAkshareClient({
      baseUrl: 'http://x',
      fetchImpl: hangFetch as never,
      timeoutMs: 10_000,
      riskTimeoutMs: 25_000,
    });
    const pNB = c.getNorthboundFlow();
    const pRisk = c.getRiskPledge('20260612', '600519');
    await vi.advanceTimersByTimeAsync(10_000);
    // 10s：非风险已超时 abort、风险还撑着（用更长超时）。
    expect([...aborted].some((u) => u.includes('/northbound'))).toBe(true);
    expect([...aborted].some((u) => u.includes('/risk-pledge'))).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000); // 累计 25s → 风险才 abort
    expect([...aborted].some((u) => u.includes('/risk-pledge'))).toBe(true);
    const [rNB, rRisk] = await Promise.all([pNB, pRisk]); // 收尾：catch→error envelope
    expect(rNB).toMatchObject({ error_code: 'UPSTREAM_TIMEOUT' });
    expect(rRisk).toMatchObject({ error_code: 'UPSTREAM_TIMEOUT' });
    expect(rNB.error).not.toContain('aborted');
    expect(rRisk.error).not.toContain('aborted');
    vi.useRealTimers();
  });

  it('日志和用户 envelope 都不包含上游错误原文', async () => {
    const warn = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down token=secret-value');
    });
    const c = new HttpAkshareClient({
      baseUrl: 'http://127.0.0.1:8848',
      fetchImpl,
      logger: { warn },
    });

    const result = await c.getStockQuote('600519');

    expect(result).toMatchObject({ error_code: 'UPSTREAM_UNAVAILABLE' });
    expect(JSON.stringify(result)).not.toContain('secret-value');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value');
  });
});
