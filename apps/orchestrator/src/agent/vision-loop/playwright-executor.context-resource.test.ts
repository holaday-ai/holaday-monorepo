import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import { runBrowserOperation } from './browser-operation.js';
import { PlaywrightExecutor } from './playwright-executor.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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
function gate(fail = false) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    if (fail) throw new Error('synthetic transport failure');
  });
  void wait.catch(() => {});
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
  const done = observe(root.result);
  return { drain, root, done };
}
type Mode = 'connect' | 'managed';
type Stage = 'transport' | 'acquire' | 'close' | 'cookies' | 'setter';
function fixture(
  mode: Mode,
  stage: Stage = 'close',
  failure: 'none' | 'async' | 'sync' | 'getter' = 'none',
) {
  const hold = gate(failure === 'async');
  const closeHold = gate();
  const escaped = gate();
  let captureDeferredDispatch = false;
  let escapedWork: ReturnType<typeof observe> | undefined;
  const state = { transport: 0, acquire: 0, close: 0, cookies: 0, escapedDispatch: 0 };
  let acquireLife: OperationLifetime | undefined;
  const context = {
    pages: () => [],
    addInitScript: async () => {},
    setDefaultTimeout: () => {
      if (stage === 'setter') throw new Error('synthetic setter failure');
    },
    setDefaultNavigationTimeout: () => {},
    cookies: async () => {
      state.cookies++;
      if (stage === 'cookies') await hold.wait;
      return [];
    },
  };
  Object.defineProperty(context, 'close', {
    get() {
      if (stage === 'close' && failure === 'getter')
        throw new Error('synthetic close getter failure');
      return function (this: unknown) {
        expect(this).toBe(context);
        state.close++;
        if (stage === 'close' && failure === 'sync') throw new Error('synthetic close failure');
        return (async () => {
          if (stage === 'close') await hold.wait;
          else await closeHold.wait;
        })();
      };
    },
  });
  const browser = {
    contexts: () => [],
    close: async () => {},
    newContext: async function () {
      expect(this).toBe(browser);
      state.acquire++;
      acquireLife = currentOperationLifetime();
      if (captureDeferredDispatch)
        escapedWork = observe(
          escaped.wait.then(() =>
            runBrowserOperation(async () => {
              state.escapedDispatch++;
            }),
          ),
        );
      if (stage === 'acquire') await hold.wait;
      return context;
    },
  };
  const transport = async () => {
    state.transport++;
    if (stage === 'transport') await hold.wait;
    return browser as never;
  };
  const executor = new PlaywrightExecutor({
    chromium: { connectOverCDP: transport, launch: transport },
  });
  executors.push(executor);
  const run = () =>
    mode === 'connect'
      ? executor.connect('http://synthetic.invalid', { cleanContext: true })
      : executor.launchManaged();
  return {
    executor,
    run,
    state,
    hold,
    closeHold,
    escaped,
    getLife: () => acquireLife,
    enableEscape: () => {
      captureDeferredDispatch = true;
    },
    getEscape: () => escapedWork,
  };
}

it.each(['connect', 'managed'] as const)(
  '%s resource stays pinned after ready, and repeated disposal waits for close',
  async (mode) => {
    const f = fixture(mode);
    const { drain, done } = start(f.run);
    await done.finished;
    expect(done.state.value).toEqual({ ok: true });
    expect(drain.snapshot().idle).toBe(false);
    const life = f.getLife();
    if (!life) throw new Error('missing resource owner');
    expect(drain.finish(life.owner)).toBe(false);
    const first = observe(f.executor.disposeCleanContext());
    const second = observe(f.executor.disposeCleanContext());
    await flush();
    expect(f.state.close).toBe(1);
    expect(second.state.done).toBe(false);
    f.hold.release();
    await first.finished;
    await second.finished;
    if (mode === 'managed') {
      expect(drain.snapshot().idle).toBe(false);
      await f.executor.disconnect();
    }
    expect(drain.snapshot().idle).toBe(true);
  },
);

it.each(['connect', 'managed'] as const)(
  '%s late context is disposed, never published after dispose',
  async (mode) => {
    const f = fixture(mode, 'acquire');
    const { drain, done } = start(f.run);
    await flush();
    const dispose = observe(f.executor.disposeCleanContext());
    await flush();
    expect(dispose.state.done).toBe(false);
    f.hold.release();
    await flush();
    expect(f.state.close).toBe(1);
    expect(drain.snapshot().idle).toBe(false);
    expect(dispose.state.done).toBe(false);
    f.closeHold.release();
    await dispose.finished;
    await done.finished;
    expect(dispose.state.error).toBeUndefined();
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().idle).toBe(true);
  },
);

it.each(['connect', 'managed'] as const)(
  '%s does not create context after dispose during transport',
  async (mode) => {
    const f = fixture(mode, 'transport');
    const { done } = start(f.run);
    await flush();
    const dispose = observe(f.executor.disposeCleanContext());
    f.closeHold.release();
    f.hold.release();
    await dispose.finished;
    await done.finished;
    expect(f.state.acquire).toBe(0);
    expect(done.state.value).toMatchObject({ ok: false });
  },
);

it.each(['async', 'sync', 'getter'] as const)(
  'retains %s close failure and unknown across repeated disposal',
  async (failure) => {
    const f = fixture('connect', 'close', failure);
    const { drain, done } = start(f.run);
    await done.finished;
    const first = observe(f.executor.disposeCleanContext());
    f.hold.release();
    await first.finished;
    expect(first.state.error).toBeInstanceOf(Error);
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().unknown).toBeGreaterThan(0);
    const second = observe(f.executor.disposeCleanContext());
    await second.finished;
    expect(second.state.error).toBe(first.state.error);
    expect(f.state.close).toBe(failure === 'getter' ? 0 : 1);
  },
);

it.each(['blocked', 'unknown', 'sealed', 'expired'] as const)(
  'bound disposal still works after %s without new admission',
  async (guard) => {
    const f = fixture('connect');
    const releaseCleanup = gate();
    let cleanup: ReturnType<typeof observe> | undefined;
    let unknownSource:
      | { life: OperationLifetime; owner: ReturnType<ExecutionDrain['fork']> }
      | undefined;
    const { drain, done, root } = start(() =>
      withOperationDispatchScope(async (seal) => {
        if (guard === 'unknown') {
          const life = currentOperationLifetime();
          if (!life) throw new Error('missing scope');
          unknownSource = { life, owner: life.drain.fork(life.owner, 'execution') };
        }
        const value = await f.run();
        cleanup = observe(releaseCleanup.wait.then(() => f.executor.disposeCleanContext()));
        if (guard === 'sealed') seal();
        return value;
      }),
    );
    await done.finished;
    if (guard === 'blocked') drain.block();
    if (unknownSource) {
      drain.markUnknown(unknownSource.owner);
      drain.finish(unknownSource.owner);
    }
    expect(drain.finish(root.owner)).toBe(false);
    releaseCleanup.release();
    await flush();
    expect(f.state.close).toBe(1);
    expect(cleanup?.state.done).toBe(false);
    f.hold.release();
    await cleanup?.finished;
    expect(cleanup?.state.error).toBeUndefined();
    expect(drain.snapshot().active).toBe(0);
  },
);

it('seals acquisition dispatch scope after ready while only disposal remains allowed', async () => {
  const f = fixture('connect');
  f.enableEscape();
  const { done, drain } = start(f.run);
  await done.finished;
  f.escaped.release();
  await f.getEscape()?.finished;
  expect(f.state.escapedDispatch).toBe(0);
  expect(f.getEscape()?.state.error).toBeInstanceOf(Error);
  f.hold.release();
  await f.executor.disposeCleanContext();
  expect(drain.snapshot().idle).toBe(true);
});

it.each(['connect', 'managed'] as const)(
  'rejects concurrent setup while %s acquisition is pending',
  async (mode) => {
    const f = fixture(mode, 'acquire');
    const first = observe(f.run());
    await flush();
    const second = observe(f.executor.connect('http://synthetic.invalid', { cleanContext: true }));
    const third = observe(f.executor.launchManaged());
    await flush();
    expect(second.state.done).toBe(true);
    expect(second.state.value).toMatchObject({ ok: false });
    expect(third.state.done).toBe(true);
    expect(third.state.value).toMatchObject({ ok: false });
    expect(f.state.transport).toBe(1);
    expect(f.state.acquire).toBe(1);
    f.hold.release();
    await first.finished;
    f.closeHold.release();
    await f.executor.disconnect();
  },
);

it.each(['connect', 'managed'] as const)(
  '%s initialization failure waits for its context cleanup',
  async (mode) => {
    const f = fixture(mode, 'setter');
    const { done, drain } = start(f.run);
    await flush();
    expect(f.state.close).toBe(1);
    expect(done.state.done).toBe(false);
    f.closeHold.release();
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().active).toBe(0);
  },
);

it('does not certify a context from a cookies result arriving after disposal', async () => {
  const f = fixture('connect', 'cookies');
  const run = start(async () => {
    await f.run();
    return f.executor.assertCleanContext();
  });
  await flush();
  expect(f.state.cookies).toBe(1);
  const dispose = observe(f.executor.disposeCleanContext());
  f.closeHold.release();
  await dispose.finished;
  f.hold.release();
  await run.done.finished;
  expect(run.done.state.error).toBeInstanceOf(Error);
  expect(run.drain.snapshot().active).toBe(0);
});

it('tracks raw cookies failure and still permits bound cleanup after unknown', async () => {
  const f = fixture('connect', 'cookies', 'async');
  const run = start(async () => {
    await f.run();
    return f.executor.assertCleanContext();
  });
  await flush();
  f.hold.release();
  await run.done.finished;
  expect(run.drain.snapshot().unknown).toBeGreaterThan(0);
  const dispose = observe(f.executor.disposeCleanContext());
  await flush();
  expect(f.state.close).toBe(1);
  f.closeHold.release();
  await dispose.finished;
  expect(run.drain.snapshot().active).toBe(0);
});

it('repeated disconnect waits for context cleanup even after browser reference was cleared', async () => {
  const f = fixture('managed');
  const { done } = start(f.run);
  await done.finished;
  const first = observe(f.executor.disconnect());
  const second = observe(f.executor.disconnect());
  await flush();
  expect(second.state.done).toBe(false);
  expect(f.state.close).toBe(1);
  f.hold.release();
  await first.finished;
  await second.finished;
});

it('does not replace a context whose cleanup failed', async () => {
  const f = fixture('connect', 'close', 'async');
  const { done } = start(f.run);
  await done.finished;
  const closed = observe(f.executor.disconnect());
  f.hold.release();
  await closed.finished;
  expect(closed.state.error).toBeInstanceOf(Error);
  const reconnect = await f.run();
  expect(reconnect.ok).toBe(false);
  expect(f.state.transport).toBe(1);
});

it('disconnect during pending acquisition waits for successful cancellation, not a failed cleanup', async () => {
  const f = fixture('connect', 'acquire');
  const first = observe(f.run());
  await flush();
  const stopped = observe(f.executor.disconnect());
  await flush();
  expect(stopped.state.done).toBe(false);
  f.hold.release();
  await flush();
  expect(f.state.close).toBe(1);
  f.closeHold.release();
  await first.finished;
  await stopped.finished;
  expect(first.state.value).toMatchObject({ ok: false });
  expect(stopped.state.error).toBeUndefined();
});

it('a stale dirty-cookie result cannot close a replacement context', async () => {
  const hold = gate();
  let closes = 0;
  let acquisitions = 0;
  const context = () => ({
    pages: () => [],
    setDefaultTimeout: () => {},
    setDefaultNavigationTimeout: () => {},
    close: async () => {
      closes++;
    },
    cookies: async () => {
      await hold.wait;
      return [{ domain: 'synthetic.invalid' }];
    },
  });
  const browser = {
    contexts: () => [],
    newContext: async () => {
      acquisitions++;
      return context();
    },
  };
  const executor = new PlaywrightExecutor({
    chromium: { connectOverCDP: async () => browser as never },
  });
  executors.push(executor);
  await executor.connect('http://synthetic.invalid', { cleanContext: true });
  const checked = observe(executor.assertCleanContext());
  await flush();
  await executor.disconnect();
  expect((await executor.connect('http://synthetic.invalid', { cleanContext: true })).ok).toBe(
    true,
  );
  expect(acquisitions).toBe(2);
  expect(closes).toBe(1);
  hold.release();
  await checked.finished;
  expect(checked.state.error).toBeInstanceOf(Error);
  expect(closes).toBe(1);
});

it.each(['blocked', 'unknown'] as const)(
  'disposes late acquired context after %s, without publishing it',
  async (guard) => {
    const f = fixture('connect', 'acquire');
    const { drain, done } = start(f.run);
    await flush();
    const life = f.getLife();
    if (!life) throw new Error('missing acquisition owner');
    if (guard === 'blocked') drain.block();
    else drain.markUnknown(life.owner);
    f.hold.release();
    await flush();
    expect(f.state.close).toBe(1);
    expect(done.state.done).toBe(false);
    f.closeHold.release();
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(drain.snapshot().active).toBe(0);
    expect(drain.snapshot().idle).toBe(false);
  },
);

it('managed setup hands browser cleanup to disconnect exactly once', async () => {
  let browserCloses = 0;
  let disconnect: ReturnType<typeof observe> | undefined;
  const context = {
    pages: () => [],
    close: async () => {},
    addInitScript: async () => {},
    setDefaultTimeout: () => {
      disconnect = observe(executor.disconnect());
    },
    setDefaultNavigationTimeout: () => {},
  };
  const browser = {
    contexts: () => [],
    newContext: async () => context,
    close: async () => {
      browserCloses++;
    },
  };
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => browser as never,
      launch: async () => browser as never,
    },
  });
  executors.push(executor);
  expect((await executor.launchManaged()).ok).toBe(false);
  await disconnect?.finished;
  expect(browserCloses).toBe(1);
});

it.each(
  (['connect', 'managed'] as const).flatMap((mode) =>
    [false, true].map((scoped) => ({ mode, scoped })),
  ),
)(
  '$mode disposed setup cannot dispatch later initialization SDK calls (scoped=$scoped)',
  async ({ mode, scoped }) => {
    vi.stubEnv('STEALTH_ENABLED', 'true');
    const routeHold = gate();
    const calls = { firstRoute: 0, laterRoute: 0, stealth: 0, banner: 0, close: 0 };
    const makeContext = (first: boolean) => ({
      pages: () => [
        {
          evaluate: async () => {
            calls.banner++;
          },
        },
      ],
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
      addInitScript: async () => {
        calls.stealth++;
      },
      close: async () => {
        calls.close++;
      },
      route: async () => {
        if (first) {
          calls.firstRoute++;
          await routeHold.wait;
        } else calls.laterRoute++;
      },
    });
    const first = makeContext(true);
    const second = makeContext(false);
    const browser = {
      contexts: () => [first, second],
      newContext: async () => first,
      close: async () => {},
    };
    const executor = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () => browser as never,
        launch: async () => browser as never,
      },
      networkPolicy: { check: async () => ({ allowed: true }) } as never,
    });
    executors.push(executor);
    const action = () =>
      mode === 'connect'
        ? executor.connect('http://synthetic.invalid', { cleanContext: true })
        : executor.launchManaged();
    const run = scoped ? start(action) : { done: observe(action()), drain: undefined };
    await flush();
    expect(calls.firstRoute).toBe(1);
    await executor.disposeCleanContext();
    expect(calls.close).toBe(1);
    if (run.drain) expect(run.drain.snapshot().idle).toBe(false);
    routeHold.release();
    await run.done.finished;
    expect(run.done.state.value).toMatchObject({ ok: false });
    expect(calls.laterRoute).toBe(0);
    expect(calls.stealth).toBe(0);
    expect(calls.banner).toBe(0);
  },
);

it.each(['connect', 'managed'] as const)(
  '%s stops synchronous initialization after a setter disposes the context',
  async (mode) => {
    let navigationSetters = 0;
    let routes = 0;
    const context = {
      pages: () => [],
      close: async () => {},
      addInitScript: async () => {},
      setDefaultTimeout: () => {
        observe(executor.disposeCleanContext());
      },
      setDefaultNavigationTimeout: () => {
        navigationSetters++;
      },
      route: async () => {
        routes++;
      },
    };
    const browser = {
      contexts: () => [context],
      newContext: async () => context,
      close: async () => {},
    };
    const executor = new PlaywrightExecutor({
      chromium: {
        connectOverCDP: async () => browser as never,
        launch: async () => browser as never,
      },
      networkPolicy: { check: async () => ({ allowed: true }) } as never,
    });
    executors.push(executor);
    const result =
      mode === 'connect'
        ? await executor.connect('http://synthetic.invalid', { cleanContext: true })
        : await executor.launchManaged();
    expect(result.ok).toBe(false);
    expect(navigationSetters).toBe(0);
    expect(routes).toBe(0);
  },
);

it('does not launch managed SDK after unknown arrives during deferred setup', async () => {
  const f = fixture('managed');
  f.hold.release();
  const { done } = start(async () => {
    const life = currentOperationLifetime();
    if (!life) throw new Error('missing root');
    const run = f.run();
    life.drain.markUnknown(life.owner);
    return run;
  });
  await done.finished;
  expect(done.state.value).toMatchObject({ ok: false });
  expect(f.state.transport).toBe(0);
});

it.each(['route', 'stealth', 'banner'] as const)(
  'getter-triggered disposal before %s dispatch is known cancellation',
  async (stage) => {
    vi.stubEnv('STEALTH_ENABLED', stage === 'stealth' ? 'true' : 'false');
    let dispatched = 0;
    let closes = 0;
    const page = { evaluate: async () => {} };
    const context = {
      pages: () => [page],
      close: async () => {
        closes++;
      },
      setDefaultTimeout: () => {},
      setDefaultNavigationTimeout: () => {},
      route: async () => {},
      addInitScript: async () => {},
    };
    const target = stage === 'banner' ? page : context;
    const key = stage === 'banner' ? 'evaluate' : stage === 'route' ? 'route' : 'addInitScript';
    Object.defineProperty(target, key, {
      get() {
        observe(executor.disposeCleanContext());
        return async () => {
          dispatched++;
        };
      },
    });
    const browser = { contexts: () => [context], newContext: async () => context };
    const executor = new PlaywrightExecutor({
      chromium: { connectOverCDP: async () => browser as never },
      ...(stage === 'route'
        ? { networkPolicy: { check: async () => ({ allowed: true }) } as never }
        : {}),
    });
    executors.push(executor);
    const { done, drain } = start(() =>
      executor.connect('http://synthetic.invalid', { cleanContext: true }),
    );
    await done.finished;
    expect(done.state.value).toMatchObject({ ok: false });
    expect(dispatched).toBe(0);
    expect(closes).toBe(1);
    expect(drain.snapshot().unknown).toBe(0);
    expect(drain.snapshot().idle).toBe(true);
  },
);
