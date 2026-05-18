/**
 * Phase 27B — admin finance router.
 *
 * Nests under admin.finance.* and reads from the existing payments,
 * users, tasks, and llm_calls tables to produce revenue + cost +
 * profit views for the BOSS dashboard. No payment-provider reconcile
 * (that's a separate workstream); we trust `payments.status =
 * 'completed'` as the revenue source of truth.
 *
 * Money convention: all admin-facing fields land in CNY cents.
 *  - `payments.amount_cents` is the gateway-recorded amount in
 *    `payments.currency` ('USD' or 'CNY'). USD rows are converted at
 *    a hardcoded mid-rate (admin readout, not accounting — see
 *    USD_TO_CNY below).
 *  - `llm_calls.cost_usd` is a DECIMAL in USD; we multiply by the
 *    same rate to land on CNY cents.
 *  - Server fixed costs (Vultr USD + Aliyun CNY) are pre-summed to a
 *    monthly CNY-cents constant. Treated as full-month regardless of
 *    how many days have elapsed — these are paid up-front and the
 *    profit card should always reflect the full liability.
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { payments } from '../../db/schema/payments.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { adminProcedure, router } from '../trpc.js';

const USD_TO_CNY = 7.2;
const VULTR_USD_MONTHLY = 12;
const ALIYUN_CNY_MONTHLY = 300;
/** Full-month server liability in CNY cents. */
export const SERVER_FIXED_CNY_CENTS_MONTHLY = Math.round(
  (VULTR_USD_MONTHLY * USD_TO_CNY + ALIYUN_CNY_MONTHLY) * 100,
);

/** Convert a payments row to CNY cents. Falls through on unknown currency. */
export function paymentRowCnyCents(
  amountCents: number,
  currency: string,
): number {
  const c = currency.toUpperCase();
  if (c === 'CNY') return amountCents;
  if (c === 'USD') return Math.round(amountCents * USD_TO_CNY);
  // Anything else (shouldn't happen given the schema) — pass through
  // verbatim rather than silently drop the row to 0.
  return amountCents;
}

/** USD decimal string (from llm_calls.cost_usd) → CNY cents. */
export function usdToCnyCents(usd: number | string): number {
  const n = typeof usd === 'number' ? usd : Number(usd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * USD_TO_CNY * 100);
}

function currentMonthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function monthsAgoStartUtc(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

/** Beijing-day start (UTC instant), daysAgo back. */
function beijingDayStartUtc(at: Date, daysAgo = 0): Date {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  const utcDayStart = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysAgo,
    ),
  );
  return new Date(utcDayStart.getTime() - 8 * 3600_000);
}

function beijingDayString(at: Date, daysAgo = 0): string {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  const d = new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - daysAgo,
    ),
  );
  return d.toISOString().slice(0, 10);
}

export const adminFinanceRouter = router({
  // ────────────────────────────────────────────────────────── summary ──
  summary: adminProcedure.query(async ({ ctx }) => {
    const monthStart = currentMonthStartUtc();

    // Revenue — completed payments this month, grouped by currency
    // so the USD → CNY conversion happens once per currency, not
    // per row.
    const paymentRows = await ctx.db
      .select({
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, monthStart),
          eq(payments.status, 'completed'),
        ),
      )
      .groupBy(payments.currency);
    let monthRevenueCnyCents = 0;
    for (const row of paymentRows) {
      monthRevenueCnyCents += paymentRowCnyCents(
        Number(row.sumCents) || 0,
        row.currency,
      );
    }

    // LLM cost — sum cost_usd this month → CNY cents.
    const [llmRow] = await ctx.db
      .select({
        sumUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, monthStart));
    const llmCostCnyCents = usdToCnyCents(llmRow?.sumUsd ?? '0');

    const totalCostCnyCents = llmCostCnyCents + SERVER_FIXED_CNY_CENTS_MONTHLY;
    const profitCnyCents = monthRevenueCnyCents - totalCostCnyCents;

    return {
      monthRevenueCnyCents,
      monthCostCnyCents: totalCostCnyCents,
      monthLlmCostCnyCents: llmCostCnyCents,
      monthServerCostCnyCents: SERVER_FIXED_CNY_CENTS_MONTHLY,
      monthProfitCnyCents: profitCnyCents,
    };
  }),

  // ──────────────────────────────────────────────────── revenueByPlan ──
  revenueByPlan: adminProcedure.query(async ({ ctx }) => {
    // User counts per plan — current snapshot.
    const userRows = await ctx.db
      .select({
        plan: users.plan,
        count: sql<number>`COUNT(*)`,
      })
      .from(users)
      .groupBy(users.plan);
    const userCountByPlan = new Map<string, number>();
    for (const r of userRows) {
      userCountByPlan.set(r.plan, Number(r.count));
    }

    // Revenue per plan — sum completed payments this month, grouped
    // by (plan, currency) so we can convert per group.
    const monthStart = currentMonthStartUtc();
    const paymentRows = await ctx.db
      .select({
        plan: payments.plan,
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, monthStart),
          eq(payments.status, 'completed'),
        ),
      )
      .groupBy(payments.plan, payments.currency);

    const revenueByPlan = new Map<string, number>();
    for (const r of paymentRows) {
      const cny = paymentRowCnyCents(Number(r.sumCents) || 0, r.currency);
      revenueByPlan.set(r.plan, (revenueByPlan.get(r.plan) ?? 0) + cny);
    }

    return {
      plans: ['free', 'basic', 'pro'].map((plan) => ({
        plan,
        userCount: userCountByPlan.get(plan) ?? 0,
        monthRevenueCnyCents: revenueByPlan.get(plan) ?? 0,
      })),
    };
  }),

  // ────────────────────────────────────────────────── revenueByMonth ──
  revenueByMonth: adminProcedure.query(async ({ ctx }) => {
    // Pull 6 calendar months ending with the current one. Group at
    // YYYY-MM granularity using the MySQL DATE_FORMAT extension.
    const startWindow = monthsAgoStartUtc(5);
    const rows = await ctx.db
      .select({
        month: sql<string>`DATE_FORMAT(${payments.createdAt}, '%Y-%m')`,
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(
        and(
          gte(payments.createdAt, startWindow),
          eq(payments.status, 'completed'),
        ),
      )
      .groupBy(
        sql`DATE_FORMAT(${payments.createdAt}, '%Y-%m')`,
        payments.currency,
      );

    const byMonth = new Map<string, number>();
    for (const r of rows) {
      const cny = paymentRowCnyCents(Number(r.sumCents) || 0, r.currency);
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + cny);
    }

    const series: Array<{ month: string; revenueCnyCents: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = monthsAgoStartUtc(i);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      series.push({ month: ym, revenueCnyCents: byMonth.get(ym) ?? 0 });
    }
    return { series };
  }),

  // ──────────────────────────────────────────────── conversionFunnel ──
  conversionFunnel: adminProcedure.query(async ({ ctx }) => {
    const [totalUsersRow] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(users);
    const totalSignups = Number(totalUsersRow?.count ?? 0);

    const [withTaskRow] = await ctx.db
      .select({ count: sql<number>`COUNT(DISTINCT ${tasks.userId})` })
      .from(tasks);
    const withTask = Number(withTaskRow?.count ?? 0);

    const [paidRow] = await ctx.db
      .select({
        count: sql<number>`COUNT(DISTINCT ${payments.userExternalId})`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'completed'),
          eq(payments.kind, 'subscription'),
        ),
      );
    const paidUsers = Number(paidRow?.count ?? 0);

    // "Renewed" = a user with ≥ 2 completed subscription payments.
    const renewedRows = await ctx.db
      .select({
        userExternalId: payments.userExternalId,
        count: sql<number>`COUNT(*)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'completed'),
          eq(payments.kind, 'subscription'),
        ),
      )
      .groupBy(payments.userExternalId);
    const renewedUsers = renewedRows.filter((r) => Number(r.count) >= 2).length;

    // LTV — total subscription revenue / distinct paying users.
    const ltvRows = await ctx.db
      .select({
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'completed'),
          eq(payments.kind, 'subscription'),
        ),
      )
      .groupBy(payments.currency);
    let totalSubRevenueCnyCents = 0;
    for (const r of ltvRows) {
      totalSubRevenueCnyCents += paymentRowCnyCents(
        Number(r.sumCents) || 0,
        r.currency,
      );
    }
    const ltvCnyCents = paidUsers > 0 ? Math.round(totalSubRevenueCnyCents / paidUsers) : 0;

    return {
      stages: [
        { label: '注册用户', count: totalSignups },
        { label: '产生过任务', count: withTask },
        { label: '付费用户', count: paidUsers },
        { label: '续费用户', count: renewedUsers },
      ],
      ltvCnyCents,
    };
  }),

  // ─────────────────────────────────────────────────── costBreakdown ──
  costBreakdown: adminProcedure.query(async ({ ctx }) => {
    const monthStart = currentMonthStartUtc();
    const rows = await ctx.db
      .select({
        model: llmCalls.model,
        provider: llmCalls.provider,
        callCount: sql<number>`COUNT(*)`,
        promptTokens: sql<number>`COALESCE(SUM(${llmCalls.promptTokens}), 0)`,
        completionTokens: sql<number>`COALESCE(SUM(${llmCalls.completionTokens}), 0)`,
        cacheReadTokens: sql<number>`COALESCE(SUM(${llmCalls.cacheReadTokens}), 0)`,
        cacheWriteTokens: sql<number>`COALESCE(SUM(${llmCalls.cacheWriteTokens}), 0)`,
        costUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, monthStart))
      .groupBy(llmCalls.model, llmCalls.provider)
      .orderBy(desc(sql`COALESCE(SUM(${llmCalls.costUsd}), 0)`));

    return {
      models: rows.map((r) => {
        const costUsd = Number(r.costUsd) || 0;
        return {
          model: r.model,
          provider: r.provider,
          callCount: Number(r.callCount),
          totalTokens:
            Number(r.promptTokens) +
            Number(r.completionTokens) +
            Number(r.cacheReadTokens) +
            Number(r.cacheWriteTokens),
          promptTokens: Number(r.promptTokens),
          completionTokens: Number(r.completionTokens),
          costUsd,
          costCnyCents: usdToCnyCents(costUsd),
        };
      }),
    };
  }),

  // ────────────────────────────────────────────────────── costByDay ──
  costByDay: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 30;
      const now = new Date();
      const startUtc = beijingDayStartUtc(now, days - 1);

      const dayExpr = sql<string>`DATE(DATE_ADD(${llmCalls.createdAt}, INTERVAL 8 HOUR))`;
      const rows = await ctx.db
        .select({
          day: dayExpr,
          callCount: sql<number>`COUNT(*)`,
          costUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`,
        })
        .from(llmCalls)
        .where(gte(llmCalls.createdAt, startUtc))
        .groupBy(dayExpr);

      const byDay = new Map<string, { callCount: number; costCnyCents: number }>();
      for (const r of rows) {
        byDay.set(String(r.day), {
          callCount: Number(r.callCount),
          costCnyCents: usdToCnyCents(r.costUsd),
        });
      }
      const series: Array<{ date: string; callCount: number; costCnyCents: number }> = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = beijingDayString(now, i);
        const v = byDay.get(date) ?? { callCount: 0, costCnyCents: 0 };
        series.push({ date, ...v });
      }
      return { series };
    }),

  // ──────────────────────────────────────────────── topCostlyTasks ──
  topCostlyTasks: adminProcedure
    .input(z.object({ limit: z.number().int().min(5).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;
      const monthStart = currentMonthStartUtc();

      // Aggregate per task_id first (task_id can be null for some
      // commander-only calls; we filter those out).
      const aggregateRows = await ctx.db
        .select({
          taskId: llmCalls.taskId,
          callCount: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`COALESCE(SUM(${llmCalls.promptTokens} + ${llmCalls.completionTokens} + ${llmCalls.cacheReadTokens} + ${llmCalls.cacheWriteTokens}), 0)`,
          costUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`,
        })
        .from(llmCalls)
        .where(
          and(
            gte(llmCalls.createdAt, monthStart),
            sql`${llmCalls.taskId} IS NOT NULL`,
          ),
        )
        .groupBy(llmCalls.taskId)
        .orderBy(desc(sql`COALESCE(SUM(${llmCalls.costUsd}), 0)`))
        .limit(limit);

      const taskIds = aggregateRows
        .map((r) => (r.taskId == null ? null : Number(r.taskId)))
        .filter((id): id is number => id != null);
      if (taskIds.length === 0) return { tasks: [] };

      const taskRows = await ctx.db
        .select({
          id: tasks.id,
          taskId: tasks.externalId,
          intent: tasks.intent,
          title: tasks.title,
          status: tasks.status,
          userExternalId: users.externalId,
          userDisplayName: users.displayName,
          userEmail: users.email,
        })
        .from(tasks)
        .innerJoin(users, eq(users.id, tasks.userId))
        .where(inArray(tasks.id, taskIds));
      const taskById = new Map(taskRows.map((r) => [Number(r.id), r]));

      // Also pick the dominant model per task — useful column for
      // the dashboard.
      const modelRows = await ctx.db
        .select({
          taskId: llmCalls.taskId,
          model: llmCalls.model,
          calls: sql<number>`COUNT(*)`,
        })
        .from(llmCalls)
        .where(
          and(inArray(llmCalls.taskId, taskIds), gte(llmCalls.createdAt, monthStart)),
        )
        .groupBy(llmCalls.taskId, llmCalls.model);
      const modelByTask = new Map<number, string>();
      const callsByTask = new Map<number, Map<string, number>>();
      for (const r of modelRows) {
        const id = Number(r.taskId);
        const m = callsByTask.get(id) ?? new Map<string, number>();
        m.set(r.model, Number(r.calls));
        callsByTask.set(id, m);
      }
      for (const [id, perModel] of callsByTask) {
        let best: { model: string; calls: number } | null = null;
        for (const [model, calls] of perModel) {
          if (!best || calls > best.calls) best = { model, calls };
        }
        if (best) modelByTask.set(id, best.model);
      }

      return {
        tasks: aggregateRows.map((agg) => {
          const id = agg.taskId == null ? null : Number(agg.taskId);
          const task = id == null ? null : taskById.get(id) ?? null;
          const costUsd = Number(agg.costUsd) || 0;
          return {
            taskId: task?.taskId ?? null,
            intent: task?.intent ?? null,
            title: task?.title ?? null,
            status: task?.status ?? null,
            model: id == null ? null : modelByTask.get(id) ?? null,
            callCount: Number(agg.callCount),
            totalTokens: Number(agg.totalTokens),
            costUsd,
            costCnyCents: usdToCnyCents(costUsd),
            user: task
              ? {
                  userId: task.userExternalId,
                  displayName: task.userDisplayName,
                  email: task.userEmail,
                }
              : null,
          };
        }),
      };
    }),
});

// Helpers exported for unit tests.
export const __financeInternals = {
  paymentRowCnyCents,
  usdToCnyCents,
  SERVER_FIXED_CNY_CENTS_MONTHLY,
  USD_TO_CNY,
};
