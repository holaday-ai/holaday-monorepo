import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { DrainController } from '../execution/drain-controller.js';
import { type OperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import {
  type ScheduledRunnerDeps,
  startScheduledRunner,
  stopScheduledRunner,
} from './scheduled-runner.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const releases: Array<() => void> = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-scheduled-drain-')));
  roots.push(directory);
  writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...identity,
      bootId: 'd'.repeat(32),
      sequence: 1,
      mode: 'closed',
      dirty: false,
    })}\n`,
    { mode: 0o600 },
  );
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100_000,
    mono: () => 1000,
  });
  controllers.push(controller);
  const session = controller.connect();
  if (open)
    expect(
      (
        await controller.execute(
          session,
          Buffer.from(
            `${JSON.stringify({
              protocol: 1,
              op: 'open',
              ...identity,
              version: 2,
              serial: 1,
              expiresAt: 110_000,
            })}\n`,
          ),
        )
      ).ok,
    ).toBe(true);
  return { controller, close: () => controller.disconnect(session) };
}
function heldScan(fail = false) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  let calls = 0;
  const client = {
    async query() {
      calls++;
      await held;
      if (fail) throw new Error('synthetic query failure');
      return [[], []];
    },
  };
  return {
    db: drizzle(client as unknown as Connection) as unknown as DB,
    release,
    calls: () => calls,
  };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await stopScheduledRunner();
  vi.useRealTimers();
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});
function start(db: DB, controller: DrainController) {
  const deps: ScheduledRunnerDeps = {
    db,
    executionDrain: controller,
    dispatch: async () => null,
    pollIntervalMs: 10,
  };
  return startScheduledRunner(deps);
}
it('refuses a closed scheduled pass before its first database call', async () => {
  vi.useFakeTimers();
  const { controller } = await control(false);
  const f = heldScan();
  start(f.db, controller);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.calls()).toBe(0);
  expect(controller.state.read().dirty).toBe(false);
});
it('keeps the original database work owned after close and stop', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = heldScan();
  start(f.db, controller);
  await vi.advanceTimersByTimeAsync(0);
  close();
  const stopped = stopScheduledRunner();
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  expect(controller.drain.snapshot().byKind.scheduler).toBe(1);
  expect(controller.state.read().dirty).toBe(true);
  f.release();
  await stopped;
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('retains uncertainty when the scan catches a late database failure', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = heldScan(true);
  start(f.db, controller);
  await vi.advanceTimersByTimeAsync(0);
  close();
  const stopped = stopScheduledRunner();
  f.release();
  await stopped;
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  expect(controller.drain.snapshot().idle).toBe(false);
});

// Execute real Drizzle selects, updates and transactions. Only mysql2 transport
// and the externally supplied dispatch/notification services are synthetic.
function scheduledFixture(
  controller: DrainController,
  holdAt: string,
  failAt?: string,
  options: { ackAt?: string; ack?: unknown; reminder?: boolean } = {},
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const trace: Array<{ phase: string; database: number; execution: number; dirty: boolean }> = [];
  const contexts: Array<OperationLifetime | undefined> = [];
  async function boundary(phase: string) {
    const counts = controller.drain.snapshot();
    trace.push({
      phase,
      database: counts.byKind.database,
      execution: counts.byKind.execution,
      dirty: controller.state.read().dirty,
    });
    if (phase === holdAt) await held;
    if (phase === failAt) throw new Error('synthetic boundary failure');
  }
  const client = {
    async query(query: { sql: string } | string, params: unknown[] = []) {
      const sql = typeof query === 'string' ? query : query.sql;
      let phase: string;
      if (sql.startsWith('select'))
        phase = sql.includes('from `users`')
          ? sql.includes('for update')
            ? 'owner-lock'
            : 'owner'
          : sql.includes('last_reminder_run')
            ? 'reminder-scan'
            : 'scan';
      else if (sql.startsWith('update'))
        phase = sql.includes('last_run_at')
          ? 'finalize'
          : sql.includes('last_reminder_run')
            ? 'reminder-claim'
            : params[0] === 'running'
              ? 'claim'
              : 'recovery';
      else phase = sql.toLowerCase();
      await boundary(phase);
      if (phase === 'scan')
        return [options.reminder ? [] : [[7, 42, 'synthetic scheduled task', 'once', null]], []];
      if (phase === 'reminder-scan')
        return [
          [
            [
              7,
              42,
              'synthetic reminder',
              new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' '),
              30,
              null,
            ],
          ],
          [],
        ];
      if (phase === 'owner' || phase === 'owner-lock') return [[['active']], []];
      if (phase === options.ackAt) return [options.ack, []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const deps: ScheduledRunnerDeps = {
    db: drizzle(client as unknown as Connection) as unknown as DB,
    executionDrain: controller,
    pollIntervalMs: 10,
    dispatch: async (_input, lifetime?: OperationLifetime) => {
      contexts.push(lifetime);
      await boundary('dispatch');
      return 900;
    },
    notify: async (_input, lifetime?: OperationLifetime) => {
      contexts.push(lifetime);
      await boundary('notify');
    },
  };
  if (options.reminder)
    deps.notifyReminder = async (_input, lifetime?: OperationLifetime) => {
      contexts.push(lifetime);
      await boundary('reminder-notify');
    };
  return { deps, trace, contexts, release };
}

it.each(['claim', 'owner', 'owner-lock', 'finalize', 'commit', 'dispatch', 'notify'])(
  'pins the original %s boundary and waits for the complete pass after stop',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, phase);
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.trace.at(-1)?.phase).toBe(phase);
    close();
    let done = false;
    const stopped = stopScheduledRunner().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    const counts = controller.drain.snapshot();
    expect(
      phase === 'dispatch' || phase === 'notify' ? counts.byKind.execution : counts.byKind.database,
    ).toBeGreaterThan(0);
    f.release();
    await stopped;
    expect(f.trace.at(-1)?.phase).toBe('notify');
    expect(f.trace.every((entry) => entry.dirty)).toBe(true);
    expect(
      f.trace.every((entry) =>
        ['dispatch', 'notify'].includes(entry.phase) ? entry.execution > 0 : entry.database > 0,
      ),
    ).toBe(true);
    expect(f.contexts).toHaveLength(2);
    expect(f.contexts.every((context) => context?.drain === controller.drain)).toBe(true);
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);

it.each([undefined, null, { affectedRows: '1' }, { affectedRows: -1 }, { affectedRows: 2 }])(
  'retains an unconfirmed claim ACK %j instead of reporting idle',
  async (ack) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, 'never', undefined, { ackAt: 'claim', ack });
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    close();
    await stopScheduledRunner();
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(controller.drain.snapshot().idle).toBe(false);
    expect(f.trace.filter((entry) => entry.phase === 'dispatch')).toHaveLength(0);
  },
);

it.each([-1, 2, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
  'does not send a reminder on an unconfirmed single-row ACK %s',
  async (affectedRows) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, 'never', undefined, {
      reminder: true,
      ackAt: 'reminder-claim',
      ack: { affectedRows },
    });
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    close();
    await stopScheduledRunner();
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(f.trace.filter((entry) => entry.phase === 'reminder-notify')).toHaveLength(0);
  },
);

it('treats an explicit lost claim as a known no-op', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never', undefined, {
    ackAt: 'claim',
    ack: { affectedRows: 0 },
  });
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(f.trace.map((entry) => entry.phase)).toEqual(['scan', 'claim']);
  expect(controller.drain.snapshot().idle).toBe(true);
});

it('preserves legacy extraction and single-argument hooks without a controller', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never', undefined, {
    ackAt: 'claim',
    ack: { affectedRows: 2 },
  });
  f.deps.executionDrain = undefined;
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(f.trace.filter((entry) => entry.phase === 'dispatch')).toHaveLength(1);
  expect(f.contexts).toEqual([undefined, undefined]);
  expect(controller.state.read().dirty).toBe(false);
  expect(controller.drain.snapshot().idle).toBe(true);
});

it('does not mark a confirmed skipped dispatch as unknown', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never');
  f.deps.dispatch = async () => ({ skipped: true, note: 'synthetic known skip' });
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(f.trace.filter((entry) => entry.phase === 'finalize')).toHaveLength(1);
  expect(controller.drain.snapshot().idle).toBe(true);
});

it('retains uncertainty when dispatch returns null after hiding its failure', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never');
  f.deps.dispatch = async () => null;
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it.each(['reminder-scan', 'reminder-claim', 'reminder-notify'])(
  'keeps the original %s failure visible after stop',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, phase, phase, { reminder: true });
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.trace.at(-1)?.phase).toBe(phase);
    close();
    const stopped = stopScheduledRunner();
    expect(controller.drain.snapshot().active).toBeGreaterThan(0);
    f.release();
    await stopped;
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);

it('keeps detached work reserved by a hook after the poll returns', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  let result: Promise<void> | undefined;
  let captured: OperationLifetime | undefined;
  f.deps.dispatch = async (_input, lifetime?: OperationLifetime) => {
    captured = lifetime;
    if (!lifetime) throw new Error('missing scheduled hook lifetime');
    result = startOwnedOperation(lifetime.drain, 'execution', async () => held, {
      parent: lifetime.owner,
      errorOutcome: 'unknown',
      dispatch: 'immediate',
    }).result;
    return 900;
  };
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(controller.drain.snapshot().byKind.execution).toBe(1);
  if (!captured) throw new Error('missing captured lifetime');
  const previousOwner = captured.owner;
  expect(() => controller.drain.fork(previousOwner, 'execution')).toThrow('EXECUTION_DRAIN_OWNER');
  release();
  await result;
  expect(controller.drain.snapshot().idle).toBe(true);
});

it('does not dispatch another raw operation after permanent block', async () => {
  vi.useFakeTimers();
  const { controller } = await control();
  const f = scheduledFixture(controller, 'scan');
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  controller.drain.block();
  const stopped = stopScheduledRunner();
  f.release();
  await stopped;
  expect(f.trace.map((entry) => entry.phase)).toEqual(['scan']);
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().idle).toBe(false);
});

it.each([false, true])(
  'owns periodic recovery through its late outcome (failure=%s)',
  async (failure) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, 'recovery', failure ? 'recovery' : undefined);
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.trace.at(-1)?.phase).toBe('recovery');
    close();
    const stopped = stopScheduledRunner();
    expect(controller.drain.snapshot().byKind.database).toBe(1);
    f.release();
    await stopped;
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown > 0).toBe(failure);
    expect(controller.drain.snapshot().idle).toBe(!failure);
  },
);

it('does not release a failed transaction while rollback is still pending', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'rollback', 'finalize');
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.trace.at(-1)?.phase).toBe('rollback');
  close();
  let stopped = false;
  const pending = stopScheduledRunner().then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(stopped).toBe(false);
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  f.release();
  await pending;
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('does not lose a synchronous notification failure', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never');
  f.deps.notify = () => {
    throw new Error('synthetic sync failure');
  };
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(0);
  close();
  await stopScheduledRunner();
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('does not start another recovery/dispatch pass while a commit remains unknown', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never', 'commit');
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(30);
  close();
  await stopScheduledRunner();
  expect(f.trace.filter((entry) => entry.phase === 'dispatch')).toHaveLength(1);
  expect(f.trace.filter((entry) => entry.phase === 'recovery')).toHaveLength(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('does not scan or redispatch after an unconfirmed recovery within the same pass', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const f = scheduledFixture(controller, 'never', 'recovery');
  startScheduledRunner(f.deps);
  await vi.advanceTimersByTimeAsync(10);
  close();
  await stopScheduledRunner();
  expect(f.trace.filter((entry) => entry.phase === 'dispatch')).toHaveLength(1);
  expect(f.trace.at(-1)?.phase).toBe('recovery');
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it.each(['claim', 'owner', 'commit', 'notify'])(
  'does not erase a caught late %s failure',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const f = scheduledFixture(controller, phase, phase);
    startScheduledRunner(f.deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.trace.at(-1)?.phase).toBe(phase);
    close();
    const stopped = stopScheduledRunner();
    f.release();
    await stopped;
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(controller.drain.snapshot().idle).toBe(false);
  },
);
