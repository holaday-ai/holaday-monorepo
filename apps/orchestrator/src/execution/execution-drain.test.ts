import { expect, it } from 'vitest';
import { ExecutionDrain } from './execution-drain.js';

it('blocks dispatch if the synchronous durable guard fails', () => {
  const drain = new ExecutionDrain(4, () => {
    throw new Error('synthetic state failure');
  });
  drain.open();
  const owner = drain.admit('request');
  expect(() => drain.assertDispatch(owner)).toThrow();
  expect(drain.snapshot().mode).toBe('blocked');
});

it('rechecks the owner after the dispatch guard returns', () => {
  const drain = new ExecutionDrain(4, () => {
    drain.finish(owner);
  });
  drain.open();
  const owner = drain.admit('request');
  expect(() => drain.assertDispatch(owner)).toThrow('EXECUTION_DRAIN_OWNER');
});

it('closes new admission while retaining already accepted child work', () => {
  const drain = new ExecutionDrain();
  expect(() => drain.admit('request')).toThrow('EXECUTION_DRAIN_CLOSED');
  drain.open();
  const root = drain.admit('request');
  drain.close();
  expect(() => drain.admit('request')).toThrow('EXECUTION_DRAIN_CLOSED');
  const child = drain.fork(root, 'suggestions');
  drain.finish(root);
  expect(drain.snapshot().idle).toBe(false);
  drain.finish(child);
  expect(drain.snapshot().idle).toBe(true);
});

it('does not reopen while an accepted operation is still active', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = drain.admit('request');
  drain.close();
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BUSY');
  expect(() => drain.admit('request')).toThrow('EXECUTION_DRAIN_CLOSED');
  drain.finish(root);
  drain.open();
  expect(drain.snapshot().idle).toBe(false);
});

it('cannot use released, copied or foreign handles to dispatch or decrement work', () => {
  const drain = new ExecutionDrain();
  const other = new ExecutionDrain();
  drain.open();
  other.open();
  const root = drain.admit('request');
  const foreign = other.admit('request');
  drain.close();
  for (const invalid of [{ ...root }, foreign]) {
    expect(drain.finish(invalid)).toBe(false);
    expect(() => drain.fork(invalid, 'database')).toThrow('EXECUTION_DRAIN_OWNER');
  }
  expect(drain.snapshot().active).toBe(1);
  expect(drain.finish(root)).toBe(true);
  expect(drain.finish(root)).toBe(false);
  expect(() => drain.fork(root, 'database')).toThrow('EXECUTION_DRAIN_OWNER');
});

it('retains grandchildren after the root and immediate parent have completed', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = drain.admit('request');
  const child = drain.fork(root, 'suggestions');
  drain.close();
  drain.finish(root);
  const grandchild = drain.fork(child, 'model');
  drain.finish(child);
  expect(drain.snapshot()).toMatchObject({ active: 1, roots: 0, children: 1, idle: false });
  drain.finish(grandchild);
  expect(drain.snapshot().idle).toBe(true);
});

it('keeps uncertain submission separate from a physically completed operation', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = drain.admit('request');
  const operation = drain.fork(root, 'database');
  const ticket = drain.markUnknown(operation);
  expect(drain.markUnknown(operation)).toBe(ticket);
  drain.finish(operation);
  drain.finish(root);
  drain.close();
  expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BUSY');
  expect(drain.reconcile({ ...ticket })).toBe(false);
  expect(drain.reconcile(ticket)).toBe(true);
  expect(drain.reconcile(ticket)).toBe(false);
  expect(drain.snapshot().idle).toBe(true);
});

it('reconciling an unknown result cannot finish its still-pending physical operation', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const operation = drain.admit('database');
  const ticket = drain.markUnknown(operation);
  drain.close();
  drain.reconcile(ticket);
  expect(drain.snapshot()).toMatchObject({ active: 1, unknown: 0, idle: false });
  drain.finish(operation);
  expect(drain.snapshot().idle).toBe(true);
});

it('does not allow cross-instance uncertainty tickets or late unknown markers', () => {
  const drain = new ExecutionDrain();
  const other = new ExecutionDrain();
  drain.open();
  const root = drain.admit('database');
  const ticket = drain.markUnknown(root);
  expect(other.reconcile(ticket)).toBe(false);
  expect(() => other.markUnknown(root)).toThrow('EXECUTION_DRAIN_OWNER');
  drain.finish(root);
  expect(() => drain.markUnknown(root)).toThrow('EXECUTION_DRAIN_OWNER');
  expect(drain.snapshot().unknown).toBe(1);
});

it('bounds outstanding ownership including physically finished unknown operations', () => {
  const drain = new ExecutionDrain(2);
  drain.open();
  const root = drain.admit('request');
  const child = drain.fork(root, 'database');
  const ticket = drain.markUnknown(child);
  drain.finish(child);
  expect(() => drain.admit('request')).toThrow('EXECUTION_DRAIN_CAPACITY');
  expect(() => drain.fork(root, 'model')).toThrow('EXECUTION_DRAIN_CAPACITY');
  drain.reconcile(ticket);
  const next = drain.fork(root, 'model');
  drain.close();
  drain.finish(root);
  drain.finish(next);
  expect(drain.snapshot().idle).toBe(true);
});

it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65_537])(
  'rejects unsafe capacity %s',
  (capacity) => {
    expect(() => new ExecutionDrain(capacity)).toThrow('EXECUTION_DRAIN_CAPACITY');
  },
);

it('permanently blocks dispatch and idle claims after an external safety failure', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = drain.admit('request');
  drain.block();
  expect(() => drain.fork(root, 'model')).toThrow('EXECUTION_DRAIN_BLOCKED');
  drain.finish(root);
  drain.close();
  expect(() => drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
  expect(drain.snapshot()).toMatchObject({ mode: 'blocked', active: 0, idle: false });
});

it('rejects arbitrary work labels without storing private text', () => {
  const drain = new ExecutionDrain();
  drain.open();
  expect(() => drain.admit('untrusted input' as 'request')).toThrow('EXECUTION_DRAIN_KIND');
  const root = drain.admit('request');
  expect(() => drain.fork(root, 'unknown' as 'model')).toThrow('EXECUTION_DRAIN_KIND');
  expect(drain.snapshot().active).toBe(1);
});

it('returns immutable aggregate-only snapshots', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const root = drain.admit('request');
  drain.fork(root, 'suggestions');
  drain.fork(root, 'database');
  const snapshot = drain.snapshot();
  expect(snapshot).toEqual({
    mode: 'open',
    active: 3,
    roots: 1,
    children: 2,
    unknown: 0,
    idle: false,
    byKind: { request: 1, execution: 0, suggestions: 1, database: 1, model: 0, scheduler: 0 },
  });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.byKind)).toBe(true);
  drain.finish(root);
  expect(snapshot.active).toBe(3);
});

it('grants raw-operation release to one private capability, not its public owner', () => {
  const drain = new ExecutionDrain();
  drain.open();
  const owner = drain.admit('model');
  const release = drain.pin(owner);
  expect(() => drain.pin(owner)).toThrow('EXECUTION_DRAIN_PINNED');
  drain.close();
  expect(drain.finish(owner)).toBe(false);
  expect(drain.snapshot().idle).toBe(false);
  expect(release()).toBe(true);
  expect(release()).toBe(false);
  expect(() => drain.pin(owner)).toThrow('EXECUTION_DRAIN_OWNER');
  expect(drain.snapshot().idle).toBe(true);
});
