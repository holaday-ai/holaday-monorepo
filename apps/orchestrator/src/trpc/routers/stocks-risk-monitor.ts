import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import {
  createStockRiskMonitor,
  databaseStockRiskMonitorRepository,
  listStockRiskMonitors,
} from '../../stocks/stock-risk-monitor-service.js';
import { validateStockTaskContext } from '../../stocks/stock-task-context.js';
import { protectedProcedure } from '../trpc.js';
import {
  createStockRiskRadarHttpClient,
  runTrustedStockRiskRadar,
  stockRiskRadarInputSchema,
} from './stocks-risk-radar.js';

export const stockRiskMonitorsInputSchema = stockRiskRadarInputSchema.strict();
export const createStockRiskMonitorInputSchema = z.object({
  snapshotId: z.string().regex(/^stkshot_[a-f0-9]{24}$/),
  dataAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trustMode: z.literal('current'),
  symbol: z.string().regex(/^\d{6}$/),
}).strict();

async function requireUserId(
  db: typeof import('../../db/client.js').db,
  externalId: string,
): Promise<number> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.externalId, externalId)).limit(1);
  if (!row) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  return row.id;
}

export const stockRiskMonitorProcedures = {
  riskMonitors: protectedProcedure
    .input(stockRiskMonitorsInputSchema)
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx.db, ctx.userId);
      return listStockRiskMonitors({
        userId,
        input,
        repository: databaseStockRiskMonitorRepository(ctx.db),
        validateContext: ({ userId: ownedUserId, input: contextInput, intent }) =>
          validateStockTaskContext({
            db: ctx.db,
            userId: ownedUserId,
            input: contextInput,
            intent,
            logger: ctx.logger,
          }),
      });
    }),
  createRiskMonitor: protectedProcedure
    .input(createStockRiskMonitorInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx.db, ctx.userId);
      const client = createStockRiskRadarHttpClient({
        baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
        logger: ctx.logger,
      });
      return createStockRiskMonitor({
        userId,
        input,
        repository: databaseStockRiskMonitorRepository(ctx.db),
        validateContext: ({ userId: ownedUserId, input: contextInput, intent }) =>
          validateStockTaskContext({
            db: ctx.db,
            userId: ownedUserId,
            input: contextInput,
            intent,
            logger: ctx.logger,
          }),
        loadRadar: () => runTrustedStockRiskRadar({
          db: ctx.db,
          userId,
          logger: ctx.logger,
          client,
          input,
        }),
      });
    }),
} as const;
