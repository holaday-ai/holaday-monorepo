/**
 * Phase 24 RC follow-up — global pool-capacity queue.
 *
 * BOSS hit "30 tasks at once, pool has 10 slots, 14 failed with
 * 'initial screenshot failed'" — pool.allocate threw PoolCapacityError
 * past the 10th task, the catch in tasks.create fell back to the
 * shared singleton, and 14 tasks raced the same Brave on first
 * screenshot. No queue, no graceful overflow.
 *
 * The queue is a SINGLE GLOBAL FIFO scoped to the per-task pool. Pure
 * Node/in-memory; no Redis, no DB. Worker dispatch on:
 *   1. Each enqueue() — try immediate dispatch (fast path).
 *   2. signalSlotFreed() from tasks.ts .finally — wake on every
 *      task release.
 *   3. 5s polling tick — safety net for missed signals.
 *
 * Hard caps:
 *   - depth 100 (enqueue rejects, caller surfaces "system busy")
 *   - per-task 10min queue timeout (worker fires onTimeout, drops it)
 *
 * The queue does NOT manage pool slots itself — it just consults a
 * `canDispatch()` predicate the caller injects (typically wrapping
 * pool.canAllocate()). Dispatching != allocating; the runFn passed in
 * is responsible for the actual allocate. That keeps this module
 * pure-data and unit-testable without spinning up Brave.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskQueue, type TaskQueue, type EnqueueResult } from './task-queue.js';

interface FakeClock {
  now: number;
  advance(ms: number): Promise<void>;
}

function makeClock(): FakeClock {
  return {
    now: 1_700_000_000_000,
    async advance(ms) {
      this.now += ms;
      vi.advanceTimersByTime(ms);
      // Let queued microtasks settle so worker callbacks resolve
      // before the next assertion.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

interface FakePool {
  active: number;
  capacity: number;
}

function makePool(capacity = 10, active = 0): FakePool {
  return { active, capacity };
}

describe('createTaskQueue — fast path (capacity available)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dispatches immediately when slot is free', async () => {
    const pool = makePool(10, 0);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    const runFn = vi.fn(async () => {
      pool.active++;
    });
    const onStart = vi.fn();

    const result = q.enqueue({
      taskId: 'tsk_a',
      userId: 'usr_x',
      runFn,
      onStart,
    });

    expect(result.kind).toBe('dispatched');
    if (result.kind === 'dispatched') expect(result.position).toBe(1);
    // Worker fires asynchronously; flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it('reports queued position when at capacity', async () => {
    const pool = makePool(2, 2); // already full
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });

    const r1 = q.enqueue({
      taskId: 'tsk_a',
      userId: 'usr_x',
      runFn: vi.fn(async () => {}),
      onStart: vi.fn(),
    });
    const r2 = q.enqueue({
      taskId: 'tsk_b',
      userId: 'usr_x',
      runFn: vi.fn(async () => {}),
      onStart: vi.fn(),
    });

    expect(r1.kind).toBe('queued');
    if (r1.kind === 'queued') expect(r1.position).toBe(1);
    expect(r2.kind).toBe('queued');
    if (r2.kind === 'queued') expect(r2.position).toBe(2);
    expect(q.size()).toBe(2);
  });
});

describe('createTaskQueue — drain on signalSlotFreed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dispatches the head task as soon as a slot frees', async () => {
    const pool = makePool(1, 1);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    const runFn = vi.fn(async () => {});
    const onStart = vi.fn();
    q.enqueue({ taskId: 'tsk_a', userId: 'u', runFn, onStart });
    expect(onStart).not.toHaveBeenCalled();
    expect(q.size()).toBe(1);

    pool.active = 0; // someone released
    q.signalSlotFreed();
    await Promise.resolve();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it('drains in FIFO order across multiple slot frees', async () => {
    const pool = makePool(1, 1);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    const order: string[] = [];
    for (const id of ['tsk_a', 'tsk_b', 'tsk_c']) {
      q.enqueue({
        taskId: id,
        userId: 'u',
        runFn: vi.fn(async () => {}),
        onStart: () => {
          order.push(id);
        },
      });
    }
    expect(order).toEqual([]);

    // Free one slot at a time.
    pool.active = 0;
    q.signalSlotFreed();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['tsk_a']);
    pool.active = 0; // simulate same slot freed again
    q.signalSlotFreed();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['tsk_a', 'tsk_b']);
    pool.active = 0;
    q.signalSlotFreed();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['tsk_a', 'tsk_b', 'tsk_c']);
    expect(q.size()).toBe(0);
  });

  it('does NOT dispatch past capacity even after multiple signals', async () => {
    const pool = makePool(1, 1);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    const onStart = vi.fn();
    for (const id of ['tsk_a', 'tsk_b', 'tsk_c']) {
      q.enqueue({
        taskId: id,
        userId: 'u',
        runFn: vi.fn(async () => {}),
        onStart,
      });
    }
    // Spurious signal while slot is still occupied — must not fire.
    q.signalSlotFreed();
    q.signalSlotFreed();
    await Promise.resolve();
    expect(onStart).not.toHaveBeenCalled();
    expect(q.size()).toBe(3);
  });
});

describe('createTaskQueue — depth cap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects enqueue past maxDepth, leaves earlier entries intact', () => {
    const pool = makePool(0, 0); // never dispatch
    const q = createTaskQueue({
      canDispatch: () => false,
      capacity: 0,
      tickMs: 5000,
      maxDepth: 3,
      queueTimeoutMs: 600_000,
    });
    for (const id of ['tsk_a', 'tsk_b', 'tsk_c']) {
      const r = q.enqueue({
        taskId: id,
        userId: 'u',
        runFn: vi.fn(async () => {}),
        onStart: vi.fn(),
      });
      expect(r.kind).toBe('queued');
    }
    const r4 = q.enqueue({
      taskId: 'tsk_d',
      userId: 'u',
      runFn: vi.fn(async () => {}),
      onStart: vi.fn(),
    });
    expect(r4.kind).toBe('rejected');
    if (r4.kind === 'rejected')
      expect(r4.reason).toMatch(/系统繁忙|队列已满|queue.*full|busy/i);
    expect(q.size()).toBe(3);
    // (suppress unused pool var lint)
    expect(pool.active).toBe(0);
  });
});

describe('createTaskQueue — queue timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onTimeout for queued tasks aged past queueTimeoutMs and removes them', async () => {
    const pool = makePool(0, 0);
    const q = createTaskQueue({
      canDispatch: () => false, // never dispatch
      capacity: 0,
      tickMs: 1000,
      maxDepth: 100,
      queueTimeoutMs: 5000,
    });
    const onTimeout = vi.fn();
    const onStart = vi.fn();
    q.enqueue({
      taskId: 'tsk_old',
      userId: 'u',
      runFn: vi.fn(async () => {}),
      onStart,
      onTimeout,
    });
    expect(q.size()).toBe(1);

    vi.advanceTimersByTime(6000); // past timeout
    await Promise.resolve();
    await Promise.resolve();

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(q.size()).toBe(0);

    // Suppress unused
    expect(pool.active).toBe(0);
  });

  it('still dispatches a task that becomes eligible BEFORE its timeout', async () => {
    const pool = makePool(1, 1);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 1000,
      maxDepth: 100,
      queueTimeoutMs: 10_000,
    });
    const onTimeout = vi.fn();
    const onStart = vi.fn();
    q.enqueue({
      taskId: 'tsk_lucky',
      userId: 'u',
      runFn: vi.fn(async () => {}),
      onStart,
      onTimeout,
    });

    vi.advanceTimersByTime(2000); // 2s in queue
    pool.active = 0;
    q.signalSlotFreed();
    await Promise.resolve();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('createTaskQueue — periodic tick safety net', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dispatches via the polling tick when no signal arrives', async () => {
    const pool = makePool(1, 1);
    const q = createTaskQueue({
      canDispatch: () => pool.active < pool.capacity,
      capacity: pool.capacity,
      tickMs: 1000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    const onStart = vi.fn();
    q.enqueue({
      taskId: 'tsk_a',
      userId: 'u',
      runFn: vi.fn(async () => {}),
      onStart,
    });
    pool.active = 0; // slot freed but NO signalSlotFreed call

    vi.advanceTimersByTime(1000); // worker tick
    await Promise.resolve();
    await Promise.resolve();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });
});

describe('createTaskQueue — observability', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('size() and snapshot() reflect current state', () => {
    const q = createTaskQueue({
      canDispatch: () => false,
      capacity: 0,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    q.enqueue({
      taskId: 'tsk_a',
      userId: 'u1',
      runFn: vi.fn(async () => {}),
      onStart: vi.fn(),
    });
    q.enqueue({
      taskId: 'tsk_b',
      userId: 'u2',
      runFn: vi.fn(async () => {}),
      onStart: vi.fn(),
    });
    expect(q.size()).toBe(2);
    const snap = q.snapshot();
    expect(snap.map((s) => s.taskId)).toEqual(['tsk_a', 'tsk_b']);
    expect(snap.map((s) => s.userId)).toEqual(['u1', 'u2']);
  });

  it('exposes a stable EnqueueResult discriminant', () => {
    const r: EnqueueResult = { kind: 'dispatched', position: 1 };
    expect(r.kind).toBe('dispatched');
  });

  it('createTaskQueue returns the documented surface', () => {
    const q: TaskQueue = createTaskQueue({
      canDispatch: () => false,
      capacity: 0,
      tickMs: 5000,
      maxDepth: 100,
      queueTimeoutMs: 600_000,
    });
    expect(typeof q.enqueue).toBe('function');
    expect(typeof q.signalSlotFreed).toBe('function');
    expect(typeof q.size).toBe('function');
    expect(typeof q.snapshot).toBe('function');
    expect(typeof q.stop).toBe('function');
  });
});
