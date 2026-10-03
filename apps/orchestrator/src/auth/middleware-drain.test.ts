import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Request, Response } from 'express';
import type { Connection } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import { type DB, db } from '../db/client.js';
import { DrainController } from '../execution/drain-controller.js';
import { withOperationDispatchScope } from '../execution/owned-operation.js';
import { signAccessToken } from './jwt.js';
import { bearerAuth, revalidateAuthenticatedSession } from './middleware.js';

const directories: string[] = [];
const controllers: DrainController[] = [];
const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
const session = { userId: 'synthetic-drain-session', authVersion: 2 };

async function control() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-auth-drain-')));
  directories.push(directory);
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
  // Synthetic maintenance authority only; never evidence of production bootstrap.
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
    mono: () => 1000,
  });
  controllers.push(controller);
  const connection = controller.connect();
  expect(
    (
      await controller.execute(
        connection,
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
  return { controller, close: () => controller.disconnect(connection) };
}

function fixture(
  options: {
    fail?: boolean;
    status?: string;
    version?: number;
    logger?: { logQuery(): void };
  } = {},
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  let calls = 0;
  const client = {
    async query(query: { sql: string }) {
      expect(this).toBe(client);
      expect(query.sql).toContain('from `users`');
      calls++;
      await held;
      if (options.fail) throw new Error('synthetic unavailable database');
      return [[[session.userId, options.status ?? 'active', options.version ?? 2]], []];
    },
  };
  const database = drizzle(client as unknown as Connection, {
    logger: options.logger,
  }) as unknown as DB;
  return { database, release, calls: () => calls };
}

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(pending.splice(0));
  vi.restoreAllMocks();
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

it('keeps the original authentication database call owned while admission closes', async () => {
  const { controller, close } = await control();
  const f = fixture();
  const result = controller.runRoot(() =>
    revalidateAuthenticatedSession(f.database, session),
  ).result;
  pending.push(result);
  await vi.waitFor(() => expect(f.calls()).toBe(1));
  close();
  expect(controller.drain.snapshot().byKind.database).toBe(1);
  expect(controller.drain.snapshot().idle).toBe(false);
  f.release();
  await expect(result).resolves.toBe(true);
  expect(controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true });
});

it('keeps a swallowed raw authentication failure unknown', async () => {
  const { controller } = await control();
  const f = fixture({ fail: true });
  f.release();
  await controller.runRoot(async () => {
    await revalidateAuthenticatedSession(f.database, session).catch(() => false);
  }).result;
  expect(f.calls()).toBe(1);
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('retains raw uncertainty through the real bearerAuth compatibility catch', async () => {
  const { controller } = await control();
  const f = fixture({ fail: true });
  vi.spyOn(db, 'select').mockImplementation(f.database.select.bind(f.database));
  const token = await signAccessToken({ sub: session.userId, plan: 'free', authVersion: 2 });
  const request = { header: () => `Bearer ${token}` } as unknown as Request;
  const next = vi.fn();
  f.release();
  await controller.runRoot(() => bearerAuth(request, {} as Response, next)).result;
  expect(f.calls()).toBe(1);
  expect(next).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveProperty('userId');
  expect(controller.drain.snapshot().active).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('does not query or create uncertainty for a request without bearer authentication', async () => {
  const { controller } = await control();
  const select = vi.spyOn(db, 'select');
  const next = vi.fn();
  await controller.runRoot(() =>
    bearerAuth({ header: () => undefined } as unknown as Request, {} as Response, next),
  ).result;
  expect(select).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
});

it.each([{ status: 'suspended' }, { version: 3 }])(
  'keeps an acknowledged session rejection known: %j',
  async (options) => {
    const { controller } = await control();
    const f = fixture(options);
    f.release();
    await expect(
      controller.runRoot(() => revalidateAuthenticatedSession(f.database, session)).result,
    ).resolves.toBe(false);
    expect(f.calls()).toBe(1);
    expect(controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  },
);

it('vetoes raw dispatch if query construction seals the original caller scope', async () => {
  const { controller } = await control();
  const f = fixture();
  const originalSelect = f.database.select.bind(f.database);
  f.release();
  await controller.runRoot(() =>
    withOperationDispatchScope(async (seal) => {
      vi.spyOn(f.database, 'select').mockImplementation((...args) => {
        const query = originalSelect(...args);
        seal();
        return query;
      });
      await expect(revalidateAuthenticatedSession(f.database, session)).rejects.toThrow();
    }),
  ).result;
  expect(f.calls()).toBe(0);
});

it('does not invoke a custom query logger beyond the fixed raw-driver boundary', async () => {
  const { controller } = await control();
  const logger = { logQuery: vi.fn() };
  const f = fixture({ logger });
  f.release();
  await controller.runRoot(async () => {
    await expect(revalidateAuthenticatedSession(f.database, session)).rejects.toThrow();
  }).result;
  expect(logger.logQuery).not.toHaveBeenCalled();
  expect(f.calls()).toBe(0);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
