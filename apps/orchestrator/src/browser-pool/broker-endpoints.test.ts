import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { BrokerDataConnection } from './broker-endpoints.js';

const scope = { candidate: 'a'.repeat(40), boot: 'b'.repeat(32), resource: 'c'.repeat(32) };
const key = Buffer.alloc(32, 6);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
function frame(type: number, kind: number, client = Buffer.alloc(32), tag = Buffer.alloc(0)) {
  const header = Buffer.concat([
    Buffer.from('HPD1'),
    Buffer.from([type, kind]),
    Buffer.from(scope.candidate, 'hex'),
    Buffer.from(scope.resource, 'hex'),
    Buffer.from(scope.boot, 'hex'),
    Buffer.alloc(32, 7),
    client,
  ]);
  return Buffer.concat([
    header,
    createHmac('sha256', key)
      .update('HoladayPool/data-auth/v1\0')
      .update(header)
      .update(tag)
      .digest(),
  ]);
}
async function fixture(mode = 'ok', kind: 1 | 2 = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'data-peer-'));
  const path = join(directory, 'p.sock');
  const peers = new Set<net.Socket>();
  const clients = new Set<net.Socket>();
  const received: Buffer[] = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    peers.add(socket);
    socket.on('end', () => socket.end());
    socket.on('error', () => {});
    socket.once('close', () => peers.delete(socket));
    if (mode === 'silent') return;
    const challenge = frame(1, kind);
    if (mode === 'wrong-key') challenge[153] = challenge.readUInt8(153) ^ 1;
    socket.write(challenge.subarray(0, 50));
    socket.write(challenge.subarray(50));
    let response = Buffer.alloc(0);
    let authenticated = false;
    socket.on('data', (chunk: Buffer) => {
      if (authenticated) {
        received.push(Buffer.from(chunk));
        socket.write(chunk);
        return;
      }
      response = Buffer.concat([response, chunk]);
      if (response.length < 154) return;
      const expected = frame(2, kind, response.subarray(90, 122));
      if (!response.equals(expected)) {
        socket.destroy();
        return;
      }
      const ack = frame(3, kind, response.subarray(90, 122), response.subarray(122));
      if (mode === 'bad-ack') ack[153] = ack.readUInt8(153) ^ 1;
      authenticated = true;
      socket.write(Buffer.concat([ack, Buffer.from('synthetic-ready')]));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const connect = net.Socket.prototype.connect;
  const paths: string[] = [];
  const errors: Array<{ closed: boolean; children: number }> = [];
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    const options = args[0] as { path: string };
    clients.add(this);
    paths.push(options.path);
    let closed = false;
    this.once('close', () => {
      closed = true;
    });
    this.once('error', () => errors.push({ closed, children: drain.snapshot().children }));
    return Reflect.apply(connect, this, [
      { ...options, path: mode === 'missing' ? join(directory, 'missing.sock') : path },
    ]);
  } as typeof net.Socket.prototype.connect);
  const drain = new ExecutionDrain();
  drain.open();
  const parent = drain.admit('execution');
  const release = drain.pin(parent);
  cleanup.push(async () => {
    for (const socket of peers) socket.destroy();
    release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    drain,
    errors,
    clients,
    paths,
    received,
    options: { scope, key, kind, lifetime: { drain, owner: parent } },
  };
}
it.each([1, 2] as const)(
  'authenticates kind %s before delivering any business bytes and owns actual close',
  async (kind) => {
    const f = await fixture('ok', kind);
    const stream = await BrokerDataConnection.open(f.options);
    cleanup.push(() => stream.close());
    expect(f.paths).toEqual([
      `/run/holaday-pool-data/${scope.resource}/${kind === 1 ? 'cdp' : 'vnc'}.sock`,
    ]);
    expect(f.drain.snapshot().children).toBe(1);
    expect(JSON.stringify(stream)).toBe('{}');
    const first = await once(stream, 'data');
    expect(first[0].toString()).toBe('synthetic-ready');
    const echo = once(stream, 'data');
    stream.write('synthetic-business');
    expect((await echo)[0].toString()).toBe('synthetic-business');
    await stream.close();
    expect(f.drain.snapshot().children).toBe(0);
  },
);
it.each(['wrong-key', 'bad-ack'])(
  'rejects %s and releases only after actual socket close',
  async (mode) => {
    const f = await fixture(mode);
    await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
      'POOL_DATA_CONNECTION_INVALID',
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.received).toEqual([]);
    expect(f.drain.snapshot().children).toBe(0);
  },
);
it('refuses dispatch for a blocked original group', async () => {
  const f = await fixture();
  f.drain.block();
  await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
    'POOL_DATA_CONNECTION_INVALID',
  );
  expect(f.paths).toEqual([]);
  expect(f.drain.snapshot().children).toBe(0);
});
it('prevents a business write after the original group is blocked', async () => {
  const f = await fixture();
  const stream = await BrokerDataConnection.open(f.options);
  cleanup.push(() => stream.close());
  f.drain.block();
  stream.write('must-not-dispatch', () => {});
  await stream.close();
  expect(f.received).toEqual([]);
});

it('closes a silent original connection at its five-second authentication deadline', async () => {
  const f = await fixture('silent');
  await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
    'POOL_DATA_CONNECTION_INVALID',
  );
  expect(f.drain.snapshot().children).toBe(0);
  expect(f.paths).toHaveLength(1);
}, 10000);

it('keeps the child pinned through an actual ENOENT error until the original socket close event', async () => {
  const f = await fixture('missing');
  await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
    'POOL_DATA_CONNECTION_INVALID',
  );
  expect(f.errors).toEqual([{ closed: false, children: 1 }]);
  expect(f.drain.snapshot().children).toBe(0);
});

it('does not dispatch connect after the final original guard consumed the authentication budget', async () => {
  const f = await fixture();
  let now = 0;
  let calls = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const original = f.drain.assertDispatch.bind(f.drain);
  vi.spyOn(f.drain, 'assertDispatch').mockImplementation((owner) => {
    original(owner);
    if (++calls === 4) now = 5001;
  });
  await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
    'POOL_DATA_CONNECTION_INVALID',
  );
  expect(f.paths).toEqual([]);
});

it('vetoes a blocked original drain at the final fresh clock before connect', async () => {
  const f = await fixture();
  let calls = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    if (++calls === 5) f.drain.block();
    return 0;
  });
  await expect(BrokerDataConnection.open(f.options)).rejects.toThrow(
    'POOL_DATA_CONNECTION_INVALID',
  );
  expect(f.paths).toEqual([]);
});

it('keeps the original authentication deadline through final buffered business handoff', async () => {
  const f = await fixture();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const push = Duplex.prototype.push;
  vi.spyOn(Duplex.prototype, 'push').mockImplementation(function (
    this: Duplex,
    chunk: unknown,
    ...args: unknown[]
  ) {
    if (
      this instanceof BrokerDataConnection &&
      Buffer.isBuffer(chunk) &&
      chunk.equals(Buffer.from('synthetic-ready'))
    )
      now = 5001;
    return Reflect.apply(push, this, [chunk, ...args]);
  });
  const accepted = await BrokerDataConnection.open(f.options).then(
    (stream) => {
      cleanup.push(() => stream.close());
      return true;
    },
    () => false,
  );
  expect(accepted).toBe(false);
});

it('segments a legitimate large business write without closing or truncating it', async () => {
  const f = await fixture();
  const stream = await BrokerDataConnection.open(f.options);
  cleanup.push(() => stream.close());
  await once(stream, 'data');
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const data = Buffer.alloc(65537, 9);
  const error = await new Promise<Error | null | undefined>((resolve) =>
    stream.write(data, resolve),
  );
  expect(error).toBeFalsy();
  await vi.waitFor(() => expect(Buffer.concat(chunks)).toEqual(data));
  await stream.close();
  expect(Buffer.concat(f.received)).toEqual(data);
});

it('retains its child after real socket close while an original write completion remains pending', async () => {
  const f = await fixture();
  const stream = await BrokerDataConnection.open(f.options);
  cleanup.push(() => stream.close());
  await once(stream, 'data');
  const write = net.Socket.prototype.write;
  let deferred: (() => void) | undefined;
  vi.spyOn(net.Socket.prototype, 'write').mockImplementation(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    if (f.clients.has(this) && Buffer.isBuffer(args[0]) && args[0].equals(Buffer.alloc(16, 9))) {
      const complete = args[1] as (error?: Error | null) => void;
      return Reflect.apply(write, this, [
        args[0],
        (error?: Error | null) => {
          deferred = () => complete(error);
        },
      ]);
    }
    return Reflect.apply(write, this, args);
  } as typeof net.Socket.prototype.write);
  stream.write(Buffer.alloc(16, 9), () => {});
  await vi.waitFor(() => expect(deferred).toBeTypeOf('function'));
  let finished = false;
  const actual = [...f.clients][0];
  if (!actual) throw new Error('synthetic client missing');
  const physical = once(actual, 'close');
  const closing = stream.close().then(() => {
    finished = true;
  });
  await physical;
  try {
    expect(finished).toBe(false);
    expect(f.drain.snapshot().children).toBe(1);
  } finally {
    deferred?.();
    await closing;
  }
  expect(f.drain.snapshot().children).toBe(0);
});

it('preserves half-close while retaining the original end completion and incoming EOF', async () => {
  const f = await fixture();
  const stream = await BrokerDataConnection.open(f.options);
  cleanup.push(() => stream.close());
  await once(stream, 'data');
  stream.resume();
  const closed = once(stream, 'close');
  stream.end(Buffer.from('synthetic-final'));
  await closed;
  expect(Buffer.concat(f.received).toString()).toBe('synthetic-final');
  expect(f.drain.snapshot().children).toBe(0);
});
