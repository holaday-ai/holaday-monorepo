import { z } from 'zod';
import {
  type StockRiskRadarClient,
  type StockRiskRadarResult,
  type StockRiskRadarStock,
  runStockRiskRadar,
} from '../../stocks/stock-risk-radar-service.js';
import { validateStockTaskContext } from '../../stocks/stock-task-context.js';

type Db = typeof import('../../db/client.js').db;

export interface RiskRadarLogger {
  info?(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export const stockRiskRadarInputSchema = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trustMode: z.enum(['current', 'delayed', 'historical']),
});

export type StockRiskRadarInput = z.infer<typeof stockRiskRadarInputSchema>;

function snapshotStocks(rows: Array<Record<string, unknown>>): StockRiskRadarStock[] {
  return rows.flatMap((row) => {
    const symbol = typeof row.symbol === 'string' ? row.symbol.trim() : '';
    if (!symbol) return [];
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : symbol;
    const market = typeof row.market === 'string' ? row.market : undefined;
    return [{ symbol, name, ...(market ? { market } : {}) }];
  });
}

export async function runTrustedStockRiskRadar(args: {
  db: Db;
  userId: number;
  logger: RiskRadarLogger;
  client: StockRiskRadarClient;
  input: StockRiskRadarInput;
  execute?: typeof runStockRiskRadar;
}): Promise<StockRiskRadarResult> {
  const input = stockRiskRadarInputSchema.parse(args.input);
  const context = await validateStockTaskContext({
    db: args.db,
    userId: args.userId,
    input: { ...input, evidenceIds: [] },
    intent: '查看自选股风险雷达',
    logger: args.logger,
  });
  const startedAt = Date.now();
  const result = await (args.execute ?? runStockRiskRadar)({
    client: args.client,
    snapshotId: input.snapshotId,
    dataAsOf: input.dataAsOf,
    stocks: snapshotStocks(context.snapshotPayload.watchlistStocks),
  });
  args.logger.info?.(
    {
      userId: args.userId,
      snapshotId: input.snapshotId,
      dataAsOf: input.dataAsOf,
      requestedStockCount: result.requestedStockCount,
      checkedStockCount: result.checkedStockCount,
      signalCount: result.signals.length,
      unavailableCheckCount: result.checks.filter((check) => check.status === 'unavailable').length,
      truncated: result.truncated,
      durationMs: Date.now() - startedAt,
    },
    'stocks-risk-radar: completed',
  );
  return result;
}
