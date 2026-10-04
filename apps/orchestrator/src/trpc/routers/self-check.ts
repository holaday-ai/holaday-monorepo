/**
 * 系统自检 (batch 10.1) — admin only. One click probes model lanes, media and
 * search credentials, infrastructure, switches and migrations; answers are
 * cached for 5 minutes and every run is audit-logged without secrets.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import {
  createProductionSelfCheckDeps,
  defaultSelfCheckRegion,
} from '../../self-check/production-deps.js';
import { selfCheckService } from '../../self-check/self-check-runtime.js';
import { adminProcedure, router } from '../trpc.js';

async function adminRegion(
  ctx: { db: import('../../db/client.js').DB; userId: string },
  requested?: 'cn' | 'intl',
): Promise<'cn' | 'intl'> {
  if (requested) return requested;
  const [row] = await ctx.db
    .select({ region: users.modelDataRegion })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  return defaultSelfCheckRegion(row?.region ?? null);
}

const regionInput = z.enum(['cn', 'intl']).optional();

export const selfCheckRouter = router({
  latest: adminProcedure
    .input(z.object({ region: regionInput }).strict().optional())
    .query(async ({ ctx, input }) =>
      selfCheckService.latest(await adminRegion(ctx, input?.region)),
    ),

  run: adminProcedure
    .input(z.object({ force: z.boolean().optional(), region: regionInput }).strict().optional())
    .mutation(async ({ ctx, input }) => {
      const region = await adminRegion(ctx, input?.region);
      return selfCheckService.check({
        deps: createProductionSelfCheckDeps({ actorExternalId: ctx.userId, region }),
        actorExternalId: ctx.userId,
        source: 'admin',
        ...(input?.force ? { force: true } : {}),
      });
    }),
});
