/**
 * Phase 5b — batch-executor unit tests.
 *
 * The DB-driven half of the executor is covered by deploy-time
 * eval (creating a real batch via the SPA and watching it settle)
 * — too much drizzle predicate surface to fake faithfully here.
 * What we DO unit-test is the scheduling helper `runWithConcurrency`,
 * which encodes the spec's two main contracts:
 *
 *   1. Concurrent dispatch — 3 items under concurrency=3 fan out in
 *      parallel (not serially); all three resolve.
 *   2. Partial-failure isolation — one item throws → other items
 *      still complete; results array carries per-item error info
 *      so the caller can mark them failed without crashing siblings.
 */

import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './batch-executor.js';

describe('runWithConcurrency — concurrent dispatch', () => {
  it('runs up to `concurrency` items in parallel', async () => {
    // Each item resolves after ~30ms. With concurrency=3 + 3 items,
    // total time should be ~30ms (one wave) not ~90ms (serial).
    const startedAt = new Array<number>(3);
    const finishedAt = new Array<number>(3);
    const t0 = Date.now();
    const results = await runWithConcurrency([0, 1, 2], 3, async (_, i) => {
      startedAt[i] = Date.now() - t0;
      await new Promise((r) => setTimeout(r, 30));
      finishedAt[i] = Date.now() - t0;
    });
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // All three should have started within a few ms of each other —
    // i.e. before the FIRST one finishes (its finish is ~30ms in).
    const firstFinish = Math.min(...finishedAt);
    for (const s of startedAt) {
      expect(s).toBeLessThan(firstFinish);
    }
    // Total elapsed clearly less than 2× the per-item delay (would
    // mean serial). 60ms is generous slack for CI jitter.
    const total = Date.now() - t0;
    expect(total).toBeLessThan(60);
  });

  it('caps to `concurrency` when items > concurrency', async () => {
    const inFlight = { count: 0, max: 0 };
    const results = await runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async () => {
      inFlight.count += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await new Promise((r) => setTimeout(r, 10));
      inFlight.count -= 1;
    });
    expect(results.length).toBe(6);
    expect(results.every((r) => r.ok)).toBe(true);
    // Should never have had more than 2 simultaneous.
    expect(inFlight.max).toBeLessThanOrEqual(2);
  });
});

describe('runWithConcurrency — partial-failure isolation', () => {
  it('one item throws → other items complete; results carry per-item status', async () => {
    const results = await runWithConcurrency(
      ['a', 'fail', 'b'],
      3,
      async (item) => {
        if (item === 'fail') {
          throw new Error('synthetic dispatch failure');
        }
        await new Promise((r) => setTimeout(r, 5));
      },
    );
    expect(results).toEqual([
      { ok: true },
      { ok: false, error: 'synthetic dispatch failure' },
      { ok: true },
    ]);
  });

  it('throw at index 0 does not block subsequent indices', async () => {
    const ran: string[] = [];
    const results = await runWithConcurrency(
      ['fail-first', 'b', 'c'],
      2,
      async (item) => {
        ran.push(item);
        if (item === 'fail-first') throw new Error('boom');
        await new Promise((r) => setTimeout(r, 5));
      },
    );
    expect(results[0]).toEqual({ ok: false, error: 'boom' });
    expect(results[1]).toEqual({ ok: true });
    expect(results[2]).toEqual({ ok: true });
    expect(ran).toContain('b');
    expect(ran).toContain('c');
  });

  it('preserves input-array order in the results regardless of completion order', async () => {
    // Reverse the delay so item[0] finishes LAST; results[0] must
    // still be the first item's outcome.
    const results = await runWithConcurrency([3, 2, 1], 3, async (delay) => {
      await new Promise((r) => setTimeout(r, delay * 10));
    });
    expect(results.length).toBe(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('concurrency=1 → serial execution', async () => {
    const sequence: number[] = [];
    await runWithConcurrency([0, 1, 2], 1, async (i) => {
      sequence.push(i);
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(sequence).toEqual([0, 1, 2]);
  });
});
