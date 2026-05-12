/**
 * Codex follow-up — scheduled-tasks tRPC router unit tests.
 *
 * Locks in the `toggle` mutation's status-guard behaviour now that
 * `pause` / `resume` are gone (they were dead code — the SPA only
 * ever called `toggle`). The interesting paths:
 *
 *   - completed   → rejected (re-firing a one-shot would dupe a job)
 *   - running     → rejected (would race with the runner's restore)
 *   - failed      → ALLOWED to flip to 'active' (P1 retry path: a
 *                   one-shot that errored can be re-armed)
 *   - active      → flips to 'paused'
 *   - paused      → flips to 'active'
 *
 * Driven via `createCaller` with a minimal fake drizzle-shaped db
 * so we don't need to spin up MySQL or hit the network.
 */

import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { scheduledTasksRouter } from './scheduled-tasks.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface ScheduledRow {
  externalId: string;
  status: string;
  userId: number;
}

function makeCtx(rows: ScheduledRow[], userExternalId = 'usr_test') {
  const updates: Array<{ status?: string; predicate: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tName = (table as any)?.[Symbol.for('drizzle:Name')] ?? '';
          return {
            where(predicate: unknown) {
              return {
                async limit(_n: number): Promise<unknown[]> {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const s = require('node:util').inspect(predicate, {
                    depth: 6,
                    getters: true,
                  });
                  if (tName === 'users') {
                    if (s.includes(`value: '${userExternalId}'`)) {
                      return [{ id: 42 }];
                    }
                    return [];
                  }
                  if (tName === 'scheduled_tasks') {
                    const hit = rows.find(
                      (r) =>
                        s.includes(`value: '${r.externalId}'`) &&
                        s.includes(`value: ${r.userId}`),
                    );
                    return hit ? [{ status: hit.status }] : [];
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(setValues: Record<string, unknown>) {
          return {
            async where(predicate: unknown) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const s = require('node:util').inspect(predicate, {
                depth: 6,
                getters: true,
              });
              // The toggle uses a conditional WHERE that includes the
              // current status to prevent a race with the runner. Find
              // the row whose externalId + userId + status all match.
              const hit = rows.find(
                (r) =>
                  s.includes(`value: '${r.externalId}'`) &&
                  s.includes(`value: ${r.userId}`) &&
                  s.includes(`value: '${r.status}'`),
              );
              if (hit) {
                hit.status = (setValues.status as string) ?? hit.status;
                updates.push({ status: setValues.status as string, predicate: s });
                return { affectedRows: 1 };
              }
              return { affectedRows: 0 };
            },
          };
        },
      };
    },
  };
  return {
    db,
    rows,
    updates,
    ctx: {
      db,
      userId: userExternalId,
      logger: fakeLogger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

describe('scheduledTasksRouter.toggle — status guards (Codex follow-up)', () => {
  it('completed row → BAD_REQUEST (one-shot already fired)', async () => {
    const { ctx } = makeCtx([{ externalId: 'sch_done', status: 'completed', userId: 42 }]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    await expect(caller.toggle({ scheduledTaskId: 'sch_done' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('running row → BAD_REQUEST (would race with runner restore)', async () => {
    const { ctx } = makeCtx([{ externalId: 'sch_run', status: 'running', userId: 42 }]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    await expect(caller.toggle({ scheduledTaskId: 'sch_run' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('failed row → flips to ACTIVE (Codex P1 retry path)', async () => {
    // Codex P1 added the 'failed' terminal state for one-shot tasks
    // whose dispatch threw. The user clicks Play on the row and we
    // re-arm it: status='failed' → 'active'. The runner's existing
    // due-row scan will pick it up on the next tick.
    const { ctx, rows } = makeCtx([{ externalId: 'sch_fail', status: 'failed', userId: 42 }]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    const result = await caller.toggle({ scheduledTaskId: 'sch_fail' });
    expect(result).toEqual({ ok: true, status: 'active' });
    expect(rows[0]?.status).toBe('active');
  });

  it('active row → flips to PAUSED', async () => {
    const { ctx, rows } = makeCtx([{ externalId: 'sch_a', status: 'active', userId: 42 }]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    const result = await caller.toggle({ scheduledTaskId: 'sch_a' });
    expect(result).toEqual({ ok: true, status: 'paused' });
    expect(rows[0]?.status).toBe('paused');
  });

  it('paused row → flips to ACTIVE', async () => {
    const { ctx, rows } = makeCtx([{ externalId: 'sch_p', status: 'paused', userId: 42 }]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    const result = await caller.toggle({ scheduledTaskId: 'sch_p' });
    expect(result).toEqual({ ok: true, status: 'active' });
    expect(rows[0]?.status).toBe('active');
  });

  it('unknown id → NOT_FOUND', async () => {
    const { ctx } = makeCtx([]);
    const caller = scheduledTasksRouter.createCaller(ctx);
    await expect(caller.toggle({ scheduledTaskId: 'sch_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('scheduledTasksRouter — pause / resume are gone (Codex follow-up)', () => {
  it('router exposes only the curated surface: list / create / toggle / delete (no pause / resume)', () => {
    // Drizzle / tRPC routers don't expose a clean introspection API,
    // but `_def.procedures` (or `_def.record` in newer versions)
    // carries the proc map. Either shape contains the surviving
    // procedure names; the deleted ones must NOT appear.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (scheduledTasksRouter as any)._def;
    const procs = def?.procedures ?? def?.record ?? {};
    const names = new Set(Object.keys(procs));
    expect(names.has('list')).toBe(true);
    expect(names.has('create')).toBe(true);
    expect(names.has('toggle')).toBe(true);
    expect(names.has('delete')).toBe(true);
    expect(names.has('pause')).toBe(false);
    expect(names.has('resume')).toBe(false);
  });
});

// Silences `TRPCError` unused-import warning on lint runs that strip
// type-only imports.
void TRPCError;
