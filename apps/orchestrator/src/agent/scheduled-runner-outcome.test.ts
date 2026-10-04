/**
 * Batch 10.3 — scheduled-task failure streak + terminal-outcome settle pass.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  settleScheduledTaskOutcomes,
  startScheduledRunner,
  stopScheduledRunner,
} from './scheduled-runner.js';

type Db = Parameters<typeof startScheduledRunner>[0]['db'];

function fakeSelectRows(rows: unknown[]) {
  const terminal = () => Object.assign(Promise.resolve(rows), { for: vi.fn(async () => rows) });
  return Object.assign(Promise.resolve(rows), {
    limit: vi.fn(() => terminal()),
    for: vi.fn(async () => rows),
  });
}

/** Dispatch-path fake: candidates scan, owner gate, claim + finalize updates. */
function makeDispatchDb(rows: Array<Record<string, unknown>>) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() =>
          fakeSelectRows(selection && Object.hasOwn(selection, 'status') ? [{ status: 'active' }] : rows),
        ),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push(values);
          return { affectedRows: 1 };
        }),
      })),
    })),
    transaction: undefined as unknown,
  };
  db.transaction = (callback: (tx: unknown) => unknown) => callback(db);
  return { db: db as unknown as Db, updates };
}

/** Settle-path fake: join scan + CAS update + owner gate. */
function makeSettleDb(
  joined: Array<Record<string, unknown>>,
  opts: { casWins?: boolean; ownerStatus?: string } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => joined) })),
        })),
        where: vi.fn(() =>
          fakeSelectRows(
            selection && Object.hasOwn(selection, 'status')
              ? [{ status: opts.ownerStatus ?? 'active' }]
              : [],
          ),
        ),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push(values);
          return { affectedRows: opts.casWins === false ? 0 : 1 };
        }),
      })),
    })),
  };
  return { db: db as unknown as Db, updates };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(() => {
  stopScheduledRunner();
});

describe('scheduled runner — failure streak on dispatch', () => {
  it('a failed dispatch extends the streak and reports it to notify', async () => {
    const { db, updates } = makeDispatchDb([
      {
        id: 21,
        userId: 42,
        intent: 'daily report',
        repeatType: 'daily',
        rrule: null,
        consecutiveFailures: 2,
        failureNotifyThreshold: 3,
        notifyOnSuccess: false,
      },
    ]);
    const notify = vi.fn(async () => undefined);
    startScheduledRunner({ db, dispatch: vi.fn(async () => null), notify, pollIntervalMs: 60_000 });
    await tick();
    expect(updates[1]).toMatchObject({
      lastRunStatus: 'failed',
      consecutiveFailures: 3,
      pendingTaskId: null,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'dispatch',
        ok: false,
        outcome: 'failed',
        consecutiveFailures: 3,
        failureNotifyThreshold: 3,
        notifyOnSuccess: false,
      }),
    );
  });

  it('a created task is parked in pending_task_id without touching the streak', async () => {
    const { db, updates } = makeDispatchDb([
      { id: 22, userId: 42, intent: 'x', repeatType: 'daily', rrule: null, consecutiveFailures: 4 },
    ]);
    const notify = vi.fn(async () => undefined);
    startScheduledRunner({ db, dispatch: vi.fn(async () => 999), notify, pollIntervalMs: 60_000 });
    await tick();
    expect(updates[1]).toMatchObject({
      lastRunStatus: 'success',
      lastTaskId: 999,
      pendingTaskId: 999,
      consecutiveFailures: 4,
    });
    const call = (notify.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call).toMatchObject({ phase: 'dispatch', ok: true });
    expect(call).not.toHaveProperty('outcome');
  });

  it('an inline completion resets the streak and never stamps a fake task id', async () => {
    const { db, updates } = makeDispatchDb([
      { id: 23, userId: 42, intent: 'briefing', repeatType: 'daily', rrule: null, consecutiveFailures: 5 },
    ]);
    const notify = vi.fn(async () => undefined);
    startScheduledRunner({
      db,
      dispatch: vi.fn(async () => ({ completed: true as const })),
      notify,
      pollIntervalMs: 60_000,
    });
    await tick();
    expect(updates[1]).toMatchObject({
      lastRunStatus: 'success',
      consecutiveFailures: 0,
      pendingTaskId: null,
    });
    expect(updates[1]).not.toHaveProperty('lastTaskId');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, outcome: 'success', consecutiveFailures: 0 }),
    );
  });

  it('does not run the settle pass unless enabled', async () => {
    const { db } = makeSettleDb([]);
    await expect(settleScheduledTaskOutcomes({ db, dispatch: vi.fn() })).resolves.toBe(0);
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });
});

describe('settleScheduledTaskOutcomes', () => {
  const base = {
    id: 31,
    userId: 42,
    intent: '抓取竞品价格',
    pendingTaskId: 555,
    consecutiveFailures: 1,
    failureNotifyThreshold: 2,
    notifyOnSuccess: false,
  };

  it('a failed task extends the streak, records the error and notifies task_terminal', async () => {
    const { db, updates } = makeSettleDb([{ ...base, taskStatus: 'failed', taskError: '页面超时' }]);
    const notify = vi.fn(async () => undefined);
    const settled = await settleScheduledTaskOutcomes({
      db,
      dispatch: vi.fn(),
      notify,
      settleTaskOutcomes: true,
    });
    expect(settled).toBe(1);
    expect(updates).toEqual([
      { pendingTaskId: null, consecutiveFailures: 2, lastRunStatus: 'failed', lastError: '页面超时' },
    ]);
    expect(notify).toHaveBeenCalledWith({
      userInternalId: 42,
      scheduledTaskInternalId: 31,
      intent: '抓取竞品价格',
      ok: false,
      error: '页面超时',
      phase: 'task_terminal',
      outcome: 'failed',
      consecutiveFailures: 2,
      failureNotifyThreshold: 2,
      notifyOnSuccess: false,
    });
  });

  it('a completed task resets the streak and keeps last_run_status', async () => {
    const { db, updates } = makeSettleDb([
      { ...base, notifyOnSuccess: true, taskStatus: 'completed', taskError: null },
    ]);
    const notify = vi.fn(async () => undefined);
    await settleScheduledTaskOutcomes({ db, dispatch: vi.fn(), notify, settleTaskOutcomes: true });
    expect(updates).toEqual([{ pendingTaskId: null, consecutiveFailures: 0 }]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, outcome: 'success', notifyOnSuccess: true }),
    );
  });

  it('a cancelled task neither extends nor resets the streak', async () => {
    const { db, updates } = makeSettleDb([{ ...base, taskStatus: 'cancelled', taskError: null }]);
    const notify = vi.fn(async () => undefined);
    await settleScheduledTaskOutcomes({ db, dispatch: vi.fn(), notify, settleTaskOutcomes: true });
    expect(updates).toEqual([{ pendingTaskId: null, consecutiveFailures: 1 }]);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'cancelled' }));
  });

  it('does not notify when the CAS loses (re-dispatched or settled elsewhere)', async () => {
    const { db } = makeSettleDb([{ ...base, taskStatus: 'failed', taskError: 'x' }], {
      casWins: false,
    });
    const notify = vi.fn(async () => undefined);
    await expect(
      settleScheduledTaskOutcomes({ db, dispatch: vi.fn(), notify, settleTaskOutcomes: true }),
    ).resolves.toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify an owner who is closing the account', async () => {
    const { db } = makeSettleDb([{ ...base, taskStatus: 'failed', taskError: 'x' }], {
      ownerStatus: 'closure_pending',
    });
    const notify = vi.fn(async () => undefined);
    await settleScheduledTaskOutcomes({ db, dispatch: vi.fn(), notify, settleTaskOutcomes: true });
    expect(notify).not.toHaveBeenCalled();
  });
});
