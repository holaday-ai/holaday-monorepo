import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeStockPageInitialRequests,
  loadStockTasksPageRoute,
  prepareStockPageInitialRequests,
  preloadStockTasksPageRoute,
} from './stock-page-preload';

const api = vi.hoisted(() => ({
  watchlist: vi.fn(),
  briefingStatus: vi.fn(),
  dashboardSnapshot: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    watchlists: {
      list: { query: api.watchlist },
      briefingStatus: { query: api.briefingStatus },
    },
    stocks: {
      dashboardSnapshot: { query: api.dashboardSnapshot },
    },
  },
}));

describe('stock page initial request preload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    api.watchlist.mockReset().mockResolvedValue([{ symbol: '603528' }]);
    api.briefingStatus.mockReset().mockResolvedValue({ enabled: true });
    api.dashboardSnapshot.mockReset().mockResolvedValue({
      trust: { dataAsOf: '2026-08-21' },
    });
  });

  it('hands the route-prepared request set to the page without starting duplicates', async () => {
    const prepared = prepareStockPageInitialRequests();
    const consumed = consumeStockPageInitialRequests();

    expect(consumed).toBe(prepared);
    await expect(consumed.watchlist).resolves.toEqual([{ symbol: '603528' }]);
    await expect(consumed.briefingStatus).resolves.toEqual({ enabled: true });
    await expect(consumed.dashboardSnapshot).resolves.toEqual({
      trust: { dataAsOf: '2026-08-21' },
    });
    expect({
      watchlist: api.watchlist.mock.calls.length,
      briefing: api.briefingStatus.mock.calls.length,
      dashboard: api.dashboardSnapshot.mock.calls.length,
    }).toEqual({ watchlist: 1, briefing: 1, dashboard: 1 });
  });

  it('starts a fresh request set after the prepared set is consumed', () => {
    const prepared = prepareStockPageInitialRequests();
    expect(consumeStockPageInitialRequests()).toBe(prepared);

    const fresh = consumeStockPageInitialRequests();

    expect(fresh).not.toBe(prepared);
    expect({
      watchlist: api.watchlist.mock.calls.length,
      briefing: api.briefingStatus.mock.calls.length,
      dashboard: api.dashboardSnapshot.mock.calls.length,
    }).toEqual({ watchlist: 2, briefing: 2, dashboard: 2 });
  });

  it('discards a prepared request set that was left behind for more than 30 seconds', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(31_001);

    const prepared = prepareStockPageInitialRequests();
    const fresh = consumeStockPageInitialRequests();

    expect(fresh).not.toBe(prepared);
    expect({
      watchlist: api.watchlist.mock.calls.length,
      briefing: api.briefingStatus.mock.calls.length,
      dashboard: api.dashboardSnapshot.mock.calls.length,
    }).toEqual({ watchlist: 2, briefing: 2, dashboard: 2 });
  });

  it('warms only the stock route module, then reuses it when navigation starts data', async () => {
    const preloaded = preloadStockTasksPageRoute();

    expect(preloadStockTasksPageRoute()).toBe(preloaded);
    expect({
      watchlist: api.watchlist.mock.calls.length,
      briefing: api.briefingStatus.mock.calls.length,
      dashboard: api.dashboardSnapshot.mock.calls.length,
    }).toEqual({ watchlist: 0, briefing: 0, dashboard: 0 });
    await expect(preloaded).resolves.toHaveProperty('StockTasksPage');

    expect(loadStockTasksPageRoute()).toBe(preloaded);
    expect({
      watchlist: api.watchlist.mock.calls.length,
      briefing: api.briefingStatus.mock.calls.length,
      dashboard: api.dashboardSnapshot.mock.calls.length,
    }).toEqual({ watchlist: 1, briefing: 1, dashboard: 1 });
    consumeStockPageInitialRequests();
  });
});
