import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from '../../execution/drain-controller.js';
import { ExecutionDrain } from '../../execution/execution-drain.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-task-drain-')));
  roots.push(directory);
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
    wall: () => 100000,
    mono: () => 1000,
  });
  controllers.push(controller);
  let reads = 0;
  let dirtyAtRead = false;
  let resolveRead!: (rows: never[]) => void;
  const held = new Promise<never[]>((resolve) => {
    resolveRead = resolve;
  });
  const ctx = {
    userId: 'usr_synthetic',
    taskOrigin: 'web',
    executionDrain: controller,
    logger: pino({ level: 'silent' }),
    req: {},
    res: {},
    planner: {},
    db: {
      select() {
        reads++;
        dirtyAtRead = controller.state.read().dirty;
        return { from: () => ({ where: () => ({ limit: () => held }) }) };
      },
    },
  } as unknown as Context;
  return {
    controller,
    ctx,
    resolveRead,
    reads: () => reads,
    dirtyAtRead: () => dirtyAtRead,
    async open() {
      const session = controller.connect();
      const response = await controller.execute(
        session,
        Buffer.from(
          `${JSON.stringify({
            protocol: 1,
            op: 'open',
            ...identity,
            version: 2,
            serial: 1,
            expiresAt: 110000,
          })}\n`,
        ),
      );
      expect(response.ok).toBe(true);
      return session;
    },
  };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});

it.each(['create', 'reply'] as const)(
  'blocks %s before its first user/database lookup',
  async (kind) => {
    const f = fixture();
    f.resolveRead([]);
    const caller = tasksRouter.createCaller(f.ctx);
    const pending =
      kind === 'create'
        ? caller.create({ intent: '整理合成资料' })
        : caller.reply({ taskId: 'tsk_synthetic', message: '合成回复' });
    await expect(pending).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(f.reads()).toBe(0);
    expect(f.controller.state.read().dirty).toBe(false);
  },
);

it.each(['create', 'reply'] as const)(
  'owns and persists %s before the first awaited lookup',
  async (kind) => {
    const f = fixture();
    const session = await f.open();
    const caller = tasksRouter.createCaller(f.ctx);
    const pending = (
      kind === 'create'
        ? caller.create({ intent: '整理合成资料' })
        : caller.reply({ taskId: 'tsk_synthetic', message: '合成回复' })
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(f.reads()).toBe(1));
    expect(f.dirtyAtRead()).toBe(true);
    expect(f.controller.drain.snapshot()).toMatchObject({ roots: 1, idle: false });
    f.controller.disconnect(session);
    expect(f.controller.drain.snapshot().idle).toBe(false);
    f.resolveRead([]);
    expect(await pending).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  },
);

it('leaves schema rejection outside the side-effect scope', async () => {
  const f = fixture();
  await f.open();
  await expect(
    tasksRouter.createCaller(f.ctx).reply({ taskId: '', message: '' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(f.reads()).toBe(0);
  expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  expect(f.controller.state.read().dirty).toBe(false);
});

it('inherits a live same-controller parent after new-root admission closes', async () => {
  const f = fixture();
  const session = await f.open();
  const root = f.controller.runRoot(async (lifetime) => {
    f.controller.disconnect(session);
    return tasksRouter
      .createCaller({ ...f.ctx, executionLifetime: lifetime })
      .reply({ taskId: 'tsk_synthetic', message: '合成回复' });
  });
  const observed = root.result.catch((error: unknown) => error);
  await vi.waitFor(() => expect(f.reads()).toBe(1));
  expect(f.controller.drain.snapshot().children).toBeGreaterThan(0);
  f.resolveRead([]);
  expect(await observed).toMatchObject({ code: 'UNAUTHORIZED' });
});

it('refuses a foreign inherited lifetime without entering business code', async () => {
  const f = fixture();
  await f.open();
  const other = new ExecutionDrain();
  other.open();
  const owner = other.admit('request');
  f.resolveRead([]);
  await expect(
    tasksRouter
      .createCaller({ ...f.ctx, executionLifetime: { drain: other, owner } })
      .reply({ taskId: 'tsk_synthetic', message: '合成回复' }),
  ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  expect(f.reads()).toBe(0);
  expect(f.controller.drain.snapshot().mode).toBe('blocked');
});
