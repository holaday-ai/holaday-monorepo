import { createHash } from 'node:crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { stockPreferenceProfiles, stockPreferenceSignals } from '../db/schema/stock-preferences.js';
import { watchlists } from '../db/schema/watchlists.js';
import type { StockScreenCriterion } from './screening-criteria.js';
import {
  buildStockPreferenceProfile,
  emptyManualStockPreferences,
  STOCK_PREFERENCE_WINDOW_DAYS,
  type ManualStockPreferences,
  type StockPreferenceSignalInput,
} from './stock-preference-profile.js';

type Db = typeof import('../db/client.js').db;

const stockScreenFieldSchema = z.enum([
  'exclude_st',
  'pe_ttm',
  'pb',
  'turnover_ratio',
  'amount',
  'change_pct',
  'net_profit_3y_positive',
  'debt_ratio',
  'roe',
  'revenue_yoy',
  'net_profit_yoy',
  'insider_reduction_recent',
]);

const stockScreenOperatorSchema = z.enum(['eq', 'gt', 'gte', 'lt', 'lte', 'between']);
const criterionValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.tuple([z.number().finite(), z.number().finite()]),
]);

const screeningSignalPayloadSchema = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  criteria: z.array(z.object({
    field: stockScreenFieldSchema,
    operator: stockScreenOperatorSchema,
    value: criterionValueSchema,
  }).strict()).min(1).max(20),
}).strict();

const distinctStrings = <T extends z.ZodTypeAny>(schema: T, max: number) =>
  z.array(schema).max(max).transform((values) => [...new Set(values)]);

export const manualStockPreferencesSchema = z.object({
  industries: distinctStrings(z.string().trim().min(1).max(32), 8),
  marketCaps: distinctStrings(z.enum(['大盘', '中盘', '小盘']), 3),
  valuation: distinctStrings(z.enum(['低估值', '均衡估值', '可接受成长溢价']), 3),
  profitability: distinctStrings(z.enum(['连续盈利', '高ROE', '低负债']), 3),
  growth: distinctStrings(z.enum(['收入增长', '利润增长', '稳定增长']), 3),
  cashFlow: distinctStrings(z.enum(['经营现金流优先', '自由现金流优先']), 2),
  volatility: distinctStrings(z.enum(['低波动', '均衡波动', '关注高波动']), 3),
  liquidity: distinctStrings(z.enum(['高流动性', '普通流动性']), 2),
  events: distinctStrings(z.enum(['回避ST', '回避近期减持', '关注重要公告']), 3),
  holdingPeriods: distinctStrings(z.enum(['短期观察', '波段研究', '中长期']), 3),
}).strict();

function normalizedManualPreferences(value: unknown): ManualStockPreferences {
  const parsed = manualStockPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyManualStockPreferences();
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

async function profileRow(db: Db, userId: number) {
  const [row] = await db
    .select({
      enabled: stockPreferenceProfiles.enabled,
      manualPreferencesJson: stockPreferenceProfiles.manualPreferencesJson,
      clearedAt: stockPreferenceProfiles.clearedAt,
    })
    .from(stockPreferenceProfiles)
    .where(eq(stockPreferenceProfiles.userId, userId))
    .limit(1);
  return row;
}

async function upsertProfile(
  db: Db,
  args: {
    userId: number;
    enabled: boolean;
    manualPreferences: ManualStockPreferences;
    clearedAt: Date | null;
  },
): Promise<void> {
  const values = {
    userId: args.userId,
    enabled: args.enabled,
    manualPreferencesJson: args.manualPreferences,
    clearedAt: args.clearedAt,
  };
  await db.insert(stockPreferenceProfiles).values(values).onDuplicateKeyUpdate({
    set: {
      enabled: values.enabled,
      manualPreferencesJson: values.manualPreferencesJson,
      clearedAt: values.clearedAt,
    },
  });
}

export async function loadStockPreferenceProfile(args: {
  db: Db;
  userId: number;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const from = new Date(now.getTime() - STOCK_PREFERENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [profile, signalRows, watchlistRows] = await Promise.all([
    profileRow(args.db, args.userId),
    args.db
      .select({
        kind: stockPreferenceSignals.kind,
        dataAsOf: stockPreferenceSignals.dataAsOf,
        payloadJson: stockPreferenceSignals.payloadJson,
        occurredAt: stockPreferenceSignals.occurredAt,
      })
      .from(stockPreferenceSignals)
      .where(and(
        eq(stockPreferenceSignals.userId, args.userId),
        gte(stockPreferenceSignals.occurredAt, from),
      ))
      .orderBy(desc(stockPreferenceSignals.occurredAt)),
    args.db
      .select({
        symbol: watchlists.symbol,
        market: watchlists.market,
        createdAt: watchlists.createdAt,
      })
      .from(watchlists)
      .where(eq(watchlists.userId, args.userId))
      .orderBy(desc(watchlists.createdAt)),
  ]);

  const signals: StockPreferenceSignalInput[] = signalRows.flatMap((row) => {
    if (row.kind !== 'screening_run') return [];
    const payload = screeningSignalPayloadSchema.safeParse(row.payloadJson);
    if (!payload.success || !(row.occurredAt instanceof Date)) return [];
    return [{
      kind: 'screening_run' as const,
      dataAsOf: typeof row.dataAsOf === 'string' ? row.dataAsOf : null,
      occurredAt: row.occurredAt,
      payload: payload.data,
    }];
  });

  return buildStockPreferenceProfile({
    now,
    enabled: profile?.enabled ?? true,
    clearedAt: profile?.clearedAt ?? null,
    manualPreferences: normalizedManualPreferences(profile?.manualPreferencesJson),
    signals,
    watchlist: watchlistRows.filter((row) => row.createdAt instanceof Date),
  });
}

export async function recordStockScreeningPreference(args: {
  db: Db;
  userId: number;
  snapshotId: string;
  dataAsOf: string;
  criteria: StockScreenCriterion[];
  occurredAt?: Date;
}): Promise<{ recorded: boolean }> {
  const criteria = args.criteria
    .map(({ field, operator, value }) => ({ field, operator, value }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const payload = screeningSignalPayloadSchema.parse({ snapshotId: args.snapshotId, criteria });
  const dedupeHash = createHash('sha256')
    .update(JSON.stringify(['screening_run', args.dataAsOf, payload]))
    .digest('hex');
  try {
    await args.db.insert(stockPreferenceSignals).values({
      userId: args.userId,
      kind: 'screening_run',
      dedupeHash,
      payloadJson: payload,
      dataAsOf: args.dataAsOf,
      occurredAt: args.occurredAt ?? new Date(),
    });
    return { recorded: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) return { recorded: false };
    throw error;
  }
}

export async function updateStockPreferenceControls(args: {
  db: Db;
  userId: number;
  enabled: boolean;
  manualPreferences: ManualStockPreferences;
}): Promise<void> {
  const manualPreferences = manualStockPreferencesSchema.parse(args.manualPreferences);
  const existing = await profileRow(args.db, args.userId);
  await upsertProfile(args.db, {
    userId: args.userId,
    enabled: args.enabled,
    manualPreferences,
    clearedAt: existing?.clearedAt ?? null,
  });
}

export async function clearStockPreferenceProfile(args: {
  db: Db;
  userId: number;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  await args.db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const existing = await profileRow(tx, args.userId);
    await tx
      .delete(stockPreferenceSignals)
      .where(eq(stockPreferenceSignals.userId, args.userId));
    await upsertProfile(tx, {
      userId: args.userId,
      enabled: existing?.enabled ?? true,
      manualPreferences: emptyManualStockPreferences(),
      clearedAt: now,
    });
  });
}
