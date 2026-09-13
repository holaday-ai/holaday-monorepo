import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { createEgressClientHandshake } from './broker-data-protocol.js';
import { BrokerEgressConnections } from './broker-egress-connections.js';

vi.mock('node:net', async (original) => {
  const actual = await original<typeof import('node:net')>();
  return { ...actual, connect: vi.fn(actual.connect) };
});

const scope = { candidate: 'aa'.repeat(20), boot: 'bb'.repeat(16), resource: 'cc'.repeat(16) };
const key = Buffer.alloc(32, 7);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function fixture(
  check = vi.fn(async (url: string) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] })),
  options: { guard?: () => void; accepted?: (socket: Socket) => void } = {},
) {
  const drain = new ExecutionDrain(1024, options.guard);
  drain.open();
  const boot = drain.admit('execution');
  const group = drain.admit('execution');
  const releaseBoot = drain.pin(boot);
  const releaseGroup = drain.pin(group);
  const broker = new BrokerEgressConnections({
    candidate: scope.candidate,
    boot: scope.boot,
    lifetime: { drain, owner: boot },
  });
  const registered = broker.register(scope, key, { drain, owner: group }, { policy: { check } });
  const directory = await mkdtemp(join(tmpdir(), 'pool-egress-auth-'));
  const path = join(directory, 'egress.sock');
  const sockets: Socket[] = [];
  const listener = createServer((socket) => {
    options.accepted?.(socket);
    broker.accept(socket);
  });
  await new Promise<void>((resolve) => listener.listen(path, resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await broker.close();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(directory, { recursive: true });
    releaseGroup();
    releaseBoot();
  });
  const client = async () => {
    const socket = connect(path);
    sockets.push(socket);
    socket.on('error', () => {});
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    return socket;
  };
  return { broker, registered, drain, client, check };
}

function read(socket: Socket, bytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let result = Buffer.alloc(0);
    const data = (chunk: Buffer) => {
      result = Buffer.concat([result, chunk]);
      if (result.length >= bytes) {
        socket.off('data', data);
        socket.off('close', closed);
        resolve(result);
      }
    };
    const closed = () => {
      socket.off('data', data);
      reject(new Error('synthetic short response'));
    };
    socket.on('data', data);
    socket.once('close', closed);
  });
}

describe('original-group egress connection handoff (listener installation is separate)', () => {
  it('reserves a resource before a reentrant proxy constructor can overwrite its original owner', async () => {
    const bootDrain = new ExecutionDrain();
    bootDrain.open();
    const boot = bootDrain.admit('execution');
    const releaseBoot = bootDrain.pin(boot);
    const broker = new BrokerEgressConnections({
      ...scope,
      lifetime: { drain: bootDrain, owner: boot },
    });
    let armed = true;
    let nested: ReturnType<BrokerEgressConnections['register']> | undefined;
    const drain = new ExecutionDrain(1024, () => {
      if (armed) {
        armed = false;
        try {
          nested = broker.register(scope, Buffer.alloc(32, 8), { drain, owner: inner });
        } catch {
          /* Expected reservation denial. */
        }
      }
    });
    drain.open();
    const outer = drain.admit('execution');
    const inner = drain.admit('execution');
    const releaseOuter = drain.pin(outer);
    const releaseInner = drain.pin(inner);
    try {
      broker.register(scope, key, { drain, owner: outer });
      await broker.close();
      expect(drain.snapshot().children).toBe(0);
      expect(nested).toBeUndefined();
    } finally {
      await nested?.close();
      await broker.close();
      releaseInner();
      releaseOuter();
      releaseBoot();
    }
  });

  for (const kind of ['group', 'all'] as const) {
    it(`synchronously seals the proxy when ${kind} close reenters the final dispatch guard`, async () => {
      let armed = false;
      let checks = 0;
      const f: Awaited<ReturnType<typeof fixture>> = await fixture(
        vi.fn(async (url: string) => {
          armed = true;
          return { allowed: true as const, url, addresses: ['127.0.0.1'] };
        }),
        {
          guard: () => {
            if (armed && ++checks === 2)
              void (kind === 'group' ? f.registered.close() : f.broker.close());
          },
        },
      );
      const socket = await f.client();
      const client = createEgressClientHandshake(scope, key);
      const challenge = read(socket, 154);
      socket.write(client.hello);
      const ack = client.answerChallenge(await challenge);
      const before = vi.mocked(connect).mock.calls.length;
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      socket.write(
        Buffer.concat([
          ack,
          Buffer.from('CONNECT public.example:45678 HTTP/1.1\r\nHost: public.example\r\n\r\n'),
        ]),
      );
      await closed;
      expect(vi.mocked(connect).mock.calls.slice(before)).toHaveLength(0);
    });
  }

  for (const boundary of ['auth-cleanup', 'proxy-guard'] as const) {
    it(`retains the original deadline through ${boundary} at the final HTTP handoff`, async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      let armed = false;
      let checks = 0;
      const f = await fixture(undefined, {
        accepted: (socket) =>
          socket.on('removeListener', (event) => {
            if (event === 'data' && !armed) {
              armed = true;
              if (boundary === 'auth-cleanup') vi.advanceTimersByTime(5001);
            }
          }),
        guard: () => {
          if (armed && boundary === 'proxy-guard' && ++checks === 3) vi.advanceTimersByTime(5001);
        },
      });
      const socket = await f.client();
      const client = createEgressClientHandshake(scope, key);
      const challenge = read(socket, 154);
      socket.write(client.hello);
      const ack = client.answerChallenge(await challenge);
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      socket.write(
        Buffer.concat([
          ack,
          Buffer.from(
            'GET http://public.example/ HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n',
          ),
        ]),
      );
      await closed;
      expect(f.check).not.toHaveBeenCalled();
    });
  }

  it('only replies to the fixed registered HPE1 probe and supports fragmented input', async () => {
    const f = await fixture();
    const socket = await f.client();
    const request = Buffer.concat([
      Buffer.from('HPE1'),
      Buffer.from([1]),
      Buffer.from(scope.candidate, 'hex'),
      Buffer.from(scope.resource, 'hex'),
      Buffer.from(scope.boot, 'hex'),
      Buffer.alloc(32, 9),
    ]);
    const response = read(socket, 89);
    for (let index = 0; index < request.length; index += 11) {
      socket.write(request.subarray(index, index + 11));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(await response).toEqual(
      Buffer.concat([Buffer.from('HPE1'), Buffer.from([2]), request.subarray(5)]),
    );
    expect(f.check).not.toHaveBeenCalled();
  });

  it('authenticates both endpoints and hands coalesced ACK plus HTTP to the group exactly once', async () => {
    const reached = vi.fn();
    const target = createHttpServer((_req, res) => {
      reached();
      res.end('synthetic-ok');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => target.close(() => resolve())));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('no target');
    const f = await fixture();
    const socket = await f.client();
    const client = createEgressClientHandshake(scope, key);
    const challenge = read(socket, 154);
    socket.write(client.hello);
    const ack = client.answerChallenge(await challenge);
    expect(f.check).not.toHaveBeenCalled();
    let response = '';
    socket.on('data', (chunk) => {
      response += chunk.toString();
    });
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    socket.write(
      Buffer.concat([
        ack,
        Buffer.from(
          `GET http://public.example:${address.port}/ HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n`,
        ),
      ]),
    );
    await closed;
    expect(response).toContain('200 OK');
    expect(response).toContain('synthetic-ok');
    expect(reached).toHaveBeenCalledTimes(1);
    expect(f.check).toHaveBeenCalledTimes(1);
  });

  it('never parses business content before authentication and refuses wrong group or key', async () => {
    const f = await fixture();
    const wrongKey = createEgressClientHandshake(scope, Buffer.alloc(32, 8));
    const wrongGroup = createEgressClientHandshake({ ...scope, resource: 'dd'.repeat(16) }, key);
    for (const data of [
      Buffer.from('GET http://public.example/ HTTP/1.1\r\n\r\n'),
      wrongKey.hello,
      wrongGroup.hello,
    ]) {
      const socket = await f.client();
      let responseBytes = 0;
      socket.on('data', (chunk) => {
        responseBytes += chunk.length;
      });
      const closed = new Promise<void>((resolve) => socket.once('close', resolve));
      socket.write(data);
      await closed;
      expect(responseBytes).toBe(0);
    }
    wrongKey.close();
    wrongGroup.close();
    expect(f.check).not.toHaveBeenCalled();
  });

  it('closes in-flight authentication with its original group and forbids registration reuse', async () => {
    const f = await fixture();
    const socket = await f.client();
    const client = createEgressClientHandshake(scope, key);
    const challenge = read(socket, 154);
    socket.write(client.hello);
    await challenge;
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    await f.registered.close();
    await closed;
    const replacement = f.drain.admit('execution');
    expect(() => f.broker.register(scope, key, { drain: f.drain, owner: replacement })).toThrow(
      'POOL_EGRESS_REGISTRATION_INVALID',
    );
    f.drain.finish(replacement);
    client.close();
    expect(f.check).not.toHaveBeenCalled();
  });

  it('does not extend the original authentication deadline when partial bytes arrive', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = await fixture();
    const socket = await f.client();
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    socket.write('HPG1');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(4999);
    socket.write(Buffer.from([1]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(socket.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await closed;
    expect(f.check).not.toHaveBeenCalled();
  });

  it('does not turn the completed authentication deadline into a business-session lease', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = await fixture();
    const socket = await f.client();
    const client = createEgressClientHandshake(scope, key);
    const challenge = read(socket, 154);
    socket.write(client.hello);
    socket.write(client.answerChallenge(await challenge));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(6000);
    expect(socket.destroyed).toBe(false);
    const closed = new Promise<void>((resolve) => socket.once('close', resolve));
    socket.write(
      'GET http://public.example:1/ HTTP/1.1\r\nHost: public.example\r\nConnection: close\r\n\r\n',
    );
    socket.resume();
    await closed;
    expect(f.check).toHaveBeenCalledTimes(1);
  });

  it('rejects hello business trailers, altered ACKs and over-limit authentication sockets', async () => {
    const f = await fixture();
    const client = createEgressClientHandshake(scope, key);
    const first = await f.client();
    const firstClosed = new Promise<void>((resolve) => first.once('close', resolve));
    first.write(Buffer.concat([client.hello, Buffer.from('GET / HTTP/1.1\r\n\r\n')]));
    await firstClosed;
    const second = await f.client();
    const challenge = read(second, 154);
    second.write(client.hello);
    const ack = client.answerChallenge(await challenge);
    ack[122] = ack.readUInt8(122) ^ 1;
    const secondClosed = new Promise<void>((resolve) => second.once('close', resolve));
    second.write(ack);
    await secondClosed;
    const held: Socket[] = [];
    for (let index = 0; index < 64; index++) held.push(await f.client());
    const extra = await f.client();
    if (!extra.destroyed) await new Promise<void>((resolve) => extra.once('close', resolve));
    expect(held.every((socket) => !socket.destroyed)).toBe(true);
    expect(f.check).not.toHaveBeenCalled();
  });
});
