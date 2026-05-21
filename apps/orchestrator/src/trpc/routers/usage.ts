/**
 * Usage router — single endpoint for the /usage dashboard.
 *
 * P1.3 — UsagePage was stitching together two data sources
 * (quota.status + tasks.list with limit:100) and getting numbers
 * that didn't add up: "本月任务 43" came from quota.tasksUsed,
 * "成功 68" came from a tasks.list scan over the last 100 tasks
 * (not month-scoped). This router collapses both into one
 * server-side query so the dashboard can never disagree with itself.
 */

import { TRPCError } from '@trpc/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PlanId } from '@holaday/shared-types';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { QuotaService, getConcurrencyLimit } from '../../quota/quota-service.js';
import { protectedProcedure, router } from '../trpc.js';

/**
 * UTC month start for the user's "本月" scope. Aligned with
 * QuotaService.computePeriodBounds so the counters here can never
 * disagree with the quota gate's notion of the current period.
 */
function currentMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Inclusive 7-day window ending today, UTC date strings (YYYY-MM-DD). */
function buildSevenDayWindow(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const RUNNING_STATUSES = [
  'pending',
  'planning',
  'queued',
  'executing',
  'awaiting_user',
  'paused',
] as const;

export const usageRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ id: users.id, plan: users.plan })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    const planId: PlanId =
      user.plan === 'basic' || user.plan === 'pro' ? user.plan : 'free';
    const quotaService = new QuotaService(ctx.db);
    const snap = await quotaService.snapshot(user.id, planId);

    const monthStart = currentMonthStartUtc();
    // Status counts for the current month. One query, group by
    // status — much cheaper than fetching N rows and counting in
    // JS, and immune to limit caps.
    const statusRows = await ctx.db
      .select({
        status: tasks.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), gte(tasks.createdAt, monthStart)))
      .groupBy(tasks.status);
    let monthCompleted = 0;
    let monthFailed = 0;
    let monthCancelled = 0;
    let monthExecuting = 0;
    let monthTasksTotal = 0;
    for (const row of statusRows) {
      const c = Number(row.count);
      monthTasksTotal += c;
      if (row.status === 'completed') monthCompleted += c;
      else if (row.status === 'failed') monthFailed += c;
      else if (row.status === 'cancelled') monthCancelled += c;
      else if ((RUNNING_STATUSES as readonly string[]).includes(row.status)) {
        monthExecuting += c;
      }
    }

    // Per-day counts for the last 7 days (UTC). Same group-by
    // pattern; the days the user didn't run anything fill in as 0
    // client-side via the window helper.
    const sevenDaysAgoStart = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() - 6,
      ),
    );
    const dailyRows = await ctx.db
      .select({
        d: sql<string>`DATE(${tasks.createdAt})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), gte(tasks.createdAt, sevenDaysAgoStart)))
      .groupBy(sql`DATE(${tasks.createdAt})`);
    const byDate = new Map<string, number>();
    for (const row of dailyRows) {
      byDate.set(String(row.d), Number(row.count));
    }
    const dailyCounts = buildSevenDayWindow().map((date) => ({
      date,
      count: byDate.get(date) ?? 0,
    }));

    const concurrentCount = await quotaService.getActiveTaskCount(user.id);

    return {
      plan: planId,
      monthTasksTotal,
      monthCompleted,
      monthFailed,
      monthCancelled,
      monthExecuting,
      quotaLimit: snap.tasksLimit,
      quotaUsed: snap.tasksUsed,
      quotaRemaining: snap.tasksRemaining,
      quotaBonus: snap.bonusTasks,
      opusLimit: snap.opusLimit,
      opusUsed: snap.opusUsed,
      opusRemaining: snap.opusRemaining,
      opusBonus: snap.bonusOpus,
      concurrentCount,
      concurrencyLimit: getConcurrencyLimit(planId),
      dailyCounts,
    };
  }),
});
