import { describe, expect, it } from 'vitest';
import { stockDashboardTrustState } from './stock-dashboard-trust';

function trust(mode: 'current' | 'delayed' | 'historical' | 'unavailable') {
  return {
    snapshotId: 'stkshot_0123456789abcdef01234567',
    generatedAt: '2026-08-16T13:55:00.000Z',
    marketTimezone: 'Asia/Shanghai' as const,
    marketSession: 'non-trading' as const,
    latestExpectedTradingDate: '2026-08-14',
    dataAsOf: mode === 'unavailable' ? null : '2026-08-11',
    mode,
    calendarStatus: 'verified' as const,
    sources: [],
    evidenceIds: [],
  };
}

describe('stock dashboard trust state', () => {
  it('maps a server-authored current envelope to enabled current-data actions', () => {
    expect(
      stockDashboardTrustState({ trust: { ...trust('current'), dataAsOf: '2026-08-14' } }),
    ).toEqual({
      tone: 'current',
      statusLabel: 'AkShare',
      canGenerateBriefing: true,
      canCreateCurrentTask: true,
      dataDateLabel: '数据日期 08/14',
      refreshLabel: '刷新于 08/16 21:55',
      message: null,
    });
  });

  it('maps a historical envelope directly without applying a client-side weekday heuristic', () => {
    expect(stockDashboardTrustState({ trust: trust('historical') })).toEqual({
      tone: 'historical',
      statusLabel: '历史回看',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel: '数据日期 08/11',
      refreshLabel: '刷新于 08/16 21:55',
      message: '此处展示 08/11 的真实历史数据，不代表当前行情。',
    });
  });

  it('keeps a delayed snapshot visible but blocks current-data actions', () => {
    expect(
      stockDashboardTrustState({ trust: { ...trust('delayed'), dataAsOf: '2026-08-14' } }),
    ).toMatchObject({
      tone: 'delayed',
      statusLabel: '行情刷新中',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel: '数据日期 08/14',
    });
  });

  it('treats unavailable and missing envelopes as separate blocked states', () => {
    expect(stockDashboardTrustState({ trust: trust('unavailable') })).toMatchObject({
      tone: 'unavailable',
      statusLabel: '行情不可用',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
      dataDateLabel: '数据日期待核验',
    });
    expect(stockDashboardTrustState({ trust: null })).toMatchObject({
      tone: 'unverified',
      statusLabel: '日期未核验',
      canGenerateBriefing: false,
      canCreateCurrentTask: false,
    });
  });
});
