import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';
import { waitForCdpReady } from './spawn.js';

const releases: Array<() => void> = [];
const pending: Promise<unknown>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  await vi.advanceTimersByTimeAsync(20_000);
  await Promise.all(pending.splice(0));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function gate(fail = false) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    if (fail) throw new Error('synthetic failure');
  });
  releases.push(release);
  void wait.catch(() => {});
  return { wait, release };
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
  pending.push(finished);
  return { state, finished };
}
function start(action = () => waitForCdpReady(9300, 100)) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(drain, 'request', action, {
    dispatch: 'immediate',
    errorOutcome: 'known',
  });
  drain.close();
  return { drain, root, done: observe(root.result) };
}
it.each(['fetch', 'json', 'cancel'] as const)(
  'holds %s after parent ACK and abort',
  async (stage) => {
    const hold = gate();
    let responseDisposed = false;
    const response = new Response(
      new ReadableStream({
        cancel: async () => {
          if (stage === 'cancel') await hold.wait;
          responseDisposed = true;
        },
      }),
      { status: stage === 'cancel' ? 503 : 200 },
    );
    if (stage !== 'cancel')
      vi.spyOn(response, 'json').mockImplementation(async () => {
        if (stage === 'json') await hold.wait;
        return { Browser: 'synthetic' };
      });
    let fetched = false;
    vi.stubGlobal('fetch', async () => {
      fetched = true;
      if (stage === 'fetch') await hold.wait;
      return response;
    });
    let operation: ReturnType<typeof observe<string>> | undefined;
    const { drain, done } = start(async () => {
      operation = observe(waitForCdpReady(9300, 100));
      await flush();
      return 'parent ACK';
    });
    await done.finished;
    expect(fetched).toBe(true);
    await vi.advanceTimersByTimeAsync(101);
    expect(drain.snapshot().active).toBeGreaterThan(0);
    expect(operation?.state.done).toBe(false);
    hold.release();
    await vi.advanceTimersByTimeAsync(1000);
    await operation?.finished;
    expect(responseDisposed).toBe(true);
    expect(drain.snapshot().active).toBe(0);
  },
);
it('keeps the request deadline armed while JSON is pending', async () => {
  const hold = gate();
  let signal: AbortSignal | undefined;
  const response = new Response('{}');
  vi.spyOn(response, 'json').mockImplementation(async () => {
    await hold.wait;
    return {};
  });
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    signal = options.signal as AbortSignal;
    return response;
  });
  const run = observe(waitForCdpReady(9300, 10_000));
  await flush();
  await vi.advanceTimersByTimeAsync(2000);
  expect(signal?.aborted).toBe(true);
  expect(run.state.done).toBe(false);
  hold.release();
  await vi.advanceTimersByTimeAsync(10_000);
  await run.finished;
  expect(vi.getTimerCount()).toBe(0);
});
it('clears the abort timer after a rejected fetch', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('synthetic refusal');
  });
  const run = observe(waitForCdpReady(9300, 10));
  await vi.advanceTimersByTimeAsync(300);
  await run.finished;
  expect(run.state.error).toBeInstanceOf(Error);
  expect(vi.getTimerCount()).toBe(0);
});
it('disposes a non-success body before retrying', async () => {
  const hold = gate();
  let calls = 0;
  let disposed = false;
  vi.stubGlobal('fetch', async () => {
    calls++;
    if (calls === 1)
      return new Response(
        new ReadableStream({
          cancel: async () => {
            await hold.wait;
            disposed = true;
          },
        }),
        { status: 503 },
      );
    expect(disposed).toBe(true);
    return Response.json({ Browser: 'synthetic-ready' });
  });
  const run = observe(waitForCdpReady(9300, 10_000));
  await flush();
  await vi.advanceTimersByTimeAsync(500);
  expect(calls).toBe(1);
  hold.release();
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  await run.finished;
  expect(run.state.value).toBe('synthetic-ready');
});
it('retains uncertainty and never retries after failed body cancellation', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    return new Response(
      new ReadableStream({ cancel: () => Promise.reject(new Error('synthetic disposal failure')) }),
      { status: 503 },
    );
  });
  const { drain, done } = start();
  await vi.advanceTimersByTimeAsync(1000);
  await done.finished;
  expect(done.state.error).toBeInstanceOf(Error);
  expect(drain.snapshot().unknown).toBeGreaterThan(0);
  expect(drain.snapshot().active).toBe(0);
  expect(calls).toBe(1);
});
it.each(['blocked', 'unknown'] as const)(
  'still disposes acquired response after %s',
  async (mode) => {
    const hold = gate();
    let disposed = false;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      await hold.wait;
      return new Response(
        new ReadableStream({
          cancel: () => {
            disposed = true;
          },
        }),
        { status: 503 },
      );
    });
    const { drain, root, done } = start();
    await flush();
    if (mode === 'blocked') drain.block();
    else drain.markUnknown(root.owner);
    hold.release();
    await vi.advanceTimersByTimeAsync(1000);
    await done.finished;
    expect(disposed).toBe(true);
    expect(calls).toBe(1);
    expect(drain.snapshot().idle).toBe(false);
  },
);
it.each(['unknown', 'sealed', 'expired'] as const)(
  'rejects %s scope before fetch',
  async (mode) => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return Response.json({});
    });
    const release = gate();
    let later: ReturnType<typeof observe> | undefined;
    const { drain, done } = start(async () => {
      const life = currentOperationLifetime();
      if (!life) throw new Error('missing scope');
      if (mode === 'unknown') life.drain.markUnknown(life.owner);
      if (mode === 'expired') {
        later = observe(release.wait.then(() => waitForCdpReady(9300, 10)));
        return 'ACK';
      }
      return withOperationDispatchScope(async (seal) => {
        if (mode === 'sealed') seal();
        return waitForCdpReady(9300, 10);
      });
    });
    await done.finished;
    release.release();
    await later?.finished;
    expect(calls).toBe(0);
    expect(drain.snapshot().active).toBe(0);
  },
);
it('pins the retry delay and completes known read failures without unknown', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    if (calls === 1) throw new Error('synthetic refused');
    return Response.json({ Browser: 'ready' });
  });
  const { drain, done } = start(() => waitForCdpReady(9300, 1000));
  await flush();
  expect(drain.snapshot().active).toBeGreaterThan(1);
  await vi.advanceTimersByTimeAsync(250);
  await done.finished;
  expect(done.state.value).toBe('ready');
  expect(drain.snapshot().idle).toBe(true);
});
it('uses only a loopback read and refuses redirect following', async () => {
  let request: { url: string; options: RequestInit } | undefined;
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    request = { url, options };
    return Response.json({ Browser: 'ready' });
  });
  expect(await waitForCdpReady(9300)).toBe('ready');
  expect(request?.url).toBe('http://127.0.0.1:9300/json/version');
  expect(request?.options.redirect).toBe('error');
});
it('keeps the missing Browser fallback and leaves no timer', async () => {
  vi.stubGlobal('fetch', async () => Response.json({}));
  expect(await waitForCdpReady(9300)).toBe('unknown');
  expect(vi.getTimerCount()).toBe(0);
});
it('gives the response and JSON separate pins while cancellation retains the response pin', async () => {
  const json = gate();
  const disposal = gate();
  let fetchLife: ReturnType<typeof currentOperationLifetime>;
  let jsonLife: ReturnType<typeof currentOperationLifetime>;
  let cancelLife: ReturnType<typeof currentOperationLifetime>;
  const response = new Response(
    new ReadableStream({
      cancel: async () => {
        cancelLife = currentOperationLifetime();
        await disposal.wait;
      },
    }),
  );
  vi.spyOn(response, 'json').mockImplementation(async () => {
    jsonLife = currentOperationLifetime();
    await json.wait;
    return { Browser: 'ready' };
  });
  vi.stubGlobal('fetch', async () => {
    fetchLife = currentOperationLifetime();
    return response;
  });
  const { drain, root, done } = start();
  await flush();
  expect(fetchLife?.owner).toBeDefined();
  expect(jsonLife?.owner).toBeDefined();
  expect(fetchLife?.owner).not.toBe(root.owner);
  expect(jsonLife?.owner).not.toBe(fetchLife?.owner);
  if (!fetchLife || !jsonLife) throw new Error('missing raw scopes');
  expect(drain.finish(fetchLife.owner)).toBe(false);
  expect(drain.finish(jsonLife.owner)).toBe(false);
  json.release();
  await flush();
  expect(cancelLife?.owner).toBe(fetchLife.owner);
  expect(done.state.done).toBe(false);
  disposal.release();
  await done.finished;
  expect(done.state.value).toBe('ready');
  expect(drain.snapshot().idle).toBe(true);
});
it.each(['json', 'cancel'] as const)(
  'rejects late %s success after the total deadline',
  async (stage) => {
    const hold = gate();
    const response = new Response(
      new ReadableStream({
        cancel: async () => {
          if (stage === 'cancel') await hold.wait;
        },
      }),
    );
    vi.spyOn(response, 'json').mockImplementation(async () => {
      if (stage === 'json') await hold.wait;
      return { Browser: 'too-late' };
    });
    vi.stubGlobal('fetch', async () => response);
    const { drain, done } = start();
    await flush();
    await vi.advanceTimersByTimeAsync(101);
    expect(done.state.done).toBe(false);
    hold.release();
    await done.finished;
    expect(done.state.error).toBeInstanceOf(Error);
    expect(done.state.value).toBeUndefined();
    expect(drain.snapshot().idle).toBe(true);
  },
);
it('does not trust an overdue response when the timer callback has not run', async () => {
  const response = new Response('{}');
  vi.spyOn(response, 'json').mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 101);
    return { Browser: 'too-late' };
  });
  vi.stubGlobal('fetch', async () => response);
  const run = observe(waitForCdpReady(9300, 100));
  await run.finished;
  expect(run.state.error).toBeInstanceOf(Error);
  expect(vi.getTimerCount()).toBe(0);
});
it('retries an expired attempt instead of returning its stale version', async () => {
  const hold = gate();
  let calls = 0;
  const stale = new Response('{}');
  vi.spyOn(stale, 'json').mockImplementation(async () => {
    await hold.wait;
    return { Browser: 'stale' };
  });
  vi.stubGlobal('fetch', async () => (++calls === 1 ? stale : Response.json({ Browser: 'fresh' })));
  const run = observe(waitForCdpReady(9300, 10_000));
  await flush();
  await vi.advanceTimersByTimeAsync(2001);
  hold.release();
  await flush();
  await vi.advanceTimersByTimeAsync(250);
  await run.finished;
  expect(run.state.value).toBe('fresh');
  expect(calls).toBe(2);
});
it.each([
  { port: '9300@remote.invalid', budget: 100 },
  { port: 0, budget: 100 },
  { port: 65536, budget: 100 },
  { port: 9300.5, budget: 100 },
  { port: Number.NaN, budget: 100 },
  { port: 9300, budget: Number.POSITIVE_INFINITY },
  { port: 9300, budget: '100' },
  { port: 9300, budget: 0 },
  { port: 9300, budget: -1 },
  { port: 9300, budget: Number.NaN },
])('rejects invalid port/budget before IO and child reservation: %j', async ({ port, budget }) => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    return Response.json({});
  });
  let childDelta = -1;
  const { done } = start(async () => {
    const life = currentOperationLifetime();
    if (!life) throw new Error('missing scope');
    const before = life.drain.snapshot().active;
    const result = waitForCdpReady(port as number, budget as number);
    childDelta = life.drain.snapshot().active - before;
    return result;
  });
  // Bad implementations may have started a timer; advance it rather than hang.
  await vi.advanceTimersByTimeAsync(300);
  await done.finished;
  expect(done.state.error).toBeInstanceOf(Error);
  expect(calls).toBe(0);
  expect(childDelta).toBe(0);
});
it('never coerces an object into the fixed target URL', async () => {
  let coerced = false;
  let calls = 0;
  const port = {
    toString: () => {
      coerced = true;
      return '9300';
    },
  };
  vi.stubGlobal('fetch', async () => {
    calls++;
    return Response.json({});
  });
  const run = observe(waitForCdpReady(port as never, 100));
  await run.finished;
  expect(run.state.error).toBeInstanceOf(Error);
  expect(coerced).toBe(false);
  expect(calls).toBe(0);
});
