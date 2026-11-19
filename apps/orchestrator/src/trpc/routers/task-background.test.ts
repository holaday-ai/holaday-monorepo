import { expect, it } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import {
  type MaintenanceRecord,
  OrdinaryMaintenance,
} from '../../execution/ordinary-maintenance.js';
import { currentOperationLifetime, startOwnedOperation } from '../../execution/owned-operation.js';
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

it('retains an execution-drain-only background owner after its HTTP request finishes', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const controller = { drain };
  let release!: () => void;
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let child!: Promise<void>;
  let requestOwner: unknown;
  await startOwnedOperation(
    drain,
    'request',
    async (owner) => {
      requestOwner = owner;
      const ctx = { executionDrain: controller, executionLifetime: { drain, owner } } as Context;
      child = runTaskBackground(ctx, async (childCtx) => {
        await held;
        const lifetime = currentOperationLifetime()!;
        expect(childCtx.executionLifetime).toBe(lifetime);
        expect(lifetime.owner).not.toBe(requestOwner);
        drain.assertDispatch(lifetime.owner);
      });
      void child.catch(() => {});
    },
    { errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
  const pending = drain.snapshot();
  drain.close();
  const wasIdle = drain.snapshot().idle;
  release();
  const childError = await child.then(
    () => null,
    (error: unknown) => error,
  );
  expect(pending).toMatchObject({ roots: 0, children: 1, byKind: { execution: 1 } });
  expect(wasIdle).toBe(false);
  expect(childError).toBeNull();
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true });
});

it('retains unknown failures with an execution-drain-only controller', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  await startOwnedOperation(
    drain,
    'request',
    async (owner) => {
      const ctx = { executionDrain: { drain }, executionLifetime: { drain, owner } } as Context;
      await runTaskBackground(ctx, async () => {
        throw new Error('unconfirmed result');
      }).catch(() => {});
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('refuses ended or mismatched execution-drain-only contexts before dispatch', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const other = new ExecutionDrain();
  other.open();
  let saved!: Context;
  let dispatched = false;
  await startOwnedOperation(
    drain,
    'request',
    async (owner) => {
      saved = { executionDrain: { drain }, executionLifetime: { drain, owner } } as Context;
      await expect(
        runTaskBackground({ ...saved, executionDrain: { drain: other } } as Context, async () => {
          dispatched = true;
        }),
      ).rejects.toThrow();
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  await expect(
    runTaskBackground(saved, async () => {
      dispatched = true;
    }),
  ).rejects.toThrow();
  expect(dispatched).toBe(false);
});
