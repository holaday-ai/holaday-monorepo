import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { BrokerEgressListener } from './broker-egress-listener.js';

const seam = vi.hoisted(() => ({ worker: false, server: undefined as unknown }));
vi.mock('node:cluster', () => ({
  default: {
    get isWorker() {
      return seam.worker;
    },
  },
}));
vi.mock('node:net', () => ({ createServer: () => seam.server }));

class Server extends EventEmitter {
  listening = false;
  listen = vi.fn((_options: unknown) => this);
  close = vi.fn(() => this);
}

function fixture() {
  const drain = new ExecutionDrain();
  drain.open();
  const boot = drain.admit('execution');
  const releaseBoot = drain.pin(boot);
  const server = new Server();
  seam.server = server;
  const native = { take: vi.fn(() => 42), close: vi.fn() };
  const factory = { createListener: vi.fn(() => native) };
  const connections = { accept: vi.fn(), close: vi.fn(async () => {}) };
  const listener = new BrokerEgressListener({
    lifetime: { drain, owner: boot },
    factory,
    connections,
  });
  return { drain, server, native, factory, connections, listener, releaseBoot };
}
afterEach(() => {
  seam.worker = false;
  vi.useRealTimers();
});

it('retains unknown if native creation failed with cleanup unproven before returning a handle', async () => {
  const f = fixture();
  f.factory.createListener.mockImplementation(() => {
    throw new Error('POOL_EGRESS_NATIVE_INVALID');
  });
  await expect(f.listener.start()).rejects.toThrow('POOL_EGRESS_LISTENER_INVALID');
  await expect(f.listener.close()).rejects.toThrow('POOL_EGRESS_CLOSE_UNPROVEN');
  expect(f.native.take).not.toHaveBeenCalled();
  expect(f.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
  f.releaseBoot();
});

it('publishes one close operation before registry cleanup can reenter it', async () => {
  const f = fixture();
  let nested: Promise<void> | undefined;
  let calls = 0;
  f.connections.close.mockImplementation(async () => {
    if (++calls === 1) nested = f.listener.close();
  });
  const closed = f.listener.close();
  await closed;
  expect(nested).toBe(closed);
  expect(f.connections.close).toHaveBeenCalledOnce();
  f.releaseBoot();
});

it('pins before creating and only releases after actual listener and connection shutdown', async () => {
  const f = fixture();
  expect(f.drain.snapshot().children).toBe(1);
  const ready = f.listener.start();
  expect(f.native.take).toHaveBeenCalledOnce();
  expect(f.server.listen).toHaveBeenCalledWith({ fd: 42, exclusive: true, backlog: 64 });
  f.server.listening = true;
  f.server.emit('listening');
  await ready;
  let release!: () => void;
  f.connections.close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let done = false;
  const closed = f.listener.close().then(() => {
    done = true;
  });
  f.server.listening = false;
  f.server.emit('close');
  await Promise.resolve();
  expect(done).toBe(false);
  expect(f.drain.snapshot().children).toBe(1);
  release();
  await closed;
  expect(f.drain.snapshot().children).toBe(0);
  expect(f.native.close).not.toHaveBeenCalled();
  f.releaseBoot();
});

it('rejects cluster workers before taking a native FD, not relying on exclusive', async () => {
  const f = fixture();
  seam.worker = true;
  await expect(f.listener.start()).rejects.toThrow('POOL_EGRESS_LISTENER_INVALID');
  await f.listener.close();
  expect(f.factory.createListener).not.toHaveBeenCalled();
  expect(f.drain.snapshot().children).toBe(0);
  f.releaseBoot();
});

for (const failure of ['take', 'sync-listen', 'async-listen', 'timeout'] as const) {
  it(`retains unknown original FD ownership after ${failure}, even an empty server close`, async () => {
    vi.useFakeTimers();
    const f = fixture();
    if (failure === 'take')
      f.native.take.mockImplementation(() => {
        throw new Error('private');
      });
    if (failure === 'sync-listen')
      f.server.listen.mockImplementation(() => {
        throw new Error('private');
      });
    const ready = f.listener.start();
    const rejection = expect(ready).rejects.toThrow('POOL_EGRESS_LISTENER_INVALID');
    if (failure === 'async-listen') f.server.emit('error', new Error('private'));
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5001);
    await rejection;
    f.server.emit('close');
    await expect(f.listener.close()).rejects.toThrow('POOL_EGRESS_CLOSE_UNPROVEN');
    expect(f.native.close).not.toHaveBeenCalled();
    expect(f.drain.snapshot()).toMatchObject({ children: 1, unknown: 1 });
    await expect(f.listener.start()).rejects.toThrow();
    expect(f.native.take).toHaveBeenCalledOnce();
    f.releaseBoot();
  });
}

it('close seals before a late listening event and refuses late accepted sockets', async () => {
  const f = fixture();
  const ready = f.listener.start();
  const rejection = expect(ready).rejects.toThrow('POOL_EGRESS_LISTENER_INVALID');
  const close = f.listener.close();
  f.server.listening = true;
  f.server.emit('listening');
  const socket = { destroy: vi.fn() };
  f.server.emit('connection', socket);
  f.server.listening = false;
  f.server.emit('close');
  await rejection;
  await expect(close).rejects.toThrow('POOL_EGRESS_CLOSE_UNPROVEN');
  expect(socket.destroy).toHaveBeenCalledOnce();
  expect(f.connections.accept).not.toHaveBeenCalled();
  expect(f.drain.snapshot().unknown).toBe(1);
  f.releaseBoot();
});

it('can close before starting, without creating anything or releasing the parent', async () => {
  const f = fixture();
  await f.listener.close();
  await expect(f.listener.start()).rejects.toThrow();
  expect(f.factory.createListener).not.toHaveBeenCalled();
  expect(f.drain.snapshot()).toMatchObject({ roots: 1, children: 0 });
  f.releaseBoot();
});
