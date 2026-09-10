import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRPCError } from '@trpc/server';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from '../../execution/drain-controller.js';
import {
  type OperationLifetime,
  currentOperationLifetime,
} from '../../execution/owned-operation.js';
import { type QueuedTaskInput, createTaskQueue } from '../../queue/task-queue.js';
import type { Context } from '../context.js';
import { enqueueTaskExecution } from './task-queue-execution.js';
import { markQueuedTaskExecutingOrThrow } from './task-queue-start.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
async function fixture(maxDepth = 10) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hd-caller-')));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'state.json'),
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
  const controller = new DrainController(dir, identity, async () => {}, {
    wall: () => 100_000,
    mono: () => 1000,
  });
  const session = controller.connect();
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
  let available = false;
  let now = 1000;
  const queue = createTaskQueue({
    executionDrain: controller,
    canDispatch: () => available,
    capacity: 1,
    tickMs: 10,
    maxDepth,
    queueTimeoutMs: 100,
    now: () => now,
  });
  cleanup.push(() => queue.stop());
  const ctx = { executionDrain: controller, taskQueue: queue, userId: 'synthetic-user' } as Context;
  return {
    ctx,
    controller,
    queue,
    close: () => controller.disconnect(session),
    dispatch: () => {
      available = true;
      queue.signalSlotFreed();
    },
    expire: () => {
      now = 2000;
      queue.signalSlotFreed();
    },
  };
}
async function flush() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}
function input(
  overrides: Partial<{
    runFn: (ctx: Context) => Promise<void>;
    onStart: (ctx: Context) => Promise<void> | void;
    onTimeout: (ctx: Context) => Promise<void> | void;
  }> = {},
) {
  return {
    taskId: 'synthetic-task',
    userId: 'synthetic-user',
    runFn: async () => {},
    onStart: () => {},
    ...overrides,
  };
}

it.each(['run', 'timeout'] as const)(
  'binds fresh callback contexts after parent ACK: %s',
  async (phase) => {
    const f = await fixture();
    const seen: OperationLifetime[] = [];
    let parent: OperationLifetime | undefined;
    let release!: () => void;
    const raw = new Promise<void>((r) => {
      release = r;
    });
    cleanup.push(release);
    const observe = (ctx: Context) => {
      const life = ctx.executionLifetime;
      expect(life).toBe(currentOperationLifetime());
      expect(life).toBeDefined();
      expect(life?.owner).not.toBe(parent?.owner);
      if (!life) throw new Error('missing callback lifetime');
      life.drain.assertDispatch(life.owner);
      seen.push(life);
    };
    const result = await f.controller.runRoot(async (life) => {
      parent = life;
      return enqueueTaskExecution(
        { ...f.ctx, executionLifetime: life },
        input({
          onStart: (ctx) => observe(ctx),
          runFn: async (ctx) => {
            observe(ctx);
            await raw;
          },
          onTimeout: async (ctx) => {
            observe(ctx);
            await raw;
          },
        }),
      );
    }).result;
    expect(result.kind).toBe('queued');
    f.close();
    if (phase === 'run') f.dispatch();
    else f.expire();
    await flush();
    expect(seen).toHaveLength(phase === 'run' ? 2 : 1);
    expect(f.controller.drain.snapshot().active).toBeGreaterThan(0);
    if (phase === 'run') expect(seen[0]?.owner).not.toBe(seen[1]?.owner);
    release();
    await flush();
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  },
);
it.each(['closed', 'unknown', 'stopped', 'missing-code'] as const)(
  'throws before caller failure write for %s rejection',
  async (mode) => {
    const f = await fixture(0);
    let writes = 0;
    if (mode === 'closed') f.close();
    if (mode === 'stopped') await f.queue.stop();
    if (mode === 'missing-code')
      f.ctx.taskQueue = { ...f.queue, enqueue: () => ({ kind: 'rejected', reason: 'synthetic' }) };
    const call = () => {
      const result = enqueueTaskExecution(f.ctx, input());
      if (result.kind === 'rejected') writes++;
    };
    if (mode === 'unknown' || mode === 'missing-code')
      await f.controller.runRoot(async (life) => {
        if (mode === 'unknown') life.drain.markUnknown(life.owner);
        f.ctx.executionLifetime = life;
        expect(call).toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
      }).result;
    else expect(call).toThrowError(expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }));
    expect(writes).toBe(0);
  },
);
it.each(['legacy', 'foreign', 'same'] as const)(
  'refuses controlled helper without parent before %s queue ACK',
  async (mode) => {
    const f = await fixture();
    const other = await fixture();
    const legacy = createTaskQueue({
      canDispatch: () => false,
      capacity: 1,
      tickMs: 10,
      maxDepth: 1,
      queueTimeoutMs: 100,
    });
    cleanup.push(() => legacy.stop());
    const queue = mode === 'legacy' ? legacy : mode === 'foreign' ? other.queue : f.queue;
    expect(() => enqueueTaskExecution({ ...f.ctx, taskQueue: queue }, input())).toThrowError(
      expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
    );
    expect(queue.size()).toBe(0);
    expect(f.controller.drain.snapshot().active).toBe(0);
    expect(other.controller.drain.snapshot().active).toBe(0);
  },
);
it('preserves explicitly classified capacity for existing caller handling', async () => {
  const f = await fixture(0);
  let writes = 0;
  await f.controller.runRoot(async (life) => {
    const result = enqueueTaskExecution({ ...f.ctx, executionLifetime: life }, input());
    if (result.kind === 'rejected') {
      expect(result.reasonCode).toBe('capacity');
      writes++;
    }
  }).result;
  expect(writes).toBe(1);
  expect(f.controller.drain.snapshot().active).toBe(0);
});
it('requires the parent to be the current dispatch context before queue ACK', async () => {
  const f = await fixture();
  let parent: OperationLifetime | undefined;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanup.push(release);
  const root = f.controller.runRoot(async (life) => {
    parent = life;
    await held;
  });
  expect(currentOperationLifetime()).toBeUndefined();
  expect(() => enqueueTaskExecution({ ...f.ctx, executionLifetime: parent }, input())).toThrowError(
    expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
  );
  expect(f.queue.size()).toBe(0);
  release();
  await root.result;
});
it.each(['missing', 'foreign', 'stale'] as const)(
  'rejects %s callback capability before business code',
  async (mode) => {
    const f = await fixture();
    const other = await fixture();
    let captured: QueuedTaskInput | undefined;
    let parent: OperationLifetime | undefined;
    const callbacks = vi.fn(async () => {});
    f.ctx.taskQueue = {
      ...f.queue,
      enqueue: (value) => {
        captured = value;
        return { kind: 'queued', position: 1 };
      },
    };
    await f.controller.runRoot(async (life) => {
      parent = life;
      enqueueTaskExecution({ ...f.ctx, executionLifetime: life }, input({ runFn: callbacks }));
    }).result;
    expect(captured).toBeDefined();
    if (!captured) throw new Error('queue did not receive input');
    const callback = captured.runFn;
    const invoke = async (life?: OperationLifetime) => {
      await expect(Promise.resolve().then(() => callback(life))).rejects.toThrow();
    };
    if (mode === 'foreign') await other.controller.runRoot(async (life) => invoke(life)).result;
    else await invoke(mode === 'stale' ? parent : undefined);
    expect(callbacks).not.toHaveBeenCalled();
  },
);
it('keeps unscoped legacy callbacks working', async () => {
  const q = createTaskQueue({
    canDispatch: () => true,
    capacity: 1,
    tickMs: 10,
    maxDepth: 1,
    queueTimeoutMs: 100,
  });
  cleanup.push(() => q.stop());
  const ctx = { taskQueue: q, userId: 'synthetic-user' } as Context;
  const seen: Context[] = [];
  enqueueTaskExecution(
    ctx,
    input({
      onStart: (bound) => {
        seen.push(bound);
      },
      runFn: async (bound) => {
        seen.push(bound);
      },
    }),
  );
  await flush();
  expect(seen).toEqual([ctx, ctx]);
  expect(seen[0]).toBe(ctx);
});

// These exact production blocks are currently behind the Qwen unmigrated-browser
// gate. Execute their parsed AST without bypassing that gate in the real router.
// This proves caller wiring, NOT live endpoint/browser/model readiness.
const source = ts.createSourceFile(
  'tasks.ts',
  readFileSync(new URL('./tasks.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  const matches: ts.Node[] = [];
  const walk = (node: ts.Node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, walk);
  };
  walk(source);
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new Error(`expected one production block; got ${matches.length}`);
  return match;
}
function compile(body: string, deps: Record<string, unknown>) {
  const js = ts.transpileModule(`return (async () => {${body}})();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(deps), js)(...Object.values(deps)) as Promise<unknown>;
}
function callerBody(direct: boolean) {
  const name = direct ? 'willQueueDirectOpen' : 'willQueueDispatch';
  return findNode(
    (node) =>
      ts.isIfStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      ts.isIdentifier(node.expression.left) &&
      node.expression.left.text === name,
  ).getText(source);
}
const quiet = { warn: () => {}, error: () => {}, info: () => {} };
it.each([true, false])(
  'actual queue caller does not persist safety refusal (direct=%s)',
  async (direct) => {
    const f = await fixture(0);
    let failed = 0;
    const repo = {
      markQueuedTaskFailed: async () => {
        failed++;
        return { persisted: true };
      },
    };
    await f.controller.runRoot(async (life) => {
      life.drain.markUnknown(life.owner);
      await expect(
        compile(callerBody(direct), {
          ctx: { ...f.ctx, executionLifetime: life, logger: quiet },
          taskId: 'synthetic-task',
          repo,
          willQueueDirectOpen: true,
          willQueueDispatch: true,
          dispatchDirectOpen: async () => {},
          dispatchToBrave: async () => {},
          TRPCError,
          enqueueTaskExecution,
        }),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }).result;
    expect(failed).toBe(0);
  },
);
it.each([true, false])(
  'actual queue caller preserves capacity failure (direct=%s)',
  async (direct) => {
    const f = await fixture(0);
    const codes: string[] = [];
    const repo = {
      markQueuedTaskFailed: async (_id: string, _reason: string, opts: { errorCode: string }) => {
        codes.push(opts.errorCode);
        return { persisted: true };
      },
    };
    await f.controller.runRoot(async (life) => {
      await expect(
        compile(callerBody(direct), {
          ctx: { ...f.ctx, executionLifetime: life, logger: quiet },
          taskId: 'synthetic-task',
          repo,
          willQueueDirectOpen: true,
          willQueueDispatch: true,
          dispatchDirectOpen: async () => {},
          dispatchToBrave: async () => {},
          TRPCError,
          enqueueTaskExecution,
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    }).result;
    expect(codes).toEqual(['QUEUE_REJECTED']);
  },
);
it.each([true, false])(
  'actual queue caller binds the deferred callback (direct=%s)',
  async (direct) => {
    const f = await fixture();
    const bound: Context[] = [];
    let transitions = 0;
    const dispatch = async (ctx: Context) => {
      bound.push(ctx);
      expect(ctx.executionLifetime).toBe(currentOperationLifetime());
      const life = ctx.executionLifetime;
      if (!life) throw new Error('missing callback lifetime');
      life.drain.assertDispatch(life.owner);
    };
    const repo = {
      markQueuedTaskExecuting: async () => {
        transitions++;
        return { persisted: true };
      },
      markQueuedTaskFailed: async () => ({ persisted: true }),
    };
    const parent = await f.controller.runRoot(async (life) => {
      const result = await compile(callerBody(direct), {
        ctx: { ...f.ctx, executionLifetime: life, logger: quiet },
        taskId: 'synthetic-task',
        repo,
        willQueueDirectOpen: true,
        willQueueDispatch: true,
        dispatchDirectOpen: dispatch,
        dispatchToBrave: dispatch,
        TRPCError,
        enqueueTaskExecution,
        markQueuedTaskExecutingOrThrow,
        broadcastToUser: () => {},
      });
      expect(result).toMatchObject({ status: 'queued' });
      return life;
    }).result;
    f.close();
    f.dispatch();
    await flush();
    expect(transitions).toBe(1);
    expect(bound).toHaveLength(1);
    expect(bound[0]?.executionLifetime?.owner).not.toBe(parent.owner);
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  },
);
it.each(['dispatchDirectOpen', 'dispatchToBrave'])(
  'actual %s uses supplied context, not stale closure',
  async (name) => {
    const declaration = findNode(
      (node) =>
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name,
    ) as ts.VariableDeclaration;
    const allocated: string[] = [];
    if (!declaration.initializer) throw new Error('missing dispatch function');
    const context = (label: string) => ({
      logger: quiet,
      userId: label,
      browserPool: {
        allocate: async () => {
          allocated.push(label);
          throw new Error('synthetic allocation refusal');
        },
      },
    });
    await compile(
      `const ${name} = ${declaration.initializer.getText(source)}; await ${name}(bound);`,
      {
        ctx: context('stale'),
        bound: context('fresh'),
        directOpenFallbackExecutor: null,
        directOpenUsesBrowserPool: true,
        input: {},
        taskId: 'synthetic-task',
        executionMode: 'browser',
        shouldUseBrowserPool: () => true,
        willQueueDirectOpen: false,
        willQueueDispatch: false,
        repo: { persistVisionOutcome: async () => ({ persisted: false }) },
        persistAndBroadcastBrowserDispatchFailure: async () => {},
        broadcastToUser: () => {},
      },
    );
    expect(allocated).toEqual(['fresh']);
  },
);
