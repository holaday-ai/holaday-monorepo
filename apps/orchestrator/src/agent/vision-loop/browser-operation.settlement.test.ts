import { afterEach, expect, it } from 'vitest';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import { startOwnedOperation } from '../../execution/owned-operation.js';
import * as operations from './browser-operation.js';

const releases: Array<() => void> = [];
const all: Promise<unknown>[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(all.splice(0));
});
function gate(fail = false) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    if (fail) throw new Error('synthetic raw failure');
  });
  void wait.catch(() => {});
  releases.push(release);
  return { wait, release };
}
function observe<T>(promise: Promise<T>) {
  const state: { done: boolean; error?: unknown; value?: T } = { done: false };
  const finished = promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error) => {
      state.done = true;
      state.error = error;
    },
  );
  all.push(finished);
  return { state, finished };
}
async function flush() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
const settle = operations.withBrowserOperationSettlement;

it.each([false, true])(
  'waits raw settlement after the caller timeout (failure=%s)',
  async (fail) => {
    const raw = gate(fail);
    const done = observe(
      settle(async () => {
        const operation = operations.runBrowserOperation(() => raw.wait);
        void operation.catch(() => {});
        await Promise.race([operation, Promise.resolve('caller-timeout')]);
        return 'delivered';
      }),
    );
    await flush();
    expect(done.state.done).toBe(false);
    raw.release();
    await done.finished;
    expect(done.state.value).toBe('delivered');
  },
);
it('sealing stops escaped SDK dispatch while still waiting previously started IO', async () => {
  const raw = gate();
  const later = gate();
  let calls = 0;
  let escaped!: ReturnType<typeof observe>;
  const done = observe(
    settle(async (seal) => {
      void operations.runBrowserOperation(() => raw.wait);
      escaped = observe(
        later.wait.then(() =>
          operations.runBrowserOperation(() => {
            calls++;
          }),
        ),
      );
      seal();
    }),
  );
  await flush();
  later.release();
  await escaped.finished;
  expect(calls).toBe(0);
  expect(escaped.state.error).toBeDefined();
  expect(done.state.done).toBe(false);
  raw.release();
  await done.finished;
});
it('an escaped callback cannot create a fresh observer beneath a sealed parent', async () => {
  const later = gate();
  let calls = 0;
  let escaped!: ReturnType<typeof observe>;
  await settle(async () => {
    escaped = observe(
      later.wait.then(() =>
        settle(async () => {
          await operations.runBrowserOperation(() => {
            calls++;
          });
        }),
      ),
    );
  });
  later.release();
  await escaped.finished;
  expect(calls).toBe(0);
  expect(escaped.state.error).toBeDefined();
});
it('an ancestor waits nested raw work even if the nested result is not awaited', async () => {
  const raw = gate();
  const outer = observe(
    settle(async () => {
      observe(
        settle(async () => {
          void operations.runBrowserOperation(() => raw.wait);
        }),
      );
    }),
  );
  await flush();
  expect(outer.state.done).toBe(false);
  raw.release();
  await outer.finished;
});
it('preserves an action error while waiting physical work', async () => {
  const raw = gate();
  const error = new Error('synthetic action error');
  const done = observe(
    settle(async () => {
      void operations.runBrowserOperation(() => raw.wait);
      throw error;
    }),
  );
  await flush();
  expect(done.state.done).toBe(false);
  raw.release();
  await done.finished;
  expect(done.state.error).toBe(error);
});
it('does not wait on its own enclosing browser operation', async () => {
  const done = observe(
    operations.runBrowserOperation(() =>
      settle(async () => {
        await operations.runBrowserOperation(async () => 1);
        return 'nested';
      }),
    ),
  );
  await flush();
  expect(done.state.value).toBe('nested');
});
it('retains owned raw uncertainty without creating extra roots', async () => {
  const raw = gate(true);
  const drain = new ExecutionDrain();
  drain.open();
  const root = startOwnedOperation(
    drain,
    'request',
    () =>
      settle(async () => {
        void operations.runBrowserOperation(() => raw.wait).catch(() => {});
      }),
    { dispatch: 'immediate', errorOutcome: 'known' },
  );
  const done = observe(root.result);
  drain.close();
  await flush();
  expect(drain.snapshot().roots).toBe(1);
  expect(drain.snapshot().children).toBe(1);
  expect(done.state.done).toBe(false);
  raw.release();
  await done.finished;
  expect(drain.snapshot().active).toBe(0);
  expect(drain.snapshot().unknown).toBe(1);
});
