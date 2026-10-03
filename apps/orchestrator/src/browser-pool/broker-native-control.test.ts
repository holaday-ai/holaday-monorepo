import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { BrokerNativeControlConnector } from './broker-native-control.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'native-control-'));
  const path = join(directory, 'c.sock');
  let accept!: (socket: Socket) => void;
  const accepted = new Promise<Socket>((resolve) => {
    accept = resolve;
  });
  const server = createServer({ allowHalfOpen: true }, accept);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const actual = connect({ path, allowHalfOpen: true });
  actual.on('error', () => {});
  await once(actual, 'connect');
  const peer = await accepted;
  peer.on('error', () => {});
  let eof = false;
  actual.on('end', () => {
    eof = true;
  });
  const drain = new ExecutionDrain();
  drain.open();
  const parent = drain.admit('execution');
  const release = drain.pin(parent);
  // Native syscall/identity seam only. Bytes travel over a real Unix stream.
  const native = {
    ready: vi.fn(() => true),
    check: vi.fn(() => {
      if (actual.destroyed) throw new Error();
    }),
    read: vi.fn(() => actual.read() ?? (eof ? null : undefined)),
    write: vi.fn((data: Buffer) => {
      actual.write(data);
      return data.length;
    }),
    end: vi.fn(() => {
      actual.end();
    }),
    close: vi.fn(() => {
      actual.destroy();
    }),
  };
  const factory = { connectControl: vi.fn(() => native) };
  const connector = new BrokerNativeControlConnector({
    factory,
    lifetime: { drain, owner: parent },
  });
  cleanup.push(async () => {
    actual.destroy();
    peer.destroy();
    release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { native, connector, drain, peer, factory };
}

it('keeps a native rendezvous pending without blocking the event loop or sending bytes', async () => {
  const s = await fixture();
  s.native.ready.mockReturnValue(false);
  const connection = s.connector.connect();
  try {
    expect(connection.socket.connecting).toBe(true);
    let ticks = 0;
    const tick = setInterval(() => ticks++, 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    clearInterval(tick);
    expect(ticks).toBeGreaterThan(0);
    expect(s.native.write).not.toHaveBeenCalled();
    expect(s.factory.connectControl).toHaveBeenCalledTimes(1);
    const connected = once(connection.socket, 'connect');
    s.native.ready.mockReturnValue(true);
    await connected;
    expect(connection.socket.connecting).toBe(false);
    const inbound = once(s.peer, 'data');
    connection.socket.write(Buffer.from('synthetic-after-rendezvous'));
    expect((await inbound)[0].toString()).toBe('synthetic-after-rendezvous');
  } finally {
    await connection.close();
  }
});

it('closing a pending rendezvous prevents a late connect event and native send', async () => {
  const s = await fixture();
  s.native.ready.mockReturnValue(false);
  const connection = s.connector.connect();
  const connected = vi.fn();
  connection.socket.on('connect', connected);
  try {
    expect(connection.socket.connecting).toBe(true);
    await connection.close();
    s.native.ready.mockReturnValue(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    expect(connected).not.toHaveBeenCalled();
    expect(s.native.write).not.toHaveBeenCalled();
    expect(s.native.close).toHaveBeenCalledTimes(1);
    expect(s.drain.snapshot().children).toBe(0);
  } finally {
    await connection.close();
  }
});

it('a rendezvous scope veto prevents native progress and a late connect event', async () => {
  const s = await fixture();
  s.native.ready.mockReturnValue(false);
  const connection = s.connector.connect();
  const connected = vi.fn();
  connection.socket.on('connect', connected);
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const calls = s.native.ready.mock.calls.length;
  s.drain.block();
  s.native.ready.mockReturnValue(true);
  await once(connection.socket, 'close');
  expect(s.native.ready).toHaveBeenCalledTimes(calls);
  expect(connected).not.toHaveBeenCalled();
  expect(s.native.write).not.toHaveBeenCalled();
});

it('a final native readiness callback cannot emit connect after revoking its scope', async () => {
  const s = await fixture();
  s.native.ready.mockImplementation(() => {
    s.drain.block();
    return true;
  });
  const connection = s.connector.connect();
  const connected = vi.fn();
  connection.socket.on('connect', connected);
  await once(connection.socket, 'close');
  expect(connected).not.toHaveBeenCalled();
  expect(s.native.close).toHaveBeenCalledTimes(1);
});

it('a pending rendezvous with failed physical cleanup keeps its original unknown owner', async () => {
  const s = await fixture();
  s.native.ready.mockReturnValue(false);
  const connection = s.connector.connect();
  s.native.close.mockImplementation(() => {
    throw new Error('synthetic-close');
  });
  await expect(connection.close()).rejects.toThrow('POOL_CONTROL_CLOSE_UNPROVEN');
  expect(s.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
  expect(s.factory.connectControl).toHaveBeenCalledTimes(1);
});

it('transports checked bytes through a private Duplex and releases only after native close', async () => {
  const s = await fixture();
  const connection = s.connector.connect();
  expect(s.drain.snapshot().children).toBe(1);
  const inbound = once(s.peer, 'data');
  connection.socket.write(Buffer.from('synthetic-request'));
  expect((await inbound)[0].toString()).toBe('synthetic-request');
  const received = once(connection.socket, 'data');
  s.peer.write('synthetic-response');
  expect((await received)[0].toString()).toBe('synthetic-response');
  expect(JSON.stringify(connection)).toBe('{}');
  await connection.close();
  expect(s.native.close).toHaveBeenCalledTimes(1);
  expect(s.drain.snapshot().children).toBe(0);
});

it('a blocked original scope cannot dispatch new native writes and still closes native ownership', async () => {
  const s = await fixture();
  const connection = s.connector.connect();
  s.drain.block();
  connection.socket.write(Buffer.from('never-sent'), () => {});
  await connection.close();
  expect(s.native.write).not.toHaveBeenCalled();
  expect(s.native.close).toHaveBeenCalledTimes(1);
});

it('native cleanup failure remains unknown and retains the original child', async () => {
  const s = await fixture();
  const connection = s.connector.connect();
  s.native.close.mockImplementation(() => {
    throw new Error('synthetic');
  });
  await expect(connection.close()).rejects.toThrow('POOL_CONTROL_CLOSE_UNPROVEN');
  expect(s.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
  expect(s.native.close).toHaveBeenCalledTimes(1);
});

it('nested finalization cannot release the outer native read before its original receipt', async () => {
  const s = await fixture();
  const connection = s.connector.connect();
  const during: number[] = [];
  s.native.read.mockImplementation(() => {
    void connection.close();
    during.push(s.native.close.mock.calls.length, s.drain.snapshot().children);
    return undefined;
  });
  connection.socket.resume();
  connection.socket.end(Buffer.from('synthetic-final'));
  await once(connection.socket, 'close');
  expect(during).toEqual([0, 1]);
  expect(s.native.close).toHaveBeenCalledTimes(1);
});

it('a throwing pending user callback cannot skip native cleanup or strand the close receipt', async () => {
  const s = await fixture();
  const connection = s.connector.connect();
  const callback = vi.fn(() => {
    throw new Error('synthetic-user-callback');
  });
  connection.socket.write(Buffer.from('synthetic-pending'), callback);
  try {
    await connection.close();
  } catch {}
  expect(callback).toHaveBeenCalledTimes(1);
  expect(s.native.close).toHaveBeenCalledTimes(1);
  expect(connection.socket.closed).toBe(true);
});

it('a pre-dispatch veto with zero native calls releases the child without inventing uncertainty', async () => {
  const drain = new ExecutionDrain(32, () => {
    throw new Error('synthetic-pre-dispatch');
  });
  drain.open();
  const parent = drain.admit('execution');
  const release = drain.pin(parent);
  const factory = { connectControl: vi.fn() };
  const connector = new BrokerNativeControlConnector({
    factory,
    lifetime: { drain, owner: parent },
  });
  expect(() => connector.connect()).toThrow('POOL_CONTROL_NATIVE_INVALID');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(factory.connectControl).not.toHaveBeenCalled();
  expect(drain.snapshot()).toMatchObject({ children: 0, unknown: 0 });
  release();
});
