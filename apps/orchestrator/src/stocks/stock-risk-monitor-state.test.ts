import { describe, expect, it } from 'vitest';
import type {
  StockRiskSeverity,
  StockRiskSignalRecord,
  StockRiskSourceCheck,
} from './stock-risk-radar-service.js';
import {
  canonicalStockRiskMonitorSignals,
  compareStockRiskMonitorState,
  nextShanghaiPostmarketRun,
  stockRiskNotificationFingerprint,
} from './stock-risk-monitor-state.js';

function signal(
  key: StockRiskSignalRecord['key'],
  severity: StockRiskSeverity,
  overrides: Partial<StockRiskSignalRecord> = {},
): StockRiskSignalRecord {
  return {
    signalId: `signal-${key}-${severity}`,
    evidenceId: `evidence-${key}-${severity}`,
    symbol: '600000',
    name: '浦发银行',
    key,
    label: key,
    severity,
    fact: '已核验事实',
    trigger: '确定性阈值',
    whyRelevant: '需要继续观察',
    observedAt: '2026-08-19',
    sourceDataAsOf: '2026-08-19',
    source: 'akshare',
    fetchedAt: '2026-08-19T09:00:00.000Z',
    evidenceUrl: null,
    ...overrides,
  };
}

function check(
  key: StockRiskSourceCheck['key'],
  status: StockRiskSourceCheck['status'],
): StockRiskSourceCheck {
  return {
    symbol: '600000',
    name: '浦发银行',
    key,
    status,
    source: 'akshare',
    fetchedAt: '2026-08-19T09:00:00.000Z',
    sourceDataAsOf: status === 'checked' ? '2026-08-19' : null,
    errorCode: status === 'checked' ? null : 'UPSTREAM_TIMEOUT',
  };
}

describe('stock risk monitor state', () => {
  it('detects added, upgraded and resolved changes in stable risk order', () => {
    const previous = canonicalStockRiskMonitorSignals([
      signal('pledge', '关注'),
      signal('insider', '关注'),
      signal('inquiry', '警示'),
    ]);
    const current = canonicalStockRiskMonitorSignals([
      signal('pledge', '高风险'),
      signal('forecast', '警示'),
    ]);

    expect(compareStockRiskMonitorState(previous, current, [
      check('pledge', 'checked'),
      check('forecast', 'checked'),
      check('insider', 'checked'),
      check('announcements', 'checked'),
    ])).toEqual({
      added: [expect.objectContaining({ key: 'forecast', severity: '警示' })],
      upgraded: [expect.objectContaining({
        key: 'pledge',
        severity: '高风险',
        previousSeverity: '关注',
      })],
      resolved: [
        expect.objectContaining({ key: 'inquiry', severity: '警示' }),
        expect.objectContaining({ key: 'insider', severity: '关注' }),
      ],
      unavailableChecks: [],
    });
  });

  it('never resolves a risk whose source is unavailable', () => {
    const previous = canonicalStockRiskMonitorSignals([
      signal('pledge', '高风险'),
      signal('reduction_plan', '关注'),
    ]);

    expect(compareStockRiskMonitorState(previous, [], [
      check('pledge', 'unavailable'),
      check('announcements', 'unavailable'),
    ])).toEqual({
      added: [],
      upgraded: [],
      resolved: [],
      unavailableChecks: ['pledge', 'announcements'],
    });
  });

  it('updates canonical evidence without reporting a same-severity change', () => {
    const previous = canonicalStockRiskMonitorSignals([signal('forecast', '警示')]);
    const current = canonicalStockRiskMonitorSignals([
      signal('forecast', '警示', {
        signalId: 'signal-new',
        evidenceId: 'evidence-new',
        sourceDataAsOf: '2026-08-20',
      }),
    ]);

    expect(compareStockRiskMonitorState(previous, current, [check('forecast', 'checked')]))
      .toEqual({ added: [], upgraded: [], resolved: [], unavailableChecks: [] });
    expect(current[0]).toMatchObject({ evidenceId: 'evidence-new', sourceDataAsOf: '2026-08-20' });
  });

  it('produces the same fingerprint for semantically identical reordered changes', () => {
    const left = stockRiskNotificationFingerprint({
      monitorId: 'monitor_1',
      dataAsOf: '2026-08-19',
      added: [
        { key: 'forecast', severity: '警示', signalId: 'b', evidenceId: '2', sourceDataAsOf: null },
        { key: 'pledge', severity: '高风险', signalId: 'a', evidenceId: '1', sourceDataAsOf: null },
      ],
      upgraded: [],
      resolved: [],
      unavailableChecks: ['announcements', 'pledge'],
    });
    const right = stockRiskNotificationFingerprint({
      monitorId: 'monitor_1',
      dataAsOf: '2026-08-19',
      added: [
        { key: 'pledge', severity: '高风险', signalId: 'a', evidenceId: '1', sourceDataAsOf: null },
        { key: 'forecast', severity: '警示', signalId: 'b', evidenceId: '2', sourceDataAsOf: null },
      ],
      upgraded: [],
      resolved: [],
      unavailableChecks: ['pledge', 'announcements'],
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the next Shanghai 16:30 boundary before and at cutoff', () => {
    expect(nextShanghaiPostmarketRun(new Date('2026-08-19T08:29:59.000Z')).toISOString())
      .toBe('2026-08-19T08:30:00.000Z');
    expect(nextShanghaiPostmarketRun(new Date('2026-08-19T08:30:00.000Z')).toISOString())
      .toBe('2026-08-20T08:30:00.000Z');
    expect(nextShanghaiPostmarketRun(new Date('2026-12-31T16:00:00.000Z')).toISOString())
      .toBe('2027-01-01T08:30:00.000Z');
  });
});
