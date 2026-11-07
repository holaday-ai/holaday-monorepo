import { expect, it } from 'vitest';
import { HttpAkshareClient } from '../agent/a-share/akshare-http-client.js';
import { SnapshotAkshareClient } from './snapshot-akshare-client.js';
import { selectStockAnalysisInput } from './stock-analysis-input.js';
const payload = {
  generatedAt: '2026-10-09T03:35:00Z',
  dataAsOf: '2026-10-09',
  watchlistStocks: [],
  marketIndices: [],
  sectors: [],
  news: [],
};
const context = {
  snapshotId: 'stkshot_fixture',
  dataAsOf: '2026-10-09',
  trustMode: 'current' as const,
  evidenceIds: [],
  snapshotPayload: payload,
};
it('current whole-market context queries the provider even when 600519 is absent from the watchlist', () => {
  const now = new Date('2026-10-09T03:41:00Z');
  const live = new HttpAkshareClient({ baseUrl: 'http://fixture.test' });
  const result = selectStockAnalysisInput(context, live, now);
  expect(result.client).toBe(live);
  expect(result.submittedAt).toEqual(now);
  expect(result.matchNow).toEqual(now);
});
it('historical, delayed and day-rollover contexts retain the snapshot, while submission time stays real', () => {
  const now = new Date('2026-10-10T03:41:00Z');
  const live = new HttpAkshareClient({ baseUrl: 'http://fixture.test' });
  for (const trustMode of ['current', 'historical', 'delayed'] as const) {
    const result = selectStockAnalysisInput({ ...context, trustMode }, live, now);
    expect(result.client).toBeInstanceOf(SnapshotAkshareClient);
    expect(result.submittedAt).toEqual(now);
    expect(result.matchNow.toISOString().slice(0, 10)).toBe('2026-10-09');
  }
});
