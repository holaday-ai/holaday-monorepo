import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { readAffectedRows, readInsertId } from '../../db/mysql-result.js';
import {
  plannedTaskItems,
  plannedTaskOccurrenceOverrides,
  plannedTaskRuns,
  plannedTasks,
} from '../../db/schema/planned-tasks.js';
import { users } from '../../db/schema/users.js';
import {
  plannedCalendarInputSchema,
  plannedEndsOnInputSchema,
  plannedTaskCreateInputSchema,
  resolveRequestedSchedule,
  validatePlannedRepeatRule,
} from '../../planned/planned-task-input.js';
import {
  assertPlannedEndsOnScope,
  exclusiveUtcToEndDate,
  resolvePlannedEndsAt,
} from '../../planned/planned-task-dates.js';
import {
  encodeOccurrenceContent,
  parseOccurrenceContent,
  preparePlannedTaskCreate,
} from '../../planned/planned-executor.js';
import {
  expandPlannedOccurrences,
  plannedTaskCanRunNow,
  type PlannedRepeatType,
} from '../../planned/planned-task-rules.js';
import { queuePlannedRun } from '../../planned/planned-runner.js';
import type { DB } from '../../db/client.js';
import { protectedProcedure, router } from '../trpc.js';

const planIdInput = z.object({ plannedTaskId: z.string().min(1) });
type DBTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

async function requireUserId(ctx: {
  db: DB;
  userId: string;
}): Promise<number> {
  const [user] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  return user.id;
}

async function loadOwnedPlan(db: DB, userId: number, externalId: string) {
  const [plan] = await db
    .select()
    .from(plannedTasks)
    .where(and(eq(plannedTasks.externalId, externalId), eq(plannedTasks.userId, userId)))
    .limit(1);
  if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
  return plan;
}

async function replacePlanItems(
  tx: DB | DBTransaction,
  plannedTaskId: number,
  items: readonly string[],
): Promise<void> {
  await tx.delete(plannedTaskItems).where(eq(plannedTaskItems.plannedTaskId, plannedTaskId));
  if (items.length === 0) return;
  await tx.insert(plannedTaskItems).values(
    items.map((instruction, seq) => ({
      externalId: newExternalId('plannedTaskItem'),
      plannedTaskId,
      seq,
      instruction,
      enabled: true,
    })),
  );
}

function planView(plan: typeof plannedTasks.$inferSelect, items: readonly string[]) {
  return {
    plannedTaskId: plan.externalId,
    title: plan.title,
    instruction: plan.instruction,
    notes: plan.notes,
    scope: plan.scope,
    items,
    itemCount: plan.itemCount,
    repeatType: plan.repeatType,
    rrule: plan.rrule,
    firstRunAt: plan.firstRunAt,
    endsAt: plan.endsAt,
    endsOn: plan.endsAt ? exclusiveUtcToEndDate(plan.endsAt, plan.timezone) : null,
    nextRunAt: plan.nextRunAt,
    timezone: plan.timezone,
    reminderMinutes: plan.reminderMinutes,
    status: plan.status,
    lastRunAt: plan.lastRunAt,
    lastRunStatus: plan.lastRunStatus,
    lastError: plan.lastError,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

async function loadItemsByPlan(db: DB, planIds: readonly number[]) {
  const byPlan = new Map<number, string[]>();
  if (planIds.length === 0) return byPlan;
  const rows = await db
    .select({
      plannedTaskId: plannedTaskItems.plannedTaskId,
      seq: plannedTaskItems.seq,
      instruction: plannedTaskItems.instruction,
    })
    .from(plannedTaskItems)
    .where(and(inArray(plannedTaskItems.plannedTaskId, [...planIds]), eq(plannedTaskItems.enabled, true)))
    .orderBy(plannedTaskItems.plannedTaskId, plannedTaskItems.seq);
  for (const row of rows) {
    const bucket = byPlan.get(row.plannedTaskId) ?? [];
    bucket.push(row.instruction);
    byPlan.set(row.plannedTaskId, bucket);
  }
  return byPlan;
}

export const plannedTasksRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(['active', 'paused', 'failed', 'completed', 'archived']).optional(),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const where = input?.status
        ? and(eq(plannedTasks.userId, userId), eq(plannedTasks.status, input.status))
        : and(eq(plannedTasks.userId, userId), ne(plannedTasks.status, 'archived'));
      const plans = await ctx.db
        .select()
        .from(plannedTasks)
        .where(where)
        .orderBy(desc(plannedTasks.createdAt))
        .limit(input?.limit ?? 100);
      const itemsByPlan = await loadItemsByPlan(
        ctx.db,
        plans.map((plan) => plan.id),
      );
      return plans.map((plan) => planView(plan, itemsByPlan.get(plan.id) ?? []));
    }),

  calendar: protectedProcedure.input(plannedCalendarInputSchema).query(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const rangeStart = new Date(input.rangeStart);
    const rangeEnd = new Date(input.rangeEnd);
    const plans = await ctx.db
      .select()
      .from(plannedTasks)
      .where(
        and(
          eq(plannedTasks.userId, userId),
          ne(plannedTasks.status, 'archived'),
          lt(plannedTasks.firstRunAt, rangeEnd),
          or(isNull(plannedTasks.endsAt), gt(plannedTasks.endsAt, rangeStart)),
        ),
      )
      .orderBy(plannedTasks.firstRunAt);
    const planIds = plans.map((plan) => plan.id);
    const overrides =
      planIds.length === 0
        ? []
        : await ctx.db
            .select()
            .from(plannedTaskOccurrenceOverrides)
            .where(inArray(plannedTaskOccurrenceOverrides.plannedTaskId, planIds));
    const overridesByPlan = new Map<number, typeof overrides>();
    for (const override of overrides) {
      const bucket = overridesByPlan.get(override.plannedTaskId) ?? [];
      bucket.push(override);
      overridesByPlan.set(override.plannedTaskId, bucket);
    }
    return plans.flatMap((plan) => {
      const planOverrides = overridesByPlan.get(plan.id) ?? [];
      const overrideByOriginal = new Map(
        planOverrides.map((override) => [override.originalScheduledFor.getTime(), override]),
      );
      return expandPlannedOccurrences({
        plannedTaskId: plan.externalId,
        firstRunAt: plan.firstRunAt,
        endsAt: plan.endsAt,
        repeatType: plan.repeatType as PlannedRepeatType,
        rrule: plan.rrule,
        rangeStart,
        rangeEnd,
        exceptions: planOverrides.map((override) => ({
          originalScheduledFor: override.originalScheduledFor,
          action: override.action as 'rescheduled' | 'skipped',
          scheduledFor: override.scheduledFor,
        })),
      }).map((occurrence) => {
        const content = parseOccurrenceContent(
          overrideByOriginal.get(occurrence.originalScheduledFor.getTime())?.instruction ?? null,
        );
        return {
          ...occurrence,
          title: content?.title ?? plan.title,
          status: plan.status,
          repeatType: plan.repeatType,
          itemCount: content?.items.length ?? plan.itemCount,
          timezone: plan.timezone,
        };
      });
    });
  }),

  detail: protectedProcedure
    .input(planIdInput.extend({ originalScheduledFor: z.string().datetime().optional() }))
    .query(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
    const items = await ctx.db
      .select({ instruction: plannedTaskItems.instruction })
      .from(plannedTaskItems)
      .where(and(eq(plannedTaskItems.plannedTaskId, plan.id), eq(plannedTaskItems.enabled, true)))
      .orderBy(plannedTaskItems.seq);
    const base = planView(
      plan,
      items.map((item) => item.instruction),
    );
    if (!input.originalScheduledFor) return base;
    const [override] = await ctx.db
      .select({ instruction: plannedTaskOccurrenceOverrides.instruction })
      .from(plannedTaskOccurrenceOverrides)
      .where(
        and(
          eq(plannedTaskOccurrenceOverrides.plannedTaskId, plan.id),
          eq(
            plannedTaskOccurrenceOverrides.originalScheduledFor,
            new Date(input.originalScheduledFor),
          ),
        ),
      )
      .limit(1);
    const content = parseOccurrenceContent(override?.instruction ?? null);
    return content
      ? {
          ...base,
          title: content.title,
          instruction: content.instruction,
          scope: content.items.length > 1 ? 'multiple' : 'single',
          items: content.items,
          itemCount: content.items.length,
        }
      : base;
  }),

  create: protectedProcedure.input(plannedTaskCreateInputSchema).mutation(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    let prepared: ReturnType<typeof preparePlannedTaskCreate>;
    let schedule: ReturnType<typeof resolveRequestedSchedule>;
    let endsAt: Date | null;
    try {
      prepared = preparePlannedTaskCreate(input);
      schedule = resolveRequestedSchedule({
        scheduledAt: input.scheduledAt,
        repeatType: input.repeatType,
        rrule: input.rrule,
      });
      endsAt = resolvePlannedEndsAt({
        repeatType: input.repeatType,
        endsOn: input.endsOn,
        timezone: input.timezone,
        firstEligibleRunAt: schedule.nextRunAt,
      });
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const externalId = newExternalId('plannedTask');
    await ctx.db.transaction(async (tx) => {
      const insert = await tx.insert(plannedTasks).values({
        externalId,
        userId,
        title: prepared.title,
        instruction: prepared.instruction,
        notes: input.notes ?? null,
        scope: prepared.scope,
        repeatType: input.repeatType,
        rrule: input.rrule,
        firstRunAt: schedule.firstRunAt,
        endsAt,
        nextRunAt: schedule.nextRunAt,
        timezone: input.timezone,
        reminderMinutes: input.reminderMinutes ?? null,
        status: 'active',
        itemCount: prepared.items.length,
      });
      await replacePlanItems(tx, readInsertId(insert), prepared.items);
    });
    return {
      plannedTaskId: externalId,
      nextRunAt: schedule.nextRunAt,
      adjusted: schedule.adjusted,
    };
  }),

  update: protectedProcedure
    .input(
      planIdInput.extend({
        title: z.string().trim().min(1).max(200).optional(),
        instruction: z.string().trim().max(4000).optional(),
        notes: z.string().trim().max(4000).nullable().optional(),
        items: z.array(z.string().trim().min(1).max(2000)).max(50).optional(),
        repeatType: z
          .enum(['once', 'daily', 'weekly', 'monthly', 'custom'])
          .optional(),
        scheduledAt: z.string().datetime().optional(),
        rrule: z.string().trim().max(255).nullable().optional(),
        timezone: z.string().trim().min(1).max(64).optional(),
        endsOn: plannedEndsOnInputSchema,
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 7).nullable().optional(),
        editScope: z.enum(['occurrence', 'future', 'series']).optional(),
        originalScheduledFor: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
      if (plan.status === 'running') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '任务正在启动，请稍后再编辑' });
      }
      if (plan.status === 'archived') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '已删除的规划任务不能编辑' });
      }
      const editScope = input.editScope ?? 'series';
      if (editScope !== 'series' && !input.originalScheduledFor) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '缺少重复任务的原始执行时间' });
      }
      try {
        assertPlannedEndsOnScope(editScope, input.endsOn);
        validatePlannedRepeatRule(
          (input.repeatType ?? plan.repeatType) as PlannedRepeatType,
          input.rrule !== undefined ? input.rrule : plan.rrule,
        );
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (editScope !== 'series' && plan.repeatType !== 'once') {
        const currentItems = await ctx.db
          .select({ instruction: plannedTaskItems.instruction })
          .from(plannedTaskItems)
          .where(
            and(eq(plannedTaskItems.plannedTaskId, plan.id), eq(plannedTaskItems.enabled, true)),
          )
          .orderBy(plannedTaskItems.seq);
        let prepared: ReturnType<typeof preparePlannedTaskCreate>;
        let schedule: ReturnType<typeof resolveRequestedSchedule>;
        try {
          prepared = preparePlannedTaskCreate({
            title: input.title ?? plan.title,
            instruction: input.instruction ?? plan.instruction,
            items: input.items ?? currentItems.map((item) => item.instruction),
          });
          schedule = resolveRequestedSchedule({
            scheduledAt: input.scheduledAt ?? input.originalScheduledFor!,
            repeatType: (input.repeatType ?? plan.repeatType) as PlannedRepeatType,
            rrule: input.rrule !== undefined ? input.rrule : plan.rrule,
          });
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const original = new Date(input.originalScheduledFor!);
        if (editScope === 'occurrence') {
          await ctx.db
            .insert(plannedTaskOccurrenceOverrides)
            .values({
              externalId: newExternalId('plannedTaskOverride'),
              plannedTaskId: plan.id,
              originalScheduledFor: original,
              action: 'rescheduled',
              scheduledFor: schedule.firstRunAt,
              instruction: encodeOccurrenceContent(prepared),
            })
            .onDuplicateKeyUpdate({
              set: {
                action: 'rescheduled',
                scheduledFor: schedule.firstRunAt,
                instruction: encodeOccurrenceContent(prepared),
              },
            });
          if (plan.nextRunAt?.getTime() === original.getTime()) {
            await ctx.db
              .update(plannedTasks)
              .set({ nextRunAt: schedule.firstRunAt, lastReminderRun: null })
              .where(eq(plannedTasks.id, plan.id));
          }
          return { ok: true as const, plannedTaskId: plan.externalId };
        }
        const nextRepeatType = (input.repeatType ?? plan.repeatType) as PlannedRepeatType;
        const nextTimezone = input.timezone ?? plan.timezone;
        let newSeriesEndsAt: Date | null;
        try {
          newSeriesEndsAt = resolvePlannedEndsAt({
            repeatType: nextRepeatType,
            endsOn: input.endsOn,
            existingEndsAt: plan.endsAt,
            existingTimezone: plan.timezone,
            timezone: nextTimezone,
            firstEligibleRunAt: schedule.nextRunAt,
          });
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const newPlanExternalId = newExternalId('plannedTask');
        await ctx.db.transaction(async (tx) => {
          const oldHasPendingOccurrence =
            plan.nextRunAt !== null && plan.nextRunAt.getTime() < original.getTime();
          await tx
            .update(plannedTasks)
            .set({
              endsAt: original,
              status: oldHasPendingOccurrence ? 'active' : 'completed',
              ...(!oldHasPendingOccurrence ? { nextRunAt: null } : {}),
            })
            .where(eq(plannedTasks.id, plan.id));
          const insert = await tx.insert(plannedTasks).values({
            externalId: newPlanExternalId,
            userId: plan.userId,
            title: prepared.title,
            instruction: prepared.instruction,
            notes: input.notes !== undefined ? input.notes : plan.notes,
            scope: prepared.scope,
            repeatType: nextRepeatType,
            rrule: input.rrule !== undefined ? input.rrule || null : plan.rrule,
            firstRunAt: schedule.firstRunAt,
            endsAt: newSeriesEndsAt,
            nextRunAt: schedule.nextRunAt,
            timezone: nextTimezone,
            reminderMinutes:
              input.reminderMinutes !== undefined
                ? input.reminderMinutes
                : plan.reminderMinutes,
            status: 'active',
            itemCount: prepared.items.length,
          });
          await replacePlanItems(tx, readInsertId(insert), prepared.items);
        });
        return { ok: true as const, plannedTaskId: newPlanExternalId };
      }
      const updates: Partial<typeof plannedTasks.$inferInsert> = {};
      let requestedSchedule: ReturnType<typeof resolveRequestedSchedule> | null = null;
      if (input.title !== undefined) updates.title = input.title;
      if (input.instruction !== undefined) updates.instruction = input.instruction;
      if (input.notes !== undefined) updates.notes = input.notes;
      if (input.repeatType !== undefined) updates.repeatType = input.repeatType;
      if (input.rrule !== undefined) updates.rrule = input.rrule || null;
      if (input.timezone !== undefined) updates.timezone = input.timezone;
      if (input.reminderMinutes !== undefined) {
        updates.reminderMinutes = input.reminderMinutes;
        updates.lastReminderRun = null;
      }
      if (input.scheduledAt !== undefined) {
        try {
          requestedSchedule = resolveRequestedSchedule({
            scheduledAt: input.scheduledAt,
            repeatType: (input.repeatType ?? plan.repeatType) as PlannedRepeatType,
            rrule: input.rrule !== undefined ? input.rrule : plan.rrule,
          });
          updates.firstRunAt = requestedSchedule.firstRunAt;
          updates.nextRunAt = requestedSchedule.nextRunAt;
          updates.status = 'active';
          updates.lastReminderRun = null;
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (
        input.endsOn !== undefined ||
        input.repeatType !== undefined ||
        input.timezone !== undefined ||
        requestedSchedule
      ) {
        try {
          updates.endsAt = resolvePlannedEndsAt({
            repeatType: (input.repeatType ?? plan.repeatType) as PlannedRepeatType,
            endsOn: input.endsOn,
            existingEndsAt: plan.endsAt,
            existingTimezone: plan.timezone,
            timezone: input.timezone ?? plan.timezone,
            firstEligibleRunAt:
              requestedSchedule?.nextRunAt ?? plan.nextRunAt ?? plan.firstRunAt,
          });
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await ctx.db.transaction(async (tx) => {
        if (Object.keys(updates).length > 0) {
          await tx.update(plannedTasks).set(updates).where(eq(plannedTasks.id, plan.id));
        }
        if (input.items !== undefined) {
          let prepared: ReturnType<typeof preparePlannedTaskCreate>;
          try {
            prepared = preparePlannedTaskCreate({
              title: input.title ?? plan.title,
              instruction: input.instruction ?? plan.instruction,
              items: input.items,
            });
          } catch (error) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          await tx
            .update(plannedTasks)
            .set({
              scope: prepared.scope,
              itemCount: prepared.items.length,
              instruction: prepared.instruction,
            })
            .where(eq(plannedTasks.id, plan.id));
          await replacePlanItems(tx, plan.id, prepared.items);
        }
      });
      return { ok: true as const };
    }),

  rescheduleOccurrence: protectedProcedure
    .input(
      planIdInput.extend({
        originalScheduledFor: z.string().datetime(),
        scheduledFor: z.string().datetime(),
        scope: z.enum(['occurrence', 'future', 'series']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
      const original = new Date(input.originalScheduledFor);
      const scheduledFor = new Date(input.scheduledFor);
      if (scheduledFor.getTime() < Date.now() - 60_000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '执行时间已过去，请重新选择' });
      }
      if (input.scope === 'occurrence' && plan.repeatType !== 'once') {
        await ctx.db
          .insert(plannedTaskOccurrenceOverrides)
          .values({
            externalId: newExternalId('plannedTaskOverride'),
            plannedTaskId: plan.id,
            originalScheduledFor: original,
            action: 'rescheduled',
            scheduledFor,
          })
          .onDuplicateKeyUpdate({
            set: { action: 'rescheduled', scheduledFor },
          });
        if (plan.nextRunAt?.getTime() === original.getTime()) {
          await ctx.db
            .update(plannedTasks)
            .set({ nextRunAt: scheduledFor, lastReminderRun: null })
            .where(eq(plannedTasks.id, plan.id));
        }
        return { ok: true as const, plannedTaskId: plan.externalId };
      }
      if (input.scope === 'future' && plan.repeatType !== 'once') {
        const items = await ctx.db
          .select({ instruction: plannedTaskItems.instruction })
          .from(plannedTaskItems)
          .where(and(eq(plannedTaskItems.plannedTaskId, plan.id), eq(plannedTaskItems.enabled, true)))
          .orderBy(plannedTaskItems.seq);
        let newSeriesEndsAt: Date | null;
        try {
          newSeriesEndsAt = resolvePlannedEndsAt({
            repeatType: plan.repeatType as PlannedRepeatType,
            endsOn: undefined,
            existingEndsAt: plan.endsAt,
            existingTimezone: plan.timezone,
            timezone: plan.timezone,
            firstEligibleRunAt: scheduledFor,
          });
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        const newPlanExternalId = newExternalId('plannedTask');
        await ctx.db.transaction(async (tx) => {
          const oldHasPendingOccurrence =
            plan.nextRunAt !== null && plan.nextRunAt.getTime() < original.getTime();
          await tx
            .update(plannedTasks)
            .set({
              endsAt: original,
              status: oldHasPendingOccurrence ? 'active' : 'completed',
              ...(!oldHasPendingOccurrence ? { nextRunAt: null } : {}),
            })
            .where(eq(plannedTasks.id, plan.id));
          const insert = await tx.insert(plannedTasks).values({
            externalId: newPlanExternalId,
            userId: plan.userId,
            title: plan.title,
            instruction: plan.instruction,
            notes: plan.notes,
            scope: plan.scope,
            repeatType: plan.repeatType,
            rrule: plan.rrule,
            firstRunAt: scheduledFor,
            endsAt: newSeriesEndsAt,
            nextRunAt: scheduledFor,
            timezone: plan.timezone,
            reminderMinutes: plan.reminderMinutes,
            status: 'active',
            itemCount: plan.itemCount,
          });
          await replacePlanItems(
            tx,
            readInsertId(insert),
            items.map((item) => item.instruction),
          );
        });
        return { ok: true as const, plannedTaskId: newPlanExternalId };
      }
      let seriesEndsAt: Date | null;
      try {
        seriesEndsAt = resolvePlannedEndsAt({
          repeatType: plan.repeatType as PlannedRepeatType,
          endsOn: undefined,
          existingEndsAt: plan.endsAt,
          existingTimezone: plan.timezone,
          timezone: plan.timezone,
          firstEligibleRunAt: scheduledFor,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await ctx.db
        .update(plannedTasks)
        .set({
          firstRunAt: scheduledFor,
          nextRunAt: scheduledFor,
          endsAt: seriesEndsAt,
          status: 'active',
          lastReminderRun: null,
        })
        .where(eq(plannedTasks.id, plan.id));
      return { ok: true as const, plannedTaskId: plan.externalId };
    }),

  removeOccurrence: protectedProcedure
    .input(
      planIdInput.extend({
        originalScheduledFor: z.string().datetime(),
        scope: z.enum(['occurrence', 'future', 'series']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
      const original = new Date(input.originalScheduledFor);
      if (input.scope === 'occurrence' && plan.repeatType !== 'once') {
        await ctx.db
          .insert(plannedTaskOccurrenceOverrides)
          .values({
            externalId: newExternalId('plannedTaskOverride'),
            plannedTaskId: plan.id,
            originalScheduledFor: original,
            action: 'skipped',
            scheduledFor: null,
          })
          .onDuplicateKeyUpdate({ set: { action: 'skipped', scheduledFor: null } });
        if (plan.nextRunAt?.getTime() === original.getTime()) {
          const next = (await import('../../agent/scheduled-runner.js')).computeNextRunFromInputs({
            from: original,
            rrule: plan.rrule,
            repeatType: plan.repeatType as PlannedRepeatType,
          });
          await ctx.db
            .update(plannedTasks)
            .set({
              nextRunAt: next,
              status: next ? 'active' : 'completed',
              lastReminderRun: null,
            })
            .where(eq(plannedTasks.id, plan.id));
        }
        return { ok: true as const };
      }
      if (input.scope === 'future' && plan.repeatType !== 'once') {
        const oldHasPendingOccurrence =
          plan.nextRunAt !== null && plan.nextRunAt.getTime() < original.getTime();
        await ctx.db
          .update(plannedTasks)
          .set({
            endsAt: original,
            status: oldHasPendingOccurrence ? 'active' : 'completed',
            ...(!oldHasPendingOccurrence ? { nextRunAt: null } : {}),
          })
          .where(eq(plannedTasks.id, plan.id));
        return { ok: true as const };
      }
      await ctx.db
        .update(plannedTasks)
        .set({ status: 'archived', nextRunAt: null })
        .where(eq(plannedTasks.id, plan.id));
      return { ok: true as const };
    }),

  toggle: protectedProcedure.input(planIdInput).mutation(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
    if (plan.status !== 'active' && plan.status !== 'paused') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能暂停或恢复' });
    }
    const nextStatus = plan.status === 'active' ? 'paused' : 'active';
    const result = await ctx.db
      .update(plannedTasks)
      .set({ status: nextStatus })
      .where(
        and(
          eq(plannedTasks.id, plan.id),
          eq(plannedTasks.status, plan.status),
        ),
      );
    if (readAffectedRows(result) === 0) {
      throw new TRPCError({ code: 'CONFLICT', message: '任务状态刚刚发生变化，请刷新后重试' });
    }
    return { status: nextStatus };
  }),

  runNow: protectedProcedure.input(planIdInput).mutation(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
    if (!plannedTaskCanRunNow(plan.status as Parameters<typeof plannedTaskCanRunNow>[0])) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能立即执行' });
    }
    return queuePlannedRun(ctx, {
      plannedTaskId: plan.externalId,
      scheduledFor: new Date(),
      trigger: 'manual',
    });
  }),

  archive: protectedProcedure.input(planIdInput).mutation(async ({ ctx, input }) => {
    const userId = await requireUserId(ctx);
    const result = await ctx.db
      .update(plannedTasks)
      .set({ status: 'archived', nextRunAt: null })
      .where(and(eq(plannedTasks.externalId, input.plannedTaskId), eq(plannedTasks.userId, userId)));
    if (readAffectedRows(result) === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
    }
    return { ok: true as const };
  }),

  runs: protectedProcedure
    .input(planIdInput.extend({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const userId = await requireUserId(ctx);
      const plan = await loadOwnedPlan(ctx.db, userId, input.plannedTaskId);
      return ctx.db
        .select({
          runId: plannedTaskRuns.externalId,
          title: plannedTaskRuns.title,
          scheduledFor: plannedTaskRuns.scheduledFor,
          trigger: plannedTaskRuns.trigger,
          status: plannedTaskRuns.status,
          itemsTotal: plannedTaskRuns.itemsTotal,
          itemsDone: plannedTaskRuns.itemsDone,
          itemsReview: plannedTaskRuns.itemsReview,
          itemsFailed: plannedTaskRuns.itemsFailed,
          errorMessage: plannedTaskRuns.errorMessage,
          startedAt: plannedTaskRuns.startedAt,
          completedAt: plannedTaskRuns.completedAt,
        })
        .from(plannedTaskRuns)
        .where(eq(plannedTaskRuns.plannedTaskId, plan.id))
        .orderBy(desc(plannedTaskRuns.createdAt))
        .limit(input.limit);
    }),
});
