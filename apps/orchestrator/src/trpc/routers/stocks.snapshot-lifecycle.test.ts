import { createHash } from 'node:crypto';
import { getTableName, type SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateStockTaskContext } from '../../stocks/stock-task-context.js';
import { resetAkshareCircuitBreakersForTests } from '../../agent/a-share/akshare-http-client.js';
import { __stocksDashboardTest, stocksRouter } from './stocks.js';

const logger = { warn: vi.fn(), info: vi.fn() };
const watchlist = [{ symbol: '603528', market: 'A' as const, displayName: '多伦科技' }];
const cacheKey = '7:603528:A:多伦科技';
const canonicalKey = createHash('sha256').update(cacheKey).digest('hex');
function database(snapshot: unknown) {
  const rows = [{ userId: 7, cacheKeyHash: canonicalKey, snapshotJson: snapshot }];
  const dialect = new MySqlDialect();
  const db = {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: (condition: SQL) => {
      const name = getTableName(table);
      const parameters = dialect.sqlToQuery(condition).params;
      const values = () => name === 'users' ? [{ id: 7 }] : name !== 'stock_dashboard_snapshots' ? watchlist : rows.filter(r => r.userId === parameters[0] && (parameters.length === 1 || r.cacheKeyHash === parameters[1]));
      return { limit: async (count: number) => values().slice(0, count), orderBy: () => Object.assign(Promise.resolve(values()), { limit: async (count: number) => values().slice(0, count) }) };
    } }) }),
    insert: () => ({ values: (row: typeof rows[number]) => ({ onDuplicateKeyUpdate: async () => {
      const old = rows.find(r => r.userId === row.userId && r.cacheKeyHash === row.cacheKeyHash);
      if (old) old.snapshotJson = row.snapshotJson; else rows.push(row);
    } }) }),
    delete: () => ({ where: async () => undefined }),
  };
  return { db, rows };
}
async function cachedFixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-16T14:00:00Z'));
  const calendar = { available: true };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = new URL(String(input));
    if (url.pathname === '/trading-calendar/latest' && !calendar.available) return new Response(JSON.stringify({ data: [], count: 0, source: 'test' }));
    const data = url.pathname === '/trading-calendar/latest' ? [{ requested_date: url.searchParams.get('on_or_before'), latest_trading_date: '2026-08-14' }] : url.pathname === '/quote/603528' ? [{ 代码: 'sh603528', 名称: '多伦科技', 最新价: 6.38, 涨跌幅: 1.11 }] : url.pathname === '/kline/603528' ? [{ 日期: '2026-08-13', 收盘: 6.31 }, { 日期: '2026-08-14', 收盘: 6.38 }] : url.pathname === '/intraday/603528' ? [{ 时间: '2026-08-14 09:30:00', 最新价: 6.32 }, { 时间: '2026-08-14 15:00:00', 最新价: 6.38 }] : [];
    return new Response(JSON.stringify({ data, count: data.length, fetched_at: '2026-08-16T14:00:00Z', source: 'test', disclaimer: 'test' }));
  });
  const snapshot = await __stocksDashboardTest.buildDashboardSnapshot({ logger, watchlistRows: watchlist, effectiveWatchlist: watchlist, now: new Date(), includeSlowSignals: false, snapshotKey: cacheKey });
  __stocksDashboardTest.dashboardCache.set(cacheKey, { snapshot, freshUntil: Date.now() + 60_000, staleUntil: Date.now() + 600_000 });
  const data = database(snapshot);
  const caller = stocksRouter.createCaller({ userId: 'usr_snapshot_contract', req: {}, logger, db: data.db } as never);
  return { ...data, caller, calendar, snapshot };
}
function context(snapshot: Awaited<ReturnType<typeof __stocksDashboardTest.buildDashboardSnapshot>>) {
  const trust = snapshot.trust!;
  return { snapshotId: trust.snapshotId, dataAsOf: trust.dataAsOf!, trustMode: trust.mode as 'current' | 'delayed' | 'historical', evidenceIds: [] };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetAkshareCircuitBreakersForTests(); __stocksDashboardTest.dashboardCache.clear(); });
describe('served dashboard snapshot context', () => {
  it("never resolves another user's issued version", async () => {
    const { caller, db } = await cachedFixture(); const delivered = await caller.dashboardSnapshot();
    await expect(validateStockTaskContext({ db: db as never, userId: 99, input: context(delivered), intent: '查看自选股风险雷达' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('rejects an expired previous version and still validates the exact current display version', async () => {
    const { caller, db, rows, snapshot } = await cachedFixture(); const delivered = await caller.dashboardSnapshot();
    vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
    await expect(validateStockTaskContext({ db: db as never, userId: 7, input: context(delivered), intent: '查看自选股风险雷达' })).resolves.toMatchObject({ snapshotId: delivered.trust!.snapshotId });
    rows[0]!.snapshotJson = { ...snapshot, trust: { ...snapshot.trust, snapshotId: 'stkshot_aaaaaaaaaaaaaaaaaaaaaaaa' } };
    await expect(validateStockTaskContext({ db: db as never, userId: 7, input: context(delivered), intent: '查看自选股风险雷达' })).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('过期') });
  });
  it('does not issue a successful dashboard when the context cannot be stored', async () => {
    const { caller, db } = await cachedFixture(); db.insert = () => { throw new Error('DB unavailable'); };
    await expect(caller.dashboardSnapshot()).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
  it('keeps evidence validation on issued versions', async () => {
    const { caller, db } = await cachedFixture(); const delivered = await caller.dashboardSnapshot();
    await expect(validateStockTaskContext({ db: db as never, userId: 7, input: { ...context(delivered), evidenceIds: ['quote:forged'] }, intent: '查看自选股风险雷达' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('validates the exact cached version returned after calendar revalidation changes its fingerprint', async () => {
    const { caller, calendar, snapshot, db } = await cachedFixture(); calendar.available = false;
    const delivered = await caller.dashboardSnapshot();
    expect(delivered.trust!.snapshotId).not.toBe(snapshot.trust!.snapshotId);
    await expect(validateStockTaskContext({ db: db as never, userId: 7, input: context(delivered), intent: '查看自选股风险雷达' })).resolves.toMatchObject({ snapshotId: delivered.trust!.snapshotId });
  });
  it('keeps an issued version valid after background refresh overwrites the display cache', async () => {
    const { caller, rows, db, snapshot } = await cachedFixture();
    const delivered = await caller.dashboardSnapshot();
    rows[0]!.snapshotJson = { ...snapshot, trust: { ...snapshot.trust, snapshotId: 'stkshot_aaaaaaaaaaaaaaaaaaaaaaaa' } };
    await expect(validateStockTaskContext({ db: db as never, userId: 7, input: context(delivered), intent: '查看自选股风险雷达' })).resolves.toMatchObject({ snapshotId: delivered.trust!.snapshotId });
  });
});
