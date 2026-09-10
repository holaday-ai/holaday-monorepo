import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { accountClosureAllowsExecution } from '../account-closure/repository.js';
import { logger } from '../config/logger.js';
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
import type { DrainController } from '../execution/drain-controller.js';
import { type OperationLifetime, currentOperationLifetime } from '../execution/owned-operation.js';
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
import {
  callPlannedHook,
  plannedOutcomeUnknown,
  retainPlannedUncertainty,
  runPlannedDatabase,
  runPlannedOperation,
  runPlannedWrite,
  withPlannedContext,
} from './planned-lifetime.js';
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
  | {
      handled: true;
      ok: boolean;
      errorMessage?: string;
      persisted?: boolean;
      stoppedForInactiveOwner?: boolean;
      ownerUserId?: number;
    };

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
  return withPlannedContext(ctx, (bound) => queuePlannedRunOwned(bound, input));
}

async function queuePlannedRunOwned(
  ctx: AuthenticatedContext,
  input: QueuePlannedRunInput,
): Promise<{ runId: string; status: 'starting' }> {
  const [plan] = await runPlannedDatabase(async () =>
    ctx.db
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
      .limit(1),
  );
  if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
  const allowed = input.claimed
    ? plan.status === 'running'
    : plannedTaskCanRunNow(plan.status as PlannedTaskStatus);
  if (!allowed) throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });

  if (input.trigger === 'scheduled') {
    const seriesScheduledFor = input.seriesScheduledFor ?? input.scheduledFor;
    const [existing] = await runPlannedDatabase(async () =>
      ctx.db
        .select({ externalId: plannedTaskRuns.externalId, status: plannedTaskRuns.status })
        .from(plannedTaskRuns)
        .where(
          and(
            eq(plannedTaskRuns.plannedTaskId, plan.id),
            eq(plannedTaskRuns.seriesScheduledFor, seriesScheduledFor),
            eq(plannedTaskRuns.trigger, 'scheduled'),
          ),
        )
        .limit(1),
    );
    if (existing) {
      if (existing.status === 'pending') startRunDispatch(ctx, existing.externalId);
      if (existing.status === 'cancelled') {
        await updatePlanAfterDispatch(
          ctx.db,
          {
            planId: plan.id,
            scheduledFor: input.scheduledFor,
            seriesScheduledFor,
            trigger: 'scheduled',
            repeatType: plan.repeatType,
            rrule: plan.rrule,
            endsAt: plan.endsAt,
            userId: plan.userId,
          },
          false,
          '本次运行已在账号关闭期间取消',
        );
      }
      return { runId: existing.externalId, status: 'starting' };
    }
  }

  const contentOverride =
    input.trigger === 'scheduled'
      ? await runPlannedDatabase(async () =>
          ctx.db
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
            .then(([override]) => parseOccurrenceContent(override?.instruction ?? null)),
        )
      : null;
  const storedItems = await runPlannedDatabase(async () =>
    ctx.db
      .select({
        id: plannedTaskItems.id,
        seq: plannedTaskItems.seq,
        instruction: plannedTaskItems.instruction,
      })
      .from(plannedTaskItems)
      .where(and(eq(plannedTaskItems.plannedTaskId, plan.id), eq(plannedTaskItems.enabled, true)))
      .orderBy(plannedTaskItems.seq),
  );
  const items = contentOverride
    ? contentOverride.items.map((instruction, seq) => ({ id: null, seq, instruction }))
    : storedItems;
  if (items.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '规划任务没有可执行事项' });
  }

  const runExternalId = newExternalId('plannedTaskRun');
  await runPlannedDatabase(async () =>
    ctx.db.transaction(async (tx) => {
      const [lockedOwner] = await runPlannedDatabase(async () =>
        tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, plan.userId))
          .limit(1)
          .for('update'),
      );
      if (lockedOwner?.status !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });
      }
      const [lockedPlan] = await runPlannedDatabase(async () =>
        tx
          .select({ status: plannedTasks.status })
          .from(plannedTasks)
          .where(eq(plannedTasks.id, plan.id))
          .limit(1)
          .for('update'),
      );
      if (!lockedPlan) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '规划任务不存在' });
      }
      const stillAllowed = input.claimed
        ? lockedPlan.status === 'running'
        : plannedTaskCanRunNow(lockedPlan.status as PlannedTaskStatus);
      if (!stillAllowed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '当前状态不能执行' });
      }
      const result = await runPlannedWrite(
        async () =>
          tx.insert(plannedTaskRuns).values({
            externalId: runExternalId,
            plannedTaskId: plan.id,
            title: resolvePlannedRunTitle(plan.title, contentOverride),
            scheduledFor: input.scheduledFor,
            seriesScheduledFor: input.seriesScheduledFor ?? input.scheduledFor,
            trigger: input.trigger,
            status: 'pending',
            itemsTotal: items.length,
          }),
        { exactRows: 1, insertId: true },
      );
      const runId = readInsertId(result);
      await runPlannedWrite(
        async () =>
          tx.insert(plannedTaskRunItems).values(
            items.map((item) => ({
              externalId: newExternalId('plannedTaskRunItem'),
              plannedTaskRunId: runId,
              plannedTaskItemId: item.id,
              seq: item.seq,
              instruction: composePlannedItemInstruction({
                itemInstruction: item.instruction,
                sharedInstruction: contentOverride?.instruction ?? plan.instruction,
                multiple: contentOverride
                  ? contentOverride.items.length > 1
                  : plan.scope === 'multiple',
              }),
              status: 'pending',
            })),
          ),
        { exactRows: items.length },
      );
    }),
  );
  startRunDispatch(ctx, runExternalId);
  return { runId: runExternalId, status: 'starting' };
}

function startRunDispatch(ctx: AuthenticatedContext, runExternalId: string): void {
  const pending = withPlannedContext(ctx, (bound) => dispatchPlannedRunOwned(bound, runExternalId));
  void pending.catch((error) => {
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
  return withPlannedContext(ctx, (bound) => dispatchPlannedRunOwned(bound, runExternalId));
}

async function dispatchPlannedRunOwned(
  ctx: AuthenticatedContext,
  runExternalId: string,
): Promise<void> {
  const [run] = await runPlannedDatabase(async () =>
    ctx.db
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
      .limit(1),
  );
  if (!run || run.status !== 'pending') return;
  const runItems = await runPlannedDatabase(async () =>
    ctx.db
      .select({
        id: plannedTaskRunItems.id,
        seq: plannedTaskRunItems.seq,
        instruction: plannedTaskRunItems.instruction,
      })
      .from(plannedTaskRunItems)
      .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id))
      .orderBy(plannedTaskRunItems.seq),
  );
  const startedAt = new Date();
  const claim = await runPlannedWrite(
    async () =>
      ctx.db
        .update(plannedTaskRuns)
        .set({ status: 'dispatching', startedAt })
        .where(and(eq(plannedTaskRuns.id, run.id), eq(plannedTaskRuns.status, 'pending'))),
    { maxRows: 1 },
  );
  if (readAffectedRows(claim) === 0) return;

  try {
    if (!(await plannedOwnerAllowsExecution(ctx.db, run.userId, 'dispatch'))) {
      await cancelUndispatchedPlannedRun(ctx.db, run.id);
      return;
    }
    const specialDispatcher = configuredSpecialDispatcher;
    let genericPersisted = false;
    const dispatchResult = await dispatchSpecialOrGeneric({
      special: specialDispatcher
        ? () =>
            withPlannedContext(ctx, async (bound) => {
              const result = await specialDispatcher({
                ctx: bound,
                runExternalId,
                plannedTaskInternalId: run.planId,
                trigger: run.trigger as 'scheduled' | 'manual',
              });
              if (bound.executionLifetime) {
                if (
                  !result ||
                  typeof result.handled !== 'boolean' ||
                  (result.handled && typeof result.ok !== 'boolean')
                ) {
                  throw new Error('PLANNED_DRAIN_UNPROVEN_SPECIAL_ACK');
                }
                const stopped =
                  result.handled &&
                  result.stoppedForInactiveOwner === true &&
                  result.ownerUserId === run.userId;
                if (result.handled && !stopped && (!result.ok || result.persisted !== true)) {
                  retainPlannedUncertainty();
                }
              }
              return result;
            })
        : null,
      generic: async () => {
        if (runItems.length === 1) {
          const item = runItems[0];
          if (!item) throw new Error(`规划运行 ${runExternalId} 缺少任务项`);
          const result = await withPlannedContext(ctx, (bound) =>
            tasksRouter.createCaller(bound).create({
              intent: item.instruction,
              clientRequestId: `planned:${runExternalId}:${item.seq}`,
            }),
          );
          const [task] = await runPlannedDatabase(async () =>
            ctx.db
              .select({ id: tasks.id })
              .from(tasks)
              .where(eq(tasks.externalId, result.taskId))
              .limit(1),
          );
          if (!task) throw new Error(`创建任务 ${result.taskId} 后未找到记录`);
          if (!(await plannedOwnerAllowsExecution(ctx.db, run.userId, 'task-persist'))) {
            await cancelUndispatchedPlannedRun(ctx.db, run.id);
            return;
          }
          await runPlannedDatabase(async () =>
            ctx.db.transaction(async (tx) => {
              const transition = await runPlannedWrite(
                async () =>
                  tx
                    .update(plannedTaskRuns)
                    .set({ status: 'running', taskId: task.id })
                    .where(
                      and(
                        eq(plannedTaskRuns.id, run.id),
                        eq(plannedTaskRuns.status, 'dispatching'),
                      ),
                    ),
                { maxRows: 1 },
              );
              if (readAffectedRows(transition) === 0) return;
              await runPlannedWrite(
                async () =>
                  tx
                    .update(plannedTaskRunItems)
                    .set({ status: 'running', taskId: task.id })
                    .where(
                      and(
                        eq(plannedTaskRunItems.id, item.id),
                        eq(plannedTaskRunItems.status, 'pending'),
                      ),
                    ),
                { maxRows: 1 },
              );
              genericPersisted = true;
            }),
          );
        } else {
          const result = await withPlannedContext(ctx, (bound) =>
            batchTasksRouter.createCaller(bound).create({
              name: run.planTitle,
              prompts: runItems.map((item) => item.instruction),
            }),
          );
          const [batch] = await runPlannedDatabase(async () =>
            ctx.db
              .select({ id: batchTasks.id })
              .from(batchTasks)
              .where(eq(batchTasks.externalId, result.batchId))
              .limit(1),
          );
          if (!batch) throw new Error(`创建批量任务 ${result.batchId} 后未找到记录`);
          if (!(await plannedOwnerAllowsExecution(ctx.db, run.userId, 'batch-persist'))) {
            await cancelUndispatchedPlannedRun(ctx.db, run.id);
            return;
          }
          await runPlannedDatabase(async () =>
            ctx.db.transaction(async (tx) => {
              const transition = await runPlannedWrite(
                async () =>
                  tx
                    .update(plannedTaskRuns)
                    .set({ status: 'running', batchTaskId: batch.id })
                    .where(
                      and(
                        eq(plannedTaskRuns.id, run.id),
                        eq(plannedTaskRuns.status, 'dispatching'),
                      ),
                    ),
                { maxRows: 1 },
              );
              if (readAffectedRows(transition) === 0) return;
              await runPlannedWrite(
                async () =>
                  tx
                    .update(plannedTaskRunItems)
                    .set({ status: 'running' })
                    .where(
                      and(
                        eq(plannedTaskRunItems.plannedTaskRunId, run.id),
                        eq(plannedTaskRunItems.status, 'pending'),
                      ),
                    ),
                {},
              );
              genericPersisted = true;
            }),
          );
        }
      },
    });
    if (dispatchResult.handled && dispatchResult.stoppedForInactiveOwner) {
      if (dispatchResult.ownerUserId !== run.userId) {
        throw new Error('专用规划执行器返回了不匹配的账号所有者');
      }
      await cancelUndispatchedPlannedRun(ctx.db, run.id);
      return;
    }
    if (dispatchResult.handled ? dispatchResult.persisted === false : !genericPersisted) return;
    await updatePlanAfterDispatch(
      ctx.db,
      { ...run, userId: run.userId },
      dispatchResult.handled ? dispatchResult.ok : true,
      dispatchResult.handled ? (dispatchResult.errorMessage ?? null) : null,
      dispatchResult.handled && dispatchResult.ok ? 'completed' : undefined,
    );
  } catch (error) {
    retainPlannedUncertainty();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    const failed = await runPlannedDatabase(async () =>
      ctx.db.transaction(async (tx) => {
        const transition = await runPlannedWrite(
          async () =>
            tx
              .update(plannedTaskRuns)
              .set({
                status: 'failed',
                itemsFailed: runItems.length,
                errorMessage: message,
                completedAt: new Date(),
              })
              .where(
                and(eq(plannedTaskRuns.id, run.id), eq(plannedTaskRuns.status, 'dispatching')),
              ),
          { maxRows: 1 },
        );
        if (readAffectedRows(transition) === 0) return false;
        await runPlannedWrite(
          async () =>
            tx
              .update(plannedTaskRunItems)
              .set({ status: 'failed', errorMessage: message, completedAt: new Date() })
              .where(
                and(
                  eq(plannedTaskRunItems.plannedTaskRunId, run.id),
                  eq(plannedTaskRunItems.status, 'pending'),
                ),
              ),
          {},
        );
        return true;
      }),
    );
    if (failed) {
      await updatePlanAfterDispatch(ctx.db, { ...run, userId: run.userId }, false, message);
    }
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
    await runPlannedWrite(
      async () => db.update(plannedTasks).set(base).where(eq(plannedTasks.id, run.planId)),
      { maxRows: 1 },
    );
    return;
  }
  if (!(await plannedOwnerAllowsExecution(db, run.userId, 'schedule-advance'))) return;
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
  await runPlannedWrite(
    async () =>
      db
        .update(plannedTasks)
        .set({ ...base, status, nextRunAt, lastReminderRun: null })
        .where(and(eq(plannedTasks.id, run.planId), eq(plannedTasks.status, 'running'))),
    { maxRows: 1 },
  );
}

export async function syncPlannedRuns(db: DB): Promise<number> {
  const running = await runPlannedDatabase(async () =>
    db
      .select({
        id: plannedTaskRuns.id,
        planId: plannedTaskRuns.plannedTaskId,
        taskId: plannedTaskRuns.taskId,
        batchTaskId: plannedTaskRuns.batchTaskId,
      })
      .from(plannedTaskRuns)
      .where(eq(plannedTaskRuns.status, 'running'))
      .limit(100),
  );
  let settled = 0;
  for (const run of running) {
    const taskId = run.taskId;
    const batchTaskId = run.batchTaskId;
    if (plannedOutcomeUnknown()) return settled;
    if (taskId !== null) {
      const [task] = await runPlannedDatabase(async () =>
        db
          .select({ status: tasks.status, errorMessage: tasks.errorMessage })
          .from(tasks)
          .where(eq(tasks.id, taskId))
          .limit(1),
      );
      if (!task) continue;
      const outcome = derivePlannedRunOutcome({ kind: 'task', status: task.status });
      if (!outcome.terminal) continue;
      const failed = outcome.status === 'failed' || outcome.status === 'cancelled';
      const review = outcome.status === 'partial_success';
      await runPlannedDatabase(async () =>
        db.transaction(async (tx) => {
          await runPlannedWrite(
            async () =>
              tx
                .update(plannedTaskRuns)
                .set({
                  status: outcome.status,
                  itemsDone: failed ? 0 : 1,
                  itemsReview: review ? 1 : 0,
                  itemsFailed: failed ? 1 : 0,
                  errorMessage: task.errorMessage,
                  completedAt: new Date(),
                })
                .where(eq(plannedTaskRuns.id, run.id)),
            { maxRows: 1 },
          );
          await runPlannedWrite(async () =>
            tx
              .update(plannedTaskRunItems)
              .set({
                status: outcome.status,
                errorMessage: task.errorMessage,
                completedAt: new Date(),
              })
              .where(eq(plannedTaskRunItems.plannedTaskRunId, run.id)),
          );
          await runPlannedWrite(
            async () =>
              tx
                .update(plannedTasks)
                .set({ lastRunStatus: outcome.status, lastError: task.errorMessage })
                .where(eq(plannedTasks.id, run.planId)),
            { maxRows: 1 },
          );
        }),
      );
      settled += 1;
      continue;
    }
    if (batchTaskId === null) continue;
    const [batch] = await runPlannedDatabase(async () =>
      db
        .select({
          status: batchTasks.status,
          itemsTotal: batchTasks.itemsTotal,
          itemsDone: batchTasks.itemsDone,
          itemsReview: batchTasks.itemsReview,
          itemsFailed: batchTasks.itemsFailed,
        })
        .from(batchTasks)
        .where(eq(batchTasks.id, batchTaskId))
        .limit(1),
    );
    if (!batch) continue;
    const outcome = derivePlannedRunOutcome({ kind: 'batch', status: batch.status });
    const batchItems = await runPlannedDatabase(async () =>
      db
        .select({
          seq: batchTaskItems.seq,
          status: batchTaskItems.status,
          taskId: batchTaskItems.taskId,
          errorMessage: batchTaskItems.errorMessage,
          completedAt: batchTaskItems.completedAt,
        })
        .from(batchTaskItems)
        .where(eq(batchTaskItems.batchId, batchTaskId)),
    );
    for (const item of batchItems) {
      if (plannedOutcomeUnknown()) return settled;
      await runPlannedWrite(
        async () =>
          db
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
            ),
        { maxRows: 1 },
      );
    }
    if (!outcome.terminal) continue;
    await runPlannedDatabase(async () =>
      db.transaction(async (tx) => {
        await runPlannedWrite(
          async () =>
            tx
              .update(plannedTaskRuns)
              .set({
                status: outcome.status,
                itemsTotal: batch.itemsTotal,
                itemsDone: batch.itemsDone,
                itemsReview: batch.itemsReview,
                itemsFailed: batch.itemsFailed,
                completedAt: new Date(),
              })
              .where(eq(plannedTaskRuns.id, run.id)),
          { maxRows: 1 },
        );
        await runPlannedWrite(
          async () =>
            tx
              .update(plannedTasks)
              .set({ lastRunStatus: outcome.status, lastError: null })
              .where(eq(plannedTasks.id, run.planId)),
          { maxRows: 1 },
        );
      }),
    );
    settled += 1;
  }
  return settled;
}

export interface PlannedRunnerDeps {
  /** Optional until closed boot and every real producer are wired together. */
  executionDrain?: DrainController;
  db: DB;
  queue: (
    input: {
      plannedTaskId: string;
      scheduledFor: Date;
      seriesScheduledFor: Date;
    },
    lifetime?: OperationLifetime,
  ) => Promise<void>;
  notifyReminder?: (
    input: {
      userInternalId: number;
      plannedTaskInternalId: number;
      title: string;
      nextRunAt: Date;
      reminderMinutes: number;
    },
    lifetime?: OperationLifetime,
  ) => Promise<void>;
  pollIntervalMs?: number;
}

let interval: NodeJS.Timeout | null = null;
let pendingTick: Promise<void> | null = null;
let tickGeneration = Symbol();

export async function recoverStuckRunningPlannedTasks(db: DB): Promise<number> {
  const result = await runPlannedWrite(async () =>
    db
      .update(plannedTasks)
      .set({ status: 'active' })
      .where(
        and(
          eq(plannedTasks.status, 'running'),
          sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${plannedTasks.userId} AND ${users.status} = 'active')`,
        ),
      ),
  );
  return readAffectedRows(result);
}

export function startPlannedRunner(deps: PlannedRunnerDeps): NodeJS.Timeout {
  if (interval) return interval;
  const generation = Symbol();
  tickGeneration = generation;
  const pollMs = deps.pollIntervalMs ?? 60_000;
  const run = (): Promise<void> => {
    if (generation !== tickGeneration || pendingTick) return Promise.resolve();
    const pending = Promise.resolve()
      .then(async () => {
        if (generation !== tickGeneration) return;
        // Recovery must not replay a queue whose ACK outlived its physical child.
        const counts = deps.executionDrain?.drain.snapshot();
        if (counts && (counts.active > 0 || counts.unknown > 0)) return;
        try {
          const pass = async () => {
            await recoverStuckRunningPlannedTasks(deps.db);
            if (plannedOutcomeUnknown()) return;
            await normalizePendingOccurrenceOverrides(deps.db);
            if (plannedOutcomeUnknown()) return;
            await plannedReminderScan(deps, new Date());
            if (plannedOutcomeUnknown()) return;
            await plannedTick(deps);
            if (plannedOutcomeUnknown()) return;
            await syncPlannedRuns(deps.db);
          };
          if (deps.executionDrain) {
            await deps.executionDrain.runRoot(() => runPlannedOperation('scheduler', pass)).result;
          } else {
            await pass();
          }
        } catch (error) {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'planned-runner: tick failed closed',
          );
        }
      })
      .finally(() => {
        if (pendingTick === pending) pendingTick = null;
      });
    pendingTick = pending;
    return pending;
  };
  void run().catch((error) => {
    logger.error({ error }, 'planned-runner: unexpected tick rejection');
  });
  interval = setInterval(() => {
    void run().catch((error) => {
      logger.error({ error }, 'planned-runner: unexpected tick rejection');
    });
  }, pollMs);
  return interval;
}

/** Stop future ticks immediately; detached run dispatches need their own lifecycle. */
export function stopPlannedRunner(): Promise<void> {
  tickGeneration = Symbol();
  if (interval) clearInterval(interval);
  interval = null;
  return pendingTick ?? Promise.resolve();
}

async function normalizePendingOccurrenceOverrides(db: DB): Promise<void> {
  const candidates = await runPlannedDatabase(async () =>
    db
      .select({
        id: plannedTasks.id,
        nextRunAt: plannedTasks.nextRunAt,
        repeatType: plannedTasks.repeatType,
        rrule: plannedTasks.rrule,
        endsAt: plannedTasks.endsAt,
      })
      .from(plannedTasks)
      .where(eq(plannedTasks.status, 'active')),
  );
  for (const plan of candidates) {
    const planRunAt = plan.nextRunAt;
    if (plannedOutcomeUnknown()) return;
    if (!planRunAt) continue;
    const [storedOverride] = await runPlannedDatabase(async () =>
      db
        .select({
          action: plannedTaskOccurrenceOverrides.action,
          scheduledFor: plannedTaskOccurrenceOverrides.scheduledFor,
        })
        .from(plannedTaskOccurrenceOverrides)
        .where(
          and(
            eq(plannedTaskOccurrenceOverrides.plannedTaskId, plan.id),
            eq(plannedTaskOccurrenceOverrides.originalScheduledFor, planRunAt),
          ),
        )
        .limit(1),
    );
    if (!storedOverride) continue;
    if (storedOverride.action === 'rescheduled' && storedOverride.scheduledFor) {
      await runPlannedWrite(
        async () =>
          db
            .update(plannedTasks)
            .set({ nextRunAt: storedOverride.scheduledFor, lastReminderRun: null })
            .where(
              and(
                eq(plannedTasks.id, plan.id),
                eq(plannedTasks.status, 'active'),
                eq(plannedTasks.nextRunAt, planRunAt),
              ),
            ),
        { maxRows: 1 },
      );
      continue;
    }
    if (storedOverride.action !== 'skipped') continue;
    const schedule = advancePlannedSchedule({
      firedAt: planRunAt,
      repeatType: plan.repeatType as PlannedRepeatType,
      rrule: plan.rrule,
      dispatchSucceeded: true,
    });
    const nextRunAt =
      schedule.nextRunAt && (!plan.endsAt || schedule.nextRunAt < plan.endsAt)
        ? schedule.nextRunAt
        : null;
    await runPlannedWrite(
      async () =>
        db
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
              eq(plannedTasks.nextRunAt, planRunAt),
            ),
          ),
      { maxRows: 1 },
    );
  }
}

async function plannedReminderScan(deps: PlannedRunnerDeps, now: Date): Promise<void> {
  if (!deps.notifyReminder) return;
  const candidates = await runPlannedDatabase(async () =>
    deps.db
      .select({
        id: plannedTasks.id,
        userId: plannedTasks.userId,
        title: plannedTasks.title,
        nextRunAt: plannedTasks.nextRunAt,
        reminderMinutes: plannedTasks.reminderMinutes,
        lastReminderRun: plannedTasks.lastReminderRun,
      })
      .from(plannedTasks)
      .where(eq(plannedTasks.status, 'active')),
  );
  for (const plan of candidates) {
    const planRunAt = plan.nextRunAt;
    const reminderMinutes = plan.reminderMinutes;
    if (plannedOutcomeUnknown()) return;
    if (
      !planRunAt ||
      reminderMinutes === null ||
      !plannedReminderIsDue({
        now,
        nextRunAt: planRunAt,
        reminderMinutes: reminderMinutes,
        lastReminderRun: plan.lastReminderRun,
      })
    ) {
      continue;
    }
    const claim = await runPlannedWrite(
      async () =>
        deps.db
          .update(plannedTasks)
          .set({ lastReminderRun: planRunAt })
          .where(
            and(
              eq(plannedTasks.id, plan.id),
              eq(plannedTasks.status, 'active'),
              eq(plannedTasks.nextRunAt, planRunAt),
              or(isNull(plannedTasks.lastReminderRun), lt(plannedTasks.lastReminderRun, planRunAt)),
            ),
          ),
      { maxRows: 1 },
    );
    if (readAffectedRows(claim) === 0) continue;
    if (!(await plannedOwnerAllowsExecution(deps.db, plan.userId, 'reminder'))) continue;
    try {
      await callPlannedHook(deps.notifyReminder.bind(deps), {
        userInternalId: plan.userId,
        plannedTaskInternalId: plan.id,
        title: plan.title,
        nextRunAt: planRunAt,
        reminderMinutes: reminderMinutes,
      });
    } catch {
      // The atomic claim remains set. Repeated notifications are worse than
      // a best-effort delivery miss, and the plan itself must still execute.
    }
  }
}

export async function plannedTick(deps: PlannedRunnerDeps): Promise<void> {
  if (deps.executionDrain && currentOperationLifetime()?.drain !== deps.executionDrain.drain) {
    throw new Error('PLANNED_DRAIN_SCOPE_REQUIRED');
  }
  if (plannedOutcomeUnknown()) return;
  const now = new Date();
  const candidates = await runPlannedDatabase(async () =>
    deps.db
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
      ),
  );
  for (const plan of candidates) {
    const planRunAt = plan.nextRunAt;
    if (plannedOutcomeUnknown()) return;
    if (!planRunAt) continue;
    const [storedOverride] = await runPlannedDatabase(async () =>
      deps.db
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
              eq(plannedTaskOccurrenceOverrides.originalScheduledFor, planRunAt),
              eq(plannedTaskOccurrenceOverrides.scheduledFor, planRunAt),
            ),
          ),
        )
        .limit(1),
    );
    const resolution = resolveDuePlannedOccurrence({
      nextRunAt: planRunAt,
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
      await runPlannedWrite(
        async () =>
          deps.db
            .update(plannedTasks)
            .set({ nextRunAt: resolution.nextRunAt, lastReminderRun: null })
            .where(
              and(
                eq(plannedTasks.id, plan.id),
                eq(plannedTasks.status, 'active'),
                eq(plannedTasks.nextRunAt, planRunAt),
              ),
            ),
        { maxRows: 1 },
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
      await runPlannedWrite(
        async () =>
          deps.db
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
                eq(plannedTasks.nextRunAt, planRunAt),
              ),
            ),
        { maxRows: 1 },
      );
      continue;
    }
    const claim = await runPlannedWrite(
      async () =>
        deps.db
          .update(plannedTasks)
          .set({ status: 'running' })
          .where(
            and(
              eq(plannedTasks.id, plan.id),
              eq(plannedTasks.status, 'active'),
              eq(plannedTasks.nextRunAt, planRunAt),
            ),
          ),
      { maxRows: 1 },
    );
    if (readAffectedRows(claim) === 0) continue;
    if (!(await plannedOwnerAllowsExecution(deps.db, plan.userId, 'queue'))) continue;
    let queueDispatched = false;
    try {
      await callPlannedHook(
        (...args: Parameters<PlannedRunnerDeps['queue']>) => {
          queueDispatched = true;
          return deps.queue(...args);
        },
        {
          plannedTaskId: plan.externalId,
          scheduledFor: resolution.scheduledFor,
          seriesScheduledFor: resolution.seriesScheduledFor,
        },
      );
    } catch (error) {
      // Admission failure is not a business failure: preserve the claim for reconciliation.
      if (!queueDispatched) throw error;
      await runPlannedWrite(
        async () =>
          deps.db
            .update(plannedTasks)
            .set({
              status: 'failed',
              lastRunStatus: 'failed',
              lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
            })
            .where(and(eq(plannedTasks.id, plan.id), eq(plannedTasks.status, 'running'))),
        { maxRows: 1 },
      );
    }
  }
}

async function cancelUndispatchedPlannedRun(db: DB, runId: number): Promise<boolean> {
  const completedAt = new Date();
  return runPlannedDatabase(async () =>
    db.transaction(async (tx) => {
      const transition = await runPlannedWrite(
        async () =>
          tx
            .update(plannedTaskRuns)
            .set({ status: 'cancelled', completedAt })
            .where(and(eq(plannedTaskRuns.id, runId), eq(plannedTaskRuns.status, 'dispatching'))),
        { maxRows: 1 },
      );
      if (readAffectedRows(transition) === 0) return false;
      await runPlannedWrite(
        async () =>
          tx
            .update(plannedTaskRunItems)
            .set({ status: 'cancelled', completedAt })
            .where(
              and(
                eq(plannedTaskRunItems.plannedTaskRunId, runId),
                eq(plannedTaskRunItems.status, 'pending'),
              ),
            ),
        {},
      );
      return true;
    }),
  );
}

async function plannedOwnerAllowsExecution(
  db: DB,
  userId: number,
  boundary:
    | 'dispatch'
    | 'task-persist'
    | 'batch-persist'
    | 'schedule-advance'
    | 'reminder'
    | 'queue',
): Promise<boolean> {
  try {
    return await runPlannedDatabase(async () => accountClosureAllowsExecution(db, userId));
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), userId, boundary },
      'planned-runner: owner gate failed closed',
    );
    return false;
  }
}
