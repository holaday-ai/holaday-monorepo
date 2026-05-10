/**
 * Phase 3 R1 — unit tests for the awaiting_user state-machine guard
 * in `TaskRepository.persistVisionOutcome`. Heavyweight DB tests live
 * in `task-repository.integration.test.ts`; this file uses a minimal
 * fake `DB` that records writes so we can assert the guard skipped
 * the transaction.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DB } from '../db/client.js';
import { TaskRepository } from './task-repository.js';

interface CapturedUpdate {
  setArgs: unknown;
}

/**
 * Build a fake `DB` that returns a fixed `tasks.status` from the
 * initial SELECT and records any subsequent .update().set() calls.
 * Returning the same `chain` from every method lets a single fake
 * cover both `select` and `update` chains.
 */
function fakeDbWithStatus(currentStatus: string) {
  const captured: { updates: CapturedUpdate[]; transactionRan: boolean } = {
    updates: [],
    transactionRan: false,
  };

  const tasksRow = { id: 1, status: currentStatus };

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => [tasksRow],
      }),
    }),
  });

  const update = () => ({
    set: (setArgs: unknown) => {
      captured.updates.push({ setArgs });
      return {
        where: async () => undefined,
      };
    },
  });

  const insert = () => ({
    values: async () => undefined,
  });

  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactionRan = true;
    await cb({ update, insert });
  };

  const db = { select, update, insert, transaction } as unknown as DB;
  return { db, captured };
}

describe('TaskRepository.persistVisionOutcome — awaiting_user state guard (Phase 3 R1)', () => {
  it('refuses to overwrite awaiting_user with completed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithStatus('awaiting_user');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_aw_completed', {
      status: 'completed',
      summary: 'late finish text',
      tickCount: 12,
    });

    expect(captured.transactionRan).toBe(false);
    expect(captured.updates).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('refusing to overwrite awaiting_user'),
    );
    warnSpy.mockRestore();
  });

  it('refuses to overwrite awaiting_user with failed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithStatus('awaiting_user');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_aw_failed', {
      status: 'failed',
      reason: 'late takeover-window timeout',
      tickCount: 8,
    });

    expect(captured.transactionRan).toBe(false);
    expect(captured.updates).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('refuses to overwrite awaiting_user with cancelled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { db, captured } = fakeDbWithStatus('awaiting_user');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_aw_cancelled', {
      status: 'cancelled',
      tickCount: 5,
    });

    expect(captured.transactionRan).toBe(false);
    warnSpy.mockRestore();
  });

  it('allows executing → completed (the normal happy path)', async () => {
    const { db, captured } = fakeDbWithStatus('executing');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_exec_done', {
      status: 'completed',
      summary: 'final answer',
      tickCount: 3,
    });

    expect(captured.transactionRan).toBe(true);
  });

  it('allows executing → failed (the normal failure path)', async () => {
    const { db, captured } = fakeDbWithStatus('executing');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_exec_failed', {
      status: 'failed',
      reason: 'API timeout',
      tickCount: 2,
    });

    expect(captured.transactionRan).toBe(true);
  });

  it('allows paused → cancelled (cleanup path)', async () => {
    const { db, captured } = fakeDbWithStatus('paused');
    const repo = new TaskRepository(db);

    await repo.persistVisionOutcome('tsk_paused_cancel', {
      status: 'cancelled',
      tickCount: 1,
    });

    expect(captured.transactionRan).toBe(true);
  });
});
