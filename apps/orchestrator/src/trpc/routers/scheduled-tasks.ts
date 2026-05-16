/**
 * Phase 16b — scheduled tasks tRPC router.
 *
 * CRUD for cron-style triggers. The runner (agent/scheduled-runner.ts)
 * scans the table on a 60s interval and fires due triggers; this
 * router just lets users create / list / toggle / delete entries.
 *
 * Codex follow-up — `pause` and `resume` are gone. The SPA always
 * used `toggle` (a single atomic flip) so the separate verbs were
 * dead code; the new sticking points around the 'failed' / 'running'
 * states meant they'd need status guards anyway. `toggle` handles
 * all of it: rejects 'completed' / 'running', flips
 * active ↔ paused, and lets 'failed' one-shot rows retry by going
 * back to 'active'.
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, between, desc, eq, gte, lte, or } from 'drizzle-orm';
// See scheduled-runner.ts for why we default-import rrule + destructure.
// Same CJS-vs-ESM interop story.
import rrule from 'rrule';
import { z } from 'zod';
import { scheduledTasks } from '../../db/schema/scheduled-tasks.js';

const { rrulestr } = rrule as { rrulestr: (s: string) => unknown };
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

const REPEAT_TYPES = ['once', 'daily', 'weekly', 'monthly'] as const;

async function requireUserId(
  ctx: { db: typeof import('../../db/client.js').db; userId: string },
): Promise<number> {
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

/**
 * Phase 26A — basic RFC 5545 sanity check before persisting. Catches
 * the obvious typos (missing FREQ, junk text) without claiming to be
 * a full parser; rrulestr throws on more nuanced violations and
 * those throws also fail validation. NULL / empty is allowed (means
 * "no rrule, fall back to repeat_type").
 */
function validateRrule(input: string | null | undefined): string | null {
  if (!input || input.trim().length === 0) return null;
  const trimmed = input.trim();
  if (trimmed.length > 255) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'rrule 过长（最多 255 字符）',
    });
  }
  try {
    // rrulestr supports both bare RRULE strings and full DTSTART+RRULE
    // multi-line forms; either is acceptable here.
    rrulestr(trimmed);
    return trimmed;
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `rrule 格式错误：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export const scheduledTasksRouter = router({
  /**
   * Phase 26A — accepts an optional date-range filter for the
   * FullCalendar `datesSet` callback. When `rangeStart` / `rangeEnd`
   * are provided, returns rows whose `next_run_at` falls inside the
   * window OR whose last_run_at falls inside (so recently-fired
   * historical events render too). When both are absent, returns all
   * rows for the user (legacy list view path).
   */
  list: protectedProcedure
    .input(
      z
        .object({
          rangeStart: z.string().datetime().optional(),
          rangeEnd: z.string().datetime().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const rangeStart = input?.rangeStart ? new Date(input.rangeStart) : null;
      const rangeEnd = input?.rangeEnd ? new Date(input.rangeEnd) : null;
      const baseFilter = eq(scheduledTasks.userId, userId);
      const whereClause =
        rangeStart && rangeEnd
          ? and(
              baseFilter,
              or(
                between(scheduledTasks.nextRunAt, rangeStart, rangeEnd),
                and(
                  gte(scheduledTasks.lastRunAt, rangeStart),
                  lte(scheduledTasks.lastRunAt, rangeEnd),
                ),
              ),
            )
          : baseFilter;
      const rows = await ctx.db
        .select({
          externalId: scheduledTasks.externalId,
          intent: scheduledTasks.intent,
          description: scheduledTasks.description,
          repeatType: scheduledTasks.repeatType,
          rrule: scheduledTasks.rrule,
          durationMinutes: scheduledTasks.durationMinutes,
          timezone: scheduledTasks.timezone,
          nextRunAt: scheduledTasks.nextRunAt,
          lastRunAt: scheduledTasks.lastRunAt,
          lastTaskId: scheduledTasks.lastTaskId,
          status: scheduledTasks.status,
          // Codex P1 — last_run_status + last_error so the SPA can
          // distinguish "fired successfully" vs "fired but dispatch
          // threw" and show the error in a tooltip.
          lastRunStatus: scheduledTasks.lastRunStatus,
          lastError: scheduledTasks.lastError,
          createdAt: scheduledTasks.createdAt,
        })
        .from(scheduledTasks)
        .where(whereClause)
        .orderBy(desc(scheduledTasks.createdAt));
      return rows.map((r) => ({
        scheduledTaskId: r.externalId,
        intent: r.intent,
        description: r.description,
        repeatType: r.repeatType,
        rrule: r.rrule,
        durationMinutes: r.durationMinutes,
        timezone: r.timezone,
        nextRunAt: r.nextRunAt,
        lastRunAt: r.lastRunAt,
        status: r.status,
        lastRunStatus: r.lastRunStatus,
        lastError: r.lastError,
        createdAt: r.createdAt,
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        intent: z.string().trim().min(1).max(2000),
        repeatType: z.enum(REPEAT_TYPES),
        // ISO 8601 timestamp. The SPA always renders the user's local
        // time and converts on submit; the server stores UTC.
        scheduledAt: z.string().datetime(),
        // Phase 26A — optional fields. rrule overrides repeatType in
        // the runner when set; durationMinutes governs the visual
        // block height on calendar grids; timezone is reserved for
        // future DST-aware rrule expansion.
        rrule: z.string().max(255).optional().nullable(),
        durationMinutes: z.number().int().positive().max(60 * 24).optional(),
        timezone: z.string().max(64).optional(),
        // Phase 26B polish — optional human-readable annotation
        // shown in the event-detail popover. Never reaches the agent.
        description: z.string().max(2000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const nextRun = new Date(input.scheduledAt);
      if (Number.isNaN(nextRun.getTime())) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'scheduledAt must be a valid datetime',
        });
      }
      // Reject scheduled times in the past — usually means the user's
      // clock skewed or they picked a time that already passed during
      // form fill. The runner would fire it immediately on the next
      // tick, which is rarely what they want; surface the rejection
      // so they can re-pick.
      if (nextRun.getTime() < Date.now() - 60_000) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '执行时间已过去，请重新选择',
        });
      }
      const rrule = validateRrule(input.rrule);
      const externalId = newExternalId('scheduledTask');
      await ctx.db.insert(scheduledTasks).values({
        externalId,
        userId,
        intent: input.intent,
        repeatType: input.repeatType,
        nextRunAt: nextRun,
        status: 'active',
        ...(rrule ? { rrule } : {}),
        ...(input.durationMinutes !== undefined
          ? { durationMinutes: input.durationMinutes }
          : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        ...(input.description !== undefined && input.description !== null
          ? { description: input.description }
          : {}),
      });
      return { scheduledTaskId: externalId };
    }),

  /**
   * Phase 26A — update an existing scheduled task. Used by the
   * FullCalendar `eventDrop` (drag to a new time/date) and
   * `eventResize` (drag the bottom edge to change duration)
   * callbacks, and by the full edit modal.
   *
   * Every field except scheduledTaskId is optional — caller sends
   * only what changed. Ownership is gated by userId. Status guards:
   * the runner's atomic claim (status='running') is respected — we
   * reject updates while a dispatch is in flight to avoid racing
   * the restore-to-active write.
   */
  update: protectedProcedure
    .input(
      z.object({
        scheduledTaskId: z.string().min(1),
        intent: z.string().trim().min(1).max(2000).optional(),
        repeatType: z.enum(REPEAT_TYPES).optional(),
        scheduledAt: z.string().datetime().optional(),
        rrule: z.string().max(255).optional().nullable(),
        durationMinutes: z.number().int().positive().max(60 * 24).optional(),
        timezone: z.string().max(64).optional(),
        // Phase 26B polish — explicit `null` clears the field.
        description: z.string().max(2000).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({ status: scheduledTasks.status })
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'scheduled task not found' });
      }
      if (row.status === 'running') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该定时任务正在执行中，请稍后再试',
        });
      }
      // Build the set object only with provided fields so we don't
      // accidentally clobber unspecified columns with `undefined`.
      const updates: Partial<typeof scheduledTasks.$inferInsert> = {};
      if (input.intent !== undefined) updates.intent = input.intent;
      if (input.repeatType !== undefined) updates.repeatType = input.repeatType;
      if (input.scheduledAt !== undefined) {
        const next = new Date(input.scheduledAt);
        if (Number.isNaN(next.getTime())) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'scheduledAt must be a valid datetime',
          });
        }
        updates.nextRunAt = next;
      }
      if (input.rrule !== undefined) {
        // Allow explicit `null` to clear the rrule. validateRrule
        // returns null for empty input; setting it to null in the
        // db means "fall back to repeat_type".
        updates.rrule = validateRrule(input.rrule);
      }
      if (input.durationMinutes !== undefined) {
        updates.durationMinutes = input.durationMinutes;
      }
      if (input.timezone !== undefined) updates.timezone = input.timezone;
      if (input.description !== undefined) updates.description = input.description;
      if (Object.keys(updates).length === 0) {
        return { ok: true as const, noop: true as const };
      }
      const result = await ctx.db
        .update(scheduledTasks)
        .set(updates)
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
            // Conditional `status` so we don't trample a row the
            // runner just claimed mid-call.
            eq(scheduledTasks.status, row.status),
          ),
        );
      const affected = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      if (affected === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该定时任务状态已变化，请刷新后重试',
        });
      }
      return { ok: true as const };
    }),

  /**
   * Phase 26A — "立即执行一次" (run now). Sets next_run_at to NOW so
   * the next runner tick (≤60s) picks it up. Doesn't change the
   * schedule itself — a recurring task continues firing on its
   * regular cadence after this immediate fire. For one-shot rows in
   * 'completed' / 'failed' status, refuses: those need to be
   * recreated, not re-fired (avoids surprising the user with a fire
   * of a task they thought was done).
   *
   * Implementation note: rather than calling the dispatcher inline
   * (which would couple this router to the task-creation pipeline),
   * we just nudge next_run_at and let the existing runner pick it
   * up. Worst case the user waits up to 60s for the next tick —
   * acceptable for an explicit "run now" affordance.
   */
  runNow: protectedProcedure
    .input(z.object({ scheduledTaskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({ status: scheduledTasks.status })
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'scheduled task not found' });
      }
      if (row.status === 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '一次性任务已完成，无法重新执行。请新建一个定时任务。',
        });
      }
      if (row.status === 'running') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该定时任务正在执行中',
        });
      }
      // Allow paused / failed rows — flipping them to active +
      // nextRunAt=NOW lets the user pick a stalled task back up
      // without a multi-step pause/resume + reschedule dance.
      const now = new Date();
      await ctx.db
        .update(scheduledTasks)
        .set({ status: 'active', nextRunAt: now })
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        );
      return { ok: true as const, nextRunAt: now };
    }),

  delete: protectedProcedure
    .input(z.object({ scheduledTaskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const result = await ctx.db
        .delete(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        );
      if ((result as unknown as { affectedRows?: number }).affectedRows === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'scheduled task not found' });
      }
      return { ok: true as const };
    }),

  // Phase 5a — single-call toggle for the SPA list view. Reads the
  // current status and flips active ↔ paused atomically. Completed
  // schedules (repeat='once' that already fired) can't be toggled
  // back on — that would re-fire a one-shot job; surface an error
  // so the SPA can show "已完成，无法切换" instead of silently
  // re-activating a stale schedule.
  toggle: protectedProcedure
    .input(z.object({ scheduledTaskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const [row] = await ctx.db
        .select({ status: scheduledTasks.status })
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'scheduled task not found' });
      }
      if (row.status === 'completed') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '一次性任务已完成，无法重新启用。请新建一个定时任务。',
        });
      }
      // Codex P5 follow-up — `running` is the transient claim state
      // owned by the runner. Toggling while a dispatch is in flight
      // would race with the runner's restore-to-active write. Reject
      // and ask the user to retry shortly.
      if (row.status === 'running') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该定时任务正在执行中，请稍后再试',
        });
      }
      // Atomic flip via WHERE status=? so a parallel runner claim
      // can't sneak between our read and our write. If the conditional
      // update finds nothing (status moved to running mid-call), we
      // fall through to the same "执行中" error so the SPA shows a
      // consistent message instead of "succeeded but nothing changed".
      const nextStatus = row.status === 'active' ? 'paused' : 'active';
      const result = await ctx.db
        .update(scheduledTasks)
        .set({ status: nextStatus })
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
            eq(scheduledTasks.status, row.status),
          ),
        );
      const affected = (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
      if (affected === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '该定时任务状态已变化，请刷新后重试',
        });
      }
      return { ok: true as const, status: nextStatus };
    }),
});
