import { describe, expect, it } from 'vitest';
import * as dashboardTrust from './stock-dashboard-trust';

describe('stock dashboard trust state', () => {
  it('allows reports only when the latest observed trading date is fresh', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'fresh',
        observedTradeDate: '2026-07-24',
        refreshedAt: '2026-07-24T07:02:00.000Z',
        now: new Date('2026-07-24T07:05:00.000Z'),
      }),
    ).toMatchObject({
      tone: 'fresh',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      dataDateLabel: '数据日期 07/24',
      refreshLabel: '刷新于 07/24 15:02',
    });
  });

  it('keeps a current trading-date snapshot usable while slower sources are still loading', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'partial',
        observedTradeDate: '2026-08-07',
        refreshedAt: '2026-08-07T06:35:00.000Z',
        now: new Date('2026-08-07T06:36:00.000Z'),
      }),
    ).toMatchObject({
      tone: 'fresh',
      canGenerateBriefing: true,
      dataDateLabel: '数据日期 08/07',
      message: null,
    });
  });

  it('labels a latest valid snapshot as refreshing instead of expired while AkShare refreshes it', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'refreshing',
        freshnessMessage: '正在后台刷新行情，当前展示最近一次真实数据。',
        observedTradeDate: '2026-08-07',
        refreshedAt: '2026-08-08T17:11:00.000Z',
        now: new Date('2026-08-08T17:12:00.000Z'),
      }),
    ).toMatchObject({
      tone: 'refreshing',
      statusLabel: '行情刷新中',
      canGenerateBriefing: false,
      dataDateLabel: '数据日期 08/07',
      message: '正在后台刷新行情，当前展示最近一次真实数据。',
    });
  });

  it('labels preserved historical quotes as expired and blocks report generation', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'stale',
        observedTradeDate: '2026-07-22',
        refreshedAt: '2026-07-26T13:17:48.000Z',
        now: new Date('2026-07-26T13:18:00.000Z'),
      }),
    ).toEqual({
      tone: 'stale',
      statusLabel: '数据过期',
      canGenerateBriefing: false,
      dataDateLabel: '数据日期 07/22',
      refreshLabel: '刷新于 07/26 21:17',
      message: '当前展示 07/22 的真实历史数据，不代表当前行情。真实行情恢复后可生成日报。',
    });
  });

  it('does not treat a previous-session snapshot as fresh during a weekday session', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'fresh',
        observedTradeDate: '2026-07-24',
        refreshedAt: '2026-07-27T02:00:00.000Z',
        now: new Date('2026-07-27T02:00:00.000Z'),
      }),
    ).toMatchObject({
      tone: 'stale',
      statusLabel: '数据过期',
      canGenerateBriefing: false,
      dataDateLabel: '数据日期 07/24',
    });
  });

  it('accepts the latest Friday snapshot on a weekend', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'fresh',
        observedTradeDate: '2026-07-24',
        refreshedAt: '2026-07-25T02:00:00.000Z',
        now: new Date('2026-07-25T02:00:00.000Z'),
      }),
    ).toMatchObject({
      tone: 'fresh',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      dataDateLabel: '数据日期 07/24',
    });
  });

  it('treats a dashboard without an observed date as unverified', () => {
    expect(
      dashboardTrust.stockDashboardTrustState({
        freshnessStatus: 'partial',
        observedTradeDate: null,
        refreshedAt: '2026-07-26T13:17:48.000Z',
        now: new Date('2026-07-26T13:18:00.000Z'),
      }),
    ).toEqual({
      tone: 'unverified',
      statusLabel: '日期未核验',
      canGenerateBriefing: false,
      dataDateLabel: '数据日期待核验',
      refreshLabel: '刷新于 07/26 21:17',
      message: '真实行情日期尚未核验，不用于生成日报或当前盘面判断。',
    });
  });
});
