import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  plannedTaskItems,
  plannedTaskRuns,
  plannedTasks,
} from '../db/schema/planned-tasks.js';
import { stockRiskMonitors } from '../db/schema/stock-risk-monitors.js';
import type {
  StockTaskContextInput,
  ValidatedStockTaskContext,
} from './stock-task-context.js';
import type { StockRiskRadarResult } from './stock-risk-radar-service.js';
import {
  STOCK_RISK_CHECK_KEYS,
  canonicalStockRiskMonitorSignals,
  nextShanghaiPostmarketRun,
  type CanonicalStockRiskMonitorSignal,
  type StockRiskMonitorRunResultV1,
} from './stock-risk-monitor-state.js';

export interface StockRiskMonitorView {
  monitorId: string;
  plannedTaskId: string;
  symbol: string;
  status: 'active' | 'paused' | 'failed';
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastOutcome: StockRiskMonitorRunResultV1['outcome'] | null;
  lastSummary: string | null;
}

export interface CreateStockRiskMonitorRepositoryInput {
  userId: number;
  symbol: string;
  name: string;
  market: string;
  dataAsOf: string;
  nextRunAt: Date;
  baselineSignals: CanonicalStockRiskMonitorSignal[];
  baselineUnavailableChecks: string[];
}

export interface StockRiskMonitorRepository {
  createOrGet(input: CreateStockRiskMonitorRepositoryInput): Promise<{
    created: boolean;
    monitor: StockRiskMonitorView;
  }>;
  listByUserSymbols(userId: number, symbols: readonly string[]): Promise<StockRiskMonitorView[]>;
}

type StockRiskMonitorContextInput = Omit<StockTaskContextInput, 'evidenceIds'>;

interface CreateStockRiskMonitorInput extends StockRiskMonitorContextInput {
  trustMode: 'current';
  symbol: string;
}

interface StockRiskMonitorServiceDeps {
  userId: number;
  repository: StockRiskMonitorRepository;
  validateContext(args: {
    userId: number;
    input: StockTaskContextInput;
    intent: string;
  }): Promise<ValidatedStockTaskContext>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stockIdentity(context: ValidatedStockTaskContext, symbol: string) {
  const stock = context.snapshotPayload.watchlistStocks.find((row) => row.symbol === symbol);
  if (!stock) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '股票不在当前可信关注列表中',
    });
  }
  return {
    symbol,
    name: text(stock.name) || symbol,
    market: text(stock.market) || 'A',
  };
}

export async function createStockRiskMonitor(args: StockRiskMonitorServiceDeps & {
  input: CreateStockRiskMonitorInput;
  loadRadar(context: ValidatedStockTaskContext): Promise<StockRiskRadarResult>;
  now?: Date;
}): Promise<{ created: boolean; monitor: StockRiskMonitorView }> {
  if (args.input.trustMode !== 'current') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '当前数据无法建立可信监控',
    });
  }
  const context = await args.validateContext({
    userId: args.userId,
    input: { ...args.input, evidenceIds: [] },
    intent: `监控 ${args.input.symbol} 风险变化`,
  });
  const identity = stockIdentity(context, args.input.symbol);
  const radar = await args.loadRadar(context);
  const baselineSignals = canonicalStockRiskMonitorSignals(
    radar.signals.filter((signal) => signal.symbol === identity.symbol),
  );
  const baselineUnavailableChecks = STOCK_RISK_CHECK_KEYS.filter((key) =>
    radar.checks.some((check) =>
      check.symbol === identity.symbol && check.key === key && check.status === 'unavailable'),
  );
  return args.repository.createOrGet({
    userId: args.userId,
    ...identity,
    dataAsOf: context.dataAsOf,
    nextRunAt: nextShanghaiPostmarketRun(args.now ?? new Date()),
    baselineSignals,
    baselineUnavailableChecks,
  });
}

export async function listStockRiskMonitors(args: StockRiskMonitorServiceDeps & {
  input: StockRiskMonitorContextInput;
}): Promise<StockRiskMonitorView[]> {
  const context = await args.validateContext({
    userId: args.userId,
    input: { ...args.input, evidenceIds: [] },
    intent: '查看自选股风险监控状态',
  });
  const symbols = context.snapshotPayload.watchlistStocks.map((stock) => stock.symbol);
  return args.repository.listByUserSymbols(args.userId, symbols);
}

function isDuplicateEntry(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: string }).code === 'ER_DUP_ENTRY',
  );
}

function resultView(value: unknown): Pick<StockRiskMonitorView, 'lastOutcome' | 'lastSummary'> {
  if (!value || typeof value !== 'object') return { lastOutcome: null, lastSummary: null };
  const row = value as Partial<StockRiskMonitorRunResultV1>;
  const outcomes = new Set(['changed', 'unavailable', 'unchanged', 'skipped', 'failed']);
  if (row.kind !== 'stock-risk-monitor' || row.version !== 1 || !outcomes.has(String(row.outcome))) {
    return { lastOutcome: null, lastSummary: null };
  }
  return {
    lastOutcome: row.outcome ?? null,
    lastSummary: typeof row.summary === 'string' ? row.summary.slice(0, 500) : null,
  };
}

export function databaseStockRiskMonitorRepository(db: DB): StockRiskMonitorRepository {
  async function listByUserSymbols(
    userId: number,
    symbols: readonly string[],
  ): Promise<StockRiskMonitorView[]> {
    if (symbols.length === 0) return [];
    const rows = await db
      .select({
        monitorId: stockRiskMonitors.externalId,
        plannedTaskInternalId: plannedTasks.id,
        plannedTaskId: plannedTasks.externalId,
        symbol: stockRiskMonitors.symbol,
        planStatus: plannedTasks.status,
        nextRunAt: plannedTasks.nextRunAt,
        lastRunAt: plannedTasks.lastRunAt,
        lastRunStatus: plannedTasks.lastRunStatus,
      })
      .from(stockRiskMonitors)
      .innerJoin(plannedTasks, eq(plannedTasks.id, stockRiskMonitors.plannedTaskId))
      .where(and(
        eq(stockRiskMonitors.userId, userId),
        inArray(stockRiskMonitors.symbol, [...symbols]),
        ne(plannedTasks.status, 'archived'),
      ));
    if (rows.length === 0) return [];
    const runs = await db
      .select({
        plannedTaskId: plannedTaskRuns.plannedTaskId,
        resultJson: plannedTaskRuns.resultJson,
      })
      .from(plannedTaskRuns)
      .where(inArray(plannedTaskRuns.plannedTaskId, rows.map((row) => row.plannedTaskInternalId)))
      .orderBy(desc(plannedTaskRuns.createdAt));
    const latestResult = new Map<number, unknown>();
    for (const run of runs) {
      if (!latestResult.has(run.plannedTaskId)) latestResult.set(run.plannedTaskId, run.resultJson);
    }
    return rows.map((row) => {
      const latest = row.lastRunAt
        ? resultView(latestResult.get(row.plannedTaskInternalId))
        : { lastOutcome: null, lastSummary: null };
      const status: StockRiskMonitorView['status'] = row.planStatus === 'paused'
        ? 'paused'
        : row.lastRunStatus === 'failed' || latest.lastOutcome === 'failed'
          ? 'failed'
          : 'active';
      return {
        monitorId: row.monitorId,
        plannedTaskId: row.plannedTaskId,
        symbol: row.symbol,
        status,
        nextRunAt: row.nextRunAt,
        lastRunAt: row.lastRunAt,
        ...latest,
      };
    });
  }

  async function find(userId: number, symbol: string): Promise<StockRiskMonitorView | null> {
    return (await listByUserSymbols(userId, [symbol]))[0] ?? null;
  }

  async function findArchived(userId: number, symbol: string): Promise<{
    monitorInternalId: number;
    plannedTaskInternalId: number;
  } | null> {
    const [row] = await db
      .select({
        monitorInternalId: stockRiskMonitors.id,
        plannedTaskInternalId: plannedTasks.id,
      })
      .from(stockRiskMonitors)
      .innerJoin(plannedTasks, eq(plannedTasks.id, stockRiskMonitors.plannedTaskId))
      .where(and(
        eq(stockRiskMonitors.userId, userId),
        eq(stockRiskMonitors.symbol, symbol),
        eq(plannedTasks.status, 'archived'),
      ));
    return row ?? null;
  }

  return {
    listByUserSymbols,
    async createOrGet(input) {
      const existing = await find(input.userId, input.symbol);
      if (existing) return { created: false, monitor: existing };
      const archived = await findArchived(input.userId, input.symbol);
      const plannedTaskExternalId = newExternalId('plannedTask');
      if (archived) {
        const revived = await db.transaction(async (tx) => {
          const [lockedPlan] = await tx
            .select({ id: plannedTasks.id, status: plannedTasks.status })
            .from(plannedTasks)
            .where(and(
              eq(plannedTasks.id, archived.plannedTaskInternalId),
              eq(plannedTasks.status, 'archived'),
            ))
            .limit(1)
            .for('update');
          if (!lockedPlan) return false;

          const [lockedMonitor] = await tx
            .select({ id: stockRiskMonitors.id, plannedTaskId: stockRiskMonitors.plannedTaskId })
            .from(stockRiskMonitors)
            .where(and(
              eq(stockRiskMonitors.id, archived.monitorInternalId),
              eq(stockRiskMonitors.userId, input.userId),
              eq(stockRiskMonitors.symbol, input.symbol),
              eq(stockRiskMonitors.plannedTaskId, archived.plannedTaskInternalId),
            ))
            .limit(1)
            .for('update');
          if (!lockedMonitor) return false;

          const [nonterminalRun] = await tx
            .select({ id: plannedTaskRuns.id })
            .from(plannedTaskRuns)
            .where(and(
              eq(plannedTaskRuns.plannedTaskId, lockedPlan.id),
              inArray(plannedTaskRuns.status, ['pending', 'dispatching', 'running']),
            ))
            .limit(1);
          if (nonterminalRun) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: '旧监控仍有尚未完成的运行，请稍后重试',
            });
          }

          const instruction = `检查 ${input.name}（${input.symbol}）风险变化`;
          const planInsert = await tx.insert(plannedTasks).values({
            externalId: plannedTaskExternalId,
            userId: input.userId,
            title: `监控 ${input.name} 风险变化`,
            instruction: `系统专用：${instruction}`,
            notes: '仅在风险新增、升级、解除或无法判断时发送站内提醒；不构成投资建议。',
            scope: 'single',
            repeatType: 'daily',
            rrule: null,
            firstRunAt: input.nextRunAt,
            endsAt: null,
            nextRunAt: input.nextRunAt,
            timezone: 'Asia/Shanghai',
            reminderMinutes: null,
            status: 'active',
            itemCount: 1,
          });
          const plannedTaskId = readInsertId(planInsert);
          await tx.insert(plannedTaskItems).values({
            externalId: newExternalId('plannedTaskItem'),
            plannedTaskId,
            seq: 0,
            instruction,
            enabled: true,
          });
          const monitorUpdate = await tx
            .update(stockRiskMonitors)
            .set({
              plannedTaskId,
              name: input.name,
              market: input.market,
              riskKeysJson: [...STOCK_RISK_CHECK_KEYS],
              lastEvaluatedDataAsOf: input.dataAsOf,
              lastSignalsJson: input.baselineSignals,
              lastUnavailableChecksJson: input.baselineUnavailableChecks,
              lastNotificationFingerprint: null,
            })
            .where(and(
              eq(stockRiskMonitors.id, lockedMonitor.id),
              eq(stockRiskMonitors.plannedTaskId, archived.plannedTaskInternalId),
            ));
          if (readAffectedRows(monitorUpdate) === 0) {
            throw new Error('归档风险监控替换时记录已发生变化');
          }
          return true;
        });
        const monitor = await find(input.userId, input.symbol);
        if (!monitor) throw new Error('归档风险监控恢复后未找到记录');
        return { created: revived, monitor };
      }
      const monitorExternalId = newExternalId('stockRiskMonitor');
      try {
        await db.transaction(async (tx) => {
          const planInsert = await tx.insert(plannedTasks).values({
            externalId: plannedTaskExternalId,
            userId: input.userId,
            title: `监控 ${input.name} 风险变化`,
            instruction: `系统专用：检查 ${input.name}（${input.symbol}）风险变化`,
            notes: '仅在风险新增、升级、解除或无法判断时发送站内提醒；不构成投资建议。',
            scope: 'single',
            repeatType: 'daily',
            rrule: null,
            firstRunAt: input.nextRunAt,
            endsAt: null,
            nextRunAt: input.nextRunAt,
            timezone: 'Asia/Shanghai',
            reminderMinutes: null,
            status: 'active',
            itemCount: 1,
          });
          const plannedTaskId = readInsertId(planInsert);
          await tx.insert(plannedTaskItems).values({
            externalId: newExternalId('plannedTaskItem'),
            plannedTaskId,
            seq: 0,
            instruction: `检查 ${input.name}（${input.symbol}）风险变化`,
            enabled: true,
          });
          await tx.insert(stockRiskMonitors).values({
            externalId: monitorExternalId,
            userId: input.userId,
            plannedTaskId,
            symbol: input.symbol,
            name: input.name,
            market: input.market,
            riskKeysJson: [...STOCK_RISK_CHECK_KEYS],
            lastEvaluatedDataAsOf: input.dataAsOf,
            lastSignalsJson: input.baselineSignals,
            lastUnavailableChecksJson: input.baselineUnavailableChecks,
            lastNotificationFingerprint: null,
          });
        });
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        const raced = await find(input.userId, input.symbol);
        if (!raced) throw error;
        return { created: false, monitor: raced };
      }
      const created = await find(input.userId, input.symbol);
      if (!created) throw new Error('风险监控创建后未找到记录');
      return { created: true, monitor: created };
    },
  };
}
