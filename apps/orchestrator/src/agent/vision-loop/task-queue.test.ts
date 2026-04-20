import { describe, expect, it } from 'vitest';
import { createVisionLoopTaskQueue } from './task-queue.js';

/**
 * Helpers — a manually-resolvable promise (a "deferred") so we can
 * line up concurrency scenarios deterministically.
 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('VisionLoopTaskQueue', () => {
  it('runs a single-user single-task immediately', async () => {
    const q = createVisionLoopTaskQueue();
    let ran = false;
    await q.enqueue('u1', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('serialises multiple tasks for the same user FIFO', async () => {
    const q = createVisionLoopTaskQueue();
    const order: string[] = [];
    const d1 = deferred<void>();
    const d2 = deferred<void>();

    const p1 = q.enqueue('u1', async () => {
      order.push('start1');
      await d1.promise;
      order.push('end1');
    });
    const p2 = q.enqueue('u1', async () => {
      order.push('start2');
      await d2.promise;
      order.push('end2');
    });

    // Both enqueues returned synchronously. Task 1 is running; task 2
    // is pending — start2 must NOT be in the order yet.
    await Promise.resolve(); // flush microtasks
    expect(order).toEqual(['start1']);
    expect(q.size('u1')).toBe(2);

    // Complete task 1 → task 2 kicks off.
    d1.resolve();
    await p1;
    expect(order).toEqual(['start1', 'end1', 'start2']);

    d2.resolve();
    await p2;
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
    expect(q.size('u1')).toBe(0);
    expect(q.totalSize()).toBe(0);
  });

  it('runs different users in parallel (no cross-user blocking)', async () => {
    const q = createVisionLoopTaskQueue();
    const dA = deferred<void>();
    const dB = deferred<void>();
    let aStarted = false;
    let bStarted = false;

    const pA = q.enqueue('userA', async () => {
      aStarted = true;
      await dA.promise;
    });
    const pB = q.enqueue('userB', async () => {
      bStarted = true;
      await dB.promise;
    });

    // Without awaiting either, both should already be started.
    await Promise.resolve();
    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);

    dA.resolve();
    dB.resolve();
    await Promise.all([pA, pB]);
  });

  it('calls onQueued with the 1-indexed position', async () => {
    const q = createVisionLoopTaskQueue();
    const positions: number[] = [];
    const d = deferred<void>();

    const p1 = q.enqueue(
      'u1',
      async () => {
        await d.promise;
      },
      (pos) => positions.push(pos),
    );
    await Promise.resolve();
    expect(positions).toEqual([1]); // first task starts immediately

    q.enqueue(
      'u1',
      async () => {},
      (pos) => positions.push(pos),
    );
    q.enqueue(
      'u1',
      async () => {},
      (pos) => positions.push(pos),
    );
    expect(positions).toEqual([1, 2, 3]);

    d.resolve();
    await p1;
  });

  it('errors in run() do not stall the queue', async () => {
    const q = createVisionLoopTaskQueue();
    let secondRan = false;
    await q.enqueue('u1', async () => {
      throw new Error('first task blew up');
    });
    await q.enqueue('u1', async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });

  it('onQueued throwing does not derail the queue', async () => {
    const q = createVisionLoopTaskQueue();
    let ran = false;
    await q.enqueue(
      'u1',
      async () => {
        ran = true;
      },
      () => {
        throw new Error('logger blew up');
      },
    );
    expect(ran).toBe(true);
  });

  it('totalSize aggregates across users', async () => {
    const q = createVisionLoopTaskQueue();
    const dA = deferred<void>();
    const dB = deferred<void>();
    q.enqueue('userA', async () => {
      await dA.promise;
    });
    q.enqueue('userA', async () => {});
    q.enqueue('userB', async () => {
      await dB.promise;
    });
    await Promise.resolve();
    expect(q.size('userA')).toBe(2);
    expect(q.size('userB')).toBe(1);
    expect(q.totalSize()).toBe(3);
    dA.resolve();
    dB.resolve();
  });
});
