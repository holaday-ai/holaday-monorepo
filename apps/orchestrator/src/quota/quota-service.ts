/**
 * Quota service — gates task creation against the active billing
 * period's allowance and tracks consumption.
 *
 * Two responsibilities:
 *
 *   1. **Period bookkeeping.** For free users the period is a UTC
 *      day; for paid users it's a UTC calendar month. Each period has
 *      one row in `task_quotas`. `getOrCreateActiveQuota` materialises
 *      the row lazily — first task of the period spawns it.
 *
 *   2. **Consume-with-gate.** `tryConsume` is called from
 *      `tasks.create` BEFORE the task row is inserted. It atomically
 *      decrements the right counter (bonus first, then regular) and
 *      throws when the user is over the limit. Bonus-first means
 *      first-month gifts and add-on packs burn before regular usage,
 *      so the user sees their paid top-ups land first — the quota
 *      summary in the UI never has to explain why a $1.50 add-on
 *      seemingly didn't help.
 *
 * Concurrency limit (1 for Free/Basic, 3 for Pro) is enforced by
 * `getActiveTaskCount` + a comparison against `PLAN_CATALOGUE` —
 * tasks.create reads both before deciding whether to insert.
 *
 * Race window: between `tryConsume` and the task insert, a parallel
 * call could race the quota row. We accept that for MVP; the
 * worst-case is one extra task slipping through under heavy
 * concurrent click-spam, which is bounded by the concurrency cap
 * itself. A future hardening would push the increment into the
 * tasks.insert transaction.
 */

import {
  ADDON_PACK_CATALOGUE,
  PLAN_CATALOGUE,
  type AddonPackId,
  type PlanId,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { taskQuotas, type TaskQuota } from '../db/schema/task-quotas.js';
import { tasks } from '../db/schema/tasks.js';

export type QuotaPeriod = 'day' | 'month';

export interface QuotaSnapshot {
  readonly period: QuotaPeriod;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  /** Plan-defined allowance, excluding bonus. */
  readonly tasksLimit: number;
  /** Plan-defined Opus sub-quota (Pro only), excluding bonus. */
  readonly opusLimit: number | null;
  readonly tasksUsed: number;
  readonly opusUsed: number;
  readonly bonusTasks: number;
  readonly bonusOpus: number;
  /**
   * Convenience: total tasks remaining (limit + bonus − used). Never
   * negative; clamps at 0 so the UI doesn't have to.
   */
  readonly tasksRemaining: number;
  readonly opusRemaining: number | null;
}

export type ConsumeReason =
  | 'daily_limit'
  | 'monthly_limit'
  | 'opus_limit'
  | 'opus_not_available';

/**
 * Half-open interval [start, end) covering the given moment for the
 * given plan period. UTC throughout — we never want a timezone shift
 * to award an extra day of free usage to a user whose browser is set
 * to Pacific.
 */
export function computePeriodBounds(
  period: QuotaPeriod,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (period === 'day') {
    return {
      start: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
      end: new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0)),
    };
  }
  return {
    start: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0)),
  };
}

export class QuotaService {
  constructor(private readonly db: DB) {}

  /**
   * Find or create the active quota row for this user. Creates with
   * zero counters; first-month bonus / add-on top-ups are handled
   * separately by `addBonus`.
   */
  async getOrCreateActiveQuota(
    userId: number,
    plan: PlanId,
  ): Promise<TaskQuota> {
    const period: QuotaPeriod = PLAN_CATALOGUE[plan].tasks.period;
    const { start, end } = computePeriodBounds(period);

    // Drizzle's INSERT ... ON DUPLICATE KEY UPDATE shape lets us
    // upsert without a SELECT-then-INSERT race. The duplicate-key
    // path is a no-op (sets period_start to itself) so the row's
    // counters survive a concurrent caller hitting the same period.
    await this.db
      .insert(taskQuotas)
      .values({
        userId,
        period,
        periodStart: start,
        periodEnd: end,
        tasksUsed: 0,
        opusUsed: 0,
        bonusTasks: 0,
        bonusOpus: 0,
      })
      .onDuplicateKeyUpdate({ set: { periodStart: sql`period_start` } });

    const [row] = await this.db
      .select()
      .from(taskQuotas)
      .where(and(eq(taskQuotas.userId, userId), eq(taskQuotas.periodStart, start)))
      .limit(1);
    if (!row) {
      throw new Error('quota row vanished after upsert — should never happen');
    }
    return row;
  }

  async snapshot(userId: number, plan: PlanId): Promise<QuotaSnapshot> {
    const def = PLAN_CATALOGUE[plan];
    const row = await this.getOrCreateActiveQuota(userId, plan);
    const tasksLimit = def.tasks.count;
    const opusLimit = def.tasks.opus ?? null;
    const tasksRemaining = Math.max(
      0,
      tasksLimit + row.bonusTasks - row.tasksUsed,
    );
    const opusRemaining =
      opusLimit == null ? null : Math.max(0, opusLimit + row.bonusOpus - row.opusUsed);
    return {
      period: row.period as QuotaPeriod,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      tasksLimit,
      opusLimit,
      tasksUsed: row.tasksUsed,
      opusUsed: row.opusUsed,
      bonusTasks: row.bonusTasks,
      bonusOpus: row.bonusOpus,
      tasksRemaining,
      opusRemaining,
    };
  }

  /**
   * Atomically consume one task slot for `userId` on the active
   * period's row. Returns `{ ok: true }` on success, or `{ ok: false,
   * reason }` when over the limit (caller surfaces a typed error to
   * the SPA so the UI can render the right upsell copy).
   *
   * Bonus-first ordering: if `bonusTasks` (or `bonusOpus` for opus
   * tasks) is positive we burn that pool first. Only when bonus is
   * exhausted do we increment the regular `tasksUsed` / `opusUsed`
   * counter.
   *
   * Pro plan can downgrade an Opus-routed task to Sonnet when the
   * Opus sub-quota is exhausted (see selectModelAndEffort). When the
   * caller knows it has done that, it passes `isOpus: false` here so
   * the regular pool is the one that gets consumed.
   */
  async tryConsume(
    userId: number,
    plan: PlanId,
    isOpus: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: ConsumeReason }> {
    const def = PLAN_CATALOGUE[plan];
    const row = await this.getOrCreateActiveQuota(userId, plan);

    if (isOpus) {
      if (def.tasks.opus == null) {
        return { ok: false, reason: 'opus_not_available' };
      }
      const used = row.opusUsed;
      const limit = def.tasks.opus + row.bonusOpus;
      if (used >= limit) {
        return { ok: false, reason: 'opus_limit' };
      }
      // Bonus-first: decrement bonus_opus when it's positive,
      // otherwise increment opus_used. SQL-side increments protect
      // against the read-then-write race within reason.
      if (row.bonusOpus > 0) {
        await this.db
          .update(taskQuotas)
          .set({ bonusOpus: sql`${taskQuotas.bonusOpus} - 1` })
          .where(
            and(
              eq(taskQuotas.id, row.id),
              sql`${taskQuotas.bonusOpus} > 0`,
            ),
          );
      } else {
        await this.db
          .update(taskQuotas)
          .set({ opusUsed: sql`${taskQuotas.opusUsed} + 1` })
          .where(eq(taskQuotas.id, row.id));
      }
      return { ok: true };
    }

    const totalAvailable = def.tasks.count + row.bonusTasks;
    if (row.tasksUsed >= totalAvailable) {
      return {
        ok: false,
        reason: def.tasks.period === 'day' ? 'daily_limit' : 'monthly_limit',
      };
    }
    if (row.bonusTasks > 0) {
      await this.db
        .update(taskQuotas)
        .set({ bonusTasks: sql`${taskQuotas.bonusTasks} - 1` })
        .where(
          and(eq(taskQuotas.id, row.id), sql`${taskQuotas.bonusTasks} > 0`),
        );
    } else {
      await this.db
        .update(taskQuotas)
        .set({ tasksUsed: sql`${taskQuotas.tasksUsed} + 1` })
        .where(eq(taskQuotas.id, row.id));
    }
    return { ok: true };
  }

  /**
   * Roll back one consumption — used when a task creation begins
   * but fails (e.g. the supercar gate denies it after we've already
   * burned the slot). Best-effort: a failed rollback never throws,
   * since it's already a degraded path.
   */
  async refund(userId: number, plan: PlanId, isOpus: boolean): Promise<void> {
    try {
      const row = await this.getOrCreateActiveQuota(userId, plan);
      if (isOpus) {
        if (row.opusUsed > 0) {
          await this.db
            .update(taskQuotas)
            .set({ opusUsed: sql`${taskQuotas.opusUsed} - 1` })
            .where(
              and(eq(taskQuotas.id, row.id), sql`${taskQuotas.opusUsed} > 0`),
            );
        } else {
          await this.db
            .update(taskQuotas)
            .set({ bonusOpus: sql`${taskQuotas.bonusOpus} + 1` })
            .where(eq(taskQuotas.id, row.id));
        }
      } else {
        if (row.tasksUsed > 0) {
          await this.db
            .update(taskQuotas)
            .set({ tasksUsed: sql`${taskQuotas.tasksUsed} - 1` })
            .where(
              and(eq(taskQuotas.id, row.id), sql`${taskQuotas.tasksUsed} > 0`),
            );
        } else {
          await this.db
            .update(taskQuotas)
            .set({ bonusTasks: sql`${taskQuotas.bonusTasks} + 1` })
            .where(eq(taskQuotas.id, row.id));
        }
      }
    } catch {
      // refund is best-effort.
    }
  }

  /**
   * How many of this user's tasks are still in-flight. Counts
   * `executing`, `awaiting_user`, and `paused` — the three states
   * where a task is occupying server resources (browser session,
   * model context). `pending` is excluded since it's the brief
   * window before the executor picks the task up.
   */
  async getActiveTaskCount(userIdInternal: number): Promise<number> {
    const ACTIVE_STATUSES = ['executing', 'awaiting_user', 'paused'];
    const [row] = await this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(tasks)
      .where(
        and(eq(tasks.userId, userIdInternal), inArray(tasks.status, ACTIVE_STATUSES)),
      );
    return Number(row?.c ?? 0);
  }

  /**
   * Award a first-month bonus on the active quota row. Idempotent
   * via the `task_quotas` unique key: calling twice for the same
   * (user, period) just adds twice. Caller (payment.captureOrder)
   * must guard against duplicate bonus grants — a returning user
   * should only get the bonus once per upgrade event.
   */
  async grantFirstMonthBonus(userId: number, plan: PlanId): Promise<void> {
    const def = PLAN_CATALOGUE[plan];
    const bonus = def.tasks.firstMonthBonus ?? 0;
    if (bonus <= 0) return;
    const row = await this.getOrCreateActiveQuota(userId, plan);
    await this.db
      .update(taskQuotas)
      .set({ bonusTasks: sql`${taskQuotas.bonusTasks} + ${bonus}` })
      .where(eq(taskQuotas.id, row.id));
  }

  /**
   * Apply an add-on pack purchase. Tops up bonus on the active
   * quota row. The pack's eligibility (Basic vs Pro) is enforced at
   * order creation, not here — this method assumes the caller has
   * already validated.
   */
  async applyAddonPack(
    userId: number,
    plan: PlanId,
    packId: AddonPackId,
  ): Promise<void> {
    const pack = ADDON_PACK_CATALOGUE[packId];
    if (!pack) return;
    const row = await this.getOrCreateActiveQuota(userId, plan);
    await this.db
      .update(taskQuotas)
      .set({
        bonusTasks: sql`${taskQuotas.bonusTasks} + ${pack.tasks}`,
        bonusOpus: sql`${taskQuotas.bonusOpus} + ${pack.opus}`,
      })
      .where(eq(taskQuotas.id, row.id));
  }
}

/**
 * Concurrency limit lookup. Centralised so the gate, the UI hint,
 * and the upsell copy never disagree.
 */
export function getConcurrencyLimit(plan: PlanId): number {
  return PLAN_CATALOGUE[plan].concurrency;
}

/**
 * Translate a denied-consume reason into a user-facing TRPCError.
 * Keeps the wording in one place so the SPA can rely on `code` for
 * routing (TOO_MANY_REQUESTS for limit hits, FORBIDDEN for plan
 * mismatch).
 */
export function quotaErrorFor(reason: ConsumeReason): TRPCError {
  switch (reason) {
    case 'daily_limit':
      return new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: '今天的免费额度已用完，明天再来或升级基础版',
      });
    case 'monthly_limit':
      return new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: '本月额度已用完，购买加量包或升级专业版',
      });
    case 'opus_limit':
      return new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: '本月 Opus 额度已用完，已自动切换为 Sonnet',
      });
    case 'opus_not_available':
      return new TRPCError({
        code: 'FORBIDDEN',
        message: 'Opus 模型仅专业版可用',
      });
  }
}
