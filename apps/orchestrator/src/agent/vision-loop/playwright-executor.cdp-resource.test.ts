import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';

// This suite's Browser.close is synthetic; real close receipts are tested separately.
vi.mock('./browser-close-receipt.js', () => ({
  bindBrowserCloseReceipt: (browser: { close(): Promise<void> }) => () => browser.close(),
}));
import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
import { PlaywrightExecutor } from './playwright-executor.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
const releases: Array<() => void> = [];
const executors: PlaywrightExecutor[] = [];
const pending: Promise<unknown>[] = [];
beforeEach(() => vi.stubEnv('STEALTH_ENABLED', 'false'));
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  for (const executor of executors.splice(0)) await executor.disconnect().catch(() => {});
  await Promise.allSettled(pending.splice(0));
  vi.unstubAllEnvs();
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
function fixture(
  opts: {
    holdConnect?: boolean;
    holdClose?: boolean;
    holdContext?: boolean;
    closeFailure?: 'getter' | 'sync' | 'async';
    contextFailure?: boolean;
    emptySecond?: boolean;
  } = {},
) {
  const connectGate = gate();
  const closeGate = gate();
  const contextGate = gate();
  const state = {
    connects: 0,
    closes: [0, 0],
    defaultCloses: 0,
    pageCloses: 0,
    newContexts: 0,
    cleanCloses: 0,
    stale: false,
  };
  let onValidation = () => {};
  let onConnectGetter = () => {};
  const page = {
    url: () => 'about:blank',
    isClosed: () => false,
    evaluate: async () => 1,
    close: async () => {
      state.pageCloses++;
    },
  };
  const sharedContext = {
    pages: () => [page],
    close: async () => {
      state.defaultCloses++;
    },
  };
  const cleanContext = {
    pages: () => [page],
    cookies: async () => [],
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    close: async () => {
      state.cleanCloses++;
      if (opts.holdContext) await contextGate.wait;
      if (opts.contextFailure) throw new Error('synthetic context close failure');
    },
  };
  function browser(index: number) {
    let contextReads = 0;
    const b = {
      contexts: () => {
        contextReads++;
        if (index === 1 && contextReads === 2) onValidation();
        return (index === 0 && state.stale) || (index === 1 && opts.emptySecond)
          ? []
          : [sharedContext];
      },
      newContext: async () => {
        state.newContexts++;
        return cleanContext;
      },
    };
    Object.defineProperty(b, 'close', {
      get() {
        if (opts.closeFailure === 'getter') throw new Error('synthetic close getter');
        return function (this: unknown) {
          expect(this).toBe(b);
          state.closes[index] = (state.closes[index] ?? 0) + 1;
          if (opts.closeFailure === 'sync') throw new Error('synthetic close sync');
          return (async () => {
            if (opts.holdClose && index === 0) await closeGate.wait;
            if (opts.closeFailure === 'async') throw new Error('synthetic close async');
          })();
        };
      },
    });
    return b;
  }
  const browsers = [browser(0), browser(1)];
  const chromium = {
    connectOverCDP: async function (this: unknown, endpoint: string) {
      expect(this).toBe(chromium);
      expect(endpoint).toBe('http://synthetic.invalid');
      const index = state.connects++;
      if (opts.holdConnect) await connectGate.wait;
      return browsers[index] as never;
    },
  };
  const connect = chromium.connectOverCDP;
  Object.defineProperty(chromium, 'connectOverCDP', {
    get() {
      onConnectGetter();
      return connect;
    },
  });
  const executor = new PlaywrightExecutor({ chromium });
  executors.push(executor);
  return {
    executor,
    state,
    connectGate,
    closeGate,
    contextGate,
    page,
    setValidation: (fn: () => void) => {
      onValidation = fn;
    },
    setConnectGetter: (fn: () => void) => {
      onConnectGetter = fn;
    },
    run: (cleanContext = false) => executor.connect('http://synthetic.invalid', { cleanContext }),
  };
}

it.each([false, true])('CDP connection remains pinned after ready (clean=%s)', async (clean) => {
  const f = fixture({ holdClose: true });
  const { drain, done } = start(() => f.run(clean));
  await done.finished;
  if (clean) await f.executor.disposeCleanContext();
  expect(drain.snapshot().idle).toBe(false);
  const a = observe(f.executor.disconnect());
  const b = observe(f.executor.disconnect());
  await flush();
  expect(a.state.done).toBe(false);
  expect(b.state.done).toBe(false);
  expect(f.state.closes).toEqual([1, 0]);
  f.closeGate.release();
  await a.finished;
  await b.finished;
  expect(drain.snapshot().idle).toBe(true);
  expect(f.state.defaultCloses).toBe(0);
  expect(f.state.pageCloses).toBe(0);
});
it.each(['getter', 'sync', 'async'] as const)(
  'connection close %s failure persists and prevents reconnect',
  async (closeFailure) => {
    const f = fixture({ closeFailure });
    const { drain, done } = start(() => f.run());
    await done.finished;
    const a = observe(f.executor.disconnect());
    await a.finished;
    expect(a.state.error).toBeInstanceOf(Error);
    const b = observe(f.executor.disconnect());
    await b.finished;
    expect(b.state.error).toBe(a.state.error);
    expect(drain.snapshot().unknown).toBeGreaterThan(0);
    expect(await f.run()).toMatchObject({ ok: false });
    expect(f.state.connects).toBe(1);
  },
);
it.each([false, true])(
  'context settles before CDP close even when context fails=%s',
  async (contextFailure) => {
    const f = fixture({ holdContext: true, holdClose: true, contextFailure });
    const { drain, done } = start(() => f.run(true));
    await done.finished;
    const close = observe(f.executor.disconnect());
    await flush();
    expect(f.state.closes[0]).toBe(0);
    f.contextGate.release();
    await flush();
    expect(f.state.closes[0]).toBe(1);
    expect(close.state.done).toBe(false);
    expect(drain.snapshot().active).toBeGreaterThan(0);
    f.closeGate.release();
    await close.finished;
    expect(Boolean(close.state.error)).toBe(contextFailure);
  },
);
it('late CDP acquisition after disconnect is closed without creating a context', async () => {
  const f = fixture({ holdConnect: true, holdClose: true });
  const { drain, done } = start(() => f.run(true));
  await flush();
  const close = observe(f.executor.disconnect());
  f.connectGate.release();
  await flush();
  expect(f.state.newContexts).toBe(0);
  expect(f.state.closes[0]).toBe(1);
  expect(close.state.done).toBe(false);
  f.closeGate.release();
  await done.finished;
  await close.finished;
  expect(done.state.value).toMatchObject({ ok: false });
  expect(drain.snapshot().idle).toBe(true);
});
it.each([false, true])(
  'stale recovery waits for old connection close (scoped=%s)',
  async (scoped) => {
    const f = fixture({ holdClose: true });
    await f.run();
    f.state.stale = true;
    const run = scoped
      ? start(() => f.executor.getPage())
      : { done: observe(f.executor.getPage()) };
    await flush();
    expect(f.state.connects).toBe(1);
    expect(f.state.closes[0]).toBe(1);
    expect(run.done.state.done).toBe(false);
    f.closeGate.release();
    await run.done.finished;
    expect(run.done.state.value).toBe(f.page);
    expect(f.state.connects).toBe(2);
    await f.executor.disconnect();
    expect(f.state.closes).toEqual([1, 1]);
    expect(f.state.defaultCloses).toBe(0);
  },
);
it('failed stale cleanup refuses redial instead of discarding the old resource', async () => {
  const f = fixture({ closeFailure: 'async' });
  await f.run();
  f.state.stale = true;
  const run = start(() => f.executor.getPage());
  await run.done.finished;
  expect(run.done.state.error).toBeInstanceOf(Error);
  expect(f.state.connects).toBe(1);
});
it('disconnect during stale cleanup prevents any later redial or resurrection', async () => {
  const f = fixture({ holdClose: true });
  await f.run();
  f.state.stale = true;
  const task = observe(f.executor.getPage());
  await flush();
  const close = observe(f.executor.disconnect());
  f.closeGate.release();
  await task.finished;
  await close.finished;
  expect(task.state.error).toBeInstanceOf(Error);
  expect(f.state.connects).toBe(1);
  await expect(f.executor.getPage()).rejects.toThrow();
});
it('a redial with no contexts disposes its new connection before reporting failure', async () => {
  const f = fixture({ emptySecond: true });
  await f.run();
  f.state.stale = true;
  const task = observe(f.executor.getPage());
  await task.finished;
  expect(task.state.error).toBeInstanceOf(Error);
  expect(f.state.closes).toEqual([1, 1]);
});

it('lost clean context refuses automatic redial into the external default context', async () => {
  const f = fixture();
  await f.run(true);
  await f.executor.disposeCleanContext();
  const task = observe(f.executor.getPage());
  await task.finished;
  expect(task.state.error).toBeInstanceOf(Error);
  expect(f.state.connects).toBe(1);
  expect(f.state.defaultCloses).toBe(0);
  expect(f.state.pageCloses).toBe(0);
});

it('explicit external connect after managed disconnect uses the new default context', async () => {
  const page = { url: () => 'about:blank', evaluate: async () => 1, isClosed: () => false };
  const clean = { setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, close: async () => {} };
  const executor = new PlaywrightExecutor({
    chromium: {
      launch: async () =>
        ({ contexts: () => [], newContext: async () => clean, close: async () => {} }) as never,
      connectOverCDP: async () =>
        ({ contexts: () => [{ pages: () => [page] }], close: async () => {} }) as never,
    },
  });
  executors.push(executor);
  expect(await executor.launchManaged()).toEqual({ ok: true });
  await executor.disconnect();
  expect(await executor.connect('http://synthetic.invalid')).toEqual({ ok: true });
  expect(await executor.getPage()).toBe(page);
});

it('redial validation is still locked and cancellation closes only its captured connection', async () => {
  const f = fixture();
  await f.run();
  f.state.stale = true;
  let competing: ReturnType<typeof observe> | undefined;
  let closing: ReturnType<typeof observe> | undefined;
  f.setValidation(() => {
    competing = observe(f.run());
    closing = observe(f.executor.disconnect());
  });
  const task = observe(f.executor.getPage());
  await task.finished;
  await competing?.finished;
  await closing?.finished;
  expect(competing).toBeDefined();
  expect(competing?.state.value).toMatchObject({ ok: false });
  expect(task.state.error).toBeInstanceOf(Error);
  expect(closing?.state.error).toBeUndefined();
  expect(f.state.connects).toBe(2);
  expect(f.state.closes).toEqual([1, 1]);
  expect(f.state.defaultCloses).toBe(0);
  expect(f.state.pageCloses).toBe(0);
});

it.each(['cancel', 'blocked', 'unknown'] as const)(
  'getter triggers %s before CDP SDK: no physical dispatch',
  async (boundary) => {
    const f = fixture();
    f.setConnectGetter(() => {
      const life = currentOperationLifetime();
      if (boundary === 'cancel') observe(f.executor.disposeCleanContext());
      else if (boundary === 'blocked') life?.drain.block();
      else if (life) life.drain.markUnknown(life.owner);
    });
    const { drain, done } = start(() => f.run());
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(f.state.connects).toBe(0);
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown).toBe(boundary === 'unknown' ? 1 : 0);
  },
);

it.each(['blocked', 'unknown'] as const)(
  'late CDP after %s is closed but not published',
  async (boundary) => {
    const f = fixture({ holdConnect: true, holdClose: true });
    const drain = new ExecutionDrain();
    drain.open();
    const evidence = drain.admit('request');
    const root = startOwnedOperation(drain, 'request', () => f.run(true), {
      dispatch: 'immediate',
      errorOutcome: 'known',
    });
    drain.close();
    const done = observe(root.result);
    await flush();
    if (boundary === 'blocked') drain.block();
    else drain.markUnknown(evidence);
    drain.finish(evidence);
    f.connectGate.release();
    await flush();
    expect(f.state.closes[0]).toBe(1);
    expect(f.state.newContexts).toBe(0);
    expect(done.state.done).toBe(false);
    f.closeGate.release();
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown).toBe(boundary === 'unknown' ? 1 : 0);
  },
);
