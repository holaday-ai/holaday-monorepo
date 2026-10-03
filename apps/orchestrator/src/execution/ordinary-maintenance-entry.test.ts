import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { batchTasksRouter } from '../trpc/routers/batch-tasks.js';
import type { Request, Response } from 'express';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { QuotaService } from '../quota/quota-service.js';
import { type Context, makeCreateContext } from '../trpc/context.js';
import { tasksRouter } from '../trpc/routers/tasks.js';
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc.js';
import * as browser from '../ws/server.js';
import { type MaintenanceRecord, OrdinaryMaintenance } from './ordinary-maintenance.js';

function fixture() {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  const maintenance = new OrdinaryMaintenance({
    identity,
    journal: {
      read: () => structuredClone(record),
      persist: (next) => {
        record = { identity, ...next };
      },
    },
    checks: {
      verifyReady: async () => {},
      stopProducers: async () => {},
      verifyRetainedQueue: async () => {},
    },
  });
  const select = vi.fn(() => {
    throw new Error('unexpected database access');
  });
  const ctx = {
    executionDrain: maintenance,
    ordinaryMaintenance: maintenance,
    userId: 'ordinary-synthetic',
    taskOrigin: 'web',
    logger: pino({ level: 'silent' }),
    req: {},
    res: {},
    planner: {},
    db: { select },
  } as unknown as Context;
  return { maintenance, ctx, select };
}
afterEach(() => vi.restoreAllMocks());

it('ordinary batch input rejection leaves global serving available without database access', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  await expect(batchTasksRouter.createCaller(f.ctx).create({ prompts: [] })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  expect(f.select).not.toHaveBeenCalled();
  expect(f.maintenance.snapshot()).toMatchObject({ mode: 'serving', counts: { unknown: 0 } });
  await expect(f.maintenance.runRoot(async () => 'next').result).resolves.toBe('next');
});
it('pure built-in input validation stays known through builder chains, but custom effects do not', async () => {
  for (const custom of [false, true]) {
    const f = fixture();
    await f.maintenance.resumeServing();
    const schema = custom
      ? z.string().transform(() => {
          throw new Error('side effect unknown');
        })
      : z.string().min(2);
    const routes = router({
      read: publicProcedure
        .input(schema)
        .use(async ({ next }) => next())
        .query(() => true),
    });
    await expect(routes.createCaller(f.ctx).read(custom ? 'ok' : '')).rejects.toThrow();
    expect(f.maintenance.snapshot().counts.unknown > 0).toBe(custom);
  }
});
it('does not exempt a parser error reached after custom middleware side effects', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  let writes = 0;
  const routes = router({
    mutate: publicProcedure
      .use(async ({ next }) => {
        writes++;
        return next();
      })
      .input(z.string().min(2))
      .mutation(() => true),
  });
  await expect(routes.createCaller(f.ctx).mutate('')).rejects.toThrow();
  expect(writes).toBe(1);
  expect(f.maintenance.snapshot().counts.unknown).toBeGreaterThan(0);
});

it.each(['create', 'reply'] as const)(
  'ordinary closed %s rejects before database, quota and browser',
  async (kind) => {
    const f = fixture();
    const quota = vi.spyOn(QuotaService.prototype, 'tryConsume');
    const dispatch = vi.spyOn(browser, 'sendExtensionToolCall');
    const caller = tasksRouter.createCaller(f.ctx);
    await expect(
      kind === 'create'
        ? caller.create({ intent: '整理合成资料' })
        : caller.reply({ taskId: 'tsk_synthetic', message: '合成回复' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.select).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(f.maintenance.snapshot().counts).toMatchObject({ active: 0, unknown: 0 });
  },
);
it('gates internal non-task procedures before business entry', async () => {
  const f = fixture();
  let calls = 0;
  const routes = router({
    mutate: publicProcedure.mutation(() => {
      calls++;
      return true;
    }),
  });
  await expect(routes.createCaller(f.ctx).mutate()).rejects.toMatchObject({
    code: 'SERVICE_UNAVAILABLE',
  });
  expect(calls).toBe(0);
});
it('tracks internal procedure work while returning a known authentication refusal without uncertainty', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  const routes = router({ protected: protectedProcedure.mutation(() => true) });
  await expect(
    routes.createCaller({ ...f.ctx, userId: undefined }).protected(),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(f.maintenance.snapshot().counts).toMatchObject({ active: 0, unknown: 0 });
  await f.maintenance.beginMaintenance();
  await f.maintenance.waitForIdle(1000);
  expect(f.maintenance.snapshot().mode).toBe('closed');
});
it('does not exempt a downstream error just because its code says UNAUTHORIZED', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  let writes = 0;
  const routes = router({
    mutate: publicProcedure.mutation(() => {
      writes++;
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }),
  });
  await expect(routes.createCaller(f.ctx).mutate()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(writes).toBe(1);
  expect(f.maintenance.snapshot().counts.unknown).toBeGreaterThan(0);
});
it('carries the same ordinary discriminator through the real context factory', async () => {
  const f = fixture();
  const factory = makeCreateContext({
    planner: f.ctx.planner,
    executionDrain: f.maintenance,
    ordinaryMaintenance: f.maintenance,
  });
  const ctx = await factory({ req: {} as Request, res: {} as Response });
  expect(ctx.ordinaryMaintenance).toBe(f.maintenance);
});
it('does not turn a pure task input validation failure into unknown execution', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  await expect(
    tasksRouter.createCaller(f.ctx).reply({ taskId: '', message: '' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(f.select).not.toHaveBeenCalled();
  expect(f.maintenance.snapshot().counts).toMatchObject({ active: 0, unknown: 0 });
});
it('does not reuse a nested authentication rejection as proof for an outer side effect', async () => {
  const f = fixture();
  await f.maintenance.resumeServing();
  let writes = 0;
  const inner = router({ deny: protectedProcedure.mutation(() => true) });
  const outer = router({
    execute: publicProcedure.mutation(async ({ ctx }) => {
      try {
        await inner.createCaller({ ...ctx, userId: undefined }).deny();
      } catch (error) {
        writes++;
        throw error;
      }
    }),
  });
  await expect(outer.createCaller(f.ctx).execute()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(writes).toBe(1);
  expect(f.maintenance.snapshot().counts.unknown).toBeGreaterThan(0);
});
