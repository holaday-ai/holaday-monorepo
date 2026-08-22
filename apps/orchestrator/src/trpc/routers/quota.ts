/**
 * Quota router — read-side endpoints for the SPA's sidebar
 * indicator + plan page.
 *
 * Single query so far: `status` returns a snapshot of the active
 * quota period (used / remaining for both standard and Opus,
 * concurrent-task count, plan id). Used by:
 *
 *   - The sidebar quota strip (live counter — refetch on task
 *     terminal events).
 *   - Plan page (shows what an upgrade actually buys).
 *   - Future cron / observability — same shape, callable from
 *     ops scripts via the tRPC client.
 */

import type { PlanId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema/users.js';
import { quotaModeForExternalUser } from '../../quota/quota-mode.js';
import { QuotaService, getConcurrencyLimit } from '../../quota/quota-service.js';
import { protectedProcedure, router } from '../trpc.js';

export const quotaRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ id: users.id, plan: users.plan })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    const planId: PlanId = user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
    const service = new QuotaService(ctx.db);
    const snap = await service.snapshot(user.id, planId);
    const concurrentCount = await service.getActiveTaskCount(user.id);
    return {
      plan: planId,
      quotaMode: quotaModeForExternalUser(ctx.userId),
      period: snap.period,
      periodStart: snap.periodStart.toISOString(),
      periodEnd: snap.periodEnd.toISOString(),
      tasksUsed: snap.tasksUsed,
      tasksLimit: snap.tasksLimit,
      tasksRemaining: snap.tasksRemaining,
      bonusTasks: snap.bonusTasks,
      opusUsed: snap.opusUsed,
      opusLimit: snap.opusLimit,
      opusRemaining: snap.opusRemaining,
      bonusOpus: snap.bonusOpus,
      concurrentCount,
      concurrencyLimit: getConcurrencyLimit(planId),
    };
  }),
});
