import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { StockScreeningClient } from '../../stocks/stock-screening-service.js';
import {
  runStockScreening,
  type StockScreeningResult,
} from '../../stocks/stock-screening-service.js';
import {
  parseStockScreenPrompt,
  validateStockScreenCriteria,
  type StockScreenCriterion,
} from '../../stocks/screening-criteria.js';
import { validateStockTaskContext } from '../../stocks/stock-task-context.js';

type Db = typeof import('../../db/client.js').db;

interface ScreeningLogger {
  info?(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

const criterionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  field: z.enum([
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
  ]),
  operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte', 'between']),
  value: z.union([
    z.boolean(),
    z.number().finite(),
    z.tuple([z.number().finite(), z.number().finite()]),
  ]),
  unit: z.enum(['%', '元']).nullable(),
  label: z.string().trim().min(1).max(120),
  sourceField: z.string().trim().min(1).max(120),
  status: z.literal('ready'),
});

export const previewStockScreeningInputSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000),
});

export const runStockScreeningInputSchema = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  criteria: z.array(criterionSchema).min(1).max(20),
}).superRefine((input, context) => {
  const validation = validateStockScreenCriteria(input.criteria as StockScreenCriterion[]);
  for (const error of validation.errors) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['criteria', input.criteria.findIndex((item) => item.id === error.criterionId)],
      message: error.message,
    });
  }
});

export type RunStockScreeningInput = z.infer<typeof runStockScreeningInputSchema>;

export function previewStockScreening(prompt: string) {
  return parseStockScreenPrompt(previewStockScreeningInputSchema.parse({ prompt }).prompt);
}

export async function runTrustedStockScreening(args: {
  db: Db;
  userId: number;
  logger: ScreeningLogger;
  client: StockScreeningClient;
  input: RunStockScreeningInput;
  execute?: typeof runStockScreening;
}): Promise<StockScreeningResult> {
  const parsedInput = runStockScreeningInputSchema.safeParse(args.input);
  if (!parsedInput.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '筛选条件不完整或超出限制，请检查后重试。',
    });
  }
  const input = parsedInput.data;
  await validateStockTaskContext({
    db: args.db,
    userId: args.userId,
    input: {
      snapshotId: input.snapshotId,
      dataAsOf: input.dataAsOf,
      trustMode: 'current',
      evidenceIds: [],
    },
    intent: '按用户明确条件筛选股票',
    logger: args.logger,
  });

  const startedAt = Date.now();
  const result = await (args.execute ?? runStockScreening)({
    client: args.client,
    snapshotId: input.snapshotId,
    dataAsOf: input.dataAsOf,
    criteria: input.criteria as StockScreenCriterion[],
  });
  args.logger.info?.(
    {
      userId: args.userId,
      snapshotId: input.snapshotId,
      criterionFields: input.criteria.map((criterion) => criterion.field),
      universeCount: result.coverage.universeCount,
      marketPrefilterCount: result.coverage.marketPrefilterCount,
      deepCheckedCount: result.coverage.deepCheckedCount,
      truncated: result.coverage.truncated,
      zeroResult: result.zeroResult,
      durationMs: Date.now() - startedAt,
    },
    'stocks-screening: completed',
  );
  return result;
}
