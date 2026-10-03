import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runBrowserOperation } from '../agent/vision-loop/browser-operation.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import { BrowserPool } from './browser-pool.js';
import { BrowserEgressProxy } from './egress-proxy.js';
import type { PoolConfig } from './types.js';

// Pool ordering uses a synthetic Browser; native close receipts have their own SDK suite.
vi.mock('../agent/vision-loop/browser-close-receipt.js', () => ({
  bindBrowserCloseReceipt: (browser: { close(): Promise<void> }) => () => browser.close(),
}));

const transport = vi.hoisted(() => ({
  ready: async () => 'synthetic',
  connect: async (): Promise<unknown> => ({}),
}));
vi.mock('playwright', () => ({
  chromium: { connectOverCDP: () => transport.connect(), executablePath: () => '/synthetic' },
}));
vi.mock('./spawn.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./spawn.js')>();
  let pid = 910000;
  // Synthetic process receipts isolate existing background ordering; the dedicated
  // pool-process suites exercise native ChildProcess events and real owned receipts.
  const spawn = () => {
    const child = new EventEmitter();
    const currentPid = ++pid;
    let running = true;
    const stopped = Promise.resolve();
    return {
      pid: currentPid,
      child,
      kill: () => true,
      lifecycle: {
        pid: currentPid,
        child,
        ready: Promise.resolve(),
        isRunning: () => running,
        terminate: () => {
          running = false;
          return stopped;
        },
      },
    };
  };
  return {
    ...original,
    spawnNativeChromium: spawn,
    spawnBrave: spawn,
    spawnXvfb: spawn,
    spawnX11vnc: spawn,
    spawnWebsockify: spawn,
    waitForCdpReady: () => transport.ready(),
  };
});
vi.mock('../config/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
const roots: string[] = [];
const pools: BrowserPool[] = [];
const gates: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.push(release);
  return { wait, release };
}
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  const finished = promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error) => {
      state.done = true;
      state.error = error;
    },
  );
  pending.push(finished);
  return { state, finished };
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fixture(onReady?: PoolConfig['onInstanceReady']) {
  const directory = mkdtempSync(join(tmpdir(), 'hd-pool-background-'));
  roots.push(directory);
  const state = { closes: 0, evaluations: 0, showPages: false, proxyCloses: 0, onPages: () => {} };
  const hold = gate();
  const page = {
    evaluate: async () => {
      state.evaluations++;
      await hold.wait;
    },
    url: () => 'about:blank',
  };
  const context = {
    pages: () => {
      state.onPages();
      return state.showPages ? [page] : [];
    },
  };
  transport.connect = async () => ({
    contexts: () => [context],
    close: async () => {
      state.closes++;
    },
  });
  vi.spyOn(BrowserEgressProxy.prototype, 'start').mockResolvedValue('http://127.0.0.1:1');
  vi.spyOn(BrowserEgressProxy.prototype, 'close').mockImplementation(async () => {
    state.proxyCloses++;
  });
  const config: PoolConfig = {
    maxInstances: 2,
    idleTimeoutMs: 100000,
    baseDir: directory,
    cdpPortStart: 9300,
    vncPortStart: 5910,
    wsPortStart: 6090,
    displayStart: 100,
    screenSize: '1280x800x24',
    onInstanceReady: onReady,
  };
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const pool = new BrowserPool(config, logger);
  pools.push(pool);
  return { pool, state, hold, config };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('STEALTH_ENABLED', 'false');
  transport.ready = async () => 'synthetic';
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(async () => {
  for (const release of gates.splice(0)) release();
  await flush();
  const stops = pools.splice(0).map((pool) => observe(pool.shutdown()));
  await vi.dynamicImportSettled();
  await flush();
  await vi.advanceTimersByTimeAsync(15000);
  await Promise.all(stops.map((stop) => stop.finished));
  await Promise.allSettled(pending.splice(0));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function allocateOwned(pool: BrowserPool) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', () => pool.allocate('task', 'synthetic'), {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  drain.close();
  const instance = await root.result;
  return { drain, instance };
}

it('reserves background work before allocate returns, independently of the CDP resource', async () => {
  const f = fixture();
  const { drain } = await allocateOwned(f.pool);
  expect(drain.snapshot().roots).toBe(0);
  expect(drain.snapshot().byKind.execution).toBe(2);
  const release = observe(f.pool.release('task'));
  await vi.advanceTimersByTimeAsync(3000);
  await release.finished;
  expect(drain.snapshot().idle).toBe(true);
});

it('cancels the pending banner before closing its connection', async () => {
  const f = fixture();
  await f.pool.allocate('task', 'synthetic');
  f.state.showPages = true;
  const release = observe(f.pool.release('task'));
  await vi.advanceTimersByTimeAsync(6000);
  await release.finished;
  expect(f.state.evaluations).toBe(0);
  expect(f.state.closes).toBe(1);
});

it.each(['release', 'shutdown', 'adopt'] as const)(
  '%s waits for a started hook before disconnect',
  async (mode) => {
    const hold = gate();
    const f = fixture(async () => {
      await runBrowserOperation(() => hold.wait);
    });
    await f.pool.allocate('task', 'synthetic');
    await flush();
    let task = 'task';
    if (mode === 'adopt') {
      f.pool.retain(task, 20000);
      expect(f.pool.adoptRetained(task, 'next', 'synthetic')).not.toBeNull();
      task = 'next';
    }
    const done = observe<unknown>(mode === 'shutdown' ? f.pool.shutdown() : f.pool.release(task));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.state.closes).toBe(0);
    expect(done.state.done).toBe(false);
    hold.release();
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    await done.finished;
    expect(f.state.closes).toBe(1);
  },
);

it('waits for the actual banner SDK even after its two-second timeout', async () => {
  const f = fixture();
  await f.pool.allocate('task', 'synthetic');
  f.state.showPages = true;
  await vi.advanceTimersByTimeAsync(5500);
  expect(f.state.evaluations).toBe(1);
  const release = observe(f.pool.release('task'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.state.closes).toBe(0);
  expect(release.state.done).toBe(false);
  f.hold.release();
  await flush();
  await vi.advanceTimersByTimeAsync(3000);
  await release.finished;
  expect(f.state.closes).toBe(1);
});

it('a timed-out hook still retains and waits for its original SDK', async () => {
  const hold = gate();
  const f = fixture(async () => {
    const raw = runBrowserOperation(() => hold.wait);
    void raw.catch(() => {});
    await Promise.race([raw, Promise.resolve('caller-timeout')]);
  });
  await f.pool.allocate('task', 'synthetic');
  const release = observe(f.pool.release('task'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.state.closes).toBe(0);
  hold.release();
  await flush();
  await vi.advanceTimersByTimeAsync(3000);
  await release.finished;
  expect(f.state.closes).toBe(1);
});

it.each(['release', 'shutdown'] as const)(
  'rejects %s from its own hook instead of waiting on itself',
  async (mode) => {
    let error: unknown;
    let hookDone = false;
    const f = fixture(async () => {
      try {
        await (mode === 'release' ? f.pool.release('task') : f.pool.shutdown());
      } catch (err) {
        error = err;
      }
      hookDone = true;
    });
    await f.pool.allocate('task', 'synthetic');
    await flush();
    expect(hookDone).toBe(true);
    expect(error).toBeDefined();
    expect(f.pool.peek('task')?.status).toBe('ready');
    expect(f.state.closes).toBe(0);
  },
);

it('shutdown during allocation prevents late background work from starting', async () => {
  const ready = gate();
  let hookCalls = 0;
  const f = fixture(async () => {
    hookCalls++;
  });
  transport.ready = async () => {
    await ready.wait;
    return 'synthetic';
  };
  const allocation = observe(f.pool.allocate('task', 'synthetic'));
  await flush();
  const stop = observe(f.pool.shutdown());
  ready.release();
  await allocation.finished;
  await vi.advanceTimersByTimeAsync(6000);
  await stop.finished;
  expect(hookCalls).toBe(0);
  expect(f.state.closes).toBe(1);
});

it.each(['blocked', 'unknown', 'throws'] as const)(
  'hook getter %s never invokes the hook and retains true uncertainty only',
  async (mode) => {
    let calls = 0;
    const f = fixture();
    Object.defineProperty(f.config, 'onInstanceReady', {
      get() {
        const life = currentOperationLifetime();
        if (!life) throw new Error('expected synthetic scope');
        if (mode === 'throws') throw new Error('synthetic getter failure');
        if (mode === 'blocked') life.drain.block();
        if (mode === 'unknown') life.drain.markUnknown(life.owner);
        return async () => {
          calls++;
        };
      },
    });
    const { drain } = await allocateOwned(f.pool);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toBe(0);
    expect(drain.snapshot().unknown).toBe(mode === 'blocked' ? 0 : 1);
    const release = observe(f.pool.release('task'));
    await vi.advanceTimersByTimeAsync(3000);
    await release.finished;
    expect(f.state.closes).toBe(1);
  },
);

it('a failed hook cannot short-circuit a still-running banner during stop', async () => {
  const hook = gate();
  const f = fixture(async () => {
    await hook.wait;
    throw new Error('synthetic hook failure');
  });
  const { drain } = await allocateOwned(f.pool);
  f.state.showPages = true;
  await vi.advanceTimersByTimeAsync(3500);
  expect(f.state.evaluations).toBe(1);
  hook.release();
  await flush();
  expect(drain.snapshot().unknown).toBeGreaterThan(0);
  const release = observe(f.pool.release('task'));
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.state.closes).toBe(0);
  f.hold.release();
  await flush();
  await vi.advanceTimersByTimeAsync(3000);
  await release.finished;
  expect(f.state.closes).toBe(1);
  expect(drain.snapshot().active).toBe(0);
  expect(drain.snapshot().idle).toBe(false);
});

it.each(['release', 'shutdown', 'adopt'] as const)(
  'raw continuation rejects self-wait even with an existing %s receipt',
  async (mode) => {
    const hold = gate();
    let error: unknown;
    const f = fixture(async () => {
      const raw = runBrowserOperation(async () => {
        await hold.wait;
        try {
          await (mode === 'shutdown'
            ? f.pool.shutdown()
            : f.pool.release(mode === 'adopt' ? 'next' : 'task'));
        } catch (err) {
          error = err;
        }
      });
      void raw.catch(() => {});
      await Promise.race([raw, Promise.resolve('timeout')]);
    });
    await f.pool.allocate('task', 'synthetic');
    if (mode === 'adopt') {
      f.pool.retain('task', 20000);
      f.pool.adoptRetained('task', 'next', 'synthetic');
    }
    const closing = observe<unknown>(
      mode === 'shutdown' ? f.pool.shutdown() : f.pool.release(mode === 'adopt' ? 'next' : 'task'),
    );
    hold.release();
    await flush();
    expect(error).toBeDefined();
    await vi.advanceTimersByTimeAsync(3000);
    await closing.finished;
    expect(f.state.closes).toBe(1);
  },
);

it('shutdown seals existing hook dispatch before waiting for another unfinished allocation', async () => {
  const hook = gate();
  let calls = 0;
  const f = fixture(async () => {
    await hook.wait;
    await runBrowserOperation(() => {
      calls++;
    });
  });
  await f.pool.allocate('task', 'synthetic');
  const ready = gate();
  transport.ready = async () => {
    await ready.wait;
    return 'synthetic';
  };
  const allocation = observe(f.pool.allocate('pending', 'synthetic'));
  await flush();
  const closing = observe(f.pool.shutdown());
  hook.release();
  await flush();
  expect(calls).toBe(0);
  expect(closing.state.done).toBe(false);
  ready.release();
  await allocation.finished;
  await vi.advanceTimersByTimeAsync(5000);
  await closing.finished;
});

it('background reservation exhaustion closes the acquired connection and releases only its slot', async () => {
  const f = fixture();
  const drain = new ExecutionDrain(4);
  drain.open();
  const competitors: ReturnType<ExecutionDrain['admit']>[] = [];
  let queued = false;
  f.state.onPages = () => {
    if (queued) return;
    queued = true;
    observe(
      (async () => {
        // Simulate independently accepted work reserving the remaining capacity
        // between connection setup completion and background registration.
        for (let i = 0; i < 100; i++) {
          await Promise.resolve();
          if (drain.snapshot().children === 1) {
            competitors.push(
              drain.fork(root.owner, 'execution'),
              drain.fork(root.owner, 'execution'),
            );
            return;
          }
        }
        throw new Error('synthetic capacity race did not enter expected boundary');
      })(),
    );
  };
  const root = startOwnedOperation(drain, 'request', () => f.pool.allocate('task', 'synthetic'), {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  const allocation = observe(root.result);
  drain.close();
  await allocation.finished;
  expect(competitors.length).toBe(2);
  expect(allocation.state.error).toBeDefined();
  expect(f.state.closes).toBe(1);
  expect(f.pool.peek('task')).toBeNull();
  expect(f.pool.stats().idle).toBe(2);
  for (const owner of competitors) drain.finish(owner);
  expect(drain.snapshot().idle).toBe(true);
});
