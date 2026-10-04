/**
 * Batch 10.3 — planned-run outcomes feed the failure streak and the
 * configured outcome notifier.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configurePlannedOutcomeNotifier, syncPlannedRuns } from './planned-runner.js';

function tableName(table: unknown): string {
  return (table as Record<symbol, string> | undefined)?.[Symbol.for('drizzle:Name')] ?? '';
}

function makeDb(opts: {
  taskStatus: string;
  taskError?: string | null;
  plan?: Record<string, unknown>;
  ownerStatus?: string;
}) {
  const sets: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rowsFor = (name: string): unknown[] => {
    if (name === 'planned_task_runs') return [{ id: 1, planId: 7, taskId: 99, batchTaskId: null }];
    if (name === 'tasks') return [{ status: opts.taskStatus, errorMessage: opts.taskError ?? null }];
    if (name === 'planned_tasks') {
      return [
        {
          userId: 42,
          title: '竞品周报',
          consecutiveFailures: 2,
          failureNotifyThreshold: 2,
          notifyOnSuccess: false,
          ...opts.plan,
        },
      ];
    }
    if (name === 'users') return [{ status: opts.ownerStatus ?? 'active' }];
    return [];
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => rowsFor(tableName(table))) })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          sets.push({ table: tableName(table), values });
          return { affectedRows: 1 };
        }),
      })),
    })),
    transaction: undefined as unknown,
  };
  db.transaction = async (callback: (tx: unknown) => unknown) => callback(db);
  return { db: db as never, sets };
}

afterEach(() => {
  configurePlannedOutcomeNotifier(null);
});

describe('syncPlannedRuns — Batch 10.3 outcome notifications', () => {
  it('a failed task increments the plan streak and notifies with the stored prefs', async () => {
    const notifier = vi.fn(async () => undefined);
    configurePlannedOutcomeNotifier(notifier);
    const { db, sets } = makeDb({ taskStatus: 'failed', taskError: '登录过期' });
    await expect(syncPlannedRuns(db)).resolves.toBe(1);

    const planSet = sets.find((entry) => entry.table === 'planned_tasks');
    expect(planSet?.values).toMatchObject({ lastRunStatus: 'failed', lastError: '登录过期' });
    // SQL increment, not a stale absolute value.
    expect(planSet?.values.consecutiveFailures).toBeTypeOf('object');
    expect(notifier).toHaveBeenCalledWith({
      userInternalId: 42,
      plannedTaskInternalId: 7,
      title: '竞品周报',
      outcome: 'failed',
      phase: 'task_terminal',
      error: '登录过期',
      consecutiveFailures: 2,
      failureNotifyThreshold: 2,
      notifyOnSuccess: false,
    });
  });

  it('a completed task resets the streak to 0 and reports success', async () => {
    const notifier = vi.fn(async () => undefined);
    configurePlannedOutcomeNotifier(notifier);
    const { db, sets } = makeDb({ taskStatus: 'completed', plan: { consecutiveFailures: 0 } });
    await syncPlannedRuns(db);
    const planSet = sets.find((entry) => entry.table === 'planned_tasks');
    expect(planSet?.values).toMatchObject({ lastRunStatus: 'completed', consecutiveFailures: 0 });
    expect(notifier).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
  });

  it('a cancelled task leaves the streak untouched', async () => {
    configurePlannedOutcomeNotifier(vi.fn(async () => undefined));
    const { db, sets } = makeDb({ taskStatus: 'cancelled' });
    await syncPlannedRuns(db);
    const planSet = sets.find((entry) => entry.table === 'planned_tasks');
    expect(planSet?.values).not.toHaveProperty('consecutiveFailures');
  });

  it('skips the notifier for an owner in account closure', async () => {
    const notifier = vi.fn(async () => undefined);
    configurePlannedOutcomeNotifier(notifier);
    const { db } = makeDb({ taskStatus: 'failed', ownerStatus: 'closure_pending' });
    await syncPlannedRuns(db);
    expect(notifier).not.toHaveBeenCalled();
  });

  it('a throwing notifier never breaks settlement', async () => {
    configurePlannedOutcomeNotifier(vi.fn(async () => {
      throw new Error('webhook down');
    }));
    const { db } = makeDb({ taskStatus: 'failed' });
    await expect(syncPlannedRuns(db)).resolves.toBe(1);
  });
});
