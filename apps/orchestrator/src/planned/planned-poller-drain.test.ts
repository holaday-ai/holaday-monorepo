import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import { logger } from '../config/logger.js';
import type { DB } from '../db/client.js';
import { DrainController } from '../execution/drain-controller.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';
import {
  type PlannedRunnerDeps,
  plannedTick,
  startPlannedRunner,
  stopPlannedRunner,
} from './planned-runner.js';

const directories: string[] = [];
const controllers: DrainController[] = [];
const releases: Array<() => void> = [];
const children: Promise<unknown>[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-planned-poller-')));
  directories.push(directory);
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  return { controller, close: () => controller.disconnect(session) };
}
async function flush() {
  for (let i = 0; i < 600; i++) await Promise.resolve();
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await stopPlannedRunner();
  await Promise.allSettled(children.splice(0));
  await flush();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const c of controllers.splice(0)) c.state.abandon();
  for (const d of directories.splice(0)) rmSync(d, { recursive: true });
});
type Options = {
  hold?: string;
  fail?: string;
  ackAt?: string;
  ack?: unknown;
  reminder?: boolean;
  two?: boolean;
  batch?: boolean;
  hiddenUnknown?: string;
  detached?: boolean;
  override?: 'skipped' | 'rescheduled';
};
function fixture(controller: DrainController, options: Options = {}) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const trace: Array<{
    phase: string;
    database: number;
    scheduler: number;
    execution: number;
    dirty: boolean;
  }> = [];
  const hookArgs: Array<{
    phase: string;
    count: number;
    lifetime?: OperationLifetime;
    ambient?: OperationLifetime;
  }> = [];
  async function boundary(phase: string) {
    const counts = controller.drain.snapshot();
    trace.push({
      phase,
      database: counts.byKind.database,
      scheduler: counts.byKind.scheduler,
      execution: counts.byKind.execution,
      dirty: controller.state.read().dirty,
    });
    if (phase === options.hold) await held;
    if (phase === options.fail) throw new Error('synthetic boundary failure');
  }
  const client = {
    async query(query: { sql: string } | string, params: unknown[] = []) {
      const sql = typeof query === 'string' ? query : query.sql;
      let phase: string;
      let rows: unknown = [];
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') phase = sql;
      else if (sql.startsWith('select')) {
        if (sql.includes('from `planned_tasks`')) {
          if (sql.includes('`external_id`')) {
            phase = 'due-read';
            rows = [[7, 'pln_synthetic', '2026-09-10 11:59:00', 'once', null, null, 42]];
            if (options.two)
              rows = [
                ...(rows as unknown[][]),
                [8, 'pln_second', '2026-09-10 11:59:00', 'once', null, null, 42],
              ];
          } else if (sql.includes('`reminder_minutes`')) {
            phase = 'reminder-read';
            rows = options.reminder
              ? [[7, 42, 'synthetic plan', '2026-09-10 12:05:00', 10, null]]
              : [];
            if (options.two && options.reminder)
              rows = [
                ...(rows as unknown[][]),
                [8, 42, 'synthetic plan', '2026-09-10 12:05:00', 10, null],
              ];
          } else {
            phase = 'normalize-read';
            rows = options.override ? [[7, '2026-09-10 11:59:00', 'once', null, null]] : [];
          }
        } else if (sql.includes('from `planned_task_occurrence_overrides`')) {
          phase = sql.startsWith('select `original_scheduled_for`')
            ? 'due-override'
            : 'normalize-override';
          rows = options.override
            ? phase === 'due-override'
              ? [
                  [
                    '2026-09-10 11:59:00',
                    options.override,
                    options.override === 'rescheduled' ? '2026-09-10 13:00:00' : null,
                  ],
                ]
              : [
                  [
                    options.override,
                    options.override === 'rescheduled' ? '2026-09-10 13:00:00' : null,
                  ],
                ]
            : [];
        } else if (sql.includes('from `users`')) {
          phase = 'owner-read';
          rows = [['active']];
        } else if (sql.includes('from `planned_task_runs`')) {
          phase = 'sync-read';
          rows = [[9, 7, options.batch ? null : 55, options.batch ? 66 : null]];
        } else if (sql.includes('from `tasks`')) {
          phase = 'task-read';
          rows = [['completed', null]];
        } else if (sql.includes('from `batch_tasks`')) {
          phase = 'batch-read';
          rows = [['completed', 2, 2, 0, 0]];
        } else if (sql.includes('from `batch_task_items`')) {
          phase = 'batch-items-read';
          rows = [
            [0, 'completed', 55, null, null],
            [1, 'completed', 56, null, null],
          ];
        } else throw new Error('unexpected synthetic select');
      } else if (sql.startsWith('update `planned_tasks`')) {
        if (sql.includes('EXISTS')) {
          phase = 'recover';
        } else if (sql.startsWith('update `planned_tasks` set `last_reminder_run`'))
          phase = 'reminder-claim';
        else if (params[0] === 'running') phase = 'claim';
        else if (sql.includes('`next_run_at` = ?')) phase = 'override-write';
        else if (params[0] === 'failed') phase = 'queue-failure-write';
        else phase = 'sync-plan-write';
        rows = { affectedRows: 1 };
      } else if (sql.startsWith('update `planned_task_runs`')) {
        phase = 'sync-run-write';
        rows = { affectedRows: 1 };
      } else if (sql.startsWith('update `planned_task_run_items`')) {
        phase = 'sync-items-write';
        rows = { affectedRows: 1 };
      } else throw new Error('unexpected synthetic query');
      await boundary(phase);
      return [phase === options.ackAt ? options.ack : rows, []];
    },
  };
  async function hook(phase: string, count: number, lifetime?: OperationLifetime) {
    hookArgs.push({ phase, count, lifetime, ambient: currentOperationLifetime() });
    await boundary(phase);
    if (options.hiddenUnknown === phase && lifetime) lifetime.drain.markUnknown(lifetime.owner);
    if (options.detached && phase === 'queue' && lifetime) {
      const child = startOwnedOperation(lifetime.drain, 'execution', async () => held, {
        parent: lifetime.owner,
        errorOutcome: 'unknown',
        dispatch: 'immediate',
      }).result;
      children.push(child);
      void child.catch(() => {});
    }
  }
  const deps: PlannedRunnerDeps & { executionDrain?: DrainController } = {
    db: drizzle(client as unknown as Connection) as unknown as DB,
    executionDrain: controller,
    pollIntervalMs: 10,
    async queue(...args: Parameters<PlannedRunnerDeps['queue']>) {
      await hook('queue', args.length, args[1]);
    },
    async notifyReminder(...args: Parameters<NonNullable<PlannedRunnerDeps['notifyReminder']>>) {
      await hook('notify', args.length, args[1]);
    },
  };
  return { deps, trace, hookArgs, release };
}
it('rejects a closed pass before recovery SQL or dirty state', async () => {
  const { controller } = await control(false);
  const f = fixture(controller);
  startPlannedRunner(f.deps);
  await flush();
  await stopPlannedRunner();
  expect(f.trace).toHaveLength(0);
  expect(controller.state.read().dirty).toBe(false);
});
it.each(['recover', 'claim', 'queue', 'notify', 'sync-read', 'sync-run-write', 'commit'])(
  'stop holds the original %s boundary',
  async (hold) => {
    const { controller, close } = await control();
    const f = fixture(controller, { hold, reminder: hold === 'notify' });
    startPlannedRunner(f.deps);
    await flush();
    expect(f.trace.some((row) => row.phase === hold)).toBe(true);
    close();
    let stopped = false;
    const stop = stopPlannedRunner().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(false);
    expect(controller.drain.snapshot().byKind.scheduler).toBe(1);
    if (hold !== 'queue' && hold !== 'notify')
      expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
    else expect(controller.drain.snapshot().byKind.execution).toBeGreaterThan(0);
    f.release();
    await stop;
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each(['recover', 'queue', 'notify', 'sync-read', 'commit'])(
  'retains late %s failure despite pass or hook catch',
  async (fail) => {
    const { controller, close } = await control();
    const f = fixture(controller, { hold: fail, fail, reminder: fail === 'notify' });
    startPlannedRunner(f.deps);
    await flush();
    close();
    const stop = stopPlannedRunner();
    f.release();
    await stop;
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it.each(['recover', 'claim', 'reminder-claim'])(
  'unproven %s ACK cannot dispatch',
  async (ackAt) => {
    const { controller } = await control();
    const f = fixture(controller, {
      ackAt,
      ack: { affectedRows: -1 },
      reminder: ackAt === 'reminder-claim',
    });
    startPlannedRunner(f.deps);
    await flush();
    await stopPlannedRunner();
    expect(f.hookArgs).toHaveLength(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it.each(['queue', 'notify'])(
  'unknown %s outcome stops same-pass candidates and later recovery',
  async (hiddenUnknown) => {
    const { controller } = await control();
    const f = fixture(controller, {
      hiddenUnknown,
      two: true,
      reminder: hiddenUnknown === 'notify',
    });
    startPlannedRunner(f.deps);
    await flush();
    await vi.advanceTimersByTimeAsync(30);
    await stopPlannedRunner();
    expect(f.hookArgs.filter((row) => row.phase === hiddenUnknown)).toHaveLength(1);
    expect(f.trace.filter((row) => row.phase === 'recover')).toHaveLength(1);
    if (hiddenUnknown === 'notify')
      expect(f.hookArgs.some((row) => row.phase === 'queue')).toBe(false);
  },
);
it('does not recover while a hook child outlives the poll ACK', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { detached: true });
  startPlannedRunner(f.deps);
  await flush();
  await vi.advanceTimersByTimeAsync(30);
  expect(f.trace.filter((row) => row.phase === 'recover')).toHaveLength(1);
  expect(controller.drain.snapshot().active).toBe(1);
  close();
  await stopPlannedRunner();
  f.release();
  await Promise.all(children);
  await flush();
  expect(controller.drain.snapshot().idle).toBe(true);
});
it.each([false, true])('tracks every raw sync boundary (batch=%s)', async (batch) => {
  const { controller, close } = await control();
  const f = fixture(controller, { batch });
  startPlannedRunner(f.deps);
  await flush();
  close();
  await stopPlannedRunner();
  expect(f.trace.some((row) => row.phase === 'commit')).toBe(true);
  expect(
    f.trace.filter((row) => row.phase !== 'queue').every((row) => row.database > 0 && row.dirty),
  ).toBe(true);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('passes exactly the live hook capability in its own scope', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { reminder: true });
  startPlannedRunner(f.deps);
  await flush();
  close();
  await stopPlannedRunner();
  expect(f.hookArgs).toHaveLength(2);
  for (const h of f.hookArgs) {
    expect(h.count).toBe(2);
    expect(h.lifetime).toBe(h.ambient);
    expect(h.lifetime?.drain).toBe(controller.drain);
  }
});

it('preserves the unscoped hook receiver and single-argument contract', async () => {
  const { controller } = await control();
  const f = fixture(controller, { reminder: true });
  f.deps.executionDrain = undefined;
  const seen: Array<{ receiver: unknown; args: number }> = [];
  f.deps.queue = async function (this: PlannedRunnerDeps, ...args) {
    seen.push({ receiver: this, args: args.length });
  };
  f.deps.notifyReminder = async function (this: PlannedRunnerDeps, ...args) {
    seen.push({ receiver: this, args: args.length });
  };
  startPlannedRunner(f.deps);
  await flush();
  await stopPlannedRunner();
  expect(seen).toHaveLength(2);
  expect(seen.every((row) => row.receiver === f.deps && row.args === 1)).toBe(true);
  expect(f.trace.every((row) => row.database === 0 && !row.dirty)).toBe(true);
});
it.each([false, true])(
  'requires an inherited scope for controlled direct plannedTick (open=%s)',
  async (open) => {
    const { controller } = await control(open);
    const f = fixture(controller);
    await expect(plannedTick(f.deps)).rejects.toThrow();
    expect(f.trace).toHaveLength(0);
  },
);
it('holds original rollback after sync write fails', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { fail: 'sync-run-write', hold: 'rollback' });
  startPlannedRunner(f.deps);
  await flush();
  close();
  const stopped = stopPlannedRunner();
  expect(f.trace.some((row) => row.phase === 'rollback')).toBe(true);
  expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
  f.release();
  await stopped;
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each(['skipped', 'rescheduled'] as const)(
  'owns normalized and due %s override writes without queueing',
  async (override) => {
    const { controller, close } = await control();
    const f = fixture(controller, { override });
    startPlannedRunner(f.deps);
    await flush();
    close();
    await stopPlannedRunner();
    expect(f.hookArgs).toHaveLength(0);
    expect(f.trace.filter((row) => row.phase === 'override-write').length).toBeGreaterThan(0);
    expect(
      f.trace.filter((row) => row.phase === 'override-write').every((row) => row.database > 0),
    ).toBe(true);
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each([undefined, { affectedRows: 2 }, { affectedRows: Number.NaN }])(
  'refuses invalid single-row claim ACK %j',
  async (ack) => {
    const { controller } = await control();
    const f = fixture(controller, { ackAt: 'claim', ack });
    startPlannedRunner(f.deps);
    await flush();
    await stopPlannedRunner();
    expect(f.hookArgs).toHaveLength(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it.each(['claim', 'reminder-claim'])('keeps definite zero %s as a known no-op', async (ackAt) => {
  const { controller, close } = await control();
  const f = fixture(controller, {
    ackAt,
    ack: { affectedRows: 0 },
    reminder: ackAt === 'reminder-claim',
  });
  startPlannedRunner(f.deps);
  await flush();
  close();
  await stopPlannedRunner();
  expect(f.hookArgs.some((row) => row.phase === (ackAt === 'claim' ? 'queue' : 'notify'))).toBe(
    false,
  );
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('allows a proven multi-row recovery ACK', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { ackAt: 'recover', ack: { affectedRows: 3 } });
  startPlannedRunner(f.deps);
  await flush();
  close();
  await stopPlannedRunner();
  expect(f.hookArgs.filter((row) => row.phase === 'queue')).toHaveLength(1);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('close before the scheduled microtask prevents the first IO', async () => {
  const { controller, close } = await control();
  const f = fixture(controller);
  startPlannedRunner(f.deps);
  close();
  await flush();
  await stopPlannedRunner();
  expect(f.trace).toHaveLength(0);
  expect(controller.state.read().dirty).toBe(false);
});

it('refuses hook dispatch when uncertainty appears during the owner read', async () => {
  const { controller } = await control();
  const f = fixture(controller, { hold: 'owner-read' });
  startPlannedRunner(f.deps);
  await flush();
  expect(f.trace.some((row) => row.phase === 'owner-read')).toBe(true);
  await controller.runRoot(async (lifetime) => {
    lifetime.drain.markUnknown(lifetime.owner);
  }).result;
  f.release();
  await stopPlannedRunner();
  expect(f.hookArgs).toHaveLength(0);
  expect(f.trace.some((row) => row.phase === 'queue-failure-write')).toBe(false);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it('retains a synchronous queue throw before the old catch writes failure', async () => {
  const { controller } = await control();
  const f = fixture(controller);
  f.deps.queue = () => {
    throw new Error('synthetic synchronous dispatch failure');
  };
  startPlannedRunner(f.deps);
  await flush();
  await stopPlannedRunner();
  expect(f.trace.some((row) => row.phase === 'queue-failure-write')).toBe(true);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
