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
import { TaskRepository } from './task-repository.js';

interface Captured {
  /** count of insert(taskEvents) calls — proxies "did the event log fire". */
  eventInserts: number;
  /** count of update calls inside a transaction */
  txUpdates: number;
  taskUpdate: Record<string, unknown> | null;
  eventPayload: Record<string, unknown> | null;
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
      where: async () => {
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
      expect.stringContaining('refusing to overwrite awaiting_user'),
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
