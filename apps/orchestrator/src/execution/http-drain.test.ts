import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttpApp } from '../http.js';
import { makeCreateContext } from '../trpc/context.js';
import type { Context } from '../trpc/context.js';
import { publicProcedure, router } from '../trpc/trpc.js';
import { DrainController } from './drain-controller.js';
import { createHttpDrain } from './http-drain.js';
import { currentOperationLifetime, withOperationDispatchScope } from './owned-operation.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const servers: Server[] = [];
const releases: Array<() => void> = [];
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
async function fixture(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-http-parent-')));
  roots.push(directory);
  const identity = { epoch: 'a'.repeat(32), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
  writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...identity,
      bootId: 'd'.repeat(32),
      sequence: 1,
      mode: 'closed',
      dirty: false,
    })}\n`,
    { mode: 0o600 },
  );
  // Synthetic maintenance authority; never a production verifier.
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
    mono: () => 1000,
  });
  controllers.push(controller);
  const session = controller.connect();
  if (open)
    expect(
      (
        await controller.execute(
          session,
          Buffer.from(
            `${JSON.stringify({
              protocol: 1,
              op: 'open',
              ...identity,
              version: 2,
              serial: 1,
              expiresAt: 110000,
            })}\n`,
          ),
        )
      ).ok,
    ).toBe(true);
  const app = express();
  const scope = createHttpDrain(controller);
  app.use(scope.admit);
  return { app, scope, controller, close: () => controller.disconnect(session) };
}
async function listen(app: express.Express) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing local fixture address');
  return address.port;
}
function send(port: number, options: { method?: string; body?: string; finish?: boolean } = {}) {
  let status = 0;
  const req = request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
    },
    (res) => {
      status = res.statusCode ?? 0;
      res.resume();
    },
  );
  req.on('error', () => {});
  req.flushHeaders();
  if (options.body) req.write(options.body);
  if (options.finish !== false) req.end();
  return { req, status: () => status };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

it('rejects closed requests before body parsing or authentication starts', async () => {
  const f = await fixture(false);
  let entered = 0;
  f.app.use(f.scope.middleware(express.json()));
  f.app.use(
    f.scope.handler(async (_req, res) => {
      entered++;
      res.end();
    }),
  );
  const client = send(await listen(f.app), { method: 'POST', body: '{', finish: false });
  await vi.waitFor(() => expect(client.status()).toBe(503));
  expect(entered).toBe(0);
  expect(f.controller.state.read().dirty).toBe(false);
  expect(f.controller.drain.snapshot()).toMatchObject({ idle: true });
  client.req.destroy();
});

it('retains pending authentication after disconnect and never enters the route afterward', async () => {
  const f = await fixture();
  const auth = held();
  let entered = false;
  let routes = 0;
  f.app.use(
    f.scope.handler(async (_req, _res, next) => {
      entered = true;
      expect(f.controller.state.read().dirty).toBe(true);
      expect(currentOperationLifetime()?.drain).toBe(f.controller.drain);
      await auth.promise;
      next();
    }),
  );
  f.app.get(
    '/',
    f.scope.handler((_req, res) => {
      routes++;
      res.end();
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(entered).toBe(true));
  f.close();
  client.req.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot().idle).toBe(false);
  auth.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
  expect(routes).toBe(0);
});

it('keeps a returned handler promise owned after an early successful response', async () => {
  const f = await fixture();
  const work = held();
  f.app.get(
    '/',
    f.scope.handler(async (_req, res) => {
      res.end('accepted');
      await work.promise;
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(client.status()).toBe(200));
  f.close();
  expect(f.controller.drain.snapshot().idle).toBe(false);
  work.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('preserves uncertainty when the original handler fails after its response', async () => {
  const f = await fixture();
  const work = held();
  f.app.get(
    '/',
    f.scope.handler(async (_req, res) => {
      res.end('accepted');
      await work.promise;
      throw new Error('synthetic late failure');
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(client.status()).toBe(200));
  f.close();
  work.release();
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
  );
});

it('retains callback middleware until its real callback even after disconnect', async () => {
  const f = await fixture();
  const work = held();
  let entered = false;
  let routes = 0;
  f.app.use(
    f.scope.middleware((_req, _res, next) => {
      entered = true;
      void work.promise.then(() => next());
    }),
  );
  f.app.get(
    '/',
    f.scope.handler((_req, res) => {
      routes++;
      res.end();
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(entered).toBe(true));
  f.close();
  client.req.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot().idle).toBe(false);
  work.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
  expect(routes).toBe(0);
});

it('keeps the original response pinned while a streamed response is unfinished', async () => {
  const f = await fixture();
  let finish: (() => void) | undefined;
  f.app.get(
    '/',
    f.scope.handler((_req, res) => {
      res.write('synthetic');
      finish = () => res.end();
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(client.status()).toBe(200));
  f.close();
  expect(f.controller.drain.snapshot().idle).toBe(false);
  finish?.();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('owns an actual tRPC procedure past disconnect although its Express adapter returns void', async () => {
  const f = await fixture();
  const work = held();
  let entered = false;
  let matched = false;
  const testRouter = router({
    slow: publicProcedure.query(async ({ ctx }) => {
      entered = true;
      matched =
        ctx.executionLifetime?.drain === f.controller.drain &&
        currentOperationLifetime()?.owner === ctx.executionLifetime?.owner;
      await work.promise;
      return 'synthetic';
    }),
  });
  f.app.use(
    '/slow',
    createExpressMiddleware({
      router: testRouter,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  const client = request({ hostname: '127.0.0.1', port, path: '/slow/slow' });
  client.on('error', () => {});
  client.end();
  await vi.waitFor(() => expect(entered).toBe(true));
  f.close();
  client.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot().idle).toBe(false);
  expect(matched).toBe(true);
  work.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('malformed JSON finishes the actual parser callback without a false unknown write', async () => {
  const f = await fixture();
  let calls = 0;
  f.app.use(f.scope.middleware(express.json()));
  f.app.post(
    '/',
    f.scope.handler((_req, res) => {
      calls++;
      res.end();
    }),
  );
  f.app.use(((
    err: { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(err.status ?? 500).end();
  }) as express.ErrorRequestHandler);
  const client = send(await listen(f.app), { method: 'POST', body: '{' });
  await vi.waitFor(() => expect(client.status()).toBe(400));
  f.close();
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }),
  );
  expect(calls).toBe(0);
});

it('the actual closed application exposes health but refuses HTTP work before parsing', async () => {
  const f = await fixture(false);
  const app = createHttpApp({ planner: {} as never, executionDrain: f.controller });
  const port = await listen(app);
  const get = (path: string) =>
    new Promise<number>((resolve, reject) => {
      const client = request({ hostname: '127.0.0.1', port, path }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      client.on('error', reject);
      client.end();
    });
  expect(await get('/healthz')).toBe(200);
  expect(await get('/files/synthetic/download')).toBe(503);
  expect(await get('/trpc/tasks.list')).toBe(503);
  const malformed = send(port, { method: 'POST', body: '{', finish: false });
  await vi.waitFor(() => expect(malformed.status()).toBe(503));
  malformed.req.destroy();
  expect(f.controller.state.read().dirty).toBe(false);
  expect(f.controller.drain.snapshot()).toMatchObject({ idle: true });
});

it('retains the actual tRPC async input parser before the resolver exists', async () => {
  const f = await fixture();
  const work = held();
  let parsing = false;
  let resolved = 0;
  const testRouter = router({
    slow: publicProcedure
      .input(
        z.unknown().transform(async () => {
          parsing = true;
          await work.promise;
          return 'synthetic';
        }),
      )
      .query(() => {
        resolved++;
        return 'synthetic';
      }),
  });
  f.app.use(
    createExpressMiddleware({
      router: testRouter,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  const client = request({ hostname: '127.0.0.1', port, path: '/slow' });
  client.on('error', () => {});
  client.end();
  await vi.waitFor(() => expect(parsing).toBe(true));
  f.close();
  client.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(resolved).toBe(0);
  expect(f.controller.drain.snapshot().idle).toBe(false);
  work.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
  // Cancellation is not fabricated; admitted work may finish on normal close.
  expect(resolved).toBe(1);
});

it('the original tRPC context survives mutation of the caller deps object', async () => {
  const f = await fixture();
  const other = await fixture(false);
  const deps = { planner: {} as never, executionDrain: f.controller };
  const make = makeCreateContext(deps);
  deps.executionDrain = other.controller;
  let matched = false;
  const testRouter = router({
    check: publicProcedure.query(({ ctx }) => {
      matched =
        ctx.executionDrain === f.controller && ctx.executionLifetime?.drain === f.controller.drain;
      return 'synthetic';
    }),
  });
  f.app.use(createExpressMiddleware({ router: testRouter, createContext: make }));
  const port = await listen(f.app);
  await new Promise<void>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path: '/check' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    client.on('error', reject);
    client.end();
  });
  expect(matched).toBe(true);
  expect(other.controller.state.read().dirty).toBe(false);
  f.close();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('an aborted partial body retains parser ownership until the real abort callback finishes', async () => {
  const f = await fixture();
  let arrived = false;
  let routes = 0;
  f.app.use(
    f.scope.handler((_req, _res, next) => {
      arrived = true;
      next();
    }),
  );
  f.app.use(f.scope.middleware(express.json()));
  f.app.post(
    '/',
    f.scope.handler((_req, res) => {
      routes++;
      res.end();
    }),
  );
  const client = send(await listen(f.app), { method: 'POST', body: '{', finish: false });
  await vi.waitFor(() => expect(arrived).toBe(true));
  f.close();
  expect(f.controller.drain.snapshot().idle).toBe(false);
  client.req.destroy();
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }),
  );
  expect(routes).toBe(0);
});

it('does not advance from a pending handler after the original controller is blocked', async () => {
  const f = await fixture();
  const work = held();
  let entered = false;
  let routes = 0;
  f.app.use(
    f.scope.handler(async (_req, _res, next) => {
      entered = true;
      await work.promise;
      next();
    }),
  );
  f.app.get(
    '/',
    f.scope.handler((_req, res) => {
      routes++;
      res.end();
    }),
  );
  const client = send(await listen(f.app));
  await vi.waitFor(() => expect(entered).toBe(true));
  f.controller.drain.block();
  work.release();
  await vi.waitFor(() => expect(client.status()).toBe(503));
  expect(routes).toBe(0);
  expect(f.controller.drain.snapshot().idle).toBe(false);
});

it('a failed actual resolver keeps an unknown outcome after partial work and disconnect', async () => {
  const f = await fixture();
  const work = held();
  let partial = false;
  const testRouter = router({
    fail: publicProcedure.query(async () => {
      partial = true;
      await work.promise;
      throw new Error('synthetic partial failure');
    }),
  });
  f.app.use(
    createExpressMiddleware({
      router: testRouter,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  const client = request({ hostname: '127.0.0.1', port, path: '/fail' });
  client.on('error', () => {});
  client.end();
  await vi.waitFor(() => expect(partial).toBe(true));
  f.close();
  client.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot().idle).toBe(false);
  work.release();
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false }),
  );
});

it('same-request nested callers inherit the live child after new-root admission closes', async () => {
  const f = await fixture();
  let nested = 0;
  let outcome = '';
  const inner = router({
    inside: publicProcedure.query(({ ctx }) => {
      nested++;
      expect(ctx.executionLifetime?.owner).toBe(currentOperationLifetime()?.owner);
      expect(f.controller.drain.snapshot().roots).toBe(1);
      return 'synthetic nested';
    }),
  });
  const outer = router({
    outside: publicProcedure.query(async ({ ctx }) => {
      f.close();
      try {
        outcome = await inner.createCaller(ctx).inside();
      } catch {
        outcome = 'rejected';
      }
      return outcome;
    }),
  });
  f.app.use(
    createExpressMiddleware({
      router: outer,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  await new Promise<void>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path: '/outside' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    client.on('error', reject);
    client.end();
  });
  expect(nested).toBe(1);
  expect(outcome).toBe('synthetic nested');
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('a different request cannot steal an active same-controller context for a nested caller', async () => {
  const f = await fixture();
  const work = held();
  let saved: Context | undefined;
  let stolenCalls = 0;
  let rejected = false;
  const inner = router({
    inside: publicProcedure.query(() => {
      stolenCalls++;
      return 'bad';
    }),
  });
  const outer = router({
    hold: publicProcedure.query(async ({ ctx }) => {
      saved = ctx;
      await work.promise;
      return 'ok';
    }),
    steal: publicProcedure.query(async () => {
      if (!saved) throw new Error('fixture not ready');
      try {
        await inner.createCaller(saved).inside();
      } catch {
        rejected = true;
      }
      return 'ok';
    }),
  });
  f.app.use(
    createExpressMiddleware({
      router: outer,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  const heldClient = request({ hostname: '127.0.0.1', port, path: '/hold' }, (res) => res.resume());
  heldClient.on('error', () => {});
  heldClient.end();
  await vi.waitFor(() => expect(saved).toBeDefined());
  await new Promise<void>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path: '/steal' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    client.on('error', reject);
    client.end();
  });
  expect(rejected).toBe(true);
  expect(stolenCalls).toBe(0);
  work.release();
  f.close();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('a mixed batch conservatively retains each error without releasing the still-running sibling', async () => {
  const f = await fixture();
  const work = held();
  let partial = false;
  let invalidResolverCalls = 0;
  const testRouter = router({
    invalid: publicProcedure.input(z.string()).query(() => {
      invalidResolverCalls++;
      return 'bad';
    }),
    fail: publicProcedure.query(async () => {
      partial = true;
      await work.promise;
      throw new Error('synthetic');
    }),
  });
  f.app.use(
    createExpressMiddleware({
      router: testRouter,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  const client = request({ hostname: '127.0.0.1', port, path: '/invalid,fail?batch=1' });
  client.on('error', () => {});
  client.end();
  await vi.waitFor(() => expect(partial).toBe(true));
  await vi.waitFor(() => expect(f.controller.drain.snapshot().unknown).toBe(1));
  expect(invalidResolverCalls).toBe(0);
  f.close();
  client.destroy();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot()).toMatchObject({ unknown: 1, idle: false });
  expect(f.controller.drain.snapshot().active).toBeGreaterThan(0);
  work.release();
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 2, idle: false }),
  );
});

it('a nested caller cannot replace the original controller even while both request chains are active', async () => {
  const f = await fixture();
  const other = await fixture();
  let calls = 0;
  let rejected = false;
  const inner = router({
    inside: publicProcedure.query(() => {
      calls++;
      return 'bad';
    }),
  });
  const outer = router({
    outside: publicProcedure.query(async ({ ctx }) => {
      try {
        await inner.createCaller({ ...ctx, executionDrain: other.controller }).inside();
      } catch {
        rejected = true;
      }
      return 'ok';
    }),
  });
  f.app.use(
    createExpressMiddleware({
      router: outer,
      createContext: makeCreateContext({ planner: {} as never, executionDrain: f.controller }),
    }),
  );
  const port = await listen(f.app);
  await new Promise<void>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port, path: '/outside' }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    client.on('error', reject);
    client.end();
  });
  expect(rejected).toBe(true);
  expect(calls).toBe(0);
  expect(other.controller.state.read().dirty).toBe(false);
  f.close();
  other.close();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it.each([false, true])(
  'a nested caller cannot reuse its saved HTTP root context (sealed=%s)',
  async (sealed) => {
    const f = await fixture();
    let savedRoot: Context | undefined;
    let calls = 0;
    let refused = false;
    const inner = router({
      inside: publicProcedure.query(() => {
        calls++;
        return 'bad';
      }),
    });
    const outer = router({
      outside: publicProcedure.query(async () => {
        await withOperationDispatchScope(async (seal) => {
          if (sealed) seal();
          if (!savedRoot) throw new Error('fixture root missing');
          try {
            await inner.createCaller(savedRoot).inside();
          } catch {
            refused = true;
          }
        });
        return 'ok';
      }),
    });
    const make = makeCreateContext({ planner: {} as never, executionDrain: f.controller });
    f.app.use(
      createExpressMiddleware({
        router: outer,
        createContext: async ({ req, res }) => {
          savedRoot = await make({ req, res });
          return savedRoot;
        },
      }),
    );
    const port = await listen(f.app);
    await new Promise<void>((resolve, reject) => {
      const client = request({ hostname: '127.0.0.1', port, path: '/outside' }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      client.on('error', reject);
      client.end();
    });
    expect(calls).toBe(0);
    expect(refused).toBe(true);
    f.close();
    await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
  },
);
