import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation, withOperationDispatchScope } from '../execution/owned-operation.js';
import { runDirectOpen } from './direct-open.js';
import { TaskRepository } from './task-repository.js';

type Phase = 'read' | 'begin' | 'update' | 'event' | 'commit' | 'rollback';
type Outcome = Parameters<TaskRepository['persistVisionOutcome']>[1];
const phases: Phase[] = ['read', 'begin', 'update', 'event', 'commit', 'rollback'];
const completed: Outcome = { status: 'completed', summary: 'synthetic', tickCount: 1 };
const releases: Array<() => void> = [];
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fixture(
  options: {
    hold?: Phase;
    fail?: Phase;
    update?: unknown;
    event?: unknown;
    missing?: boolean;
  } = {},
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const calls: Phase[] = [];
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const ownedCounts: number[] = [];
  const drain = new ExecutionDrain();
  drain.open();
  // Only the mysql2 transport is synthetic. Real Drizzle emits the transaction
  // protocol; repository SQL construction and ownership remain production code.
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
      ownedCounts.push(drain.snapshot().byKind.database);
      if (options.hold === phase) await gate;
      if (
        options.fail === phase ||
        ((options.hold === 'rollback' || options.fail === 'rollback') && phase === 'event')
      ) {
        throw new Error('synthetic transport failure');
      }
      if (phase === 'read') return [options.missing ? [] : [[17]], []];
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
  const invoke = (outcome: Outcome = completed) =>
    repo.persistVisionOutcome('tsk_synthetic', outcome);
  const run = (outcome: Outcome = completed) =>
    startOwnedOperation(
      drain,
      'execution',
      async () => {
        try {
          return await invoke(outcome);
        } catch {
          return { persisted: false };
        }
      },
      { errorOutcome: 'known', dispatch: 'immediate' },
    ).result;
  return { calls, statements, ownedCounts, repo, drain, release, invoke, run };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  vi.restoreAllMocks();
});

// Removing an inner wrapper must fail these even if the outer transaction waits.
it.each(phases)('holds raw outcome %s with its own database lifetime', async (phase) => {
  const f = fixture({ hold: phase });
  let settled = false;
  const pending = f.run().then((value) => {
    settled = true;
    return value;
  });
  await flush();
  f.drain.close();
  expect(f.calls).toContain(phase);
  expect(settled).toBe(false);
  expect(f.ownedCounts[f.calls.indexOf(phase)]).toBe(
    phase === 'update' || phase === 'event' ? 2 : 1,
  );
  expect(f.drain.snapshot().idle).toBe(false);
  f.release();
  await pending;
  expect(f.drain.snapshot().active).toBe(0);
  if (phase === 'rollback') expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  else expect(f.drain.snapshot().idle).toBe(true);
});
it.each(phases)('retains swallowed outcome %s failure as unknown', async (phase) => {
  const f = fixture({ hold: phase, fail: phase });
  const pending = f.run();
  await flush();
  f.drain.close();
  expect(f.calls).toContain(phase);
  f.release();
  expect(await pending).toEqual({ persisted: false });
  expect(f.drain.snapshot().active).toBe(0);
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each([undefined, null, '1', -1, 2, Number.NaN, 0.5])(
  'refuses unproven outcome UPDATE receipt %s before event/commit',
  async (value) => {
    const f = fixture({ update: value });
    expect(await f.run()).toEqual({ persisted: false });
    expect(f.calls).toEqual(['read', 'begin', 'update', 'rollback']);
    expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it.each([undefined, null, '1', -1, 0, 2, Number.NaN, 0.5])(
  'refuses unproven outcome event receipt %s before commit',
  async (value) => {
    const f = fixture({ event: value });
    expect(await f.run()).toEqual({ persisted: false });
    expect(f.calls).toEqual(['read', 'begin', 'update', 'event', 'rollback']);
    expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it('keeps zero-row CAS as a known refusal without an event', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const f = fixture({ update: 0 });
  expect(await f.run()).toEqual({ persisted: false });
  f.drain.close();
  expect(f.calls).toEqual(['read', 'begin', 'update', 'commit']);
  expect(f.drain.snapshot().idle).toBe(true);
});
it.each(['read', 'update'] as const)(
  'stops new writes after uncertainty during %s',
  async (phase) => {
    const f = fixture({ hold: phase });
    const pending = f.run();
    await flush();
    const other = f.drain.admit('execution');
    f.drain.markUnknown(other);
    f.drain.finish(other);
    f.release();
    expect(await pending).toEqual({ persisted: false });
    expect(f.calls).toEqual(phase === 'read' ? ['read'] : ['read', 'begin', 'update', 'rollback']);
  },
);
it('refuses already unknown scope before the outcome read', async () => {
  const f = fixture();
  const other = f.drain.admit('execution');
  f.drain.markUnknown(other);
  f.drain.finish(other);
  expect(await f.run()).toEqual({ persisted: false });
  expect(f.calls).toEqual([]);
});
it('refuses sealed scope before the outcome read', async () => {
  const f = fixture();
  let rejected = false;
  await startOwnedOperation(
    f.drain,
    'execution',
    async () =>
      withOperationDispatchScope(async (seal) => {
        seal();
        try {
          await f.invoke();
        } catch {
          rejected = true;
        }
      }),
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  expect(rejected).toBe(true);
  expect(f.calls).toEqual([]);
});
it('refuses expired inherited scope before the outcome read', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  releases.push(release);
  let late!: Promise<unknown>;
  await startOwnedOperation(
    f.drain,
    'execution',
    async () => {
      late = gate.then(() => f.invoke()).catch(() => 'refused');
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  release();
  expect(await late).toBe('refused');
  expect(f.calls).toEqual([]);
});
it('retains ACK-before-read completion without permitting early idle', async () => {
  const f = fixture({ hold: 'read' });
  let pending!: Promise<unknown>;
  await startOwnedOperation(
    f.drain,
    'execution',
    async () => {
      pending = f.invoke().catch(() => ({ persisted: false }));
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  f.drain.close();
  expect(f.drain.snapshot().byKind.database).toBe(1);
  expect(f.drain.snapshot().idle).toBe(false);
  f.release();
  await pending;
  // Parent permission has expired: no new transaction may be created after its ACK.
  expect(f.calls).toEqual(['read']);
});
it('keeps a known missing task read from inventing a write', async () => {
  const f = fixture({ missing: true });
  expect(await f.run()).toEqual({ persisted: false });
  f.drain.close();
  expect(f.calls).toEqual(['read']);
  expect(f.drain.snapshot().idle).toBe(true);
});
it.each(['completed', 'partial_success', 'failed', 'paused', 'cancelled'] as const)(
  'preserves %s source-state CAS and event in the real SQL',
  async (status) => {
    const f = fixture();
    const outcome = { status, summary: 'synthetic', reason: 'synthetic', tickCount: 1 } as Outcome;
    expect(await f.run(outcome)).toEqual({ persisted: true });
    expect(f.calls).toEqual(['read', 'begin', 'update', 'event', 'commit']);
    const update = f.statements.find((q) => q.sql.startsWith('update'));
    const states =
      status === 'cancelled'
        ? ['pending', 'planning', 'queued', 'executing', 'paused']
        : ['pending', 'planning', 'queued', 'executing'];
    expect(update?.sql).toContain('`tasks`.`id` = ? and `tasks`.`status` in');
    expect(update?.params.slice(-(states.length + 1))).toEqual([17, ...states]);
    expect(update?.params).toContain(status);
    const event = f.statements.find((q) => q.sql.startsWith('insert'));
    expect(event?.params).toContain(`vision.${status}`);
  },
);
it('preserves unscoped legacy event receipt behavior', async () => {
  const f = fixture({ event: undefined });
  expect(await f.invoke()).toEqual({ persisted: true });
  expect(f.drain.snapshot().active).toBe(0);
});

// Execute the complete, unchanged production dispatch function with real
// repository + runDirectOpen. The full HTTP router is still Qwen-gated;
// this is caller integration, not browser/model/endpoint E2E.
const source = ts.createSourceFile(
  'tasks.ts',
  readFileSync(new URL('../trpc/routers/tasks.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const declarations: ts.VariableDeclaration[] = [];
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'dispatchDirectOpen'
  )
    declarations.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
function dispatch(repo: TaskRepository, events: string[]) {
  if (declarations.length !== 1 || !declarations[0]?.initializer)
    throw new Error('missing dispatch');
  const executor = {
    resetPageForTask: async () => {},
    getPage: async () => ({ url: () => 'https://example.com/' }),
    navigate: async () => ({ ok: true }),
    screenshot: async () => ({ base64: 'c3ludGhldGlj' }),
  };
  const dependencies = {
    directOpenFallbackExecutor: executor,
    directOpenUsesBrowserPool: false,
    directOpenUrl: 'https://example.com/',
    willQueueDirectOpen: false,
    repo,
    runDirectOpen,
    taskId: 'tsk_synthetic',
    broadcastToUser: (_user: string, event: { type: string }) => events.push(event.type),
  };
  const js = ts.transpileModule(`return (${declarations[0].initializer.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const run = new Function(...Object.keys(dependencies), js)(...Object.values(dependencies));
  return run({ userId: 'synthetic', logger: { error: () => {} } }) as Promise<void>;
}
it.each(['read', 'update', 'event', 'commit'] as const)(
  'actual direct-open caller neither retries nor broadcasts uncertain %s',
  async (phase) => {
    const f = fixture({ fail: phase });
    const events: string[] = [];
    await startOwnedOperation(f.drain, 'execution', () => dispatch(f.repo, events), {
      errorOutcome: 'known',
      dispatch: 'immediate',
    }).result;
    expect(f.calls.filter((value) => value === 'read')).toHaveLength(1);
    expect(events).toEqual([]);
    expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it('actual direct-open caller waits for commit before broadcasting', async () => {
  const f = fixture({ hold: 'commit' });
  const events: string[] = [];
  const pending = startOwnedOperation(f.drain, 'execution', () => dispatch(f.repo, events), {
    errorOutcome: 'known',
    dispatch: 'immediate',
  }).result;
  await flush();
  expect(f.calls).toContain('commit');
  expect(events).toEqual([]);
  expect(f.drain.snapshot().byKind.database).toBe(1);
  f.release();
  await pending;
  expect(events).toEqual(['server.vision.screencast', 'server.task.terminal']);
});
