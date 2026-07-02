import { newExternalId } from '@holaday/shared-types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';

/**
 * mysql2 returns `[ResultSetHeader, ...]` from drizzle's `update().set()`
 * call; ResultSetHeader has `affectedRows`. Some drizzle versions /
 * adapters surface it on the top-level object instead. Probe both —
 * mirrors the helper in src/index.ts for the boot sweep.
 */
function extractMysqlAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const head = result[0] as { affectedRows?: number } | undefined;
    if (typeof head?.affectedRows === 'number') return head.affectedRows;
  }
  const direct = (result as { affectedRows?: number } | null)?.affectedRows;
  return typeof direct === 'number' ? direct : 0;
}
import { taskEvents } from '../db/schema/task-events.js';
import { taskSteps } from '../db/schema/task-steps.js';
import { tasks } from '../db/schema/tasks.js';
import { users } from '../db/schema/users.js';
import {
  isTaskTerminalStatus,
  TASK_ACTIVE_STATUSES,
  taskRunnerOutcomeSourceStatuses,
} from '../task-status.js';
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
  /**
   * Role injected into the supercar prompt for this task (or
   * 'none'/null when no role addon was used). Populated by the
   * Phase 10 Tier 2 routing in tasks.create.
   */
  roleId?: string | null;
  /**
   * Whether this task burned an Opus quota slot. Pro plan only —
   * Phase 10 Tier 1 routes complex roles to Opus 4.7. Defaults to
   * false when omitted.
   */
  opusUsed?: boolean;
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
        roleId: ctx.roleId ?? null,
        opusUsed: ctx.opusUsed ?? false,
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
      if (isTaskTerminalStatus(next.status)) {
        taskUpdate.completedAt = new Date();
      }
      if (next.error) {
        taskUpdate.errorCode = next.error.code;
        taskUpdate.errorMessage = next.error.message;
      }
      taskUpdate.pauseReason = next.status === 'paused' ? (next.pauseReason ?? null) : null;
      const taskUpdateResult = await tx
        .update(tasks)
        .set(taskUpdate)
        .where(and(eq(tasks.id, taskRowId), eq(tasks.status, prev.status)));
      const taskUpdateAffected = extractMysqlAffectedRows(taskUpdateResult);
      if (taskUpdateAffected === 0) {
        return;
      }

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
      if (isTaskTerminalStatus(next.status)) {
        update.completedAt = new Date();
      }
      const updateResult = await tx
        .update(tasks)
        .set(update)
        .where(and(eq(tasks.id, taskRow.id), eq(tasks.status, prev.status)));
      const affected = extractMysqlAffectedRows(updateResult);
      if (affected === 0) {
        return;
      }

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
   * Persist the terminal state of a vision-loop task. Called by the
   * task-runner's `.then` once VisionLoopRunner.run() resolves.
   *
   * Maps RunOutcome → tasks row:
   *   completed → status='completed', result={summary, tickCount},
   *               completedAt=now
   *   failed    → status='failed',    result={reason, tickCount},
   *               errorCode='VISION_GAVE_UP' | 'VISION_DRIVER_FAILED',
   *               errorMessage=reason, completedAt=now
   *   paused    → status='paused',    result={tickCount},
   *               pauseReason='max_steps_reached'
   *   cancelled → status='cancelled', completedAt=now
   *
   * Writes a task_events row so the audit trail includes the vision
   * loop's terminal outcome alongside classic-flow step.result events.
   */
  async persistVisionOutcome(
    taskExternalId: string,
    outcome:
      | {
          status: 'completed';
          summary: string;
          tickCount: number;
          /** R7 — final-state evidence captured pre-pool-release. */
          finalScreenshot?: string;
          finalUrl?: string;
          finalViewport?: { width: number; height: number };
          /**
           * Spec B3 — structured execution metadata stamped into the
           * `result` JSON under `metadata`. Carries fields the eval
           * pipeline needs (executionMode, fallbackChain, model,
           * expertWorkflowId, etc.) without a schema migration. Read
           * by `tasks.detail` consumers via `result.metadata`.
           */
          metadata?: Record<string, unknown>;
          failedChecks?: Array<{ type: string; detail: string }>;
        }
      | {
          /**
           * Codex Pack A3 — quality-gate verdict: the runner produced a
           * usable summary but the deterministic verifier failed at
           * least one structural check (url_count / result_count /
           * price_sort) with `failureLevel === 'fixable'`. Row is
           * marked terminal with `summary` populated so the SPA can
           * still render the answer; a yellow banner above it warns
           * the user the result may be incomplete.
           */
          status: 'partial_success';
          summary: string;
          tickCount: number;
          finalScreenshot?: string;
          finalUrl?: string;
          finalViewport?: { width: number; height: number };
          metadata?: Record<string, unknown>;
          failedChecks?: Array<{ type: string; detail: string }>;
        }
      | {
          status: 'failed';
          reason: string;
          tickCount: number;
          errorCode?: string;
          finalScreenshot?: string;
          finalUrl?: string;
          finalViewport?: { width: number; height: number };
          metadata?: Record<string, unknown>;
          failedChecks?: Array<{ type: string; detail: string }>;
        }
      | {
          status: 'paused';
          reason: string;
          tickCount: number;
          // Phase 1 follow-up — paused / cancelled rows now also
          // accept terminal-state evidence so the SPA's BrowserPanel
          // has a frame to render after a refresh / disconnect.
          finalScreenshot?: string;
          finalUrl?: string;
          finalViewport?: { width: number; height: number };
          metadata?: Record<string, unknown>;
        }
      | {
          status: 'cancelled';
          tickCount: number;
          finalScreenshot?: string;
          finalUrl?: string;
          finalViewport?: { width: number; height: number };
          metadata?: Record<string, unknown>;
        },
  ): Promise<{ persisted: boolean }> {
    const [taskRow] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.externalId, taskExternalId))
      .limit(1);
    if (!taskRow) throw new Error(`task ${taskExternalId} not found in DB`);
    const taskRowId = taskRow.id;

    const update: Partial<typeof tasks.$inferInsert> = { status: outcome.status };
    const result: Record<string, unknown> = { tickCount: outcome.tickCount };
    let eventPayload: Record<string, unknown> = { tickCount: outcome.tickCount };
    if (outcome.status === 'completed' || outcome.status === 'partial_success') {
      // Codex Pack A3 — partial_success behaves like completed for
      // persistence (summary + timestamp + evidence stamps); the
      // verifier verdict columns persisted by `persistExecution`
      // record WHY it landed in partial_success rather than the
      // status column needing additional metadata.
      update.completedAt = new Date();
      update.pauseReason = null;
      result.summary = outcome.summary;
      if (outcome.finalScreenshot) result.finalScreenshot = outcome.finalScreenshot;
      if (outcome.finalUrl) result.finalUrl = outcome.finalUrl;
      if (outcome.finalViewport) result.finalViewport = outcome.finalViewport;
      if (outcome.metadata) result.metadata = outcome.metadata;
      if (outcome.failedChecks && outcome.failedChecks.length > 0) {
        result.failedChecks = outcome.failedChecks;
      }
      eventPayload = { ...eventPayload, summary: outcome.summary };
    } else if (outcome.status === 'failed') {
      update.completedAt = new Date();
      update.pauseReason = null;
      update.errorCode = outcome.errorCode ?? 'VISION_GAVE_UP';
      update.errorMessage = outcome.reason.slice(0, 2_000);
      result.reason = outcome.reason;
      if (outcome.finalScreenshot) result.finalScreenshot = outcome.finalScreenshot;
      if (outcome.finalUrl) result.finalUrl = outcome.finalUrl;
      if (outcome.finalViewport) result.finalViewport = outcome.finalViewport;
      if (outcome.metadata) result.metadata = outcome.metadata;
      if (outcome.failedChecks && outcome.failedChecks.length > 0) {
        result.failedChecks = outcome.failedChecks;
      }
      eventPayload = { ...eventPayload, reason: outcome.reason };
    } else if (outcome.status === 'paused') {
      update.pauseReason = 'max_steps_reached';
      result.reason = outcome.reason;
      // Phase 1 follow-up — accept finalScreenshot/finalUrl/metadata.
      if (outcome.finalScreenshot) result.finalScreenshot = outcome.finalScreenshot;
      if (outcome.finalUrl) result.finalUrl = outcome.finalUrl;
      if (outcome.finalViewport) result.finalViewport = outcome.finalViewport;
      if (outcome.metadata) result.metadata = outcome.metadata;
      eventPayload = { ...eventPayload, reason: outcome.reason };
    } else {
      update.completedAt = new Date();
      update.pauseReason = null;
      // Phase 1 follow-up — capture terminal frame on cancellation.
      if (outcome.finalScreenshot) result.finalScreenshot = outcome.finalScreenshot;
      if (outcome.finalUrl) result.finalUrl = outcome.finalUrl;
      if (outcome.finalViewport) result.finalViewport = outcome.finalViewport;
      if (outcome.metadata) result.metadata = outcome.metadata;
    }
    update.result = result;

    // Phase 3 R1 (Codex follow-up) — atomic state-machine guard.
    // Earlier the guard was SELECT-status THEN UPDATE — a race window
    // existed where another writer could flip status before the write.
    // The UPDATE now carries the legal source-state table directly:
    // runner terminal writes may only settle active running rows
    // (pending/planning/queued/executing), while cancellation may also
    // settle paused rows. Awaiting-user and all terminal statuses are
    // refused atomically so late runner completions cannot overwrite
    // what the user already sees.
    //
    // Codex P3 follow-up — return `{persisted}` so callers can skip
    // terminal-only side effects (server.task.terminal broadcast,
    // memory.extractAndStore, suggestion generation) when this UPDATE
    // was refused. Without the flag, a takeover-timeout that loses
    // the race against a real reply still fires the terminal frame on
    // the WS, which clobbers the in-progress awaiting_user state in
    // the SPA's task store.
    let persisted = true;
    await this.db.transaction(async (tx) => {
      const updateResult = await tx
        .update(tasks)
        .set(update)
        .where(
          and(
            eq(tasks.id, taskRowId),
            inArray(tasks.status, [...taskRunnerOutcomeSourceStatuses(outcome.status)]),
          ),
        );
      const affected = extractMysqlAffectedRows(updateResult);
      if (affected === 0) {
        // Row is parked or terminal; UPDATE was a no-op. Skip the
        // event insert too — recording a `vision.completed` event
        // when the row is still waiting, paused, or already terminal
        // would be wrong / misleading.
        // eslint-disable-next-line no-console
        console.warn(
          `[task-repository] refusing illegal runner outcome → ${outcome.status} for ${taskExternalId} (state guard)`,
        );
        persisted = false;
        return;
      }
      await tx.insert(taskEvents).values({
        externalId: newExternalId('taskEvent'),
        taskId: taskRowId,
        type: `vision.${outcome.status}`,
        actor: 'system',
        payload: eventPayload,
      });
    });
    return { persisted };
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
   * Reads every `tasks` row whose status is non-terminal (pending /
   * planning / queued / executing / awaiting_user / paused) together with the
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

  /**
   * Phase 1 #4 — 原子抢占一条视频报价任务的「确认 → 生成」权。条件更新:仅当
   * `result.metadata.lane` 仍是 'video_creation_confirm' 才翻成 '..._consumed'。
   * 返回 true = 本次抢到(可生成);false = 已被别的请求消费(双击/二次确认)→ 不重烧。
   * 单一报价 ⇒ 至多一次扣费。MySQL UPDATE affectedRows = 实际改变行数(值由 confirm→
   * consumed,故匹配行 affectedRows=1;二次 WHERE 不再匹配 → 0)。真 MySQL 上实测。
   */
  async consumeVideoConfirm(taskExternalId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE tasks
      SET result = JSON_SET(result, '$.metadata.lane', 'video_creation_consumed')
      WHERE external_id = ${taskExternalId}
        AND JSON_UNQUOTE(JSON_EXTRACT(result, '$.metadata.lane')) = 'video_creation_confirm'
    `);
    const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
    return (header?.affectedRows ?? 0) === 1;
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
      .where(inArray(tasks.status, [...TASK_ACTIVE_STATUSES]));

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

      // Cursor = first step that has not reached a settled ledger status.
      let cursor = steps.findIndex((s) => !isSettledStepStatus(s.status));
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

// ---------- helpers ----------

function eventTypeFor(prev: TaskState, next: TaskState): string {
  if (next.status === 'failed') return 'step.failed';
  if (next.status === 'awaiting_user') return 'step.awaiting_user';
  if (next.status === 'cancelled') return 'task.cancelled';
  if (next.status === 'completed') return 'task.completed';
  if (next.status === 'partial_success') return 'task.partial_success';
  if (next.status === 'paused') return 'task.paused';
  if (next.cursor > prev.cursor) return 'step.completed';
  return 'task.transition';
}

function controlEventType(prev: TaskState, next: TaskState): string {
  if (next.status === 'paused') return 'task.paused';
  if (prev.status === 'paused' && next.status === 'executing') return 'task.resumed';
  if (next.status === 'cancelled') return 'task.cancelled';
  if (next.status === 'completed') return 'task.completed';
  if (next.status === 'partial_success') return 'task.partial_success';
  if (next.status === 'failed') return 'task.failed';
  return 'task.transition';
}

function isSettledStepStatus(status: string | null | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped' ||
    status === 'partial_success'
  );
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
