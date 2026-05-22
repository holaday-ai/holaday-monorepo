/**
 * Phase 27 — Admin Center router.
 *
 * Three endpoints, all gated by adminProcedure:
 *   - dashboard:  metric cards (today vs yesterday), 7-day trend,
 *                 recent 20 tasks.
 *   - userList:   paginated + searchable + sortable user table.
 *   - userDetail: single user info + recent task history + monthly
 *                 LLM model distribution.
 *
 * "Today" / "yesterday" are computed in Beijing time (UTC+8) so the
 * dashboard matches what feels like "today" to the user. We do the
 * timezone shift inside MySQL via `DATE(DATE_ADD(..., INTERVAL 8
 * HOUR))` rather than relying on the server's `system_time_zone`
 * (which varies between Vultr and dev boxes).
 *
 * "Model" on the recent-tasks list comes from a correlated subquery
 * over `llm_calls` (latest model per task). One JOIN with the user
 * keeps the query tree shallow.
 */

import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { llmCalls } from '../../db/schema/llm-calls.js';
import { tasks } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { adminProcedure, router } from '../trpc.js';
import { adminFinanceRouter } from './admin-finance.js';
import { adminLearningRouter } from './admin-learning.js';

/** Start of the Beijing day that contains `at`, expressed as a UTC instant. */
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

/** YYYY-MM-DD for the Beijing day containing `at`, daysAgo back. */
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

/** First day of the current UTC month, used for "本月" usage rollups. */
function currentMonthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type TrendStatusRow = { day: string; status: string; count: number };
type DayStats = { total: number; completed: number; failed: number };

function buildDashboardDayStats(rows: TrendStatusRow[]): Map<string, DayStats> {
  const byDay = new Map<string, DayStats>();
  for (const row of rows) {
    const day = String(row.day);
    const cur = byDay.get(day) ?? { total: 0, completed: 0, failed: 0 };
    const c = Number(row.count);
    cur.total += c;
    if (row.status === 'completed') cur.completed += c;
    else if (row.status === 'failed' || row.status === 'partial_success') {
      cur.failed += c;
    }
    byDay.set(day, cur);
  }
  return byDay;
}

export const adminRouter = router({
  // ─────────────────────────────────────────────────────────── dashboard ──
  dashboard: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const todayStart = beijingDayStartUtc(now);
    const yesterdayStart = beijingDayStartUtc(now, 1);
    const sevenDaysAgo = beijingDayStartUtc(now, 6);
    const todayStr = beijingDayString(now);
    const yesterdayStr = beijingDayString(now, 1);

    // 7-day trend (one query) — groups by Beijing date + status. We
    // reuse the same result set for today/yesterday metric cards to
    // save round-trips.
    //
    // The Beijing-day expression is repeated verbatim in GROUP BY
    // (not the `day` alias). drizzle's `sql<T>` template doesn't
    // auto-emit `AS day`, so MySQL would reject `GROUP BY day` as
    // "Unknown column". Keeping the expression captured in a const
    // dedupes the literal.
    const dayExpr = sql<
      string
    >`DATE(DATE_ADD(${tasks.createdAt}, INTERVAL 8 HOUR))`;
    const trendRows = await ctx.db
      .select({
        day: dayExpr,
        status: tasks.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .where(gte(tasks.createdAt, sevenDaysAgo))
      .groupBy(dayExpr, tasks.status);

    const byDay = buildDashboardDayStats(trendRows);
    const trend: Array<{ date: string; total: number; successRate: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dStr = beijingDayString(now, i);
      const stats = byDay.get(dStr) ?? { total: 0, completed: 0, failed: 0 };
      const terminal = stats.completed + stats.failed;
      const successRate = terminal > 0 ? Math.round((stats.completed / terminal) * 1000) / 10 : 0;
      trend.push({ date: dStr, total: stats.total, successRate });
    }

    const todayStats = byDay.get(todayStr) ?? { total: 0, completed: 0, failed: 0 };
    const yStats = byDay.get(yesterdayStr) ?? { total: 0, completed: 0, failed: 0 };
    const todayTerm = todayStats.completed + todayStats.failed;
    const yTerm = yStats.completed + yStats.failed;

    // Active users — separate two-row aggregate; cheap with the
    // existing ix_tasks_user_id_created_at index. Same alias-in-
    // GROUP-BY caveat as dayExpr — we repeat the CASE expression.
    const bucketExpr = sql<
      'today' | 'yesterday'
    >`CASE WHEN ${tasks.createdAt} >= ${todayStart} THEN 'today' ELSE 'yesterday' END`;
    const activeUsersRows = await ctx.db
      .select({
        bucket: bucketExpr,
        distinctUsers: sql<number>`COUNT(DISTINCT ${tasks.userId})`,
      })
      .from(tasks)
      .where(gte(tasks.createdAt, yesterdayStart))
      .groupBy(bucketExpr);
    let activeToday = 0;
    let activeYesterday = 0;
    for (const row of activeUsersRows) {
      const n = Number(row.distinctUsers);
      if (row.bucket === 'today') activeToday = n;
      else if (row.bucket === 'yesterday') activeYesterday = n;
    }

    const [totalUsersRow] = await ctx.db
      .select({ totalUsers: sql<number>`COUNT(*)` })
      .from(users);
    const totalUsers = Number(totalUsersRow?.totalUsers ?? 0);

    // Recent 20 tasks. Model comes from a correlated subquery
    // returning the most-recent llm_call.model for each task.
    const recent = await ctx.db
      .select({
        taskId: tasks.externalId,
        intent: tasks.intent,
        title: tasks.title,
        status: tasks.status,
        createdAt: tasks.createdAt,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
        userId: users.externalId,
        displayName: users.displayName,
        email: users.email,
        model: sql<
          string | null
        >`(SELECT model FROM llm_calls WHERE task_id = ${tasks.id} ORDER BY id DESC LIMIT 1)`,
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.userId))
      .orderBy(desc(tasks.id))
      .limit(20);

    return {
      metrics: {
        todayTasks: { value: todayStats.total, prev: yStats.total },
        successRate: {
          value:
            todayTerm > 0
              ? Math.round((todayStats.completed / todayTerm) * 1000) / 10
              : 0,
          prev:
            yTerm > 0 ? Math.round((yStats.completed / yTerm) * 1000) / 10 : 0,
        },
        activeUsers: { value: activeToday, prev: activeYesterday },
        totalUsers: { value: totalUsers, prev: null as number | null },
      },
      trend,
      recent: recent.map((r) => ({
        taskId: r.taskId,
        intent: r.intent,
        title: r.title,
        status: r.status,
        createdAt: r.createdAt,
        durationMs:
          r.startedAt && r.completedAt
            ? r.completedAt.getTime() - r.startedAt.getTime()
            : null,
        user: {
          userId: r.userId,
          displayName: r.displayName,
          email: r.email,
        },
        model: r.model,
      })),
    };
  }),

  // ─────────────────────────────────────────────────────────── userList ──
  userList: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        sort: z.enum(['createdAt', 'taskCount', 'lastActive']).default('createdAt'),
        order: z.enum(['asc', 'desc']).default('desc'),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const monthStart = currentMonthStartUtc();
      const searchPattern = input.search ? `%${input.search}%` : null;

      const whereClause = searchPattern
        ? or(
            like(users.email, searchPattern),
            like(users.displayName, searchPattern),
          )
        : undefined;

      const [totalRow] = await ctx.db
        .select({ total: sql<number>`COUNT(*)` })
        .from(users)
        .where(whereClause);
      const total = Number(totalRow?.total ?? 0);

      // Page the user rows first with whatever sort key is requested.
      // Counts + last-active are joined in via a second query keyed
      // by user_id so we keep the page size constant and avoid any
      // correlated-subquery rendering surprises in drizzle.
      //
      // For sort='taskCount' / 'lastActive' the simple users-only
      // sort can't be used — those values live in the aggregate
      // tables. We grab a wider window of user ids (the whole page
      // worth + a generous lookahead) and sort in JS after merging.
      // For 'createdAt' (default) we use users.createdAt directly,
      // paginate normally, and the aggregates ride along.
      const order = input.order;

      // Paginated user rows.
      let pagedUsers: Array<{
        id: number;
        userId: string;
        email: string | null;
        displayName: string | null;
        plan: string;
        role: string;
        avatarUrl: string | null;
        createdAt: Date;
      }>;
      if (input.sort === 'createdAt') {
        const direction = order === 'asc' ? sql`ASC` : sql`DESC`;
        pagedUsers = await ctx.db
          .select({
            id: users.id,
            userId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            plan: users.plan,
            role: users.role,
            avatarUrl: users.avatarUrl,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(whereClause)
          .orderBy(sql`${users.createdAt} ${direction}`)
          .limit(input.limit)
          .offset(input.offset);
      } else {
        // Sort happens after we have the aggregate values for each
        // user. We grab the entire matching set (capped at 1000 for
        // safety) then sort + slice in JS.
        const ALL_CAP = 1000;
        pagedUsers = await ctx.db
          .select({
            id: users.id,
            userId: users.externalId,
            email: users.email,
            displayName: users.displayName,
            plan: users.plan,
            role: users.role,
            avatarUrl: users.avatarUrl,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(whereClause)
          .limit(ALL_CAP);
      }

      const userIds = pagedUsers.map((u) => u.id);

      // Aggregates: one query per metric, keyed by user_id. Empty
      // result map when there are no user ids (nothing to fetch).
      const monthCountByUser = new Map<number, number>();
      const lastActiveByUser = new Map<number, Date>();
      if (userIds.length > 0) {
        const monthRows = await ctx.db
          .select({
            userId: tasks.userId,
            count: sql<number>`COUNT(*)`,
          })
          .from(tasks)
          .where(and(inArray(tasks.userId, userIds), gte(tasks.createdAt, monthStart)))
          .groupBy(tasks.userId);
        for (const r of monthRows) {
          monthCountByUser.set(Number(r.userId), Number(r.count));
        }
        const lastRows = await ctx.db
          .select({
            userId: tasks.userId,
            maxAt: sql<Date>`MAX(${tasks.createdAt})`,
          })
          .from(tasks)
          .where(inArray(tasks.userId, userIds))
          .groupBy(tasks.userId);
        for (const r of lastRows) {
          if (r.maxAt) lastActiveByUser.set(Number(r.userId), r.maxAt as Date);
        }
      }

      // Merge + (for non-createdAt sorts) sort + paginate in JS.
      let merged = pagedUsers.map((u) => ({
        userId: u.userId,
        email: u.email,
        displayName: u.displayName,
        plan: u.plan,
        role: u.role as 'user' | 'admin',
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt,
        monthTaskCount: monthCountByUser.get(u.id) ?? 0,
        lastActiveAt: lastActiveByUser.get(u.id) ?? null,
      }));

      if (input.sort === 'taskCount') {
        merged.sort((a, b) =>
          order === 'asc'
            ? a.monthTaskCount - b.monthTaskCount
            : b.monthTaskCount - a.monthTaskCount,
        );
        merged = merged.slice(input.offset, input.offset + input.limit);
      } else if (input.sort === 'lastActive') {
        merged.sort((a, b) => {
          const av = a.lastActiveAt ? a.lastActiveAt.getTime() : 0;
          const bv = b.lastActiveAt ? b.lastActiveAt.getTime() : 0;
          return order === 'asc' ? av - bv : bv - av;
        });
        merged = merged.slice(input.offset, input.offset + input.limit);
      }
      // For sort='createdAt' the DB already paginated; merged is
      // exactly the page.

      return { users: merged, total };
    }),

  // ───────────────────────────────────────────────────────── userDetail ──
  userDetail: adminProcedure
    .input(z.object({ userId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select({
          id: users.id,
          userId: users.externalId,
          email: users.email,
          phone: users.phone,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          plan: users.plan,
          role: users.role,
          status: users.status,
          createdAt: users.createdAt,
          planExpiresAt: users.planExpiresAt,
        })
        .from(users)
        .where(eq(users.externalId, input.userId))
        .limit(1);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'user not found' });
      }

      const monthStart = currentMonthStartUtc();
      const [monthCountRow] = await ctx.db
        .select({ monthCount: sql<number>`COUNT(*)` })
        .from(tasks)
        .where(and(eq(tasks.userId, user.id), gte(tasks.createdAt, monthStart)));
      const monthTasks = Number(monthCountRow?.monthCount ?? 0);

      const recentTasks = await ctx.db
        .select({
          taskId: tasks.externalId,
          intent: tasks.intent,
          title: tasks.title,
          status: tasks.status,
          createdAt: tasks.createdAt,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
        })
        .from(tasks)
        .where(eq(tasks.userId, user.id))
        .orderBy(desc(tasks.id))
        .limit(50);

      const modelDist = await ctx.db
        .select({
          model: llmCalls.model,
          calls: sql<number>`COUNT(*)`,
        })
        .from(llmCalls)
        .where(
          and(eq(llmCalls.userId, user.id), gte(llmCalls.createdAt, monthStart)),
        )
        .groupBy(llmCalls.model)
        .orderBy(desc(sql`COUNT(*)`));

      return {
        user: {
          userId: user.userId,
          email: user.email,
          phone: user.phone,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          plan: user.plan,
          role: user.role as 'user' | 'admin',
          status: user.status,
          createdAt: user.createdAt,
          planExpiresAt: user.planExpiresAt,
        },
        usage: {
          monthTasks,
          modelDistribution: modelDist.map((r) => ({
            model: r.model,
            calls: Number(r.calls),
          })),
        },
        recentTasks: recentTasks.map((r) => ({
          taskId: r.taskId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt,
          durationMs:
            r.startedAt && r.completedAt
              ? r.completedAt.getTime() - r.startedAt.getTime()
              : null,
        })),
      };
    }),

  // Phase 27B — nested finance namespace (revenue + cost).
  finance: adminFinanceRouter,
  // Phase 27C — nested learning namespace (per-domain stats).
  learning: adminLearningRouter,
});

// Re-export helpers for unit testing (no external consumers).
export const __adminInternals = {
  beijingDayStartUtc,
  beijingDayString,
  buildDashboardDayStats,
};
