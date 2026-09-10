import { expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation } from '../execution/owned-operation.js';
import { type ModelOperation, runModelOperation } from './model-operation.js';

it('lets an already admitted model child complete after its parent logical scope seals', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let child!: Promise<unknown>;
  await startOwnedOperation(
    drain,
    'request',
    async () => {
      await runModelOperation(async () => {
        child = runModelOperation(async (operation) => {
          await operation.run(() => held);
          return operation.run(async () => 'finished');
        });
      });
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 1, idle: false });
  finish();
  await expect(child).resolves.toBe('finished');
  await vi.waitFor(() => expect(drain.snapshot().idle).toBe(true));
});

it('does not let an escaped cleanup capability dispatch after its physical operation has ended', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  let captured!: ModelOperation;
  await startOwnedOperation(
    drain,
    'request',
    async () => {
      await runModelOperation(async (operation) => {
        captured = operation;
        return 'done';
      });
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  drain.close();
  await vi.waitFor(() => expect(drain.snapshot().idle).toBe(true));
  const work = vi.fn(async () => {});
  captured.cleanup(work);
  expect(work).not.toHaveBeenCalled();
  expect(drain.snapshot().mode).toBe('blocked');
});

it('still disposes already acquired resources if the dispatch guard permanently blocks', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const disposed = vi.fn(async () => {});
  await startOwnedOperation(
    drain,
    'request',
    async () => {
      await runModelOperation(async (operation) => {
        await operation.run(async () => 'resource');
        drain.block();
        operation.cleanup(disposed);
      });
    },
    { errorOutcome: 'known', dispatch: 'immediate' },
  ).result;
  expect(disposed).toHaveBeenCalledTimes(1);
  expect(drain.snapshot()).toMatchObject({ active: 0, mode: 'blocked', idle: false });
});
