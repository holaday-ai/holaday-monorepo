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

import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { costCoverageSelection, summarizeCost } from '../../agent/llm-cost-summary.js';
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

/** Convert a payments row to CNY cents. Unknown currencies must not be mislabeled as CNY. */
export function paymentRowCnyCents(
  amountCents: number,
  currency: string,
): number {
  const c = currency.toUpperCase();
  if (c === 'CNY') return amountCents;
  if (c === 'USD') return Math.round(amountCents * USD_TO_CNY);
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `unsupported payment currency: ${c || 'empty'}`,
  });
}

/** USD decimal string (from llm_calls.cost_usd) → CNY cents. */
export function usdToCnyCents(usd: number | string): number {
  const n = typeof usd === 'number' ? usd : Number(usd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * USD_TO_CNY * 100);
}

function beijingMonthStartUtc(at: Date, monthsAgo = 0): Date {
  const shifted = new Date(at.getTime() + 8 * 3600_000);
  const localMonthStartAsUtc = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - monthsAgo, 1),
  );
  return new Date(localMonthStartAsUtc.getTime() - 8 * 3600_000);
}

function completedPaymentPeriodCondition(start: Date) {
  return and(
    gte(payments.completedAt, start),
    eq(payments.status, 'completed'),
  );
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

function buildRevenueProductRows(input: {
  userCounts: Array<{ plan: string; count: number }>;
  revenue: Array<{ kind: string; plan: string; revenueCnyCents: number }>;
}) {
  const userCountByPlan = new Map(
    input.userCounts.map((row) => [row.plan, Number(row.count)]),
  );
  const revenueByProduct = new Map<string, number>();
  for (const row of input.revenue) {
    const key = `${row.kind}:${row.plan}`;
    revenueByProduct.set(
      key,
      (revenueByProduct.get(key) ?? 0) + row.revenueCnyCents,
    );
  }

  const baselinePlans = ['free', 'basic', 'pro'];
  const subscriptionPlans = new Set([
    ...baselinePlans,
    ...userCountByPlan.keys(),
    ...input.revenue
      .filter((row) => row.kind === 'subscription')
      .map((row) => row.plan),
  ]);
  const orderedSubscriptionPlans = [
    ...baselinePlans,
    ...Array.from(subscriptionPlans)
      .filter((plan) => !baselinePlans.includes(plan))
      .sort(),
  ];
  const extraProducts = Array.from(
    new Set(
      input.revenue
        .filter((row) => row.kind !== 'subscription')
        .map((row) => `${row.kind}:${row.plan}`),
    ),
  ).sort();

  return [
    ...orderedSubscriptionPlans.map((plan) => ({
      kind: 'subscription',
      plan,
      userCount: userCountByPlan.get(plan) ?? 0,
      monthRevenueCnyCents: revenueByProduct.get(`subscription:${plan}`) ?? 0,
    })),
    ...extraProducts.map((key) => {
      const separator = key.indexOf(':');
      const kind = key.slice(0, separator);
      const plan = key.slice(separator + 1);
      return {
        kind,
        plan,
        userCount: 0,
        monthRevenueCnyCents: revenueByProduct.get(key) ?? 0,
      };
    }),
  ];
}

export const adminFinanceRouter = router({
  // ────────────────────────────────────────────────────────── summary ──
  summary: adminProcedure.query(async ({ ctx }) => {
    const monthStart = beijingMonthStartUtc(new Date());

    // Revenue — completed payments this month, grouped by currency
    // so the USD → CNY conversion happens once per currency, not
    // per row.
    const paymentRows = await ctx.db
      .select({
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(completedPaymentPeriodCondition(monthStart))
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
        ...costCoverageSelection(),
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, monthStart));
    const llmCostCnyCents = usdToCnyCents(llmRow?.sumUsd ?? '0');

    const totalCostCnyCents = llmCostCnyCents + SERVER_FIXED_CNY_CENTS_MONTHLY;
    const profitCnyCents = monthRevenueCnyCents - totalCostCnyCents;
    const coverage = summarizeCost(llmRow?.sumUsd, llmRow?.unknownCostCalls);

    return {
      monthRevenueCnyCents,
      monthCostCnyCents: coverage.totalCostUsd === null ? null : totalCostCnyCents,
      monthLlmCostCnyCents: coverage.totalCostUsd === null ? null : llmCostCnyCents,
      monthKnownLlmCostCnyCents: llmCostCnyCents,
      unknownCostCalls: coverage.unknownCostCalls,
      monthServerCostCnyCents: SERVER_FIXED_CNY_CENTS_MONTHLY,
      monthProfitCnyCents: coverage.totalCostUsd === null ? null : profitCnyCents,
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
      .where(ne(users.role, 'system'))
      .groupBy(users.plan);

    // Revenue per plan — sum completed payments this month, grouped
    // by (plan, currency) so we can convert per group.
    const monthStart = beijingMonthStartUtc(new Date());
    const paymentRows = await ctx.db
      .select({
        kind: payments.kind,
        plan: payments.plan,
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(completedPaymentPeriodCondition(monthStart))
      .groupBy(payments.kind, payments.plan, payments.currency);

    const revenueByProduct = new Map<string, {
      kind: string;
      plan: string;
      revenueCnyCents: number;
    }>();
    for (const r of paymentRows) {
      const cny = paymentRowCnyCents(Number(r.sumCents) || 0, r.currency);
      const key = `${r.kind}:${r.plan}`;
      const current = revenueByProduct.get(key) ?? {
        kind: r.kind,
        plan: r.plan,
        revenueCnyCents: 0,
      };
      current.revenueCnyCents += cny;
      revenueByProduct.set(key, current);
    }

    return {
      plans: buildRevenueProductRows({
        userCounts: userRows.map((row) => ({
          plan: row.plan,
          count: Number(row.count),
        })),
        revenue: Array.from(revenueByProduct.values()),
      }),
    };
  }),

  // ────────────────────────────────────────────────── revenueByMonth ──
  revenueByMonth: adminProcedure.query(async ({ ctx }) => {
    // Pull 6 calendar months ending with the current one. Group at
    // YYYY-MM granularity using the MySQL DATE_FORMAT extension.
    const now = new Date();
    const startWindow = beijingMonthStartUtc(now, 5);
    const rows = await ctx.db
      .select({
        month: sql<string>`DATE_FORMAT(DATE_ADD(${payments.completedAt}, INTERVAL 8 HOUR), '%Y-%m')`,
        currency: payments.currency,
        sumCents: sql<number>`COALESCE(SUM(${payments.amountCents}), 0)`,
      })
      .from(payments)
      .where(completedPaymentPeriodCondition(startWindow))
      .groupBy(
        sql`DATE_FORMAT(DATE_ADD(${payments.completedAt}, INTERVAL 8 HOUR), '%Y-%m')`,
        payments.currency,
      );

    const byMonth = new Map<string, number>();
    for (const r of rows) {
      const cny = paymentRowCnyCents(Number(r.sumCents) || 0, r.currency);
      byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + cny);
    }

    const series: Array<{ month: string; revenueCnyCents: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(beijingMonthStartUtc(now, i).getTime() + 8 * 3600_000);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      series.push({ month: ym, revenueCnyCents: byMonth.get(ym) ?? 0 });
    }
    return { series };
  }),

  // ──────────────────────────────────────────────── conversionFunnel ──
  conversionFunnel: adminProcedure.query(async ({ ctx }) => {
    const [totalUsersRow] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(users)
      .where(ne(users.role, 'system'));
    const totalSignups = Number(totalUsersRow?.count ?? 0);

    const [withTaskRow] = await ctx.db
      .select({ count: sql<number>`COUNT(DISTINCT ${tasks.userId})` })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.userId))
      .where(and(eq(tasks.origin, 'user'), ne(users.role, 'system')));
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
    const monthStart = beijingMonthStartUtc(new Date());
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
        ...costCoverageSelection(),
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, monthStart))
      .groupBy(llmCalls.model, llmCalls.provider)
      .orderBy(desc(sql`COALESCE(SUM(${llmCalls.costUsd}), 0)`));

    return {
      models: rows.map((r) => {
        const coverage = summarizeCost(r.costUsd, r.unknownCostCalls);
        const costUsd = coverage.totalCostUsd;
        return {
          model: r.model,
          provider: r.provider,
          callCount: Number(r.callCount),
          incompleteUsageCalls: Number(r.incompleteUsageCalls ?? 0),
          totalTokens: Number(r.incompleteUsageCalls ?? 0) > 0 ? null :
            Number(r.promptTokens) +
            Number(r.completionTokens) +
            Number(r.cacheReadTokens) +
            Number(r.cacheWriteTokens),
          promptTokens: Number(r.promptTokens),
          completionTokens: Number(r.completionTokens),
          costUsd,
          knownCostUsd: coverage.knownCostUsd,
          unknownCostCalls: coverage.unknownCostCalls,
          knownCostCnyCents: usdToCnyCents(coverage.knownCostUsd),
          costCnyCents: costUsd === null ? null : usdToCnyCents(costUsd),
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
          ...costCoverageSelection(),
        })
        .from(llmCalls)
        .where(gte(llmCalls.createdAt, startUtc))
        .groupBy(dayExpr);

      type DayCost = { callCount: number; costCnyCents: number | null; knownCostCnyCents: number; unknownCostCalls: number };
      const byDay = new Map<string, DayCost>();
      for (const r of rows) {
        const coverage = summarizeCost(r.costUsd, r.unknownCostCalls);
        byDay.set(String(r.day), {
          callCount: Number(r.callCount),
          costCnyCents: coverage.totalCostUsd === null ? null : usdToCnyCents(coverage.totalCostUsd),
          knownCostCnyCents: usdToCnyCents(coverage.knownCostUsd),
          unknownCostCalls: coverage.unknownCostCalls,
        });
      }
      const series: Array<{ date: string } & DayCost> = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = beijingDayString(now, i);
        const v = byDay.get(date) ?? { callCount: 0, costCnyCents: 0, knownCostCnyCents: 0, unknownCostCalls: 0 };
        series.push({ date, ...v });
      }
      return { series };
    }),

  /** Any task, including older/low-cost tasks outside the monthly top ten. */
  taskCost: adminProcedure.input(z.object({ taskId: z.string().regex(/^tsk_[A-Za-z0-9_-]{1,100}$/) })).query(async ({ ctx, input }) => {
    const [task] = await ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.externalId, input.taskId)).limit(1);
    if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: '任务不存在' });
    const [row] = await ctx.db.select({ callCount: sql<number>`COUNT(*)`, costUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`, ...costCoverageSelection() }).from(llmCalls).where(eq(llmCalls.taskId, task.id));
    const coverage = summarizeCost(row?.costUsd, row?.unknownCostCalls);
    const callCount = Number(row?.callCount ?? 0);
    return { taskId: input.taskId, callCount, ...coverage, totalCostUsd: callCount === 0 ? null : coverage.totalCostUsd,
      costCnyCents: callCount === 0 || coverage.totalCostUsd === null ? null : usdToCnyCents(coverage.totalCostUsd),
      knownCostCnyCents: usdToCnyCents(coverage.knownCostUsd),
      accounting: 'official_list_estimate' as const };
  }),

  // ──────────────────────────────────────────────── topCostlyTasks ──
  topCostlyTasks: adminProcedure
    .input(z.object({ limit: z.number().int().min(5).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;
      const monthStart = beijingMonthStartUtc(new Date());

      // Aggregate per task_id first (task_id can be null for some
      // commander-only calls; we filter those out).
      const aggregateRows = await ctx.db
        .select({
          taskId: llmCalls.taskId,
          callCount: sql<number>`COUNT(*)`,
          totalTokens: sql<number>`COALESCE(SUM(COALESCE(${llmCalls.promptTokens}, 0) + COALESCE(${llmCalls.completionTokens}, 0) + COALESCE(${llmCalls.cacheReadTokens}, 0) + COALESCE(${llmCalls.cacheWriteTokens}, 0)), 0)`,
          costUsd: sql<string>`COALESCE(SUM(${llmCalls.costUsd}), 0)`,
          ...costCoverageSelection(),
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
          const coverage = summarizeCost(agg.costUsd, agg.unknownCostCalls);
          const costUsd = coverage.totalCostUsd;
          return {
            taskId: task?.taskId ?? null,
            intent: task?.intent ?? null,
            title: task?.title ?? null,
            status: task?.status ?? null,
            model: id == null ? null : modelByTask.get(id) ?? null,
            callCount: Number(agg.callCount),
            totalTokens: Number(agg.incompleteUsageCalls ?? 0) > 0 ? null : Number(agg.totalTokens),
            incompleteUsageCalls: Number(agg.incompleteUsageCalls ?? 0),
            costUsd,
            knownCostUsd: coverage.knownCostUsd,
            knownCostCnyCents: usdToCnyCents(coverage.knownCostUsd),
            unknownCostCalls: coverage.unknownCostCalls,
            costCnyCents: costUsd === null ? null : usdToCnyCents(costUsd),
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
  beijingMonthStartUtc,
  buildRevenueProductRows,
  completedPaymentPeriodCondition,
  paymentRowCnyCents,
  usdToCnyCents,
  SERVER_FIXED_CNY_CENTS_MONTHLY,
  USD_TO_CNY,
};
