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
  const spawnSpy = vi.fn(async (taskId: string, userId: string) => {
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
    };
    (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(
      taskId,
      inst,
    );
    return inst;
  });
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
