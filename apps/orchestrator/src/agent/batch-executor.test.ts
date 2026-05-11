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

import { describe, expect, it, vi } from 'vitest';
import { executeBatch, runWithConcurrency } from './batch-executor.js';

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

describe('executeBatch — Codex P5 atomic claim', () => {
  /**
   * The runItem path now does:
   *   UPDATE batch_task_items SET status='running'
   *     WHERE id=? AND status='pending'
   * → check affectedRows. If 0 (someone else already claimed),
   * runItem returns early WITHOUT calling dispatch.
   *
   * This test stubs the DB to return affectedRows=0 on the FIRST
   * item's claim UPDATE, affectedRows=1 on subsequent updates so
   * the executor can still process other items. Verifies dispatch
   * was not called for the lost-claim item.
   */
  it('item claim race: affectedRows=0 on claim → dispatch skipped, sibling items still dispatch', async () => {
    const state = {
      batch: {
        id: 1,
        externalId: 'btc_race',
        userId: 42,
        status: 'pending' as string,
        concurrency: 2,
        itemsTotal: 2,
        itemsDone: 0,
        itemsFailed: 0,
        completedAt: null as Date | null,
      },
      // Two items pending.
      items: [
        { id: 11, externalId: 'bti_lost', batchId: 1, seq: 0, prompt: 'lost-race', status: 'pending' as string, taskId: null as number | null },
        { id: 12, externalId: 'bti_won', batchId: 1, seq: 1, prompt: 'won-race', status: 'pending' as string, taskId: null as number | null },
      ],
      tasks: new Map<number, string>([[201, 'tsk_won']]),
      users: [{ id: 42, externalId: 'usr_test' }],
    };

    function tableName(t: unknown): string {
      return (
        (t as Record<symbol, string>)[Symbol.for('drizzle:Name')] ??
        (t as { _?: { name?: string } })._?.name ??
        ''
      );
    }
    function inspect(p: unknown): string {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('node:util').inspect(p, { depth: 6, getters: true });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      select(_fields?: unknown) {
        return {
          from(table: unknown) {
            const name = tableName(table);
            return {
              where(predicate: unknown) {
                const s = inspect(predicate);
                async function rowsFor(): Promise<unknown[]> {
                  if (name === 'batch_tasks') return [state.batch];
                  if (name === 'users') {
                    return state.users.filter((u) => s.includes(`value: ${u.id}`));
                  }
                  if (name === 'tasks') {
                    return Array.from(state.tasks.entries())
                      .filter(([id]) => s.includes(`value: ${id}`))
                      .map(([id, externalId]) => ({ id, externalId }));
                  }
                  if (name === 'batch_task_items') {
                    const pendingFilter =
                      s.includes("'pending'") || s.includes('"pending"');
                    return state.items.filter(
                      (i) => !pendingFilter || i.status === 'pending',
                    );
                  }
                  return [];
                }
                const chain = {
                  async limit(_n: number) {
                    return rowsFor();
                  },
                  orderBy(_col: unknown) {
                    return {
                      async limit(_n: number) {
                        return rowsFor();
                      },
                      then(onfulfilled?: (rows: unknown[]) => unknown) {
                        return rowsFor().then(onfulfilled);
                      },
                    };
                  },
                  then(onfulfilled?: (rows: unknown[]) => unknown) {
                    return rowsFor().then(onfulfilled);
                  },
                };
                return chain;
              },
            };
          },
        };
      },
      update(table: unknown) {
        const name = tableName(table);
        return {
          set(values: Record<string, unknown>) {
            return {
              async where(predicate: unknown) {
                const s = inspect(predicate);
                if (name === 'batch_task_items') {
                  // Item id 11 (lost-race) — claim returns 0; ALSO
                  // mark its in-memory status to 'running' so a
                  // subsequent SELECT WHERE status='pending' no
                  // longer returns it (simulating that another
                  // worker now owns it). Without this the executor
                  // would re-fetch the same row each loop iteration.
                  const isClaim = (values as { status?: string }).status === 'running';
                  if (isClaim) {
                    if (s.includes('value: 11')) {
                      const lost = state.items.find((i) => i.id === 11);
                      if (lost) lost.status = 'running'; // owned by sibling
                      return { affectedRows: 0 };
                    }
                    if (s.includes('value: 12')) {
                      const won = state.items.find((i) => i.id === 12);
                      if (won) won.status = 'running';
                      return { affectedRows: 1 };
                    }
                  }
                  // Other item updates (taskId, terminal status):
                  // apply to state so the executor's poll path works.
                  for (const item of state.items) {
                    if (s.includes(`value: ${item.id}`)) {
                      Object.assign(item, values);
                    }
                  }
                  return { affectedRows: 1 };
                }
                if (name === 'batch_tasks') {
                  Object.assign(state.batch, values);
                  return { affectedRows: 1 };
                }
                return { affectedRows: 0 };
              },
            };
          },
        };
      },
    };

    const dispatch = vi.fn(async ({ prompt }: { prompt: string }) => {
      if (prompt === 'won-race') {
        return { taskInternalId: 201, taskExternalId: 'tsk_won' };
      }
      throw new Error(`unexpected dispatch for prompt=${prompt}`);
    });

    // Pre-mark task 201 as completed so the poll loop terminates fast.
    // (The poll reads tasks.status; our fake DB needs to surface it.)
    const taskStatuses = new Map<number, string>([[201, 'completed']]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalSelect = db.select as any;
    db.select = (fields?: unknown) => {
      const base = originalSelect(fields);
      return {
        from: (table: unknown) => {
          const name = tableName(table);
          if (name === 'tasks') {
            return {
              where: (predicate: unknown) => {
                const s = inspect(predicate);
                return {
                  async limit(_n: number) {
                    for (const [id, status] of taskStatuses) {
                      if (s.includes(`value: ${id}`)) {
                        return [{ id, externalId: state.tasks.get(id), status }];
                      }
                    }
                    return [];
                  },
                };
              },
            };
          }
          return base.from(table);
        },
      };
    };

    await executeBatch('btc_race', {
      db,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      broadcastToUser: () => undefined,
      dispatch,
    });

    // dispatch was NOT called for the lost-race item.
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'won-race' }),
    );
  }, 30_000);
});
