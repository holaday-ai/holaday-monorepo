import { describe, expect, it, vi } from 'vitest';
import { plannedTaskRunItems, plannedTaskRuns } from '../db/schema/planned-tasks.js';
import { dispatchSpecialOrGeneric, plannedTick, queuePlannedRun } from './planned-runner.js';

function drizzleParamValues(input: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(input)) {
    for (const item of input) drizzleParamValues(item, out);
    return out;
  }
  if (!input || typeof input !== 'object') return out;
  const record = input as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (record.constructor?.name === 'Param') out.push(record.value);
  if (Array.isArray(record.queryChunks)) drizzleParamValues(record.queryChunks, out);
  return out;
}

describe('planned runner specialized dispatch boundary', () => {
  it('does not create a generic task when the stock monitor handles the run', async () => {
    const generic = vi.fn(async () => undefined);
    const result = await dispatchSpecialOrGeneric({
      special: vi.fn(async () => ({ handled: true as const, ok: true as const })),
      generic,
    });
    expect(result).toEqual({ handled: true, ok: true });
    expect(generic).not.toHaveBeenCalled();
  });

  it('keeps the existing generic path when no specialized record exists', async () => {
    const generic = vi.fn(async () => undefined);
    const result = await dispatchSpecialOrGeneric({
      special: vi.fn(async () => ({ handled: false as const })),
      generic,
    });
    expect(result).toEqual({ handled: false });
    expect(generic).toHaveBeenCalledTimes(1);
  });
});

describe('planned runner lifecycle serialization', () => {
  it('rechecks the plan under a row lock before inserting a manual run', async () => {
    let selectCall = 0;
    let insertedRuns = 0;
    let rowLocks = 0;
    const activePlan = {
      id: 7,
      externalId: 'pln_monitor',
      title: '监控多伦科技风险变化',
      instruction: '系统专用：检查多伦科技（603528）风险变化',
      scope: 'single',
      repeatType: 'daily',
      rrule: null,
      endsAt: null,
      status: 'active',
      userId: 42,
    };
    const db = {
      select() {
        const call = selectCall++;
        return {
          from() {
            return {
              innerJoin() {
                return {
                  where() {
                    return { limit: async () => [activePlan] };
                  },
                };
              },
              where() {
                return {
                  async orderBy() {
                    return [{ id: 71, seq: 0, instruction: '检查多伦科技风险变化' }];
                  },
                  limit() {
                    if (call < 2) return Promise.resolve([]);
                    return {
                      async for(mode: string) {
                        if (mode === 'update') rowLocks += 1;
                        return [{ status: 'archived' }];
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
      async transaction<T>(callback: (tx: unknown) => Promise<T>) {
        return callback(db);
      },
      insert(table: unknown) {
        return {
          async values() {
            if (table === plannedTaskRuns) insertedRuns += 1;
            return table === plannedTaskRunItems ? [{ affectedRows: 1 }] : [{ insertId: 91 }];
          },
        };
      },
    };
    const ctx = {
      db,
      userId: 'usr_test',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      },
    };

    await expect(
      queuePlannedRun(ctx as never, {
        plannedTaskId: 'pln_monitor',
        scheduledFor: new Date('2026-08-19T09:00:00.000Z'),
        trigger: 'manual',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '当前状态不能执行',
    });
    expect(rowLocks).toBe(1);
    expect(insertedRuns).toBe(0);
  });

  it('does not overwrite an archived plan when a claimed queue request is rejected', async () => {
    let selectCall = 0;
    const updateCalls: Array<{ values: Record<string, unknown>; where?: unknown }> = [];
    const db = {
      select() {
        const call = selectCall++;
        return {
          from() {
            return {
              where() {
                if (call === 0) {
                  return Promise.resolve([
                    {
                      id: 7,
                      externalId: 'pln_monitor',
                      nextRunAt: new Date('2026-08-19T09:00:00.000Z'),
                      repeatType: 'daily',
                      rrule: null,
                      endsAt: null,
                      userId: 42,
                    },
                  ]);
                }
                if (call === 1) return { limit: async () => [] };
                return { limit: async () => [{ status: 'active' }] };
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            const call: { values: Record<string, unknown>; where?: unknown } = { values };
            updateCalls.push(call);
            return {
              async where(where: unknown) {
                call.where = where;
                return [{ affectedRows: 1 }];
              },
            };
          },
        };
      },
    };

    await plannedTick({
      db: db as never,
      queue: vi.fn(async () => {
        throw new Error('当前状态不能执行');
      }),
    });

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]?.values).toMatchObject({ status: 'failed' });
    expect(drizzleParamValues(updateCalls[1]?.where)).toEqual(
      expect.arrayContaining([7, 'running']),
    );
  });

  it('does not queue a claimed plan after the owner enters account closure', async () => {
    let selectCall = 0;
    const updates: Array<Record<string, unknown>> = [];
    const db = {
      select() {
        const call = selectCall++;
        return {
          from() {
            return {
              where() {
                if (call === 0) {
                  return Promise.resolve([
                    {
                      id: 17,
                      externalId: 'pln_closure_race',
                      nextRunAt: new Date('2026-08-19T09:00:00.000Z'),
                      repeatType: 'daily',
                      rrule: null,
                      endsAt: null,
                      userId: 42,
                    },
                  ]);
                }
                if (call === 1) return { limit: async () => [] };
                return { limit: async () => [{ status: 'closure_pending' }] };
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            return {
              async where() {
                updates.push(values);
                return [{ affectedRows: 1 }];
              },
            };
          },
        };
      },
    };
    const queue = vi.fn(async () => undefined);

    await plannedTick({ db: db as never, queue });

    expect(queue).not.toHaveBeenCalled();
    expect(updates).toEqual([{ status: 'running' }]);
  });
});
