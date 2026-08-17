import { describe, expect, it, vi } from 'vitest';
import {
  type StockSourceHealth,
  latestExpectedTradingDate,
  marketSessionAt,
  stockSnapshotTrust,
} from './stock-trust.js';

const HEALTHY_SOURCES: StockSourceHealth[] = [
  {
    key: 'quotes',
    status: 'healthy',
    dataAsOf: '2026-08-14',
    fetchedAt: '2026-08-16T13:55:00.000Z',
  },
  {
    key: 'indices',
    status: 'healthy',
    dataAsOf: '2026-08-14',
    fetchedAt: '2026-08-16T13:55:00.000Z',
  },
  {
    key: 'news',
    status: 'healthy',
    dataAsOf: '2026-08-16',
    fetchedAt: '2026-08-16T13:55:00.000Z',
  },
  {
    key: 'announcements',
    status: 'healthy',
    dataAsOf: '2026-08-15',
    fetchedAt: '2026-08-16T13:55:00.000Z',
  },
];

function trustInput(overrides: Record<string, unknown> = {}) {
  return {
    snapshotKey: 'user-watchlist',
    now: new Date('2026-08-16T14:00:00.000Z'),
    generatedAt: '2026-08-16T13:55:00.000Z',
    latestExpectedTradingDate: '2026-08-14',
    dataAsOf: '2026-08-14',
    calendarStatus: 'verified' as const,
    freshnessStatus: 'fresh' as const,
    sources: HEALTHY_SOURCES,
    evidenceIds: ['quote:603528:2026-08-14'],
    ...overrides,
  };
}

describe('stock snapshot trust', () => {
  it('marks an older trading date historical even when the legacy cache says fresh', () => {
    expect(
      stockSnapshotTrust(
        trustInput({
          dataAsOf: '2026-08-11',
          evidenceIds: ['quote:603528:2026-08-11'],
        }),
      ).mode,
    ).toBe('historical');
  });

  it('accepts the latest verified Friday snapshot on Sunday', () => {
    expect(stockSnapshotTrust(trustInput())).toMatchObject({
      mode: 'current',
      marketTimezone: 'Asia/Shanghai',
      marketSession: 'non-trading',
      latestExpectedTradingDate: '2026-08-14',
      dataAsOf: '2026-08-14',
      calendarStatus: 'verified',
    });
  });

  it('keeps latest verified quotes current while a background refresh is incomplete', () => {
    expect(stockSnapshotTrust(trustInput({ freshnessStatus: 'refreshing' }))).toMatchObject({
      mode: 'current',
    });
  });

  it('never calls a snapshot current when the exchange calendar is unavailable', () => {
    expect(
      stockSnapshotTrust(
        trustInput({
          latestExpectedTradingDate: null,
          calendarStatus: 'unavailable',
        }),
      ),
    ).toMatchObject({ mode: 'delayed', calendarStatus: 'unavailable' });
  });

  it('marks missing data or a snapshot generated more than seven days ago unavailable', () => {
    expect(stockSnapshotTrust(trustInput({ dataAsOf: null }))).toMatchObject({
      mode: 'unavailable',
      dataAsOf: null,
    });
    expect(stockSnapshotTrust(trustInput({ generatedAt: '2026-08-09T13:54:59.999Z' })).mode).toBe(
      'unavailable',
    );
  });

  it('marks source data older than seven days unavailable even after a new refresh attempt', () => {
    expect(
      stockSnapshotTrust(
        trustInput({
          generatedAt: '2026-08-16T13:55:00.000Z',
          dataAsOf: '2026-08-01',
          evidenceIds: ['quote:603528:2026-08-01'],
        }),
      ).mode,
    ).toBe('unavailable');
  });

  it('derives a stable snapshot id from the exact trust payload', () => {
    const first = stockSnapshotTrust(trustInput());
    const repeated = stockSnapshotTrust(trustInput());
    const anotherDate = stockSnapshotTrust(
      trustInput({
        generatedAt: '2026-08-16T13:56:00.000Z',
      }),
    );

    expect(first.snapshotId).toMatch(/^stkshot_[a-f0-9]{24}$/);
    expect(repeated.snapshotId).toBe(first.snapshotId);
    expect(anotherDate.snapshotId).not.toBe(first.snapshotId);
  });

  it('keeps the snapshot id stable when only delivery freshness changes', () => {
    const current = stockSnapshotTrust(trustInput({ freshnessStatus: 'fresh' }));
    const refreshing = stockSnapshotTrust(trustInput({ freshnessStatus: 'refreshing' }));

    expect(current.mode).toBe('current');
    expect(refreshing.mode).toBe('current');
    expect(refreshing.snapshotId).toBe(current.snapshotId);
  });
});

describe('A-share market calendar boundary', () => {
  it('uses the prior calendar date before 09:45 Shanghai and today afterwards', async () => {
    const getLatestTradingDay = vi.fn(async (onOrBefore: string) => ({
      data: [
        {
          requested_date: onOrBefore,
          latest_trading_date: onOrBefore === '2026-08-16' ? '2026-08-14' : '2026-08-17',
        },
      ],
      count: 1,
      source: 'fake:calendar',
      fetched_at: '2026-08-17T00:00:00.000Z',
      disclaimer: 'x',
    }));
    const client = { getLatestTradingDay };

    await expect(
      latestExpectedTradingDate(client as never, new Date('2026-08-17T01:30:00.000Z')),
    ).resolves.toEqual({
      date: '2026-08-14',
      status: 'verified',
      fetchedAt: '2026-08-17T00:00:00.000Z',
      isTradingDay: true,
    });
    await expect(
      latestExpectedTradingDate(client as never, new Date('2026-08-17T02:00:00.000Z')),
    ).resolves.toMatchObject({ date: '2026-08-17', status: 'verified' });
    expect(getLatestTradingDay).toHaveBeenNthCalledWith(1, '2026-08-17');
    expect(getLatestTradingDay).toHaveBeenNthCalledWith(2, '2026-08-16');
    expect(getLatestTradingDay).toHaveBeenNthCalledWith(3, '2026-08-17');
  });

  it('returns an unavailable calendar state instead of guessing on failure', async () => {
    const client = {
      getLatestTradingDay: vi.fn(async () => ({
        data: [],
        count: 0,
        source: 'fake:calendar',
        fetched_at: '2026-08-17T00:00:00.000Z',
        disclaimer: 'x',
        error: 'offline',
      })),
    };

    await expect(
      latestExpectedTradingDate(client as never, new Date('2026-08-17T02:00:00.000Z')),
    ).resolves.toEqual({
      date: null,
      status: 'unavailable',
      fetchedAt: '2026-08-17T00:00:00.000Z',
      isTradingDay: null,
    });
  });

  it('derives market sessions in Shanghai time', () => {
    expect(marketSessionAt(new Date('2026-08-17T01:00:00.000Z'), true)).toBe('preopen');
    expect(marketSessionAt(new Date('2026-08-17T02:00:00.000Z'), true)).toBe('open');
    expect(marketSessionAt(new Date('2026-08-17T04:00:00.000Z'), true)).toBe('lunch');
    expect(marketSessionAt(new Date('2026-08-17T08:00:00.000Z'), true)).toBe('closed');
    expect(marketSessionAt(new Date('2026-08-16T08:00:00.000Z'), false)).toBe('non-trading');
  });
});
