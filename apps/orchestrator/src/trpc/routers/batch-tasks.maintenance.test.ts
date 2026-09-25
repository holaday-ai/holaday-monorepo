import { afterEach, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import {
  OrdinaryMaintenance,
  type MaintenanceRecord,
} from '../../execution/ordinary-maintenance.js';
import { currentOperationLifetime } from '../../execution/owned-operation.js';
import type { Context } from '../context.js';
const execution = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../agent/batch-executor.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  insertBatch: vi.fn(async () => {}),
  executeBatch: execution.run,
}));
import { batchTasksRouter } from './batch-tasks.js';
vi.mock('./tasks.js', () => ({ tasksRouter: { createCaller: vi.fn() } }));
afterEach(() => vi.clearAllMocks());

it.each([false, true])(
  'batch detached lifetime survives request return and preserves failure=%s',
  async (fail) => {
    const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
    let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
    const m = new OrdinaryMaintenance({
      identity,
      journal: {
        read: () => record,
        persist: (value) => {
          record = { identity, ...value };
        },
      },
      checks: {
        verifyReady: async () => {},
        stopProducers: async () => {},
        verifyRetainedQueue: async () => {},
      },
    });
    const query = {
      from: () => query,
      where: () => query,
      limit: async () => [{ id: 1, externalId: 'usr_synthetic', plan: 'free' }],
    };
    const ctx = {
      ordinaryMaintenance: m,
      executionDrain: m,
      db: { select: () => query },
      req: {},
      res: {},
      userId: 'usr_synthetic',
      logger: pino({ level: 'silent' }),
    } as unknown as Context;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    execution.run.mockImplementationOnce(async () => {
      const current = currentOperationLifetime();
      expect(current?.drain).toBe(m.drain);
      await held;
      settled = true;
      if (fail) throw new Error('synthetic batch write unknown');
    });
    await m.resumeServing();
    await batchTasksRouter.createCaller(ctx).create({ prompts: ['synthetic'] });
    await vi.waitFor(() => expect(execution.run).toHaveBeenCalledOnce());
    try {
      expect(m.snapshot().counts.active).toBeGreaterThan(0);
      await m.beginMaintenance();
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await vi.waitFor(() => expect(settled).toBe(true));
    if (fail) {
      await vi.waitFor(() => expect(m.snapshot().counts.unknown).toBeGreaterThan(0));
      await expect(m.waitForIdle(100)).rejects.toThrow();
    } else {
      await m.waitForIdle(1000);
      expect(m.snapshot()).toMatchObject({ mode: 'closed', needsReconciliation: false });
    }
  },
);
