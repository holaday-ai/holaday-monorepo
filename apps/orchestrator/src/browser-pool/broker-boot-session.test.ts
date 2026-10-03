import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { DrainController } from '../execution/drain-controller.js';

const seam = vi.hoisted(() => ({ native: undefined as unknown, loads: 0 }));
vi.mock('./broker-native-loader.js', () => ({
  loadOriginalBrokerNative: () => {
    seam.loads++;
    return seam.native;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  seam.loads = 0;
});

function frame(data: object): Buffer {
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([a], [b]) => a.localeCompare(b, 'en')),
  );
  const raw = Buffer.from(JSON.stringify(sorted));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(raw.length);
  return Buffer.concat([header, raw]);
}

function fixture(mode = 'ok') {
  let nativeDeadline: bigint | undefined;
  const received: Buffer[] = [];
  const sent: Array<{ phase: string }> = [];
  let eof = false;
  let connected = mode !== 'pending';
  let closed = 0;
  let end = 0;
  const hooks = { check: () => {}, close: () => {}, write: () => {}, read: () => {} };
  const native = Object.freeze({
    ready: () => connected,
    check: () => {
      hooks.check();
    },
    read: () => {
      hooks.read();
      return received.shift() ?? (eof ? null : undefined);
    },
    write: (raw: Buffer) => {
      hooks.write();
      const data = JSON.parse(raw.subarray(4).toString());
      sent.push(data);
      if (data.phase === 'boot-hello') {
        const challenge = {
          ...data,
          phase: 'boot-challenge',
          epoch: 'c'.repeat(32),
          rootNonce: 'e'.repeat(32),
        };
        if (mode === 'wrong-boot') challenge.boot = 'f'.repeat(32);
        if (mode === 'echo-nonce') challenge.rootNonce = data.clientNonce;
        received.push(frame(challenge));
        if (mode === 'extra') received.push(Buffer.from('x'));
      } else {
        received.push(frame({ ...data, phase: 'boot-ack' }));
        eof = mode !== 'no-eof';
      }
      return raw.length;
    },
    end: () => {
      end++;
    },
    close: () => {
      closed++;
      hooks.close();
      if (mode === 'close-failure') throw new Error('synthetic');
    },
  });
  seam.native = Object.freeze({
    candidate: 'a'.repeat(40),
    boot: 'b'.repeat(32),
    control: Object.freeze({
      connectControl: (deadline?: bigint) => {
        nativeDeadline = deadline;
        return native;
      },
    }),
    egress: Object.freeze({
      createListener: () => {
        throw new Error('no business IO during boot');
      },
    }),
  });
  return {
    get nativeDeadline() {
      return nativeDeadline;
    },
    native,
    hooks,
    sent,
    get closed() {
      return closed;
    },
    get ended() {
      return end;
    },
    ready() {
      connected = true;
    },
    finish() {
      eof = true;
    },
  };
}

async function moduleUnderTest() {
  const module = await import('./broker-boot-session.js').catch(() => undefined);
  expect(module, 'private closed-boot owner is missing').toBeDefined();
  if (!module) throw new Error('boot module missing');
  return module;
}

it('passes the original pre-loader monotonic deadline into native IO, not a new duration', async () => {
  const f = fixture();
  const { BrokerBootSession } = await moduleUnderTest();
  const before = process.hrtime.bigint() / 1000000n;
  const session = BrokerBootSession.start();
  const after = process.hrtime.bigint() / 1000000n;
  await session.ready;
  expect(typeof f.nativeDeadline).toBe('bigint');
  expect(f.nativeDeadline).toBeGreaterThanOrEqual(before + 5000n);
  expect(f.nativeDeadline).toBeLessThanOrEqual(after + 5000n);
  await session.close();
});

it('boot owns fixed four-frame IO before exposing identity and loads the original bundle once', async () => {
  const f = fixture();
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  expect(() => BrokerBootSession.identity(session)).toThrow();
  await session.ready;
  expect(f.sent.map((data) => data.phase)).toEqual(['boot-hello', 'boot-accepted']);
  expect(f.closed).toBe(1);
  expect(f.ended).toBe(1);
  expect(BrokerBootSession.identity(session)).toEqual({
    candidate: 'a'.repeat(40),
    bootId: 'b'.repeat(32),
    epoch: 'c'.repeat(32),
  });
  expect(BrokerBootSession.takeNative(session)).toBe(seam.native);
  expect(() => BrokerBootSession.takeNative(session)).toThrow();
  expect(seam.loads).toBe(1);
  expect(JSON.stringify(session)).toBe('{}');
  await session.close();
});

it.each(['wrong-boot', 'echo-nonce', 'extra', 'close-failure'])(
  'boot refuses %s without an initialization receipt',
  async (mode) => {
    const f = fixture(mode);
    const { BrokerBootSession } = await moduleUnderTest();
    const session = BrokerBootSession.start();
    await expect(session.ready).rejects.toThrow();
    expect(() => BrokerBootSession.identity(session)).toThrow();
    expect(() => BrokerBootSession.takeNative(session)).toThrow();
    expect(f.closed).toBe(1);
    if (mode === 'close-failure') await expect(session.close()).rejects.toThrow();
    else await session.close();
  },
);

it('cancels a pending connection and owns its late readiness without sending', async () => {
  const f = fixture('pending');
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  const rejected = expect(session.ready).rejects.toThrow();
  await Promise.resolve();
  await session.close();
  f.ready();
  await rejected;
  expect(f.sent).toEqual([]);
  expect(f.closed).toBe(1);
});

it('ACK without original EOF is still pending and cannot initialize', async () => {
  const f = fixture('no-eof');
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  const rejected = expect(session.ready).rejects.toThrow();
  await vi.waitFor(() => expect(f.sent).toHaveLength(2));
  expect(() => BrokerBootSession.identity(session)).toThrow();
  await session.close();
  await rejected;
  expect(f.closed).toBe(1);
});

it('last native close cancellation cannot produce a success receipt', async () => {
  const f = fixture();
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  f.hooks.close = () => {
    void session.close();
  };
  await expect(session.ready).rejects.toThrow();
  expect(() => BrokerBootSession.identity(session)).toThrow();
  expect(f.closed).toBe(1);
  await session.close();
});

it.each(['read', 'close'])(
  'the last native %s cannot extend the five-second boot budget',
  async (boundary) => {
    const f = fixture();
    const { BrokerBootSession } = await moduleUnderTest();
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const session = BrokerBootSession.start();
    if (boundary === 'close')
      f.hooks.close = () => {
        now = 5100;
      };
    else
      f.hooks.read = () => {
        if (f.sent.length === 2) now = 5100;
      };
    await expect(session.ready).rejects.toThrow();
    expect(() => BrokerBootSession.identity(session)).toThrow();
    expect(f.closed).toBe(1);
    await session.close();
  },
);

it('late factory object is owned and closed after synchronous cancellation', async () => {
  const f = fixture();
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  seam.native = {
    ...(seam.native as object),
    control: {
      connectControl: () => {
        void session.close();
        return f.native;
      },
    },
  };
  await expect(session.ready).rejects.toThrow();
  await session.close();
  expect(f.closed).toBe(1);
  expect(f.sent).toEqual([]);
});

it('callers cannot replace the original pending boot receipt', async () => {
  fixture('pending');
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  const original = session.ready;
  const rejected = expect(original).rejects.toThrow();
  try {
    expect(Reflect.defineProperty(session, 'ready', { value: Promise.resolve() })).toBe(false);
  } finally {
    await session.close();
    await rejected;
  }
});

it('a real boot receipt neither accepts dirty old state nor substitutes an open verifier', async () => {
  fixture();
  const { BrokerBootSession } = await moduleUnderTest();
  const session = BrokerBootSession.start();
  await session.ready;
  const identity = BrokerBootSession.identity(session);
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'boot-state-')));
  let stateDirectory = directory;
  let controller: DrainController | undefined;
  try {
    const save = (dirty: boolean) =>
      writeFileSync(
        join(stateDirectory, 'state.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          epoch: identity.epoch,
          candidate: identity.candidate,
          bootId: 'f'.repeat(32),
          sequence: 1,
          mode: 'closed',
          dirty,
        })}\n`,
        { mode: 0o600 },
      );
    save(true);
    expect(() => new DrainController(directory, identity)).toThrow('DRAIN_STATE_RECOVERY_REQUIRED');
    // Failed old-state acquisition deliberately preserves its unknown lock.
    // An independent synthetic clean installation is not a retry/reset.
    stateDirectory = mkdtempSync(join(directory, 'clean-'));
    save(false);
    controller = new DrainController(stateDirectory, identity);
    const originalController = controller;
    expect(() => originalController.runRoot(async () => 1)).toThrow();
    const control = controller.connect();
    const result = await controller.execute(
      control,
      Buffer.from(
        `${JSON.stringify({
          protocol: 1,
          op: 'open',
          epoch: identity.epoch,
          candidate: identity.candidate,
          bootId: identity.bootId,
          version: 2,
          serial: 1,
          expiresAt: Date.now() + 5000,
        })}\n`,
      ),
    );
    expect(result).toMatchObject({ ok: false, code: 'OPEN_DENIED' });
    expect(controller.drain.snapshot().mode).not.toBe('open');
  } finally {
    controller?.state.abandon();
    rmSync(directory, { recursive: true });
    await session.close();
  }
});

it.each(['immediate', 'delayed', 'cancelled'])(
  'actual NAPI/Unix boot owns delayed replies, EOF and cancellation (%s)',
  async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'boot-unix-'));
    const leaf = join(directory, 'control.sock');
    const artifact = join(directory, 'control.node');
    const base = join(process.cwd(), '../../scripts/pool-broker');
    const peers = new Set<net.Socket>();
    const received: string[] = [];
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      peers.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => peers.delete(socket));
      socket.on('end', () => socket.end());
      let input = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        input = Buffer.concat([input, chunk]);
        if (input.length < 4 || input.length !== input.readUInt32BE(0) + 4) return;
        const data = JSON.parse(input.subarray(4).toString());
        input = Buffer.alloc(0);
        received.push(data.phase);
        if (data.phase === 'boot-hello') {
          const response = frame({
            ...data,
            phase: 'boot-challenge',
            epoch: 'c'.repeat(32),
            rootNonce: 'e'.repeat(32),
          });
          socket.write(response.subarray(0, 2));
          socket.write(response.subarray(2));
        } else socket.end(frame({ ...data, phase: 'boot-ack' }));
      });
    });
    const listen = () => new Promise<void>((resolve) => server.listen(leaf, resolve));
    const { BrokerBootSession } = await moduleUnderTest();
    let session: ReturnType<typeof BrokerBootSession.start> | undefined;
    try {
      execFileSync(
        '/usr/bin/clang',
        [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-bundle',
          '-undefined',
          'dynamic_lookup',
          '-I/usr/local/include/node',
          `-DHC_TEST_PATH=${JSON.stringify(leaf)}`,
          join(base, 'control_native_core.c'),
          join(base, 'control_native_napi.c'),
          join(base, 'tests-fixtures/control_native_socket.c'),
          '-o',
          artifact,
        ],
        { timeout: 20000, maxBuffer: 65536 },
      );
      seam.native = Object.freeze({
        candidate: 'a'.repeat(40),
        boot: 'b'.repeat(32),
        control: createRequire(import.meta.url)(artifact),
        egress: Object.freeze({}),
      });
      if (mode === 'immediate') await listen();
      session = BrokerBootSession.start();
      if (mode === 'cancelled') {
        const rejected = expect(session.ready).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 30));
        await session.close();
        await rejected;
        await listen();
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(received).toEqual([]);
        return;
      }
      if (mode === 'delayed') {
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(received).toEqual([]);
        await listen();
      }
      await session.ready;
      expect(received).toEqual(['boot-hello', 'boot-accepted']);
      expect(BrokerBootSession.identity(session).epoch).toBe('c'.repeat(32));
      expect(seam.loads).toBe(1);
    } finally {
      await session?.close();
      for (const peer of peers) peer.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true });
    }
  },
);
