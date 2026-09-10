import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { afterEach, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { DrainController } from '../execution/drain-controller.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
} from '../execution/owned-operation.js';
import type { Context } from '../trpc/context.js';
import {
  type PlannedRunSpecialDispatchResult,
  configurePlannedRunSpecialDispatcher,
  queuePlannedRun,
} from './planned-runner.js';

const directories: string[] = [];
const controls: DrainController[] = [];
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-planned-drain-')));
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
  controls.push(controller);
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
async function flush() {
  for (let i = 0; i < 500; i++) await Promise.resolve();
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  await flush();
  configurePlannedRunSpecialDispatcher(null);
  for (const controller of controls.splice(0)) controller.state.abandon();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const input = {
  plannedTaskId: 'pln_synthetic',
  scheduledFor: new Date('2026-09-10T01:00:00Z'),
  trigger: 'manual' as const,
};
type Options = {
  hold?: string;
  fail?: string;
  ackAt?: string;
  ack?: unknown;
  existing?: boolean;
  generic?: boolean;
  multiple?: boolean;
  specialResult?: unknown;
  ownerInactive?: boolean;
};
// Real Drizzle transaction/query paths. Only the mysql2 wire boundary and
// the configured external special service are synthetic; routers are real.
function fixture(controller: DrainController, options: Options = {}) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const trace: Array<{
    phase: string;
    database: number;
    execution: number;
    request: number;
    dirty: boolean;
    lifetime?: OperationLifetime;
  }> = [];
  const hookContexts: Context[] = [];
  async function boundary(phase: string) {
    const counts = controller.drain.snapshot();
    trace.push({
      phase,
      database: counts.byKind.database,
      execution: counts.byKind.execution,
      request: counts.byKind.request,
      dirty: controller.state.read().dirty,
      lifetime: currentOperationLifetime(),
    });
    if (phase === options.hold) await held;
    if (phase === options.fail) throw new Error('synthetic boundary failure');
  }
  const client = {
    async query(query: { sql: string } | string) {
      const sql = typeof query === 'string' ? query : query.sql;
      let phase: string;
      let rows: unknown = [];
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') phase = sql;
      else if (sql.startsWith('select')) {
        if (sql.includes('from `planned_tasks`')) {
          phase = sql.includes('for update') ? 'plan-lock' : 'plan-read';
          rows =
            phase === 'plan-lock'
              ? [['active']]
              : [
                  [
                    7,
                    'pln_synthetic',
                    'synthetic plan',
                    'synthetic work',
                    options.multiple ? 'multiple' : 'single',
                    'once',
                    null,
                    null,
                    'active',
                    42,
                    'active',
                  ],
                ];
        } else if (sql.includes('from `planned_task_items`')) {
          phase = 'items-read';
          rows = [[8, 0, 'synthetic research']];
          if (options.multiple)
            rows = [
              [8, 0, 'synthetic research'],
              [10, 1, 'synthetic analysis'],
            ];
        } else if (sql.includes('from `planned_task_occurrence_overrides`')) {
          phase = 'override-read';
          rows = [];
        } else if (sql.includes('from `planned_task_runs`')) {
          phase = sql.includes('inner join') ? 'dispatch-read' : 'existing-read';
          rows =
            phase === 'existing-read'
              ? options.existing
                ? [['ptr_synthetic', 'pending']]
                : []
              : [
                  [
                    9,
                    'pending',
                    '2026-09-10 01:00:00',
                    '2026-09-10 01:00:00',
                    'manual',
                    7,
                    'pln_synthetic',
                    'synthetic plan',
                    'once',
                    null,
                    null,
                    42,
                  ],
                ];
        } else if (sql.includes('from `planned_task_run_items`')) {
          phase = 'run-items-read';
          rows = [[8, 0, 'synthetic research']];
          if (options.multiple)
            rows = [
              [8, 0, 'synthetic research'],
              [10, 1, 'synthetic analysis'],
            ];
        } else if (sql.includes('from `users`')) {
          phase = sql.includes('for update')
            ? 'owner-lock'
            : sql.startsWith('select `status`')
              ? 'owner-read'
              : 'caller-user-read';
          rows =
            phase === 'caller-user-read'
              ? []
              : [[phase === 'owner-read' && options.ownerInactive ? 'closing' : 'active']];
        } else throw new Error('unexpected synthetic select');
      } else if (sql.startsWith('insert into `planned_task_runs`')) {
        phase = 'insert-run';
        rows = { insertId: 9, affectedRows: 1 };
      } else if (sql.startsWith('insert into `planned_task_run_items`')) {
        phase = 'insert-items';
        rows = { affectedRows: options.multiple ? 2 : 1 };
      } else if (sql.startsWith('update `planned_task_runs`')) {
        phase = trace.some((row) => row.phase === 'claim') ? 'run-transition' : 'claim';
        rows = { affectedRows: 1 };
      } else if (sql.startsWith('update `planned_task_run_items`')) {
        phase = 'items-transition';
        rows = { affectedRows: options.multiple ? 2 : 1 };
      } else if (sql.startsWith('update `planned_tasks`')) {
        phase = 'plan-transition';
        rows = { affectedRows: 1 };
      } else throw new Error('unexpected synthetic query');
      await boundary(phase);
      return [phase === options.ackAt ? options.ack : rows, []];
    },
  };
  configurePlannedRunSpecialDispatcher(async ({ ctx }) => {
    hookContexts.push(ctx);
    await boundary('special');
    if ('specialResult' in options) return options.specialResult as PlannedRunSpecialDispatchResult;
    return options.generic ? { handled: false } : { handled: true, ok: true, persisted: true };
  });
  const ctx = {
    db: drizzle(client as unknown as Connection) as unknown as DB,
    executionDrain: controller,
    userId: 'synthetic-user',
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  } as unknown as Context & { userId: string };
  return { ctx, trace, release, hookContexts };
}
function queue(ctx: Context & { userId: string }, scheduled = false) {
  const result = queuePlannedRun(ctx, { ...input, trigger: scheduled ? 'scheduled' : 'manual' });
  pending.push(result);
  void result.catch(() => {});
  return result;
}

it('refuses closed queue admission before the first database call', async () => {
  const { controller } = await control(false);
  const f = fixture(controller);
  await expect(queue(f.ctx)).rejects.toThrow();
  expect(f.trace).toHaveLength(0);
  expect(controller.state.read().dirty).toBe(false);
});
it.each(['plan-read', 'insert-run', 'commit'])(
  'owns the original %s through physical settlement',
  async (hold) => {
    const { controller, close } = await control();
    const f = fixture(controller, { hold });
    const result = queue(f.ctx);
    await flush();
    expect(f.trace.some((row) => row.phase === hold)).toBe(true);
    close();
    expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
    expect(controller.state.read().dirty).toBe(true);
    f.release();
    await result;
    await flush();
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each([false, true])('reserves dispatch before the queue ACK (existing=%s)', async (existing) => {
  const { controller, close } = await control();
  const f = fixture(controller, { hold: 'special', existing });
  await expect(queue(f.ctx, existing)).resolves.toMatchObject({ status: 'starting' });
  await flush();
  close();
  expect(f.hookContexts).toHaveLength(1);
  expect(controller.drain.snapshot().byKind.execution).toBeGreaterThan(0);
  expect(f.hookContexts[0]?.executionLifetime?.drain).toBe(controller.drain);
  expect(f.trace.every((row) => row.dirty)).toBe(true);
  f.release();
  await flush();
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('retains a late commit failure and never starts detached dispatch', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { hold: 'commit', fail: 'commit' });
  const result = queue(f.ctx);
  await flush();
  close();
  f.release();
  await expect(result).rejects.toThrow();
  await flush();
  expect(f.trace.some((row) => row.phase === 'rollback')).toBe(true);
  expect(f.hookContexts).toHaveLength(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each(['dispatch-read', 'special'])(
  'retains late %s failure after queue already returned',
  async (fail) => {
    const { controller } = await control();
    const f = fixture(controller, { hold: fail, fail });
    await queue(f.ctx);
    await flush();
    f.release();
    await flush();
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(controller.drain.snapshot().idle).toBe(false);
  },
);
it.each([{}, { affectedRows: -1 }, { affectedRows: 2 }, { affectedRows: Number.NaN }])(
  'rejects unproven claim ACK before special dispatch: %j',
  async (ack) => {
    const { controller } = await control();
    const f = fixture(controller, { ackAt: 'claim', ack });
    await queue(f.ctx);
    await flush();
    expect(f.hookContexts).toHaveLength(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it('keeps a definite zero claim as a known no-op', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { ackAt: 'claim', ack: { affectedRows: 0 } });
  await queue(f.ctx);
  await flush();
  close();
  expect(f.hookContexts).toHaveLength(0);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it.each([
  { insertId: 0, affectedRows: 1 },
  { insertId: 9, affectedRows: 0 },
  { insertId: 9, affectedRows: 2 },
])('rejects invalid run insertion ACK: %j', async (ack) => {
  const { controller } = await control();
  const f = fixture(controller, { ackAt: 'insert-run', ack });
  await expect(queue(f.ctx)).rejects.toThrow();
  expect(f.hookContexts).toHaveLength(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it.each([
  'missing-controller',
  'expired',
  'copied',
  'foreign',
  'ambient-mismatch',
  'missing-lifetime',
] as const)('rejects %s capability before IO', async (mode) => {
  const { controller } = await control();
  const f = fixture(controller);
  let saved!: OperationLifetime;
  if (mode === 'expired') {
    await controller.runRoot(async (lifetime) => {
      saved = lifetime;
    }).result;
    await expect(queue({ ...f.ctx, executionLifetime: saved })).rejects.toThrow();
  } else {
    await controller.runRoot(async (lifetime) => {
      const inherited =
        mode === 'copied' ? { ...lifetime, owner: { ...lifetime.owner } } : lifetime;
      if (mode === 'ambient-mismatch') {
        await startOwnedOperation(
          controller.drain,
          'execution',
          async () => {
            await expect(queue({ ...f.ctx, executionLifetime: lifetime })).rejects.toThrow();
          },
          { parent: lifetime.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
        ).result;
      } else {
        const other = mode === 'foreign' ? (await control()).controller : controller;
        await expect(
          queue({
            ...f.ctx,
            executionDrain: mode === 'missing-controller' ? undefined : other,
            executionLifetime: mode === 'missing-lifetime' ? undefined : inherited,
          }),
        ).rejects.toThrow();
      }
    }).result;
  }
  expect(f.trace).toHaveLength(0);
});
it('does not admit a new queue while an earlier outcome is unknown', async () => {
  const { controller } = await control();
  await controller.runRoot(async (lifetime) => {
    lifetime.drain.markUnknown(lifetime.owner);
  }).result;
  const f = fixture(controller);
  await expect(queue(f.ctx)).rejects.toThrow();
  expect(f.trace).toHaveLength(0);
});

it.each([false, true])(
  'propagates a live child into the actual internal caller after close (batch=%s)',
  async (multiple) => {
    const { controller, close } = await control();
    const f = fixture(controller, { hold: 'special', generic: true, multiple });
    await queue(f.ctx);
    await flush();
    close();
    f.release();
    await flush();
    const caller = f.trace.find((row) => row.phase === 'caller-user-read');
    expect(caller).toBeDefined();
    expect(caller?.lifetime?.drain).toBe(controller.drain);
    expect(caller?.execution).toBeGreaterThanOrEqual(2);
    if (!multiple) expect(caller?.request).toBeGreaterThan(0);
    expect(controller.drain.snapshot().active).toBe(0);
    // Synthetic user lookup intentionally stops here; no model or batch execution is tested.
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it('retains the rollback boundary after failed insertion', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { fail: 'insert-run', hold: 'rollback' });
  const result = queue(f.ctx);
  await flush();
  close();
  expect(f.trace.some((row) => row.phase === 'rollback')).toBe(true);
  expect(controller.drain.snapshot().byKind.database).toBeGreaterThan(0);
  f.release();
  await expect(result).rejects.toThrow();
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it('does not acknowledge the queue if child reservation fails after commit', async () => {
  const { controller } = await control();
  const f = fixture(controller, { hold: 'commit' });
  const result = queue(f.ctx);
  await flush();
  controller.drain.block();
  f.release();
  await expect(result).rejects.toThrow();
  await flush();
  expect(f.trace.some((row) => row.phase === 'dispatch-read')).toBe(false);
  expect(controller.drain.snapshot().idle).toBe(false);
});
it('leaves original unscoped queue behavior compatible', async () => {
  const { controller, close } = await control();
  const f = fixture(controller);
  await queue({ ...f.ctx, executionDrain: undefined });
  await flush();
  close();
  expect(f.hookContexts).toHaveLength(1);
  expect(f.hookContexts[0]?.executionLifetime).toBeUndefined();
  expect(f.trace.every((row) => !row.dirty && row.database === 0)).toBe(true);
});
it.each([null, {}, { handled: true, ok: false, persisted: false }, { handled: true, ok: true }])(
  'cannot treat ambiguous special ACK as settled: %j',
  async (specialResult) => {
    const { controller, close } = await control();
    const f = fixture(controller, { specialResult });
    await queue(f.ctx);
    await flush();
    close();
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(f.trace.some((row) => row.phase === 'caller-user-read')).toBe(false);
  },
);
it.each([0, 2, -1])('rejects wrong item insert count %s before dispatch', async (affectedRows) => {
  const { controller } = await control();
  const f = fixture(controller, { ackAt: 'insert-items', ack: { affectedRows } });
  await expect(queue(f.ctx)).rejects.toThrow();
  expect(f.hookContexts).toHaveLength(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('owns each raw database boundary in the successful queue and dispatch', async () => {
  const { controller, close } = await control();
  const f = fixture(controller);
  await queue(f.ctx);
  await flush();
  close();
  expect(f.trace.filter((row) => row.phase !== 'special').every((row) => row.database > 0)).toBe(
    true,
  );
  expect(f.trace.some((row) => row.phase === 'plan-transition')).toBe(true);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('holds the return-style cancellation transaction through commit without changing its owner gate', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, { ownerInactive: true });
  await queue(f.ctx);
  await flush();
  close();
  expect(f.hookContexts).toHaveLength(0);
  expect(f.trace.filter((row) => row.phase === 'commit')).toHaveLength(2);
  expect(f.trace.filter((row) => row.phase === 'commit').every((row) => row.database > 0)).toBe(
    true,
  );
  expect(controller.drain.snapshot().idle).toBe(true);
});
it.each([false, true])(
  'retains a special service child beyond both parent ACKs (late failure=%s)',
  async (fail) => {
    const { controller, close } = await control();
    const f = fixture(controller);
    let child: Promise<unknown> | undefined;
    let captured: (Context & { userId: string }) | undefined;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.push(release);
    configurePlannedRunSpecialDispatcher(async ({ ctx }) => {
      captured = ctx;
      const life = ctx.executionLifetime;
      if (!life) throw new Error('missing synthetic hook capability');
      child = startOwnedOperation(
        life.drain,
        'execution',
        async () => {
          await held;
          if (fail) throw new Error('synthetic detached failure');
        },
        { parent: life.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
      ).result;
      pending.push(child);
      void child.catch(() => {});
      return { handled: true, ok: true, persisted: true };
    });
    await queue(f.ctx);
    await flush();
    close();
    expect(controller.drain.snapshot().active).toBe(1);
    expect(controller.drain.snapshot().byKind.execution).toBe(1);
    expect(captured).toBeDefined();
    const before = f.trace.length;
    if (!captured) throw new Error('missing synthetic captured context');
    await expect(queue(captured)).rejects.toThrow();
    expect(f.trace).toHaveLength(before);
    release();
    await Promise.allSettled([child]);
    await flush();
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().idle).toBe(!fail);
    expect(controller.drain.snapshot().unknown > 0).toBe(fail);
  },
);
