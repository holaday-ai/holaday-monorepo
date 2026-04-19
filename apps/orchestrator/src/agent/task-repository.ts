import { newExternalId } from '@holaday/shared-types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { taskEvents } from '../db/schema/task-events.js';
import { taskSteps } from '../db/schema/task-steps.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import type { PendingConfirm, PlannedStep, TaskState } from './task-controller.js';

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

  async applyStepResult(
    prev: TaskState,
    next: TaskState,
    resultPayload?: unknown,
    rawInputStatus?: 'ok' | 'error' | 'awaiting_user' | 'skipped',
  ): Promise<void> {
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
        const stepStatus = stepStatusFor(next, isRetriesExhausted, rawInputStatus);
        const stepUpdate: Partial<typeof taskSteps.$inferInsert> = {
          status: stepStatus,
          completedAt: new Date(),
          output: resultPayload ?? null,
        };
        // Driver diagnostics (e.g. SELECTOR_NOT_FOUND) include a logical
        // screenshotKey in the result payload; persist it to the column
        // so operators can link the step row to its captured frame
        // without parsing the output JSON blob.
        const screenshotKey = extractScreenshotKey(resultPayload);
        if (screenshotKey !== null) stepUpdate.screenshotKey = screenshotKey;
        if (nextRetries > prevRetries) {
          stepUpdate.retryCount = nextRetries;
        }
        if (isRetriesExhausted && next.error) {
          stepUpdate.errorCode = next.error.code;
          stepUpdate.errorMessage = next.error.message;
        }
        if (next.status === 'awaiting_user' && next.pendingConfirm) {
          // Persist the full pendingConfirm payload (discriminated union:
          // single | batch) so restart recovery can re-emit the right
          // frame without a re-plan.
          stepUpdate.pendingConfirmPayload = next.pendingConfirm as unknown;
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
   * Batch-approve transition: user confirmed THIS batch, cursor stays put,
   * task goes back to executing, step's pending_confirm_payload clears.
   * No step row status change (the step is still "in flight"; client will
   * emit more step.results as it processes the batch).
   */
  async applyBatchApprove(prev: TaskState, next: TaskState): Promise<void> {
    if (prev.taskId !== next.taskId) {
      throw new Error('applyBatchApprove requires matching taskIds');
    }
    const [taskRow] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.externalId, next.taskId))
      .limit(1);
    if (!taskRow) throw new Error(`task ${next.taskId} not found in DB`);

    const current = next.plan[next.cursor];

    await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ status: next.status, pauseReason: null })
        .where(eq(tasks.id, taskRow.id));

      if (current) {
        await tx
          .update(taskSteps)
          .set({ status: 'executing', pendingConfirmPayload: null })
          .where(and(eq(taskSteps.taskId, taskRow.id), eq(taskSteps.externalId, current.id)));
      }

      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: taskRow.id,
        type: 'batch.approved',
        actor: 'user',
        payload:
          prev.pendingConfirm?.kind === 'batch'
            ? {
                batchIndex: prev.pendingConfirm.batchIndex,
                batchTotal: prev.pendingConfirm.batchTotal,
              }
            : null,
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
  /**
   * Record one self-heal attempt on a task_steps row. Called from the
   * WS server AFTER `planner.healSelector` returns (whether it
   * produced a replacement selector or declined). Increments
   * `heal_attempts` atomically; overwrites `heal_elapsed_ms` /
   * `heal_input_tokens` / `heal_output_tokens` with the latest
   * attempt's numbers (P1.1 defaults to one heal attempt per step;
   * if a future change allows N attempts per step we'd switch these
   * to cumulative sums — for now the single-attempt sum IS the
   * cumulative sum).
   */
  async recordHealAttempt(params: {
    taskExternalId: string;
    stepExternalId: string;
    elapsedMs: number;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    await this.db.execute(sql`
      UPDATE task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      SET
        ts.heal_attempts = ts.heal_attempts + 1,
        ts.heal_elapsed_ms = ${params.elapsedMs},
        ts.heal_input_tokens = ${params.inputTokens},
        ts.heal_output_tokens = ${params.outputTokens}
      WHERE t.external_id = ${params.taskExternalId}
        AND ts.external_id = ${params.stepExternalId}
    `);
  }

  /**
   * Flip `heal_succeeded` to 1 on a previously-healed step when the
   * retry actually succeeded. Called when the WS server receives an
   * `ok` step.result for a step whose prior failure triggered
   * `recordHealAttempt`. The in-memory tracking of "was this step
   * healed?" lives on ClientState.healedStepIds so we don't need a
   * SELECT round-trip to check heal_attempts here.
   */
  async markHealSucceeded(params: {
    taskExternalId: string;
    stepExternalId: string;
  }): Promise<void> {
    await this.db.execute(sql`
      UPDATE task_steps ts
      JOIN tasks t ON ts.task_id = t.id
      SET ts.heal_succeeded = 1
      WHERE t.external_id = ${params.taskExternalId}
        AND ts.external_id = ${params.stepExternalId}
    `);
  }

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
      const pendingRaw = normalizeJson(current?.pendingConfirmPayload);
      // Tolerate pre-batch rows that stored the old flat shape
      // {stepId, prompt, risk}. Upgrade them to {kind:'single', ...}.
      const pending: PendingConfirm | null = normalizePendingConfirm(pendingRaw);

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
        pendingConfirm: pending,
        pauseReason: state.pauseReason ?? null,
      });
    }
    return out;
  }
}

export interface RehydratedTask {
  state: TaskState;
  userExternalId: string;
  pendingConfirm: PendingConfirm | null;
  pauseReason: 'user' | 'retries_exhausted' | 'quota_exceeded' | null;
}

/**
 * Upgrades legacy rows that persisted the pre-batch flat shape
 *   {stepId, prompt, risk}
 * into the current discriminated union by tagging them as `kind:'single'`.
 * Returns null for unknown / missing payloads.
 */
function normalizePendingConfirm(raw: unknown): PendingConfirm | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'batch' || r.kind === 'single') {
    return r as unknown as PendingConfirm;
  }
  // Legacy flat shape.
  if (
    typeof r.stepId === 'string' &&
    typeof r.prompt === 'string' &&
    (r.risk === 'low' || r.risk === 'medium' || r.risk === 'high')
  ) {
    return {
      kind: 'single',
      stepId: r.stepId,
      prompt: r.prompt,
      risk: r.risk,
    };
  }
  return null;
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

function stepStatusFor(
  next: TaskState,
  isRetriesExhausted: boolean,
  rawInputStatus?: 'ok' | 'error' | 'awaiting_user' | 'skipped',
): string {
  if (isRetriesExhausted) return 'failed';
  if (next.status === 'failed') return 'failed';
  if (next.status === 'awaiting_user') return 'awaiting_user';
  // `skipped` is persisted distinctly so the audit ledger reflects
  // that this step didn't actually run (vs `completed` which implies
  // the action succeeded). The controller already treated it as
  // advance-the-cursor, so next.status here is executing/completed.
  if (rawInputStatus === 'skipped') return 'skipped';
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

/**
 * Pull `screenshotKey` out of a driver's result payload if present.
 * Returns null (not undefined) when absent so the caller can distinguish
 * "no screenshot to persist" from "drop the existing key", though we
 * don't use that distinction yet — stepUpdate.screenshotKey only gets
 * set when we have a real value. Capped at 255 chars to match the DB
 * column width.
 */
function extractScreenshotKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const key = (payload as { screenshotKey?: unknown }).screenshotKey;
  if (typeof key !== 'string' || key.length === 0) return null;
  return key.slice(0, 255);
}
