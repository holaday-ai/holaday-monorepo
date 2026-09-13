import { realpathSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { startOwnedOperation } from '../../execution/owned-operation.js';
import { bindBrowserCloseReceipt } from './browser-close-receipt.js';
import { createOwnedCdpConnection } from './owned-cdp-connection.js';
import { createOwnedManagedBrowser } from './owned-managed-browser.js';

const faults = vi.hoisted(() => ({ guard: false }));
// Fault injection only at construction; all normal guards and every close receipt remain real.
vi.mock('./browser-request-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browser-request-guard.js')>();
  return {
    ...actual,
    createBrowserRequestGuard(...args: Parameters<typeof actual.createBrowserRequestGuard>) {
      if (faults.guard) throw new Error('synthetic guard initialization failure');
      return actual.createBrowserRequestGuard(...args);
    },
  };
});
afterEach(() => {
  faults.guard = false;
  vi.restoreAllMocks();
});

// Real pinned client SDK and owned lifetimes. Driver responses/events are synthetic.
const require = createRequire(import.meta.url);
const sdk = path.dirname(require.resolve('playwright/package.json'));
const core = path.dirname(require.resolve('playwright-core/package.json', { paths: [sdk] }));
const { Connection } = require(path.join(core, 'lib/client/connection.js'));
const { Browser: SdkBrowser } = require(path.join(core, 'lib/client/browser.js'));
const { BrowserContext } = require(path.join(core, 'lib/client/browserContext.js'));
const { Request, Route } = require(path.join(core, 'lib/client/network.js'));
const { nodePlatform } = require(path.join(core, 'lib/server/utils/nodePlatform.js'));

async function flush() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; error?: unknown } = { done: false };
  const finished = promise.then(
    () => {
      state.done = true;
    },
    (error: unknown) => {
      state.error = error;
      state.done = true;
    },
  );
  return { state, finished };
}
function fixture() {
  const connection = new Connection(nodePlatform);
  const browser = new SdkBrowser(connection._rootObject, 'Browser', 'synthetic-browser', {
    name: 'chromium',
    browserName: 'chromium',
    version: 'synthetic',
  });
  const messages: Array<{ id: number; method: string; params: unknown }> = [];
  connection.onmessage = (message: { id: number; method: string; params: unknown }) => {
    messages.push(message);
    if (message.method === 'setNetworkInterceptionPatterns')
      queueMicrotask(() => connection.dispatch({ id: message.id, result: {} }));
  };
  const respond = (error?: 'Error' | 'TargetClosedError', method = 'close') => {
    const message = messages.filter((m) => m.method === method).at(-1);
    if (!message) throw new Error('synthetic message missing');
    connection.dispatch(
      error
        ? {
            id: message.id,
            error: { error: { name: error, message: 'synthetic failure', stack: 'synthetic' } },
          }
        : { id: message.id, result: {} },
    );
  };
  const notifyClosed = () => browser._channel.emit('close');
  return { connection, browser, messages, respond, notifyClosed };
}
async function ownedFixture(mode: 'cdp' | 'managed', f = fixture()) {
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () =>
      mode === 'cdp'
        ? createOwnedCdpConnection(
            { connectOverCDP: async () => f.browser as Browser },
            'synthetic',
            () => true,
          )
        : createOwnedManagedBrowser({ launch: async () => f.browser as Browser }, {}, () => true),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  const lease = await root.result;
  await lease.ready;
  drain.close();
  return { ...f, lease, drain };
}

for (const mode of ['cdp', 'managed'] as const) {
  it.each([false, true])(
    `${mode}: close receipt keeps real pending request event owned (close fails=%s)`,
    async (fail) => {
      const f = await ownedFixture(mode);
      const context = new BrowserContext(f.browser, 'BrowserContext', 'synthetic-context', {
        options: {},
        debugger: { _object: {} },
        tracing: { _object: {} },
        requestContext: { _object: {} },
      });
      f.browser._channel.emit('context', { context: context._channel });
      await f.lease.guardContext(context, {
        check: async () => ({ allowed: false, reason: 'private_network', message: 'synthetic' }),
      });
      const request = new Request(context, 'Request', 'synthetic-request', {
        url: 'https://synthetic.example/',
        resourceType: 'document',
        method: 'GET',
        headers: [],
        isNavigationRequest: false,
      });
      const route = new Route(request, 'Route', 'synthetic-route', { request: request._channel });
      context._channel.emit('route', { route: route._channel });
      await flush();
      const closing = observe(f.lease.dispose());
      await flush();
      f.respond(fail ? 'TargetClosedError' : undefined);
      if (!fail) f.notifyClosed();
      await flush();
      expect(closing.state.done).toBe(false);
      expect(f.drain.snapshot().idle).toBe(false);
      expect(f.drain.snapshot().unknown).toBe(fail ? 1 : 0);
      expect(f.connection._callbacks.size).toBe(1);
      f.respond(undefined, 'abort');
      await closing.finished;
      expect(f.drain.snapshot().idle).toBe(!fail);
      expect(Boolean(closing.state.error)).toBe(fail);
      expect(f.messages.map((m) => m.method)).toEqual([
        'setNetworkInterceptionPatterns',
        'abort',
        'close',
      ]);
      expect(f.connection._callbacks.size).toBe(0);
      expect(f.connection.listeners('close')).toHaveLength(0);
    },
  );
  it.each(['disconnect', 'TargetClosedError'] as const)(
    `${mode}: does not turn %s into successful disposal`,
    async (failure) => {
      const f = await ownedFixture(mode);
      const closing = observe(f.lease.dispose());
      await flush();
      if (failure === 'disconnect') f.connection.close('synthetic disconnect');
      else f.respond('TargetClosedError');
      await closing.finished;
      expect(closing.state.error).toBeDefined();
      expect(f.drain.snapshot().unknown).toBe(1);
      expect(f.drain.snapshot().idle).toBe(false);
      expect(f.messages.map((m) => m.method)).toEqual(['close']);
    },
  );

  it.each(['ack-first', 'event-first'] as const)(
    `${mode}: requires both close ACK and Browser notification (%s)`,
    async (order) => {
      const f = await ownedFixture(mode);
      const closing = observe(f.lease.dispose());
      await flush();
      if (order === 'ack-first') f.respond();
      else f.notifyClosed();
      await flush();
      expect(closing.state.done).toBe(false);
      expect(f.drain.snapshot().idle).toBe(false);
      if (order === 'ack-first') f.notifyClosed();
      else f.respond();
      await closing.finished;
      expect(closing.state.error).toBeUndefined();
      expect(f.drain.snapshot().idle).toBe(true);
      expect(f.messages).toHaveLength(1);
      expect(f.messages[0]?.params).toEqual({});
    },
  );

  it(`${mode}: transport loss after ACK is unknown, not a successful passive notification`, async () => {
    const f = await ownedFixture(mode);
    const listeners = f.connection.listeners('close').length;
    const closing = observe(f.lease.dispose());
    await flush();
    f.respond();
    await flush();
    expect(closing.state.done).toBe(false);
    f.connection.close('synthetic disconnect');
    await closing.finished;
    expect(String(closing.state.error)).toContain('BROWSER_CLOSE_RECEIPT_FAILED');
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(f.drain.snapshot().idle).toBe(false);
    expect(f.connection.listeners('close')).toHaveLength(listeners);
  });

  it(`${mode}: sealed or blocked resource still closes once with its bound receipt`, async () => {
    const f = await ownedFixture(mode);
    f.drain.block();
    const first = f.lease.dispose();
    const second = f.lease.dispose();
    expect(second).toBe(first);
    const closing = observe(first);
    await flush();
    f.notifyClosed();
    f.respond();
    await closing.finished;
    expect(closing.state.error).toBeUndefined();
    expect(f.messages).toHaveLength(1);
    expect(f.connection._closedError).toBeUndefined();
    expect(f.drain.snapshot().active).toBe(0);
    expect(f.lease.dispose()).toBe(first);
  });
}

it.each(['channel', 'connection', 'notification', 'public-close', 'remote-flag'] as const)(
  'rejects acquired %s drift before close dispatch',
  async (kind) => {
    const f = await ownedFixture('cdp');
    const foreign = fixture();
    if (kind === 'channel') f.browser._channel = foreign.browser._channel;
    if (kind === 'connection') f.browser._connection = foreign.connection;
    if (kind === 'notification') f.browser._closedPromise = Promise.resolve();
    if (kind === 'public-close') f.browser.close = async () => {};
    if (kind === 'remote-flag') f.browser._shouldCloseConnectionOnClose = true;
    await expect(f.lease.dispose()).rejects.toThrow('BROWSER_CLOSE_RECEIPT_FAILED');
    expect(f.messages).toEqual([]);
    expect(foreign.messages).toEqual([]);
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(f.connection._closedError).toBeUndefined();
  },
);

it('late shape drift cannot release an already dispatched raw close', async () => {
  const f = await ownedFixture('managed');
  const closing = observe(f.lease.dispose());
  await flush();
  f.browser._shouldCloseConnectionOnClose = true;
  f.notifyClosed();
  await flush();
  expect(closing.state.done).toBe(false);
  expect(f.drain.snapshot().idle).toBe(false);
  expect(f.connection._callbacks.size).toBe(1);
  f.respond();
  await closing.finished;
  expect(String(closing.state.error)).toContain('BROWSER_CLOSE_RECEIPT_FAILED');
  expect(f.drain.snapshot().unknown).toBe(1);
  expect(f.messages).toHaveLength(1);
});

it('binds the same pinned SDK through a package symlink returned by the module resolver', async () => {
  const f = fixture();
  const alias = path.resolve(process.cwd(), 'node_modules/playwright/package.json');
  expect(realpathSync(alias) === alias).toBe(false);
  const resolver = Module as unknown as { _resolveFilename(...args: unknown[]): string };
  const original = resolver._resolveFilename;
  vi.spyOn(resolver, '_resolveFilename').mockImplementation(function (
    this: typeof resolver,
    ...args
  ) {
    if (args[0] === 'playwright/package.json') return alias;
    return Reflect.apply(original, this, args);
  });
  const close = bindBrowserCloseReceipt(f.browser);
  const receipt = close();
  await flush();
  expect(f.messages).toHaveLength(1);
  f.respond();
  f.notifyClosed();
  await receipt;
});

it('native listener hook reentry shares the cached close receipt before the first RPC', async () => {
  const f = fixture();
  const close = bindBrowserCloseReceipt(f.browser);
  let reentered: Promise<void> | undefined;
  f.connection.on('newListener', (event: string) => {
    if (event === 'close') reentered = close();
  });
  const first = close();
  await flush();
  expect(reentered).toBe(first);
  expect(f.messages).toHaveLength(1);
  f.respond();
  f.notifyClosed();
  await first;
  expect(close()).toBe(first);
  expect(f.connection.listeners('close')).toHaveLength(0);
});

it('a close-reason setter cannot redirect the close RPC to another connection', async () => {
  const f = await ownedFixture('cdp');
  const foreign = fixture();
  foreign.connection.onmessage = (message: { id: number; method: string; params: unknown }) => {
    foreign.messages.push(message);
    queueMicrotask(() => foreign.connection.dispatch({ id: message.id, result: {} }));
  };
  Object.defineProperty(f.browser, '_closeReason', {
    set: () => {
      f.browser._connection = foreign.connection;
    },
  });
  const closing = observe(f.lease.dispose());
  await flush();
  f.notifyClosed();
  await closing.finished;
  expect(f.messages).toEqual([]);
  expect(foreign.messages).toEqual([]);
  expect(f.drain.snapshot().unknown).toBe(1);
});

it('unsupported shared-connection closing mode is never published or called as fallback', async () => {
  const f = fixture();
  f.browser._shouldCloseConnectionOnClose = true;
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    async () =>
      createOwnedCdpConnection(
        {
          connectOverCDP: async () => f.browser,
        },
        'synthetic',
        () => true,
      ),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  const lease = await root.result;
  drain.close();
  await expect(lease.ready).rejects.toThrow('BROWSER_CLOSE_BOUNDARY_UNSUPPORTED');
  await expect(lease.dispose()).rejects.toThrow('BROWSER_CLOSE_BOUNDARY_UNSUPPORTED');
  expect(f.messages).toEqual([]);
  expect(f.connection._closedError).toBeUndefined();
  expect(drain.snapshot().unknown).toBe(1);
  expect(drain.snapshot().idle).toBe(false);
});

it('without a lifetime the legacy public close behavior remains unchanged', async () => {
  const f = fixture();
  const lease = createOwnedManagedBrowser({ launch: async () => f.browser }, {}, () => true);
  await lease.ready;
  const closing = observe(lease.dispose());
  await flush();
  f.respond('TargetClosedError');
  await closing.finished;
  expect(closing.state.error).toBeUndefined();
  expect(f.messages).toHaveLength(1);
});

it.each(['disconnect', 'drift', 'throw'] as const)(
  'cleanup hook %s cannot escape the final failure boundary',
  async (action) => {
    const f = await ownedFixture('cdp');
    f.connection.on('removeListener', (event: string) => {
      if (event !== 'close') return;
      if (action === 'disconnect') f.connection.close('synthetic cleanup disconnect');
      if (action === 'drift') f.browser._shouldCloseConnectionOnClose = true;
      if (action === 'throw') throw new Error('synthetic cleanup details');
    });
    const closing = observe(f.lease.dispose());
    await flush();
    f.respond();
    f.notifyClosed();
    await closing.finished;
    expect(String(closing.state.error)).toBe('Error: BROWSER_CLOSE_RECEIPT_FAILED');
    expect(f.drain.snapshot().unknown).toBe(1);
    expect(f.drain.snapshot().idle).toBe(false);
    expect(f.messages).toHaveLength(1);
  },
);

it('the final shape getter cannot switch Connection after its earlier identity comparison', async () => {
  const f = await ownedFixture('cdp');
  const foreign = fixture();
  let armed = false;
  foreign.connection.onmessage = (message: { id: number; method: string; params: unknown }) => {
    foreign.messages.push(message);
    queueMicrotask(() => foreign.connection.dispatch({ id: message.id, result: {} }));
  };
  Object.defineProperty(f.browser, '_closeReason', {
    set: () => {
      armed = true;
    },
  });
  Object.defineProperty(f.browser, '_shouldCloseConnectionOnClose', {
    get: () => {
      if (armed) f.browser._connection = foreign.connection;
      return false;
    },
  });
  const closing = observe(f.lease.dispose());
  await flush();
  f.notifyClosed();
  await closing.finished;
  expect(f.messages).toEqual([]);
  expect(foreign.messages).toEqual([]);
  expect(f.drain.snapshot().unknown).toBe(1);
});

it('binding rejects an accessor without evaluating it or exposing its exception', () => {
  const f = fixture();
  let calls = 0;
  Object.defineProperty(f.browser, '_channel', {
    get: () => {
      calls++;
      throw new Error('synthetic binding details');
    },
  });
  expect(() => bindBrowserCloseReceipt(f.browser)).toThrow('BROWSER_CLOSE_BOUNDARY_UNSUPPORTED');
  expect(calls).toBe(0);
  expect(f.messages).toEqual([]);
});

it.each(['cdp', 'managed'] as const)(
  '%s: guard initialization failure uses the already-bound single close receipt',
  async (mode) => {
    faults.guard = true;
    const f = fixture();
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'request',
      async () =>
        mode === 'cdp'
          ? createOwnedCdpConnection(
              { connectOverCDP: async () => f.browser },
              'synthetic',
              () => true,
            )
          : createOwnedManagedBrowser({ launch: async () => f.browser }, {}, () => true),
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    const lease = await root.result;
    drain.close();
    const ready = observe(lease.ready);
    const closing = observe(lease.dispose());
    await flush();
    expect(ready.state.done).toBe(false);
    expect(closing.state.done).toBe(false);
    expect(f.messages).toHaveLength(1);
    expect(drain.snapshot().idle).toBe(false);
    f.respond();
    f.notifyClosed();
    await closing.finished;
    await ready.finished;
    expect(String(ready.state.error)).toContain('synthetic guard initialization failure');
    expect(String(closing.state.error)).toContain('synthetic guard initialization failure');
    expect(f.messages.map((message) => message.method)).toEqual(['close']);
    expect(drain.snapshot().unknown).toBe(1);
    expect(drain.snapshot().idle).toBe(false);
  },
);
