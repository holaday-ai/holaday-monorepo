/**
 * Phase 16b — scheduled tasks tRPC router.
 *
 * CRUD for cron-style triggers. The runner (agent/scheduled-runner.ts)
 * scans the table on a 60s interval and fires due triggers; this
 * router just lets users create/list/pause/resume/delete entries.
 */

import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { scheduledTasks } from '../../db/schema/scheduled-tasks.js';
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

export const scheduledTasksRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .select({
        externalId: scheduledTasks.externalId,
        intent: scheduledTasks.intent,
        repeatType: scheduledTasks.repeatType,
        nextRunAt: scheduledTasks.nextRunAt,
        lastRunAt: scheduledTasks.lastRunAt,
        status: scheduledTasks.status,
        createdAt: scheduledTasks.createdAt,
      })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.userId, userId))
      .orderBy(desc(scheduledTasks.createdAt));
    return rows.map((r) => ({
      scheduledTaskId: r.externalId,
      intent: r.intent,
      repeatType: r.repeatType,
      nextRunAt: r.nextRunAt,
      lastRunAt: r.lastRunAt,
      status: r.status,
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
      const externalId = newExternalId('scheduledTask');
      await ctx.db.insert(scheduledTasks).values({
        externalId,
        userId,
        intent: input.intent,
        repeatType: input.repeatType,
        nextRunAt: nextRun,
        status: 'active',
      });
      return { scheduledTaskId: externalId };
    }),

  pause: protectedProcedure
    .input(z.object({ scheduledTaskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const result = await ctx.db
        .update(scheduledTasks)
        .set({ status: 'paused' })
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

  resume: protectedProcedure
    .input(z.object({ scheduledTaskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const result = await ctx.db
        .update(scheduledTasks)
        .set({ status: 'active' })
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
      const nextStatus = row.status === 'active' ? 'paused' : 'active';
      await ctx.db
        .update(scheduledTasks)
        .set({ status: nextStatus })
        .where(
          and(
            eq(scheduledTasks.externalId, input.scheduledTaskId),
            eq(scheduledTasks.userId, userId),
          ),
        );
      return { ok: true as const, status: nextStatus };
    }),
});
