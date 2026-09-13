import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import type { Connection } from 'mysql2/promise';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  startIdempotencyCleanup,
  stopIdempotencyCleanup,
} from '../api-keys/webhook-idempotency-service.js';
import type { DB } from '../db/client.js';
import {
  startEnergyAnalyticsCleanup,
  stopEnergyAnalyticsCleanup,
} from '../energy/analytics-cleanup.js';
import { createEnergyAnalyticsStore } from '../energy/analytics-store.js';
import { DrainController } from './drain-controller.js';
import { currentOperationLifetime, withOperationDispatchScope } from './owned-operation.js';

const cleanups: Array<() => void> = [];
const releases: Array<() => void> = [];
const logger = pino({ level: 'silent' });
async function fixture(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-cleanup-drain-')));
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
  // Synthetic maintenance authority; this is not a production open verifier.
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
    mono: () => 1000,
  });
  cleanups.push(() => {
    controller.state.abandon();
    rmSync(directory, { recursive: true });
  });
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
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
function start(kind: string, controller: DrainController, query: () => Promise<unknown>) {
  const db = drizzle({ query } as unknown as Connection) as unknown as DB;
  const deps = { db, logger, executionDrain: controller };
  if (kind === 'energy') {
    startEnergyAnalyticsCleanup({ ...deps, store: createEnergyAnalyticsStore(db) });
    return stopEnergyAnalyticsCleanup;
  }
  startIdempotencyCleanup(deps);
  return stopIdempotencyCleanup;
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  await Promise.allSettled([stopEnergyAnalyticsCleanup(), stopIdempotencyCleanup()]);
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

for (const kind of ['energy', 'idempotency']) {
  it(`${kind}: repeated ticks do not overlap an original cleanup`, async () => {
    const { controller } = await fixture();
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
      tick = callback as () => void;
      return { unref() {} } as never;
    });
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    const held = hold();
    let calls = 0;
    const stop = start(kind, controller, async () => {
      calls++;
      await held.promise;
      return [{ affectedRows: 0 }, []];
    });
    await flush();
    tick();
    tick();
    await flush();
    expect(calls).toBe(1);
    const pending = stop();
    expect(stop()).toBe(pending);
    held.release();
    await pending;
    const doneCalls = calls;
    tick();
    await flush();
    expect(calls).toBe(doneCalls);
  });
  it(`${kind}: stop reentry cannot deadlock its own raw driver`, async () => {
    const { controller } = await fixture();
    const stop = kind === 'energy' ? stopEnergyAnalyticsCleanup : stopIdempotencyCleanup;
    let reentries = 0;
    start(kind, controller, async () => {
      expect(() => stop()).toThrow('CLEANUP_STOP_REENTRY');
      reentries++;
      return [{ affectedRows: 0 }, []];
    });
    await flush();
    expect(reentries).toBe(kind === 'energy' ? 3 : 1);
    await stop();
  });
  it(`${kind}: closed admission never dispatches a cleanup query`, async () => {
    const { controller } = await fixture(false);
    let calls = 0;
    start(kind, controller, async () => {
      calls++;
      return [{ affectedRows: 0 }, []];
    });
    await flush();
    expect(calls).toBe(0);
    expect(controller.state.read().dirty).toBe(false);
  });
  it(`${kind}: stop waits the original driver, with ownership present before query`, async () => {
    const { controller, close } = await fixture();
    const held = hold();
    let owned = false;
    const stop = start(kind, controller, async () => {
      owned = !!currentOperationLifetime();
      await held.promise;
      return [{ affectedRows: 0 }, []];
    });
    await flush();
    let stopped = false;
    const pending = Promise.resolve(stop()).then(() => {
      stopped = true;
    });
    await flush();
    expect(owned).toBe(true);
    expect(stopped).toBe(false);
    expect(controller.drain.snapshot().active).toBeGreaterThan(0);
    held.release();
    await pending;
    close();
    expect(controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 });
  });
  it(`${kind}: non-fatal failure cannot erase an uncertain driver outcome`, async () => {
    const { controller, close } = await fixture();
    const stop = start(kind, controller, async () => {
      throw new Error('synthetic');
    });
    await flush();
    const outcome = await Promise.allSettled([stop()]);
    close();
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
    expect(outcome[0]?.status).toBe('rejected');
  });
  it(`${kind}: absent delete receipt is not treated as zero deleted`, async () => {
    const { controller } = await fixture();
    const stop = start(kind, controller, async () => [undefined, []]);
    await flush();
    expect((await Promise.allSettled([stop()]))[0]?.status).toBe('rejected');
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  });
}

it('cleanup SQL construction cannot dispatch after the original caller scope is sealed', async () => {
  const { controller } = await fixture();
  let calls = 0;
  const db = drizzle({
    async query() {
      calls++;
      return [{ affectedRows: 0 }, []];
    },
  } as unknown as Connection) as unknown as DB;
  await controller.runRoot(() =>
    withOperationDispatchScope(async (seal) => {
      await cleanup({
        db,
        logger,
        now: () => {
          seal();
          return new Date();
        },
      });
    }),
  ).result;
  expect(calls).toBe(0);
});

it('energy coalesces busy ticks into one delayed pass without overlapping queries', async () => {
  const { controller } = await fixture();
  let tick!: () => void;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
    tick = callback as () => void;
    return { unref() {} } as never;
  });
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
  const timeout = vi.spyOn(globalThis, 'setTimeout').mockReturnValue({ unref() {} } as never);
  const held = hold();
  let calls = 0;
  const stop = start('energy', controller, async () => {
    calls++;
    await held.promise;
    return [{ affectedRows: 0 }, []];
  });
  await flush();
  tick();
  tick();
  expect(calls).toBe(1);
  held.release();
  await flush();
  expect(calls).toBe(3);
  expect(timeout).toHaveBeenCalledTimes(1);
  expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1000);
  const callback = timeout.mock.calls[0]?.[0] as () => void;
  await stop();
  callback();
  await flush();
  expect(calls).toBe(3);
});
