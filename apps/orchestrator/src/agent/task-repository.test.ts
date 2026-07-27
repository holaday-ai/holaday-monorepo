/**
 * Phase 3 R1 — unit tests for the awaiting_user state-machine guard
 * in `TaskRepository.persistVisionOutcome`. Heavyweight DB tests live
 * in `task-repository.integration.test.ts`; this file uses a minimal
 * fake `DB` that records writes so we can assert the guard skipped
 * the event insert when the row was already parked.
 *
 * Phase 3 R1 (Codex follow-up) — guard is now atomic. The UPDATE
 * itself filters out awaiting_user rows; we mock affectedRows on
 * the fake to drive both branches.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DB } from '../db/client.js';
import type { TaskState } from './task-controller.js';
import { TaskRepository } from './task-repository.js';

interface Captured {
  /** count of insert(taskEvents) calls — proxies "did the event log fire". */
  eventInserts: number;
  /** count of update calls inside a transaction */
  txUpdates: number;
  taskUpdate: Record<string, unknown> | null;
  eventPayload: Record<string, unknown> | null;
  whereClauses: unknown[];
  transactionRan: boolean;
}

/**
 * Build a fake `DB` whose `update().set().where()` returns a result
 * with the given `affectedRows`. 0 → guard refused; 1 → guard passed.
 */
function fakeDbWithAffectedRows(affectedRows: number) {
  const captured: Captured = {
    eventInserts: 0,
    txUpdates: 0,
    taskUpdate: null,
    eventPayload: null,
    whereClauses: [],
    transactionRan: false,
  };

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 1 }],
      }),
    }),
  });

  const update = () => ({
    set: (payload: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        captured.whereClauses.push(condition);
        captured.txUpdates += 1;
        captured.taskUpdate = payload;
        return [{ affectedRows }];
      },
    }),
  });

  const insert = () => ({
    values: async (payload: Record<string, unknown>) => {
      captured.eventInserts += 1;
      captured.eventPayload = payload;
      return undefined;
    },
  });

  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactionRan = true;
    await cb({ update, insert });
  };

  const db = { select, update, insert, transaction } as unknown as DB;
  return { db, captured };
}

function collectDrizzleParamValues(input: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(input)) {
    for (const item of input) collectDrizzleParamValues(item, out);
    return out;
  }
  if (!input || typeof input !== 'object') return out;
  const record = input as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (record.constructor?.name === 'Param') {
    out.push(record.value);
  }
  if (Array.isArray(record.queryChunks)) {
    collectDrizzleParamValues(record.queryChunks, out);
  }
  return out;
}

function fakeDbForStateTransitions(affectedRows = 1) {
  const captured = {
    updatePayloads: [] as Record<string, unknown>[],
    eventPayloads: [] as Record<string, unknown>[],
    whereClauses: [] as unknown[],
    transactionRan: false,
  };

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 1 }],
      }),
    }),
  });

  const update = () => ({
    set: (payload: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        captured.whereClauses.push(condition);
        captured.updatePayloads.push(payload);
        return [{ affectedRows }];
      },
    }),
  });

  const insert = () => ({
    values: async (payload: Record<string, unknown>) => {
      captured.eventPayloads.push(payload);
      return undefined;
    },
  });

  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactionRan = true;
    await cb({ update, insert });
  };

  const db = { select, update, insert, transaction } as unknown as DB;
  return { db, captured };
}

function fakeDbForExecute(affectedRows = 1) {
  const captured = {
    statements: [] as unknown[],
    eventPayloads: [] as Record<string, unknown>[],
    transactionRan: false,
  };
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ id: 1 }],
      }),
    }),
  });
  const execute = async (statement: unknown) => {
    captured.statements.push(statement);
    return [{ affectedRows }];
  };
  const insert = () => ({
    values: async (payload: Record<string, unknown>) => {
      captured.eventPayloads.push(payload);
      return undefined;
    },
  });
  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactionRan = true;
    await cb({ execute, insert });
  };
  const db = { execute, select, transaction } as unknown as DB;
  return { db, captured };
}

function collectSqlText(input: unknown): string {
  if (Array.isArray(input)) {
    return input.map((item) => collectSqlText(item)).join('');
  }
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  const record = input as { queryChunks?: unknown[]; value?: unknown };
  const ownValue = Array.isArray(record.value)
    ? record.value.filter((item): item is string => typeof item === 'string').join('')
    : '';
  const childValue = Array.isArray(record.queryChunks)
    ? record.queryChunks.map((item) => collectSqlText(item)).join('')
    : '';
  return `${ownValue}${childValue}`;
}

describe('TaskRepository.persistVisionOutcome — awaiting_user state guard (Phase 3 R1, atomic)', () => {
  it('UPDATE no-op (affectedRows=0) → row was awaiting_user → no event log, console.warn fires, persisted=false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithAffectedRows(0);
    const repo = new TaskRepository(db);

    const result = await repo.persistVisionOutcome('tsk_aw_completed', {
      status: 'completed',
      summary: 'late finish text',
      tickCount: 12,
    });

    expect(captured.transactionRan).toBe(true);
    expect(captured.txUpdates).toBe(1);
    // Crucially: the event row was NOT inserted because the guard
    // tripped on affectedRows=0.
    expect(captured.eventInserts).toBe(0);
    // Codex P3 follow-up — surfaces refusal to callers via persisted flag.
    expect(result.persisted).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing illegal runner outcome'),
    );
    warnSpy.mockRestore();
  });

  it('UPDATE no-op for failed write attempt → no event row', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithAffectedRows(0);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_aw_failed', {
      status: 'failed',
      reason: 'late takeover-window timeout',
      tickCount: 8,
    });

    expect(captured.eventInserts).toBe(0);
    warnSpy.mockRestore();
  });

  it('UPDATE no-op for cancelled write attempt → no event row', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithAffectedRows(0);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_aw_cancelled', {
      status: 'cancelled',
      tickCount: 5,
    });

    expect(captured.eventInserts).toBe(0);
    warnSpy.mockRestore();
  });

  it('UPDATE applied (affectedRows=1) → event row written (executing → completed happy path), persisted=true', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    const result = await repo.persistVisionOutcome('tsk_exec_done', {
      status: 'completed',
      summary: 'final answer',
      tickCount: 3,
    });

    expect(captured.transactionRan).toBe(true);
    expect(captured.eventInserts).toBe(1);
    expect(result.persisted).toBe(true);
  });

  it('clears stale awaiting fields on terminal runner outcomes', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_exec_done', {
      status: 'completed',
      summary: 'final answer',
      tickCount: 3,
    });

    expect(captured.taskUpdate).toMatchObject({
      status: 'completed',
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('clears stale task errors on successful terminal runner outcomes', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_exec_done', {
      status: 'completed',
      summary: 'final answer',
      tickCount: 3,
    });

    expect(captured.taskUpdate).toMatchObject({
      status: 'completed',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('persists an explicit passed verification verdict with the terminal outcome', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_video_verified', {
      status: 'completed',
      summary: '视频已生成',
      tickCount: 1,
      verificationPassed: true,
    });

    expect(captured.taskUpdate).toMatchObject({
      status: 'completed',
      verificationPassed: true,
    });
  });

  it('guards completed writes to active running rows at SQL level', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_guard_scope', {
      status: 'completed',
      summary: 'final answer',
      tickCount: 3,
    });

    const params = collectDrizzleParamValues(captured.whereClauses.at(-1));
    expect(params).toEqual(
      expect.arrayContaining([
        1,
        'pending',
        'planning',
        'queued',
        'executing',
      ]),
    );
    expect(params).not.toContain('paused');
    expect(params).not.toContain('awaiting_user');
    expect(params).not.toContain('completed');
    expect(params).not.toContain('partial_success');
    expect(params).not.toContain('failed');
    expect(params).not.toContain('cancelled');
  });

  it('allows cancelled writes from paused rows but not terminal rows', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_cancel_guard_scope', {
      status: 'cancelled',
      tickCount: 3,
    });

    const params = collectDrizzleParamValues(captured.whereClauses.at(-1));
    expect(params).toEqual(
      expect.arrayContaining([
        1,
        'pending',
        'planning',
        'queued',
        'executing',
        'paused',
      ]),
    );
    expect(params).not.toContain('awaiting_user');
    expect(params).not.toContain('completed');
    expect(params).not.toContain('partial_success');
    expect(params).not.toContain('failed');
    expect(params).not.toContain('cancelled');
  });

  it('UPDATE applied → event row written (executing → failed)', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_exec_failed', {
      status: 'failed',
      reason: 'API timeout',
      tickCount: 2,
    });

    expect(captured.eventInserts).toBe(1);
  });

  it('persists verifier failedChecks for partial_success history/detail reloads', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);
    const failedChecks = [{ type: 'source_count', detail: '缺少来源链接' }];

    await repo.persistVisionOutcome('tsk_partial_checks', {
      status: 'partial_success',
      summary: '已找到 2 个结果',
      tickCount: 4,
      failedChecks,
    });

    expect(captured.taskUpdate?.result).toMatchObject({
      summary: '已找到 2 个结果',
      failedChecks,
    });
  });

  it('persists verifier failedChecks for hard-failed quality gates', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);
    const failedChecks = [{ type: 'price_sort', detail: '价格排序不可信' }];

    await repo.persistVisionOutcome('tsk_failed_checks', {
      status: 'failed',
      reason: '质量校验未通过',
      tickCount: 2,
      failedChecks,
    });

    expect(captured.taskUpdate?.result).toMatchObject({
      reason: '质量校验未通过',
      failedChecks,
    });
  });

  it('persists an explicit failed verification verdict with a hard-failed quality gate', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_failed_verification', {
      status: 'failed',
      reason: '成片质检未通过',
      tickCount: 1,
      verificationPassed: false,
    });

    expect(captured.taskUpdate).toMatchObject({
      status: 'failed',
      verificationPassed: false,
    });
  });

  it('UPDATE applied → event row written (paused → cancelled)', async () => {
    const { db, captured } = fakeDbWithAffectedRows(1);
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_paused_cancel', {
      status: 'cancelled',
      tickCount: 1,
    });

    expect(captured.eventInserts).toBe(1);
  });
});

describe('TaskRepository task terminal state persistence', () => {
  const baseState: TaskState = {
    taskId: 'tsk_state_machine',
    status: 'executing',
    plan: [{ id: 'stp_terminal', kind: 'extract', risk: 'low' }],
    cursor: 0,
    pendingConfirm: null,
  };

  it('applyStepResult treats partial_success as terminal for completedAt and event ledger', async () => {
    const { db, captured } = fakeDbForStateTransitions();
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'partial_success',
      cursor: 1,
    };

    await repo.applyStepResult(baseState, next, { summary: 'result needs review' });

    expect(captured.transactionRan).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'partial_success',
      pauseReason: null,
    });
    expect(captured.updatePayloads[0]?.completedAt).toBeInstanceOf(Date);
    expect(captured.updatePayloads[1]).toMatchObject({
      status: 'completed',
      output: { summary: 'result needs review' },
      pendingConfirmPayload: null,
    });
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.partial_success',
      actor: 'system',
      payload: { summary: 'result needs review' },
    });
  });

  it('applyStepResult guards task updates with the previous DB status', async () => {
    const { db, captured } = fakeDbForStateTransitions();
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    await repo.applyStepResult(baseState, next, { summary: 'done' });

    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining([1, 'executing']));
  });

  it('applyStepResult skips step and event writes when the previous status guard refuses the task update', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    await repo.applyStepResult(baseState, next, { summary: 'stale done' });

    expect(captured.updatePayloads).toHaveLength(1);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyStepResult reports when the guarded task update is refused', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    const result = await repo.applyStepResult(baseState, next, { summary: 'stale done' });

    expect(result.persisted).toBe(false);
  });

  it('applyStepResult reports when the guarded task update is persisted', async () => {
    const { db } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    const result = await repo.applyStepResult(baseState, next, { summary: 'done' });

    expect(result.persisted).toBe(true);
  });

  it('applyStepResult refuses source states that cannot receive step results', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      ...baseState,
      status: 'cancelled',
    };
    const next: TaskState = {
      ...prev,
      status: 'completed',
      cursor: 1,
    };

    const result = await repo.applyStepResult(prev, next, { summary: 'late result' });

    expect(result.persisted).toBe(false);
    expect(captured.transactionRan).toBe(false);
    expect(captured.updatePayloads).toHaveLength(0);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyStepResult clears stale awaiting fields on non-awaiting transitions', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    await repo.applyStepResult(baseState, next, { summary: 'done' });

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'completed',
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('applyStepResult clears stale task errors after a successful step', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'completed',
      cursor: 1,
    };

    await repo.applyStepResult(baseState, next, { summary: 'done' });

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'completed',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('applyControlTransition treats partial_success as terminal for completedAt and event ledger', async () => {
    const { db, captured } = fakeDbForStateTransitions();
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'partial_success',
    };

    await repo.applyControlTransition(baseState, next);

    expect(captured.transactionRan).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'partial_success',
      pauseReason: null,
    });
    expect(captured.updatePayloads[0]?.completedAt).toBeInstanceOf(Date);
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.partial_success',
      actor: 'user',
    });
  });

  it('applyControlTransition guards updates with the previous DB status', async () => {
    const { db, captured } = fakeDbForStateTransitions();
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'user',
    };

    await repo.applyControlTransition(baseState, next);

    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining([1, 'executing']));
  });

  it('applyControlTransition skips event logging when the previous status guard refuses the update', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'user',
    };

    await repo.applyControlTransition(baseState, next);

    expect(captured.updatePayloads).toHaveLength(1);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyControlTransition reports when the guarded task update is refused', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'user',
    };

    const result = await repo.applyControlTransition(baseState, next);

    expect(result.persisted).toBe(false);
  });

  it('applyControlTransition reports when the guarded task update is persisted', async () => {
    const { db } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'user',
    };

    const result = await repo.applyControlTransition(baseState, next);

    expect(result.persisted).toBe(true);
  });

  it('applyControlTransition refuses terminal source states', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      ...baseState,
      status: 'completed',
    };
    const next: TaskState = {
      ...prev,
      status: 'paused',
      pauseReason: 'user',
    };

    const result = await repo.applyControlTransition(prev, next);

    expect(result.persisted).toBe(false);
    expect(captured.transactionRan).toBe(false);
    expect(captured.updatePayloads).toHaveLength(0);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyControlTransition refuses pause from non-executing source states', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    for (const status of ['pending', 'planning', 'queued', 'awaiting_user', 'paused'] as const) {
      const prev: TaskState = {
        ...baseState,
        status,
      };
      const next: TaskState = {
        ...prev,
        status: 'paused',
        pauseReason: 'user',
      };

      const result = await repo.applyControlTransition(prev, next);

      expect(result.persisted).toBe(false);
    }

    expect(captured.transactionRan).toBe(false);
    expect(captured.updatePayloads).toHaveLength(0);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyControlTransition refuses resume from non-paused source states', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    for (const status of ['pending', 'planning', 'queued', 'executing', 'awaiting_user'] as const) {
      const prev: TaskState = {
        ...baseState,
        status,
      };
      const next: TaskState = {
        ...prev,
        status: 'executing',
        pauseReason: null,
      };

      const result = await repo.applyControlTransition(prev, next);

      expect(result.persisted).toBe(false);
    }

    expect(captured.transactionRan).toBe(false);
    expect(captured.updatePayloads).toHaveLength(0);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyControlTransition clears awaiting fields when cancelling a parked task', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      ...baseState,
      status: 'awaiting_user',
      pendingConfirm: null,
    };
    const next: TaskState = {
      ...prev,
      status: 'cancelled',
    };

    await repo.applyControlTransition(prev, next);

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'cancelled',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('applyControlTransition clears stale awaiting fields on every non-awaiting transition', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const next: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'user',
    };

    await repo.applyControlTransition(baseState, next);

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'paused',
      pauseReason: 'user',
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('applyControlTransition clears stale task errors when resuming', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      ...baseState,
      status: 'paused',
      pauseReason: 'retries_exhausted',
      error: { code: 'NAV_TIMEOUT', message: 'page never loaded' },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pauseReason: null,
      error: undefined,
    };

    await repo.applyControlTransition(prev, next);

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('recordCancelRequested writes a user event without changing task status', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.recordCancelRequested('tsk_state_machine', 'executing');

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads).toHaveLength(0);
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.cancel_requested',
      actor: 'user',
      payload: { from: 'executing', reason: 'user_abort' },
    });
  });

  it('applyBatchApprove guards updates with the previous DB status', async () => {
    const { db, captured } = fakeDbForStateTransitions();
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
    };

    await repo.applyBatchApprove(prev, next);

    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining([1, 'awaiting_user']));
  });

  it('applyBatchApprove skips step and event writes when the previous status guard refuses the task update', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
    };

    await repo.applyBatchApprove(prev, next);

    expect(captured.updatePayloads).toHaveLength(1);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('applyBatchApprove reports when the guarded task update is refused', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
    };

    const result = await repo.applyBatchApprove(prev, next);

    expect(result.persisted).toBe(false);
  });

  it('applyBatchApprove reports when the guarded task update is persisted', async () => {
    const { db } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
    };

    const result = await repo.applyBatchApprove(prev, next);

    expect(result.persisted).toBe(true);
  });

  it('applyBatchApprove refuses non-batch or non-awaiting source states', async () => {
    const cases: TaskState[] = [
      {
        taskId: 'tsk_state_machine',
        status: 'executing',
        plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
        cursor: 0,
        pendingConfirm: null,
      },
      {
        taskId: 'tsk_state_machine',
        status: 'awaiting_user',
        plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
        cursor: 0,
        pendingConfirm: {
          kind: 'single',
          stepId: 'stp_batch',
          prompt: '确认继续？',
          risk: 'high',
        },
      },
    ];

    for (const prev of cases) {
      const { db, captured } = fakeDbForStateTransitions(1);
      const repo = new TaskRepository(db);
      const result = await repo.applyBatchApprove(prev, {
        ...prev,
        status: 'executing',
        pendingConfirm: null,
      });

      expect(result.persisted).toBe(false);
      expect(captured.transactionRan).toBe(false);
      expect(captured.updatePayloads).toHaveLength(0);
      expect(captured.eventPayloads).toHaveLength(0);
    }
  });

  it('applyBatchApprove clears stale awaiting fields when resuming execution', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
    };

    await repo.applyBatchApprove(prev, next);

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('applyBatchApprove clears stale task errors when resuming execution', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const prev: TaskState = {
      taskId: 'tsk_state_machine',
      status: 'awaiting_user',
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'high' }],
      cursor: 0,
      pendingConfirm: {
        kind: 'batch',
        stepId: 'stp_batch',
        batchIndex: 0,
        batchTotal: 2,
        items: [{ label: 'First draft', preview: 'Send first draft' }],
        risk: 'high',
      },
      error: { code: 'PREV_ERROR', message: 'previous attempt failed' },
    };
    const next: TaskState = {
      ...prev,
      status: 'executing',
      pendingConfirm: null,
      error: undefined,
    };

    await repo.applyBatchApprove(prev, next);

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('markAwaitingReplyResumed only resumes rows that are still awaiting_user', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.markAwaitingReplyResumed('tsk_state_machine');

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'awaiting_user']));
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.resumed',
      actor: 'user',
    });
  });

  it('markAwaitingReplyResumed reports stale rows without pretending to resume', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.markAwaitingReplyResumed('tsk_state_machine');

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('markAwaitingReplyCompleted only completes rows that are still awaiting_user', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.markAwaitingReplyCompleted('tsk_state_machine', {
      summary: 'handoff created',
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'completed',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
      result: { summary: 'handoff created' },
    });
    expect(captured.updatePayloads[0]?.completedAt).toBeInstanceOf(Date);
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'awaiting_user']));
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.completed',
      actor: 'system',
      payload: { summary: 'handoff created' },
    });
  });

  it('markAwaitingReplyCompleted reports stale rows without completing them', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.markAwaitingReplyCompleted('tsk_state_machine', {
      summary: 'handoff created',
    });

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('patchCompletedTaskResult only patches rows that are still completed', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.patchCompletedTaskResult('tsk_state_machine', {
      summary: 'handoff ready',
      handoffTaskId: 'tsk_handoff',
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toEqual({
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
      errorCode: null,
      errorMessage: null,
      result: {
        summary: 'handoff ready',
        handoffTaskId: 'tsk_handoff',
      },
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'completed']));
  });

  it('patchCompletedTaskResult reports stale rows without pretending to patch', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.patchCompletedTaskResult('tsk_state_machine', {
      summary: 'late handoff',
    });

    expect(result.persisted).toBe(false);
  });

  it('persistAwaitingUser only parks active runner rows', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.persistAwaitingUser({
      taskExternalId: 'tsk_state_machine',
      question: '请补充目标城市',
      awaitingKind: 'clarification',
      result: { executionMode: 'generate' },
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      pauseReason: null,
      status: 'awaiting_user',
      awaitingQuestion: '请补充目标城市',
      awaitingKind: 'clarification',
      result: { executionMode: 'generate' },
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(
      expect.arrayContaining([
        'tsk_state_machine',
        'pending',
        'planning',
        'queued',
        'executing',
      ]),
    );
    expect(params).not.toContain('awaiting_user');
    expect(params).not.toContain('completed');
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.awaiting_user',
      actor: 'system',
      payload: {
        awaitingKind: 'clarification',
        question: '请补充目标城市',
      },
    });
  });

  it('persistAwaitingUser reports stale rows without inserting an event', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.persistAwaitingUser({
      taskExternalId: 'tsk_state_machine',
      question: '请补充目标城市',
      awaitingKind: 'clarification',
      result: { executionMode: 'generate' },
    });

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('persistInitialAwaitingUser initializes an already-parked task with an awaiting event', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.persistInitialAwaitingUser({
      taskExternalId: 'tsk_state_machine',
      question: '确认后开始生成视频',
      awaitingKind: 'video_quote',
      result: {
        summary: '确认后开始生成视频',
        metadata: { lane: 'video_creation_confirm' },
      },
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      pauseReason: null,
      awaitingQuestion: '确认后开始生成视频',
      awaitingKind: 'video_quote',
      result: {
        summary: '确认后开始生成视频',
        metadata: { lane: 'video_creation_confirm' },
      },
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'awaiting_user']));
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.awaiting_user',
      actor: 'system',
      payload: {
        awaitingKind: 'video_quote',
        question: '确认后开始生成视频',
      },
    });
  });

  it('persistInitialAwaitingUser reports stale rows without inserting an event', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.persistInitialAwaitingUser({
      taskExternalId: 'tsk_state_machine',
      question: '确认后开始生成视频',
      awaitingKind: 'video_quote',
      result: { summary: '确认后开始生成视频' },
    });

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('persistAwaitingUserResult only patches result while the same awaiting kind is still parked', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.persistAwaitingUserResult({
      taskExternalId: 'tsk_state_machine',
      awaitingKind: 'login_required',
      result: {
        executionMode: 'browser',
        finalUrl: 'https://example.com/login',
      },
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      pauseReason: null,
      errorCode: null,
      errorMessage: null,
      result: {
        executionMode: 'browser',
        finalUrl: 'https://example.com/login',
      },
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(
      expect.arrayContaining(['tsk_state_machine', 'awaiting_user', 'login_required']),
    );
  });

  it('persistAwaitingUserResult reports stale rows without pretending to patch result', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.persistAwaitingUserResult({
      taskExternalId: 'tsk_state_machine',
      awaitingKind: 'login_required',
      result: { executionMode: 'browser' },
    });

    expect(result.persisted).toBe(false);
  });

  it('persistActivePlanStatus only updates active runner rows', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);
    const planStatus = [{ idx: 0, status: 'running', note: '正在打开页面' }];

    const result = await repo.persistActivePlanStatus('tsk_state_machine', planStatus);

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      planStatus,
    });
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(
      expect.arrayContaining([
        'tsk_state_machine',
        'pending',
        'planning',
        'queued',
        'executing',
      ]),
    );
    expect(params).not.toContain('awaiting_user');
    expect(params).not.toContain('completed');
  });

  it('persistActivePlanStatus reports stale rows without pretending to update plan status', async () => {
    const { db } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.persistActivePlanStatus('tsk_state_machine', [
      { idx: 0, status: 'running' },
    ]);

    expect(result.persisted).toBe(false);
  });

  it('markQueuedTaskExecuting only starts rows still queued', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.markQueuedTaskExecuting('tsk_state_machine');

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
    });
    expect(captured.updatePayloads[0]?.startedAt).toBeInstanceOf(Date);
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'queued']));
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.transition',
      actor: 'system',
      payload: { from: 'queued', to: 'executing' },
    });
  });

  it('markQueuedTaskExecuting clears stale awaiting fields', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    await repo.markQueuedTaskExecuting('tsk_state_machine');

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('markQueuedTaskExecuting clears stale task errors', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    await repo.markQueuedTaskExecuting('tsk_state_machine');

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'executing',
      errorCode: null,
      errorMessage: null,
    });
  });

  it('markQueuedTaskExecuting reports stale rows without pretending to start', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.markQueuedTaskExecuting('tsk_state_machine');

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('markQueuedTaskFailed only fails rows still queued', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    const result = await repo.markQueuedTaskFailed(
      'tsk_state_machine',
      'queue timeout: 排队等待时间过长，请稍后重试',
      { errorCode: 'QUEUE_TIMEOUT', source: 'task_queue' },
    );

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      errorCode: 'QUEUE_TIMEOUT',
      errorMessage: 'queue timeout: 排队等待时间过长，请稍后重试',
    });
    expect(captured.updatePayloads[0]?.completedAt).toBeInstanceOf(Date);
    const params = collectDrizzleParamValues(captured.whereClauses.at(0));
    expect(params).toEqual(expect.arrayContaining(['tsk_state_machine', 'queued']));
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.failed',
      actor: 'system',
      payload: {
        source: 'task_queue',
        from: 'queued',
        to: 'failed',
        errorCode: 'QUEUE_TIMEOUT',
        reason: 'queue timeout: 排队等待时间过长，请稍后重试',
      },
    });
  });

  it('markQueuedTaskFailed clears stale awaiting fields', async () => {
    const { db, captured } = fakeDbForStateTransitions(1);
    const repo = new TaskRepository(db);

    await repo.markQueuedTaskFailed('tsk_state_machine', 'queue timeout');

    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      pauseReason: null,
      awaitingQuestion: null,
      awaitingKind: null,
    });
  });

  it('markQueuedTaskFailed reports stale rows without pretending to fail', async () => {
    const { db, captured } = fakeDbForStateTransitions(0);
    const repo = new TaskRepository(db);

    const result = await repo.markQueuedTaskFailed('tsk_state_machine', 'queue timeout');

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('consumeVideoConfirm atomically completes the quote task before generation starts', async () => {
    const { db, captured } = fakeDbForExecute(1);
    const repo = new TaskRepository(db);

    const result = await repo.consumeVideoConfirm('tsk_state_machine');

    expect(result).toBe(true);
    const sqlText = collectSqlText(captured.statements[0]);
    expect(sqlText).toContain('status = \'completed\'');
    expect(sqlText).toContain('awaiting_kind = NULL');
    expect(sqlText).toContain('awaiting_question = NULL');
    expect(sqlText).toContain('pause_reason = NULL');
    expect(sqlText).toContain('error_code = NULL');
    expect(sqlText).toContain('error_message = NULL');
    expect(sqlText).toContain('video_creation_confirm');
    expect(sqlText).toContain('video_creation_consumed');
    expect(captured.transactionRan).toBe(true);
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.completed',
      actor: 'user',
      payload: {
        source: 'video_quote',
        from: 'awaiting_user',
        to: 'completed',
        reason: 'user_confirmed',
      },
    });
  });

  it('consumeVideoConfirm reports stale rows without completing the quote task', async () => {
    const { db, captured } = fakeDbForExecute(0);
    const repo = new TaskRepository(db);

    const result = await repo.consumeVideoConfirm('tsk_state_machine');

    expect(result).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('cancelVideoConfirm atomically cancels only active video quote rows', async () => {
    const { db, captured } = fakeDbForExecute(1);
    const repo = new TaskRepository(db);

    const result = await repo.cancelVideoConfirm('tsk_state_machine');

    expect(result.persisted).toBe(true);
    const sqlText = collectSqlText(captured.statements[0]);
    expect(sqlText).toContain('status = \'awaiting_user\'');
    expect(sqlText).toContain('awaiting_kind = \'video_quote\'');
    expect(sqlText).toContain('pause_reason = NULL');
    expect(sqlText).toContain('error_code = NULL');
    expect(sqlText).toContain('error_message = NULL');
    expect(sqlText).toContain('video_creation_confirm');
    expect(sqlText).toContain('video_creation_cancelled');
    expect(captured.transactionRan).toBe(true);
    expect(captured.eventPayloads[0]).toMatchObject({
      type: 'task.cancelled',
      actor: 'user',
      payload: {
        source: 'video_quote',
        from: 'awaiting_user',
        to: 'cancelled',
        reason: 'user_cancelled',
      },
    });
  });

  it('cancelVideoConfirm reports stale rows without pretending to cancel', async () => {
    const { db, captured } = fakeDbForExecute(0);
    const repo = new TaskRepository(db);

    const result = await repo.cancelVideoConfirm('tsk_state_machine');

    expect(result.persisted).toBe(false);
    expect(captured.eventPayloads).toHaveLength(0);
  });

  it('repromptVideoConfirm atomically updates only active video quote rows', async () => {
    const { db, captured } = fakeDbForExecute(1);
    const repo = new TaskRepository(db);

    const result = await repo.repromptVideoConfirm('tsk_state_machine', '请选择一个操作');

    expect(result.persisted).toBe(true);
    const sqlText = collectSqlText(captured.statements[0]);
    expect(sqlText).toContain('status = \'awaiting_user\'');
    expect(sqlText).toContain('awaiting_kind = \'video_quote\'');
    expect(sqlText).toContain('pause_reason = NULL');
    expect(sqlText).toContain('error_code = NULL');
    expect(sqlText).toContain('error_message = NULL');
    expect(sqlText).toContain('video_creation_confirm');
    expect(sqlText).toContain('请选择一个操作');
    expect(sqlText).toContain('tsk_state_machine');
  });

  it('repromptVideoConfirm reports stale rows without pretending to reprompt', async () => {
    const { db } = fakeDbForExecute(0);
    const repo = new TaskRepository(db);

    const result = await repo.repromptVideoConfirm('tsk_state_machine', '请选择一个操作');

    expect(result.persisted).toBe(false);
  });
});
