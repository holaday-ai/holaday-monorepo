import { describe, expect, it } from 'vitest';
import { TaskExecutionOrder } from './task-execution-order';

describe('execution ordering boundary', () => {
  const one = { executionId: 'one', executionRevision: 1 };
  const two = { executionId: 'two', executionRevision: 2 };
  it('converges a same-revision conflict only from a fresh authoritative detail', () => {
    const order = new TaskExecutionOrder();
    order.accept('task', one, { source: 'event', terminal: true });
    const since = order.version('task');
    expect(
      order.accept('task', { ...one, executionId: 'truth' }, { source: 'detail', since }),
    ).toBe('new');
    expect(order.accept('task', one, { source: 'detail', since })).toBe('reconcile');
    expect(order.accept('task', { ...one, executionId: 'truth' }, { source: 'event' })).toBe(
      'same',
    );
  });
  it('requires reconciliation for a conflicting or unversioned unknown identity', () => {
    const order = new TaskExecutionOrder();
    expect(order.accept('task', one, { source: 'event' })).toBe('new');
    expect(order.accept('task', { ...one, executionId: 'other' }, { source: 'event' })).toBe(
      'reconcile',
    );
    expect(order.accept('task', { executionId: 'stranger' }, { source: 'event' })).toBe(
      'reconcile',
    );
    expect(order.version('task')).toBe(1);
  });
  it('allows a higher round after terminal, rejects old and late same-round streams', () => {
    const order = new TaskExecutionOrder();
    order.accept('task', one, { source: 'event', terminal: true });
    expect(order.accept('task', one, { source: 'event' })).toBe('ignore');
    expect(order.accept('task', two, { source: 'event' })).toBe('new');
    expect(order.accept('task', one, { source: 'event', terminal: true })).toBe('ignore');
  });
  it('protects legacy ACK with local observation version and allows a fresh explicit resume', () => {
    const order = new TaskExecutionOrder();
    const start = order.version('task');
    order.accept('task', {}, { source: 'event', terminal: true });
    expect(order.accept('task', {}, { source: 'ack', since: start })).toBe('ignore');
    expect(order.accept('task', {}, { source: 'ack', since: order.version('task') })).toBe('same');
    expect(order.accept('task', {}, { source: 'event' })).toBe('same');
  });
});

describe('FIX-34 · a core round handed to the browser lane', () => {
  const core = { executionId: 'exec-a', executionRevision: 3 };
  it('identity-less browser events are accepted after the hand-over', () => {
    const order = new TaskExecutionOrder();
    expect(order.accept('t', core, { source: 'event' })).toBe('new');
    expect(order.accept('t', {}, { source: 'event' })).toBe('ignore');
    order.handOver('t', core);
    expect(order.accept('t', {}, { source: 'event' })).toBe('same');
    expect(order.accept('t', {}, { source: 'event', terminal: true })).toBe('same');
  });
  it('a stale read of the old round no longer re-pins its identity', () => {
    const order = new TaskExecutionOrder();
    order.seed('t', core, false);
    order.handOver('t', core);
    const since = order.version('t');
    expect(order.accept('t', core, { source: 'detail', since })).toBe('same');
    order.seed('t', core, false);
    expect(order.accept('t', {}, { source: 'event' })).toBe('same');
  });
  it('a newer core round (a reply) takes ordering back', () => {
    const order = new TaskExecutionOrder();
    order.seed('t', core, false);
    order.handOver('t', core);
    expect(
      order.accept('t', { executionId: 'exec-b', executionRevision: 4 }, { source: 'event' }),
    ).toBe('new');
    expect(order.accept('t', {}, { source: 'event' })).toBe('ignore');
  });
  it('a quiet hand-over (row seen after a reload) keeps the read in flight valid', () => {
    const order = new TaskExecutionOrder();
    order.seed('t', core, false);
    const since = order.version('t');
    order.handOver('t', {}, false);
    expect(order.version('t')).toBe(since);
    expect(order.accept('t', {}, { source: 'detail', since })).toBe('same');
    const after = order.version('t');
    order.handOver('t', {}, false);
    expect(order.version('t')).toBe(after);
  });
  it('without a known identity there is nothing to hand over', () => {
    const order = new TaskExecutionOrder();
    order.handOver('t', {});
    expect(order.version('t')).toBe(0);
  });
});
