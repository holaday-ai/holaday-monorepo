import { expect, it } from 'vitest';
import { ExecutionDrain } from './execution-drain.js';
import { startOwnedOperation } from './owned-operation.js';

it('retains the raw operation when a caller stops waiting', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  let complete!: () => void;
  const held = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const operation = startOwnedOperation(drain, 'database', () => held, { errorOutcome: 'unknown' });
  drain.close();
  expect(await Promise.race([operation.result, Promise.resolve('caller-timeout')])).toBe(
    'caller-timeout',
  );
  expect(drain.snapshot().idle).toBe(false);
  complete();
  await operation.result;
  expect(drain.snapshot().idle).toBe(true);
});

it('retains an ambiguous failed write until authoritative reconciliation', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const failure = new Error('synthetic transport disconnect');
  const operation = startOwnedOperation(
    drain,
    'database',
    async () => {
      throw failure;
    },
    { errorOutcome: 'unknown' },
  );
  drain.close();
  await expect(operation.result).rejects.toBe(failure);
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  const ticket = operation.uncertainty();
  expect(ticket).not.toBeNull();
  if (!ticket) throw new Error('Expected an uncertainty capability');
  drain.reconcile(ticket);
  expect(drain.snapshot().idle).toBe(true);
});

it('isolates a known non-mutating failure without inventing uncertainty', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const failure = new Error('synthetic validation error');
  const operation = startOwnedOperation(
    drain,
    'request',
    async () => {
      throw failure;
    },
    { errorOutcome: 'known' },
  );
  drain.close();
  await expect(operation.result).rejects.toBe(failure);
  expect(operation.uncertainty()).toBeNull();
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true });
});

it('converts a synchronous ambiguous dispatch failure into a retained unknown result', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const operation = startOwnedOperation(
    drain,
    'model',
    () => {
      throw new Error('synthetic failure');
    },
    { errorOutcome: 'unknown' },
  );
  drain.close();
  await expect(operation.result).rejects.toThrow('synthetic failure');
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('reserves children synchronously before the parent finishes and the gate closes', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const parent = drain.admit('request');
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const child = startOwnedOperation(drain, 'suggestions', () => pending, {
    parent,
    errorOutcome: 'known',
  });
  drain.finish(parent);
  drain.close();
  expect(drain.snapshot()).toMatchObject({ roots: 0, children: 1, active: 1, idle: false });
  finish();
  await child.result;
  expect(drain.snapshot().idle).toBe(true);
});

it('allows an owned parent to finish its already accepted chain after closing admission', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const parent = drain.admit('request');
  drain.close();
  const child = startOwnedOperation(drain, 'database', async () => 42, {
    parent,
    errorOutcome: 'unknown',
  });
  expect(await child.result).toBe(42);
  expect(drain.snapshot().idle).toBe(false);
  drain.finish(parent);
  expect(drain.snapshot().idle).toBe(true);
});

it('does not dispatch when ownership cannot be acquired', async () => {
  const drain = new ExecutionDrain(1);
  drain.open();
  const parent = drain.admit('request');
  const values: number[] = [];
  expect(() =>
    startOwnedOperation(
      drain,
      'model',
      async () => {
        values.push(1);
      },
      { parent, errorOutcome: 'known' },
    ),
  ).toThrow('EXECUTION_DRAIN_CAPACITY');
  drain.close();
  expect(() =>
    startOwnedOperation(
      drain,
      'model',
      async () => {
        values.push(2);
      },
      { errorOutcome: 'known' },
    ),
  ).toThrow('EXECUTION_DRAIN_CLOSED');
  await Promise.resolve();
  expect(values).toEqual([]);
});

it('rejects an invalid failure classification before reserving or dispatching work', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const values: number[] = [];
  expect(() =>
    startOwnedOperation(
      drain,
      'database',
      async () => {
        values.push(1);
      },
      { errorOutcome: 'ignore' as 'known' },
    ),
  ).toThrow('EXECUTION_DRAIN_OUTCOME');
  await Promise.resolve();
  expect(values).toEqual([]);
  expect(drain.snapshot().active).toBe(0);
});

it('does not dispatch a reserved action after a permanent safety block', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const values: number[] = [];
  const operation = startOwnedOperation(
    drain,
    'model',
    async () => {
      values.push(1);
    },
    { errorOutcome: 'unknown' },
  );
  drain.block();
  await expect(operation.result).rejects.toThrow('EXECUTION_DRAIN_BLOCKED');
  expect(values).toEqual([]);
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: false });
});

it('does not let a caller release the raw owner before its dispatch microtask', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const values: number[] = [];
  const operation = startOwnedOperation(
    drain,
    'model',
    async () => {
      values.push(1);
    },
    { errorOutcome: 'unknown' },
  );
  void operation.result.catch(() => {});
  expect(drain.finish(operation.owner)).toBe(false);
  drain.close();
  expect(drain.snapshot().idle).toBe(false);
  await operation.result;
  expect(values).toEqual([1]);
  expect(drain.snapshot().idle).toBe(true);
});

it('does not let a caller release an already dispatched raw write before late success', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  let resolve!: (value: number) => void;
  const raw = new Promise<number>((done) => {
    resolve = done;
  });
  let entered = false;
  const operation = startOwnedOperation(
    drain,
    'database',
    () => {
      entered = true;
      return raw;
    },
    { errorOutcome: 'unknown' },
  );
  await Promise.resolve();
  expect(entered).toBe(true);
  expect(drain.finish(operation.owner)).toBe(false);
  drain.close();
  expect(drain.snapshot().idle).toBe(false);
  resolve(7);
  expect(await operation.result).toBe(7);
  expect(drain.snapshot().idle).toBe(true);
});

it('retains the original unknown failure after a caller tries to release its active owner', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  let reject!: (reason: Error) => void;
  const raw = new Promise<never>((_, fail) => {
    reject = fail;
  });
  const operation = startOwnedOperation(drain, 'database', () => raw, { errorOutcome: 'unknown' });
  await Promise.resolve();
  expect(drain.finish(operation.owner)).toBe(false);
  drain.close();
  const failure = new Error('synthetic delayed ambiguity');
  reject(failure);
  await expect(operation.result).rejects.toBe(failure);
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  expect(operation.uncertainty()).not.toBeNull();
});

it('rejects a missing dispatcher instead of counting an immediate successful no-op', () => {
  const drain = new ExecutionDrain();
  drain.open();
  expect(() =>
    startOwnedOperation(drain, 'model', undefined as unknown as () => Promise<void>, {
      errorOutcome: 'unknown',
    }),
  ).toThrow('EXECUTION_DRAIN_ACTION');
  expect(drain.snapshot().active).toBe(0);
});
