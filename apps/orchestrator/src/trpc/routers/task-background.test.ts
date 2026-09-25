import { expect, it } from 'vitest';
import {
  type MaintenanceRecord,
  OrdinaryMaintenance,
} from '../../execution/ordinary-maintenance.js';
import { currentOperationLifetime } from '../../execution/owned-operation.js';
import type { Context } from '../context.js';
import { runTaskBackground } from './task-background.js';

function fixture() {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  const m = new OrdinaryMaintenance({
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
  const ctx = { ordinaryMaintenance: m, executionDrain: m } as unknown as Context;
  return { m, ctx };
}
it('reserves detached work before the request ends and binds the actual child context', async () => {
  const { m, ctx } = fixture();
  await m.resumeServing();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let child!: Promise<void>;
  let completed = false;
  await m.runRoot(async (life) => {
    child = runTaskBackground({ ...ctx, executionLifetime: life }, async (childCtx) => {
      expect(childCtx.executionLifetime).toBe(currentOperationLifetime());
      expect(childCtx.executionLifetime?.owner).not.toBe(life.owner);
      await held;
      completed = true;
    });
    void child.catch(() => {});
  }).result;
  await m.beginMaintenance();
  expect(m.snapshot().counts).toMatchObject({ roots: 0, children: 1, idle: false });
  release();
  await child;
  await m.waitForIdle(1000);
  expect(completed).toBe(true);
  expect(m.snapshot().mode).toBe('closed');
});
it('retains a failed original background action even if the caller logs and swallows it', async () => {
  const { m, ctx } = fixture();
  await m.resumeServing();
  await m.runRoot(async (life) => {
    await runTaskBackground({ ...ctx, executionLifetime: life }, async () => {
      throw new Error('unknown write');
    }).catch(() => {});
  }).result;
  expect(m.snapshot().counts.unknown).toBeGreaterThan(0);
});
it('never accepts a saved ended lifetime as a new background task', async () => {
  const { m, ctx } = fixture();
  await m.resumeServing();
  let saved = ctx;
  await m.runRoot(async (life) => {
    saved = { ...ctx, executionLifetime: life };
  }).result;
  let dispatched = false;
  await expect(
    runTaskBackground(saved, async () => {
      dispatched = true;
    }),
  ).rejects.toThrow();
  expect(dispatched).toBe(false);
});
it('preserves unconfigured legacy execution semantics', async () => {
  const ctx = {} as Context;
  expect(await runTaskBackground(ctx, async (original) => original === ctx)).toBe(true);
});
