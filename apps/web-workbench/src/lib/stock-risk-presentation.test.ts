import { describe, expect, it } from 'vitest';
import { groupStockRiskSignals } from './stock-risk-presentation';

describe('groupStockRiskSignals', () => {
  it('groups by stock, orders by severity and date, and leaves the input untouched', () => {
    const signals = [
      {
        signalId: 'warning-old',
        symbol: '600001',
        name: '测试股份',
        severity: '警示' as const,
        sourceDataAsOf: '2026-08-05',
      },
      {
        signalId: 'attention',
        symbol: '000002',
        name: '示例科技',
        severity: '关注' as const,
        sourceDataAsOf: '2026-08-16',
      },
      {
        signalId: 'high-new',
        symbol: '600001',
        name: '测试股份',
        severity: '高风险' as const,
        sourceDataAsOf: '2026-08-14',
      },
    ];
    const originalOrder = signals.map((signal) => signal.signalId);

    expect(
      groupStockRiskSignals(signals).map((group) => ({
        symbol: group.symbol,
        severity: group.severity,
        latestSourceDataAsOf: group.latestSourceDataAsOf,
        eventIds: group.signals.map((signal) => signal.signalId),
      })),
    ).toEqual([
      {
        symbol: '600001',
        severity: '高风险',
        latestSourceDataAsOf: '2026-08-14',
        eventIds: ['high-new', 'warning-old'],
      },
      {
        symbol: '000002',
        severity: '关注',
        latestSourceDataAsOf: '2026-08-16',
        eventIds: ['attention'],
      },
    ]);
    expect(signals.map((signal) => signal.signalId)).toEqual(originalOrder);
  });

  it('puts missing dates after dated events without dropping them', () => {
    const groups = groupStockRiskSignals([
      {
        signalId: 'undated',
        symbol: '600001',
        name: '测试股份',
        severity: '警示',
        sourceDataAsOf: null,
      },
      {
        signalId: 'dated',
        symbol: '600001',
        name: '测试股份',
        severity: '警示',
        sourceDataAsOf: '2026-08-14',
      },
    ]);

    expect(groups[0]?.signals.map((signal) => signal.signalId)).toEqual(['dated', 'undated']);
    expect(groups[0]?.latestSourceDataAsOf).toBe('2026-08-14');
  });
});
