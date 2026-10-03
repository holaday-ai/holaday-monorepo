import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';

// This suite's Browser.close is synthetic; real close receipts are tested separately.
vi.mock('./browser-close-receipt.js', () => ({
  bindBrowserCloseReceipt: (browser: { close(): Promise<void> }) => () => browser.close(),
}));
import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import { runBrowserOperation } from './browser-operation.js';
import { PlaywrightExecutor } from './playwright-executor.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
const releases: Array<() => void> = [];
const executors: PlaywrightExecutor[] = [];
const pending: Promise<unknown>[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  for (const executor of executors.splice(0)) await executor.disconnect().catch(() => {});
  await Promise.allSettled(pending.splice(0));
});
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
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
function start(action: () => Promise<unknown>) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', action, {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  drain.close();
  return { drain, root, done: observe(root.result) };
}
type Failure = 'none' | 'getter' | 'sync' | 'async';
function fixture(
  options: {
    launchFailure?: Failure;
    closeFailure?: Failure;
    contextFailure?: boolean;
    holdLaunch?: boolean;
    holdContext?: boolean;
    holdClose?: boolean;
    initFailure?: boolean;
  } = {},
) {
  const launchGate = gate();
  const contextGate = gate();
  const closeGate = gate();
  const escapeGate = gate();
  const state = {
    launches: 0,
    contexts: 0,
    contextCloses: 0,
    closes: 0,
    escaped: 0,
    externalCloses: 0,
  };
  let onGetter = () => {};
  let escapedWork: ReturnType<typeof observe> | undefined;
  const context = {
    pages: () => [],
    addInitScript: async () => {},
    setDefaultTimeout() {
      if (options.initFailure) throw new Error('synthetic init failure');
    },
    setDefaultNavigationTimeout() {},
    async close() {
      state.contextCloses++;
      if (options.holdContext) await contextGate.wait;
      if (options.contextFailure) throw new Error('synthetic context failure');
    },
  };
  const browser = {
    contexts: () => [],
    async newContext() {
      state.contexts++;
      return context;
    },
  };
  Object.defineProperty(browser, 'close', {
    get() {
      if (options.closeFailure === 'getter') throw new Error('synthetic close getter');
      return function (this: unknown) {
        expect(this).toBe(browser);
        state.closes++;
        if (options.closeFailure === 'sync') throw new Error('synthetic close sync');
        return (async () => {
          if (options.holdClose) await closeGate.wait;
          if (options.closeFailure === 'async') throw new Error('synthetic close async');
        })();
      };
    },
  });
  const external = {
    contexts: () => [],
    close: async () => {
      state.externalCloses++;
    },
  };
  const chromium = { connectOverCDP: async () => external as never };
  Object.defineProperty(chromium, 'launch', {
    get() {
      onGetter();
      if (options.launchFailure === 'getter') throw new Error('synthetic launch getter');
      return function (this: unknown, opts: unknown) {
        expect(this).toBe(chromium);
        expect(opts).toEqual({ headless: true });
        state.launches++;
        if (options.launchFailure === 'sync') throw new Error('synthetic launch sync');
        escapedWork = observe(
          escapeGate.wait.then(() =>
            runBrowserOperation(async () => {
              state.escaped++;
            }),
          ),
        );
        return (async () => {
          if (options.holdLaunch) await launchGate.wait;
          if (options.launchFailure === 'async') throw new Error('synthetic launch async');
          return browser as never;
        })();
      };
    },
  });
  const executor = new PlaywrightExecutor({ chromium });
  executors.push(executor);
  return {
    executor,
    state,
    launchGate,
    contextGate,
    closeGate,
    escapeGate,
    setGetter: (fn: () => void) => {
      onGetter = fn;
    },
    getEscape: () => escapedWork,
  };
}

it.each(['getter', 'sync', 'async'] as const)(
  'launch %s failure stays unknown after public error',
  async (launchFailure) => {
    const f = fixture({ launchFailure });
    const { drain, done } = start(() => f.executor.launchManaged());
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().unknown).toBeGreaterThan(0);
    expect(drain.snapshot().idle).toBe(false);
  },
);

it('browser stays pinned after its context is disposed until actual close settles', async () => {
  const f = fixture({ holdClose: true });
  const { drain, done, root } = start(() => f.executor.launchManaged());
  await done.finished;
  expect(done.state.value).toEqual({ ok: true });
  await f.executor.disposeCleanContext();
  drain.finish(root.owner);
  expect(drain.snapshot().idle).toBe(false);
  const first = observe(f.executor.disconnect());
  const second = observe(f.executor.disconnect());
  await flush();
  expect(first.state.done).toBe(false);
  expect(second.state.done).toBe(false);
  expect(f.state.closes).toBe(1);
  f.closeGate.release();
  await first.finished;
  await second.finished;
  expect(drain.snapshot().idle).toBe(true);
});

it.each(['getter', 'sync', 'async'] as const)(
  'close %s failure is retained, never retried or replaced',
  async (closeFailure) => {
    const f = fixture({ closeFailure });
    const { drain, done } = start(() => f.executor.launchManaged());
    await done.finished;
    const first = observe(f.executor.disconnect());
    await first.finished;
    expect(first.state.error).toBeInstanceOf(Error);
    const second = observe(f.executor.disconnect());
    await second.finished;
    expect(second.state.error).toBe(first.state.error);
    expect(drain.snapshot().unknown).toBeGreaterThan(0);
    expect(await f.executor.launchManaged()).toMatchObject({ ok: false });
    expect(f.state.launches).toBe(1);
    expect(f.state.closes).toBe(closeFailure === 'getter' ? 0 : 1);
  },
);

it.each([false, true])(
  'waits for context cleanup before browser close (context failure %s)',
  async (contextFailure) => {
    const f = fixture({ holdContext: true, contextFailure, holdClose: true });
    const { drain, done } = start(() => f.executor.launchManaged());
    await done.finished;
    const closed = observe(f.executor.disconnect());
    await flush();
    expect(f.state.closes).toBe(0);
    f.contextGate.release();
    await flush();
    expect(f.state.closes).toBe(1);
    expect(drain.snapshot().active).toBeGreaterThan(0);
    expect(closed.state.done).toBe(false);
    f.closeGate.release();
    await closed.finished;
    expect(Boolean(closed.state.error)).toBe(contextFailure);
    expect(drain.snapshot().unknown > 0).toBe(contextFailure);
  },
);

it.each(['blocked', 'unknown'] as const)(
  'bound close still executes after %s',
  async (boundary) => {
    const f = fixture({ holdClose: true });
    const drain = new ExecutionDrain();
    drain.open();
    const evidence = drain.admit('request');
    const operation = startOwnedOperation(drain, 'request', () => f.executor.launchManaged(), {
      dispatch: 'immediate',
      errorOutcome: 'known',
    });
    drain.close();
    await operation.result;
    if (boundary === 'blocked') drain.block();
    else drain.markUnknown(evidence);
    drain.finish(evidence);
    const closed = observe(f.executor.disconnect());
    await flush();
    expect(f.state.closes).toBe(1);
    expect(closed.state.done).toBe(false);
    f.closeGate.release();
    await closed.finished;
  },
);

it('seals the launch scope after ready even while browser remains pinned', async () => {
  const f = fixture();
  const { done } = start(() => f.executor.launchManaged());
  await done.finished;
  f.escapeGate.release();
  await f.getEscape()?.finished;
  expect(f.state.escaped).toBe(0);
  expect(f.getEscape()?.state.error).toBeInstanceOf(Error);
});

it('disconnect during launch waits for late browser cleanup and never creates context', async () => {
  const f = fixture({ holdLaunch: true, holdClose: true });
  const { drain, done } = start(() => f.executor.launchManaged());
  await flush();
  const closed = observe(f.executor.disconnect());
  f.launchGate.release();
  await flush();
  expect(f.state.contexts).toBe(0);
  expect(f.state.closes).toBe(1);
  expect(closed.state.done).toBe(false);
  expect(drain.snapshot().idle).toBe(false);
  f.closeGate.release();
  await closed.finished;
  await done.finished;
  expect(done.state.value).toMatchObject({ ok: false });
  expect(drain.snapshot().unknown).toBe(0);
  expect(drain.snapshot().idle).toBe(true);
});

it.each(['cancel', 'block', 'unknown'] as const)(
  'getter triggers %s before actual launch: zero SDK and no new unknown',
  async (boundary) => {
    const f = fixture();
    f.setGetter(() => {
      const lifetime = currentOperationLifetime();
      if (boundary === 'cancel') void f.executor.disposeCleanContext();
      else if (boundary === 'block') lifetime?.drain.block();
      else if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
    });
    const { drain, done } = start(() => f.executor.launchManaged());
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(f.state.launches).toBe(0);
    expect(drain.snapshot().unknown).toBe(boundary === 'unknown' ? 1 : 0);
  },
);

it('failed initialization keeps browser close failure observable on later disconnect', async () => {
  const f = fixture({ initFailure: true, closeFailure: 'async' });
  const { drain, done } = start(() => f.executor.launchManaged());
  await done.finished;
  expect(done.state.value).toMatchObject({ ok: false });
  const closed = observe(f.executor.disconnect());
  await closed.finished;
  expect(closed.state.error).toBeInstanceOf(Error);
  expect(f.state.closes).toBe(1);
  expect(drain.snapshot().unknown).toBeGreaterThan(0);
});

it('managed cleanup then external CDP disconnect closes each SDK handle only once', async () => {
  const f = fixture();
  expect(await f.executor.launchManaged()).toEqual({ ok: true });
  await f.executor.disconnect();
  expect(f.state.closes).toBe(1);
  expect(await f.executor.connect('http://synthetic.invalid')).toEqual({ ok: true });
  await f.executor.disconnect();
  expect(f.state.closes).toBe(1);
  expect(f.state.externalCloses).toBe(1);
});

it('missing launch is a known refusal and does not poison later external connection', async () => {
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => ({ contexts: () => [], close: async () => {} }) as never,
    },
  });
  executors.push(executor);
  const { drain, done } = start(() => executor.launchManaged());
  await done.finished;
  expect(done.state.value).toMatchObject({ ok: false });
  expect(drain.snapshot().unknown).toBe(0);
  expect(drain.snapshot().idle).toBe(true);
  expect(await executor.connect('http://synthetic.invalid')).toEqual({ ok: true });
});

it('unscoped close failure also retains its receipt and forbids relaunch', async () => {
  const f = fixture({ closeFailure: 'async' });
  expect(await f.executor.launchManaged()).toEqual({ ok: true });
  const first = observe(f.executor.disconnect());
  await first.finished;
  expect(first.state.error).toBeInstanceOf(Error);
  const second = observe(f.executor.disconnect());
  await second.finished;
  expect(second.state.error).toBe(first.state.error);
  expect(await f.executor.launchManaged()).toMatchObject({ ok: false });
  expect(f.state.closes).toBe(1);
  expect(f.state.launches).toBe(1);
});

it.each(['blocked', 'unknown'] as const)(
  'late launch after %s closes without creating a context',
  async (boundary) => {
    const f = fixture({ holdLaunch: true, holdClose: true });
    const drain = new ExecutionDrain();
    drain.open();
    const evidence = drain.admit('request');
    const root = startOwnedOperation(drain, 'request', () => f.executor.launchManaged(), {
      dispatch: 'immediate',
      errorOutcome: 'known',
    });
    drain.close();
    const done = observe(root.result);
    await flush();
    if (boundary === 'blocked') drain.block();
    else drain.markUnknown(evidence);
    drain.finish(evidence);
    f.launchGate.release();
    await flush();
    expect(f.state.contexts).toBe(0);
    expect(f.state.closes).toBe(1);
    expect(done.state.done).toBe(false);
    expect(drain.snapshot().active).toBeGreaterThan(0);
    f.closeGate.release();
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown).toBe(boundary === 'unknown' ? 1 : 0);
  },
);
