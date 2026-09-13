import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { BrokerCreateClient } from './broker-client.js';
import {
  decodeBrokerControlFrame,
  encodeBrokerControlFrame,
  preparedBrokerControlDigest,
} from './broker-control-protocol.js';
import {
  BrokerNativeControlConnector,
  type OriginalNativeControlFactory,
} from './broker-native-control.js';

const candidate = 'a'.repeat(40);
const boot = 'b'.repeat(32);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('synthetic fixture missing');
  return value;
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function fixture(
  mode: 'ok' | 'scope' | 'premature' | 'short' | 'hold' = 'ok',
  useNative = false,
) {
  const drain = new ExecutionDrain();
  drain.open();
  const parent = drain.admit('execution');
  const releaseParent = drain.pin(parent);
  const directory = await mkdtemp(join(tmpdir(), 'pool-create-'));
  const path = join(directory, 'control.sock');
  const sockets: Socket[] = [];
  const phases: string[] = [];
  let registered = false;
  let complete = false;
  let serverFailure = false;
  let receivedAccepted!: () => void;
  const accepted = new Promise<void>((resolve) => {
    receivedAccepted = resolve;
  });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    let input = Buffer.alloc(0);
    let prepared: Buffer | undefined;
    socket.on('data', (chunk: Buffer) => {
      try {
        input = Buffer.concat([input, chunk]);
        if (input.length < 4 || input.length < input.readUInt32BE(0) + 4) return;
        const message = decodeBrokerControlFrame(input);
        input = Buffer.alloc(0);
        if ('action' in message) {
          phases.push(message.action);
          prepared = encodeBrokerControlFrame({
            version: 2,
            phase: 'prepared',
            candidate,
            boot,
            requestId: message.requestId,
            resource: 'c'.repeat(32),
            slot: mode === 'scope' ? 1 : 0,
            capability: 'd'.repeat(64),
            egressCapability: 'e'.repeat(64),
            nonce: 'f'.repeat(64),
          });
          if (mode === 'short') {
            socket.end(prepared.subarray(0, -1));
            return;
          }
          if (mode === 'premature') {
            socket.write(Buffer.concat([prepared, prepared]));
            return;
          }
          // Real fragmented stream, not a decoded DTO injected into the client.
          socket.write(prepared.subarray(0, 3));
          socket.write(prepared.subarray(3));
        } else {
          phases.push(message.phase);
          if (
            !registered ||
            message.phase !== 'accepted' ||
            !prepared ||
            message.preparedDigest !== preparedBrokerControlDigest(prepared)
          )
            throw new Error();
          complete = true;
          receivedAccepted();
          if (mode === 'hold') return;
          socket.end(encodeBrokerControlFrame({ ...message, phase: 'ready' }));
        }
      } catch {
        serverFailure = true;
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const nativeClosed = vi.fn(async () => {});
  const connector = {
    connect: vi.fn(() => {
      const socket = connect({ path, allowHalfOpen: true });
      sockets.push(socket);
      return {
        socket,
        check: vi.fn(() => {
          if (socket.destroyed) throw new Error();
        }),
        close: nativeClosed,
      };
    }),
  };
  const reservation = {
    assertLive: vi.fn(() => {
      if (!registered) throw new Error();
    }),
    ready: vi.fn(() => {
      if (!complete) throw new Error();
    }),
    close: vi.fn(async () => {}),
  };
  const reserve = vi.fn(() => {
    registered = true;
    return reservation;
  });
  let originalConnector: BrokerNativeControlConnector | undefined;
  if (useNative) {
    const base = join(process.cwd(), '../../scripts/pool-broker');
    const module = join(directory, 'control.node');
    // Actual addon/owned FD/checked-byte Duplex. Only Linux syscalls use the
    // explicitly compiled local-socket fixture, never a production fallback.
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
        `-DHC_TEST_PATH=${JSON.stringify(path)}`,
        join(base, 'control_native_core.c'),
        join(base, 'control_native_napi.c'),
        join(base, 'tests-fixtures/control_native_socket.c'),
        '-o',
        module,
      ],
      { timeout: 20_000, maxBuffer: 64 * 1024 },
    );
    const factory = createRequire(import.meta.url)(module) as OriginalNativeControlFactory;
    originalConnector = new BrokerNativeControlConnector({
      factory,
      lifetime: { drain, owner: parent },
    });
  }
  const client = new BrokerCreateClient({
    candidate,
    boot,
    lifetime: { drain, owner: parent },
    connector: originalConnector ?? connector,
  });
  cleanup.push(async () => {
    await client.close().catch(() => {});
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true });
    releaseParent();
  });
  return {
    client,
    connector,
    drain,
    phases,
    reserve,
    reservation,
    nativeClosed,
    accepted,
    invalidateReservation: () => {
      registered = false;
    },
    serverFailure: () => serverFailure,
  };
}

describe('original create client (native root/leaf verification remains a connector boundary)', () => {
  it('completes prepared/accepted/ready over the actual N-API-owned stream and private Duplex', async () => {
    const f = await fixture('ok', true);
    await f.client.start(0, f.reserve);
    expect(f.phases).toEqual(['create', 'accepted']);
    expect(f.reservation.ready).toHaveBeenCalledTimes(1);
    expect(f.serverFailure()).toBe(false);
    expect(f.drain.snapshot()).toMatchObject({ children: 0, unknown: 0 });
    await f.client.close();
  });
  it('does not accept a wrong prepared scope from the actual N-API stream', async () => {
    const f = await fixture('scope', true);
    await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.client.close();
    expect(f.phases).toEqual(['create']);
    expect(f.reserve).not.toHaveBeenCalled();
    expect(f.drain.snapshot().children).toBe(0);
  });
  it.each([5_001, 60_001])(
    'does not write create when the final arm clock passes the original deadline by %d',
    async (advance) => {
      const f = await fixture();
      const now = performance.now.bind(performance);
      let clocksAfterCheck = 0;
      let injected = false;
      const original = required(f.connector.connect.getMockImplementation());
      let written = 0;
      f.connector.connect.mockImplementation(() => {
        const connection = original();
        const write = connection.socket.write.bind(connection.socket);
        vi.spyOn(connection.socket, 'write').mockImplementation(
          (...args: Parameters<typeof write>) => {
            written++;
            return write(...args);
          },
        );
        return connection;
      });
      vi.spyOn(performance, 'now').mockImplementation(() => {
        const connection = f.connector.connect.mock.results[0]?.value;
        if (connection?.check.mock.calls.length === 1 && ++clocksAfterCheck === 2) {
          injected = true;
          return now() + advance;
        }
        return now();
      });
      try {
        await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
        await f.client.close();
        expect(injected).toBe(true);
        expect(written).toBe(0);
      } finally {
        vi.restoreAllMocks();
      }
    },
  );

  it('closes the original native object even if reading its socket throws', async () => {
    const f = await fixture();
    const original = required(f.connector.connect.getMockImplementation());
    f.connector.connect.mockImplementation(() => {
      const connection = original();
      const socket = connection.socket;
      socket.on('error', () => {});
      f.nativeClosed.mockImplementation(async () => {
        socket.destroy();
      });
      Object.defineProperty(connection, 'socket', {
        get() {
          throw new Error('synthetic getter');
        },
      });
      return connection;
    });
    await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await expect(f.client.close()).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    expect(f.nativeClosed).toHaveBeenCalledOnce();
    expect(f.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
  });

  it('settles failed destruction and still attempts both independent cleanups', async () => {
    const f = await fixture('hold');
    const result = f.client.start(0, f.reserve);
    const rejected = expect(result).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.accepted;
    const socket = required(f.connector.connect.mock.results[0]).value.socket;
    const destroy = vi.spyOn(socket, 'destroy').mockImplementation(() => {
      throw new Error('synthetic destroy');
    });
    try {
      await expect(f.client.close()).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
      await rejected;
      expect(f.nativeClosed).toHaveBeenCalledOnce();
      expect(f.reservation.close).toHaveBeenCalledOnce();
      expect(f.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
    } finally {
      destroy.mockRestore();
      socket.destroy();
    }
  });

  it('owns a reservation returned after it reenters close', async () => {
    const f = await fixture();
    await expect(
      f.client.start(0, () => {
        void f.client.close().catch(() => {});
        return f.reserve();
      }),
    ).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.client.close();
    expect(f.reservation.close).toHaveBeenCalledOnce();
    expect(f.phases).toEqual(['create']);
    expect(f.drain.snapshot().children).toBe(0);
  });

  it('does not promote ready when the final clock revokes its original reservation', async () => {
    const f = await fixture();
    const now = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => {
      if (f.nativeClosed.mock.calls.length) f.invalidateReservation();
      return now();
    });
    try {
      await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
      await f.client.close();
      expect(f.reservation.ready).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('owns a late original connection returned after reentrant close', async () => {
    const f = await fixture();
    const original = required(f.connector.connect.getMockImplementation());
    f.connector.connect.mockImplementation(() => {
      void f.client.close().catch(() => {});
      return original();
    });
    await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.client.close();
    expect(required(f.connector.connect.mock.results[0]).value.socket.destroyed).toBe(true);
    expect(f.nativeClosed).toHaveBeenCalledOnce();
    expect(f.drain.snapshot().children).toBe(0);
  });

  it('does not acknowledge after the original reservation is revoked at the last connector check', async () => {
    const f = await fixture();
    const original = required(f.connector.connect.getMockImplementation());
    f.connector.connect.mockImplementation(() => {
      const connection = original();
      const check = required(connection.check.getMockImplementation());
      connection.check.mockImplementation(() => {
        check();
        if (f.reserve.mock.calls.length) f.invalidateReservation();
      });
      return connection;
    });
    await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.client.close();
    expect(f.phases).toEqual(['create']);
    expect(f.reservation.ready).not.toHaveBeenCalled();
  });

  it('still closes the reservation when native cleanup rejects', async () => {
    const f = await fixture('hold');
    const result = f.client.start(0, f.reserve);
    const rejected = expect(result).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.accepted;
    f.nativeClosed.mockRejectedValueOnce(new Error('synthetic native close failure'));
    await expect(f.client.close()).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await rejected;
    expect(f.reservation.close).toHaveBeenCalledOnce();
    expect(f.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
  });

  it('never serializes capabilities held inside a legitimate private reservation', async () => {
    const f = await fixture();
    const original = required(f.reserve.getMockImplementation());
    await f.client.start(0, (message) => ({ ...original(), prepared: message }));
    const serialized = JSON.stringify(f.client);
    await f.client.close();
    expect(serialized).not.toContain('d'.repeat(64));
    expect(serialized).not.toContain('e'.repeat(64));
  });

  it('reserves before accepted, checks matching ready and actual EOF, and never retries', async () => {
    const f = await fixture();
    await f.client.start(0, f.reserve);
    expect(f.phases).toEqual(['create', 'accepted']);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.reservation.ready).toHaveBeenCalledOnce();
    expect(f.nativeClosed).toHaveBeenCalledOnce();
    expect(f.serverFailure()).toBe(false);
    expect(f.drain.snapshot()).toMatchObject({ children: 0, unknown: 0 });
    await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    expect(f.connector.connect).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.client)).not.toContain('d'.repeat(64));
  });

  it.each(['scope', 'premature', 'short'] as const)(
    'rejects %s without reserving or acknowledging',
    async (mode) => {
      const f = await fixture(mode);
      await expect(f.client.start(0, f.reserve)).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
      await f.client.close();
      expect(f.reserve).not.toHaveBeenCalled();
      expect(f.phases).toEqual(['create']);
      expect(f.drain.snapshot().unknown).toBe(1);
    },
  );

  it('does not treat an asynchronous reservation as synchronous egress readiness', async () => {
    const f = await fixture();
    await expect(
      f.client.start(0, (() => Promise.resolve(f.reservation)) as never),
    ).rejects.toThrow('POOL_BROKER_CREATE_INVALID');
    await f.client.close();
    expect(f.phases).toEqual(['create']);
    expect(f.reservation.ready).not.toHaveBeenCalled();
  });
});
