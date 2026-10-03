import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from '../../execution/drain-controller.js';
import { currentOperationLifetime } from '../../execution/owned-operation.js';
import { startPrewarmScheduler } from './prewarm-scheduler.js';

const cleanup: Array<() => void> = [];
const stops: Array<() => unknown> = [];
const releases: Array<() => void> = [];
const logger = { info() {}, warn() {} };
async function fixture(open = true) {
  vi.useFakeTimers();
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-prewarm-drain-')));
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
  // Explicit synthetic maintenance authority, never used by production boot.
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
    mono: () => 1000,
  });
  cleanup.push(() => {
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
function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
function start(
  controller: DrainController,
  warm: () => Promise<void>,
  now = () => new Date('2026-09-13T00:25:00Z'),
) {
  const deps = { executionDrain: controller, warm, now, intervalMs: 10, logger };
  const stop = startPrewarmScheduler(deps);
  stops.push(stop);
  return stop;
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  for (const release of cleanup.splice(0)) release();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('does not dispatch a due prewarm while admission is closed', async () => {
  const f = await fixture(false);
  let dispatched = 0;
  start(f.controller, async () => {
    dispatched++;
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(dispatched).toBe(0);
  expect(f.controller.state.read().dirty).toBe(false);
});

it('stop waits the original warm promise after admission closes', async () => {
  const f = await fixture();
  const held = hold();
  let owned = false;
  const stop = start(f.controller, async () => {
    owned = currentOperationLifetime()?.drain === f.controller.drain;
    await held.promise;
  });
  await vi.advanceTimersByTimeAsync(10);
  f.close();
  let stopped = false;
  const pending = Promise.resolve(stop()).then(() => {
    stopped = true;
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(owned).toBe(true);
  expect(stopped).toBe(false);
  expect(f.controller.drain.snapshot().idle).toBe(false);
  held.release();
  await pending;
  expect(f.controller.drain.snapshot().idle).toBe(true);
});

it('a failed warm remains unknown rather than appearing drained', async () => {
  const f = await fixture();
  start(f.controller, async () => {
    throw new Error('synthetic upstream failure');
  });
  await vi.advanceTimersByTimeAsync(10);
  f.close();
  expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('does not overlap two due windows while an original warm is still running', async () => {
  const f = await fixture();
  const held = hold();
  let now = new Date('2026-09-13T00:25:00Z');
  let dispatched = 0;
  start(
    f.controller,
    async () => {
      dispatched++;
      await held.promise;
    },
    () => now,
  );
  await vi.advanceTimersByTimeAsync(10);
  now = new Date('2026-09-13T07:25:00Z');
  await vi.advanceTimersByTimeAsync(10);
  expect(dispatched).toBe(1);
});

it('a final dispatch guard that closes the producer cannot start its warm callback', async () => {
  const f = await fixture();
  let dispatched = 0;
  const stop = start(f.controller, async () => {
    dispatched++;
  });
  const original = f.controller.drain.assertDispatch.bind(f.controller.drain);
  vi.spyOn(f.controller.drain, 'assertDispatch').mockImplementation((owner) => {
    original(owner);
    if (currentOperationLifetime()?.owner === owner) stop();
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(dispatched).toBe(0);
});

it('repeated stops share the pending barrier and an internal stop cannot deadlock it', async () => {
  const f = await fixture();
  const held = hold();
  let internalError: unknown;
  const stop = start(f.controller, async () => {
    try {
      stop();
    } catch (error) {
      internalError = error;
    }
    await held.promise;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(internalError).toBeInstanceOf(Error);
  expect((internalError as Error).message).toBe('PREWARM_STOP_REENTRY');
  const first = stop();
  expect(stop()).toBe(first);
  held.release();
  await first;
});

it('captures its controller rather than following a later dependency replacement', async () => {
  const f = await fixture(false);
  let dispatched = 0;
  const deps = {
    executionDrain: f.controller as DrainController | undefined,
    warm: async () => {
      dispatched++;
    },
    now: () => new Date('2026-09-13T00:25:00Z'),
    intervalMs: 10,
    logger,
  };
  stops.push(startPrewarmScheduler(deps));
  deps.executionDrain = undefined;
  await vi.advanceTimersByTimeAsync(10);
  expect(dispatched).toBe(0);
});

it('does not admit a root after the original clock callback stopped the producer', async () => {
  const f = await fixture();
  let roots = 0;
  const original = f.controller.runRoot.bind(f.controller);
  vi.spyOn(f.controller, 'runRoot').mockImplementation((action) => {
    roots++;
    return original(action);
  });
  const stop = start(
    f.controller,
    async () => {},
    () => {
      void stop();
      return new Date('2026-09-13T00:25:00Z');
    },
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(roots).toBe(0);
  expect(f.controller.state.read().dirty).toBe(false);
});

it('stop during original synchronous admission waits for that original root release', async () => {
  const f = await fixture();
  let activeAtStop: number | undefined;
  const stop = start(f.controller, async () => {});
  const original = f.controller.drain.assertDispatch.bind(f.controller.drain);
  let fired = false;
  vi.spyOn(f.controller.drain, 'assertDispatch').mockImplementation((owner) => {
    original(owner);
    if (!fired) {
      fired = true;
      void stop().then(() => {
        activeAtStop = f.controller.drain.snapshot().active;
      });
    }
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(fired).toBe(true);
  expect(activeAtStop).toBe(0);
});

it('preserves the failure warning even without a controller', async () => {
  vi.useFakeTimers();
  const warnings: string[] = [];
  const stop = startPrewarmScheduler({
    warm: async () => {
      throw new Error('synthetic failure');
    },
    logger: {
      info() {},
      warn(_context, message) {
        warnings.push(message);
      },
    },
    now: () => new Date('2026-09-13T00:25:00Z'),
    intervalMs: 10,
  });
  stops.push(stop);
  await vi.advanceTimersByTimeAsync(10);
  expect(warnings).toHaveLength(1);
});

it('a throwing failure logger cannot erase uncertainty or strand stop', async () => {
  const f = await fixture();
  const stop = startPrewarmScheduler({
    executionDrain: f.controller,
    warm: async () => {
      throw new Error('synthetic failure');
    },
    logger: {
      info() {},
      warn() {
        throw new Error('synthetic logging failure');
      },
    },
    now: () => new Date('2026-09-13T00:25:00Z'),
    intervalMs: 10,
  });
  stops.push(stop);
  await vi.advanceTimersByTimeAsync(10);
  await expect(stop()).rejects.toThrow('PREWARM_OUTCOME_UNKNOWN');
  f.close();
  expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});
