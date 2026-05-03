/**
 * Phase 22a follow-up — refcount semantics on the BrowserPool.
 *
 * Verifies the bug BOSS hit during the 15-task re-test: pool.allocate
 * is idempotent per-userId, so multiple concurrent tasks share ONE
 * Brave instance. Releasing on every task-finish (the original 22a #1
 * fix) tore the shared instance down on the FIRST task's completion;
 * the other 14 queued tasks all referenced the same primaryExecutor
 * captured at admit time and threw "PlaywrightExecutor not connected".
 *
 * This file stubs spawnInstance so we don't actually fork Brave / Xvfb
 * / x11vnc / websockify (those require a real Linux box with X). All
 * other paths (refCounts map, allocate's existing-instance branch,
 * release's force-reset, the GC sweep) run for real.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pino } from 'pino';
import { BrowserPool } from './browser-pool.js';
import type { BrowserInstance, PoolConfig } from './types.js';

function makeStubInstance(userId: string, idx: number): BrowserInstance {
  // Deterministic ports per index — matches what the real allocator
  // would have produced. Values don't have to be reachable; nothing
  // in the test connects to them.
  return {
    userId,
    userDataDir: `/tmp/test-${userId}`,
    index: idx,
    display: 100 + idx,
    cdpPort: 9300 + idx,
    vncPort: 5910 + idx,
    wsPort: 6090 + idx,
    // Stub executor — returns a no-op disconnect so release() doesn't
    // explode. Other methods are not exercised by the refcount path.
    executor: {
      disconnect: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserInstance['executor'],
    xvfbPid: 1000 + idx,
    bravePid: 2000 + idx,
    x11vncPid: 3000 + idx,
    websockifyPid: 4000 + idx,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    status: 'ready',
  };
}

function makePool(): {
  pool: BrowserPool;
  spawnSpy: ReturnType<typeof vi.fn>;
} {
  const cfg: PoolConfig = {
    maxInstances: 20,
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
  // synchronously without forking processes. Mutates the prototype
  // for the lifetime of this test only — `vi.spyOn` cleans up via
  // afterEach in vitest's default config, but we also re-stub in
  // every test's beforeEach so leakage is impossible.
  let counter = 0;
  const spawnSpy = vi.fn(async (userId: string) => {
    const inst = makeStubInstance(userId, counter++);
    // The real spawnInstance also writes into the instances Map and
    // attaches exit listeners. We have to replicate the Map write
    // because allocate() reads from there on the idempotent path.
    // Using a private cast is OK in tests; the alternative is making
    // the map protected which would weaken the public API.
    (pool as unknown as { instances: Map<string, BrowserInstance> }).instances.set(
      userId,
      inst,
    );
    return inst;
  });
  (pool as unknown as { spawnInstance: typeof spawnSpy }).spawnInstance = spawnSpy;
  // Stub tearDownInstance too so release() doesn't try to send signals
  // to fake PIDs (which Node would silently allow but it's noise).
  const tearDownSpy = vi.fn(async () => undefined);
  (pool as unknown as { tearDownInstance: typeof tearDownSpy }).tearDownInstance =
    tearDownSpy;
  return { pool, spawnSpy };
}

function refCount(pool: BrowserPool, userId: string): number {
  return (
    (pool as unknown as { refCounts: Map<string, number> }).refCounts.get(userId) ?? 0
  );
}

describe('BrowserPool refcount (phase 22a hotfix)', () => {
  let pool: BrowserPool;
  let spawnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ pool, spawnSpy } = makePool());
  });

  describe('Test C: 3 tasks for the same user share one instance, refcount drains 3→0', () => {
    it('three trackRef allocates spawn ONE instance and refcount climbs to 3', async () => {
      const u = 'usr_test_C';
      const a = await pool.allocate(u, { trackRef: true });
      const b = await pool.allocate(u, { trackRef: true });
      const c = await pool.allocate(u, { trackRef: true });

      // Same instance returned all three times — idempotent design.
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(refCount(pool, u)).toBe(3);
    });

    it('releaseRef decrements until last ref → triggers actual teardown', async () => {
      const u = 'usr_test_C';
      await pool.allocate(u, { trackRef: true });
      await pool.allocate(u, { trackRef: true });
      await pool.allocate(u, { trackRef: true });
      expect(refCount(pool, u)).toBe(3);

      const after1 = await pool.releaseRef(u, 'task-1-done');
      expect(after1).toBe(2);
      // Instance still alive on the map after first decrement.
      expect(pool.peek(u)).not.toBeNull();

      const after2 = await pool.releaseRef(u, 'task-2-done');
      expect(after2).toBe(1);
      expect(pool.peek(u)).not.toBeNull();

      const after3 = await pool.releaseRef(u, 'task-3-done');
      expect(after3).toBe(0);
      // Last reference dropped — release() ran, instance gone from map.
      expect(pool.peek(u)).toBeNull();
    });
  });

  describe('Test C edge: trackRef:false allocations do NOT increment refcount', () => {
    // screencast-proxy and tasks.wakeBrowser pass no opts — those
    // call sites have no symmetric releaseRef so we'd leak refs forever.
    it('default allocate does not bump refCounts', async () => {
      const u = 'usr_test_C2';
      await pool.allocate(u); // no opts
      expect(pool.peek(u)).not.toBeNull();
      expect(refCount(pool, u)).toBe(0);
    });

    it('mixed: one trackRef + one default → refcount = 1 (only the tracked one)', async () => {
      const u = 'usr_test_C3';
      await pool.allocate(u, { trackRef: true });
      await pool.allocate(u); // existing path; idempotent return
      expect(refCount(pool, u)).toBe(1);

      // Releasing the one ref tears down (no other refs holding it).
      await pool.releaseRef(u, 'done');
      expect(pool.peek(u)).toBeNull();
    });
  });

  describe('release() resets refcount even when called via GC / dead-child paths', () => {
    it('unconditional release zeros the refcount', async () => {
      const u = 'usr_test_C4';
      await pool.allocate(u, { trackRef: true });
      await pool.allocate(u, { trackRef: true });
      expect(refCount(pool, u)).toBe(2);

      // Simulate GC / dead-child sweep calling release() directly.
      await pool.release(u, 'idle-timeout');

      expect(refCount(pool, u)).toBe(0);
      expect(pool.peek(u)).toBeNull();
    });
  });

  describe('releaseRef without prior allocate (defensive)', () => {
    it('returns 0 cleanly even if caller had a stale "I allocated this" belief', async () => {
      const after = await pool.releaseRef('usr_never_allocated', 'done');
      expect(after).toBe(0);
      // No throw, no entry created.
      expect(refCount(pool, 'usr_never_allocated')).toBe(0);
    });
  });

  describe('mixed-user concurrency: refcounts are independent', () => {
    it('two users with concurrent tasks each get their own count', async () => {
      const u1 = 'usr_A';
      const u2 = 'usr_B';
      await pool.allocate(u1, { trackRef: true });
      await pool.allocate(u2, { trackRef: true });
      await pool.allocate(u1, { trackRef: true });

      expect(refCount(pool, u1)).toBe(2);
      expect(refCount(pool, u2)).toBe(1);

      // u1 finishes one task — u1's instance still held by other ref;
      // u2 unaffected.
      await pool.releaseRef(u1, 'done');
      expect(refCount(pool, u1)).toBe(1);
      expect(refCount(pool, u2)).toBe(1);
      expect(pool.peek(u1)).not.toBeNull();
      expect(pool.peek(u2)).not.toBeNull();
    });
  });
});
