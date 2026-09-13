import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({ bundle: undefined as unknown }));
// Only the Linux native transport boundary is synthetic. The boot protocol,
// persisted state, ownership, Unix server and open denial remain real.
vi.mock('../browser-pool/broker-native-loader.js', () => ({
  loadOriginalBrokerNative: () => seam.bundle,
}));
const cleanups: Array<() => void> = [];
const stops: Array<() => Promise<void>> = [];
function fixture(state: 'closed' | 'missing' | 'dirty' = 'closed') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-application-boot-')));
  cleanups.push(() => rmSync(directory, { recursive: true }));
  const identity = { epoch: 'c'.repeat(32), candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  if (state !== 'missing')
    writeFileSync(
      join(directory, 'state.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        ...identity,
        bootId: 'd'.repeat(32),
        sequence: 1,
        mode: 'closed',
        dirty: state === 'dirty',
      })}\n`,
      { mode: 0o600 },
    );
  const received: Buffer[] = [];
  let eof = false;
  let closed = 0;
  seam.bundle = Object.freeze({
    candidate: identity.candidate,
    boot: identity.bootId,
    control: Object.freeze({
      connectControl: () =>
        Object.freeze({
          ready: () => true,
          check() {},
          end() {},
          close() {
            closed++;
          },
          read: () => received.shift() ?? (eof ? null : undefined),
          write(raw: Buffer) {
            const data = JSON.parse(raw.subarray(4).toString());
            const next =
              data.phase === 'boot-hello'
                ? {
                    ...data,
                    phase: 'boot-challenge',
                    epoch: identity.epoch,
                    rootNonce: 'f'.repeat(32),
                  }
                : { ...data, phase: 'boot-ack' };
            const body = Buffer.from(
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(next).sort(([a], [b]) => a.localeCompare(b, 'en')),
                ),
              ),
            );
            const header = Buffer.alloc(4);
            header.writeUInt32BE(body.length);
            received.push(Buffer.concat([header, body]));
            eof = data.phase !== 'boot-hello';
            return raw.length;
          },
        }),
    }),
    egress: Object.freeze({
      createListener() {
        throw new Error('no business IO at boot');
      },
    }),
  });
  return { directory, identity, closed: () => closed };
}
async function load() {
  const name = './application-boot.js';
  const module = await import(name).catch(() => undefined);
  expect(module, 'controlled application bootstrap is missing').toBeDefined();
  if (!module) throw new Error('module missing');
  return module as typeof import('./application-boot.js');
}
afterEach(async () => {
  await Promise.allSettled(stops.splice(0).map((stop) => stop()));
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});
it('boot remains closed before application modules may start, even with a valid native handshake', async () => {
  const f = fixture();
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  stops.push(() => boot.close());
  expect(boot.controller.drain.snapshot()).toMatchObject({
    idle: true,
    active: 0,
    unknown: 0,
    mode: 'closed',
  });
  expect(boot.controller.state.read()).toMatchObject({
    ...f.identity,
    mode: 'closed',
    dirty: false,
  });
  expect(() => boot.controller.runRoot(async () => {})).toThrow('CONTROL_ADMISSION_CLOSED');
  expect(f.closed()).toBe(1);
});
it.each(['missing', 'dirty'] as const)(
  'boot refuses %s state rather than initializing or repairing it',
  async (state) => {
    const f = fixture(state);
    const { startApplicationBoot } = await load();
    const pending = startApplicationBoot(f.directory).then((boot) => {
      stops.push(() => boot.close());
      return boot;
    });
    await expect(pending).rejects.toThrow();
    expect(f.closed()).toBe(1);
  },
);
it('boot supplies no synthetic maintenance authority; a valid command cannot open it', async () => {
  const f = fixture();
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  stops.push(() => boot.close());
  const session = boot.controller.connect();
  const reply = await boot.controller.execute(
    session,
    Buffer.from(
      `${JSON.stringify({
        protocol: 1,
        op: 'open',
        ...f.identity,
        version: 2,
        serial: 1,
        expiresAt: Date.now() + 60000,
      })}\n`,
    ),
  );
  expect(reply).toMatchObject({ ok: false, code: 'OPEN_DENIED' });
  expect(boot.controller.drain.snapshot().mode).toBe('closed');
  boot.controller.disconnect(session);
});

it('resource shutdown retains the state owner until every original stop settles', async () => {
  const f = fixture();
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  stops.push(() => boot.close());
  const name = './application-resources.js';
  const module = await import(name).catch(() => undefined);
  expect(module, 'application resource shutdown owner is missing').toBeDefined();
  if (!module) return;
  const resources = module.createApplicationResources(boot);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  resources.add(() => held);
  let stopped = false;
  const pending = resources.stop();
  const observed = pending.then(() => {
    stopped = true;
  });
  try {
    expect(resources.stop()).toBe(pending);
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(boot.controller.state.read().mode).toBe('closed');
    expect(() => resources.add(async () => {})).toThrow();
  } finally {
    release();
  }
  await observed;
  expect(stopped).toBe(true);
});

it('one failed stop cannot skip other resources or produce a clean exit receipt', async () => {
  const f = fixture();
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  stops.push(() => boot.close());
  const name = './application-resources.js';
  const module = await import(name).catch(() => undefined);
  expect(module, 'application resource shutdown owner is missing').toBeDefined();
  if (!module) return;
  const resources = module.createApplicationResources(boot);
  const next = vi.fn(async () => {});
  resources.add(() => {
    throw new Error('synthetic cleanup failure');
  });
  resources.add(next);
  await expect(resources.stop()).rejects.toThrow();
  expect(next).toHaveBeenCalledOnce();
  expect(boot.controller.drain.snapshot()).toMatchObject({ mode: 'blocked', idle: false });
});

it('formal closed boot feeds the real dormant pool without legacy paths or business dispatch', async () => {
  const f = fixture();
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  stops.push(() => boot.close());
  const { BrowserPool } = await import('../browser-pool/browser-pool.js');
  const { pino } = await import('pino');
  const baseDir = join(f.directory, 'legacy-must-not-exist');
  const pool = BrowserPool.dormantStrict(
    {
      maxInstances: 2,
      idleTimeoutMs: 300000,
      baseDir,
      cdpPortStart: 9300,
      vncPortStart: 5910,
      wsPortStart: 6090,
      displayStart: 100,
      screenSize: '1280x800x24',
      vncEnabled: true,
    },
    pino({ level: 'silent' }),
    { drain: boot.controller.drain },
    boot.broker,
  );
  try {
    await expect(pool.allocate('synthetic-closed-task', 'synthetic-user')).rejects.toThrow();
    expect(existsSync(baseDir)).toBe(false);
    expect(boot.controller.drain.snapshot()).toMatchObject({ idle: true, active: 0, unknown: 0 });
  } finally {
    await pool.shutdown();
  }
});

it('boot revokes its original broker immediately while retaining a pending control close receipt', async () => {
  const f = fixture();
  const control = await import('./drain-control-server.js');
  const originalStart = control.startDrainControlServer;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(control, 'startDrainControlServer').mockImplementation(async (...args) => {
    const server = await originalStart(...args);
    return {
      close: async () => {
        const raw = server.close();
        await held;
        return raw;
      },
    };
  });
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  const { BrokerBootSession } = await import('../browser-pool/broker-boot-session.js');
  const pending = boot.close();
  try {
    expect(() => BrokerBootSession.assertReady(boot.broker)).toThrow();
    expect(boot.close()).toBe(pending);
  } finally {
    release();
    await pending;
  }
});

it('control close rejection never skips revoking the original broker', async () => {
  const f = fixture();
  const control = await import('./drain-control-server.js');
  const originalStart = control.startDrainControlServer;
  vi.spyOn(control, 'startDrainControlServer').mockImplementation(async (...args) => {
    const server = await originalStart(...args);
    return {
      close: async () => {
        await server.close();
        throw new Error('synthetic close error');
      },
    };
  });
  const { startApplicationBoot } = await load();
  const boot = await startApplicationBoot(f.directory);
  const { BrokerBootSession } = await import('../browser-pool/broker-boot-session.js');
  const close = vi.spyOn(BrokerBootSession.prototype, 'close');
  await expect(boot.close()).rejects.toThrow();
  expect(close).toHaveBeenCalledOnce();
  expect(() => BrokerBootSession.assertReady(boot.broker)).toThrow();
});
