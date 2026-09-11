import type { BrowserContext, Request, Route } from 'playwright';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { startOwnedOperation } from '../../execution/owned-operation.js';
import { PlaywrightExecutor } from './playwright-executor.js';

// These tests isolate raw resource ordering with synthetic SDK contexts.
// Actual SDK event containment is exercised without this mock in browser-route-events.test.ts.
vi.mock('./browser-route-events.js', () => ({
  createRouteEventBoundary: () => ({ seal() {}, settled: async () => {} }),
}));

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
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
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
type Mode = 'cdp' | 'managed';
function fixture(
  mode: Mode,
  options: {
    holdCheck?: boolean;
    holdContinue?: boolean;
    holdAbort?: boolean;
    holdClose?: boolean;
    denied?: boolean;
    failContinue?: boolean;
    failAbort?: boolean;
    failClose?: boolean;
    failRegister?: boolean;
    holdRegister?: boolean;
    unowned?: boolean;
  } = {},
) {
  const check = gate();
  const continued = gate();
  const aborted = gate();
  const closed = gate();
  const registered = gate();
  const state = {
    check: 0,
    continued: 0,
    aborted: 0,
    browserClose: 0,
    contextClose: 0,
    unroute: 0,
  };
  let handler!: (route: Route, request: Request) => Promise<void>;
  const context = {
    pages: () => [],
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    addInitScript: async () => {},
    route: async (pattern: string, callback: typeof handler) => {
      expect(pattern).toBe('**/*');
      handler = callback;
      if (options.holdRegister) await registered.promise;
      if (options.failRegister) throw new Error('synthetic registration failure');
    },
    unroute: async () => {
      state.unroute++;
    },
    close: async () => {
      state.contextClose++;
    },
    cookies: async () => [],
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [context],
    newContext: async () => context,
    close: async () => {
      state.browserClose++;
      if (options.holdClose) await closed.promise;
      if (options.failClose) throw new Error('synthetic close failure');
    },
  };
  const policy = {
    check: async () => {
      state.check++;
      if (options.holdCheck) await check.promise;
      return options.denied
        ? { allowed: false as const, reason: 'private_network' as const, message: 'blocked' }
        : { allowed: true as const, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] };
    },
  };
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => browser as never,
      launch: async () => browser as never,
    },
    networkPolicy: policy,
  });
  executors.push(executor);
  const route = {
    continue: async () => {
      state.continued++;
      if (options.holdContinue) await continued.promise;
      if (options.failContinue) throw new Error('synthetic continue failure');
    },
    abort: async (code: string) => {
      expect(code).toBe('blockedbyclient');
      state.aborted++;
      if (options.holdAbort) await aborted.promise;
      if (options.failAbort) throw new Error('synthetic abort failure');
    },
  } as unknown as Route;
  const request = { url: () => 'https://synthetic.example/' } as Request;
  const drain = new ExecutionDrain();
  drain.open();
  const run = () =>
    mode === 'cdp' ? executor.connect('http://127.0.0.1:9222') : executor.launchManaged();
  const root = options.unowned
    ? { result: run() }
    : startOwnedOperation(drain, 'request', run, { dispatch: 'immediate', errorOutcome: 'known' });
  drain.close();
  return {
    executor,
    drain,
    root,
    state,
    check,
    continued,
    aborted,
    closed,
    registered,
    route,
    request,
    policy,
    browser,
    context,
    invoke: () => observe(handler(route, request)),
  };
}

for (const mode of ['cdp', 'managed'] as const) {
  it(`${mode}: waits a dispatched policy check and refuses continue after stop`, async () => {
    const f = fixture(mode, { holdCheck: true });
    expect(await f.root.result).toEqual({ ok: true });
    f.invoke();
    await flush();
    const closing = observe(f.executor.disconnect());
    await flush();
    expect(f.state.browserClose).toBe(0);
    expect(f.state.contextClose).toBe(0);
    f.check.release();
    await closing.finished;
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(1);
    expect(f.state.unroute).toBe(0);
    expect(f.drain.snapshot().idle).toBe(true);
  });
  it(`${mode}: holds raw continue beyond caller timeout before browser close`, async () => {
    const f = fixture(mode, { holdContinue: true });
    await f.root.result;
    const call = f.invoke();
    await flush();
    const closing = observe(f.executor.disconnect());
    await flush();
    expect(call.state.done).toBe(false);
    expect(closing.state.done).toBe(false);
    expect(f.state.browserClose).toBe(0);
    f.continued.release();
    await closing.finished;
    expect(f.drain.snapshot().idle).toBe(true);
  });
  it(`${mode}: allows close before pending abort but keeps its actual receipt active`, async () => {
    const f = fixture(mode, { denied: true, holdAbort: true });
    await f.root.result;
    f.invoke();
    await flush();
    const closing = observe(f.executor.disconnect());
    await flush();
    expect(f.state.browserClose).toBe(1);
    expect(closing.state.done).toBe(false);
    expect(f.drain.snapshot().idle).toBe(false);
    f.aborted.release();
    await closing.finished;
    expect(f.drain.snapshot().idle).toBe(true);
  });
  it(`${mode}: late callbacks only abort during close and dispatch nothing afterward`, async () => {
    const f = fixture(mode, { holdClose: true });
    await f.root.result;
    const closing = observe(f.executor.disconnect());
    await flush();
    await f.invoke().finished;
    expect(f.state.check).toBe(0);
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(1);
    f.closed.release();
    await closing.finished;
    const late = f.invoke();
    await late.finished;
    expect(String(late.state.error)).toContain('BROWSER_REQUEST_CLOSED');
    expect(f.state.check).toBe(0);
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(1);
  });
  it(`${mode}: actual continue failure is unknown and is never retried as abort`, async () => {
    const f = fixture(mode, { failContinue: true });
    await f.root.result;
    await f.invoke().finished;
    expect(f.state.continued).toBe(1);
    expect(f.state.aborted).toBe(0);
    expect(f.drain.snapshot().unknown).toBe(1);
    await f.executor.disconnect().catch(() => {});
    expect(f.drain.snapshot().idle).toBe(false);
  });
  it(`${mode}: actual abort failure preserves uncertainty after resource close`, async () => {
    const f = fixture(mode, { denied: true, failAbort: true });
    await f.root.result;
    await f.invoke().finished;
    expect(f.drain.snapshot().unknown).toBe(1);
    await f.executor.disconnect().catch(() => {});
    expect(f.drain.snapshot().idle).toBe(false);
  });
  it(`${mode}: blocked resource does not call policy or continue but can fail closed`, async () => {
    const f = fixture(mode);
    await f.root.result;
    f.drain.block();
    await f.invoke().finished;
    expect(f.state.check).toBe(0);
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(1);
  });
  it(`${mode}: close failure seals late callbacks and preserves the failed receipt`, async () => {
    const f = fixture(mode, { failClose: true });
    await f.root.result;
    const a = observe(f.executor.disconnect());
    await a.finished;
    const b = observe(f.executor.disconnect());
    await b.finished;
    expect(a.state.error).toBe(b.state.error);
    expect(f.state.browserClose).toBe(1);
    await f.invoke().finished;
    expect(f.state.check + f.state.continued + f.state.aborted).toBe(0);
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(f.drain.snapshot().idle).toBe(false);
  });
  it(`${mode}: failed registration still retains installed callback until real close`, async () => {
    const f = fixture(mode, { failRegister: true, holdClose: true });
    await flush();
    expect(f.state.browserClose).toBe(1);
    await f.invoke().finished;
    expect(f.state.check).toBe(0);
    expect(f.state.aborted).toBe(1);
    f.closed.release();
    expect((await f.root.result).ok).toBe(false);
    expect(f.drain.snapshot().unknown).toBe(1);
    await f.invoke().finished;
    expect(f.state.aborted).toBe(1);
  });
  it(`${mode}: waits registration RPC before physical close`, async () => {
    const f = fixture(mode, { holdRegister: true });
    await flush();
    const closing = observe(f.executor.disconnect());
    await flush();
    expect(f.state.browserClose).toBe(0);
    f.registered.release();
    await closing.finished;
    expect(f.state.browserClose).toBe(1);
    expect((await f.root.result).ok).toBe(false);
  });
  it(`${mode}: continue getter stopping the resource dispatches only abort`, async () => {
    const f = fixture(mode);
    await f.root.result;
    Object.defineProperty(f.route, 'continue', {
      get() {
        f.drain.block();
        return async () => {
          f.state.continued++;
        };
      },
    });
    await f.invoke().finished;
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(1);
  });
  it(`${mode}: refuses callback cleanup reentry before an existing close receipt`, async () => {
    const f = fixture(mode, { holdCheck: true });
    await f.root.result;
    let nested: ReturnType<typeof observe> | undefined;
    f.policy.check = async () => {
      await f.check.promise;
      nested = observe(f.executor.disconnect());
      await nested.finished;
      return { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] };
    };
    f.invoke();
    await flush();
    const closing = observe(f.executor.disconnect());
    f.check.release();
    await flush();
    expect(nested?.state.done).toBe(true);
    expect(String(nested?.state.error)).toContain('BROWSER_REQUEST_REENTRY');
    await closing.finished;
  });
  it(`${mode}: bounds callback bookkeeping and fails closed at capacity`, async () => {
    const f = fixture(mode, { holdCheck: true });
    await f.root.result;
    for (let i = 0; i < 1024; i++) f.invoke();
    await flush();
    const before = { ...f.state };
    const overflow = f.invoke();
    await overflow.finished;
    expect(String(overflow.state.error)).toContain('BROWSER_REQUEST_CAPACITY');
    expect(f.state.check).toBe(before.check);
    expect(f.state.continued).toBe(0);
    expect(f.state.aborted).toBe(0);
    expect(f.drain.snapshot().unknown).toBe(1);
    f.check.release();
    await f.executor.disconnect().catch(() => {});
    expect(f.state.continued).toBe(0);
    expect(f.drain.snapshot().idle).toBe(false);
  });
  it(`${mode}: no-drain callers retain the same stop and raw-settlement protection`, async () => {
    const f = fixture(mode, { unowned: true, holdContinue: true });
    await f.root.result;
    f.invoke();
    await flush();
    const closing = observe(f.executor.disconnect());
    await flush();
    expect(f.state.browserClose).toBe(0);
    expect(closing.state.done).toBe(false);
    f.continued.release();
    await closing.finished;
    expect(f.drain.snapshot().active).toBe(0);
  });
  for (const stage of ['registration', 'close'] as const) {
    it(`${mode}: ${stage} SDK cannot wait on its own executor cleanup`, async () => {
      const f = fixture(mode);
      const cleanupGate = gate();
      let nested: ReturnType<typeof observe> | undefined;
      const work = async () => {
        nested = observe(f.executor.disconnect());
        await Promise.race([nested.finished, cleanupGate.promise]);
      };
      if (stage === 'registration')
        f.context.route = async () => {
          await work();
          return { dispose: async () => {}, [Symbol.asyncDispose]: async () => {} };
        };
      else {
        await f.root.result;
        f.browser.close = work;
        observe(f.executor.disconnect());
      }
      await flush();
      expect(nested?.state.done).toBe(true);
      expect(String(nested?.state.error)).toContain('BROWSER_REQUEST_REENTRY');
      cleanupGate.release();
      await f.root.result;
    });
  }
}

it('uses the new CDP resource after a previous managed lease was disposed', async () => {
  const f = fixture('managed');
  expect((await f.root.result).ok).toBe(true);
  await f.executor.disconnect();
  const drain = new ExecutionDrain();
  drain.open();
  const run = startOwnedOperation(
    drain,
    'request',
    () => f.executor.connect('http://127.0.0.1:9222', { cleanContext: true }),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  drain.close();
  expect(await run.result).toEqual({ ok: true });
  await f.invoke().finished;
  expect(f.state.continued).toBe(1);
});
