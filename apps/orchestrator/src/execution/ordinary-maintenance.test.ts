import { afterEach, expect, it, vi } from 'vitest';
import {
  type MaintenanceChecks,
  type MaintenanceRecord,
  OrdinaryMaintenance,
} from './ordinary-maintenance.js';
import { type OwnedOperation, startOwnedOperation } from './owned-operation.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture(checks: Partial<MaintenanceChecks> = {}, dirty = false) {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: dirty };
  const writes: MaintenanceRecord[] = [];
  const journal = {
    read: () => structuredClone(record),
    persist(input: Omit<MaintenanceRecord, 'identity'>) {
      record = { identity, ...input };
      writes.push(structuredClone(record));
    },
  };
  const ready = vi.fn(async () => {});
  const stop = vi.fn(async () => {});
  const retained = vi.fn(async () => {});
  const m = new OrdinaryMaintenance({
    identity,
    journal,
    checks: {
      verifyReady: ready,
      stopProducers: stop,
      verifyRetainedQueue: retained,
      ...checks,
    },
  });
  return {
    m,
    journal,
    writes,
    ready,
    stop,
    retained,
    replace: (next: MaintenanceRecord) => {
      record = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

it('starts closed and rejects work before touching its action', () => {
  const { m } = fixture();
  let dispatched = false;
  expect(() =>
    m.runRoot(async () => {
      dispatched = true;
    }),
  ).toThrow();
  expect(dispatched).toBe(false);
  expect(m.snapshot().mode).toBe('closed');
});

it('persists dirty before the first action and only marks clean after drain', async () => {
  const f = fixture();
  await f.m.resumeServing();
  await f.m.runRoot(async () => {
    expect(f.journal.read()).toMatchObject({ mode: 'serving', needsReconciliation: true });
  }).result;
  expect(f.journal.read().needsReconciliation).toBe(true);
  await f.m.beginMaintenance();
  await f.m.waitForIdle(1000);
  expect(f.journal.read()).toMatchObject({ mode: 'closed', needsReconciliation: false });
});

it('waits for a child after its request has returned without cutting its dispatch scope', async () => {
  const f = fixture();
  const held = deferred();
  await f.m.resumeServing();
  let child!: OwnedOperation<void>;
  let continued = false;
  await f.m.runRoot(async (life) => {
    child = startOwnedOperation(
      f.m.drain,
      'execution',
      async (owner) => {
        await held.promise;
        f.m.drain.assertDispatch(owner);
        continued = true;
      },
      { parent: life.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
    );
  }).result;
  await f.m.beginMaintenance();
  expect(f.m.snapshot().counts).toMatchObject({ active: 1, idle: false });
  expect(() => f.m.runRoot(async () => {})).toThrow();
  held.resolve();
  await child.result;
  await f.m.waitForIdle(1000);
  expect(continued).toBe(true);
  expect(f.m.snapshot().mode).toBe('closed');
});

it('closes admission synchronously and shares the producer stop barrier', async () => {
  const held = deferred();
  let stops = 0;
  const f = fixture({
    stopProducers: async () => {
      stops++;
      await held.promise;
    },
  });
  await f.m.resumeServing();
  const stopping = f.m.beginMaintenance();
  expect(() => f.m.runRoot(async () => {})).toThrow();
  const again = f.m.beginMaintenance();
  expect(again).toBe(stopping);
  expect(f.m.snapshot().mode).toBe('draining');
  held.resolve();
  await stopping;
  await f.m.waitForIdle(1000);
  expect(stops).toBe(1);
});

it('never reopens when close overtakes an asynchronous ready check', async () => {
  const held = deferred();
  const f = fixture({ verifyReady: () => held.promise });
  const opening = f.m.resumeServing();
  const rejected = expect(opening).rejects.toThrow();
  await f.m.beginMaintenance();
  held.resolve();
  await rejected;
  expect(f.m.snapshot().mode).not.toBe('serving');
});

it('does not run readiness twice on simultaneous open requests', async () => {
  const held = deferred();
  const ready = vi.fn(() => held.promise);
  const f = fixture({ verifyReady: ready });
  const first = f.m.resumeServing();
  await expect(f.m.resumeServing()).rejects.toThrow();
  held.resolve();
  await first;
  expect(ready).toHaveBeenCalledTimes(1);
  await expect(f.m.resumeServing()).rejects.toThrow();
});

it('refuses to clear ambiguity inherited from an earlier process', async () => {
  const f = fixture({}, true);
  await expect(f.m.resumeServing()).rejects.toThrow();
  await expect(f.m.waitForIdle(1000)).rejects.toThrow();
  expect(f.ready).not.toHaveBeenCalled();
  expect(f.journal.read().needsReconciliation).toBe(true);
});

it('holds unknown task outcomes despite zero active promises', async () => {
  const f = fixture();
  await f.m.resumeServing();
  await expect(
    f.m.runRoot(async () => {
      throw new Error('remote outcome missing');
    }).result,
  ).rejects.toThrow();
  await f.m.beginMaintenance();
  await expect(f.m.waitForIdle(1000)).rejects.toThrow();
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.m.snapshot()).toMatchObject({ mode: 'blocked', counts: { active: 0, unknown: 1 } });
  await expect(f.m.resumeServing()).rejects.toThrow();
  expect(f.journal.read().needsReconciliation).toBe(true);
});

it.each(['stopProducers', 'verifyRetainedQueue'] as const)(
  'keeps maintenance when %s fails',
  async (name) => {
    const f = fixture({
      [name]: async () => {
        throw new Error('unproven');
      },
    });
    await f.m.resumeServing();
    if (name === 'stopProducers') await expect(f.m.beginMaintenance()).rejects.toThrow();
    else await f.m.beginMaintenance();
    await expect(f.m.waitForIdle(1000)).rejects.toThrow();
    expect(f.journal.read().needsReconciliation).toBe(true);
    expect(f.m.snapshot().mode).toBe('blocked');
  },
);

it('never opens after readiness failure', async () => {
  const f = fixture({
    verifyReady: async () => {
      throw new Error('not ready');
    },
  });
  await expect(f.m.resumeServing()).rejects.toThrow();
  expect(() => f.m.runRoot(async () => {})).toThrow();
});

it('refuses dispatch when its persisted identity has changed', async () => {
  const f = fixture();
  await f.m.resumeServing();
  f.replace({
    ...f.journal.read(),
    identity: { candidate: 'a'.repeat(40), bootId: 'c'.repeat(32) },
  });
  let called = false;
  expect(() =>
    f.m.runRoot(async () => {
      called = true;
    }),
  ).toThrow();
  expect(called).toBe(false);
  expect(f.m.snapshot().mode).toBe('blocked');
});

it.each(['read', 'persist'] as const)('fails closed when journal %s throws', async (name) => {
  const f = fixture();
  f.journal[name] = () => {
    throw new Error('disk unavailable');
  };
  await expect(f.m.resumeServing()).rejects.toThrow();
  expect(() => f.m.runRoot(async () => {})).toThrow();
});

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 600001, 1.5])(
  'rejects invalid timeout %s without changing state',
  async (timeout) => {
    const f = fixture();
    await expect(f.m.waitForIdle(timeout)).rejects.toThrow();
    expect(f.m.snapshot().mode).toBe('closed');
  },
);

it('times out without cancelling the original action or clearing dirty state', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const held = deferred();
  const f = fixture();
  await f.m.resumeServing();
  const task = f.m.runRoot(() => held.promise);
  await f.m.beginMaintenance();
  const waiting = expect(f.m.waitForIdle(50)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(51);
  await waiting;
  expect(f.m.snapshot().counts.active).toBe(1);
  expect(f.journal.read().needsReconciliation).toBe(true);
  held.resolve();
  await task.result;
  expect(vi.getTimerCount()).toBe(0);
});
