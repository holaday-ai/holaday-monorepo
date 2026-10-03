import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserPool } from './browser-pool.js';
import { BrowserEgressProxy } from './egress-proxy.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation } from '../execution/owned-operation.js';

const transport = vi.hoisted(() => ({
  ready: async () => 'synthetic',
  connect: async () => ({ contexts: () => [], close: async () => {} }),
  remove: (_path: unknown) => {},
  die: () => {},
}));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    rmSync: (...args: Parameters<typeof original.rmSync>) => {
      transport.remove(args[0]);
      return original.rmSync(...args);
    },
  };
});
vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: (...args: unknown[]) => transport.connect(...(args as [])),
    executablePath: () => '/synthetic-browser',
  },
}));
vi.mock('./spawn.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./spawn.js')>();
  let pid = 900_000;
  const spawn = () => {
    const child = new EventEmitter();
    transport.die = () => {
      child.emit('exit', 1);
    };
    return { pid: ++pid, child, kill: () => true };
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

const cleanup: Array<() => void> = [];
const releases: Array<() => void> = [];
const pools: BrowserPool[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  releases.push(resolve);
  return { promise, resolve };
}
function observe<T>(promise: Promise<T>) {
  const state = { done: false, value: undefined as T | undefined, error: undefined as unknown };
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
  return { state, finished };
}
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function fixture(
  options: {
    onReady?: () => void;
    onInfo?: (message: string) => void;
    onDebug?: () => void;
    onWarn?: () => void;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'hd-pool-stop-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let closes = 0;
  vi.spyOn(BrowserEgressProxy.prototype, 'start').mockResolvedValue('http://127.0.0.1:1');
  vi.spyOn(BrowserEgressProxy.prototype, 'close').mockImplementation(async () => {
    closes++;
  });
  // Real pool allocation, spawn orchestration, slot accounting, executor connect
  // and teardown run. Only external process/CDP/proxy transport is synthetic.
  const logger = {
    info: (_fields: unknown, message: string) => options.onInfo?.(message),
    warn: () => options.onWarn?.(),
    error: () => {},
    debug: () => options.onDebug?.(),
  } as unknown as Logger;
  const pool = new BrowserPool(
    {
      maxInstances: 2,
      idleTimeoutMs: 500,
      baseDir: directory,
      cdpPortStart: 9300,
      vncPortStart: 5910,
      wsPortStart: 6090,
      displayStart: 100,
      screenSize: '1280x800x24',
      onInstanceReady: options.onReady,
    },
    logger,
  );
  pools.push(pool);
  return { pool, closes: () => closes, directory };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('STEALTH_ENABLED', 'false');
  transport.ready = async () => 'synthetic';
  transport.connect = async () => ({ contexts: () => [], close: async () => {} });
  transport.remove = () => {};
  vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(async () => {
  // Release all synthetic gates before waiting for real coordinator cleanup.
  for (const release of releases.splice(0)) release();
  await flush();
  const stops = pools.splice(0).map((pool) => observe(pool.shutdown()));
  await vi.dynamicImportSettled();
  await flush();
  await vi.advanceTimersByTimeAsync(10_000);
  await Promise.all(stops.map((stop) => stop.finished));
  transport.remove = () => {};
  for (const clean of cleanup.splice(0)) clean();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(['ready', 'connect'] as const)(
  'shutdown waits for pending %s allocation before closing proxy',
  async (phase) => {
    const gate = deferred();
    if (phase === 'ready')
      transport.ready = async () => {
        await gate.promise;
        return 'synthetic';
      };
    else
      transport.connect = async () => {
        await gate.promise;
        return { contexts: () => [], close: async () => {} };
      };
    const f = fixture();
    const allocation = observe(f.pool.allocate('task', 'synthetic'));
    await flush();
    const stop = observe(f.pool.shutdown());
    await flush();
    expect(stop.state.done).toBe(false);
    expect(f.closes()).toBe(0);
    gate.resolve();
    await allocation.finished;
    expect(allocation.state.error).toBeUndefined();
    const dir = allocation.state.value?.userDataDir;
    expect(dir).toBeDefined();
    await flush();
    expect(stop.state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    await stop.finished;
    expect(stop.state.error).toBeUndefined();
    expect(f.pool.peek('task')).toBeNull();
    expect(dir && existsSync(dir)).toBe(false);
    expect(f.closes()).toBe(1);
  },
);
it('maintenance waits for the original GC release without shutting down live tasks', async () => {
  const f = fixture();
  await f.pool.allocate('gc-task', 'synthetic');
  const drain = new ExecutionDrain();
  drain.open();
  const held = deferred();
  const release = vi.spyOn(f.pool, 'release').mockImplementationOnce(async () => { await held.promise; return true; });
  f.pool.startGc({ drain, tick() {}, runRoot: (action) => startOwnedOperation(drain, 'request', async (owner) => action({ drain, owner }), { dispatch: 'immediate', errorOutcome: 'unknown' }) });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(release).toHaveBeenCalledOnce();
  const paused = observe(f.pool.pauseMaintenanceProducers());
  await flush();
  expect(paused.state.done).toBe(false);
  expect(drain.snapshot().active).toBeGreaterThan(0);
  held.resolve();
  await paused.finished;
  expect(paused.state.error).toBeUndefined();
  expect(f.pool.peek('gc-task')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(release).toHaveBeenCalledOnce();
});
it('maintenance prevents retention timer dispatch and never claims a live retained pool is idle', async () => {
  const f = fixture();
  await f.pool.allocate('retained-task', 'synthetic');
  const release = vi.spyOn(f.pool, 'release');
  f.pool.retain('retained-task', 1000, 'terminal-review');
  await f.pool.pauseMaintenanceProducers();
  await vi.advanceTimersByTimeAsync(2000);
  expect(release).not.toHaveBeenCalled();
  expect(() => f.pool.assertMaintenanceIdle()).toThrow('MAINTENANCE_POOL_UNPROVEN');
  f.pool.retain('retained-task', 1000, 'terminal-review');
  await vi.advanceTimersByTimeAsync(2000);
  expect(release).not.toHaveBeenCalled();
});
it('only an empty stopped pool passes the maintenance assertion', async () => {
  const f = fixture();
  expect(() => f.pool.assertMaintenanceIdle()).toThrow();
  await f.pool.pauseMaintenanceProducers();
  expect(() => f.pool.assertMaintenanceIdle()).not.toThrow();
});
it('waits for rejected allocation cleanup before closing proxy', async () => {
  const gate = deferred();
  transport.ready = async () => {
    await gate.promise;
    throw new Error('synthetic');
  };
  const f = fixture();
  const allocating = observe(f.pool.allocate('task', 'synthetic'));
  await flush();
  const stop = observe(f.pool.shutdown());
  await flush();
  expect(stop.state.done).toBe(false);
  expect(f.closes()).toBe(0);
  gate.resolve();
  await allocating.finished;
  await stop.finished;
  expect(allocating.state.error).toBeInstanceOf(Error);
  expect(f.closes()).toBe(1);
});
it.each(['duplicate-release', 'shutdown'] as const)(
  '%s waits for an already draining instance',
  async (mode) => {
    const f = fixture();
    const inst = await f.pool.allocate('task', 'synthetic');
    const gate = deferred();
    vi.spyOn(inst.executor, 'disconnect').mockImplementation(() => gate.promise);
    const first = observe(f.pool.release('task'));
    await flush();
    const second = observe<unknown>(
      mode === 'shutdown' ? f.pool.shutdown() : f.pool.release('task'),
    );
    await flush();
    expect(first.state.done).toBe(false);
    expect(second.state.done).toBe(false);
    expect(f.closes()).toBe(0);
    gate.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(3_000);
    await first.finished;
    await second.finished;
    expect(first.state.value).toBe(true);
    if (mode === 'duplicate-release') expect(second.state.value).toBe(false);
    expect(f.pool.peek('task')).toBeNull();
  },
);
it('concurrent shutdown callers share the same teardown and proxy close', async () => {
  const f = fixture();
  await f.pool.allocate('task', 'synthetic');
  const first = observe(f.pool.shutdown());
  const second = observe(f.pool.shutdown());
  await flush();
  expect(first.state.done).toBe(false);
  expect(second.state.done).toBe(false);
  expect(f.closes()).toBe(0);
  await vi.advanceTimersByTimeAsync(3_000);
  await Promise.all([first.finished, second.finished]);
  expect(f.closes()).toBe(1);
});
it('registers allocation before a spawning logger can reenter shutdown', async () => {
  const gate = deferred();
  transport.ready = async () => {
    await gate.promise;
    return 'synthetic';
  };
  let stop: ReturnType<typeof observe<void>> | undefined;
  const f = fixture({
    onInfo: (message) => {
      if (message === 'pool: spawning quartet') stop = observe(f.pool.shutdown());
    },
  });
  const allocation = observe(f.pool.allocate('task', 'synthetic'));
  await flush();
  expect(stop).toBeDefined();
  expect(stop?.state.done).toBe(false);
  expect(f.closes()).toBe(0);
  gate.resolve();
  await allocation.finished;
  await vi.advanceTimersByTimeAsync(3_000);
  await stop?.finished;
  expect(f.pool.peek('task')).toBeNull();
});
it('registers release before its logger can reenter release', async () => {
  let second: ReturnType<typeof observe<boolean>> | undefined;
  const f = fixture({
    onInfo: (message) => {
      if (message === 'pool: release') second = observe(f.pool.release('task'));
    },
  });
  await f.pool.allocate('task', 'synthetic');
  const first = observe(f.pool.release('task'));
  await flush();
  expect(second).toBeDefined();
  expect(second?.state.done).toBe(false);
  await vi.advanceTimersByTimeAsync(3_000);
  await first.finished;
  await second?.finished;
  expect(second?.state.value).toBe(false);
});
it('does not issue new leases from a late allocation during shutdown', async () => {
  const gate = deferred();
  transport.ready = async () => {
    await gate.promise;
    return 'synthetic';
  };
  let retained: boolean | undefined;
  const f = fixture({
    onReady: () => {
      retained = f.pool.retain('task', 60_000);
    },
  });
  const allocation = observe(f.pool.allocate('task', 'synthetic'));
  await flush();
  const stop = observe(f.pool.shutdown());
  gate.resolve();
  await allocation.finished;
  // Shutdown now suppresses the late hook altogether; the public lease gate
  // must still reject even when called outside that suppressed callback.
  expect(retained).toBeUndefined();
  expect(f.pool.retain('task', 60_000)).toBe(false);
  await vi.advanceTimersByTimeAsync(3_000);
  await stop.finished;
});
it('cannot restart GC after shutdown', async () => {
  const f = fixture();
  await f.pool.shutdown();
  f.pool.startGc();
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['adopt', 'touch'] as const)(
  'shutdown blocks %s while waiting for another allocation',
  async (mode) => {
    const f = fixture();
    const instance = await f.pool.allocate('retained', 'synthetic');
    f.pool.retain('retained', 60_000);
    const gate = deferred();
    transport.ready = async () => {
      await gate.promise;
      return 'synthetic';
    };
    const allocating = observe(f.pool.allocate('pending', 'synthetic'));
    await flush();
    const stop = observe(f.pool.shutdown());
    const before = instance.retainedUntil;
    await vi.advanceTimersByTimeAsync(1);
    if (mode === 'adopt')
      expect(f.pool.adoptRetained('retained', 'followup', 'synthetic')).toBeNull();
    else {
      f.pool.touch('retained');
      expect(instance.retainedUntil).toBe(before);
    }
    gate.resolve();
    await allocating.finished;
    await vi.advanceTimersByTimeAsync(3_000);
    await stop.finished;
  },
);
it('waits for other releases even when one release rejects', async () => {
  let first = true;
  const f = fixture({
    onInfo: (message) => {
      if (message === 'pool: release' && first) {
        first = false;
        throw new Error('synthetic log failure');
      }
    },
  });
  await f.pool.allocate('first', 'synthetic');
  const second = await f.pool.allocate('second', 'synthetic');
  const gate = deferred();
  vi.spyOn(second.executor, 'disconnect').mockImplementation(() => gate.promise);
  const stop = observe(f.pool.shutdown());
  await flush();
  expect(stop.state.done).toBe(false);
  expect(f.closes()).toBe(0);
  gate.resolve();
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await stop.finished;
  expect(stop.state.error).toBeInstanceOf(Error);
  expect(f.pool.peek('second')).toBeNull();
  expect(f.closes()).toBe(0);
});
it('does not forget an earlier failed release at shutdown', async () => {
  const f = fixture({
    onInfo: (message) => {
      if (message === 'pool: release') throw new Error('synthetic');
    },
  });
  await f.pool.allocate('task', 'synthetic');
  await expect(f.pool.release('task')).rejects.toThrow('synthetic');
  const stop = observe(f.pool.shutdown());
  await stop.finished;
  expect(stop.state.error).toBeInstanceOf(Error);
  expect(f.closes()).toBe(0);
});
it.each(['pending', 'failed'] as const)(
  'refuses same-key allocation during %s release',
  async (mode) => {
    const f = fixture({
      onInfo: (message) => {
        if (mode === 'failed' && message === 'pool: release') throw new Error('synthetic');
      },
    });
    const original = await f.pool.allocate('task', 'synthetic');
    const gate = deferred();
    if (mode === 'pending')
      vi.spyOn(original.executor, 'disconnect').mockImplementation(() => gate.promise);
    const releasing = observe(f.pool.release('task'));
    await flush();
    const replacement = observe(f.pool.allocate('task', 'synthetic'));
    await replacement.finished;
    expect(replacement.state.error).toBeInstanceOf(Error);
    expect(f.pool.peek('task')).toBe(original);
    expect(f.pool.stats().byUser).toHaveLength(1);
    gate.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(3_000);
    await releasing.finished;
  },
);
it('shutdown retains failed release even after its instance key was removed', async () => {
  const f = fixture({
    onDebug: () => {
      throw new Error('synthetic cleanup diagnostic');
    },
  });
  const inst = await f.pool.allocate('task', 'synthetic');
  transport.remove = (path) => {
    if (path === inst.userDataDir) throw new Error('synthetic cleanup failure');
  };
  const releasing = observe(f.pool.release('task'));
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await releasing.finished;
  expect(releasing.state.error).toBeInstanceOf(Error);
  expect(f.pool.peek('task')).toBeNull();
  const stop = observe(f.pool.shutdown());
  await stop.finished;
  expect(stop.state.error).toBeInstanceOf(Error);
  expect(f.closes()).toBe(0);
});
it('refuses replacement of a dead instance before auto-release registers', async () => {
  let replacement: ReturnType<typeof observe> | undefined;
  const f = fixture({
    onWarn: () => {
      replacement ??= observe(f.pool.allocate('task', 'synthetic'));
    },
  });
  const original = await f.pool.allocate('task', 'synthetic');
  transport.die();
  expect(replacement).toBeDefined();
  await replacement?.finished;
  expect(replacement?.state.error).toBeInstanceOf(Error);
  expect(f.pool.peek('task')).toBe(original);
});
it('refuses adoption into a key with a failed release receipt', async () => {
  const f = fixture({
    onDebug: () => {
      throw new Error('synthetic diagnostic');
    },
  });
  const old = await f.pool.allocate('old', 'synthetic');
  const retained = await f.pool.allocate('retained', 'synthetic');
  if (!retained.userDataDir) throw new Error('Expected original legacy profile path');
  transport.remove = (path) => {
    if (path === old.userDataDir) throw new Error('synthetic cleanup');
  };
  const release = observe(f.pool.release('old'));
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await release.finished;
  expect(release.state.error).toBeInstanceOf(Error);
  expect(f.pool.peek('old')).toBeNull();
  expect(f.pool.retain('retained', 60_000)).toBe(true);
  expect(f.pool.adoptRetained('retained', 'old', 'synthetic')).toBeNull();
  expect(f.pool.peek('retained')).toBe(retained);
  const stop = observe(f.pool.shutdown());
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await stop.finished;
  expect(stop.state.error).toBeInstanceOf(Error);
  expect(f.pool.peek('retained')).toBeNull();
  expect(existsSync(retained.userDataDir)).toBe(false);
});
it('refuses adoption into a key whose allocation is still pending', async () => {
  const f = fixture();
  const retained = await f.pool.allocate('retained', 'synthetic');
  if (!retained.userDataDir) throw new Error('Expected original legacy profile path');
  expect(f.pool.retain('retained', 60_000)).toBe(true);
  const gate = deferred();
  transport.ready = async () => {
    await gate.promise;
    return 'synthetic';
  };
  const allocation = observe(f.pool.allocate('allocating', 'synthetic'));
  await flush();
  expect(allocation.state.done).toBe(false);
  expect(f.pool.adoptRetained('retained', 'allocating', 'synthetic')).toBeNull();
  expect(f.pool.peek('retained')).toBe(retained);
  gate.resolve();
  await allocation.finished;
  expect(allocation.state.error).toBeUndefined();
  const stop = observe(f.pool.shutdown());
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  await stop.finished;
  expect(stop.state.error).toBeUndefined();
  expect(f.pool.stats().byUser).toHaveLength(0);
  expect(existsSync(retained.userDataDir)).toBe(false);
  const allocated = allocation.state.value;
  expect(allocated).toBeDefined();
  if (!allocated) throw new Error('Expected a completed synthetic allocation');
  if (!allocated.userDataDir) throw new Error('Expected original legacy profile path');
  expect(existsSync(allocated.userDataDir)).toBe(false);
});
it('refuses new allocations after stopping starts', async () => {
  const f = fixture();
  const stop = f.pool.shutdown();
  await expect(f.pool.allocate('task', 'synthetic')).rejects.toThrow(/shutting down/);
  await stop;
  expect(f.pool.canAllocate()).toBe(false);
});
it.each(['gc', 'retention'] as const)('shutdown waits for %s-triggered release', async (mode) => {
  const f = fixture();
  await f.pool.allocate('task', 'synthetic');
  if (mode === 'gc') f.pool.startGc();
  else f.pool.retain('task', 100);
  await vi.advanceTimersByTimeAsync(mode === 'gc' ? 15_000 : 100);
  const stop = observe(f.pool.shutdown());
  await flush();
  expect(stop.state.done).toBe(false);
  expect(f.closes()).toBe(0);
  await vi.advanceTimersByTimeAsync(3_000);
  await stop.finished;
  expect(f.pool.peek('task')).toBeNull();
});
