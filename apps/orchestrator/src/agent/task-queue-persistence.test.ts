import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation, withOperationDispatchScope } from '../execution/owned-operation.js';
import { TaskRepository } from './task-repository.js';

type Kind = 'start' | 'fail';
type Phase = 'read' | 'begin' | 'update' | 'event' | 'commit' | 'rollback';
const phases: Phase[] = ['read', 'begin', 'update', 'event', 'commit', 'rollback'];
const releases: Array<() => void> = [];
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fixture(options: { hold?: Phase; fail?: Phase; update?: unknown; event?: unknown } = {}) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const calls: Phase[] = [];
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (query: { sql: string }, params: unknown[] = []) => {
      const sql = query.sql;
      const phase: Phase = sql.startsWith('select')
        ? 'read'
        : sql.startsWith('update')
          ? 'update'
          : sql.startsWith('insert')
            ? 'event'
            : sql === 'commit'
              ? 'commit'
              : sql === 'rollback'
                ? 'rollback'
                : 'begin';
      calls.push(phase);
      statements.push({ sql, params });
      if (options.hold === phase) await gate;
      if (options.fail === phase || (options.hold === 'rollback' && phase === 'event'))
        throw new Error('synthetic database failure');
      if (phase === 'read') return [[[17]], []];
      const affectedRows =
        phase === 'update' && 'update' in options
          ? options.update
          : phase === 'event' && 'event' in options
            ? options.event
            : 1;
      return [{ affectedRows, insertId: 17 }, []];
    },
  };
  const repo = new TaskRepository(drizzle(client as unknown as Connection) as unknown as DB);
  const drain = new ExecutionDrain();
  drain.open();
  const invoke = (kind: Kind) =>
    kind === 'start'
      ? repo.markQueuedTaskExecuting('tsk_synthetic')
      : repo.markQueuedTaskFailed('tsk_synthetic', 'synthetic timeout');
  const run = (kind: Kind) =>
    startOwnedOperation(
      drain,
      'execution',
      async () => {
        try {
          return await invoke(kind);
        } catch {
          return { persisted: false };
        }
      },
      { errorOutcome: 'known', dispatch: 'immediate' },
    ).result;
  return { repo, drain, calls, statements, release, run, invoke };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
});
it.each((['start', 'fail'] as const).flatMap((kind) => phases.map((phase) => ({ kind, phase }))))(
  'owns raw $kind $phase until physical completion',
  async ({ kind, phase }) => {
    const f = fixture({ hold: phase });
    let settled = false;
    const pending = f.run(kind).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    f.drain.close();
    expect(f.calls).toContain(phase);
    expect(settled).toBe(false);
    expect(f.drain.snapshot().byKind.database).toBeGreaterThan(0);
    f.release();
    await pending;
    expect(f.drain.snapshot().active).toBe(0);
    if (phase === 'rollback') expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
    else expect(f.drain.snapshot().idle).toBe(true);
  },
);
it.each((['start', 'fail'] as const).flatMap((kind) => phases.map((phase) => ({ kind, phase }))))(
  'retains swallowed $kind $phase failure',
  async ({ kind, phase }) => {
    const f = fixture({ hold: phase, fail: phase });
    const pending = f.run(kind);
    await flush();
    f.drain.close();
    f.release();
    expect(await pending).toEqual({ persisted: false });
    expect(f.drain.snapshot().active).toBe(0);
    expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it.each(
  (['start', 'fail'] as const).flatMap((kind) =>
    [undefined, null, '1', -1, 2].map((value) => ({ kind, value })),
  ),
)('rejects malformed $kind update receipt $value', async ({ kind, value }) => {
  const f = fixture({ update: value });
  expect(await f.run(kind)).toEqual({ persisted: false });
  f.drain.close();
  expect(f.calls).not.toContain('event');
  expect(f.calls).not.toContain('commit');
  expect(f.calls).toContain('rollback');
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each(
  (['start', 'fail'] as const).flatMap((kind) =>
    [undefined, null, '1', -1, 0, 2].map((value) => ({ kind, value })),
  ),
)('rejects malformed $kind event receipt $value', async ({ kind, value }) => {
  const f = fixture({ event: value });
  expect(await f.run(kind)).toEqual({ persisted: false });
  expect(f.calls).not.toContain('commit');
  expect(f.calls).toContain('rollback');
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each(['start', 'fail'] as const)(
  'preserves known zero-row $kind CAS without uncertainty or events',
  async (kind) => {
    const f = fixture({ update: 0 });
    expect(await f.run(kind)).toEqual({ persisted: false });
    f.drain.close();
    expect(f.calls).toEqual(['read', 'begin', 'update', 'commit']);
    expect(f.drain.snapshot().idle).toBe(true);
  },
);
it.each(['read', 'update'] as const)(
  'does not dispatch the next write after unknown appears during %s',
  async (phase) => {
    const f = fixture({ hold: phase });
    const pending = f.run('start');
    await flush();
    const other = f.drain.admit('execution');
    f.drain.markUnknown(other);
    f.drain.finish(other);
    f.release();
    expect(await pending).toEqual({ persisted: false });
    expect(f.calls).toEqual(phase === 'read' ? ['read'] : ['read', 'begin', 'update', 'rollback']);
  },
);
it('refuses a sealed scope before any raw query', async () => {
  const f = fixture();
  const pending = startOwnedOperation(
    f.drain,
    'execution',
    async () =>
      withOperationDispatchScope(async (seal) => {
        seal();
        try {
          await f.invoke('start');
        } catch {}
      }),
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  await pending;
  expect(f.calls).toEqual([]);
});
it.each(['start', 'fail'] as const)(
  'preserves actual %s SQL and event with a valid transaction',
  async (kind) => {
    const f = fixture();
    expect(await f.run(kind)).toEqual({ persisted: true });
    expect(f.calls).toEqual(['read', 'begin', 'update', 'event', 'commit']);
    const update = f.statements.find((q) => q.sql.startsWith('update'));
    expect(update?.sql).toContain('`tasks`.`external_id` = ? and `tasks`.`status` = ?');
    expect(update?.params.slice(-2)).toEqual(['tsk_synthetic', 'queued']);
    expect(update?.params).toContain(kind === 'start' ? 'executing' : 'failed');
    const event = f.statements.find((q) => q.sql.startsWith('insert'));
    expect(event?.params).toContain(kind === 'start' ? 'task.transition' : 'task.failed');
  },
);
it('preserves the legacy unscoped receipt behavior', async () => {
  const f = fixture({ event: undefined });
  expect(await f.invoke('start')).toEqual({ persisted: true });
  expect(f.drain.snapshot().active).toBe(0);
});
