import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser } from 'playwright';
import { expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { startOwnedOperation } from '../../execution/owned-operation.js';
import type { BrowserNetworkPolicy } from '../browser-network-policy.js';
import { createRouteEventBoundary } from './browser-route-events.js';
import { createOwnedCdpConnection } from './owned-cdp-connection.js';
import { createOwnedManagedBrowser } from './owned-managed-browser.js';

const warnings = vi.hoisted(() => vi.fn());
vi.mock('../../config/logger.js', () => ({ logger: { warn: warnings } }));

// Actual pinned client SDK events; driver responses and owned Browser.close are synthetic.
const require = createRequire(import.meta.url);
const sdk = path.dirname(require.resolve('playwright/package.json'));
const core = path.dirname(require.resolve('playwright-core/package.json', { paths: [sdk] }));
const { Connection } = require(path.join(core, 'lib/client/connection.js'));
const { Browser: SdkBrowser } = require(path.join(core, 'lib/client/browser.js'));
const { BrowserContext } = require(path.join(core, 'lib/client/browserContext.js'));
const { Request, Route } = require(path.join(core, 'lib/client/network.js'));
const { Worker } = require(path.join(core, 'lib/client/worker.js'));
const { nodePlatform } = require(path.join(core, 'lib/server/utils/nodePlatform.js'));
async function flush() {
  for (let i = 0; i < 150; i++) await Promise.resolve();
}
function fixture(fail = false, hold?: { method: string; promise: Promise<void> }) {
  const connection = new Connection(nodePlatform);
  const browser = new SdkBrowser(connection._rootObject, 'Browser', 'synthetic-browser', {
    name: 'chromium',
    browserName: 'chromium',
    version: 'synthetic',
  });
  const calls: string[] = [];
  connection.onmessage = (message: { id: number; method: string }) => {
    calls.push(message.method);
    const respond = () =>
      connection.dispatch(
        fail && message.method === (hold?.method ?? 'abort')
          ? {
              id: message.id,
              error: {
                error: { name: 'Error', message: 'synthetic abort failure', stack: 'synthetic' },
              },
            }
          : { id: message.id, result: {} },
      );
    if (hold?.method === message.method) void hold.promise.then(respond);
    else queueMicrotask(respond);
  };
  let contextCount = 0;
  const addContext = () => {
    const context = new BrowserContext(
      browser,
      'BrowserContext',
      `synthetic-context-${++contextCount}`,
      {
        options: {},
        debugger: { _object: {} },
        tracing: { _object: {} },
        requestContext: { _object: {} },
      },
    );
    browser._channel.emit('context', { context: context._channel });
    return context;
  };
  const context = addContext();
  let count = 0;
  const emit = (target = context, withWorker = false) => {
    const id = ++count;
    const worker = withWorker
      ? new Worker(target, 'Worker', `worker-${id}`, { url: 'https://synthetic.example/worker' })
      : undefined;
    const request = new Request(target, 'Request', `request-${id}`, {
      url: 'https://synthetic.example/',
      resourceType: 'document',
      method: 'GET',
      headers: [],
      isNavigationRequest: false,
      serviceWorker: worker?._channel,
    });
    const route = new Route(request, 'Route', `route-${id}`, { request: request._channel });
    target._channel.emit('route', { route: route._channel });
    return { route, request, worker };
  };
  return { connection, browser, context, calls, emit, addContext };
}

it('contains real RouteHandler and EventEmitter rejection without global handlers', async () => {
  const f = fixture(true);
  let errors = 0;
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {
      errors++;
    },
  );
  await f.context.route('**/*', (route: { abort(code: string): Promise<void> }) =>
    route.abort('blockedbyclient'),
  );
  f.emit();
  await flush();
  boundary.seal();
  await expect(boundary.settled()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(errors).toBe(1);
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort']);
  expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  expect(f.context._routes[0]._activeInvocations.size).toBe(0);
});

for (const mode of ['cdp', 'managed'] as const) {
  for (const method of ['abort', 'continue'] as const) {
    for (const outcome of ['success', 'error', 'disconnect'] as const) {
      it(`${mode} ${method}: retains raw driver receipt after real target-close race (${outcome})`, async () => {
        let release!: () => void;
        const promise = new Promise<void>((resolve) => {
          release = resolve;
        });
        const f = fixture(outcome === 'error', { method, promise });
        const o = await ownedFixture(f, mode, {
          check: async () =>
            method === 'continue'
              ? { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] }
              : { allowed: false, reason: 'private_network', message: 'synthetic' },
        });
        const event = f.emit(f.context, true);
        await flush();
        event.worker._channel.emit('close');
        await flush();
        expect(f.connection._callbacks.size).toBe(1);
        let done = false;
        let failure: unknown;
        const closing = o.lease.dispose().then(
          () => {
            done = true;
          },
          (error: unknown) => {
            failure = error;
            done = true;
          },
        );
        try {
          await flush();
          expect(o.closed()).toBe(1);
          expect(done).toBe(false);
          expect(o.drain.snapshot().idle).toBe(false);
          if (outcome === 'disconnect') f.connection.close('synthetic disconnect');
        } finally {
          release();
          await closing;
          await flush();
        }
        expect(f.calls).toEqual(['setNetworkInterceptionPatterns', method]);
        expect(f.connection._callbacks.size).toBe(0);
        if (outcome === 'success') {
          expect(failure).toBeUndefined();
          expect(o.drain.snapshot().idle).toBe(true);
        } else {
          expect(String(failure)).toContain('BROWSER_ROUTE_EVENT_FAILED');
          expect(o.drain.snapshot().unknown).toBe(1);
          expect(o.drain.snapshot().idle).toBe(false);
        }
      });
    }
  }
}

it.each(['foreign-parent', 'cycle', 'unknown-race'] as const)(
  'rejects %s before original SDK request dispatch',
  async (kind) => {
    const f = fixture();
    const o = await ownedFixture(f);
    const event = f.emit();
    if (kind === 'foreign-parent') event.request._parent = fixture().context;
    if (kind === 'cycle') event.request._parent = event.request;
    if (kind === 'unknown-race') event.route._raceWithTargetClose = async () => {};
    await flush();
    await o.lease.dispose().catch(() => {});
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
    expect(o.drain.snapshot().unknown).toBe(1);
  },
);

it('raw driver work retains event capacity even after every target has closed', async () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, { method: 'abort', promise });
  const o = await ownedFixture(f);
  const events = Array.from({ length: 1024 }, () => f.emit(f.context, true));
  let closing: Promise<unknown> | undefined;
  try {
    await flush();
    for (const event of events) event.worker._channel.emit('close');
    await flush();
    expect(f.connection._callbacks.size).toBe(1024);
    const overflow = f.emit(f.context, true);
    await flush();
    overflow.worker._channel.emit('close');
    expect(f.calls.filter((method) => method === 'abort')).toHaveLength(1024);
    expect(o.drain.snapshot().unknown).toBe(1);
  } finally {
    closing = o.lease.dispose().catch(() => {});
    release();
    await closing;
  }
  expect(f.connection._callbacks.size).toBe(0);
  expect(o.drain.snapshot().idle).toBe(false);
});

it('pending raw abort cannot submit a second public route action', async () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, { method: 'abort', promise });
  const o = await ownedFixture(f);
  const event = f.emit();
  await flush();
  try {
    await expect(event.route.continue()).rejects.toThrow();
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort']);
  } finally {
    release();
    await o.lease.dispose().catch(() => {});
  }
});

it.each([false, true])(
  'settled route rejects a late public action without another driver call (first failure=%s)',
  async (fail) => {
    const f = fixture(fail);
    const o = await ownedFixture(f);
    const event = f.emit();
    await flush();
    await o.lease.dispose().catch(() => {});
    await expect(event.route.continue()).rejects.toThrow();
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort']);
    expect(o.drain.snapshot().unknown).toBe(fail ? 1 : 0);
    expect(o.drain.snapshot().idle).toBe(!fail);
  },
);

it.each(['channel', 'parent', 'race'] as const)(
  'rechecks route %s before a delayed public dispatch',
  async (kind) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture();
    const o = await ownedFixture(f, 'cdp', {
      check: async () => {
        await held;
        return { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] };
      },
    });
    const event = f.emit();
    await flush();
    if (kind === 'channel') event.route._channel = new Proxy(event.route._channel, {});
    if (kind === 'parent') event.request._parent = fixture().context;
    if (kind === 'race') event.route._raceWithTargetClose = async () => {};
    release();
    await flush();
    await o.lease.dispose().catch(() => {});
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
    expect(o.drain.snapshot().unknown).toBe(1);
  },
);

it('duplicate route event cannot start a second SDK dispatch while its first receipt is pending', async () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, { method: 'abort', promise });
  const o = await ownedFixture(f);
  const event = f.emit();
  f.context._channel.emit('route', { route: event.route._channel });
  try {
    await flush();
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort']);
    expect(o.drain.snapshot().unknown).toBe(1);
  } finally {
    release();
    await o.lease.dispose().catch(() => {});
  }
  expect(f.connection._callbacks.size).toBe(0);
});

it('throwing terminal validation cannot leave a public delegate active after disposal', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture();
  const o = await ownedFixture(f, 'cdp', {
    check: async () => {
      await held;
      return { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] };
    },
  });
  const event = f.emit();
  await flush();
  Object.defineProperty(event.route, '_innerContinue', {
    configurable: true,
    get: () => {
      throw new Error('synthetic getter failure');
    },
  });
  release();
  await flush();
  await o.lease.dispose().catch(() => {});
  Object.defineProperty(event.route, '_innerContinue', {
    configurable: true,
    writable: true,
    value: Route.prototype._innerContinue,
  });
  await expect(event.route.abort()).rejects.toThrow('BROWSER_ROUTE_ACTION_UNAVAILABLE');
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
  expect(o.drain.snapshot().unknown).toBe(1);
});

it('listener failure is reported immediately while its raw receipt is still held', async () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, { method: 'abort', promise });
  let errors = 0;
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {
      errors++;
    },
  );
  await f.context.route('**/*', (route: { abort(): Promise<void> }) => {
    void route.abort().catch(() => {});
    throw new Error('synthetic listener failure');
  });
  f.emit();
  await flush();
  boundary.seal();
  let done = false;
  const settling = boundary.settled().then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  try {
    await flush();
    expect(errors).toBe(1);
    expect(f.connection._callbacks.size).toBe(1);
    expect(done).toBe(false);
  } finally {
    release();
    await settling;
  }
  expect(errors).toBe(1);
  expect(f.connection._callbacks.size).toBe(0);
});

it('one failed event marks unknown immediately without releasing another pending event', async () => {
  const f = fixture();
  let respond!: () => void;
  f.connection.onmessage = (message: { id: number; method: string }) => {
    f.calls.push(message.method);
    if (message.method === 'continue')
      respond = () => f.connection.dispatch({ id: message.id, result: {} });
    else
      queueMicrotask(() =>
        f.connection.dispatch(
          message.method === 'abort'
            ? {
                id: message.id,
                error: {
                  error: { name: 'Error', message: 'synthetic failure', stack: 'synthetic' },
                },
              }
            : { id: message.id, result: {} },
        ),
      );
  };
  let checks = 0;
  const o = await ownedFixture(f, 'cdp', {
    check: async () =>
      ++checks === 1
        ? { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] }
        : { allowed: false, reason: 'private_network', message: 'synthetic' },
  });
  const pending = f.emit(f.context, true);
  await flush();
  pending.worker._channel.emit('close');
  await flush();
  f.emit();
  await flush();
  let done = false;
  const closing = o.lease
    .dispose()
    .catch(() => {})
    .then(() => {
      done = true;
    });
  try {
    await flush();
    expect(o.drain.snapshot().unknown).toBe(1);
    expect(done).toBe(false);
    expect(f.connection._callbacks.size).toBe(1);
  } finally {
    respond();
    await closing;
  }
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'continue', 'abort']);
  expect(o.drain.snapshot().idle).toBe(false);
  expect(f.connection._callbacks.size).toBe(0);
});

async function ownedFixture(
  f: ReturnType<typeof fixture>,
  mode: 'cdp' | 'managed' = 'cdp',
  policy: Pick<BrowserNetworkPolicy, 'check'> = {
    check: async () => ({ allowed: false, reason: 'private_network', message: 'synthetic' }),
  },
) {
  const drain = new ExecutionDrain();
  drain.open();
  let closed = 0;
  const browser = f.browser as Browser;
  browser.close = async () => {
    closed++;
  };
  const root = startOwnedOperation(
    drain,
    'request',
    async () =>
      mode === 'cdp'
        ? createOwnedCdpConnection({ connectOverCDP: async () => browser }, 'synthetic', () => true)
        : createOwnedManagedBrowser({ launch: async () => browser }, {}, () => true),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  const lease = await root.result;
  await lease.ready;
  drain.close();
  await lease.guardContext(f.context, policy);
  return { drain, lease, closed: () => closed };
}

it.each(['cdp', 'managed'] as const)(
  '%s resource contains actual SDK event failure and retains unknown after physical close',
  async (mode) => {
    const f = fixture(true);
    const o = await ownedFixture(f, mode);
    f.emit();
    await flush();
    await expect(o.lease.dispose()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(o.closed()).toBe(1);
    expect(o.drain.snapshot().unknown).toBe(1);
    expect(o.drain.snapshot().idle).toBe(false);
    expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  },
);

it.each(['cdp', 'managed'] as const)(
  '%s resource seals actual SDK event entry after close without creating late SDK handling',
  async (mode) => {
    const f = fixture();
    const o = await ownedFixture(f, mode);
    await o.lease.dispose();
    f.emit();
    await flush();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
    expect(o.drain.snapshot().idle).toBe(true);
    expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
    expect(f.context._routes[0]._activeInvocations.size).toBe(0);
  },
);

it.each(['cdp', 'managed'] as const)(
  '%s resource waits for actual SDK event settlement after starting physical close',
  async (mode) => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = fixture(false, { method: 'abort', promise });
    const o = await ownedFixture(f, mode);
    f.emit();
    await flush();
    let done = false;
    const closing = o.lease.dispose().then(() => {
      done = true;
    });
    try {
      await flush();
      expect(o.closed()).toBe(1);
      expect(done).toBe(false);
      expect(o.drain.snapshot().idle).toBe(false);
    } finally {
      release();
      await closing;
    }
    expect(o.drain.snapshot().idle).toBe(true);
    expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  },
);

it('sealed event entry never starts SDK handling or fallback', async () => {
  const f = fixture();
  let invoked = 0;
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {},
  );
  await f.context.route('**/*', async () => {
    invoked++;
  });
  boundary.seal();
  f.emit();
  await flush();
  await boundary.settled();
  expect(invoked).toBe(0);
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
  expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  expect(f.context._routes[0]._activeInvocations.size).toBe(0);
});

it('tracks the complete SDK handler and preserves successful abort behavior', async () => {
  const f = fixture();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {},
  );
  await f.context.route('**/*', async (route: { abort(code: string): Promise<void> }) => {
    await held;
    await route.abort('blockedbyclient');
  });
  f.emit();
  await flush();
  boundary.seal();
  let settled = false;
  const pending = boundary.settled().then(() => {
    settled = true;
  });
  await flush();
  expect(settled).toBe(false);
  finish();
  await pending;
  await flush();
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort']);
  expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
});

it('refuses untracked events and listener lifecycle hooks before replacing anything', async () => {
  const f = fixture();
  const original = f.context._channel.listeners('route')[0];
  f.context._channel.on('newListener', () => {});
  expect(() =>
    createRouteEventBoundary(
      f.context,
      f.browser,
      (action) => action(),
      () => {},
    ),
  ).toThrow('UNSUPPORTED');
  expect(f.context._channel.listeners('route')).toEqual([original]);
  f.context._channel.removeAllListeners('newListener');
  f.context._channel._pendingHandlers.set('route', new Set([Promise.resolve()]));
  expect(() =>
    createRouteEventBoundary(
      f.context,
      f.browser,
      (action) => action(),
      () => {},
    ),
  ).toThrow('UNSUPPORTED');
  expect(f.context._channel.listeners('route')).toEqual([original]);
});

it('listener drift and a throwing error sink cannot escape the event boundary', async () => {
  const f = fixture();
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {
      throw new Error('synthetic sink');
    },
  );
  f.context._channel.on('route', () => {});
  f.emit();
  await flush();
  boundary.seal();
  await expect(boundary.settled()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(f.calls).toEqual([]);
});

it('capacity overflow refuses original SDK entry and does not lose admitted event work', async () => {
  const f = fixture();
  let release!: () => void;
  let errors = 0;
  let invoked = 0;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const boundary = createRouteEventBoundary(
    f.context,
    f.browser,
    (action) => action(),
    () => {
      errors++;
    },
  );
  await f.context.route('**/*', async (route: { abort(code: string): Promise<void> }) => {
    invoked++;
    await held;
    await route.abort('blockedbyclient');
  });
  try {
    for (let i = 0; i < 1024; i++) f.emit();
    await flush();
    expect(invoked).toBe(1024);
    f.emit();
    await flush();
    expect(invoked).toBe(1024);
    expect(errors).toBe(1);
    expect(f.context._channel._pendingHandlers.get('route').size).toBe(1024);
  } finally {
    boundary.seal();
    release();
    await boundary.settled().catch(() => {});
  }
  expect(f.calls.filter((method) => method === 'abort')).toHaveLength(1024);
  expect(f.calls.includes('continue')).toBe(false);
  expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  await expect(boundary.settled()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
});

it.each(['playwright', 'playwright-core'] as const)(
  '%s unsupported version refuses installation before any SDK dispatch',
  (name) => {
    const f = fixture();
    const metadata = require(
      name === 'playwright' ? 'playwright/package.json' : path.join(core, 'package.json'),
    );
    const originalVersion = metadata.version;
    const original = f.context._channel.listeners('route')[0];
    try {
      metadata.version = 'unsupported';
      expect(() =>
        createRouteEventBoundary(
          f.context,
          f.browser,
          (action) => action(),
          () => {},
        ),
      ).toThrow('UNSUPPORTED');
      expect(f.context._channel.listeners('route')).toEqual([original]);
      expect(f.calls).toEqual([]);
    } finally {
      metadata.version = originalVersion;
    }
  },
);

it('context ownership drift after registration is failed closed before original event entry', async () => {
  const f = fixture();
  const o = await ownedFixture(f);
  const foreign = fixture();
  foreign.browser._channel.emit('context', { context: f.context._channel });
  f.emit();
  await flush();
  await expect(o.lease.dispose()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns']);
  expect(o.drain.snapshot().unknown).toBe(1);
});

it('partially installed wrapper is sealed and never enters SDK after installation throws', async () => {
  const f = fixture();
  let errors = 0;
  const on = f.context._channel.on;
  f.context._channel.on = function (name: string, listener: (...args: unknown[]) => unknown) {
    on.call(this, name, listener);
    throw new Error('synthetic installation failure');
  };
  expect(() =>
    createRouteEventBoundary(
      f.context,
      f.browser,
      (action) => action(),
      () => {
        errors++;
      },
    ),
  ).toThrow('UNSUPPORTED');
  f.emit();
  await flush();
  expect(errors).toBe(1);
  expect(f.calls).toEqual([]);
  expect(f.context._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
});

it('drift failure in one context cannot finish cleanup while a different context event is pending', async () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(false, { method: 'abort', promise });
  const o = await ownedFixture(f);
  const second = f.addContext();
  await o.lease.guardContext(second, {
    check: async () => ({ allowed: false, reason: 'private_network', message: 'synthetic' }),
  });
  f.emit(second);
  await flush();
  f.context._channel.on('route', () => {});
  let done = false;
  const closing = o.lease.dispose().then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  try {
    await flush();
    expect(done).toBe(false);
    expect(o.closed()).toBe(1);
  } finally {
    release();
    await closing;
  }
  expect(o.drain.snapshot().unknown).toBe(1);
  expect(second._channel._pendingHandlers.get('route')?.size ?? 0).toBe(0);
  await expect(o.lease.dispose()).rejects.toThrow('BROWSER_ROUTE_EVENT_FAILED');
});

it('foreign single listener is refused before registration rather than trusted as the SDK entry', async () => {
  const f = fixture();
  const original = f.context._channel.listeners('route')[0];
  const foreign = async () => {};
  f.context._channel.removeListener('route', original);
  f.context._channel.on('route', foreign);
  let boundary: ReturnType<typeof createRouteEventBoundary> | undefined;
  try {
    expect(() => {
      boundary = createRouteEventBoundary(
        f.context,
        f.browser,
        (action) => action(),
        () => {},
      );
    }).toThrow('UNSUPPORTED');
    expect(f.context._channel.listeners('route')).toEqual([foreign]);
    expect(f.calls).toEqual([]);
  } finally {
    boundary?.seal();
    await boundary?.settled();
  }
});

it('foreign Browser context is refused without registration or listener replacement', async () => {
  const f = fixture();
  const o = await ownedFixture(f);
  const foreign = fixture();
  const original = foreign.context._channel.listeners('route')[0];
  try {
    await expect(
      o.lease.guardContext(foreign.context, {
        check: async () => ({ allowed: false, reason: 'private_network', message: 'synthetic' }),
      }),
    ).rejects.toThrow('UNSUPPORTED');
    expect(foreign.calls).toEqual([]);
    expect(foreign.context._channel.listeners('route')).toEqual([original]);
  } finally {
    await o.lease.dispose().catch(() => {});
  }
});

it('changed real SDK context dispatch method is refused before registration', async () => {
  const f = fixture();
  f.context._onRoute = async () => {};
  let boundary: ReturnType<typeof createRouteEventBoundary> | undefined;
  try {
    expect(() => {
      boundary = createRouteEventBoundary(
        f.context,
        f.browser,
        (action) => action(),
        () => {},
      );
    }).toThrow('UNSUPPORTED');
    expect(f.calls).toEqual([]);
  } finally {
    boundary?.seal();
    await boundary?.settled();
  }
});

it('normal real SDK requests continue and stop turns subsequent events into abort-only', async () => {
  const f = fixture();
  let checks = 0;
  const o = await ownedFixture(f, 'cdp', {
    check: async () => {
      checks++;
      return { allowed: true, url: 'https://synthetic.example/', addresses: ['8.8.8.8'] };
    },
  });
  f.emit();
  await flush();
  await o.lease.stopRequests();
  f.emit();
  await flush();
  await o.lease.dispose();
  expect(checks).toBe(1);
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'continue', 'abort']);
  expect(o.drain.snapshot().idle).toBe(true);
});

it('real SDK event rejects resource cleanup reentry without waiting on itself', async () => {
  const f = fixture();
  let nested: Promise<unknown> | undefined;
  let nestedError: unknown;
  const o = await ownedFixture(f, 'cdp', {
    check: async () => {
      nested = o.lease.dispose().catch((error: unknown) => {
        nestedError = error;
      });
      await nested;
      return { allowed: false, reason: 'private_network', message: 'synthetic' };
    },
  });
  f.emit();
  await flush();
  expect(String(nestedError)).toContain('BROWSER_REQUEST_REENTRY');
  expect(o.closed()).toBe(0);
  await o.lease.dispose();
  expect(o.drain.snapshot().idle).toBe(true);
});

it('policy refusal and policy failure retain fixed diagnostics without request or error text', async () => {
  const f = fixture();
  let failed = false;
  warnings.mockClear();
  const o = await ownedFixture(f, 'cdp', {
    check: async () => {
      if (failed) throw new Error('synthetic-sensitive-detail');
      return { allowed: false, reason: 'private_network', message: 'synthetic-sensitive-detail' };
    },
  });
  f.emit();
  await flush();
  failed = true;
  f.emit();
  await flush();
  await o.lease.dispose();
  expect(warnings.mock.calls).toEqual([
    [{ outcome: 'blocked' }, 'browser request blocked by network policy'],
    [{ outcome: 'policy_failed' }, 'browser request policy failed closed'],
  ]);
  expect(f.calls).toEqual(['setNetworkInterceptionPatterns', 'abort', 'abort']);
  expect(o.drain.snapshot().idle).toBe(true);
});
