import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import type { Planner } from './agent/planner.js';
import * as webhook from './api-keys/webhook-handler.js';
import { DrainController } from './execution/drain-controller.js';
import { type MaintenanceRecord, OrdinaryMaintenance } from './execution/ordinary-maintenance.js';
import { createHttpApp } from './http.js';
import * as context from './trpc/context.js';

// Actual app construction and actual context factories, no listening socket or
// provider/DB call. This proves dependency identity only, not HTTP IO ownership.
const roots: string[] = [];
const controllers: DrainController[] = [];
const planner = {} as Planner;
function controller() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-http-wiring-')));
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
  const original = new DrainController(directory, identity);
  controllers.push(original);
  return original;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const original of controllers.splice(0)) original.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});

it('passes the same closed controller through the actual HTTP tRPC context factory', async () => {
  const original = controller();
  const factory = vi.spyOn(context, 'makeCreateContext');
  createHttpApp({ planner, executionDrain: original });
  expect(factory).toHaveBeenCalledTimes(1);
  const make = factory.mock.results[0]?.value;
  expect(make).toBeTypeOf('function');
  if (!make) throw new Error('missing tRPC context factory');
  const ctx = await make({ req: {} as Request, res: {} as Response });
  expect(ctx.executionDrain === original).toBe(true);
  expect(() => ctx.executionDrain?.runRoot(async () => {})).toThrow();
  expect(original.drain.snapshot()).toMatchObject({ mode: 'closed', idle: true });
});

it('passes the same closed controller through the actual webhook manual context', () => {
  const original = controller();
  const factory = vi.spyOn(webhook, 'createWebhookTasksHandler');
  createHttpApp({ planner, executionDrain: original });
  expect(factory).toHaveBeenCalledTimes(1);
  const deps = factory.mock.calls[0]?.[0];
  if (!deps) throw new Error('missing webhook wiring');
  expect(deps.executionDrain === original).toBe(true);
  const ctx = deps.buildContextForUser('synthetic-http-wiring');
  expect(ctx.executionDrain === original).toBe(true);
  expect(ctx.executionLifetime).toBeUndefined();
  expect(() => ctx.executionDrain?.runRoot(async () => {})).toThrow();
});

it('keeps the original boot controller when the caller later mutates its deps object', () => {
  const original = controller();
  const deps = { planner, executionDrain: original };
  const factory = vi.spyOn(webhook, 'createWebhookTasksHandler');
  createHttpApp(deps);
  deps.executionDrain = controller();
  const make = factory.mock.calls[0]?.[0].buildContextForUser;
  if (!make) throw new Error('missing webhook context factory');
  expect(make('synthetic-http-wiring').executionDrain === original).toBe(true);
});

it('keeps the legacy context absent and does not accept a controller from request data', async () => {
  const factory = vi.spyOn(context, 'makeCreateContext');
  createHttpApp({ planner });
  const make = factory.mock.results[0]?.value;
  if (!make) throw new Error('missing tRPC context factory');
  const ctx = await make({
    req: { executionDrain: controller() } as unknown as Request,
    res: {} as Response,
  });
  expect(ctx.executionDrain).toBeUndefined();
});

it('ordinary mode passes its original discriminator to HTTP and webhook callers', async () => {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  const ordinary = new OrdinaryMaintenance({
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
  const contexts = vi.spyOn(context, 'makeCreateContext');
  const hooks = vi.spyOn(webhook, 'createWebhookTasksHandler');
  const deps = { planner, executionDrain: ordinary, ordinaryMaintenance: ordinary };
  createHttpApp(deps);
  const factory = contexts.mock.results[0]?.value;
  if (!factory) throw new Error('context factory missing');
  expect((await factory({ req: {} as Request, res: {} as Response })).ordinaryMaintenance).toBe(
    ordinary,
  );
  expect(
    hooks.mock.calls[0]?.[0].buildContextForUser('synthetic-http-wiring').ordinaryMaintenance,
  ).toBe(ordinary);
});
