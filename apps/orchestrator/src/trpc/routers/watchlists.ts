/**
 * Phase 1 指令 #2 — 自选股 (watchlist) router. CRUD for the user's
 * A股/港美股 self-selected symbol list. The pre-/post-market briefing
 * (③) and the instant-Q&A skill (④) read this list to know which
 * symbols to pull from the AkShare MCP tools.
 *
 * Mirrors the projects router shape (`requireUserId` + protectedProcedure
 * + external-id addressing). Deliberately pure: NO AkShare calls happen
 * here — data fetch + 来源/时间戳/免责 live on the briefing/Q&A side.
 *
 * Semantics chosen for a "toggle a star on a stock" UX:
 *   - `add`    is idempotent — re-adding an existing symbol returns it
 *              with `already: true` instead of throwing. The DB
 *              `uk_watchlists_user_symbol` unique key also guards the
 *              add-vs-add race (caught + treated as idempotent).
 *   - `remove` is idempotent — removing a symbol that isn't on the
 *              list is a no-op success, not a NOT_FOUND.
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  POSTMARKET_BRIEFING_INTENT,
  PREMARKET_BRIEFING_INTENT,
} from '../../agent/a-share/briefing-dispatch.js';
import { scheduledTasks } from '../../db/schema/scheduled-tasks.js';
import { users } from '../../db/schema/users.js';
import { watchlists } from '../../db/schema/watchlists.js';
import { protectedProcedure, router } from '../trpc.js';

const BRIEFING_INTENTS = [PREMARKET_BRIEFING_INTENT, POSTMARKET_BRIEFING_INTENT];

/** 下一个「每天 UTC HH:MM」Date。中国无 DST：08:30 SH=00:30 UTC / 15:30 SH=07:30 UTC。 */
function nextDailyUtc(utcHour: number, utcMinute: number, now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(utcHour, utcMinute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** 删除该用户的简报定时（盘前 + 盘后）。 */
async function cancelBriefingSchedules(
  db: typeof import('../../db/client.js').db,
  userId: number,
): Promise<void> {
  await db
    .delete(scheduledTasks)
    .where(
      and(eq(scheduledTasks.userId, userId), inArray(scheduledTasks.intent, BRIEFING_INTENTS)),
    );
}

/**
 * Resolve the caller's internal user.id from the external usr_… id
 * stamped on the auth context. Throws UNAUTHORIZED rather than
 * silently returning [] so a stale token surfaces immediately.
 */
async function requireUserId(ctx: {
  db: typeof import('../../db/client.js').db;
  userId: string;
}): Promise<number> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }
  return row.id;
}

/** MySQL duplicate-key error (concurrent add lost the race). */
function isDuplicateKeyError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ER_DUP_ENTRY';
}

const symbolInput = z.string().trim().min(1).max(16);
const marketInput = z.enum(['A', 'HK', 'US']);

export const watchlistsRouter = router({
  /**
   * List the caller's watchlist. Primary sort by `sort_order` (manual
   * ordering, reserved for a future drag-reorder), then most-recently
   * added first as the tiebreak.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({
        externalId: watchlists.externalId,
        symbol: watchlists.symbol,
        market: watchlists.market,
        displayName: watchlists.displayName,
        note: watchlists.note,
        createdAt: watchlists.createdAt,
      })
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(asc(watchlists.sortOrder), desc(watchlists.createdAt));
    return rows.map((r) => ({
      watchlistId: r.externalId,
      symbol: r.symbol,
      market: r.market,
      displayName: r.displayName,
      note: r.note,
      createdAt: r.createdAt,
    }));
  }),

  /**
   * Add a symbol. Idempotent: if it's already on the list we return
   * the existing row (`already: true`) without inserting a duplicate.
   */
  add: protectedProcedure
    .input(
      z.object({
        symbol: symbolInput,
        market: marketInput.default('A'),
        displayName: z.string().trim().max(64).optional(),
        note: z.string().trim().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const symbol = input.symbol.trim();

      const [existing] = await ctx.db
        .select({ externalId: watchlists.externalId })
        .from(watchlists)
        .where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)))
        .limit(1);
      if (existing) {
        return {
          ok: true as const,
          watchlistId: existing.externalId,
          symbol,
          already: true as const,
        };
      }

      const externalId = newExternalId('watchlist');
      try {
        await ctx.db.insert(watchlists).values({
          externalId,
          userId,
          symbol,
          market: input.market,
          displayName: input.displayName ?? null,
          note: input.note ?? null,
        });
      } catch (err) {
        // Concurrent add won the uk_watchlists_user_symbol race — treat
        // as idempotent and return whichever row landed.
        if (isDuplicateKeyError(err)) {
          const [row] = await ctx.db
            .select({ externalId: watchlists.externalId })
            .from(watchlists)
            .where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)))
            .limit(1);
          return {
            ok: true as const,
            watchlistId: row?.externalId ?? externalId,
            symbol,
            already: true as const,
          };
        }
        throw err;
      }
      return { ok: true as const, watchlistId: externalId, symbol, already: false as const };
    }),

  /**
   * Remove a symbol from the caller's watchlist. Idempotent — removing
   * a symbol that isn't there is a no-op success (good for a toggle UX).
   */
  remove: protectedProcedure
    .input(z.object({ symbol: symbolInput }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const symbol = input.symbol.trim();
      await ctx.db
        .delete(watchlists)
        .where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)));
      return { ok: true as const, symbol };
    }),

  /**
   * Update the cached display name and/or user note for a symbol on the
   * caller's list. No-op (updated: false) when neither field is given.
   */
  update: protectedProcedure
    .input(
      z.object({
        symbol: symbolInput,
        displayName: z.string().trim().max(64).nullish(),
        note: z.string().trim().max(255).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const symbol = input.symbol.trim();
      const set: Partial<{ displayName: string | null; note: string | null }> = {};
      if (input.displayName !== undefined) set.displayName = input.displayName;
      if (input.note !== undefined) set.note = input.note;
      if (Object.keys(set).length === 0) {
        return { ok: true as const, symbol, updated: false as const };
      }
      await ctx.db
        .update(watchlists)
        .set(set)
        .where(and(eq(watchlists.userId, userId), eq(watchlists.symbol, symbol)));
      return { ok: true as const, symbol, updated: true as const };
    }),

  /**
   * 开启「每日 A股简报」(opt-in)：为该用户建/重置两条定时——盘前 08:30 /
   * 盘后 15:30（Asia/Shanghai）。幂等：先清旧再建新。简报由 scheduled-runner
   * 的 dispatch 分支识别 intent 哨兵 → briefing-service → notify inbox。
   */
  enableDailyBriefing: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    await cancelBriefingSchedules(ctx.db, userId);
    const now = new Date();
    await ctx.db.insert(scheduledTasks).values([
      {
        externalId: newExternalId('scheduledTask'),
        userId,
        intent: PREMARKET_BRIEFING_INTENT,
        repeatType: 'daily',
        nextRunAt: nextDailyUtc(0, 30, now), // 08:30 Asia/Shanghai
        timezone: 'Asia/Shanghai',
        description: 'A股盘前简报',
      },
      {
        externalId: newExternalId('scheduledTask'),
        userId,
        intent: POSTMARKET_BRIEFING_INTENT,
        repeatType: 'daily',
        nextRunAt: nextDailyUtc(7, 30, now), // 15:30 Asia/Shanghai
        timezone: 'Asia/Shanghai',
        description: 'A股盘后复盘',
      },
    ]);
    return { ok: true as const, enabled: true as const };
  }),

  /** 关闭「每日 A股简报」：删除该用户两条简报定时。 */
  disableDailyBriefing: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    await cancelBriefingSchedules(ctx.db, userId);
    return { ok: true as const, enabled: false as const };
  }),

  /** 当前是否已开启每日简报。 */
  briefingStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({ id: scheduledTasks.id })
      .from(scheduledTasks)
      .where(
        and(eq(scheduledTasks.userId, userId), inArray(scheduledTasks.intent, BRIEFING_INTENTS)),
      );
    return { enabled: rows.length > 0 };
  }),
});
