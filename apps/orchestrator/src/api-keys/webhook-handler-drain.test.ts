import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoopLogger } from 'drizzle-orm/logger';
import { drizzle } from 'drizzle-orm/mysql2';
import { MySql2Session } from 'drizzle-orm/mysql2/session';
import type { Request, Response } from 'express';
import type { Connection } from 'mysql2/promise';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import type { DB } from '../db/client.js';
import { DrainController } from '../execution/drain-controller.js';
import { currentOperationLifetime } from '../execution/owned-operation.js';
import type { Context } from '../trpc/context.js';
import { createWebhookTasksHandler } from './webhook-handler.js';
import { hashBody } from './webhook-idempotency-service.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
const logger = pino({ level: 'silent' });
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-webhook-drain-')));
  roots.push(directory);
  const identity = { epoch: 'a'.repeat(32), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
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
  // Explicit synthetic maintenance authority, never production bootstrap proof.
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
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
              expiresAt: 110000,
            })}\n`,
          ),
        )
      ).ok,
    ).toBe(true);
  return { controller, close: () => controller.disconnect(session) };
}
function fixture(
  controller: DrainController,
  holdAt = '',
  fail = false,
  options: {
    idempotency?: boolean;
    duplicate?: boolean;
    expired?: boolean;
    malformedAt?: string;
    contextFails?: boolean;
    dispatchFails?: boolean;
    inspectContext?: (ctx: Context) => void;
    holdOccurrence?: number;
    queryLogger?: { logQuery: () => void };
  } = {},
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const calls: string[] = [];
  const client = {
    async query(query: { sql: string }) {
      if (this !== client) throw new Error('synthetic driver receiver changed');
      const sql = query.sql;
      const idempotency = sql.includes('`webhook_idempotency`');
      const phase = idempotency
        ? sql.startsWith('insert')
          ? 'claim'
          : sql.startsWith('update')
            ? 'finalize'
            : sql.startsWith('delete')
              ? 'release'
              : 'replay'
        : sql.startsWith('update')
          ? 'stamp'
          : sql.includes('from `api_keys`')
            ? 'key'
            : 'user';
      calls.push(phase);
      if (
        phase === holdAt &&
        calls.filter((v) => v === phase).length === (options.holdOccurrence ?? 1)
      ) {
        await held;
        if (fail) throw new Error('synthetic database failure');
      }
      if (phase === options.malformedAt) return [{}, []];
      if (phase === 'claim' && options.duplicate && calls.filter((v) => v === 'claim').length === 1)
        throw Object.assign(new Error('synthetic collision'), { code: 'ER_DUP_ENTRY' });
      if (phase === 'replay')
        return [
          [
            [
              hashBody({ prompt: 'synthetic test' }),
              options.expired ? '' : 'synthetic-previous',
              JSON.stringify({ taskId: 'synthetic-previous' }),
              options.expired ? '2020-01-01 00:00:00' : '2099-01-01 00:00:00',
              '2020-01-01 00:00:00',
            ],
          ],
          [],
        ];
      return ['stamp', 'claim', 'finalize', 'release'].includes(phase)
        ? [{ affectedRows: 1 }, []]
        : phase === 'key'
          ? [[[1, 2, null, null]], []]
          : [[[2, 'synthetic-webhook', 'active']], []];
    },
  };
  const db = drizzle(client as unknown as Connection, {
    logger: options.queryLogger,
  }) as unknown as DB;
  let code = 0;
  let dispatches = 0;
  const request = {
    header: (name: string) =>
      name === 'authorization'
        ? `Bearer hd_live_${'a'.repeat(24)}`
        : name === 'idempotency-key' && options.idempotency
          ? 'synthetic-key'
          : undefined,
    body: { prompt: 'synthetic test' },
    path: '/webhooks/tasks',
  } as unknown as Request;
  const response = {
    status(value: number) {
      code = value;
      return this;
    },
    setHeader() {
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  const deps = {
    db,
    logger,
    executionDrain: controller,
    buildContextForUser: () => {
      if (options.contextFails) throw new Error('synthetic context failure');
      return { executionDrain: controller } as Context;
    },
    dispatch: async (ctx: Context) => {
      dispatches++;
      options.inspectContext?.(ctx);
      if (options.dispatchFails) throw new Error('synthetic dispatch failure');
      return { taskId: 'synthetic-task', status: 'pending' };
    },
  };
  const handler = createWebhookTasksHandler(deps);
  return {
    calls,
    release,
    deps,
    request,
    code: () => code,
    dispatches: () => dispatches,
    run() {
      const result = handler(request, response);
      pending.push(result);
      return result;
    },
  };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  vi.restoreAllMocks();
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});

it.each(['claim', 'finalize', 'release'])(
  'holds the original %s query through maintenance closure',
  async (phase) => {
    const { controller, close } = await control();
    const f = fixture(controller, phase, false, {
      idempotency: true,
      contextFails: phase === 'release',
    });
    const request = f.run();
    await vi.waitFor(() => expect(f.calls).toContain(phase));
    close();
    expect(controller.drain.snapshot().byKind.database).toBe(1);
    f.release();
    await request;
    await vi.waitFor(() =>
      expect(controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true }),
    );
  },
);
it('stops after an uncertain finalize without retrying or releasing its claim', async () => {
  const { controller } = await control();
  const f = fixture(controller, 'finalize', true, { idempotency: true });
  f.release();
  await f.run();
  expect(f.calls.filter((v) => v === 'finalize')).toHaveLength(1);
  expect(f.calls).not.toContain('release');
  expect(f.code()).toBe(503);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each(['claim', 'finalize', 'release', 'stamp'])(
  'does not treat a missing %s write receipt as completion',
  async (phase) => {
    const { controller } = await control();
    const f = fixture(controller, '', false, {
      idempotency: true,
      malformedAt: phase,
      contextFails: phase === 'release',
    });
    await f.run();
    await vi.waitFor(() => expect(controller.drain.snapshot().unknown).toBeGreaterThan(0));
    if (phase === 'claim') expect(f.dispatches()).toBe(0);
    if (phase === 'finalize') {
      expect(f.code()).toBe(503);
      expect(f.calls.filter((v) => v === 'finalize')).toHaveLength(1);
    }
  },
);
it('retains the claim when dispatch may have produced partial effects', async () => {
  const { controller } = await control();
  const f = fixture(controller, '', false, { idempotency: true, dispatchFails: true });
  await f.run();
  expect(f.calls).not.toContain('release');
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it.each([false, true])(
  'treats a confirmed duplicate claim as known (expired=%s)',
  async (expired) => {
    const { controller, close } = await control();
    const f = fixture(controller, '', false, { idempotency: true, duplicate: true, expired });
    await f.run();
    close();
    expect(f.calls).toContain('replay');
    expect(f.dispatches()).toBe(expired ? 1 : 0);
    expect(f.code()).toBe(200);
    await vi.waitFor(() =>
      expect(controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }),
    );
  },
);

it.each(['user', 'replay', 'release', 'claim'])(
  'tracks late %s failure on the expired-claim path',
  async (phase) => {
    const { controller, close } = await control();
    const f = fixture(controller, phase, true, {
      idempotency: true,
      duplicate: true,
      expired: true,
      holdOccurrence: phase === 'claim' ? 2 : 1,
    });
    const request = f.run();
    await vi.waitFor(() =>
      expect(f.calls.filter((v) => v === phase)).toHaveLength(phase === 'claim' ? 2 : 1),
    );
    close();
    expect(controller.drain.snapshot().byKind.database).toBe(1);
    f.release();
    await request;
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(f.dispatches()).toBe(0);
    expect(f.code()).toBe(phase === 'user' ? 500 : 503);
  },
);
it('retains a late timestamp failure even after a successful task ACK', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, 'stamp', true);
  await f.run();
  close();
  expect(f.code()).toBe(200);
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  f.release();
  await vi.waitFor(() =>
    expect(controller.drain.snapshot()).toMatchObject({ active: 0, idle: false, unknown: 1 }),
  );
});
it('inherits the original HTTP parent after closure and dispatches with that live child context', async () => {
  const { controller, close } = await control();
  let inspected = false;
  const f = fixture(controller, '', false, {
    inspectContext: (ctx) => {
      inspected = true;
      expect(ctx.executionDrain === controller).toBe(true);
      expect(ctx.executionLifetime === currentOperationLifetime()).toBe(true);
      expect(controller.drain.snapshot().roots).toBe(1);
      expect(controller.drain.snapshot().byKind.request).toBe(2);
    },
  });
  await controller.runRoot(async () => {
    close();
    await f.run();
  }).result;
  expect(inspected).toBe(true);
  expect(f.code()).toBe(200);
  await vi.waitFor(() => expect(controller.drain.snapshot().idle).toBe(true));
});
it('rejects a parent from another controller before any database work', async () => {
  const { controller } = await control();
  const { controller: other } = await control();
  const f = fixture(other);
  await controller.runRoot(async () => f.run()).result;
  expect(f.calls).toEqual([]);
  expect(f.code()).toBe(503);
});
it('captures the original factory controller rather than a later deps replacement', async () => {
  const { controller } = await control();
  const { controller: other } = await control(false);
  const f = fixture(controller);
  f.deps.executionDrain = other;
  await f.run();
  expect(f.code()).toBe(200);
  expect(other.state.read().dirty).toBe(false);
  expect(controller.state.read().dirty).toBe(true);
});
it('does not admit a closed handler using a controller in request fields', async () => {
  const { controller } = await control(false);
  const { controller: other } = await control();
  const f = fixture(controller);
  Object.assign(f.request, { executionDrain: other, executionLifetime: {} });
  await f.run();
  expect(f.calls).toEqual([]);
  expect(f.code()).toBe(503);
});

it('does not dispatch a deferred QueryPromise after blocking the original handler', async () => {
  const { controller } = await control();
  const f = fixture(controller);
  const request = f.run();
  const alreadyDispatched = f.calls.length;
  controller.drain.block();
  await request;
  expect(f.calls).toHaveLength(alreadyDispatched);
});

it.each(['key', 'stamp', 'claim', 'finalize', 'release'])(
  'vetoes %s after the actual builder prepare callback',
  async (phase) => {
    const { controller } = await control();
    const original = MySql2Session.prototype.prepareQuery;
    vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
      this: typeof MySql2Session.prototype,
      ...args
    ) {
      const prepared = Reflect.apply(original, this, args);
      const sql = args[0].sql;
      const matches =
        phase === 'key'
          ? sql.includes('from `api_keys`')
          : phase === 'stamp'
            ? sql.startsWith('update `api_keys`')
            : phase === 'claim'
              ? sql.startsWith('insert')
              : phase === 'finalize'
                ? sql.startsWith('update `webhook_idempotency`')
                : sql.startsWith('delete');
      if (matches) controller.drain.block();
      return prepared;
    });
    const f = fixture(controller, '', false, {
      idempotency: true,
      contextFails: phase === 'release',
    });
    await f.run();
    expect(f.calls).not.toContain(phase);
  },
);

it('rejects a mutable query logger before it can open a last-moment driver callback gap', async () => {
  const { controller } = await control();
  let callbacks = 0;
  const f = fixture(controller, '', false, {
    queryLogger: {
      logQuery() {
        callbacks++;
        controller.drain.block();
      },
    },
  });
  await f.run();
  expect(f.calls).toEqual([]);
  expect(callbacks).toBe(0);
});

it('does not delete a competing fresh claim after both handlers observe the same expired row', async () => {
  const { controller, close } = await control();
  const first = fixture(controller, '', false, { idempotency: true });
  const second = fixture(controller, '', false, { idempotency: true });
  const oldExpiry = '2020-01-01 00:00:00.000';
  let row: { expires: string; taskId: string } | null = { expires: oldExpiry, taskId: '' };
  let reads = 0;
  let deletes = 0;
  const affected: number[] = [];
  let bothRead!: () => void;
  let fresh!: () => void;
  let deletedSecond!: () => void;
  const readGate = new Promise<void>((resolve) => {
    bothRead = resolve;
  });
  const freshGate = new Promise<void>((resolve) => {
    fresh = resolve;
  });
  const deleteGate = new Promise<void>((resolve) => {
    deletedSecond = resolve;
  });
  releases.push(bothRead, fresh, deletedSecond);
  // Interpret this bounded single-row SQL at the mysql2 boundary. In particular,
  // evaluate DELETE against the row at execution, not the earlier SELECT snapshot.
  const client = {
    async query(query: { sql: string }, params: unknown[]) {
      const sql = query.sql;
      if (!sql.includes('`webhook_idempotency`')) {
        return sql.startsWith('update')
          ? [{ affectedRows: 1 }, []]
          : sql.includes('from `api_keys`')
            ? [[[1, 2, null, null]], []]
            : [[[2, 'synthetic-webhook', 'active']], []];
      }
      if (sql.startsWith('select')) {
        const snapshot = row ? { ...row } : null;
        reads++;
        if (reads === 2) bothRead();
        await readGate;
        return [
          snapshot
            ? [
                [
                  hashBody({ prompt: 'synthetic test' }),
                  snapshot.taskId,
                  '{}',
                  snapshot.expires,
                  oldExpiry,
                ],
              ]
            : [],
          [],
        ];
      }
      if (sql.startsWith('insert')) {
        if (row) throw Object.assign(new Error('synthetic duplicate'), { code: 'ER_DUP_ENTRY' });
        row = { taskId: '', expires: String(params[5]) };
        fresh();
        return [{ affectedRows: 1, insertId: 2 }, []];
      }
      if (sql.startsWith('delete')) {
        deletes++;
        if (deletes === 2) await freshGate;
        let matches = row?.taskId === '';
        for (const match of sql.matchAll(/`expires_at` (=|<) \?/g)) {
          const index = (sql.slice(0, match.index).match(/\?/g) ?? []).length;
          const expected = String(params[index]);
          matches =
            matches &&
            !!row &&
            (match[1] === '=' ? row.expires === expected : row.expires < expected);
        }
        const count = matches ? 1 : 0;
        if (matches) row = null;
        affected.push(count);
        if (deletes === 2) deletedSecond();
        return [{ affectedRows: count }, []];
      }
      if (sql.startsWith('update')) {
        const count = row?.taskId === '' ? 1 : 0;
        if (row && count) row.taskId = String(params[0]);
        return [{ affectedRows: count }, []];
      }
      throw new Error('unexpected synthetic query');
    },
  };
  const database = drizzle(client as unknown as Connection) as unknown as DB;
  for (const f of [first, second]) {
    f.deps.db = database;
    const dispatch = f.deps.dispatch;
    f.deps.dispatch = async (ctx) => {
      const result = await dispatch(ctx);
      await deleteGate;
      return result;
    };
  }
  await Promise.all([first.run(), second.run()]);
  close();
  expect(reads).toBe(2);
  expect(first.dispatches() + second.dispatches()).toBe(1);
  expect(affected).toEqual([1, 0]);
  expect([first.code(), second.code()].sort()).toEqual([200, 425]);
  expect(controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 });
});

it('does not mistake a prepare exception for a confirmed driver duplicate', async () => {
  const { controller } = await control();
  const original = MySql2Session.prototype.prepareQuery;
  vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
    this: typeof MySql2Session.prototype,
    ...args
  ) {
    if (args[0].sql.startsWith('insert'))
      throw Object.assign(new Error('synthetic prepare failure'), { code: 'ER_DUP_ENTRY' });
    return Reflect.apply(original, this, args);
  });
  const f = fixture(controller, '', false, { idempotency: true });
  await f.run();
  expect(f.calls).not.toContain('replay');
  expect(f.dispatches()).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it.each(['logger getter', 'array species'])(
  'rejects a hidden %s callback before actual driver dispatch',
  async (kind) => {
    const { controller } = await control();
    const original = MySql2Session.prototype.prepareQuery;
    let callbacks = 0;
    vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
      this: typeof MySql2Session.prototype,
      ...args
    ) {
      const prepared = Reflect.apply(original, this, args);
      const fields = Object.getOwnPropertyDescriptors(prepared);
      if (kind === 'logger getter') {
        Object.defineProperty(fields.logger?.value, 'logQuery', {
          get() {
            callbacks++;
            if (callbacks > 1) controller.drain.block();
            return NoopLogger.prototype.logQuery;
          },
        });
      } else {
        Object.defineProperty(fields.params?.value, 'constructor', {
          value: {
            get [Symbol.species]() {
              callbacks++;
              controller.drain.block();
              return Array;
            },
          },
        });
      }
      return prepared;
    });
    const f = fixture(controller);
    await f.run();
    expect(f.calls).toEqual([]);
    expect(callbacks).toBe(0);
  },
);

it.each(['prepared client', 'driver query', 'SQL'])(
  'rejects a %s getter between the final veto and query entry',
  async (kind) => {
    const { controller } = await control();
    const original = MySql2Session.prototype.prepareQuery;
    let callbacks = 0;
    vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
      this: typeof MySql2Session.prototype,
      ...args
    ) {
      const prepared = Reflect.apply(original, this, args);
      const fields = Object.getOwnPropertyDescriptors(prepared);
      const target =
        kind === 'prepared client'
          ? prepared
          : kind === 'driver query'
            ? fields.client?.value
            : fields.rawQuery?.value;
      const key = kind === 'prepared client' ? 'client' : kind === 'driver query' ? 'query' : 'sql';
      const value = Reflect.get(target, key);
      Object.defineProperty(target, key, {
        get() {
          callbacks++;
          controller.drain.block();
          return value;
        },
      });
      return prepared;
    });
    const f = fixture(controller);
    await f.run();
    expect(f.calls).toEqual([]);
    expect(callbacks).toBe(0);
  },
);

it('does not classify a synchronous driver throw as a duplicate Promise receipt', async () => {
  const { controller } = await control();
  const original = MySql2Session.prototype.prepareQuery;
  vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
    this: typeof MySql2Session.prototype,
    ...args
  ) {
    const prepared = Reflect.apply(original, this, args);
    if (args[0].sql.startsWith('insert')) {
      Object.defineProperty(prepared, 'client', {
        value: {
          query() {
            throw Object.assign(new Error('synthetic synchronous driver failure'), {
              code: 'ER_DUP_ENTRY',
            });
          },
        },
      });
    }
    return prepared;
  });
  const f = fixture(controller, '', false, { idempotency: true });
  await f.run();
  expect(f.calls).not.toContain('replay');
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('checks the original owner again at the actual per-prepared driver delegate', async () => {
  const { controller } = await control();
  const prepare = MySql2Session.prototype.prepareQuery;
  const guard = controller.drain.assertDispatch.bind(controller.drain);
  let prepared = false;
  let checks = 0;
  vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
    this: typeof MySql2Session.prototype,
    ...args
  ) {
    const value = Reflect.apply(prepare, this, args);
    prepared = true;
    return value;
  });
  vi.spyOn(controller.drain, 'assertDispatch').mockImplementation((owner) => {
    if (prepared && ++checks === 2) controller.drain.block();
    guard(owner);
  });
  const f = fixture(controller);
  await f.run();
  expect(checks).toBe(2);
  expect(f.calls).toEqual([]);
});

it('never redispatches the captured per-prepared delegate while its first raw receipt is pending', async () => {
  const { controller } = await control();
  const prepare = MySql2Session.prototype.prepareQuery;
  let first: object | undefined;
  vi.spyOn(MySql2Session.prototype, 'prepareQuery').mockImplementation(function (
    this: typeof MySql2Session.prototype,
    ...args
  ) {
    const value = Reflect.apply(prepare, this, args);
    first ??= value;
    return value;
  });
  const f = fixture(controller, 'key');
  const request = f.run();
  await vi.waitFor(() => expect(f.calls).toEqual(['key']));
  if (!first) throw new Error('missing original prepared query');
  const client = Object.getOwnPropertyDescriptor(first, 'client')?.value;
  expect(Object.isFrozen(client)).toBe(true);
  expect(() => client.query({}, [])).toThrow('WEBHOOK_DATABASE_REDISPATCH');
  expect(f.calls).toEqual(['key']);
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  f.release();
  await request;
  expect(f.code()).toBe(200);
});

it('refuses a closed webhook before the first API-key database call', async () => {
  const { controller } = await control(false);
  const f = fixture(controller);
  await f.run();
  expect(f.calls).toEqual([]);
  expect(f.code()).toBe(503);
  expect(controller.state.read().dirty).toBe(false);
});
it('holds the original lookup after maintenance closes and retains late failure', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, 'key', true);
  const request = f.run();
  await vi.waitFor(() => expect(f.calls).toEqual(['key']));
  close();
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  f.release();
  await request;
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  expect(f.dispatches()).toBe(0);
});
it('keeps the detached timestamp write owned after the task ACK', async () => {
  const { controller, close } = await control();
  const f = fixture(controller, 'stamp');
  await f.run();
  expect(f.code()).toBe(200);
  expect(f.dispatches()).toBe(1);
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  expect(controller.state.read().dirty).toBe(true);
  close();
  f.release();
  await vi.waitFor(() => expect(controller.drain.snapshot().idle).toBe(true));
});
