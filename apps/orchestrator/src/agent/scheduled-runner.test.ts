/**
 * Phase 5a — `scheduled-runner` unit tests.
 *
 * Two scenarios that pin down the runner contract:
 *   1. `computeNextRun` advances daily / weekly / monthly correctly,
 *      returns null for one-shot triggers (so the row is marked
 *      completed instead of moved forward).
 *   2. The `tick` integration: a due row gets dispatch called, then
 *      nextRunAt advances (recurring) or status flips to completed
 *      (one-shot). Dispatch errors don't lock the row — runner still
 *      advances to avoid tight-retry on a permanently-failing
 *      schedule.
 *
 * Real DB + cron timing are NOT exercised here — those need the
 * integration-test environment with a fresh MySQL schema. The unit
 * tests guard the calculation + the row-state machine.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  computeNextRun,
  recoverStuckRunningScheduledTasks,
  startScheduledRunner,
  stopScheduledRunner,
} from './scheduled-runner.js';

describe('computeNextRun', () => {
  it('once → null (one-shot trigger marks row completed instead)', () => {
    expect(computeNextRun(new Date('2026-05-11T09:00:00Z'), 'once')).toBeNull();
  });

  it('daily → +1 day in UTC', () => {
    const next = computeNextRun(new Date('2026-05-11T09:00:00Z'), 'daily');
    expect(next?.toISOString()).toBe('2026-05-12T09:00:00.000Z');
  });

  it('weekly → +7 days in UTC', () => {
    const next = computeNextRun(new Date('2026-05-11T09:00:00Z'), 'weekly');
    expect(next?.toISOString()).toBe('2026-05-18T09:00:00.000Z');
  });

  it('monthly → +1 month in UTC, preserves day-of-month when valid', () => {
    const next = computeNextRun(new Date('2026-05-11T09:00:00Z'), 'monthly');
    expect(next?.toISOString()).toBe('2026-06-11T09:00:00.000Z');
  });

  it('monthly across DST → still +1 month (UTC math, no tz drift)', () => {
    // 2026-03-15 → 2026-04-15 spans US/EU spring DST. UTC stays clean.
    const next = computeNextRun(new Date('2026-03-15T13:30:00Z'), 'monthly');
    expect(next?.toISOString()).toBe('2026-04-15T13:30:00.000Z');
  });
});

describe('startScheduledRunner — tick integration', () => {
  /**
   * Build a fake drizzle-shaped db that returns a single due row,
   * captures every update call, and lets us assert that the runner
   * advanced next_run_at (recurring) OR set status='completed'
   * (one-shot). The shape mirrors what `tick()` actually calls:
   *   db.select(...).from(...).where(...) — returns an array
   *   db.update(...).set(...).where(...) — returns OK
   */
  /**
   * Codex P5 follow-up — the runner now does TWO updates per
   * dispatch: (1) atomic claim `status='running'`, (2) advance +
   * restore. The fake DB captures BOTH so tests can verify the
   * sequencing.
   *
   * `claimSucceeds` controls whether the claim UPDATE reports
   * affectedRows=1 (we own this row) or 0 (lost the race).
   */
  function makeFakeDb(
    rows: Array<Record<string, unknown>>,
    opts?: { claimSucceeds?: boolean },
  ) {
    const updates: Array<Record<string, unknown>> = [];
    const claimSucceeds = opts?.claimSucceeds ?? true;
    let updateCallNum = 0;
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push(values);
          updateCallNum += 1;
          // First update per row is the claim (status='running').
          // Subsequent updates (advance) always succeed.
          const isClaim = (values as { status?: string }).status === 'running';
          const affectedRows = isClaim && !claimSucceeds ? 0 : 1;
          return { affectedRows };
        }),
      })),
    }));
    return {
      db: { select, update } as unknown as Parameters<typeof startScheduledRunner>[0]['db'],
      updates,
      getUpdateCount: () => updateCallNum,
    };
  }

  it('fires dispatch and advances next_run_at for a due daily row', async () => {
    const { db, updates } = makeFakeDb([
      { id: 7, userId: 42, intent: 'run my report', repeatType: 'daily' },
    ]);
    const dispatch = vi.fn(async () => 999); // returned task internal id
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    // The runner kicks off an immediate void tick on start — give the
    // microtask queue a beat to settle before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatch).toHaveBeenCalledWith({
      scheduledTaskId: 7,
      userInternalId: 42,
      intent: 'run my report',
    });
    // Two updates per dispatch: (1) claim status='running',
    // (2) advance + restore status='active'.
    expect(updates.length).toBe(2);
    expect(updates[0]).toMatchObject({ status: 'running' });
    const advance = updates[1]!;
    expect(advance).toMatchObject({
      status: 'active',
      lastTaskId: 999,
      lastRunStatus: 'success',
      lastError: null,
    });
    expect('nextRunAt' in advance).toBe(true);
    expect((advance as { nextRunAt: Date }).nextRunAt).toBeInstanceOf(Date);
    stopScheduledRunner();
  });

  it('marks a one-shot row completed instead of advancing', async () => {
    const { db, updates } = makeFakeDb([
      { id: 8, userId: 42, intent: 'one-time export', repeatType: 'once' },
    ]);
    const dispatch = vi.fn(async () => 1000);
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(updates.length).toBe(2);
    expect(updates[0]).toMatchObject({ status: 'running' });
    const advance = updates[1]!;
    expect(advance).toMatchObject({
      status: 'completed',
      lastTaskId: 1000,
      lastRunStatus: 'success',
      lastError: null,
    });
    expect('nextRunAt' in advance).toBe(false);
    stopScheduledRunner();
  });

  it('dispatch returns null (legacy fail signal) → recurring advances + lastRunStatus="failed", no error msg', async () => {
    const { db, updates } = makeFakeDb([
      { id: 9, userId: 42, intent: 'flaky job', repeatType: 'daily' },
    ]);
    const dispatch = vi.fn(async () => null); // failed → returns null
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(updates.length).toBe(2);
    const advance = updates[1]!;
    // lastTaskId NOT set when dispatch returned null (the conditional
    // spread in the runner skips the column).
    expect('lastTaskId' in advance).toBe(false);
    // Status restored to 'active' so the row doesn't wedge in
    // 'running' for a permanently-failing dispatch. Next interval
    // will re-try (subject to the advanced next_run_at).
    expect(advance).toMatchObject({
      status: 'active',
      lastRunStatus: 'failed',
      lastError: null, // no thrown error → just a "returned null" signal
    });
    expect('nextRunAt' in advance).toBe(true);
    stopScheduledRunner();
  });

  // Codex P1 — dispatch-throw branch tests.
  it('Codex P1 — dispatch throws on RECURRING → status=active + advance + last_run_status=failed + last_error captured', async () => {
    const { db, updates } = makeFakeDb([
      { id: 11, userId: 42, intent: 'thrown daily', repeatType: 'daily' },
    ]);
    const dispatch = vi.fn(async () => {
      throw new Error('OpenAI quota exceeded (test)');
    });
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(updates.length).toBe(2);
    const advance = updates[1]!;
    // Recurring row still advances + restores to active so the next
    // interval gets another shot.
    expect(advance).toMatchObject({
      status: 'active',
      lastRunStatus: 'failed',
      lastError: 'OpenAI quota exceeded (test)',
    });
    expect('nextRunAt' in advance).toBe(true);
    expect('lastTaskId' in advance).toBe(false);
    stopScheduledRunner();
  });

  it('Codex P1 — dispatch throws on ONE-SHOT → status=failed (NOT completed) + last_error captured', async () => {
    // The bug Codex flagged: a one-shot scheduled task whose dispatch
    // failed used to land at status='completed' — indistinguishable
    // from a successful run. The new behaviour marks it 'failed' so
    // the SPA renders a red "已失败" badge with the error tooltip.
    const { db, updates } = makeFakeDb([
      { id: 12, userId: 42, intent: 'thrown once', repeatType: 'once' },
    ]);
    const dispatch = vi.fn(async () => {
      throw new Error('quota gate rejected the dispatch');
    });
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(updates.length).toBe(2);
    const advance = updates[1]!;
    expect(advance).toMatchObject({
      status: 'failed',
      lastRunStatus: 'failed',
      lastError: 'quota gate rejected the dispatch',
    });
    expect('nextRunAt' in advance).toBe(false);
    expect('lastTaskId' in advance).toBe(false);
    stopScheduledRunner();
  });

  it('Codex P1 — dispatch error message > 2KB is truncated to fit the TEXT column', async () => {
    const huge = 'x'.repeat(3_500);
    const { db, updates } = makeFakeDb([
      { id: 13, userId: 42, intent: 'huge error', repeatType: 'daily' },
    ]);
    const dispatch = vi.fn(async () => {
      throw new Error(huge);
    });
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(updates.length).toBe(2);
    const advance = updates[1]!;
    expect((advance as { lastError: string }).lastError).toHaveLength(2_000);
    stopScheduledRunner();
  });

  it('Codex P5 — claim fails (affectedRows=0) → skip dispatch entirely', async () => {
    const { db, updates } = makeFakeDb(
      [{ id: 10, userId: 42, intent: 'racy', repeatType: 'daily' }],
      { claimSucceeds: false },
    );
    const dispatch = vi.fn(async () => 1234);
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    // Lost the claim race → no dispatch, no advance UPDATE.
    expect(dispatch).not.toHaveBeenCalled();
    expect(updates.length).toBe(1); // only the failed claim attempt
    expect(updates[0]).toMatchObject({ status: 'running' });
    stopScheduledRunner();
  });
});

describe('recoverStuckRunningScheduledTasks (boot sweep)', () => {
  it('flips status="running" rows back to "active" + returns affected count', async () => {
    const captured: Array<{ values: Record<string, unknown> }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            captured.push({ values });
            return { affectedRows: 3 };
          }),
        })),
      })),
    };
    const recovered = await recoverStuckRunningScheduledTasks(db);
    expect(recovered).toBe(3);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.values).toEqual({ status: 'active' });
  });

  it('returns 0 + does not throw on DB error', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {
            throw new Error('connection refused');
          }),
        })),
      })),
    };
    const recovered = await recoverStuckRunningScheduledTasks(db);
    expect(recovered).toBe(0);
  });
});
