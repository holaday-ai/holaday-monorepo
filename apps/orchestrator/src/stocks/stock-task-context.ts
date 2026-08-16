import { createHash } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { stockDashboardSnapshots } from '../db/schema/stock-dashboard-snapshots.js';

type Db = typeof import('../db/client.js').db;

export type StockTaskTrustMode = 'current' | 'delayed' | 'historical';

export interface StockTaskContextInput {
  snapshotId: string;
  dataAsOf: string;
  trustMode: StockTaskTrustMode;
  evidenceIds: string[];
}

export interface StockTaskSnapshotPayload {
  generatedAt: string;
  dataAsOf: string;
  watchlistStocks: Array<Record<string, unknown> & { symbol: string }>;
  marketIndices: Array<Record<string, unknown>>;
  sectors: Array<Record<string, unknown>>;
  news: Array<Record<string, unknown>>;
}

export interface ValidatedStockTaskContext extends StockTaskContextInput {
  snapshotPayload: StockTaskSnapshotPayload;
}

interface SnapshotTrustRecord {
  snapshotId?: unknown;
  generatedAt?: unknown;
  dataAsOf?: unknown;
  mode?: unknown;
  evidenceIds?: unknown;
}

interface DashboardSnapshotRecord {
  updatedAt?: unknown;
  watchlistStocks?: unknown;
  marketIndices?: unknown;
  sectors?: unknown;
  news?: unknown;
  trust?: SnapshotTrustRecord;
}

function dashboardSnapshotRecord(value: unknown): DashboardSnapshotRecord | null {
  if (typeof value === 'string') {
    try {
      return dashboardSnapshotRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? (value as DashboardSnapshotRecord) : null;
}

export class StockTaskContextError extends Error {}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : [];
}

function compactDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

function historicalIntentUsesPresentTense(intent: string): boolean {
  return /今天|今日|现在|当前|最新|实时|最强|当前机会/.test(intent);
}

function explicitSymbols(intent: string): string[] {
  return [...new Set(intent.match(/(?<!\d)\d{6}(?!\d)/g) ?? [])];
}

function newsEvidenceId(row: Record<string, unknown>): string | null {
  const url = typeof row.url === 'string' ? row.url : null;
  if (!url) return null;
  const category = row.category === '公告' ? 'announcement' : 'news';
  return `${category}:${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

function assertContextInput(input: StockTaskContextInput): void {
  if (!/^stkshot_[a-f0-9]{24}$/.test(input.snapshotId)) {
    throw new StockTaskContextError('股票快照 ID 无效，请刷新页面后重试。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataAsOf)) {
    throw new StockTaskContextError('股票快照数据日期无效，请刷新页面后重试。');
  }
  if (input.evidenceIds.length > 50 || input.evidenceIds.some((id) => !id || id.length > 160)) {
    throw new StockTaskContextError('股票快照证据列表无效，请刷新页面后重试。');
  }
}

export function validateStockTaskContextSnapshot(args: {
  snapshot: unknown;
  input: StockTaskContextInput;
  intent: string;
}): ValidatedStockTaskContext {
  assertContextInput(args.input);
  const snapshot = dashboardSnapshotRecord(args.snapshot);
  if (!snapshot) {
    throw new StockTaskContextError('股票快照不存在，请刷新页面后重试。');
  }
  const trust = snapshot.trust;
  if (!trust || trust.mode === 'unavailable') {
    throw new StockTaskContextError('股票快照不可用，请刷新页面后重试。');
  }
  if (trust.snapshotId !== args.input.snapshotId) {
    throw new StockTaskContextError('股票快照 ID 已变化，请刷新页面后重试。');
  }
  if (trust.dataAsOf !== args.input.dataAsOf) {
    throw new StockTaskContextError('股票快照数据日期已变化，请刷新页面后重试。');
  }
  if (trust.mode !== args.input.trustMode) {
    throw new StockTaskContextError('股票快照状态已变化，请刷新页面后重试。');
  }
  if (args.input.trustMode === 'historical' && historicalIntentUsesPresentTense(args.intent)) {
    throw new StockTaskContextError(
      `历史快照不能回答当前行情问题。请改为“截至 ${compactDate(args.input.dataAsOf)}，当时有哪些关注点？”`,
    );
  }
  const trustedEvidence = new Set(
    Array.isArray(trust.evidenceIds)
      ? trust.evidenceIds.filter((id): id is string => typeof id === 'string')
      : [],
  );
  if (args.input.evidenceIds.some((id) => !trustedEvidence.has(id))) {
    throw new StockTaskContextError('股票快照包含未经验证的证据 ID，请刷新页面后重试。');
  }

  const watchlistStocks = asRecords(snapshot.watchlistStocks).filter(
    (row): row is Record<string, unknown> & { symbol: string } => typeof row.symbol === 'string',
  );
  const availableSymbols = new Set(watchlistStocks.map((row) => row.symbol));
  const mentionedSymbols = explicitSymbols(args.intent);
  const missingSymbol = mentionedSymbols.find((symbol) => !availableSymbols.has(symbol));
  if (missingSymbol) {
    throw new StockTaskContextError(`股票 ${missingSymbol} 不在快照中，请先加入关注列表并刷新。`);
  }
  const evidenceSymbols = args.input.evidenceIds.flatMap((id) => {
    const match = /^quote:(\d{6}):\d{4}-\d{2}-\d{2}$/.exec(id);
    return match?.[1] ? [match[1]] : [];
  });
  const selectedSymbols = new Set([...mentionedSymbols, ...evidenceSymbols]);
  const selectedStocks =
    selectedSymbols.size > 0
      ? watchlistStocks.filter((row) => selectedSymbols.has(row.symbol))
      : watchlistStocks;
  const evidenceSet = new Set(args.input.evidenceIds);
  const selectedNews = asRecords(snapshot.news).filter((row) => {
    const evidenceId = newsEvidenceId(row);
    return evidenceId ? evidenceSet.has(evidenceId) : false;
  });
  const generatedAt =
    typeof trust.generatedAt === 'string'
      ? trust.generatedAt
      : typeof snapshot.updatedAt === 'string'
        ? snapshot.updatedAt
        : '';

  return {
    ...args.input,
    evidenceIds: [...new Set(args.input.evidenceIds)].sort(),
    snapshotPayload: {
      generatedAt,
      dataAsOf: args.input.dataAsOf,
      watchlistStocks: selectedStocks.slice(0, 8),
      marketIndices: asRecords(snapshot.marketIndices).slice(0, 8),
      sectors: asRecords(snapshot.sectors).slice(0, 12),
      news: selectedNews.slice(0, 20),
    },
  };
}

export async function validateStockTaskContext(args: {
  db: Db;
  userId: number;
  input: StockTaskContextInput;
  intent: string;
}): Promise<ValidatedStockTaskContext> {
  const rows = await args.db
    .select({ snapshotJson: stockDashboardSnapshots.snapshotJson })
    .from(stockDashboardSnapshots)
    .where(eq(stockDashboardSnapshots.userId, args.userId))
    .orderBy(desc(stockDashboardSnapshots.updatedAt))
    .limit(20);
  const row = rows.find((candidate) => {
    const snapshot = dashboardSnapshotRecord(candidate.snapshotJson);
    return snapshot?.trust?.snapshotId === args.input.snapshotId;
  });
  if (!row) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '找不到属于你的股票快照，请刷新页面后重试。',
    });
  }
  try {
    return validateStockTaskContextSnapshot({
      snapshot: row.snapshotJson,
      input: args.input,
      intent: args.intent,
    });
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : '股票快照校验失败，请刷新页面后重试。',
    });
  }
}

export function publicStockTaskContext(context: unknown): StockTaskContextInput | null {
  if (typeof context === 'string') {
    try {
      return publicStockTaskContext(JSON.parse(context));
    } catch {
      return null;
    }
  }
  if (!context || typeof context !== 'object') return null;
  const value = context as Partial<ValidatedStockTaskContext>;
  if (
    typeof value.snapshotId !== 'string' ||
    typeof value.dataAsOf !== 'string' ||
    (value.trustMode !== 'current' &&
      value.trustMode !== 'delayed' &&
      value.trustMode !== 'historical') ||
    !Array.isArray(value.evidenceIds) ||
    value.evidenceIds.some((id) => typeof id !== 'string')
  ) {
    return null;
  }
  return {
    snapshotId: value.snapshotId,
    dataAsOf: value.dataAsOf,
    trustMode: value.trustMode,
    evidenceIds: value.evidenceIds,
  };
}
