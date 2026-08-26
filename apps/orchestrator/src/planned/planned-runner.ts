import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { accountClosureAllowsExecution } from '../account-closure/repository.js';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import { batchTaskItems, batchTasks } from '../db/schema/batch-tasks.js';
import {
  plannedTaskItems,
  plannedTaskOccurrenceOverrides,
  plannedTaskRunItems,
  plannedTaskRuns,
  plannedTasks,
} from '../db/schema/planned-tasks.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { Context } from '../trpc/context.js';
import { batchTasksRouter } from '../trpc/routers/batch-tasks.js';
import { tasksRouter } from '../trpc/routers/tasks.js';
import {
  advancePlannedSchedule,
  composePlannedItemInstruction,
  derivePlannedRunOutcome,
  parseOccurrenceContent,
  resolvePlannedRunTitle,
} from './planned-executor.js';
import type { PlannedRepeatType, PlannedTaskStatus } from './planned-task-rules.js';
import {
  plannedReminderIsDue,
  plannedTaskCanRunNow,
  resolveDuePlannedOccurrence,
} from './planned-task-rules.js';

type AuthenticatedContext = Context & { userId: string };

interface QueuePlannedRunInput {
  plannedTaskId: string;
  scheduledFor: Date;
  seriesScheduledFor?: Date;
  trigger: 'scheduled' | 'manual';
  claimed?: boolean;
}

export type PlannedRunSpecialDispatchResult =
  | { handled: false }
  | { handled: true; ok: boolean; errorMessage?: string };

export type PlannedRunSpecialDispatcher = (input: {
  ctx: AuthenticatedContext;
  runExternalId: string;
  plannedTaskInternalId: number;
  trigger: 'scheduled' | 'manual';
}) => Promise<PlannedRunSpecialDispatchResult>;

let configuredSpecialDispatcher: PlannedRunSpecialDispatcher | null = null;

export function configurePlannedRunSpecialDispatcher(
  dispatcher: PlannedRunSpecialDispatcher | null,
): void {
  configuredSpecialDispatcher = dispatcher;
}

export async function dispatchSpecialOrGeneric(input: {
  special?: (() => Promise<PlannedRunSpecialDispatchResult>) | null;
  generic(): Promise<void>;
}): Promise<PlannedRunSpecialDispatchResult> {
  const specialized = input.special ? await input.special() : { handled: false as const };
  if (specialized.handled) return specialized;
  await input.generic();
  return { handled: false };
}

export async function queuePlannedRun(
  ctx: AuthenticatedContext,
  input: QueuePlannedRunInput,
): Promise<{ runId: string; status: 'starting' }> {
  const [plan] = await ctx.db
    .select({
      id: plannedTasks.id,
      externalId: plannedTasks.externalId,
      title: plannedTasks.title,
      instruction: plannedTasks.instruction,
      scope: plannedTasks.scope,
      repeatType: plannedTasks.repeatType,
      rrule: plannedTasks.rrule,
      endsAt: plannedTasks.endsAt,
      status: plannedTasks.status,
      userId: plannedTasks.userId,
      userStatus: users.status,
    })
    .from(plannedTasks)
    .innerJoin(users, eq(users.id, plannedTasks.userId))
    .where(
      and(
        eq(plannedTasks.externalId, input.plannedTaskId),
        eq(users.externalId, ctx.userId),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
  const allowed = input.claimed
    ? plan.status === 'running'
    : plannedTaskCanRunNow(plan.status as PlannedTaskStatus);
  if (!allowed) throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });

  if (input.trigger === 'scheduled') {
    const seriesScheduledFor = input.seriesScheduledFor ?? input.scheduledFor;
    const [existing] = await ctx.db
      .select({ externalId: plannedTaskRuns.externalId, status: plannedTaskRuns.status })
      .from(plannedTaskRuns)
      .where(
        and(
          eq(plannedTaskRuns.plannedTaskId, plan.id),
          eq(plannedTaskRuns.seriesScheduledFor, seriesScheduledFor),
          eq(plannedTaskRuns.trigger, 'scheduled'),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.status === 'pending') startRunDispatch(ctx, existing.externalId);
      return { runId: existing.externalId, status: 'starting' };
    }
  }

  const contentOverride =
    input.trigger === 'scheduled'
      ? await ctx.db
          .select({ instruction: plannedTaskOccurrenceOverrides.instruction })
          .from(plannedTaskOccurrenceOverrides)
          .where(
            and(
              eq(plannedTaskOccurrenceOverrides.plannedTaskId, plan.id),
              eq(
                plannedTaskOccurrenceOverrides.originalScheduledFor,
                input.seriesScheduledFor ?? input.scheduledFor,
              ),
            ),
          )
          .limit(1)
          .then(([override]) => parseOccurrenceContent(override?.instruction ?? null))
      : null;
  const storedItems = await ctx.db
    .select({
      id: plannedTaskItems.id,
      seq: plannedTaskItems.seq,
      instruction: plannedTaskItems.instruction,
    })
    .from(plannedTaskItems)
    .where(and(eq(plannedTaskItems.plannedTaskId, plan.id), eq(plannedTaskItems.enabled, true)))
    .orderBy(plannedTaskItems.seq);
  const items = contentOverride
    ? contentOverride.items.map((instruction, seq) => ({ id: null, seq, instruction }))
    : storedItems;
  if (items.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '规划任务没有可执行事项' });
  }

  const runExternalId = newExternalId('plannedTaskRun');
  await ctx.db.transaction(async (tx) => {
    const [lockedOwner] = await tx
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, plan.userId))
      .limit(1)
      .for('update');
    if (lockedOwner?.status !== 'active') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });
    }
    const [lockedPlan] = await tx
      .select({ status: plannedTasks.status })
      .from(plannedTasks)
      .where(eq(plannedTasks.id, plan.id))
      .limit(1)
      .for('update');
    if (!lockedPlan) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
    }
    const stillAllowed = input.claimed
      ? lockedPlan.status === 'running'
      : plannedTaskCanRunNow(lockedPlan.status as PlannedTaskStatus);
    if (!stillAllowed) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });
    }
    const result = await tx.insert(plannedTaskRuns).values({
      externalId: runExternalId,
      plannedTaskId: plan.id,
      title: resolvePlannedRunTitle(plan.title, contentOverride),
      scheduledFor: input.scheduledFor,
      seriesScheduledFor: input.seriesScheduledFor ?? input.scheduledFor,
      trigger: input.trigger,
      status: 'pending',
      itemsTotal: items.length,
    });
    const runId = readInsertId(result);
    await tx.insert(plannedTaskRunItems).values(
      items.map((item) => ({
        externalId: newExternalId('plannedTaskRunItem'),
        plannedTaskRunId: runId,
        plannedTaskItemId: item.id,
        seq: item.seq,
        instruction: composePlannedItemInstruction({
          itemInstruction: item.instruction,
          sharedInstruction: contentOverride?.instruction ?? plan.instruction,
          multiple: contentOverride ? contentOverride.items.length > 1 : plan.scope === 'multiple',
        }),
        status: 'pending',
      })),
    );
  });
  startRunDispatch(ctx, runExternalId);
  return { runId: runExternalId, status: 'starting' };
}

function startRunDispatch(ctx: AuthenticatedContext, runExternalId: string): void {
  void dispatchPlannedRun(ctx, runExternalId).catch((error) => {
    ctx.logger.error(
      { error: error instanceof Error ? error.message : String(error), runExternalId },
      'planned-runner: dispatch crashed',
    );
  });
}

export async function dispatchPlannedRun(
  ctx: AuthenticatedContext,
  runExternalId: string,
): Promise<void> {
  const [run] = await ctx.db
    .select({
      id: plannedTaskRuns.id,
      status: plannedTaskRuns.status,
      scheduledFor: plannedTaskRuns.scheduledFor,
      seriesScheduledFor: plannedTaskRuns.seriesScheduledFor,
      trigger: plannedTaskRuns.trigger,
      planId: plannedTasks.id,
      planExternalId: plannedTasks.externalId,
      planTitle: plannedTasks.title,
      repeatType: plannedTasks.repeatType,
      rrule: plannedTasks.rrule,
      endsAt: plannedTasks.endsAt,
      userId: plannedTasks.userId,
    })
    .from(plannedTaskRuns)
    .innerJoin(plannedTasks, eq(plannedTasks.id, plannedTaskRuns.plannedTaskId))
    .where(eq(plannedTaskRuns.externalId, runExternalId))
    .limit(1);
  if (!run || run.status !== 'pending') return;
  const runItems = await ctx.db
    .select({
      id: plannedTaskRunItems.id,
      seq: plannedTaskRunItems.seq,
      instruction: plannedTaskRunItems.instruction,
    })
    .from(plannedTaskRunItems)
    .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id))
    .orderBy(plannedTaskRunItems.seq);
  const startedAt = new Date();
  await ctx.db
    .update(plannedTaskRuns)
    .set({ status: 'dispatching', startedAt })
    .where(and(eq(plannedTaskRuns.id, run.id), eq(plannedTaskRuns.status, 'pending')));

  if (!(await accountClosureAllowsExecution(ctx.db, run.userId))) {
    await cancelUndispatchedPlannedRun(ctx.db, run.id);
    return;
  }

  try {
    const specialDispatcher = configuredSpecialDispatcher;
    const dispatchResult = await dispatchSpecialOrGeneric({
      special: specialDispatcher
        ? () =>
            specialDispatcher({
              ctx,
              runExternalId,
              plannedTaskInternalId: run.planId,
              trigger: run.trigger as 'scheduled' | 'manual',
            })
        : null,
      generic: async () => {
        if (runItems.length === 1) {
          const item = runItems[0];
          if (!item) throw new Error(`规划运行 ${runExternalId} 缺少任务项`);
          const result = await tasksRouter.createCaller(ctx).create({
            intent: item.instruction,
            clientRequestId: `planned:${runExternalId}:${item.seq}`,
          });
          const [task] = await ctx.db
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.externalId, result.taskId))
            .limit(1);
          if (!task) throw new Error(`创建任务 ${result.taskId} 后未找到记录`);
          await ctx.db.transaction(async (tx) => {
            await tx
              .update(plannedTaskRuns)
              .set({ status: 'running', taskId: task.id })
              .where(eq(plannedTaskRuns.id, run.id));
            await tx
              .update(plannedTaskRunItems)
              .set({ status: 'running', taskId: task.id })
              .where(eq(plannedTaskRunItems.id, item.id));
          });
        } else {
          const result = await batchTasksRouter.createCaller(ctx).create({
            name: run.planTitle,
            prompts: runItems.map((item) => item.instruction),
          });
          const [batch] = await ctx.db
            .select({ id: batchTasks.id })
            .from(batchTasks)
            .where(eq(batchTasks.externalId, result.batchId))
            .limit(1);
          if (!batch) throw new Error(`创建批量任务 ${result.batchId} 后未找到记录`);
          await ctx.db
            .update(plannedTaskRuns)
            .set({ status: 'running', batchTaskId: batch.id })
            .where(eq(plannedTaskRuns.id, run.id));
          await ctx.db
            .update(plannedTaskRunItems)
            .set({ status: 'running' })
            .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id));
        }
      },
    });
    await updatePlanAfterDispatch(
      ctx.db,
      { ...run, userId: run.userId },
      dispatchResult.handled ? dispatchResult.ok : true,
      dispatchResult.handled ? (dispatchResult.errorMessage ?? null) : null,
      dispatchResult.handled && dispatchResult.ok ? 'completed' : undefined,
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(plannedTaskRuns)
        .set({
          status: 'failed',
          itemsFailed: runItems.length,
          errorMessage: message,
          completedAt: new Date(),
        })
        .where(eq(plannedTaskRuns.id, run.id));
      await tx
        .update(plannedTaskRunItems)
        .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
        .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id));
    });
    await updatePlanAfterDispatch(ctx.db, { ...run, userId: run.userId }, false, message);
  }
}

async function updatePlanAfterDispatch(
  db: DB,
  run: {
    planId: number;
    scheduledFor: Date;
    seriesScheduledFor: Date;
    trigger: string;
    repeatType: string;
    rrule: string | null;
    endsAt: Date | null;
    userId: number;
  },
  ok: boolean,
  error: string | null,
  successfulStatus: 'running' | 'completed' = 'running',
): Promise<void> {
  const base = {
    lastRunAt: new Date(),
    lastRunStatus: ok ? successfulStatus : 'failed',
    lastError: error,
  };
  if (run.trigger !== 'scheduled') {
    await db.update(plannedTasks).set(base).where(eq(plannedTasks.id, run.planId));
    return;
  }
  if (!(await accountClosureAllowsExecution(db, run.userId))) return;
  const schedule = advancePlannedSchedule({
    firedAt: run.seriesScheduledFor,
    repeatType: run.repeatType as PlannedRepeatType,
    rrule: run.rrule,
    dispatchSucceeded: ok,
  });
  const nextRunAt =
    schedule.nextRunAt && (!run.endsAt || schedule.nextRunAt.getTime() < run.endsAt.getTime())
      ? schedule.nextRunAt
      : null;
  const status = nextRunAt ? 'active' : schedule.status;
  await db
    .update(plannedTasks)
    .set({ ...base, status, nextRunAt, lastReminderRun: null })
    .where(and(eq(plannedTasks.id, run.planId), eq(plannedTasks.status, 'running')));
}

export async function syncPlannedRuns(db: DB): Promise<number> {
  const running = await db
    .select({
      id: plannedTaskRuns.id,
      planId: plannedTaskRuns.plannedTaskId,
      taskId: plannedTaskRuns.taskId,
      batchTaskId: plannedTaskRuns.batchTaskId,
    })
    .from(plannedTaskRuns)
    .where(eq(plannedTaskRuns.status, 'running'))
    .limit(100);
  let settled = 0;
  for (const run of running) {
    if (run.taskId !== null) {
      const [task] = await db
        .select({ status: tasks.status, errorMessage: tasks.errorMessage })
        .from(tasks)
        .where(eq(tasks.id, run.taskId))
        .limit(1);
      if (!task) continue;
      const outcome = derivePlannedRunOutcome({ kind: 'task', status: task.status });
      if (!outcome.terminal) continue;
      const failed = outcome.status === 'failed' || outcome.status === 'cancelled';
      const review = outcome.status === 'partial_success';
      await db.transaction(async (tx) => {
        await tx
          .update(plannedTaskRuns)
          .set({
            status: outcome.status,
            itemsDone: failed ? 0 : 1,
            itemsReview: review ? 1 : 0,
            itemsFailed: failed ? 1 : 0,
            errorMessage: task.errorMessage,
            completedAt: new Date(),
          })
          .where(eq(plannedTaskRuns.id, run.id));
        await tx
          .update(plannedTaskRunItems)
          .set({
            status: outcome.status,
            errorMessage: task.errorMessage,
            completedAt: new Date(),
          })
          .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id));
        await tx
          .update(plannedTasks)
          .set({ lastRunStatus: outcome.status, lastError: task.errorMessage })
          .where(eq(plannedTasks.id, run.planId));
      });
      settled += 1;
      continue;
    }
    if (run.batchTaskId === null) continue;
    const [batch] = await db
      .select({
        status: batchTasks.status,
        itemsTotal: batchTasks.itemsTotal,
        itemsDone: batchTasks.itemsDone,
        itemsReview: batchTasks.itemsReview,
        itemsFailed: batchTasks.itemsFailed,
      })
      .from(batchTasks)
      .where(eq(batchTasks.id, run.batchTaskId))
      .limit(1);
    if (!batch) continue;
    const outcome = derivePlannedRunOutcome({ kind: 'batch', status: batch.status });
    const batchItems = await db
      .select({
        seq: batchTaskItems.seq,
        status: batchTaskItems.status,
        taskId: batchTaskItems.taskId,
        errorMessage: batchTaskItems.errorMessage,
        completedAt: batchTaskItems.completedAt,
      })
      .from(batchTaskItems)
      .where(eq(batchTaskItems.batchId, run.batchTaskId));
    for (const item of batchItems) {
      await db
        .update(plannedTaskRunItems)
        .set({
          status: item.status,
          taskId: item.taskId,
          errorMessage: item.errorMessage,
          completedAt: item.completedAt,
        })
        .where(
          and(
            eq(plannedTaskRunItems.plannedTaskRunId, run.id),
            eq(plannedTaskRunItems.seq, item.seq),
          ),
        );
    }
    if (!outcome.terminal) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(plannedTaskRuns)
        .set({
          status: outcome.status,
          itemsTotal: batch.itemsTotal,
          itemsDone: batch.itemsDone,
          itemsReview: batch.itemsReview,
          itemsFailed: batch.itemsFailed,
          completedAt: new Date(),
        })
        .where(eq(plannedTaskRuns.id, run.id));
      await tx
        .update(plannedTasks)
        .set({ lastRunStatus: outcome.status, lastError: null })
        .where(eq(plannedTasks.id, run.planId));
    });
    settled += 1;
  }
  return settled;
}

export interface PlannedRunnerDeps {
  db: DB;
  queue: (input: {
    plannedTaskId: string;
    scheduledFor: Date;
    seriesScheduledFor: Date;
  }) => Promise<void>;
  notifyReminder?: (input: {
    userInternalId: number;
    plannedTaskInternalId: number;
    title: string;
    nextRunAt: Date;
    reminderMinutes: number;
  }) => Promise<void>;
  pollIntervalMs?: number;
}

let interval: NodeJS.Timeout | null = null;
let tickRunning = false;

export async function recoverStuckRunningPlannedTasks(db: DB): Promise<number> {
  const result = await db
    .update(plannedTasks)
    .set({ status: 'active' })
    .where(
      and(
        eq(plannedTasks.status, 'running'),
        sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${plannedTasks.userId} AND ${users.status} = 'active')`,
      ),
    );
  return readAffectedRows(result);
}

export function startPlannedRunner(deps: PlannedRunnerDeps): NodeJS.Timeout {
  if (interval) return interval;
  const pollMs = deps.pollIntervalMs ?? 60_000;
  const run = async () => {
    if (tickRunning) return;
    tickRunning = true;
    try {
      await normalizePendingOccurrenceOverrides(deps.db);
      await plannedReminderScan(deps, new Date());
      await plannedTick(deps);
      await syncPlannedRuns(deps.db);
    } finally {
      tickRunning = false;
    }
  };
  void run();
  interval = setInterval(() => void run(), pollMs);
  return interval;
}

export function stopPlannedRunner(): void {
  if (interval) clearInterval(interval);
  interval = null;
  tickRunning = false;
}

async function normalizePendingOccurrenceOverrides(db: DB): Promise<void> {
  const candidates = await db
    .select({
      id: plannedTasks.id,
      nextRunAt: plannedTasks.nextRunAt,
      repeatType: plannedTasks.repeatType,
      rrule: plannedTasks.rrule,
      endsAt: plannedTasks.endsAt,
    })
    .from(plannedTasks)
    .where(eq(plannedTasks.status, 'active'));
  for (const plan of candidates) {
    if (!plan.nextRunAt) continue;
    const [storedOverride] = await db
      .select({
        action: plannedTaskOccurrenceOverrides.action,
        scheduledFor: plannedTaskOccurrenceOverrides.scheduledFor,
      })
      .from(plannedTaskOccurrenceOverrides)
      .where(
        and(
          eq(plannedTaskOccurrenceOverrides.plannedTaskId, plan.id),
          eq(plannedTaskOccurrenceOverrides.originalScheduledFor, plan.nextRunAt),
        ),
      )
      .limit(1);
    if (!storedOverride) continue;
    if (storedOverride.action === 'rescheduled' && storedOverride.scheduledFor) {
      await db
        .update(plannedTasks)
        .set({ nextRunAt: storedOverride.scheduledFor, lastReminderRun: null })
        .where(
          and(
            eq(plannedTasks.id, plan.id),
            eq(plannedTasks.status, 'active'),
            eq(plannedTasks.nextRunAt, plan.nextRunAt),
          ),
        );
      continue;
    }
    if (storedOverride.action !== 'skipped') continue;
    const schedule = advancePlannedSchedule({
      firedAt: plan.nextRunAt,
      repeatType: plan.repeatType as PlannedRepeatType,
      rrule: plan.rrule,
      dispatchSucceeded: true,
    });
    const nextRunAt =
      schedule.nextRunAt && (!plan.endsAt || schedule.nextRunAt < plan.endsAt)
        ? schedule.nextRunAt
        : null;
    await db
      .update(plannedTasks)
      .set({
        nextRunAt,
        status: nextRunAt ? 'active' : 'completed',
        lastReminderRun: null,
      })
      .where(
        and(
          eq(plannedTasks.id, plan.id),
          eq(plannedTasks.status, 'active'),
          eq(plannedTasks.nextRunAt, plan.nextRunAt),
        ),
      );
  }
}

async function plannedReminderScan(deps: PlannedRunnerDeps, now: Date): Promise<void> {
  if (!deps.notifyReminder) return;
  const candidates = await deps.db
    .select({
      id: plannedTasks.id,
      userId: plannedTasks.userId,
      title: plannedTasks.title,
      nextRunAt: plannedTasks.nextRunAt,
      reminderMinutes: plannedTasks.reminderMinutes,
      lastReminderRun: plannedTasks.lastReminderRun,
    })
    .from(plannedTasks)
    .where(eq(plannedTasks.status, 'active'));
  for (const plan of candidates) {
    if (
      !plan.nextRunAt ||
      plan.reminderMinutes === null ||
      !plannedReminderIsDue({
        now,
        nextRunAt: plan.nextRunAt,
        reminderMinutes: plan.reminderMinutes,
        lastReminderRun: plan.lastReminderRun,
      })
    ) {
      continue;
    }
    const claim = await deps.db
      .update(plannedTasks)
      .set({ lastReminderRun: plan.nextRunAt })
      .where(
        and(
          eq(plannedTasks.id, plan.id),
          eq(plannedTasks.status, 'active'),
          eq(plannedTasks.nextRunAt, plan.nextRunAt),
          or(
            isNull(plannedTasks.lastReminderRun),
            lt(plannedTasks.lastReminderRun, plan.nextRunAt),
          ),
        ),
      );
    if (readAffectedRows(claim) === 0) continue;
    if (!(await accountClosureAllowsExecution(deps.db, plan.userId))) continue;
    try {
      await deps.notifyReminder({
        userInternalId: plan.userId,
        plannedTaskInternalId: plan.id,
        title: plan.title,
        nextRunAt: plan.nextRunAt,
        reminderMinutes: plan.reminderMinutes,
      });
    } catch {
      // The atomic claim remains set. Repeated notifications are worse than
      // a best-effort delivery miss, and the plan itself must still execute.
    }
  }
}

export async function plannedTick(deps: PlannedRunnerDeps): Promise<void> {
  const now = new Date();
  const candidates = await deps.db
    .select({
      id: plannedTasks.id,
      externalId: plannedTasks.externalId,
      nextRunAt: plannedTasks.nextRunAt,
      repeatType: plannedTasks.repeatType,
      rrule: plannedTasks.rrule,
      endsAt: plannedTasks.endsAt,
      userId: plannedTasks.userId,
    })
    .from(plannedTasks)
    .where(
      and(
        eq(plannedTasks.status, 'active'),
        lte(plannedTasks.nextRunAt, now),
        or(isNull(plannedTasks.endsAt), lt(plannedTasks.nextRunAt, plannedTasks.endsAt)),
      ),
    );
  for (const plan of candidates) {
    if (!plan.nextRunAt) continue;
    const [storedOverride] = await deps.db
      .select({
        originalScheduledFor: plannedTaskOccurrenceOverrides.originalScheduledFor,
        action: plannedTaskOccurrenceOverrides.action,
        scheduledFor: plannedTaskOccurrenceOverrides.scheduledFor,
      })
      .from(plannedTaskOccurrenceOverrides)
      .where(
        and(
          eq(plannedTaskOccurrenceOverrides.plannedTaskId, plan.id),
          or(
            eq(plannedTaskOccurrenceOverrides.originalScheduledFor, plan.nextRunAt),
            eq(plannedTaskOccurrenceOverrides.scheduledFor, plan.nextRunAt),
          ),
        ),
      )
      .limit(1);
    const resolution = resolveDuePlannedOccurrence({
      nextRunAt: plan.nextRunAt,
      now,
      override: storedOverride
        ? {
            originalScheduledFor: storedOverride.originalScheduledFor,
            action: storedOverride.action as 'rescheduled' | 'skipped',
            scheduledFor: storedOverride.scheduledFor,
          }
        : null,
    });
    if (resolution.action === 'defer') {
      await deps.db
        .update(plannedTasks)
        .set({ nextRunAt: resolution.nextRunAt, lastReminderRun: null })
        .where(
          and(
            eq(plannedTasks.id, plan.id),
            eq(plannedTasks.status, 'active'),
            eq(plannedTasks.nextRunAt, plan.nextRunAt),
          ),
        );
      continue;
    }
    if (resolution.action === 'skip') {
      const schedule = advancePlannedSchedule({
        firedAt: resolution.seriesScheduledFor,
        repeatType: plan.repeatType as PlannedRepeatType,
        rrule: plan.rrule,
        dispatchSucceeded: true,
      });
      const nextRunAt =
        schedule.nextRunAt && (!plan.endsAt || schedule.nextRunAt.getTime() < plan.endsAt.getTime())
          ? schedule.nextRunAt
          : null;
      await deps.db
        .update(plannedTasks)
        .set({
          nextRunAt,
          status: nextRunAt ? 'active' : 'completed',
          lastReminderRun: null,
        })
        .where(
          and(
            eq(plannedTasks.id, plan.id),
            eq(plannedTasks.status, 'active'),
            eq(plannedTasks.nextRunAt, plan.nextRunAt),
          ),
        );
      continue;
    }
    const claim = await deps.db
      .update(plannedTasks)
      .set({ status: 'running' })
      .where(
        and(
          eq(plannedTasks.id, plan.id),
          eq(plannedTasks.status, 'active'),
          eq(plannedTasks.nextRunAt, plan.nextRunAt),
        ),
      );
    if (readAffectedRows(claim) === 0) continue;
    if (!(await accountClosureAllowsExecution(deps.db, plan.userId))) continue;
    try {
      await deps.queue({
        plannedTaskId: plan.externalId,
        scheduledFor: resolution.scheduledFor,
        seriesScheduledFor: resolution.seriesScheduledFor,
      });
    } catch (error) {
      await deps.db
        .update(plannedTasks)
        .set({
          status: 'failed',
          lastRunStatus: 'failed',
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        })
        .where(and(eq(plannedTasks.id, plan.id), eq(plannedTasks.status, 'running')));
    }
  }
}

async function cancelUndispatchedPlannedRun(db: DB, runId: number): Promise<void> {
  const completedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(plannedTaskRuns)
      .set({ status: 'cancelled', completedAt })
      .where(and(eq(plannedTaskRuns.id, runId), eq(plannedTaskRuns.status, 'dispatching')));
    await tx
      .update(plannedTaskRunItems)
      .set({ status: 'cancelled', completedAt })
      .where(eq(plannedTaskRunItems.plannedTaskRunId, runId));
  });
}
