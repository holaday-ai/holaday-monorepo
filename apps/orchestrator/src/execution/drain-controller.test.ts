import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from './drain-controller.js';
import type { DrainOpenVerifier } from './drain-controller.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
function fixture(authorize?: DrainOpenVerifier) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-control-')));
  roots.push(directory);
  writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({ schemaVersion: 1, ...identity, bootId: 'd'.repeat(32), sequence: 1, mode: 'closed', dirty: false })}\n`,
    { mode: 0o600 },
  );
  const now = { wall: 100_000, mono: 1000 };
  const controller = new DrainController(directory, identity, authorize, {
    wall: () => now.wall,
    mono: () => now.mono,
  });
  controllers.push(controller);
  return { controller, directory, now };
}
function command(op = 'status', version = 2, serial = 1, overrides = {}) {
  return Buffer.from(
    `${JSON.stringify({ protocol: 1, op, ...identity, version, serial, expiresAt: 110_000, ...overrides })}\n`,
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});

it('cannot open if persisting the opening intent itself crosses the lease deadline', async () => {
  const { controller, now } = fixture(async () => {});
  const sync = fs.fsyncSync;
  vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
    sync(fd);
    now.wall = 110_001;
    now.mono = 11_001;
  });
  const reply = await controller.execute(controller.connect(), command('open'));
  expect(reply.ok).toBe(false);
  expect(controller.drain.snapshot().mode).toBe('closed');
});

it('never returns an opening receipt if its final disk read crosses the deadline', async () => {
  const { controller, now } = fixture(async () => {});
  const read = fs.readSync;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const count = read(...args);
    if (controller.drain.snapshot().mode === 'open') {
      now.wall = 110_001;
      now.mono = 11_001;
    }
    return count;
  }) as typeof fs.readSync);
  const reply = await controller.execute(controller.connect(), command('open'));
  expect(reply.ok).toBe(false);
  expect(controller.drain.snapshot().mode).toBe('closed');
});

it.each(['disconnect', 'expiry'])(
  'releases the control wait when a never-settling verifier loses %s',
  async (reason) => {
    const { controller, now } = fixture(() => new Promise<void>(() => {}));
    const session = controller.connect();
    const opening = controller.execute(session, command('open'));
    if (reason === 'disconnect') controller.disconnect(session);
    else {
      now.wall += 10_001;
      now.mono += 10_001;
      controller.tick();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      opening,
      new Promise<'still-waiting'>((done) => {
        timer = setTimeout(() => done('still-waiting'), 100);
      }),
    ]);
    if (timer) clearTimeout(timer);
    expect(result).not.toBe('still-waiting');
    expect(result).toMatchObject({ ok: false });
    const next = controller.connect();
    expect(
      await controller.execute(
        next,
        command('status', controller.state.read().sequence, 2, { expiresAt: now.wall + 5000 }),
      ),
    ).toMatchObject({ ok: true, counts: { mode: 'closed' } });
  },
);

it.each([() => undefined, async () => true, async () => false])(
  'rejects a malformed verifier result instead of treating it as authorization',
  async (verifier) => {
    const { controller } = fixture(verifier as unknown as DrainOpenVerifier);
    expect(await controller.execute(controller.connect(), command('open'))).toMatchObject({
      ok: false,
      code: 'OPEN_DENIED',
    });
    expect(controller.drain.snapshot().mode).toBe('closed');
  },
);

it.each(['resolve', 'reject'])(
  'observes late verifier %s without changing the replacement session',
  async (outcome) => {
    let done!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => {
      done = resolve;
      fail = reject;
    });
    const { controller } = fixture(() => pending);
    const session = controller.connect();
    const opening = controller.execute(session, command('open'));
    controller.disconnect(session);
    expect((await opening).ok).toBe(false);
    const next = controller.connect();
    if (outcome === 'resolve') done();
    else fail(new Error('synthetic late denial'));
    await Promise.resolve();
    expect(
      (await controller.execute(next, command('status', controller.state.read().sequence, 2))).ok,
    ).toBe(true);
    expect(
      await controller.execute(next, command('open', controller.state.read().sequence, 3)),
    ).toMatchObject({ ok: false, code: 'OPEN_CONSUMED' });
  },
);

it('opens only after authorization, then persists closure while accepted work drains', async () => {
  const { controller } = fixture(async (input) => {
    expect(input).toMatchObject({
      ...identity,
      op: 'open',
      version: 2,
      serial: 1,
      expiresAt: 110_000,
    });
  });
  const session = controller.connect();
  expect(await controller.execute(session, command('open'))).toMatchObject({
    ok: true,
    serial: 1,
    state: { sequence: 3, mode: 'open' },
    counts: { mode: 'open' },
  });
  controller.state.markDirty();
  const owner = controller.drain.admit('request');
  controller.disconnect(session);
  expect(controller.state.read()).toMatchObject({ mode: 'closed', dirty: true });
  const child = controller.drain.fork(owner, 'database');
  controller.drain.finish(owner);
  expect(controller.shutdown()).toBe(false);
  controller.drain.finish(child);
  expect(controller.shutdown()).toBe(true);
  expect(() => controller.connect()).toThrow('CONTROL_CLOSED');
});

it('returns fresh aggregate status and rejects replay without resetting ownership', async () => {
  const { controller } = fixture();
  const session = controller.connect();
  expect(await controller.execute(session, command())).toMatchObject({
    ok: true,
    serial: 1,
    state: { sequence: 3, mode: 'closed' },
    counts: { active: 0, unknown: 0, idle: true },
  });
  expect(await controller.execute(session, command('status', 3, 1))).toMatchObject({
    ok: false,
    code: 'STALE_COMMAND',
  });
});

it.each([
  [{ epoch: 'e'.repeat(16) }, 'IDENTITY_MISMATCH'],
  [{ bootId: 'e'.repeat(32) }, 'IDENTITY_MISMATCH'],
  [{ candidate: 'e'.repeat(40) }, 'IDENTITY_MISMATCH'],
  [{ version: 1 }, 'STALE_COMMAND'],
  [{ serial: 2 }, 'STALE_COMMAND'],
  [{ expiresAt: 100_000 }, 'EXPIRED'],
  [{ expiresAt: 1_000_001 }, 'EXPIRED'],
  [{ extra: true }, 'INVALID_COMMAND'],
  [{ protocol: 2 }, 'INVALID_COMMAND'],
  [{ version: 1.5 }, 'INVALID_COMMAND'],
  [{ op: 'reset' }, 'INVALID_COMMAND'],
] as const)('rejects invalid binding or fields %j', async (overrides, code) => {
  const { controller } = fixture(async () => {
    throw new Error('must not reach verifier');
  });
  expect(
    await controller.execute(controller.connect(), command('open', 2, 1, overrides)),
  ).toMatchObject({ ok: false, code });
  expect(controller.drain.snapshot().mode).toBe('closed');
});

it.each([
  Buffer.alloc(1537, 32),
  Buffer.from('{"protocol":1,"protocol":1}\n'),
  Buffer.from([0xff, 0x0a]),
  Buffer.from('null\n'),
  Buffer.from('[]\n'),
  Buffer.from('{}'),
])('rejects malformed bounded wire input without reflecting it', async (bytes) => {
  const { controller } = fixture();
  const reply = await controller.execute(controller.connect(), bytes);
  expect(reply).toEqual({ protocol: 1, ok: false, code: 'INVALID_COMMAND' });
});

it('cannot reopen after the one opening permit has been consumed', async () => {
  const { controller } = fixture(async () => {});
  const session = controller.connect();
  expect((await controller.execute(session, command('open'))).ok).toBe(true);
  expect((await controller.execute(session, command('close', 3, 2))).ok).toBe(true);
  expect(await controller.execute(session, command('open', 4, 3))).toMatchObject({
    ok: false,
    code: 'OPEN_CONSUMED',
  });
  expect(controller.drain.snapshot().mode).toBe('closed');
});

it('owns one session and ignores disconnects or commands from foreign objects', async () => {
  const { controller } = fixture(async () => {});
  const session = controller.connect();
  expect(() => controller.connect()).toThrow('CONTROL_BUSY');
  await controller.execute(session, command('open'));
  controller.disconnect({});
  expect(controller.drain.snapshot().mode).toBe('open');
  expect(await controller.execute({}, command('close', 3, 2))).toMatchObject({
    code: 'SESSION_INVALID',
  });
  expect(controller.drain.snapshot().mode).toBe('open');
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it.each(['disconnect', 'expiry', 'shutdown', 'state-drift'])(
  'does not reopen after pending authorization loses validity: %s',
  async (action) => {
    const pending = deferred();
    const { controller, now } = fixture(() => pending.promise);
    const session = controller.connect();
    const result = controller.execute(session, command('open'));
    if (action === 'disconnect') controller.disconnect(session);
    if (action === 'expiry') {
      now.wall += 10_001;
      now.mono += 10_001;
      controller.tick();
    }
    if (action === 'shutdown') controller.shutdown();
    if (action === 'state-drift') controller.state.checkpoint();
    pending.resolve();
    expect((await result).ok).toBe(false);
    expect(controller.drain.snapshot().mode).not.toBe('open');
  },
);

it('does not queue concurrent commands while one verifier is pending', async () => {
  const pending = deferred();
  const { controller } = fixture(() => pending.promise);
  const session = controller.connect();
  const opening = controller.execute(session, command('open'));
  expect(await controller.execute(session, command('status', 2, 2))).toMatchObject({
    ok: false,
    code: 'BUSY',
  });
  controller.disconnect(session);
  pending.resolve();
  expect((await opening).ok).toBe(false);
});

it.each(['wall-backward', 'mono-backward', 'mono-expiry', 'silence'])(
  'closes on unsafe clocks or control loss: %s',
  async (reason) => {
    const { controller, now } = fixture(async () => {});
    const session = controller.connect();
    await controller.execute(session, command('open', 2, 1, { expiresAt: 120_000 }));
    if (reason === 'wall-backward') now.wall--;
    if (reason === 'mono-backward') now.mono--;
    if (reason === 'mono-expiry') now.mono += 20_001;
    if (reason === 'silence') {
      now.wall += 10_001;
      now.mono += 10_001;
    }
    controller.tick();
    expect(controller.drain.snapshot().mode).toBe('closed');
    expect(controller.state.read().mode).toBe('closed');
  },
);

it('valid heartbeats do not renew the absolute opening deadline', async () => {
  const { controller, now } = fixture(async () => {});
  const session = controller.connect();
  await controller.execute(session, command('open'));
  now.wall += 5000;
  now.mono += 5000;
  expect(
    (await controller.execute(session, command('status', 3, 2, { expiresAt: 130_000 }))).ok,
  ).toBe(true);
  now.wall += 5001;
  now.mono += 5001;
  controller.tick();
  expect(controller.drain.snapshot().mode).toBe('closed');
});

it('keeps unknown outcomes dirty and refuses to release their writer', async () => {
  const { controller } = fixture(async () => {});
  await controller.execute(controller.connect(), command('open'));
  controller.state.markDirty();
  const owner = controller.drain.admit('database');
  controller.drain.markUnknown(owner);
  controller.drain.finish(owner);
  expect(controller.shutdown()).toBe(false);
  expect(controller.state.read()).toMatchObject({ mode: 'closed', dirty: true });
});

it('sanitizes verifier errors rather than returning arbitrary sensitive text', async () => {
  const { controller } = fixture(async () => {
    throw new Error('synthetic private error must not escape');
  });
  expect(await controller.execute(controller.connect(), command('open'))).toEqual({
    protocol: 1,
    ok: false,
    code: 'OPEN_DENIED',
  });
});

it('fails closed on durable state corruption before returning a status receipt', async () => {
  const { controller, directory } = fixture(async () => {});
  const session = controller.connect();
  await controller.execute(session, command('open'));
  writeFileSync(join(directory, 'state.json'), '{}');
  expect(await controller.execute(session, command('status', 3, 2))).toMatchObject({
    ok: false,
    code: 'STATE_UNAVAILABLE',
  });
  expect(controller.drain.snapshot().mode).toBe('blocked');
});

it('never opens admission without a trusted maintenance authorization verifier', async () => {
  const { controller, directory } = fixture();
  const session = controller.connect();
  const reply = await controller.execute(session, command('open'));
  expect(reply).toMatchObject({ ok: false, code: 'OPEN_DENIED' });
  expect(controller.drain.snapshot().mode).toBe('closed');
  expect(JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).mode).toBe('closed');
});
