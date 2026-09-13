import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import {
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import type { AkshareClient } from './akshare-client.js';
import { HttpAkshareClient } from './akshare-http-client.js';
import { warmSharedCaches, warmSymbolTable } from './prewarm-scheduler.js';

const releases: Array<() => void> = [];
const envelope = {
  data: [],
  count: 0,
  source: 'synthetic',
  fetched_at: '2026-09-13',
  disclaimer: 'synthetic',
};
function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
function fixture() {
  const drain = new ExecutionDrain();
  drain.open();
  return drain;
}
function root<T>(drain: ExecutionDrain, action: () => Promise<T>) {
  return startOwnedOperation(drain, 'request', action, {
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  });
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a swallowed upstream failure keeps its original child uncertain after the caller returns', async () => {
  const drain = fixture();
  const held = hold();
  const client = new HttpAkshareClient({
    baseUrl: 'http://synthetic-prewarm-failure',
    fetchImpl: async () => {
      await held.promise;
      throw new Error('synthetic transport failure');
    },
  });
  let pending!: ReturnType<HttpAkshareClient['getIndexQuote']>;
  await root(drain, async () => {
    pending = client.getIndexQuote('cn');
  }).result;
  drain.close();
  expect(drain.snapshot().idle).toBe(false);
  held.release();
  await pending;
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('an HTTP error waits for the original response cancellation before its child releases', async () => {
  const drain = fixture();
  const held = hold();
  let cancelling = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelling = true;
        return held.promise;
      },
    }),
    { status: 503 },
  );
  const client = new HttpAkshareClient({
    baseUrl: 'http://synthetic-prewarm-cancel',
    fetchImpl: async () => response,
  });
  let done = false;
  const pending = root(drain, () => client.getIndexQuote('cn')).result.then(() => {
    done = true;
  });
  await vi.waitFor(() => expect(cancelling).toBe(true));
  drain.close();
  expect(done).toBe(false);
  expect(drain.snapshot().idle).toBe(false);
  held.release();
  await pending;
  expect(drain.snapshot().unknown).toBeGreaterThan(0);
});

it('a sealed caller cannot submit an Akshare request', async () => {
  const drain = fixture();
  let sends = 0;
  const client = new HttpAkshareClient({
    baseUrl: 'http://synthetic-prewarm-sealed',
    fetchImpl: async () => {
      sends++;
      return new Response(JSON.stringify(envelope));
    },
  });
  await root(drain, async () =>
    withOperationDispatchScope(async (seal) => {
      seal();
      await client.getIndexQuote('cn');
    }),
  ).result.catch(() => {});
  expect(sends).toBe(0);
});

it('shared cache error envelopes cannot silently report clean', async () => {
  const drain = fixture();
  const client = {
    getIndexQuote: async (market: string) => ({
      ...envelope,
      ...(market === 'hk' ? { error: 'synthetic failure' } : {}),
    }),
  } as unknown as AkshareClient;
  await root(drain, () => warmSharedCaches(client)).result;
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('symbol warming retains the response body until actual EOF', async () => {
  const drain = fixture();
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        controller.enqueue(new TextEncoder().encode('{'));
      },
    }),
  );
  vi.stubGlobal('fetch', async () => response);
  let done = false;
  const pending = root(drain, () => warmSymbolTable('http://synthetic-prewarm-symbol')).result.then(
    () => {
      done = true;
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  drain.close();
  expect(done).toBe(false);
  expect(drain.snapshot().idle).toBe(false);
  body.enqueue(new TextEncoder().encode('"count":1,"data":[{"count":3}]}'));
  body.close();
  await pending;
  expect(drain.snapshot().idle).toBe(true);
});

it('symbol warming cannot swallow a transport failure into clean settlement', async () => {
  const drain = fixture();
  vi.stubGlobal('fetch', async () => {
    throw new Error('synthetic transport failure');
  });
  await root(drain, () => warmSymbolTable('http://synthetic-prewarm-symbol-failure')).result;
  drain.close();
  expect(drain.snapshot().unknown).toBe(1);
});

it('late transport lookup cannot bypass the original scope veto', async () => {
  const drain = fixture();
  let sends = 0;
  const client = new HttpAkshareClient({
    baseUrl: 'http://synthetic-late-veto',
    fetchImpl: async () => new Response(JSON.stringify(envelope)),
  });
  await root(drain, () =>
    withOperationDispatchScope(async (seal) => {
      Object.defineProperty(client, 'fetchImpl', {
        get() {
          seal();
          return async () => {
            sends++;
            return new Response(JSON.stringify(envelope));
          };
        },
      });
      await client.getIndexQuote('cn');
    }),
  ).result;
  expect(sends).toBe(0);
});

it.each(['{}', '{"count":1,"data":[]}', '{"error":"synthetic"}'])(
  'rejects unproven symbol completion %s',
  async (body) => {
    const drain = fixture();
    vi.stubGlobal('fetch', async () => new Response(body));
    await root(drain, () => warmSymbolTable('http://synthetic-symbol-format')).result;
    drain.close();
    expect(drain.snapshot().unknown).toBe(1);
  },
);
