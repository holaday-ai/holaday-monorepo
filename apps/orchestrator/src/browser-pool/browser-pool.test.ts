/**
 * Phase 24 — per-task BrowserPool semantics.
 *
 * Refactor: pool keys by taskId, not userId. One task = one browser.
 * No more per-user shared instance, no refcount. The 22a/23-hotfix
 * refcount race was a symptom of the wrong model: serial FIFO over a
 * shared resource. Per-task gives each task its own quartet, which
 * also unlocks intra-user parallelism.
 *
 * Tests stub spawnInstance + tearDownInstance so we don't fork Brave
 * on dev macs. The interesting behavior — keying, isolation, capacity,
 * dead detection, peekActiveForUser — runs for real.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pino } from 'pino';
import {
  type BrowserViewportProfile,
  braveWindowSizeForProfile,
  dimensionsForProfile,
  xvfbScreenForProfile,
} from '@holaday/shared-types';
import { BrowserPool, PoolCapacityError } from './browser-pool.js';
import type { BrowserInstance, PoolConfig } from './types.js';

function makePool(maxInstances = 10): {
  pool: BrowserPool;
  spawnSpy: ReturnType<typeof vi.fn>;
  tearDownSpy: ReturnType<typeof vi.fn>;
} {
  const cfg: PoolConfig = {
    maxInstances,
    idleTimeoutMs: 300_000,
    baseDir: '/tmp/holaday-test',
    cdpPortStart: 9300,
    vncPortStart: 5910,
    wsPortStart: 6090,
    displayStart: 100,
    screenSize: '1280x800x24',
  };
  const log = pino({ level: 'silent' });
  const pool = new BrowserPool(cfg, log);
  // Stub the private spawn so allocate() returns a stub instance
  // synchronously without forking processes. The stub still goes
  // through the real SlotAllocator so capacity bookkeeping (claim
  // on spawn, release on tearDown) matches production behaviour;
  // tests for canAllocate / capacity / port reuse depend on this.
  const spawnSpy = vi.fn(
    async (
      taskId: string,
      userId: string,
      viewportProfile?: BrowserViewportProfile,
    ) => {
    const allocator = (
      pool as unknown as { allocator: { claim: () => unknown; isFull: () => boolean } }
    ).allocator;
    if (allocator.isFull()) {
      throw new PoolCapacityError(maxInstances);
    }
    const slot = allocator.claim() as {
      index: number;
      display: number;
      cdpPort: number;
      vncPort: number;
      wsPort: number;
    };
    const inst: BrowserInstance = {
      ...slot,
      taskId,
      userId,
      userDataDir: `/tmp/test-task-${taskId}`,
      executor: {
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as BrowserInstance['executor'],
      xvfbPid: 1000 + slot.index,
      bravePid: 2000 + slot.index,
      x11vncPid: 3000 + slot.index,
      websockifyPid: 4000 + slot.index,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      status: 'ready',
      ...(viewportProfile ? { viewportProfile } : {}),
    };
    (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(
      taskId,
      inst,
    );
    return inst;
    },
  );
  (pool as unknown as { spawnInstance: typeof spawnSpy }).spawnInstance = spawnSpy;
  const tearDownSpy = vi.fn(async () => undefined);
  (pool as unknown as { tearDownInstance: typeof tearDownSpy }).tearDownInstance =
    tearDownSpy;
  return { pool, spawnSpy, tearDownSpy };
}

describe('BrowserPool — phase 24 per-task semantics', () => {
  let pool: BrowserPool;
  let spawnSpy: ReturnType<typeof vi.fn>;
  let tearDownSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ pool, spawnSpy, tearDownSpy } = makePool());
  });

  describe('isolation: same user, multiple tasks → independent instances', () => {
    it('three tasks for one user spawn three Braves with three cdpPorts', async () => {
      const user = 'usr_A';
      const a = await pool.allocate('tsk_1', user);
      const b = await pool.allocate('tsk_2', user);
      const c = await pool.allocate('tsk_3', user);

      // Distinct instances — no shared Brave.
      expect(a.taskId).toBe('tsk_1');
      expect(b.taskId).toBe('tsk_2');
      expect(c.taskId).toBe('tsk_3');
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);

      // Distinct ports.
      const ports = new Set([a.cdpPort, b.cdpPort, c.cdpPort]);
      expect(ports.size).toBe(3);

      // Spawned three times.
      expect(spawnSpy).toHaveBeenCalledTimes(3);
    });

    it('every task gets a fresh userDataDir (per-task isolation)', async () => {
      const user = 'usr_fresh';
      const a = await pool.allocate('tsk_a', user);
      const b = await pool.allocate('tsk_b', user);
      expect(a.userDataDir).not.toBe(b.userDataDir);
      // userDataDir should NOT be derived from userId (would conflict
      // across tasks). Should encode taskId.
      expect(a.userDataDir).toContain('tsk_a');
      expect(b.userDataDir).toContain('tsk_b');
    });

    it('preserves the viewport profile on allocated instances', async () => {
      const inst = await pool.allocate('tsk_panel', 'usr_panel', 'sidepanel');

      expect(inst.viewportProfile).toBe('sidepanel');
      expect(spawnSpy).toHaveBeenCalledWith(
        'tsk_panel',
        'usr_panel',
        'sidepanel',
      );
    });

    it('deduplicates concurrent allocation attempts for the same task', async () => {
      const originalSpawn = spawnSpy.getMockImplementation();
      let unblock: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      spawnSpy.mockImplementationOnce(async (...args: unknown[]) => {
        await gate;
        return originalSpawn!(...args);
      });

      const first = pool.allocate('tsk_same', 'usr_owner');
      const second = pool.allocate('tsk_same', 'usr_owner');
      expect(spawnSpy).toHaveBeenCalledTimes(1);

      unblock();
      const [a, b] = await Promise.all([first, second]);
      expect(a).toBe(b);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    });

    it('release(t1) tears down only t1; t2 and t3 stay alive', async () => {
      const user = 'usr_X';
      await pool.allocate('tsk_x1', user);
      await pool.allocate('tsk_x2', user);
      await pool.allocate('tsk_x3', user);
      expect(pool.peek('tsk_x1')).not.toBeNull();
      expect(pool.peek('tsk_x2')).not.toBeNull();
      expect(pool.peek('tsk_x3')).not.toBeNull();

      const released = await pool.release('tsk_x1', 'task-done');
      expect(released).toBe(true);

      expect(pool.peek('tsk_x1')).toBeNull();
      expect(pool.peek('tsk_x2')).not.toBeNull();
      expect(pool.peek('tsk_x3')).not.toBeNull();
      // tearDownInstance was called exactly once (only t1).
      expect(tearDownSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('peekActiveForUser: screencast / VNC compatibility helper', () => {
    it('returns null when the user has no active task', () => {
      expect(pool.peekActiveForUser('usr_nobody')).toBeNull();
    });

    it('returns a ready instance owned by the user when they have one', async () => {
      const u = 'usr_one';
      const inst = await pool.allocate('tsk_only', u);
      expect(pool.peekActiveForUser(u)).toBe(inst);
    });

    it('with multiple tasks for one user, returns the most recently active one', async () => {
      const u = 'usr_multi';
      const a = await pool.allocate('tsk_a', u);
      // Force a small lastActiveAt skew so we can assert ordering.
      await new Promise((r) => setTimeout(r, 5));
      const b = await pool.allocate('tsk_b', u);
      // b allocated last → b is most recent.
      expect(pool.peekActiveForUser(u)).toBe(b);

      // Now touch a so it becomes more recent than b.
      await new Promise((r) => setTimeout(r, 5));
      pool.touch(a.taskId);
      expect(pool.peekActiveForUser(u)).toBe(a);
    });

    it('does not return another user`s instances', async () => {
      const u1 = 'usr_first';
      const u2 = 'usr_second';
      await pool.allocate('tsk_for_u1', u1);
      const i2 = await pool.allocate('tsk_for_u2', u2);
      expect(pool.peekActiveForUser(u2)).toBe(i2);
      // u1's lookup must not surface u2's instance.
      const found = pool.peekActiveForUser('usr_nobody');
      expect(found).toBeNull();
    });
  });

  describe('capacity', () => {
    it('throws PoolCapacityError when allocating past maxInstances', async () => {
      const small = makePool(3);
      await small.pool.allocate('t1', 'u');
      await small.pool.allocate('t2', 'u');
      await small.pool.allocate('t3', 'u');
      await expect(small.pool.allocate('t4', 'u')).rejects.toBeInstanceOf(
        PoolCapacityError,
      );
    });

    it('canAllocate returns false at capacity, true otherwise', async () => {
      const small = makePool(2);
      expect(small.pool.canAllocate()).toBe(true);
      await small.pool.allocate('t1', 'u');
      expect(small.pool.canAllocate()).toBe(true);
      await small.pool.allocate('t2', 'u');
      expect(small.pool.canAllocate()).toBe(false);
      // Releasing one frees a slot.
      await small.pool.release('t1', 'done');
      expect(small.pool.canAllocate()).toBe(true);
    });
  });

  describe('release semantics', () => {
    it('release on unknown taskId is a safe no-op', async () => {
      const released = await pool.release('tsk_never_existed', 'spurious');
      expect(released).toBe(false);
      expect(tearDownSpy).not.toHaveBeenCalled();
    });

    it('release frees the slot for reuse', async () => {
      const small = makePool(1);
      const a = await small.pool.allocate('t1', 'u');
      // Note: depending on slot allocator, a's port may or may not be 9300.
      const aPort = a.cdpPort;
      await small.pool.release('t1', 'done');
      // Now a new task can allocate; it should reuse the slot's port.
      const b = await small.pool.allocate('t2', 'u');
      expect(b.cdpPort).toBe(aPort);
    });
  });

  describe('terminal review lease', () => {
    it('keeps a completed task browser available until the bounded lease expires', async () => {
      vi.useFakeTimers();
      try {
        const leased = makePool(1);
        await leased.pool.allocate('tsk_done', 'usr_review');

        expect(leased.pool.retain('tsk_done', 30_000, 'terminal-review')).toBe(true);
        expect(leased.pool.peek('tsk_done')).not.toBeNull();

        await vi.advanceTimersByTimeAsync(29_999);
        expect(leased.pool.peek('tsk_done')).not.toBeNull();

        await vi.advanceTimersByTimeAsync(1);
        expect(leased.pool.peek('tsk_done')).toBeNull();
        expect(leased.tearDownSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('renews the terminal lease while the user is actively connected', async () => {
      vi.useFakeTimers();
      try {
        const leased = makePool(1);
        await leased.pool.allocate('tsk_done', 'usr_review');

        expect(leased.pool.retain('tsk_done', 30_000, 'terminal-review')).toBe(true);
        await vi.advanceTimersByTimeAsync(20_000);
        leased.pool.touch('tsk_done');

        await vi.advanceTimersByTimeAsync(20_000);
        expect(leased.pool.peek('tsk_done')).not.toBeNull();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(leased.pool.peek('tsk_done')).toBeNull();
        expect(leased.tearDownSpy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reclaims a retained terminal browser before rejecting new work at capacity', async () => {
      const leased = makePool(1);
      await leased.pool.allocate('tsk_done', 'usr_review');
      leased.pool.retain('tsk_done', 60_000, 'terminal-review');

      expect(leased.pool.canAllocate()).toBe(true);
      const next = await leased.pool.allocate('tsk_next', 'usr_review');

      expect(next.taskId).toBe('tsk_next');
      expect(leased.pool.peek('tsk_done')).toBeNull();
      expect(leased.tearDownSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retain unknown, draining, or invalid browser leases', async () => {
      expect(pool.retain('tsk_missing', 60_000, 'terminal-review')).toBe(false);
      const inst = await pool.allocate('tsk_draining', 'usr_review');
      inst.status = 'draining';
      expect(pool.retain('tsk_draining', 60_000, 'terminal-review')).toBe(false);
      inst.status = 'ready';
      expect(pool.retain('tsk_draining', 0, 'terminal-review')).toBe(false);
    });
  });

  describe('terminal browser handoff', () => {
    it('adopts the retained browser into a follow-up task without spawning', async () => {
      const source = await pool.allocate('tsk_parent', 'usr_owner', 'desktop');
      pool.retain('tsk_parent', 60_000, 'terminal-review');

      const adopted = pool.adoptRetained(
        'tsk_parent',
        'tsk_follow_up',
        'usr_owner',
      );

      expect(adopted).toBe(source);
      expect(adopted?.taskId).toBe('tsk_follow_up');
      expect(adopted?.retainedUntil).toBeUndefined();
      expect(adopted?.retentionReason).toBeUndefined();
      expect(pool.peek('tsk_parent')).toBeNull();
      expect(pool.peek('tsk_follow_up')).toBe(source);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    });

    it('releases the adopted task key when its browser dies later', async () => {
      const source = await pool.allocate('tsk_parent', 'usr_owner');
      pool.retain('tsk_parent', 60_000, 'terminal-review');
      const adopted = pool.adoptRetained(
        'tsk_parent',
        'tsk_follow_up',
        'usr_owner',
      );

      expect(adopted).toBe(source);
      (
        pool as unknown as {
          handleUnexpectedChildDeath: (
            instance: BrowserInstance,
            label: string,
          ) => void;
        }
      ).handleUnexpectedChildDeath(source, 'browser');

      await vi.waitFor(() => {
        expect(pool.peek('tsk_follow_up')).toBeNull();
      });
      expect(pool.peek('tsk_parent')).toBeNull();
      expect(tearDownSpy).toHaveBeenCalledTimes(1);
    });

    it('refuses handoff when the source is not retained or has another owner', async () => {
      await pool.allocate('tsk_active', 'usr_owner');
      expect(
        pool.adoptRetained('tsk_active', 'tsk_next', 'usr_owner'),
      ).toBeNull();

      pool.retain('tsk_active', 60_000, 'terminal-review');
      expect(
        pool.adoptRetained('tsk_active', 'tsk_next', 'usr_other'),
      ).toBeNull();
      expect(pool.peek('tsk_active')).not.toBeNull();
      expect(pool.peek('tsk_next')).toBeNull();
    });

    it('refuses to replace an existing destination browser', async () => {
      await pool.allocate('tsk_parent', 'usr_owner');
      pool.retain('tsk_parent', 60_000, 'terminal-review');
      const destination = await pool.allocate('tsk_next', 'usr_owner');

      expect(
        pool.adoptRetained('tsk_parent', 'tsk_next', 'usr_owner'),
      ).toBeNull();
      expect(pool.peek('tsk_next')).toBe(destination);
      expect(pool.peek('tsk_parent')).not.toBeNull();
    });
  });

  describe('idle GC', () => {
    it('reaps tasks whose lastActiveAt is older than idleTimeoutMs', async () => {
      await pool.allocate('tsk_idle', 'u');
      const inst = pool.peek('tsk_idle');
      expect(inst).not.toBeNull();
      // Force-age the instance.
      inst!.lastActiveAt = Date.now() - 600_000;
      // Drive the GC sweep manually (private).
      await (pool as unknown as { runGcSweep: () => Promise<void> }).runGcSweep();
      expect(pool.peek('tsk_idle')).toBeNull();
    });
  });

  describe('stats', () => {
    it('reports active count + per-instance breakdown', async () => {
      await pool.allocate('t1', 'u1');
      await pool.allocate('t2', 'u1');
      await pool.allocate('t3', 'u2');
      const s = pool.stats();
      expect(s.active).toBe(3);
      expect(s.capacity).toBe(10);
      expect(s.byUser.length).toBe(3);
      // Should expose taskId on each entry.
      const taskIds = s.byUser.map((u) => u.taskId).sort();
      expect(taskIds).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('touch', () => {
    it('bumps lastActiveAt on the matching task', async () => {
      const u = 'usr_t';
      const inst = await pool.allocate('tsk_active', u);
      const before = inst.lastActiveAt;
      await new Promise((r) => setTimeout(r, 5));
      pool.touch('tsk_active');
      const after = pool.peek('tsk_active')!.lastActiveAt;
      expect(after).toBeGreaterThan(before);
    });

    it('is a safe no-op for unknown taskId', () => {
      expect(() => pool.touch('tsk_unknown')).not.toThrow();
    });
  });
});

describe('browser viewport profile geometry', () => {
  it('keeps portrait surfaces on narrow real browser dimensions', () => {
    expect(dimensionsForProfile('mobile')).toEqual({ width: 390, height: 844 });
    expect(xvfbScreenForProfile('mobile')).toBe('390x844x24');
    expect(braveWindowSizeForProfile('mobile')).toBe('390,844');

    expect(dimensionsForProfile('sidepanel')).toEqual({ width: 430, height: 760 });
    expect(xvfbScreenForProfile('sidepanel')).toBe('430x760x24');
    expect(braveWindowSizeForProfile('sidepanel')).toBe('430,760');
  });
});
