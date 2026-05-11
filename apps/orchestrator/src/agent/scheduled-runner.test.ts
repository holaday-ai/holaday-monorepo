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

import { computeNextRun, startScheduledRunner, stopScheduledRunner } from './scheduled-runner.js';

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
  function makeFakeDb(rows: Array<Record<string, unknown>>) {
    const updates: Array<Record<string, unknown>> = [];
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updates.push(values);
          return undefined;
        }),
      })),
    }));
    return { db: { select, update } as unknown as Parameters<typeof startScheduledRunner>[0]['db'], updates };
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
    expect(updates.length).toBe(1);
    const u = updates[0]!;
    expect(u).toMatchObject({
      lastTaskId: 999,
    });
    // For recurring schedules nextRunAt MUST be set; for once it's
    // absent (we go to completed instead). Validate it's there.
    expect('nextRunAt' in u).toBe(true);
    expect((u as { nextRunAt: Date }).nextRunAt).toBeInstanceOf(Date);
    stopScheduledRunner();
  });

  it('marks a one-shot row completed instead of advancing', async () => {
    const { db, updates } = makeFakeDb([
      { id: 8, userId: 42, intent: 'one-time export', repeatType: 'once' },
    ]);
    const dispatch = vi.fn(async () => 1000);
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(updates.length).toBe(1);
    const u = updates[0]!;
    expect(u).toMatchObject({
      status: 'completed',
      lastTaskId: 1000,
    });
    expect('nextRunAt' in u).toBe(false);
    stopScheduledRunner();
  });

  it('dispatch failure still advances the row (no tight-retry lock)', async () => {
    const { db, updates } = makeFakeDb([
      { id: 9, userId: 42, intent: 'flaky job', repeatType: 'daily' },
    ]);
    const dispatch = vi.fn(async () => null); // failed → returns null
    startScheduledRunner({ db, dispatch, pollIntervalMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(updates.length).toBe(1);
    const u = updates[0]!;
    // lastTaskId NOT set when dispatch returned null (the conditional
    // spread in the runner skips the column).
    expect('lastTaskId' in u).toBe(false);
    // But the row still advanced.
    expect('nextRunAt' in u).toBe(true);
    stopScheduledRunner();
  });
});
