import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation, withOperationDispatchScope } from '../execution/owned-operation.js';
import { spawnOwnedPoolProcess } from './owned-pool-process.js';

const boundary = vi.hoisted(() => ({ spawn: (() => {}) as () => unknown }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: () => boundary.spawn(),
}));
const children: ChildProcess[] = [];
let child: ChildProcess;
let calls: NodeJS.Signals[];
let spawnCount = 0;
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; error?: unknown } = { done: false };
  const finished = promise.then(
    () => {
      state.done = true;
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
async function owned() {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () =>
      withOperationDispatchScope((seal) => {
        const value = spawnOwnedPoolProcess('/synthetic', [], { detached: true });
        seal();
        return value;
      }),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  drain.close();
  return { drain, lease: await root.result };
}
beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  spawnCount = 0;
  child = new ChildProcess();
  Object.defineProperty(child, 'pid', { value: 991000, configurable: true });
  children.push(child);
  boundary.spawn = () => {
    spawnCount++;
    return child;
  };
  vi.spyOn(ChildProcess.prototype, 'kill').mockImplementation((signal) => {
    calls.push(signal as NodeJS.Signals);
    return true;
  });
});
afterEach(async () => {
  for (const value of children.splice(0)) value.emit('close', 0, null);
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['before-spawn', 'after-spawn'] as const)(
  'stop %s shares one receipt and waits for close, not exit or killed',
  async (order) => {
    const f = await owned();
    if (order === 'after-spawn') {
      child.emit('spawn');
      await f.lease.ready;
    }
    const first = f.lease.terminate();
    const second = f.lease.terminate();
    const closed = observe(first);
    expect(first).toBe(second);
    if (order === 'before-spawn') {
      expect(calls).toEqual([]);
      child.emit('spawn');
    }
    expect(calls).toEqual(['SIGTERM']);
    Object.defineProperty(child, 'killed', { value: true, configurable: true });
    child.emit('exit', 0, null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual(['SIGTERM']);
    expect(closed.state.done).toBe(false);
    expect(f.drain.snapshot().active).toBe(1);
    child.emit('close', 0, null);
    await closed.finished;
    expect(String(closed.state.error)).toContain('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
    expect(f.drain.snapshot().active).toBe(0);
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(f.lease.isRunning()).toBe(false);
    expect(f.lease.terminate()).toBe(first);
  },
);

it.each(['false', 'throw', 'true'] as const)(
  'signal %s never substitutes for child close',
  async (mode) => {
    vi.mocked(ChildProcess.prototype.kill).mockImplementation((signal) => {
      calls.push(signal as NodeJS.Signals);
      if (mode === 'throw') throw Object.assign(new Error('synthetic signal'), { code: 'ESRCH' });
      return mode !== 'false';
    });
    const f = await owned();
    child.emit('spawn');
    await f.lease.ready;
    const stopping = observe(f.lease.terminate());
    await vi.advanceTimersByTimeAsync(9000);
    expect(calls).toEqual(['SIGTERM', 'SIGKILL']);
    expect(stopping.state.done).toBe(false);
    expect(f.drain.snapshot().active).toBe(1);
    child.emit('close', null, 'SIGKILL');
    await stopping.finished;
    expect(stopping.state.error).toBeDefined();
    expect(f.drain.snapshot().unknown).toBe(1);
  },
);

it('no-pid native error is observed until close and does not invent a spawned group', async () => {
  Reflect.deleteProperty(child, 'pid');
  const f = await owned();
  child.emit('error', Object.assign(new Error('synthetic ENOENT'), { code: 'ENOENT' }));
  await expect(f.lease.ready).rejects.toThrow('POOL_PROCESS_START_FAILED');
  const stopping = observe(f.lease.terminate());
  await flush();
  expect(stopping.state.done).toBe(false);
  expect(f.drain.snapshot().active).toBe(1);
  child.emit('close', -2, null);
  await stopping.finished;
  expect(stopping.state.error).toBeUndefined();
  expect(f.drain.snapshot().idle).toBe(true);
  expect(calls).toEqual([]);
});

it.each(['pid', 'kill'] as const)('does not redirect termination after %s drift', async (field) => {
  const f = await owned();
  child.emit('spawn');
  await f.lease.ready;
  if (field === 'pid') Object.defineProperty(child, 'pid', { value: 123 });
  else
    child.kill = () => {
      throw new Error('foreign method must not run');
    };
  const stopping = observe(f.lease.terminate());
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toEqual([]);
  expect(stopping.state.done).toBe(false);
  child.emit('close', 0, null);
  await stopping.finished;
  expect(f.drain.snapshot().unknown).toBe(1);
});

it('permanent drain block does not prevent cleanup of the already bound child', async () => {
  const f = await owned();
  child.emit('spawn');
  await f.lease.ready;
  f.drain.block();
  const stopping = observe(f.lease.terminate());
  expect(calls).toEqual(['SIGTERM']);
  child.emit('close', 0, null);
  await stopping.finished;
  expect(f.drain.snapshot().active).toBe(0);
  expect(f.drain.snapshot().idle).toBe(false);
});

it('stream setup failure cannot release an already acquired child before close', async () => {
  Object.defineProperty(child, 'stdout', {
    get: () => {
      throw new Error('synthetic stream details');
    },
  });
  const f = await owned();
  const stopping = observe(f.lease.terminate());
  await expect(f.lease.ready).rejects.toThrow('POOL_PROCESS_START_FAILED');
  await flush();
  expect(stopping.state.done).toBe(false);
  expect(f.drain.snapshot().active).toBe(1);
  child.emit('spawn');
  child.emit('close', 0, null);
  await stopping.finished;
  expect(String(stopping.state.error)).not.toContain('synthetic stream details');
  expect(f.drain.snapshot().unknown).toBe(1);
});

it('strict child output is consumed without surfacing its raw text', async () => {
  const stream = new PassThrough();
  child.stdout = stream;
  const f = await owned();
  child.emit('spawn');
  await f.lease.ready;
  stream.write('synthetic child output');
  await new Promise<void>((resolve) => process.nextTick(resolve));
  expect(stream.readableLength).toBe(0);
  const stopping = observe(f.lease.terminate());
  stream.end();
  child.emit('close', 0, null);
  await stopping.finished;
});

it('refuses spawn before dispatch when the inherited lifetime is blocked', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () => {
      drain.block();
      return spawnOwnedPoolProcess('/synthetic', [], { detached: true });
    },
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  await expect(root.result).rejects.toThrow();
  expect(spawnCount).toBe(0);
});

it.each(['exit', 'spawn', 'close'] as const)(
  'native newListener failure for %s cannot release the acquired child',
  async (event) => {
    child.on('newListener', (name) => {
      if (name === event) throw new Error('synthetic observer installation');
    });
    const f = await owned();
    const stopped = observe(f.lease.terminate());
    await expect(f.lease.ready).rejects.toThrow('POOL_PROCESS_START_FAILED');
    await flush();
    expect(stopped.state.done).toBe(false);
    expect(f.drain.snapshot().active).toBe(1);
    expect(f.drain.snapshot().unknown).toBe(1);
    child.emit('close', 0, null);
    await flush();
    if (event !== 'close') {
      await stopped.finished;
      expect(stopped.state.error).toBeDefined();
      expect(f.drain.snapshot().active).toBe(0);
    } else {
      // No close observer was installed: this synthetic resource must remain unproven.
      expect(stopped.state.done).toBe(false);
      expect(f.drain.snapshot().active).toBe(1);
    }
  },
);

it.each(['stdout', 'stderr'] as const)(
  '%s errors are observed without releasing the child close wait',
  async (field) => {
    const stream = new PassThrough();
    child[field] = stream;
    const f = await owned();
    child.emit('spawn');
    await f.lease.ready;
    expect(() => stream.emit('error', new Error('synthetic stream read'))).not.toThrow();
    expect(f.drain.snapshot().unknown).toBe(1);
    const stopping = observe(f.lease.terminate());
    await flush();
    expect(stopping.state.done).toBe(false);
    expect(f.drain.snapshot().active).toBe(1);
    stream.end();
    child.emit('close', 0, null);
    await stopping.finished;
    expect(stopping.state.error).toBeDefined();
  },
);

it.each(['child', 'stdout', 'stderr'] as const)(
  '%s error-registration failure cannot leave an unhandled resource error',
  async (field) => {
    const stream = field === 'child' ? undefined : new PassThrough();
    if (field !== 'child' && stream) child[field] = stream;
    const target = stream ?? child;
    target.on('newListener', (name) => {
      if (name === 'error') throw new Error('synthetic error registration');
    });
    const f = await owned();
    const stopping = observe(f.lease.terminate());
    await expect(f.lease.ready).rejects.toThrow('POOL_PROCESS_START_FAILED');
    if (stream) expect(stream.readableFlowing).toBe(true);
    target.on('synthetic-other', () => {
      throw new Error('synthetic unrelated observer');
    });
    expect(() => target.emit('synthetic-other')).toThrow('synthetic unrelated observer');
    expect(() => target.emit('error', new Error('synthetic resource error'))).not.toThrow();
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(stopping.state.done).toBe(false);
    child.emit('spawn');
    stream?.end();
    child.emit('close', 0, null);
    await stopping.finished;
    expect(stopping.state.error).toBeDefined();
    // Late errors remain locally bounded but cannot mutate a finished owner.
    expect(() => target.emit('error', new Error('synthetic late error'))).not.toThrow();
    expect(f.drain.snapshot().active).toBe(0);
  },
);
