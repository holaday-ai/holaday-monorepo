import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from '../execution/drain-controller.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';
import {
  type QueuedTaskInput,
  type TaskQueue,
  type TaskQueueConfig,
  createTaskQueue,
} from './task-queue.js';

const directories: string[] = [];
const controllers: DrainController[] = [];
const queues: TaskQueue[] = [];
const releases: Array<() => void> = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };

it.each(['closed', 'unknown', 'expired', 'sealed', 'missing-controller'] as const)(
  'prioritizes %s safety over a full queue',
  async (mode) => {
    const { controller, close } = await control();
    const queue = makeQueue(mode === 'missing-controller' ? undefined : controller, () => false, {
      maxDepth: 0,
    });
    let result: unknown;
    if (mode === 'closed') {
      close();
      result = queue.enqueue(input());
    } else if (mode === 'expired') {
      let saved: OperationLifetime | undefined;
      await controller.runRoot(async (life) => {
        saved = life;
      }).result;
      result = queue.enqueue(input({ executionLifetime: saved }));
    } else
      await controller.runRoot(async (life) => {
        if (mode === 'unknown') life.drain.markUnknown(life.owner);
        if (mode === 'sealed')
          withOperationDispatchScope((seal) => {
            seal();
            result = queue.enqueue(input({ executionLifetime: life }));
          });
        else result = queue.enqueue(input({ executionLifetime: life }));
      }).result;
    expect(result).toMatchObject({ kind: 'rejected', reasonCode: 'unavailable' });
    expect(queue.size()).toBe(0);
  },
);
it('classifies a proven full queue as capacity without reserving another owner', async () => {
  const { controller } = await control();
  const queue = makeQueue(controller, () => false, { maxDepth: 0 });
  expect(await enqueue(controller, queue)).toMatchObject({
    kind: 'rejected',
    reasonCode: 'capacity',
  });
  expect(controller.drain.snapshot().active).toBe(0);
});
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-task-queue-')));
  directories.push(directory);
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
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100_000,
    mono: () => 1000,
  });
  controllers.push(controller);
  const session = controller.connect();
  if (open)
    expect(
      (
        await controller.execute(
          session,
          Buffer.from(
            `${JSON.stringify({
              protocol: 1,
              op: 'open',
              ...identity,
              version: 2,
              serial: 1,
              expiresAt: 110_000,
            })}\n`,
          ),
        )
      ).ok,
    ).toBe(true);
  return { controller, directory, close: () => controller.disconnect(session) };
}
async function flush() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}
function held(fail = false) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  const promise = gate.then(() => {
    if (fail) throw new Error('synthetic late failure');
  });
  void promise.catch(() => {});
  return { promise, release };
}
function makeQueue(
  controller?: DrainController,
  canDispatch = () => true,
  overrides: Partial<TaskQueueConfig> = {},
) {
  const cfg: TaskQueueConfig = {
    executionDrain: controller,
    canDispatch,
    capacity: 1,
    tickMs: 10,
    maxDepth: 10,
    queueTimeoutMs: 100,
    ...overrides,
  };
  const queue = createTaskQueue(cfg);
  queues.push(queue);
  return queue;
}
type Input = QueuedTaskInput & { executionLifetime?: OperationLifetime };
function input(overrides: Partial<Input> = {}): Input {
  return {
    taskId: 'synthetic-task',
    userId: 'synthetic-user',
    onStart: () => {},
    runFn: async () => {},
    ...overrides,
  };
}
async function enqueue(controller: DrainController, queue: TaskQueue, value = input()) {
  return controller.runRoot(async (lifetime) =>
    queue.enqueue({ ...value, executionLifetime: lifetime } as Input),
  ).result;
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await flush();
  await Promise.all(queues.splice(0).map((q) => q.stop()));
  await flush();
  vi.useRealTimers();
  for (const c of controllers.splice(0)) c.state.abandon();
  for (const d of directories.splice(0)) rmSync(d, { recursive: true });
});
it('rejects closed root admission without adding an entry or dirtying state', async () => {
  const { controller } = await control(false);
  const queue = makeQueue(controller, () => false);
  expect(queue.enqueue(input()).kind).toBe('rejected');
  expect(queue.size()).toBe(0);
  expect(controller.state.read().dirty).toBe(false);
});
it('keeps queued ownership after parent ACK and preserves entries on stop', async () => {
  const { controller, close } = await control();
  const queue = makeQueue(controller, () => false);
  expect((await enqueue(controller, queue)).kind).toBe('queued');
  close();
  expect(controller.drain.snapshot().active).toBeGreaterThan(0);
  await queue.stop();
  expect(queue.size()).toBe(1);
  expect(controller.drain.snapshot().idle).toBe(false);
});
it.each(['onStart', 'runFn', 'onTimeout'] as const)(
  'waits for raw %s even after stop and slot signals',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const raw = held();
    const seen: Array<OperationLifetime | undefined> = [];
    const callback = (life?: OperationLifetime) => {
      seen.push(life);
      return raw.promise;
    };
    const queue = makeQueue(controller, () => phase !== 'onTimeout');
    await enqueue(controller, queue, input({ [phase]: callback }));
    if (phase === 'onTimeout') await vi.advanceTimersByTimeAsync(110);
    else await flush();
    close();
    queue.signalSlotFreed();
    let stopped = false;
    const stop = Promise.resolve(queue.stop()).then(() => {
      stopped = true;
    });
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.drain).toBe(controller.drain);
    expect(stopped).toBe(false);
    expect(controller.drain.snapshot().idle).toBe(false);
    if (seen[0]) expect(controller.drain.finish(seen[0].owner)).toBe(false);
    raw.release();
    await stop;
    await flush();
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each(['onStart', 'runFn', 'onTimeout'] as const)(
  'retains late %s rejection through the queue catch',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const raw = held(true);
    const queue = makeQueue(controller, () => phase !== 'onTimeout');
    await enqueue(controller, queue, input({ [phase]: () => raw.promise }));
    if (phase === 'onTimeout') await vi.advanceTimersByTimeAsync(110);
    else await flush();
    close();
    const stop = Promise.resolve(queue.stop());
    raw.release();
    await stop;
    await flush();
    expect(controller.drain.snapshot().active).toBe(0);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);
it('dispatches an already reserved entry after its parent ended and the gate closed', async () => {
  const { controller, close } = await control();
  let available = false;
  let calls = 0;
  let received: OperationLifetime | undefined;
  let current: OperationLifetime | undefined;
  const queue = makeQueue(controller, () => available);
  await enqueue(
    controller,
    queue,
    input({
      runFn: async (life) => {
        received = life;
        current = currentOperationLifetime();
        calls++;
      },
    }),
  );
  close();
  available = true;
  queue.signalSlotFreed();
  await flush();
  await queue.stop();
  expect(calls).toBe(1);
  expect(received).toBe(current);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it.each([
  'expired',
  'copied',
  'foreign',
  'sealed',
  'missing-controller',
  'missing-lifetime',
] as const)('rejects %s capability without queueing', async (mode) => {
  const { controller } = await control();
  const other = mode === 'foreign' ? (await control()).controller : controller;
  const queue = makeQueue(mode === 'missing-controller' ? undefined : other, () => false);
  if (mode === 'expired') {
    let saved: OperationLifetime | undefined;
    await controller.runRoot(async (life) => {
      saved = life;
    }).result;
    expect(queue.enqueue(input({ executionLifetime: saved })).kind).toBe('rejected');
  } else {
    await controller.runRoot(async (life) => {
      const value = input({
        executionLifetime:
          mode === 'missing-lifetime'
            ? undefined
            : mode === 'copied'
              ? { ...life, owner: { ...life.owner } }
              : life,
      });
      if (mode === 'sealed')
        withOperationDispatchScope((seal) => {
          seal();
          expect(queue.enqueue(value).kind).toBe('rejected');
        });
      else expect(queue.enqueue(value).kind).toBe('rejected');
    }).result;
  }
  expect(queue.size()).toBe(0);
});
it('never reaps or dispatches a queued entry while outcomes are unknown', async () => {
  vi.useFakeTimers();
  const { controller } = await control();
  let available = false;
  let calls = 0;
  const queue = makeQueue(controller, () => available);
  await enqueue(
    controller,
    queue,
    input({
      onStart: () => {
        calls++;
      },
      onTimeout: () => {
        calls++;
      },
    }),
  );
  await controller.runRoot(async (life) => {
    life.drain.markUnknown(life.owner);
  }).result;
  available = true;
  queue.signalSlotFreed();
  await vi.advanceTimersByTimeAsync(200);
  await queue.stop();
  expect(calls).toBe(0);
  expect(queue.size()).toBe(1);
  expect(controller.drain.snapshot().active).toBeGreaterThan(0);
});
it('keeps the next entry queued after onStart creates uncertainty', async () => {
  const { controller } = await control();
  let available = false;
  let runs = 0;
  const queue = makeQueue(controller, () => available);
  await enqueue(
    controller,
    queue,
    input({
      onStart: () => {
        throw new Error('synthetic start failed');
      },
      runFn: async () => {
        runs++;
      },
    }),
  );
  await enqueue(
    controller,
    queue,
    input({
      taskId: 'synthetic-second',
      runFn: async () => {
        runs++;
      },
    }),
  );
  available = true;
  queue.signalSlotFreed();
  await flush();
  await queue.stop();
  expect(runs).toBe(0);
  expect(queue.size()).toBe(1);
  expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
});
it('does not release raw work when runFn signals its slot early', async () => {
  const { controller, close } = await control();
  const raw = held();
  const queue = makeQueue(controller);
  await enqueue(
    controller,
    queue,
    input({
      runFn: () => {
        queue.signalSlotFreed();
        return raw.promise;
      },
    }),
  );
  await flush();
  close();
  expect(controller.drain.snapshot().active).toBeGreaterThan(0);
  raw.release();
  await queue.stop();
  await flush();
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('does not allocate a reservation for depth rejection', async () => {
  const { controller } = await control();
  const queue = makeQueue(controller, () => false, { maxDepth: 1 });
  await enqueue(controller, queue);
  const before = controller.drain.snapshot().active;
  expect((await enqueue(controller, queue)).kind).toBe('rejected');
  expect(queue.size()).toBe(1);
  expect(controller.drain.snapshot().active).toBe(before);
});
it.each(['blocked', 'guard'] as const)(
  'preserves waiting entries when %s prevents actual dispatch',
  async (mode) => {
    const { controller, directory } = await control();
    let available = false;
    let calls = 0;
    const queue = makeQueue(controller, () => available);
    await enqueue(
      controller,
      queue,
      input({
        onStart: () => {
          calls++;
        },
      }),
    );
    if (mode === 'blocked') controller.drain.block();
    else writeFileSync(join(directory, 'state.json'), 'invalid synthetic state\n', { mode: 0o600 });
    available = true;
    queue.signalSlotFreed();
    await flush();
    await queue.stop();
    expect(calls).toBe(0);
    expect(queue.size()).toBe(1);
    expect(controller.drain.snapshot().active).toBeGreaterThan(0);
  },
);
it('preserves legacy callback receiver and zero arguments', async () => {
  const queue = makeQueue();
  const seen: Array<[string | undefined, number]> = [];
  queue.enqueue(
    input({
      onStart: function (this: QueuedTaskInput, ...args: [OperationLifetime?]) {
        seen.push([this.taskId, args.length]);
      },
      runFn: async function (this: QueuedTaskInput, ...args: [OperationLifetime?]) {
        seen.push([this.taskId, args.length]);
      },
    }),
  );
  await flush();
  await queue.stop();
  expect(seen).toEqual([
    ['synthetic-task', 0],
    ['synthetic-task', 0],
  ]);
});
it('registers stop barrier before calling onStart', async () => {
  const { controller, close } = await control();
  const raw = held();
  const queue = makeQueue(controller);
  let stopped = false;
  let stop: Promise<void> | undefined;
  await enqueue(
    controller,
    queue,
    input({
      onStart: () => {
        stop = queue.stop().then(() => {
          stopped = true;
        });
        return raw.promise;
      },
    }),
  );
  close();
  await flush();
  expect(stopped).toBe(false);
  raw.release();
  await stop;
  expect(stopped).toBe(true);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('keeps a callback child active after the queue callback ACK', async () => {
  const { controller, close } = await control();
  const raw = held();
  let child: Promise<void> | undefined;
  const queue = makeQueue(controller);
  await enqueue(
    controller,
    queue,
    input({
      runFn: async (life) => {
        if (!life) throw new Error('missing callback lifetime');
        child = startOwnedOperation(life.drain, 'database', () => raw.promise, {
          parent: life.owner,
          errorOutcome: 'unknown',
          dispatch: 'immediate',
        }).result;
      },
    }),
  );
  await flush();
  close();
  await queue.stop();
  expect(controller.drain.snapshot().active).toBe(1);
  raw.release();
  await child;
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('does not reuse a callback lifetime after its ACK', async () => {
  const { controller } = await control();
  let saved: OperationLifetime | undefined;
  const queue = makeQueue(controller);
  await enqueue(
    controller,
    queue,
    input({
      runFn: async (life) => {
        saved = life;
      },
    }),
  );
  await flush();
  expect(saved).toBeDefined();
  expect(queue.enqueue(input({ executionLifetime: saved })).kind).toBe('rejected');
  expect(queue.size()).toBe(0);
});
it('releases a normal timeout with no callback', async () => {
  vi.useFakeTimers();
  const { controller, close } = await control();
  const queue = makeQueue(controller, () => false);
  await enqueue(controller, queue);
  close();
  await vi.advanceTimersByTimeAsync(110);
  await queue.stop();
  expect(queue.size()).toBe(0);
  expect(controller.drain.snapshot().idle).toBe(true);
});
it('reserves root enqueue before returning its ACK', async () => {
  const { controller, close } = await control();
  const queue = makeQueue(controller, () => false);
  expect(queue.enqueue(input()).kind).toBe('queued');
  close();
  expect(controller.state.read().dirty).toBe(true);
  expect(controller.drain.snapshot().active).toBe(1);
});
it.each(['onStart', 'onTimeout'] as const)(
  'records synchronous %s failure before another callback can dispatch',
  async (phase) => {
    vi.useFakeTimers();
    const { controller } = await control();
    let available = false;
    let second = 0;
    const queue = makeQueue(controller, () => available, { capacity: 2 });
    await enqueue(
      controller,
      queue,
      input({
        [phase]: () => {
          throw new Error('synthetic sync failure');
        },
      }),
    );
    await enqueue(
      controller,
      queue,
      input({
        taskId: 'synthetic-second',
        [phase]: () => {
          second++;
        },
      }),
    );
    if (phase === 'onTimeout') await vi.advanceTimersByTimeAsync(110);
    else {
      available = true;
      queue.signalSlotFreed();
      queue.signalSlotFreed();
      await flush();
    }
    await queue.stop();
    expect(second).toBe(0);
    expect(queue.size()).toBe(1);
    expect(controller.drain.snapshot().unknown).toBeGreaterThan(0);
  },
);

it('never exposes the queue release capability through the callback receiver', async () => {
  const { controller, close } = await control();
  const raw = held();
  let exposed: unknown;
  const queue = makeQueue(controller);
  await enqueue(
    controller,
    queue,
    input({
      onStart: function (this: unknown) {
        exposed = (this as { reservation?: { finish?: unknown } }).reservation?.finish;
        return raw.promise;
      },
    }),
  );
  close();
  await flush();
  expect(exposed).toBeUndefined();
  expect(controller.drain.snapshot().active).toBeGreaterThan(0);
  raw.release();
  await queue.stop();
  expect(controller.drain.snapshot().idle).toBe(true);
});
it.each(['dispatching', 'queue timeout'] as const)(
  'includes a callback in stop called by the %s logger',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    const raw = held();
    let stopped = false;
    let stop: Promise<void> | undefined;
    const queue = makeQueue(controller, () => phase === 'dispatching', {
      logger: (_level, message) => {
        if (message.includes(phase))
          stop = queue.stop().then(() => {
            stopped = true;
          });
      },
    });
    await enqueue(
      controller,
      queue,
      input({ runFn: () => raw.promise, onTimeout: () => raw.promise }),
    );
    if (phase === 'queue timeout') await vi.advanceTimersByTimeAsync(110);
    else await flush();
    close();
    expect(stop).toBeDefined();
    expect(stopped).toBe(false);
    raw.release();
    await stop;
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each(['dispatching', 'queue timeout'] as const)(
  'isolates %s logger errors without losing physical ownership',
  async (phase) => {
    vi.useFakeTimers();
    const { controller, close } = await control();
    let available = false;
    let calls = 0;
    const queue = makeQueue(controller, () => available, {
      logger: (_level, message) => {
        if (message.includes(phase)) throw new Error('synthetic logger error');
      },
    });
    await enqueue(
      controller,
      queue,
      input({
        runFn: async () => {
          calls++;
        },
        onTimeout: () => {
          calls++;
        },
      }),
    );
    available = phase === 'dispatching';
    close();
    let thrown: unknown;
    try {
      await vi.advanceTimersByTimeAsync(110);
    } catch (error) {
      thrown = error;
    }
    await queue.stop();
    expect(thrown).toBeUndefined();
    expect(calls).toBe(1);
    expect(controller.drain.snapshot().idle).toBe(true);
  },
);
it.each(['now', 'input', 'capacity'] as const)(
  'does not leak ownership or queue work when %s preparation throws',
  async (source) => {
    const { controller } = await control();
    const queue = makeQueue(
      controller,
      () => {
        if (source === 'capacity') throw new Error('synthetic capacity error');
        return false;
      },
      {
        now: () => {
          if (source === 'now') throw new Error('synthetic clock error');
          return 1000;
        },
      },
    );
    const value = input();
    if (source === 'input')
      Object.defineProperty(value, 'taskId', {
        get() {
          throw new Error('synthetic input error');
        },
        enumerable: true,
      });
    let rejected = false;
    try {
      rejected = queue.enqueue(value).kind === 'rejected';
    } catch {
      rejected = true;
    }
    await flush();
    await queue.stop();
    expect(rejected).toBe(true);
    expect(queue.size()).toBe(0);
    expect(controller.drain.snapshot().active).toBe(0);
  },
);
