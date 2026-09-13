import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { type Socket, createServer as createNetServer, connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserNetworkDecision } from '../agent/browser-network-policy.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { BrowserEgressProxy } from './egress-proxy.js';

vi.mock('node:net', async (original) => {
  const actual = await original<typeof import('node:net')>();
  return { ...actual, connect: vi.fn(actual.connect) };
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('BrowserEgressProxy', () => {
  it('rechecks queued bytes at target.write after real socket backpressure clears', async () => {
    const peers: Socket[] = [];
    const target = createNetServer((socket) => {
      peers.push(socket);
      socket.pause();
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    closers.push(async () => {
      for (const peer of peers) peer.destroy();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    });
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('no target');
    const drain = new ExecutionDrain();
    const f = await strictUnixProxy(drain, async (url) => ({
      allowed: true,
      url,
      addresses: ['127.0.0.1'],
    }));
    const originalConnect = vi.mocked(netConnect).getMockImplementation();
    if (!originalConnect) throw new Error('missing native connect wrapper');
    let writes = 0;
    let actualBackpressure = false;
    let notifyPressure!: () => void;
    const pressure = new Promise<void>((resolve) => {
      notifyPressure = resolve;
    });
    let notifyDrain!: () => void;
    const nativeDrain = new Promise<void>((resolve) => {
      notifyDrain = resolve;
    });
    const completions: Array<() => void> = [];
    const bounded = async (work: Promise<void>, stage: string) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          work,
          new Promise<void>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `synthetic ${stage}: writes=${writes}, pressure=${actualBackpressure}, completions=${completions.length}`,
                  ),
                ),
              1000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    vi.mocked(netConnect).mockImplementation(((...args: unknown[]) => {
      const nativeArgs = [...args];
      if (typeof nativeArgs[0] === 'object' && nativeArgs[0])
        nativeArgs[0] = { ...nativeArgs[0], highWaterMark: 1024 };
      const socket = Reflect.apply(originalConnect, undefined, nativeArgs) as Socket;
      const originalWrite = socket.write;
      const originalEmit = socket.emit;
      socket.write = ((...writeArgs: unknown[]) => {
        writes++;
        const callback =
          typeof writeArgs.at(-1) === 'function'
            ? (writeArgs.pop() as (...args: unknown[]) => void)
            : undefined;
        writeArgs.push((...callbackArgs: unknown[]) => {
          if (actualBackpressure) completions.push(() => callback?.(...callbackArgs));
          else callback?.(...callbackArgs);
        });
        const result = Reflect.apply(originalWrite, socket, writeArgs) as boolean;
        if (!result) {
          actualBackpressure = true;
          notifyPressure();
        }
        return result;
      }) as Socket['write'];
      socket.emit = ((event: string | symbol, ...eventArgs: unknown[]) => {
        if (event === 'drain') {
          completions.push(() => Reflect.apply(originalEmit, socket, [event, ...eventArgs]));
          notifyDrain();
          return true;
        }
        return Reflect.apply(originalEmit, socket, [event, ...eventArgs]) as boolean;
      }) as Socket['emit'];
      return socket;
    }) as typeof netConnect);
    try {
      const connected = new Promise<void>((resolve) => f.client.once('data', () => resolve()));
      f.client.write(
        `CONNECT public.example:${address.port} HTTP/1.1\r\nHost: public.example\r\n\r\n`,
      );
      await connected;
      f.client.write(Buffer.alloc(8 * 1024 * 1024, 120));
      await bounded(pressure, 'pressure');
      for (const peer of peers) peer.resume();
      await bounded(nativeDrain, 'native-drain');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(actualBackpressure).toBe(true);
      const before = writes;
      drain.block();
      for (const complete of completions.splice(0)) complete();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writes).toBe(before);
    } finally {
      vi.mocked(netConnect).mockImplementation(originalConnect);
      for (const complete of completions.splice(0)) complete();
      await bounded(f.proxy.close(), 'proxy-close');
    }
  });

  it('preserves an early HTTP error response while the unfinished upload is stopped', async () => {
    const size = 8 * 1024 * 1024;
    const target = createHttpServer((_req, res) => {
      res.writeHead(413, { 'content-length': size, connection: 'close' });
      res.end(Buffer.alloc(size, 120));
    });
    await listen(target);
    closers.push(() => closeServer(target));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('no target');
    const f = await strictUnixProxy(new ExecutionDrain(), async (url) => ({
      allowed: true,
      url,
      addresses: ['127.0.0.1'],
    }));
    const chunks: Buffer[] = [];
    f.client.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    f.client.pause();
    const closed = new Promise<void>((resolve) => f.client.once('close', resolve));
    f.client.write(
      `POST http://public.example:${address.port}/ HTTP/1.1\r\nHost: public.example\r\nContent-Length: 1000000\r\n\r\npartial`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    f.client.resume();
    await closed;
    const response = Buffer.concat(chunks);
    const body = response.subarray(response.indexOf('\r\n\r\n') + 4);
    expect(response.subarray(0, 32).toString()).toContain('413');
    expect(body.length).toBe(size);
    expect(body.every((byte) => byte === 120)).toBe(true);
  });

  it('does not dispatch a TCP connection if the final drain guard synchronously closes the proxy', async () => {
    let armed = false;
    let checks = 0;
    const drain = new ExecutionDrain(1024, () => {
      if (armed && ++checks === 2) void proxy.close();
    });
    const f = await strictUnixProxy(drain, async (url) => {
      armed = true;
      return { allowed: true, url, addresses: ['127.0.0.1'] };
    });
    const proxy = f.proxy;
    const before = vi.mocked(netConnect).mock.calls.length;
    const closed = new Promise<void>((resolve) => f.client.once('close', resolve));
    f.client.write('CONNECT public.example:45678 HTTP/1.1\r\nHost: public.example:45678\r\n\r\n');
    await closed;
    await proxy.close();
    expect(vi.mocked(netConnect).mock.calls.slice(before)).toHaveLength(0);
  });

  it('does not forward a second tunnel data batch after the original drain is blocked', async () => {
    let received = '';
    let notifyFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      notifyFirst = resolve;
    });
    const upstreams: Socket[] = [];
    const target = createNetServer((socket) => {
      upstreams.push(socket);
      socket.on('data', (chunk) => {
        received += chunk.toString();
        if (received === 'first') notifyFirst();
      });
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    closers.push(async () => {
      for (const socket of upstreams) socket.destroy();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    });
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('no target');
    const drain = new ExecutionDrain();
    const f = await strictUnixProxy(drain, async (url) => ({
      allowed: true,
      url,
      addresses: ['127.0.0.1'],
    }));
    const connected = new Promise<void>((resolve) => f.client.once('data', () => resolve()));
    f.client.write(
      `CONNECT public.example:${address.port} HTTP/1.1\r\nHost: public.example\r\n\r\n`,
    );
    await connected;
    f.client.write('first');
    await first;
    drain.block();
    f.client.write('second');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(received).toBe('first');
    await f.proxy.close();
    expect(drain.snapshot().unknown).toBe(1);
  });

  it('pins a strict group before IO, accepts one Unix handoff, and drains without a TCP listener', async () => {
    const drain = new ExecutionDrain();
    drain.open();
    const owner = drain.admit('execution');
    const releaseGroup = drain.pin(owner);
    let resolvePolicy!: (decision: BrowserNetworkDecision) => void;
    let notifyChecked!: () => void;
    const checked = new Promise<void>((resolve) => {
      notifyChecked = resolve;
    });
    const pending = new Promise<BrowserNetworkDecision>((resolve) => {
      resolvePolicy = resolve;
    });
    const proxy = new BrowserEgressProxy({
      lifetime: { drain, owner },
      policy: {
        check: () => {
          notifyChecked();
          return pending;
        },
      },
    });
    expect(drain.snapshot().children).toBe(1);
    await expect(proxy.start()).rejects.toThrow('POOL_EGRESS_PRIVATE_ONLY');
    const directory = await mkdtemp(join(tmpdir(), 'pool-egress-'));
    const path = join(directory, 'egress.sock');
    let original!: Socket;
    const broker = createNetServer((socket) => {
      original = socket;
      proxy.acceptAuthenticatedConnection(socket);
    });
    await new Promise<void>((resolve) => broker.listen(path, resolve));
    const client = netConnect(path);
    client.on('error', () => {});
    client.write('GET http://public.example/ HTTP/1.1\r\nHost: public.example\r\n\r\n');
    await checked;
    expect(() => proxy.acceptAuthenticatedConnection(original)).toThrow(
      'POOL_EGRESS_HANDOFF_INVALID',
    );
    const stopping = proxy.close();
    expect(proxy.close()).toBe(stopping);
    expect(drain.snapshot().children).toBe(1);
    await expect(proxy.start()).rejects.toThrow();
    try {
      resolvePolicy({ allowed: true, url: 'http://public.example/', addresses: ['127.0.0.1'] });
      await stopping;
      expect(drain.snapshot().children).toBe(0);
      expect(drain.snapshot().roots).toBe(1); // The browser group has not exited.
    } finally {
      client.destroy();
      await new Promise<void>((resolve) => broker.close(() => resolve()));
      await rm(directory, { recursive: true });
      releaseGroup();
    }
  });

  for (const method of ['GET', 'CONNECT', 'upgrade']) {
    it(`retains pending ${method} policy work through physical close and denies late forwarding`, async () => {
      let resolvePolicy!: (decision: BrowserNetworkDecision) => void;
      let notifyChecked!: () => void;
      const checked = new Promise<void>((resolve) => {
        notifyChecked = resolve;
      });
      const decision = new Promise<BrowserNetworkDecision>((resolve) => {
        resolvePolicy = resolve;
      });
      const reached = vi.fn();
      const target = createHttpServer((_req, res) => {
        reached();
        res.end('unexpected');
      });
      await listen(target);
      closers.push(() => closeServer(target));
      const targetAddress = target.address();
      if (!targetAddress || typeof targetAddress === 'string') throw new Error('missing target');
      const proxy = new BrowserEgressProxy({
        policy: {
          check: () => {
            notifyChecked();
            return decision;
          },
        },
      });
      const proxyUrl = new URL(await proxy.start());
      const client = netConnect(Number(proxyUrl.port), proxyUrl.hostname);
      client.on('error', () => {});
      const authority = `public.example:${targetAddress.port}`;
      client.write(
        method === 'CONNECT'
          ? `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`
          : `GET http://${authority}/ HTTP/1.1\r\nHost: ${authority}\r\n${method === 'upgrade' ? 'Connection: Upgrade\r\nUpgrade: websocket\r\n' : ''}\r\n`,
      );
      await checked;
      let finished = false;
      const closing = proxy.close().then(() => {
        finished = true;
      });
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(finished).toBe(false);
      } finally {
        resolvePolicy({ allowed: true, url: `http://${authority}/`, addresses: ['127.0.0.1'] });
        await closing;
        client.destroy();
      }
      expect(reached).not.toHaveBeenCalled();
    });
  }

  it('blocks direct private-network HTTP requests before they reach the target', async () => {
    const reached = vi.fn();
    const target = createHttpServer((_req, res) => {
      reached();
      res.end('private');
    });
    await listen(target);
    closers.push(() => closeServer(target));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('missing target address');

    const proxy = new BrowserEgressProxy();
    const proxyUrl = await proxy.start();
    closers.push(() => proxy.close());

    const response = await proxyRequest(proxyUrl, `http://127.0.0.1:${address.port}/metadata`);

    expect(response.status).toBe(403);
    expect(response.body).toContain('blocked');
    expect(reached).not.toHaveBeenCalled();
  });

  it('uses the policy-selected address for forwarding instead of resolving twice', async () => {
    const target = createHttpServer((req, res) => {
      res.end(`${req.headers.host}:${req.url}`);
    });
    await listen(target);
    closers.push(() => closeServer(target));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('missing target address');

    const check = vi.fn(
      async (rawUrl: string): Promise<BrowserNetworkDecision> => ({
        allowed: true,
        url: rawUrl,
        addresses: ['127.0.0.1'],
      }),
    );
    const proxy = new BrowserEgressProxy({ policy: { check } });
    const proxyUrl = await proxy.start();
    closers.push(() => proxy.close());

    const response = await proxyRequest(
      proxyUrl,
      `http://public.example:${address.port}/hello?q=1`,
    );

    expect(response).toEqual({
      status: 200,
      body: `public.example:${address.port}:/hello?q=1`,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('rejects private-network CONNECT tunnels', async () => {
    const proxy = new BrowserEgressProxy();
    const proxyUrl = await proxy.start();
    closers.push(() => proxy.close());
    const { hostname, port } = new URL(proxyUrl);

    const firstLine = await new Promise<string>((resolve, reject) => {
      const socket = netConnect(Number(port), hostname, () => {
        socket.write('CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n');
      });
      socket.setEncoding('utf8');
      socket.once('data', (chunk) => {
        resolve(String(chunk).split('\r\n', 1)[0] ?? '');
        socket.destroy();
      });
      socket.once('error', reject);
    });

    expect(firstLine).toBe('HTTP/1.1 403 Forbidden');
  });
});

async function strictUnixProxy(
  drain: ExecutionDrain,
  check: (url: string) => Promise<BrowserNetworkDecision>,
) {
  drain.open();
  const owner = drain.admit('execution');
  const release = drain.pin(owner);
  const proxy = new BrowserEgressProxy({ lifetime: { drain, owner }, policy: { check } });
  const directory = await mkdtemp(join(tmpdir(), 'pool-egress-'));
  const path = join(directory, 'egress.sock');
  const listener = createNetServer((socket) => proxy.acceptAuthenticatedConnection(socket));
  await new Promise<void>((resolve) => listener.listen(path, resolve));
  const client = netConnect(path);
  client.on('error', () => {});
  await new Promise<void>((resolve) => client.once('connect', resolve));
  closers.push(async () => {
    client.destroy();
    await proxy.close();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(directory, { recursive: true });
    release();
  });
  return { proxy, client };
}

async function proxyRequest(
  proxyUrl: string,
  targetUrl: string,
): Promise<{ status: number; body: string }> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: proxy.hostname,
        port: proxy.port,
        method: 'GET',
        path: targetUrl,
        headers: { host: new URL(targetUrl).host },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.once('error', reject);
    req.end();
  });
}

function listen(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
