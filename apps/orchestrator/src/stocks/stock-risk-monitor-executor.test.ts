import { describe, expect, it, vi } from 'vitest';
import {
  type StockRiskMonitorExecutionDeps,
  type StoredStockRiskMonitor,
  executeStockRiskMonitorRun,
} from './stock-risk-monitor-executor.js';
import type { StockRiskRadarResult } from './stock-risk-radar-service.js';

const monitor: StoredStockRiskMonitor = {
  monitorId: 'srm_123',
  userId: 7,
  plannedTaskId: 42,
  symbol: '603528',
  name: '多伦科技',
  market: 'A',
  lastEvaluatedDataAsOf: '2026-08-18',
  lastSignals: [
    {
      symbol: '603528',
      key: 'pledge',
      severity: '关注',
      signalId: 'signal-old',
      evidenceId: 'evidence-old',
      sourceDataAsOf: '2026-08-18',
    },
  ],
  lastUnavailableChecks: [],
  lastNotificationFingerprint: null,
};

function radar(overrides: Partial<StockRiskRadarResult> = {}): StockRiskRadarResult {
  return {
    snapshotId: 'stkshot_1234567890abcdef12345678',
    dataAsOf: '2026-08-19',
    generatedAt: '2026-08-19T09:00:00.000Z',
    requestedStockCount: 1,
    checkedStockCount: 1,
    truncated: false,
    signals: [
      {
        signalId: 'signal-new',
        evidenceId: 'evidence-new',
        symbol: '603528',
        name: '多伦科技',
        key: 'pledge',
        label: '质押',
        severity: '高风险',
        fact: '质押比例超过高风险阈值',
        trigger: '质押比例超过 50%',
        whyRelevant: '需要继续观察',
        observedAt: '2026-08-19',
        sourceDataAsOf: '2026-08-19',
        source: 'akshare',
        fetchedAt: '2026-08-19T09:00:00.000Z',
        evidenceUrl: null,
      },
    ],
    checks: ['pledge', 'goodwill', 'forecast', 'insider', 'announcements'].map((key) => ({
      symbol: '603528',
      name: '多伦科技',
      key: key as 'pledge' | 'goodwill' | 'forecast' | 'insider' | 'announcements',
      status: 'checked' as const,
      source: 'akshare',
      fetchedAt: '2026-08-19T09:00:00.000Z',
      sourceDataAsOf: '2026-08-19',
      errorCode: null,
    })),
    ...overrides,
  };
}

function deps(
  overrides: Partial<StockRiskMonitorExecutionDeps> = {},
): StockRiskMonitorExecutionDeps {
  return {
    loadMonitor: vi.fn(async () => monitor),
    isUserActive: vi.fn(async () => true),
    loadLatestSnapshot: vi.fn(async () => ({
      snapshotId: 'stkshot_1234567890abcdef12345678',
      dataAsOf: '2026-08-19',
      stocks: [{ symbol: '603528', name: '多伦科技', market: 'A' }],
    })),
    runRadar: vi.fn(async () => radar()),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('stock risk monitor executor', () => {
  it('returns unhandled when the planned task has no monitor record', async () => {
    const executionDeps = deps({ loadMonitor: vi.fn(async () => null) });
    expect(
      await executeStockRiskMonitorRun({
        plannedTaskId: 42,
        runExternalId: 'plr_1',
        trigger: 'manual',
        deps: executionDeps,
      }),
    ).toEqual({ handled: false });
    expect(executionDeps.runRadar).not.toHaveBeenCalled();
  });

  it('records an upgrade and returns a notification candidate without free-text task creation', async () => {
    const executionDeps = deps();
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_1',
      trigger: 'manual',
      deps: executionDeps,
    });
    expect(result).toMatchObject({
      handled: true,
      ok: true,
      result: {
        outcome: 'changed',
        upgraded: [{ key: 'pledge', previousSeverity: '关注', severity: '高风险' }],
      },
      notification: { kind: 'changed' },
    });
    expect(executionDeps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        updateBaseline: true,
        nextSignals: [expect.objectContaining({ key: 'pledge', severity: '高风险' })],
      }),
    );
  });

  it('skips a duplicate trading date before calling upstream risk sources', async () => {
    const executionDeps = deps({
      loadLatestSnapshot: vi.fn(async () => ({
        snapshotId: 'stkshot_1234567890abcdef12345678',
        dataAsOf: '2026-08-18',
        stocks: [{ symbol: '603528', name: '多伦科技', market: 'A' }],
      })),
    });
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_2',
      trigger: 'scheduled',
      deps: executionDeps,
    });
    expect(result).toMatchObject({ handled: true, result: { outcome: 'skipped' } });
    expect(executionDeps.runRadar).not.toHaveBeenCalled();
    expect(executionDeps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        updateBaseline: false,
      }),
    );
  });

  it('does not resolve or erase a previous risk when its source is unavailable', async () => {
    const executionDeps = deps({
      runRadar: vi.fn(async () =>
        radar({
          signals: [],
          checks: radar().checks.map((check) =>
            check.key === 'pledge'
              ? { ...check, status: 'unavailable' as const, errorCode: 'UPSTREAM_TIMEOUT' }
              : check,
          ),
        }),
      ),
    });
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_3',
      trigger: 'scheduled',
      deps: executionDeps,
    });
    expect(result).toMatchObject({
      handled: true,
      result: { outcome: 'unavailable', resolved: [], unavailableChecks: ['pledge'] },
    });
    expect(executionDeps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        nextSignals: [expect.objectContaining({ signalId: 'signal-old' })],
      }),
    );
  });

  it('records internal failure without updating the last valid monitor baseline', async () => {
    const executionDeps = deps({
      runRadar: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_4',
      trigger: 'manual',
      deps: executionDeps,
    });
    expect(result).toMatchObject({ handled: true, ok: false, result: { outcome: 'failed' } });
    expect(executionDeps.complete).not.toHaveBeenCalled();
    expect(executionDeps.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        monitor,
        errorCode: 'STOCK_RISK_MONITOR_EXECUTION_FAILED',
      }),
    );
  });

  it('suppresses a retried notification with the same canonical fingerprint', async () => {
    const firstDeps = deps();
    const first = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_5',
      trigger: 'manual',
      deps: firstDeps,
    });
    expect(first.handled && first.notification?.fingerprint).toBeTruthy();
    const fingerprint = first.handled ? (first.notification?.fingerprint ?? null) : null;
    const retryDeps = deps({
      loadMonitor: vi.fn(async () => ({ ...monitor, lastNotificationFingerprint: fingerprint })),
    });
    const retry = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_6',
      trigger: 'scheduled',
      deps: retryDeps,
    });
    expect(retry).toMatchObject({ handled: true, notification: null });
  });

  it('does not read a snapshot when the owner freezes after the monitor is claimed', async () => {
    const isUserActive = vi.fn(async () => false);
    const executionDeps = {
      ...deps(),
      isUserActive,
    } as StockRiskMonitorExecutionDeps;
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_closure_1',
      trigger: 'scheduled',
      deps: executionDeps,
    });
    expect(result).toMatchObject({ handled: true, ok: false });
    expect(executionDeps.loadLatestSnapshot).not.toHaveBeenCalled();
    expect(executionDeps.runRadar).not.toHaveBeenCalled();
    expect(executionDeps.complete).not.toHaveBeenCalled();
    expect(executionDeps.fail).not.toHaveBeenCalled();
  });

  it('does not call the upstream radar when closure starts after snapshot loading', async () => {
    const isUserActive = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const executionDeps = {
      ...deps(),
      isUserActive,
    } as StockRiskMonitorExecutionDeps;
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_closure_2',
      trigger: 'scheduled',
      deps: executionDeps,
    });
    expect(result).toMatchObject({ handled: true, ok: false });
    expect(executionDeps.loadLatestSnapshot).toHaveBeenCalledTimes(1);
    expect(executionDeps.runRadar).not.toHaveBeenCalled();
    expect(executionDeps.complete).not.toHaveBeenCalled();
  });

  it('does not persist or notify when closure starts after the upstream radar returns', async () => {
    const isUserActive = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const executionDeps = {
      ...deps(),
      isUserActive,
    } as StockRiskMonitorExecutionDeps;
    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_closure_3',
      trigger: 'scheduled',
      deps: executionDeps,
    });
    expect(result).toMatchObject({ handled: true, ok: false });
    expect(executionDeps.runRadar).toHaveBeenCalledTimes(1);
    expect(executionDeps.complete).not.toHaveBeenCalled();
    expect(executionDeps.fail).not.toHaveBeenCalled();
  });

  it('does not finalize a failed radar run after the owner freezes', async () => {
    const isUserActive = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const executionDeps = deps({
      isUserActive,
      runRadar: vi.fn(async () => {
        throw new Error('upstream failed while closure won');
      }),
    });

    const result = await executeStockRiskMonitorRun({
      plannedTaskId: 42,
      runExternalId: 'plr_closure_4',
      trigger: 'scheduled',
      deps: executionDeps,
    });

    expect(result).toMatchObject({ handled: true, ok: false });
    expect(executionDeps.fail).not.toHaveBeenCalled();
    expect(executionDeps.complete).not.toHaveBeenCalled();
  });
});
