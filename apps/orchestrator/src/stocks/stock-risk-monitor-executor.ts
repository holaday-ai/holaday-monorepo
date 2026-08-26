import { and, desc, eq, isNull, ne, or } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { plannedTaskRunItems, plannedTaskRuns, plannedTasks } from '../db/schema/planned-tasks.js';
import { stockDashboardSnapshots } from '../db/schema/stock-dashboard-snapshots.js';
import { stockRiskMonitors } from '../db/schema/stock-risk-monitors.js';
import { users } from '../db/schema/users.js';
import { type NotifyDeps, notify } from '../notifications/notification-service.js';
import {
  type CanonicalStockRiskMonitorSignal,
  STOCK_RISK_CHECK_KEYS,
  type StockRiskMonitorRunResultV1,
  boundedStockRiskSummary,
  canonicalStockRiskMonitorSignals,
  compareStockRiskMonitorState,
  stockRiskNotificationFingerprint,
} from './stock-risk-monitor-state.js';
import {
  type StockRiskCheckKey,
  type StockRiskRadarClient,
  type StockRiskRadarResult,
  type StockRiskRadarStock,
  type StockRiskSeverity,
  type StockRiskSignalRecord,
  runStockRiskRadar,
} from './stock-risk-radar-service.js';
import { validateStockTaskContextSnapshot } from './stock-task-context.js';

export interface StoredStockRiskMonitor {
  monitorId: string;
  userId: number;
  plannedTaskId: number;
  symbol: string;
  name: string;
  market: string;
  lastEvaluatedDataAsOf: string | null;
  lastSignals: CanonicalStockRiskMonitorSignal[];
  lastUnavailableChecks: StockRiskCheckKey[];
  lastNotificationFingerprint: string | null;
}

export interface LatestStockRiskSnapshot {
  snapshotId: string;
  dataAsOf: string;
  stocks: StockRiskRadarStock[];
}

export interface StockRiskMonitorNotificationCandidate {
  kind: 'changed' | 'unavailable';
  fingerprint: string;
}

interface CompleteStockRiskMonitorInput {
  monitor: StoredStockRiskMonitor;
  runExternalId: string;
  result: StockRiskMonitorRunResultV1;
  updateBaseline: boolean;
  nextSignals: CanonicalStockRiskMonitorSignal[];
  nextUnavailableChecks: StockRiskCheckKey[];
  notificationFingerprint: string | null;
}

interface FailStockRiskMonitorInput {
  monitor: StoredStockRiskMonitor;
  runExternalId: string;
  result: StockRiskMonitorRunResultV1;
  errorCode: 'STOCK_RISK_MONITOR_EXECUTION_FAILED';
}

type StockRiskPersistenceOutcome = 'committed' | 'inactive-owner' | 'lost-claim';

export interface StockRiskMonitorExecutionDeps {
  loadMonitor(plannedTaskId: number): Promise<StoredStockRiskMonitor | null>;
  isUserActive(userId: number): Promise<boolean>;
  loadLatestSnapshot(userId: number, symbol: string): Promise<LatestStockRiskSnapshot | null>;
  runRadar(
    snapshot: LatestStockRiskSnapshot,
    monitor: StoredStockRiskMonitor,
  ): Promise<StockRiskRadarResult>;
  complete(input: CompleteStockRiskMonitorInput): Promise<StockRiskPersistenceOutcome>;
  fail(input: FailStockRiskMonitorInput): Promise<StockRiskPersistenceOutcome>;
}

export type StockRiskSpecialDispatchResult =
  | { handled: false }
  | {
      handled: true;
      ok: boolean;
      result: StockRiskMonitorRunResultV1;
      notification: StockRiskMonitorNotificationCandidate | null;
      errorMessage?: string;
      persisted?: boolean;
      stoppedForInactiveOwner?: boolean;
      ownerUserId?: number;
    };

function emptyResult(
  monitor: StoredStockRiskMonitor,
  input: Pick<StockRiskMonitorRunResultV1, 'dataAsOf' | 'outcome' | 'summary'>,
): StockRiskMonitorRunResultV1 {
  return {
    kind: 'stock-risk-monitor',
    version: 1,
    monitorId: monitor.monitorId,
    symbol: monitor.symbol,
    name: monitor.name,
    dataAsOf: input.dataAsOf,
    outcome: input.outcome,
    added: [],
    upgraded: [],
    resolved: [],
    unavailableChecks: [],
    summary: boundedStockRiskSummary(input.summary),
  };
}

const SIGNAL_SOURCE: Record<StockRiskSignalRecord['key'], StockRiskCheckKey> = {
  pledge: 'pledge',
  goodwill: 'goodwill',
  forecast: 'forecast',
  insider: 'insider',
  reduction_plan: 'announcements',
  inquiry: 'announcements',
};

function baselineWithUnavailableSources(
  previous: readonly CanonicalStockRiskMonitorSignal[],
  current: readonly CanonicalStockRiskMonitorSignal[],
  unavailableChecks: readonly StockRiskCheckKey[],
): CanonicalStockRiskMonitorSignal[] {
  const unavailable = new Set(unavailableChecks);
  const merged = new Map(current.map((signal) => [`${signal.symbol}:${signal.key}`, signal]));
  for (const signal of previous) {
    if (!unavailable.has(SIGNAL_SOURCE[signal.key])) continue;
    const identity = `${signal.symbol}:${signal.key}`;
    if (!merged.has(identity)) merged.set(identity, signal);
  }
  return [...merged.values()];
}

function changedSummary(
  dataAsOf: string,
  comparison: ReturnType<typeof compareStockRiskMonitorState>,
): string {
  const parts = [
    comparison.added.length > 0 ? `新增 ${comparison.added.length} 条` : '',
    comparison.upgraded.length > 0 ? `升级 ${comparison.upgraded.length} 条` : '',
    comparison.resolved.length > 0 ? `解除 ${comparison.resolved.length} 条` : '',
  ].filter(Boolean);
  return `数据日期 ${dataAsOf}：${parts.join('、')}`;
}

export async function executeStockRiskMonitorRun(input: {
  plannedTaskId: number;
  runExternalId: string;
  trigger: 'scheduled' | 'manual';
  deps: StockRiskMonitorExecutionDeps;
}): Promise<StockRiskSpecialDispatchResult> {
  const monitor = await input.deps.loadMonitor(input.plannedTaskId);
  if (!monitor) return { handled: false };
  const ownerIsActive = async () => {
    try {
      return await input.deps.isUserActive(monitor.userId);
    } catch {
      return false;
    }
  };
  if (!(await ownerIsActive())) return inactiveResult(monitor);

  try {
    const snapshot = await input.deps.loadLatestSnapshot(monitor.userId, monitor.symbol);
    if (!(await ownerIsActive())) return inactiveResult(monitor);
    if (!snapshot) {
      const result = {
        ...emptyResult(monitor, {
          dataAsOf: null,
          outcome: 'unavailable',
          summary: '当前可信股票快照暂时不可用，无法判断风险变化。',
        }),
        unavailableChecks: [...STOCK_RISK_CHECK_KEYS],
      };
      const fingerprint = stockRiskNotificationFingerprint({
        ...result,
        monitorId: monitor.monitorId,
      });
      const notification =
        fingerprint === monitor.lastNotificationFingerprint
          ? null
          : { kind: 'unavailable' as const, fingerprint };
      const persisted = await input.deps.complete({
        monitor,
        runExternalId: input.runExternalId,
        result,
        updateBaseline: false,
        nextSignals: monitor.lastSignals,
        nextUnavailableChecks: [...STOCK_RISK_CHECK_KEYS],
        notificationFingerprint: notification?.fingerprint ?? null,
      });
      if (persisted !== 'committed') return inactiveResult(monitor, persisted);
      return { handled: true, ok: true, result, notification };
    }
    const watched = snapshot.stocks.some((stock) => stock.symbol === monitor.symbol);
    if (!watched) {
      const result = emptyResult(monitor, {
        dataAsOf: snapshot.dataAsOf,
        outcome: 'skipped',
        summary: `数据日期 ${snapshot.dataAsOf}：股票已不在关注列表，本轮跳过。`,
      });
      const persisted = await input.deps.complete({
        monitor,
        runExternalId: input.runExternalId,
        result,
        updateBaseline: false,
        nextSignals: monitor.lastSignals,
        nextUnavailableChecks: monitor.lastUnavailableChecks,
        notificationFingerprint: null,
      });
      if (persisted !== 'committed') return inactiveResult(monitor, persisted);
      return { handled: true, ok: true, result, notification: null };
    }
    if (
      monitor.lastEvaluatedDataAsOf !== null &&
      snapshot.dataAsOf <= monitor.lastEvaluatedDataAsOf
    ) {
      const result = emptyResult(monitor, {
        dataAsOf: snapshot.dataAsOf,
        outcome: 'skipped',
        summary: `数据日期 ${snapshot.dataAsOf} 未前进，本轮跳过。`,
      });
      const persisted = await input.deps.complete({
        monitor,
        runExternalId: input.runExternalId,
        result,
        updateBaseline: false,
        nextSignals: monitor.lastSignals,
        nextUnavailableChecks: monitor.lastUnavailableChecks,
        notificationFingerprint: null,
      });
      if (persisted !== 'committed') return inactiveResult(monitor, persisted);
      return { handled: true, ok: true, result, notification: null };
    }

    const radar = await input.deps.runRadar(snapshot, monitor);
    if (!(await ownerIsActive())) return inactiveResult(monitor);
    const rawCurrent = canonicalStockRiskMonitorSignals(
      radar.signals.filter((signal) => signal.symbol === monitor.symbol),
    );
    const checks = radar.checks.filter((check) => check.symbol === monitor.symbol);
    const comparison = compareStockRiskMonitorState(monitor.lastSignals, rawCurrent, checks);
    const nextSignals = baselineWithUnavailableSources(
      monitor.lastSignals,
      rawCurrent,
      comparison.unavailableChecks,
    );
    const changed =
      comparison.added.length + comparison.upgraded.length + comparison.resolved.length > 0;
    const outcome: StockRiskMonitorRunResultV1['outcome'] = changed
      ? 'changed'
      : comparison.unavailableChecks.length > 0
        ? 'unavailable'
        : 'unchanged';
    const summary =
      outcome === 'changed'
        ? changedSummary(snapshot.dataAsOf, comparison)
        : outcome === 'unavailable'
          ? `数据日期 ${snapshot.dataAsOf}：${comparison.unavailableChecks.length} 项来源暂时无法判断。`
          : `数据日期 ${snapshot.dataAsOf}：风险状态无变化。`;
    const result: StockRiskMonitorRunResultV1 = {
      kind: 'stock-risk-monitor',
      version: 1,
      monitorId: monitor.monitorId,
      symbol: monitor.symbol,
      name: monitor.name,
      dataAsOf: snapshot.dataAsOf,
      outcome,
      ...comparison,
      summary: boundedStockRiskSummary(summary),
    };
    const shouldNotify = outcome === 'changed' || outcome === 'unavailable';
    const fingerprint = shouldNotify
      ? stockRiskNotificationFingerprint({
          ...comparison,
          monitorId: monitor.monitorId,
          dataAsOf: snapshot.dataAsOf,
        })
      : null;
    const notification =
      fingerprint && fingerprint !== monitor.lastNotificationFingerprint
        ? { kind: outcome as 'changed' | 'unavailable', fingerprint }
        : null;
    const persisted = await input.deps.complete({
      monitor,
      runExternalId: input.runExternalId,
      result,
      updateBaseline: true,
      nextSignals,
      nextUnavailableChecks: comparison.unavailableChecks,
      notificationFingerprint: notification?.fingerprint ?? null,
    });
    if (persisted !== 'committed') return inactiveResult(monitor, persisted);
    return { handled: true, ok: true, result, notification };
  } catch {
    if (!(await ownerIsActive())) return inactiveResult(monitor);
    const result = emptyResult(monitor, {
      dataAsOf: null,
      outcome: 'failed',
      summary: '本次风险检查未完成，请稍后重试。',
    });
    const persisted = await input.deps.fail({
      monitor,
      runExternalId: input.runExternalId,
      result,
      errorCode: 'STOCK_RISK_MONITOR_EXECUTION_FAILED',
    });
    if (persisted !== 'committed') return inactiveResult(monitor, persisted);
    return {
      handled: true,
      ok: false,
      result,
      notification: null,
      errorMessage: '股票风险监控执行失败',
    };
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return jsonRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function storedSignals(value: unknown): CanonicalStockRiskMonitorSignal[] {
  if (!Array.isArray(value)) return [];
  const severities = new Set<StockRiskSeverity>(['关注', '警示', '高风险']);
  const keys = new Set<StockRiskSignalRecord['key']>([
    'pledge',
    'goodwill',
    'forecast',
    'insider',
    'reduction_plan',
    'inquiry',
  ]);
  return value.flatMap((raw): CanonicalStockRiskMonitorSignal[] => {
    const row = jsonRecord(raw);
    if (
      !row ||
      typeof row.symbol !== 'string' ||
      typeof row.key !== 'string' ||
      !keys.has(row.key as StockRiskSignalRecord['key']) ||
      typeof row.severity !== 'string' ||
      !severities.has(row.severity as StockRiskSeverity) ||
      typeof row.signalId !== 'string' ||
      typeof row.evidenceId !== 'string'
    )
      return [];
    return [
      {
        symbol: row.symbol,
        key: row.key as StockRiskSignalRecord['key'],
        severity: row.severity as StockRiskSeverity,
        signalId: row.signalId,
        evidenceId: row.evidenceId,
        sourceDataAsOf: typeof row.sourceDataAsOf === 'string' ? row.sourceDataAsOf : null,
      },
    ];
  });
}

function storedChecks(value: unknown): StockRiskCheckKey[] {
  if (!Array.isArray(value)) return [];
  return STOCK_RISK_CHECK_KEYS.filter((key) => value.includes(key));
}

function latestSnapshot(value: unknown): LatestStockRiskSnapshot | null {
  const row = jsonRecord(value);
  const trust = jsonRecord(row?.trust);
  if (
    !row ||
    !trust ||
    trust.mode !== 'current' ||
    typeof trust.snapshotId !== 'string' ||
    typeof trust.dataAsOf !== 'string'
  )
    return null;
  try {
    const validated = validateStockTaskContextSnapshot({
      snapshot: row,
      input: {
        snapshotId: trust.snapshotId,
        dataAsOf: trust.dataAsOf,
        trustMode: 'current',
        evidenceIds: [],
      },
      intent: '查看自选股风险监控状态',
    });
    return {
      snapshotId: validated.snapshotId,
      dataAsOf: validated.dataAsOf,
      stocks: validated.snapshotPayload.watchlistStocks.map((stock) => ({
        symbol: stock.symbol,
        name:
          typeof stock.name === 'string' && stock.name.trim() ? stock.name.trim() : stock.symbol,
        market: typeof stock.market === 'string' ? stock.market : 'A',
      })),
    };
  } catch {
    return null;
  }
}

export function createStockRiskMonitorSpecialDispatcher(args: {
  db: DB;
  client: StockRiskRadarClient;
  logger: NonNullable<NotifyDeps['logger']>;
}) {
  const deps: StockRiskMonitorExecutionDeps = {
    async loadMonitor(plannedTaskId) {
      const [row] = await args.db
        .select({
          monitorId: stockRiskMonitors.externalId,
          userId: stockRiskMonitors.userId,
          plannedTaskId: stockRiskMonitors.plannedTaskId,
          symbol: stockRiskMonitors.symbol,
          name: stockRiskMonitors.name,
          market: stockRiskMonitors.market,
          lastEvaluatedDataAsOf: stockRiskMonitors.lastEvaluatedDataAsOf,
          lastSignals: stockRiskMonitors.lastSignalsJson,
          lastUnavailableChecks: stockRiskMonitors.lastUnavailableChecksJson,
          lastNotificationFingerprint: stockRiskMonitors.lastNotificationFingerprint,
        })
        .from(stockRiskMonitors)
        .where(eq(stockRiskMonitors.plannedTaskId, plannedTaskId))
        .limit(1);
      return row
        ? {
            ...row,
            lastSignals: storedSignals(row.lastSignals),
            lastUnavailableChecks: storedChecks(row.lastUnavailableChecks),
          }
        : null;
    },
    async isUserActive(userId) {
      const [user] = await args.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return user?.status === 'active';
    },
    async loadLatestSnapshot(userId, _symbol) {
      const rows = await args.db
        .select({ snapshotJson: stockDashboardSnapshots.snapshotJson })
        .from(stockDashboardSnapshots)
        .where(eq(stockDashboardSnapshots.userId, userId))
        .orderBy(desc(stockDashboardSnapshots.updatedAt))
        .limit(20);
      for (const row of rows) {
        const snapshot = latestSnapshot(row.snapshotJson);
        if (snapshot) return snapshot;
      }
      return null;
    },
    runRadar: (snapshot, monitor) =>
      runStockRiskRadar({
        client: args.client,
        snapshotId: snapshot.snapshotId,
        dataAsOf: snapshot.dataAsOf,
        stocks: [{ symbol: monitor.symbol, name: monitor.name, market: monitor.market }],
      }),
    async complete(input) {
      const completedAt = new Date();
      const completed = await args.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, input.monitor.userId))
          .limit(1)
          .for('update');
        if (owner?.status !== 'active') return 'inactive-owner' as const;
        const [run] = await tx
          .select({ id: plannedTaskRuns.id, status: plannedTaskRuns.status })
          .from(plannedTaskRuns)
          .where(eq(plannedTaskRuns.externalId, input.runExternalId))
          .limit(1);
        if (!run || run.status !== 'dispatching') return 'lost-claim' as const;
        const transition = await tx
          .update(plannedTaskRuns)
          .set({
            status: 'completed',
            itemsDone: 1,
            itemsReview: 0,
            itemsFailed: 0,
            errorMessage: null,
            resultJson: input.result,
            completedAt,
          })
          .where(and(eq(plannedTaskRuns.id, run.id), eq(plannedTaskRuns.status, 'dispatching')));
        if (readAffectedRows(transition) === 0) return 'lost-claim' as const;
        await tx
          .update(plannedTaskRunItems)
          .set({
            status: 'completed',
            errorMessage: null,
            completedAt,
          })
          .where(
            and(
              eq(plannedTaskRunItems.plannedTaskRunId, run.id),
              eq(plannedTaskRunItems.status, 'pending'),
            ),
          );
        if (input.updateBaseline) {
          await tx
            .update(stockRiskMonitors)
            .set({
              lastEvaluatedDataAsOf: input.result.dataAsOf,
              lastSignalsJson: input.nextSignals,
              lastUnavailableChecksJson: input.nextUnavailableChecks,
            })
            .where(eq(stockRiskMonitors.plannedTaskId, input.monitor.plannedTaskId));
        } else {
          await tx
            .update(stockRiskMonitors)
            .set({
              lastUnavailableChecksJson: input.nextUnavailableChecks,
            })
            .where(eq(stockRiskMonitors.plannedTaskId, input.monitor.plannedTaskId));
        }
        if (input.notificationFingerprint) {
          const claim = await tx
            .update(stockRiskMonitors)
            .set({
              lastNotificationFingerprint: input.notificationFingerprint,
            })
            .where(
              and(
                eq(stockRiskMonitors.plannedTaskId, input.monitor.plannedTaskId),
                or(
                  isNull(stockRiskMonitors.lastNotificationFingerprint),
                  ne(stockRiskMonitors.lastNotificationFingerprint, input.notificationFingerprint),
                ),
              ),
            );
          if (
            readAffectedRows(claim) > 0 &&
            (input.result.outcome === 'changed' || input.result.outcome === 'unavailable')
          ) {
            const notification = await notify(
              { db: tx, logger: args.logger },
              {
                userInternalId: input.monitor.userId,
                plannedTaskInternalId: input.monitor.plannedTaskId,
                type: input.result.outcome === 'changed' ? 'task_complete' : 'task_failed',
                title:
                  input.result.outcome === 'changed'
                    ? `${input.monitor.name}风险发生变化`
                    : `${input.monitor.name}风险暂时无法判断`,
                message: input.result.summary,
                taskName: `监控 ${input.monitor.name} 风险变化`,
                delivery: 'in_app_only',
              },
            );
            if (!notification.inAppStored) {
              throw new Error('股票风险提醒写入失败');
            }
          }
        }
        await tx
          .update(plannedTasks)
          .set({
            lastRunAt: completedAt,
            lastRunStatus: 'completed',
            lastError: null,
          })
          .where(eq(plannedTasks.id, input.monitor.plannedTaskId));
        return 'committed' as const;
      });
      if (completed !== 'committed') return completed;
      args.logger.info?.(
        {
          userId: input.monitor.userId,
          monitorId: input.monitor.monitorId,
          symbol: input.monitor.symbol,
          dataAsOf: input.result.dataAsOf,
          outcome: input.result.outcome,
          changeCount:
            input.result.added.length + input.result.upgraded.length + input.result.resolved.length,
          unavailableCheckCount: input.result.unavailableChecks.length,
        },
        'stock-risk-monitor: completed',
      );
      return 'committed';
    },
    async fail(input) {
      const completedAt = new Date();
      const completed = await args.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, input.monitor.userId))
          .limit(1)
          .for('update');
        if (owner?.status !== 'active') return 'inactive-owner' as const;
        const [run] = await tx
          .select({ id: plannedTaskRuns.id, status: plannedTaskRuns.status })
          .from(plannedTaskRuns)
          .where(eq(plannedTaskRuns.externalId, input.runExternalId))
          .limit(1);
        if (!run || run.status !== 'dispatching') return 'lost-claim' as const;
        const transition = await tx
          .update(plannedTaskRuns)
          .set({
            status: 'failed',
            itemsFailed: 1,
            errorMessage: input.errorCode,
            resultJson: input.result,
            completedAt,
          })
          .where(and(eq(plannedTaskRuns.id, run.id), eq(plannedTaskRuns.status, 'dispatching')));
        if (readAffectedRows(transition) === 0) return 'lost-claim' as const;
        await tx
          .update(plannedTaskRunItems)
          .set({
            status: 'failed',
            errorMessage: input.errorCode,
            completedAt,
          })
          .where(
            and(
              eq(plannedTaskRunItems.plannedTaskRunId, run.id),
              eq(plannedTaskRunItems.status, 'pending'),
            ),
          );
        await tx
          .update(plannedTasks)
          .set({
            lastRunAt: completedAt,
            lastRunStatus: 'failed',
            lastError: input.errorCode,
          })
          .where(eq(plannedTasks.id, input.monitor.plannedTaskId));
        return 'committed' as const;
      });
      if (completed !== 'committed') return completed;
      args.logger.error(
        {
          userId: input.monitor.userId,
          monitorId: input.monitor.monitorId,
          symbol: input.monitor.symbol,
          errorCode: input.errorCode,
        },
        'stock-risk-monitor: failed',
      );
      return 'committed';
    },
  };
  return (input: {
    runExternalId: string;
    plannedTaskInternalId: number;
    trigger: 'scheduled' | 'manual';
  }) =>
    executeStockRiskMonitorRun({
      plannedTaskId: input.plannedTaskInternalId,
      runExternalId: input.runExternalId,
      trigger: input.trigger,
      deps,
    });
}

function inactiveResult(
  monitor: StoredStockRiskMonitor,
  reason: Exclude<StockRiskPersistenceOutcome, 'committed'> = 'inactive-owner',
): StockRiskSpecialDispatchResult {
  return {
    handled: true,
    ok: false,
    result: emptyResult(monitor, {
      dataAsOf: null,
      outcome: 'failed',
      summary: '账号当前不可执行，本轮风险检查已停止。',
    }),
    notification: null,
    errorMessage: reason === 'inactive-owner' ? '账号当前不可执行' : '运行已由其他流程终止',
    persisted: false,
    stoppedForInactiveOwner: reason === 'inactive-owner',
    ownerUserId: monitor.userId,
  };
}
