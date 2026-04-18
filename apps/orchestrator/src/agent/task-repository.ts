import { newExternalId } from '@holaday/shared-types';
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { taskEvents } from '../db/schema/task-events.js';
import { taskSteps } from '../db/schema/task-steps.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { PlannedStep, TaskState } from './task-controller.js';

/**
 * Persists TaskController state to MySQL. Phase 0 scope:
 *
 *   insertTask(state, ctx)         — initial INSERT of task + task_steps + task.created event
 *   applyStepResult(prev, next)    — UPDATE task + completed step + (maybe) next step
 *                                    + INSERT event log row derived from the transition
 *
 * The TaskController stays pure; this repository is the single place that
 * touches Drizzle so restart-recovery (W2) can be added by reading these
 * rows back into a TaskState without changing the controller.
 */

export interface InsertTaskContext {
  /** Internal users.id (NOT the external usr_… id). */
  userId: number;
  /** Internal sessions.id, if any. */
  sessionId?: number | null;
  intent: string;
}

export class TaskRepository {
  constructor(private readonly db: DB) {}

  async insertTask(state: TaskState, ctx: InsertTaskContext): Promise<void> {
    await this.db.transaction(async (tx) => {
      const insert = await tx.insert(tasks).values({
        externalId: state.taskId,
        userId: ctx.userId,
        sessionId: ctx.sessionId ?? null,
        status: state.status,
        intent: ctx.intent,
        plan: serializePlan(state.plan),
      });
      const taskRowId = readInsertId(insert);

      for (let i = 0; i < state.plan.length; i++) {
        const step = state.plan[i];
        if (!step) continue;
        await tx.insert(taskSteps).values({
          externalId: step.id,
          taskId: taskRowId,
          seq: i,
          kind: step.kind,
          status: i === state.cursor && state.status === 'executing' ? 'executing' : 'pending',
          riskLevel: step.risk,
          input: serializeStepInput(step),
          ...(i === state.cursor && state.status === 'executing' ? { startedAt: new Date() } : {}),
        });
      }

      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: taskRowId,
        type: 'task.created',
        actor: 'system',
        payload: { intent: ctx.intent, planSize: state.plan.length },
      });
    });
  }

  async applyStepResult(prev: TaskState, next: TaskState, resultPayload?: unknown): Promise<void> {
    if (prev.taskId !== next.taskId) {
      throw new Error('applyStepResult requires matching taskIds');
    }
    const [taskRow] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.externalId, next.taskId))
      .limit(1);
    if (!taskRow) {
      throw new Error(`task ${next.taskId} not found in DB`);
    }
    const taskRowId = taskRow.id;
    const completedStep = prev.plan[prev.cursor];
    const nowExecuting = next.status === 'executing' ? next.plan[next.cursor] : null;

    // Detect a same-step retry: cursor unchanged, retryCount bumped, still executing.
    const currentStepId = completedStep?.id;
    const prevRetries = currentStepId ? (prev.retryCount?.[currentStepId] ?? 0) : 0;
    const nextRetries = currentStepId ? (next.retryCount?.[currentStepId] ?? 0) : 0;
    const isRetry =
      next.status === 'executing' && prev.cursor === next.cursor && nextRetries > prevRetries;

    // Detect pause due to retries_exhausted (step failed terminally, task paused).
    const isRetriesExhausted = next.status === 'paused' && next.pauseReason === 'retries_exhausted';

    await this.db.transaction(async (tx) => {
      const taskUpdate: Partial<typeof tasks.$inferInsert> = { status: next.status };
      if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
        taskUpdate.completedAt = new Date();
      }
      if (next.error) {
        taskUpdate.errorCode = next.error.code;
        taskUpdate.errorMessage = next.error.message;
      }
      taskUpdate.pauseReason = next.status === 'paused' ? (next.pauseReason ?? null) : null;
      await tx.update(tasks).set(taskUpdate).where(eq(tasks.id, taskRowId));

      if (isRetry && completedStep) {
        // Same step, another attempt. Keep status executing; clear last error blob.
        await tx
          .update(taskSteps)
          .set({
            retryCount: nextRetries,
            errorCode: null,
            errorMessage: null,
            output: null,
            startedAt: new Date(),
          })
          .where(and(eq(taskSteps.taskId, taskRowId), eq(taskSteps.externalId, completedStep.id)));
      } else if (completedStep) {
        const stepStatus = stepStatusFor(next, isRetriesExhausted);
        const stepUpdate: Partial<typeof taskSteps.$inferInsert> = {
          status: stepStatus,
          completedAt: new Date(),
          output: resultPayload ?? null,
        };
        if (nextRetries > prevRetries) {
          stepUpdate.retryCount = nextRetries;
        }
        if (isRetriesExhausted && next.error) {
          stepUpdate.errorCode = next.error.code;
          stepUpdate.errorMessage = next.error.message;
        }
        if (next.status === 'awaiting_user' && next.pendingConfirm) {
          // Persist the prompt so restart recovery can re-emit server.user.confirm.
          stepUpdate.pendingConfirmPayload = {
            stepId: next.pendingConfirm.stepId,
            prompt: next.pendingConfirm.prompt,
            risk: next.pendingConfirm.risk,
          };
        } else {
          // Any non-awaiting transition clears a previously stored confirm.
          stepUpdate.pendingConfirmPayload = null;
        }
        await tx
          .update(taskSteps)
          .set(stepUpdate)
          .where(and(eq(taskSteps.taskId, taskRowId), eq(taskSteps.externalId, completedStep.id)));
      }

      if (nowExecuting && !isRetry) {
        await tx
          .update(taskSteps)
          .set({ status: 'executing', startedAt: new Date(), pendingConfirmPayload: null })
          .where(and(eq(taskSteps.taskId, taskRowId), eq(taskSteps.externalId, nowExecuting.id)));
      }

      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: taskRowId,
        ...(completedStep ? { stepId: null } : {}),
        type: isRetry ? 'step.retry' : eventTypeFor(prev, next),
        actor: 'system',
        payload: resultPayload ?? null,
      });
    });
  }

  /**
   * User pause / resume and quota-exceeded pause are transitions that do NOT
   * correspond to a step result frame. This applies them with one SQL batch.
   */
  async applyControlTransition(prev: TaskState, next: TaskState): Promise<void> {
    if (prev.taskId !== next.taskId) {
      throw new Error('applyControlTransition requires matching taskIds');
    }
    const [taskRow] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.externalId, next.taskId))
      .limit(1);
    if (!taskRow) throw new Error(`task ${next.taskId} not found in DB`);

    await this.db.transaction(async (tx) => {
      const update: Partial<typeof tasks.$inferInsert> = {
        status: next.status,
        pauseReason: next.status === 'paused' ? (next.pauseReason ?? null) : null,
      };
      if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled') {
        update.completedAt = new Date();
      }
      await tx.update(tasks).set(update).where(eq(tasks.id, taskRow.id));

      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: taskRow.id,
        type: controlEventType(prev, next),
        actor: 'user',
        payload: next.pauseReason ? { reason: next.pauseReason } : null,
      });
    });
  }

  /**
   * Rehydrate in-flight TaskStates after orchestrator restart.
   *
   * Reads every `tasks` row whose status is non-terminal (executing /
   * awaiting_user / paused / planning / pending) together with the
   * user's external_id (for routing back to the owning WS client) and
   * the ordered task_steps list. Rebuilds a TaskState per task so the
   * WS server can re-seed its per-client in-memory map and, if the step
   * is awaiting_user, re-emit server.user.confirm from the persisted
   * pending_confirm_payload.
   */
  async rehydrateInFlight(): Promise<RehydratedTask[]> {
    const rows = await this.db
      .select({
        taskExternalId: tasks.externalId,
        status: tasks.status,
        pauseReason: tasks.pauseReason,
        userExternalId: users.externalId,
        errorCode: tasks.errorCode,
        errorMessage: tasks.errorMessage,
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.userId))
      .where(inArray(tasks.status, [...IN_FLIGHT_STATUSES]));

    const out: RehydratedTask[] = [];
    for (const row of rows) {
      const [taskRow] = await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.externalId, row.taskExternalId))
        .limit(1);
      if (!taskRow) continue;

      const steps = await this.db
        .select()
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskRow.id))
        .orderBy(taskSteps.seq);

      const plan: PlannedStep[] = steps.map((s) => {
        const input = (normalizeJson(s.input) ?? {}) as {
          selector?: PlannedStep['selector'];
          payload?: PlannedStep['payload'];
          requiresConfirm?: boolean;
        };
        return {
          id: s.externalId,
          kind: s.kind as PlannedStep['kind'],
          risk: s.riskLevel as PlannedStep['risk'],
          ...(input.selector ? { selector: input.selector } : {}),
          ...(input.payload ? { payload: input.payload } : {}),
          ...(input.requiresConfirm !== undefined
            ? { requiresConfirm: input.requiresConfirm }
            : {}),
        };
      });

      // Cursor = first step that is not completed/failed/cancelled.
      let cursor = steps.findIndex(
        (s) => s.status !== 'completed' && s.status !== 'failed' && s.status !== 'cancelled',
      );
      if (cursor < 0) cursor = steps.length;

      const current = steps[cursor];
      const pending = normalizeJson(current?.pendingConfirmPayload) as
        | { stepId: string; prompt: string; risk: 'low' | 'medium' | 'high' }
        | null
        | undefined;

      const retryCount: Record<string, number> = {};
      for (const s of steps) {
        if (s.retryCount > 0) retryCount[s.externalId] = s.retryCount;
      }

      const state: TaskState = {
        taskId: row.taskExternalId,
        status: row.status as TaskState['status'],
        plan,
        cursor,
        pendingConfirm: pending ?? null,
        ...(row.errorCode
          ? { error: { code: row.errorCode, message: row.errorMessage ?? '' } }
          : {}),
        ...(row.pauseReason
          ? { pauseReason: row.pauseReason as NonNullable<TaskState['pauseReason']> }
          : {}),
        ...(Object.keys(retryCount).length > 0 ? { retryCount } : {}),
      };

      out.push({
        state,
        userExternalId: row.userExternalId,
        pendingConfirm: pending ?? null,
        pauseReason: state.pauseReason ?? null,
      });
    }
    return out;
  }
}

export interface RehydratedTask {
  state: TaskState;
  userExternalId: string;
  pendingConfirm: { stepId: string; prompt: string; risk: 'low' | 'medium' | 'high' } | null;
  pauseReason: 'user' | 'retries_exhausted' | 'quota_exceeded' | null;
}

const IN_FLIGHT_STATUSES = ['pending', 'planning', 'executing', 'awaiting_user', 'paused'] as const;

// ---------- helpers ----------

function eventTypeFor(prev: TaskState, next: TaskState): string {
  if (next.status === 'failed') return 'step.failed';
  if (next.status === 'awaiting_user') return 'step.awaiting_user';
  if (next.status === 'cancelled') return 'task.cancelled';
  if (next.status === 'completed') return 'task.completed';
  if (next.status === 'paused') return 'task.paused';
  if (next.cursor > prev.cursor) return 'step.completed';
  return 'task.transition';
}

function controlEventType(prev: TaskState, next: TaskState): string {
  if (next.status === 'paused') return 'task.paused';
  if (prev.status === 'paused' && next.status === 'executing') return 'task.resumed';
  if (next.status === 'cancelled') return 'task.cancelled';
  return 'task.transition';
}

function stepStatusFor(next: TaskState, isRetriesExhausted: boolean): string {
  if (isRetriesExhausted) return 'failed';
  if (next.status === 'failed') return 'failed';
  if (next.status === 'awaiting_user') return 'awaiting_user';
  return 'completed';
}

function serializePlan(plan: PlannedStep[]): unknown {
  return plan.map((s) => ({
    id: s.id,
    kind: s.kind,
    risk: s.risk,
    requiresConfirm: s.requiresConfirm ?? false,
    selector: s.selector ?? null,
    payload: s.payload ?? null,
  }));
}

function serializeStepInput(step: PlannedStep): unknown {
  return {
    selector: step.selector ?? null,
    payload: step.payload ?? null,
    requiresConfirm: step.requiresConfirm ?? false,
  };
}

/**
 * mysql2 returns inserts as `[{insertId, affectedRows, ...}, fields]`. Drizzle
 * surfaces `[{insertId}]`. This helper reads the id without leaking the
 * mysql2 typing into callers.
 */
/**
 * MariaDB (and older MySQL configurations) return JSON columns as strings.
 * Modern MySQL 8 + drizzle returns parsed objects. Accept either.
 */
function normalizeJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function readInsertId(result: unknown): number {
  if (Array.isArray(result) && result.length > 0) {
    const head = result[0] as { insertId?: number | bigint };
    if (head && typeof head.insertId === 'number') return head.insertId;
    if (head && typeof head.insertId === 'bigint') return Number(head.insertId);
  }
  throw new Error('insert did not return insertId');
}
