import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startScheduledRunner, stopScheduledRunner } from '../agent/scheduled-runner.js';
import type { DB } from '../db/client.js';
import { startPlannedRunner, stopPlannedRunner } from '../planned/planned-runner.js';

afterEach(async () => {
  await stopScheduledRunner();
  await stopPlannedRunner();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pollers = [
  {
    name: 'scheduled',
    start: (db: DB) => startScheduledRunner({ db, dispatch: async () => null, pollIntervalMs: 10 }),
    stop: stopScheduledRunner,
  },
  {
    name: 'planned',
    start: (db: DB) => startPlannedRunner({ db, queue: async () => {}, pollIntervalMs: 10 }),
    stop: stopPlannedRunner,
  },
] as const;

// Only replace the mysql2 network boundary. Real runner and Drizzle query paths execute.
function database(rejectLate: boolean) {
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = {
    async query(query: { sql: string }) {
      const call = ++calls;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        if (call === 1) {
          await held;
          if (rejectLate) throw new Error('synthetic delayed transport failure');
        }
        return query.sql.startsWith('select') ? [[], []] : [{ affectedRows: 0 }, []];
      } finally {
        concurrent--;
      }
    },
  };
  return {
    db: drizzle(client as unknown as Connection) as unknown as DB,
    release,
    calls: () => calls,
    maxConcurrent: () => maxConcurrent,
  };
}

describe.each(pollers)('$name poller stop barrier', ({ start, stop }) => {
  it('starts idempotently and never overlaps an active pass', async () => {
    vi.useFakeTimers();
    const f = database(false);
    try {
      const timer = start(f.db);
      expect(start(f.db)).toBe(timer);
      await vi.advanceTimersByTimeAsync(30);
      expect(f.calls()).toBe(1);
      expect(f.maxConcurrent()).toBe(1);
    } finally {
      f.release();
      await stop();
    }
  });

  it('ignores an old timer callback after stop and restart', async () => {
    vi.useFakeTimers();
    const timerSpy = vi.spyOn(globalThis, 'setInterval');
    const f = database(false);
    f.release();
    try {
      start(f.db);
      const oldCallback = timerSpy.mock.calls.find((call) => call[1] === 10)?.[0];
      expect(typeof oldCallback).toBe('function');
      await vi.advanceTimersByTimeAsync(0);
      await stop();
      start(f.db);
      await vi.advanceTimersByTimeAsync(0);
      const calls = f.calls();
      if (typeof oldCallback !== 'function') throw new Error('missing interval callback');
      oldCallback();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.calls()).toBe(calls);
      await vi.advanceTimersByTimeAsync(10);
      expect(f.calls()).toBeGreaterThan(calls);
    } finally {
      await stop();
    }
  });

  it.each([false, true])(
    'waits for the original tick across restart (late failure=%s)',
    async (rejectLate) => {
      vi.useFakeTimers();
      const f = database(rejectLate);
      let settled = false;
      let againSettled = false;
      try {
        start(f.db);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.calls()).toBe(1);
        const stopped = Promise.resolve(stop()).then(() => {
          settled = true;
        });
        const again = Promise.resolve(stop()).then(() => {
          againSettled = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        const settledBeforeRelease = settled || againSettled;
        start(f.db);
        await vi.advanceTimersByTimeAsync(20);
        const callsBeforeRelease = f.calls();
        f.release();
        await vi.advanceTimersByTimeAsync(0);
        await stopped;
        await again;
        await vi.advanceTimersByTimeAsync(10);
        expect(settledBeforeRelease).toBe(false);
        expect(callsBeforeRelease).toBe(1);
        expect(f.maxConcurrent()).toBe(1);
        expect(settled && againSettled).toBe(true);
        expect(f.calls()).toBeGreaterThan(1);
      } finally {
        f.release();
        await stop();
      }
    },
  );

  it('does not start database work after a synchronous stop before dispatch', async () => {
    vi.useFakeTimers();
    const f = database(false);
    try {
      start(f.db);
      const stopped = Promise.resolve(stop());
      f.release();
      await vi.advanceTimersByTimeAsync(50);
      await stopped;
      expect(f.calls()).toBe(0);
    } finally {
      f.release();
      await stop();
    }
  });
});
