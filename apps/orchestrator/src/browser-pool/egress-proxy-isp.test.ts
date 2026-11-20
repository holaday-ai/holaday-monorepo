import { createServer as createHttpServer } from 'node:http';
import { type Socket, createServer as createNetServer, connect as netConnect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROXY_DOMAINS,
  browserProxyUpstreams,
  domainEgressConfig,
  installDomainEgress,
  proxiedDomain,
  proxyPoolSlot,
} from '../agent/browser-tools/domain-egress.js';
import { BrowserEgressProxy } from './egress-proxy.js';

/** PROXY-BROWSER-1: Google domains chained to a user's fixed ISP endpoint at the loopback proxy. */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const allowAll = {
  check: async (url: string) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
};

async function listen(server: { listen: (...a: never[]) => unknown; address: () => unknown }) {
  await new Promise<void>((resolve) =>
    (server.listen as (p: number, h: string, cb: () => void) => void)(0, '127.0.0.1', resolve),
  );
  return (server.address() as { port: number }).port;
}

/** A stand-in ISP endpoint: records each CONNECT and pipes accepted ones to `targetPort`. */
async function fakeUpstream(targetPort: number, status = 200) {
  const seen: Array<{ authority: string; auth: string | undefined }> = [];
  const server = createHttpServer();
  server.on('connect', (req, client: Socket) => {
    seen.push({ authority: req.url ?? '', auth: req.headers['proxy-authorization'] });
    if (status !== 200) {
      client.end(`HTTP/1.1 ${status} Proxy Authentication Required\r\n\r\n`);
      return;
    }
    const target = netConnect(targetPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection established\r\n\r\n');
      target.pipe(client);
      client.pipe(target);
    });
    target.on('error', () => client.destroy());
    client.on('error', () => target.destroy());
  });
  const port = await listen(server);
  closers.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port, seen };
}

async function echoServer() {
  const sockets: Socket[] = [];
  const server = createNetServer((socket) => {
    sockets.push(socket);
    socket.pipe(socket);
  });
  const port = await listen(server);
  closers.push(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return port;
}

/** Sends CONNECT through the loopback proxy, then `payload`; resolves with the status line and echo. */
function connectThrough(proxyUrl: string, authority: string, payload = 'ping') {
  const { port } = new URL(proxyUrl);
  return new Promise<{ status: string; echoed: string }>((resolve, reject) => {
    const socket = netConnect(Number(port), '127.0.0.1');
    let data = '';
    let status = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ status, echoed: data });
    }, 1500);
    socket.on('connect', () =>
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    );
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (!status && data.includes('\r\n\r\n')) {
        status = data.split('\r\n')[0]!;
        data = data.slice(data.indexOf('\r\n\r\n') + 4);
        if (status.includes(' 200 ')) socket.write(payload);
        else {
          clearTimeout(timer);
          socket.destroy();
          resolve({ status, echoed: '' });
        }
      }
      if (data === payload) {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status, echoed: data });
      }
    });
    socket.on('error', reject);
  });
}

function proxy(
  endpoints: string[],
  domains = ['www.google.com', 'gstatic.com'],
  logger?: { warn: (c: Record<string, unknown>, m: string) => void },
) {
  const instance = new BrowserEgressProxy({
    policy: allowAll,
    upstreams: { endpoints, domains },
    ...(logger ? { logger } : {}),
  });
  closers.push(() => instance.close());
  return instance;
}

describe('proxy rule (PAC equivalent)', () => {
  it('proxies only the listed domains and their subdomains', () => {
    const domains = ['google.com', 'gstatic.com', 'googleapis.com', 'recaptcha.net'];
    expect(proxiedDomain('www.google.com', domains)).toBe('google.com');
    expect(proxiedDomain('WWW.Google.COM.', domains)).toBe('google.com');
    expect(proxiedDomain('consent.google.com', domains)).toBeDefined();
    expect(proxiedDomain('www.gstatic.com', domains)).toBe('gstatic.com');
    expect(proxiedDomain('www.googleapis.com', domains)).toBe('googleapis.com');
    expect(proxiedDomain('example.com', domains)).toBeUndefined();
    expect(proxiedDomain('google.com.evil.test', domains)).toBeUndefined();
    expect(proxiedDomain('notgoogle.com', domains)).toBeUndefined();
  });

  it('keeps sign-in hosts direct even when their domain is listed', () => {
    for (const host of [
      'accounts.google.com',
      'myaccount.google.com',
      'login.example.com',
      'id.google.com',
    ])
      expect(proxiedDomain(host, ['google.com', 'example.com'])).toBeUndefined();
  });
});

describe('browser-level mode configuration', () => {
  const env = {
    BROWSER_DOMAIN_PROXY_ENABLED: 'true',
    BROWSER_DOMAIN_PROXY_POOL: 'isp.example:10001,isp.example:10002',
    BROWSER_DOMAIN_PROXY_USERNAME: 'u',
    BROWSER_DOMAIN_PROXY_PASSWORD: 'p',
  };

  it('defaults to browser mode with a pool and hands the pool to the loopback proxy', () => {
    expect(domainEgressConfig(env).mode).toBe('browser');
    const upstreams = browserProxyUpstreams(env);
    expect(upstreams?.endpoints).toHaveLength(2);
    expect(upstreams?.domains).toEqual(DEFAULT_PROXY_DOMAINS);
  });

  it('is off when disabled, in replay mode or without a pool', () => {
    expect(browserProxyUpstreams({ ...env, BROWSER_DOMAIN_PROXY_ENABLED: 'false' })).toBeNull();
    expect(browserProxyUpstreams({ ...env, BROWSER_DOMAIN_PROXY_MODE: 'replay' })).toBeNull();
    expect(
      browserProxyUpstreams({
        BROWSER_DOMAIN_PROXY_ENABLED: 'true',
        BROWSER_DOMAIN_PROXY_URL: 'http://x:1',
      }),
    ).toBeNull();
    expect(browserProxyUpstreams({})).toBeNull();
  });

  it('installs no Playwright route in browser mode (no Node re-request of Google)', async () => {
    const page = new Proxy(
      {},
      {
        get: () => {
          throw new Error('page must not be touched');
        },
      },
    );
    const egress = await installDomainEgress(page as never, domainEgressConfig(env));
    expect(egress.metrics.proxyRequests).toBe(0);
    await egress.dispose();
  });
});

describe('BrowserEgressProxy ISP chaining', () => {
  it('tunnels a listed HTTPS host through the endpoint with its credentials', async () => {
    const echo = await echoServer();
    const upstream = await fakeUpstream(echo);
    const egress = proxy([`http://user%40x:p%3Ass@127.0.0.1:${upstream.port}`]);
    const url = await egress.startFor('alice');
    const result = await connectThrough(url, 'www.google.com:443');
    expect(result.status).toContain(' 200 ');
    expect(result.echoed).toBe('ping');
    expect(upstream.seen).toEqual([
      {
        authority: 'www.google.com:443',
        auth: `Basic ${Buffer.from('user@x:p:ss').toString('base64')}`,
      },
    ]);
  });

  it('never sends sign-in or unlisted hosts to the endpoint', async () => {
    const echo = await echoServer();
    const upstream = await fakeUpstream(echo);
    const egress = proxy([`http://127.0.0.1:${upstream.port}`], ['google.com']);
    const url = await egress.startFor('alice');
    // Direct path: the stub policy resolves to loopback, where the echo server listens.
    const direct = await connectThrough(url, `example.com:${echo}`);
    expect(direct.echoed).toBe('ping');
    await connectThrough(url, 'accounts.google.com:443');
    expect(upstream.seen).toEqual([]);
  });

  it('gives one user the same endpoint every time and spreads users over the pool', async () => {
    const egress = proxy(['http://127.0.0.1:1', 'http://127.0.0.1:2', 'http://127.0.0.1:3']);
    const first = await egress.startFor('user-a');
    expect(await egress.startFor('user-a')).toBe(first);
    const users = Array.from({ length: 12 }, (_, i) => `user-${i}`);
    const urls = new Map<number, string>();
    for (const user of users) {
      const slot = proxyPoolSlot(user, 3);
      const got = await egress.startFor(user);
      if (urls.has(slot)) expect(got).toBe(urls.get(slot));
      urls.set(slot, got);
    }
    expect(new Set(urls.values()).size).toBe(urls.size);
    expect(urls.size).toBeGreaterThan(1);
  });

  it('fails closed on an endpoint refusal without leaking the credentials', async () => {
    const upstream = await fakeUpstream(1, 407);
    const warnings: string[] = [];
    const egress = proxy(
      [`http://user:secret-pass@127.0.0.1:${upstream.port}`],
      ['www.google.com'],
      {
        warn: (context, message) => warnings.push(JSON.stringify(context) + message),
      },
    );
    const result = await connectThrough(await egress.startFor('alice'), 'www.google.com:443');
    expect(result.status).toContain(' 502 ');
    expect(warnings.join('\n')).toContain('isp_upstream_status_407');
    expect(warnings.join('\n')).not.toContain('secret-pass');
  });

  it('without endpoints every user shares the plain loopback proxy', async () => {
    const egress = new BrowserEgressProxy({ policy: allowAll });
    closers.push(() => egress.close());
    expect(await egress.startFor('a')).toBe(await egress.start());
    expect(await egress.startFor('b')).toBe(await egress.start());
  });
});

describe('per-site exits (OPEN-ANY-SITE-1)', () => {
  const env = {
    BROWSER_DOMAIN_PROXY_ENABLED: 'true',
    BROWSER_DOMAIN_PROXY_POOL: 'mobile.example:10001',
  };
  it('sends only the sites a mobile exit opens; Google and YouTube stay direct', () => {
    const upstreams = browserProxyUpstreams(env)!;
    expect(upstreams.domains).toEqual(DEFAULT_PROXY_DOMAINS);
    for (const host of ['www.reddit.com', 'old.reddit.com', 'www.redditstatic.com', 'medium.com'])
      expect(proxiedDomain(host, upstreams.domains)).toBeDefined();
    for (const host of ['www.google.com', 'www.youtube.com', 'www.imdb.com', 'www.etsy.com'])
      expect(proxiedDomain(host, upstreams.domains)).toBeUndefined();
    expect(upstreams.direct).toContain('google.com');
  });
  it('a direct-only site stays direct even when configured or learned', async () => {
    const configured = browserProxyUpstreams({
      ...env,
      BROWSER_DOMAIN_PROXY_DOMAINS: 'google.com,reddit.com',
    })!;
    expect(configured.domains).toEqual(['reddit.com']);
    const echo = await echoServer();
    const upstream = await fakeUpstream(echo);
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: {
        endpoints: [`http://127.0.0.1:${upstream.port}`],
        domains: ['reddit.com'],
        direct: ['google.com'],
      },
      learned: () => ['google.com', 'imdb.com'],
    });
    closers.push(() => egress.close());
    const url = await egress.startFor('alice', 'task-1');
    await connectThrough(url, 'www.google.com:443');
    await connectThrough(url, 'www.imdb.com:443');
    expect(upstream.seen.map((s) => s.authority)).toEqual(['www.imdb.com:443']);
  });
});

describe('per-launch routes (OPEN-ANY-SITE-1)', () => {
  it('fixes the learned list when the browser launches; a later lesson waits for the next launch', async () => {
    const echo = await echoServer();
    const upstream = await fakeUpstream(echo);
    const learned: string[] = [];
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: { endpoints: [`http://127.0.0.1:${upstream.port}`], domains: ['google.com'] },
      learned: () => learned,
    });
    closers.push(() => egress.close());
    const running = await egress.startFor('alice', 'task-1');
    learned.push('reddit.com');
    // The running browser does not switch exits for a site learned after it started.
    await connectThrough(running, 'www.reddit.com:443');
    expect(upstream.seen).toEqual([]);
    const next = await egress.startFor('alice', 'task-2');
    expect(next).not.toBe(running);
    expect((await connectThrough(next, 'www.reddit.com:443')).echoed).toBe('ping');
    expect(upstream.seen.map((s) => s.authority)).toEqual(['www.reddit.com:443']);
  });

  it('counts each launch’s tunnelled traffic and closes its listener', async () => {
    const echo = await echoServer();
    const upstream = await fakeUpstream(echo);
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: { endpoints: [`http://127.0.0.1:${upstream.port}`], domains: ['google.com'] },
    });
    closers.push(() => egress.close());
    const url = await egress.startFor('alice', 'task-1');
    await connectThrough(url, 'www.google.com:443', 'hello');
    // Direct traffic is not counted.
    await connectThrough(url, `example.com:${echo}`, 'direct');
    const metrics = await egress.closeRoute('task-1');
    expect(metrics).toEqual({ tunnels: 1, failures: 0, bytesUp: 5, bytesDown: 5 });
    expect(await egress.closeRoute('task-1')).toBeNull();
    await expect(connectThrough(url, 'www.google.com:443')).rejects.toThrow();
  });

  it('counts a refused tunnel as a failure', async () => {
    const upstream = await fakeUpstream(1, 407);
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: { endpoints: [`http://127.0.0.1:${upstream.port}`], domains: ['google.com'] },
    });
    closers.push(() => egress.close());
    await connectThrough(await egress.startFor('alice', 'task-1'), 'www.google.com:443');
    expect(await egress.closeRoute('task-1')).toMatchObject({ tunnels: 0, failures: 1 });
  });
});

describe('endpoint health (OPEN-ANY-SITE-1)', () => {
  it('a new launch skips an endpoint that failed to open tunnels; the running one stays', async () => {
    const echo = await echoServer();
    const dead = await fakeUpstream(1, 522);
    const alive = await fakeUpstream(echo);
    const endpoints = [`http://127.0.0.1:${dead.port}`, `http://127.0.0.1:${alive.port}`];
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: { endpoints, domains: ['google.com'] },
    });
    closers.push(() => egress.close());
    const user = Array.from({ length: 50 }, (_, i) => `u${i}`).find(
      (u) => proxyPoolSlot(u, 2) === 0,
    )!;
    const first = await egress.startFor(user, 'task-1');
    expect((await connectThrough(first, 'www.google.com:443')).status).toContain(' 502 ');
    // The running browser does not switch endpoints.
    expect((await connectThrough(first, 'www.google.com:443')).status).toContain(' 502 ');
    expect(alive.seen).toEqual([]);
    const next = await egress.startFor(user, 'task-2');
    expect((await connectThrough(next, 'www.google.com:443')).echoed).toBe('ping');
    expect(alive.seen).toHaveLength(1);
  });

  it('an authentication refusal is configuration, not an unhealthy endpoint', async () => {
    const refused = await fakeUpstream(1, 407);
    const egress = new BrowserEgressProxy({
      policy: allowAll,
      upstreams: {
        endpoints: [`http://127.0.0.1:${refused.port}`, 'http://127.0.0.1:9'],
        domains: ['google.com'],
      },
    });
    closers.push(() => egress.close());
    const user = Array.from({ length: 50 }, (_, i) => `u${i}`).find(
      (u) => proxyPoolSlot(u, 2) === 0,
    )!;
    await connectThrough(await egress.startFor(user, 'task-1'), 'www.google.com:443');
    await connectThrough(await egress.startFor(user, 'task-2'), 'www.google.com:443');
    expect(refused.seen).toHaveLength(2);
  });
});
