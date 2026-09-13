import { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation } from '../execution/owned-operation.js';
import { BrowserPool } from './browser-pool.js';
import { BrowserEgressProxy } from './egress-proxy.js';

const transport = vi.hoisted(() => ({
  spawn: (() => {}) as (...args: unknown[]) => unknown,
  ready: async () => 'synthetic',
  disconnect: () => Promise.resolve(),
  connectOk: true,
  log: (_message: string) => {},
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: (...args: unknown[]) => transport.spawn(...args),
}));
vi.mock('playwright', () => ({ chromium: { executablePath: () => '/synthetic-browser' } }));
// This suite tests real spawn/pool/drain; CDP and background SDK are independent boundaries.
vi.mock('../agent/vision-loop/playwright-executor.js', () => ({
  PlaywrightExecutor: class {
    async connect() {
      return { ok: transport.connectOk };
    }
    disconnect() {
      return transport.disconnect();
    }
    async dismissChromeBanners() {}
    setViewportSize() {}
  },
}));
vi.mock('./cdp-readiness.js', () => ({ waitForCdpReady: () => transport.ready() }));
const dirs: string[] = [];
const children: ChildProcess[] = [];
const signals: Array<{ child: ChildProcess; signal: unknown }> = [];
const platform = Object.getOwnPropertyDescriptor(process, 'platform');
if (!platform) throw new Error('synthetic platform descriptor missing');
function processAt(index: number): ChildProcess {
  const value = children[index];
  if (!value) throw new Error('synthetic child missing');
  return value;
}
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; error?: unknown; value?: T } = { done: false };
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
function close(child: ChildProcess) {
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
}
function fixture(vncEnabled = false, maxInstances = 1) {
  const directory = mkdtempSync(join(tmpdir(), 'hd-owned-pool-'));
  dirs.push(directory);
  const logger = {
    info(_fields: unknown, message: string) {
      transport.log(message);
    },
    warn() {},
    debug() {},
    error() {},
  } as unknown as Logger;
  const pool = new BrowserPool(
    {
      maxInstances,
      idleTimeoutMs: 100000,
      baseDir: directory,
      cdpPortStart: 9300,
      vncPortStart: 5910,
      wsPortStart: 6090,
      displayStart: 100,
      screenSize: '1280x800x24',
      vncEnabled,
    },
    logger,
  );
  const drain = new ExecutionDrain();
  drain.open();
  const allocation = startOwnedOperation(
    drain,
    'request',
    () => pool.allocate('task', 'synthetic'),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  void allocation.result.catch(() => {});
  drain.close();
  return { pool, drain, allocation, directory };
}
beforeEach(() => {
  vi.useFakeTimers();
  transport.ready = async () => 'synthetic';
  transport.disconnect = () => Promise.resolve();
  transport.connectOk = true;
  transport.log = () => {};
  transport.spawn = () => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 990000 + children.length, configurable: true });
    children.push(child);
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  vi.spyOn(ChildProcess.prototype, 'kill').mockImplementation(function (
    this: ChildProcess,
    signal,
  ) {
    signals.push({ child: this, signal });
    return true;
  });
  vi.spyOn(process, 'kill').mockImplementation(() => true);
  vi.spyOn(BrowserEgressProxy.prototype, 'start').mockResolvedValue('http://127.0.0.1:1');
  vi.spyOn(BrowserEgressProxy.prototype, 'close').mockResolvedValue();
});
afterEach(async () => {
  for (const child of children.splice(0)) close(child);
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  signals.length = 0;
  Object.defineProperty(process, 'platform', platform);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('release retains slot/profile until child close and then rejects unproven group exit', async () => {
  const f = fixture();
  const instance = await f.allocation.result;
  if (!instance.userDataDir) throw new Error('Expected original legacy profile path');
  const stopping = observe(f.pool.release('task'));
  await flush();
  for (const child of children) child.emit('exit', 0, null);
  await vi.advanceTimersByTimeAsync(3000);
  expect(stopping.state.done).toBe(false);
  expect(f.pool.canAllocate()).toBe(false);
  expect(existsSync(instance.userDataDir)).toBe(true);
  for (const child of children) child.emit('close', 0, null);
  await stopping.finished;
  expect(String(stopping.state.error)).toContain('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
  expect(f.pool.peek('task')).toBe(instance);
  expect(existsSync(instance.userDataDir)).toBe(true);
  expect(f.drain.snapshot().active).toBe(0);
  expect(f.drain.snapshot().unknown).toBe(children.length);
  expect(f.drain.snapshot().idle).toBe(false);
  await expect(f.pool.shutdown()).rejects.toThrow('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
  expect(BrowserEgressProxy.prototype.close).not.toHaveBeenCalled();
});

it('startup failure retains its record after allocation rejection and blocks shutdown and reuse', async () => {
  transport.ready = async () => {
    throw new Error('synthetic readiness');
  };
  const f = fixture();
  const allocation = observe(f.allocation.result);
  await flush();
  expect(allocation.state.done).toBe(false);
  expect(f.pool.canAllocate()).toBe(false);
  for (const child of children) close(child);
  await allocation.finished;
  expect(allocation.state.error).toBeDefined();
  await expect(f.pool.allocate('task', 'synthetic')).rejects.toThrow();
  await expect(f.pool.shutdown()).rejects.toThrow('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
  expect(f.pool.canAllocate()).toBe(false);
  expect(BrowserEgressProxy.prototype.close).not.toHaveBeenCalled();
});

it('adoption preserves the private process identity despite mutable public PIDs', async () => {
  const f = fixture();
  const instance = await f.allocation.result;
  expect(f.pool.retain('task', 10000)).toBe(true);
  expect(f.pool.adoptRetained('task', 'followup', 'synthetic')).toBe(instance);
  instance.bravePid = 123;
  const stopping = observe(f.pool.release('followup'));
  await flush();
  expect(process.kill).not.toHaveBeenCalled();
  expect(signals.map((entry) => entry.child)).toEqual(children);
  for (const child of children) close(child);
  await stopping.finished;
  expect(stopping.state.error).toBeDefined();
  instance.status = 'ready';
  await expect(f.pool.allocate('followup', 'synthetic')).rejects.toThrow();
  expect(f.pool.retain('followup', 10000)).toBe(false);
  expect(f.pool.adoptRetained('followup', 'third', 'synthetic')).toBeNull();
});

it('retained adoption cannot allow a new allocation to overwrite the original profile', async () => {
  const f = fixture(false, 2);
  const instance = await f.allocation.result;
  expect(f.pool.retain('task', 10000)).toBe(true);
  expect(f.pool.adoptRetained('task', 'followup', 'synthetic')).toBe(instance);
  await expect(f.pool.allocate('task', 'synthetic')).rejects.toThrow(
    'POOL_PROCESS_CLEANUP_PENDING',
  );
  expect(children).toHaveLength(1);
  const stop = observe(f.pool.release('followup'));
  await flush();
  close(processAt(0));
  await stop.finished;
});

it('duplicate allocation while native spawn is pending waits for the original acquisition', async () => {
  transport.spawn = () => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 992000 });
    children.push(child);
    return child;
  };
  const f = fixture();
  await flush();
  const duplicate = observe(f.pool.allocate('task', 'synthetic'));
  await flush();
  expect(duplicate.state.done).toBe(false);
  processAt(0).emit('spawn');
  await f.allocation.result;
  await duplicate.finished;
  expect(duplicate.state.error).toBeUndefined();
  expect(children).toHaveLength(1);
  const stop = observe(f.pool.release('task'));
  await flush();
  close(processAt(0));
  await stop.finished;
});

it('second native spawn failure keeps the first process owned until close and preserves startup failure', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  const spawn = transport.spawn;
  transport.spawn = (...args) => {
    if (children.length === 1) throw new Error('synthetic second spawn');
    return spawn(...args);
  };
  const f = fixture();
  const allocation = observe(f.allocation.result);
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  expect(children).toHaveLength(1);
  expect(allocation.state.done).toBe(false);
  expect(signals.map((s) => s.signal)).toEqual(['SIGTERM']);
  close(processAt(0));
  await allocation.finished;
  expect(f.drain.snapshot().unknown).toBe(1);
  await expect(f.pool.shutdown()).rejects.toThrow('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
  expect(f.pool.canAllocate()).toBe(false);
});

it('one failed close cannot skip another pending child in a four-process record', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  const f = fixture(true);
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  await f.allocation.result;
  expect(children).toHaveLength(4);
  const stopping = observe(f.pool.release('task'));
  await flush();
  expect(signals.map((s) => s.signal)).toEqual(['SIGTERM', 'SIGTERM', 'SIGTERM', 'SIGTERM']);
  for (const child of children.slice(0, 3)) close(child);
  await flush();
  expect(stopping.state.done).toBe(false);
  expect(f.drain.snapshot().active).toBe(1);
  close(processAt(3));
  await stopping.finished;
  expect(stopping.state.error).toBeDefined();
  expect(f.drain.snapshot().active).toBe(0);
  expect(f.drain.snapshot().unknown).toBe(4);
});

it.each(['release', 'startup'] as const)(
  'synchronous executor disconnect failure during %s still waits for all child cleanup',
  async (mode) => {
    if (mode === 'startup') transport.connectOk = false;
    transport.disconnect = () => {
      throw new Error('synthetic disconnect');
    };
    const f = fixture();
    if (mode === 'release') await f.allocation.result;
    const stopping =
      mode === 'release' ? observe(f.pool.release('task')) : observe(f.allocation.result);
    await flush();
    expect(stopping.state.done).toBe(false);
    expect(signals.map((s) => s.signal)).toEqual(['SIGTERM']);
    close(processAt(0));
    await stopping.finished;
    expect(stopping.state.error).toBeDefined();
    await expect(f.pool.shutdown()).rejects.toThrow();
    expect(f.pool.canAllocate()).toBe(false);
  },
);

it('a diagnostic exception cannot prevent strict release from terminating its child', async () => {
  const f = fixture();
  await f.allocation.result;
  transport.log = (message) => {
    if (message === 'pool: release') throw new Error('synthetic logger');
  };
  const stopping = observe(f.pool.release('task'));
  await flush();
  expect(stopping.state.done).toBe(false);
  expect(signals.map((s) => s.signal)).toEqual(['SIGTERM']);
  close(processAt(0));
  await stopping.finished;
  expect(stopping.state.error).toBeDefined();
});

it('native child death after adoption reaps the bound record under its current task', async () => {
  const f = fixture();
  const instance = await f.allocation.result;
  f.pool.retain('task', 10000);
  f.pool.adoptRetained('task', 'followup', 'synthetic');
  processAt(0).emit('exit', 1, null);
  await flush();
  expect(instance.status).toBe('draining');
  const stopping = observe(f.pool.shutdown());
  await flush();
  expect(stopping.state.done).toBe(false);
  processAt(0).emit('close', 1, null);
  await stopping.finished;
  expect(stopping.state.error).toBeDefined();
  expect(f.pool.peek('followup')).toBe(instance);
  expect(signals).toEqual([]);
});

it('shutdown in the readiness diagnostic forbids the next Linux sidecar spawn', async () => {
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  const f = fixture(true);
  let stopping: ReturnType<typeof observe<void>> | undefined;
  transport.log = (message) => {
    if (message === 'pool: Brave CDP ready') stopping = observe(f.pool.shutdown());
  };
  const allocation = observe(f.allocation.result);
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  await flush();
  expect(stopping).toBeDefined();
  expect(children).toHaveLength(2);
  expect(allocation.state.done).toBe(false);
  for (const child of children) close(child);
  await allocation.finished;
  await stopping?.finished;
  expect(allocation.state.error).toBeDefined();
});

it.each([2, 3])(
  'shutdown after child %i track resumes forbids the next actual dispatch',
  async (count) => {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    const spawn = transport.spawn;
    let stopping: ReturnType<typeof observe<void>> | undefined;
    let readinessCalls = 0;
    transport.ready = async () => {
      readinessCalls++;
      return 'synthetic';
    };
    transport.spawn = (...args) => {
      const value = spawn(...args) as ChildProcess;
      if (children.length === count)
        value.on('spawn', () => {
          // Queue shutdown after track's own continuation but before its caller resumes.
          queueMicrotask(() =>
            queueMicrotask(() => {
              stopping = observe(f.pool.shutdown());
            }),
          );
        });
      return value;
    };
    const f = fixture(true);
    const allocation = observe(f.allocation.result);
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    await flush();
    expect(stopping).toBeDefined();
    expect(children).toHaveLength(count);
    expect(readinessCalls).toBe(count === 2 ? 0 : 1);
    for (const value of children) close(value);
    await allocation.finished;
    await stopping?.finished;
    expect(allocation.state.error).toBeDefined();
  },
);
