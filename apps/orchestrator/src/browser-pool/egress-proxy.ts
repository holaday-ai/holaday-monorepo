import {
  type ClientRequest,
  type IncomingMessage,
  type Server,
  createServer,
  request as forwardHttpRequest,
} from 'node:http';
import { type Socket, connect as connectTcp, isIP } from 'node:net';
import type { AddressInfo } from 'node:net';
import { type Duplex, type Readable, Writable } from 'node:stream';
import type { BrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { proxiedDomain, proxyPoolSlot } from '../agent/browser-tools/domain-egress.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import { browserUrlForLog } from './log-url.js';

interface BrowserEgressProxyOptions {
  /** Private original group owner. Presence disables the legacy TCP listener. */
  lifetime?: OperationLifetime;
  policy?: Pick<BrowserNetworkPolicy, 'check'>;
  logger?: {
    warn(context: Record<string, unknown>, message: string): void;
  };
  /**
   * PROXY-BROWSER-1: fixed ISP endpoints (proxy URLs, credentials included) and
   * the domains chained through them. Chrome keeps doing the TLS: the tunnel to
   * the endpoint only carries its bytes. Absent means every target is direct.
   */
  upstreams?: { endpoints: readonly string[]; domains: readonly string[] } | null;
  /** OPEN-ANY-SITE-1: sites learned to block the datacenter egress (snapshot per launch). */
  learned?: () => readonly string[];
}

/** Traffic through one launch's ISP/mobile tunnels (bytes are TLS payload as relayed). */
export interface IspRouteMetrics {
  tunnels: number;
  failures: number;
  bytesUp: number;
  bytesDown: number;
}

interface IspUpstream {
  slot: number;
  url: URL;
  domains: readonly string[];
  metrics: IspRouteMetrics;
}

/** How long an endpoint that failed to open a tunnel is skipped by new launches. */
export const ENDPOINT_RETRY_MS = 10 * 60_000;

/**
 * Loopback-only forward proxy for browser-pool Chromium processes.
 *
 * The proxy resolves each destination through BrowserNetworkPolicy and then
 * connects to the exact approved IP. That removes the check/use DNS gap: the
 * browser never performs a second, potentially rebound resolution itself.
 */
export class BrowserEgressProxy {
  private readonly policy: Pick<BrowserNetworkPolicy, 'check'>;
  private readonly logger: BrowserEgressProxyOptions['logger'];
  private readonly server = this.createProxyServer();
  private readonly upstreams: BrowserEgressProxyOptions['upstreams'];
  private readonly learned: BrowserEgressProxyOptions['learned'];
  /** Endpoints whose tunnels failed (the endpoint, not a site), until when. */
  private readonly unhealthy = new Map<number, number>();
  /**
   * Loopback listeners whose port fixes the exit: `slot:<n>` is shared per ISP
   * endpoint; `route:<key>` belongs to one browser launch and fixes its domain list.
   */
  private readonly routed = new Map<
    string,
    { server: Server; url: Promise<string>; upstream: IspUpstream }
  >();
  private readonly clientSockets = new Set<Socket>();
  private readonly upstreamSockets = new Set<Socket>();
  private readonly upstreamRequests = new Set<ClientRequest>();
  private startPromise: Promise<string> | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly transfers = new Set<Writable>();
  private readonly handedOff = new WeakSet<Socket>();
  private readonly lifetime?: OperationLifetime;
  private readonly releaseOwner?: () => boolean;

  constructor(options: BrowserEgressProxyOptions = {}) {
    this.policy = options.policy ?? defaultBrowserNetworkPolicy;
    this.upstreams = options.upstreams?.endpoints.length ? options.upstreams : null;
    this.learned = options.learned;
    this.logger =
      options.lifetime && options.logger
        ? {
            warn: (_context, message) =>
              options.logger?.warn({ code: 'POOL_EGRESS_FAILURE' }, message),
          }
        : options.logger;
    if (options.lifetime) {
      const { drain, owner: parent } = options.lifetime;
      const owner = drain.fork(parent, 'execution');
      this.releaseOwner = drain.pin(owner);
      this.lifetime = Object.freeze({ drain, owner });
      try {
        drain.assertDispatch(owner);
      } catch {
        this.releaseOwner();
        throw new Error('POOL_EGRESS_OWNER_INVALID');
      }
    }
  }

  private createProxyServer(upstream?: IspUpstream): Server {
    const server = createServer((req, res) => {
      void this.trackPending(
        this.handleHttp(req, res).catch((error) => {
          this.logger?.warn({ error: errorMessage(error) }, 'browser egress proxy HTTP failure');
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('browser proxy request failed');
        }),
      );
    });
    server.on('connect', (req, client, head) => {
      void this.trackPending(
        this.handleConnect(req, client, head, upstream).catch((error) => {
          this.logger?.warn(
            { error: errorMessage(error), target: req.url ?? '' },
            'browser egress proxy CONNECT failure',
          );
          writeSocketError(client, 502, 'Bad Gateway');
        }),
      );
    });
    server.on('upgrade', (req, client, head) => {
      void this.trackPending(
        this.handleUpgrade(req, client, head).catch((error) => {
          this.logger?.warn(
            { error: errorMessage(error), target: req.url ?? '' },
            'browser egress proxy WebSocket failure',
          );
          writeSocketError(client, 502, 'Bad Gateway');
        }),
      );
    });
    server.on('connection', (socket) => {
      this.trackClient(socket);
      if (this.closing) socket.destroy();
    });
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    return server;
  }

  /**
   * The proxy URL for one user's browser: with ISP endpoints configured, a
   * listener on the endpoint this user always maps to; otherwise the shared one.
   * With `routeKey` (one browser launch) the listener is the launch's own: its
   * domain list (configured + learned) is fixed now, and closeRoute reports its
   * traffic. Without it, users of one endpoint share a listener on the static list.
   */
  startFor(affinityKey: string, routeKey?: string): Promise<string> {
    if (!this.upstreams) return this.start();
    if (this.lifetime) return Promise.reject(new Error('POOL_EGRESS_PRIVATE_ONLY'));
    if (this.closing) return Promise.reject(new Error('browser egress proxy is closing'));
    const size = this.upstreams.endpoints.length;
    const home = proxyPoolSlot(affinityKey, size);
    // A new launch skips an endpoint that could not open tunnels; a running
    // browser keeps its endpoint (a site's wall never moves anyone).
    const now = Date.now();
    const healthy = (n: number) => (this.unhealthy.get(n) ?? 0) <= now;
    const slot =
      routeKey === undefined
        ? home
        : (Array.from({ length: size }, (_, i) => (home + i) % size).find(healthy) ?? home);
    const key = routeKey === undefined ? `slot:${slot}` : `route:${routeKey}`;
    const existing = this.routed.get(key);
    if (existing) return existing.url;
    const url = new URL(this.upstreams.endpoints[slot]!);
    if (url.protocol !== 'http:' || !url.hostname)
      return Promise.reject(new Error('domain_proxy_invalid_config'));
    const domains =
      routeKey === undefined
        ? this.upstreams.domains
        : [...new Set([...this.upstreams.domains, ...(this.learned?.() ?? [])])];
    const upstream: IspUpstream = {
      slot,
      url,
      domains,
      metrics: { tunnels: 0, failures: 0, bytesUp: 0, bytesDown: 0 },
    };
    const server = this.createProxyServer(upstream);
    const entry = {
      server,
      upstream,
      url: listenLoopback(server).catch((error) => {
        this.routed.delete(key);
        throw error;
      }),
    };
    this.routed.set(key, entry);
    return entry.url;
  }

  /** Closes one launch's listener (its browser is gone) and returns its traffic. */
  async closeRoute(routeKey: string): Promise<IspRouteMetrics | null> {
    const key = `route:${routeKey}`;
    const entry = this.routed.get(key);
    if (!entry) return null;
    this.routed.delete(key);
    await entry.url.catch(() => {});
    entry.server.closeAllConnections?.();
    if (entry.server.listening)
      await new Promise<void>((resolve) => entry.server.close(() => resolve()));
    return { ...entry.upstream.metrics };
  }

  start(): Promise<string> {
    if (this.lifetime) return Promise.reject(new Error('POOL_EGRESS_PRIVATE_ONLY'));
    if (this.closing) return Promise.reject(new Error('browser egress proxy is closing'));
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        this.startPromise = null;
        reject(error);
      };
      this.server.once('error', onError);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', onError);
        const address = this.server.address() as AddressInfo | null;
        if (!address) {
          this.startPromise = null;
          reject(new Error('browser egress proxy did not expose a listening address'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return this.startPromise;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = Promise.resolve()
      .then(async () => {
        // A pending listen and unfinished policy checks are real work even when
        // server.listening is false. Closing the caller is not a completion receipt.
        if (this.startPromise) await this.startPromise.catch(() => {});
        for (const socket of this.clientSockets) socket.destroy();
        for (const socket of this.upstreamSockets) socket.destroy();
        for (const request of this.upstreamRequests) request.destroy();
        for (const transfer of this.transfers) transfer.destroy();
        for (const { server, url } of this.routed.values()) {
          await url.catch(() => {});
          server.closeAllConnections?.();
          if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        this.routed.clear();
        this.server.closeAllConnections?.();
        if (this.server.listening) {
          await new Promise<void>((resolve, reject) => {
            this.server.close((error) => (error ? reject(error) : resolve()));
            this.server.closeIdleConnections?.();
          });
        }
        while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
        this.startPromise = null;
        this.releaseOwner?.();
      })
      .catch((error: unknown) => {
        if (this.lifetime) this.lifetime.drain.markUnknown(this.lifetime.owner);
        throw error;
      });
    return this.closePromise;
  }

  /** Called only by the private broker runtime after original-group HPG1 auth.
   * This handoff is not itself an authentication or group-exit authority.
   */
  acceptAuthenticatedConnection(socket: Socket, authenticationDeadline?: number): void {
    if (!this.lifetime || this.handedOff.has(socket) || socket.destroyed) {
      throw new Error('POOL_EGRESS_HANDOFF_INVALID');
    }
    this.assertDispatch();
    socket.pause();
    this.handedOff.add(socket);
    this.trackClient(socket);
    const now = performance.now();
    if (
      this.closing ||
      socket.destroyed ||
      (authenticationDeadline !== undefined &&
        (!Number.isFinite(authenticationDeadline) ||
          !Number.isFinite(now) ||
          now >= authenticationDeadline))
    ) {
      throw new Error('POOL_EGRESS_HANDOFF_INVALID');
    }
    this.server.emit('connection', socket);
    socket.resume();
  }

  private assertDispatch(): void {
    if (this.closing) throw new Error('POOL_EGRESS_CLOSING');
    if (this.lifetime) {
      try {
        this.lifetime.drain.assertDispatch(this.lifetime.owner);
      } catch {
        this.lifetime.drain.markUnknown(this.lifetime.owner);
        void this.close().catch(() => {});
        throw new Error('POOL_EGRESS_OWNER_INVALID');
      }
    }
    // The original drain's synchronous guard may itself revoke this proxy.
    if (this.closing) throw new Error('POOL_EGRESS_CLOSING');
  }

  private guardedPipe(source: Readable, target: Writable, destroySource = true): void {
    const assert = () => this.assertDispatch();
    // The final sink checks immediately before target.write, not before a
    // readable buffer which could be drained later after revocation.
    const transfer = new Writable({
      highWaterMark: 64 * 1024,
      write(chunk, _encoding, callback) {
        try {
          assert();
          target.write(chunk, callback);
        } catch {
          callback(new Error('POOL_EGRESS_TRANSFER_REVOKED'));
        }
      },
      final(callback) {
        try {
          assert();
          target.end(callback);
        } catch {
          callback(new Error('POOL_EGRESS_TRANSFER_REVOKED'));
        }
      },
    });
    this.transfers.add(transfer);
    this.trackClosed(transfer, () => this.transfers.delete(transfer));
    const detach = () => {
      source.unpipe(transfer);
      if (destroySource) source.destroy();
      else source.pause();
      transfer.destroy();
    };
    const stop = () => {
      detach();
      target.destroy();
    };
    transfer.once('error', stop);
    source.once('error', stop);
    source.once('close', () => {
      if (!source.readableEnded) stop();
    });
    target.once('close', detach);
    source.pipe(transfer);
  }

  private trackClient(socket: Socket): void {
    if (this.clientSockets.has(socket)) return;
    this.clientSockets.add(socket);
    this.trackClosed(socket, () => this.clientSockets.delete(socket));
  }

  private trackPending<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work);
    void work.then(
      () => this.pending.delete(work),
      () => this.pending.delete(work),
    );
    return work;
  }

  private trackClosed(resource: Socket | ClientRequest | Writable, remove: () => void): void {
    this.trackPending(
      new Promise<void>((resolve) => {
        const closed = () => {
          remove();
          resolve();
        };
        if (resource.closed) closed();
        else resource.once('close', closed);
      }),
    );
  }

  private async handleHttp(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    this.assertDispatch();
    const target = absoluteProxyUrl(req);
    if (!target || target.protocol !== 'http:') {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('browser proxy requires an absolute http URL');
      return;
    }

    const decision = await this.policy.check(target.href);
    this.assertDispatch();
    if (res.destroyed) return;
    if (!decision.allowed) {
      this.logBlocked(target.href, decision.reason);
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('blocked by Holaday browser network policy');
      return;
    }
    if (this.closing) {
      res.destroy();
      return;
    }

    const address = decision.addresses[0];
    if (!address) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('browser proxy could not resolve target');
      return;
    }

    const headers = sanitizeHeaders(req.headers);
    headers.host = target.host;
    const upstream = forwardHttpRequest(
      {
        agent: false,
        host: address,
        family: isIP(address),
        port: target.port ? Number(target.port) : 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: 30_000,
      },
      (upstreamResponse) => {
        try {
          this.assertDispatch();
          const responseHeaders = { ...upstreamResponse.headers };
          if (!req.complete) responseHeaders.connection = 'close';
          res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
          this.guardedPipe(upstreamResponse, res);
        } catch {
          upstreamResponse.destroy();
          res.destroy();
        }
      },
    );
    this.upstreamRequests.add(upstream);
    this.trackClosed(upstream, () => this.upstreamRequests.delete(upstream));
    upstream.once('socket', (socket) => this.trackUpstreamSocket(socket));
    upstream.once('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.once('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        this.lifetime
          ? 'browser proxy upstream failed'
          : `browser proxy upstream failed: ${errorMessage(error)}`,
      );
    });
    // An early 413/401 may close the upload while its response is still being
    // delivered through the same client socket. Stop reading, do not destroy it.
    this.guardedPipe(req, upstream, false);
  }

  private async handleConnect(
    req: IncomingMessage,
    client: Duplex,
    head: Buffer,
    upstream?: IspUpstream,
  ): Promise<void> {
    this.assertDispatch();
    const authority = req.url ?? '';
    const target = parseConnectAuthority(authority);
    if (!target) {
      writeSocketError(client, 400, 'Bad Request');
      return;
    }

    const decision = await this.policy.check(
      `https://${formatAuthority(target.host, target.port)}/`,
    );
    this.assertDispatch();
    if (client.destroyed) return;
    if (!decision.allowed) {
      this.logBlocked(authority, decision.reason);
      writeSocketError(client, 403, 'Forbidden');
      return;
    }

    const track = (socket: Socket) => this.trackUpstreamSocket(socket);
    const cancelled = () => {
      this.assertDispatch();
      return client.destroyed;
    };
    // Only the listed HTTPS hosts take the ISP tunnel; the policy check above
    // still applies to them, sign-in hosts never match.
    const viaIsp =
      upstream && target.port === 443 && proxiedDomain(target.host, upstream.domains) !== undefined;
    const tunnel = viaIsp
      ? await connectThroughUpstream(
          upstream.url,
          formatAuthority(target.host, target.port),
          track,
          cancelled,
        ).catch((error) => {
          upstream.metrics.failures += 1;
          // 5xx, timeouts and refused connections are the endpoint's; a 407 is configuration.
          if (!/isp_upstream_status_4\d\d/.test(errorMessage(error)))
            this.unhealthy.set(upstream.slot, Date.now() + ENDPOINT_RETRY_MS);
          throw error;
        })
      : await connectApprovedAddress(decision.addresses, target.port, track, cancelled);
    if (viaIsp) {
      const { metrics } = upstream;
      metrics.tunnels += 1;
      tunnel.on('data', (chunk: Buffer) => {
        metrics.bytesDown += chunk.length;
      });
      client.on('data', (chunk: Buffer) => {
        metrics.bytesUp += chunk.length;
      });
    }
    this.assertDispatch();
    if (client.destroyed) {
      tunnel.destroy();
      return;
    }
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Holaday\r\n\r\n');
    if (head.length > 0) {
      this.assertDispatch();
      tunnel.write(head);
    }
    this.guardedPipe(tunnel, client);
    this.guardedPipe(client, tunnel);
    bindSocketFailures(client, tunnel);
  }

  private async handleUpgrade(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
    this.assertDispatch();
    const target = absoluteProxyUrl(req);
    if (!target || target.protocol !== 'http:') {
      writeSocketError(client, 400, 'Bad Request');
      return;
    }
    const decision = await this.policy.check(target.href);
    this.assertDispatch();
    if (client.destroyed) return;
    if (!decision.allowed) {
      this.logBlocked(target.href, decision.reason);
      writeSocketError(client, 403, 'Forbidden');
      return;
    }

    const upstream = await connectApprovedAddress(
      decision.addresses,
      target.port ? Number(target.port) : 80,
      (socket) => this.trackUpstreamSocket(socket),
      () => {
        this.assertDispatch();
        return client.destroyed;
      },
    );
    this.assertDispatch();
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    const headers = sanitizeHeaders(req.headers);
    headers.host = target.host;
    upstream.write(`${req.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1\r\n`);
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      this.assertDispatch();
      upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
    }
    this.assertDispatch();
    upstream.write('\r\n');
    if (head.length > 0) {
      this.assertDispatch();
      upstream.write(head);
    }
    this.guardedPipe(upstream, client);
    this.guardedPipe(client, upstream);
    bindSocketFailures(client, upstream);
  }

  private logBlocked(target: string, reason: string): void {
    this.logger?.warn(
      { target: browserUrlForLog(target), reason },
      'browser egress proxy blocked target',
    );
  }

  private trackUpstreamSocket(socket: Socket): void {
    if (this.upstreamSockets.has(socket)) return;
    this.upstreamSockets.add(socket);
    this.trackClosed(socket, () => this.upstreamSockets.delete(socket));
    if (this.closing) socket.destroy();
  }
}

function listenLoopback(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo | null;
      if (address) resolve(`http://127.0.0.1:${address.port}`);
      else reject(new Error('browser egress proxy did not expose a listening address'));
    });
  });
}

/**
 * Opens a CONNECT tunnel through the ISP endpoint. Credentials go only into the
 * Proxy-Authorization header; failures carry the status code, never the URL.
 */
async function connectThroughUpstream(
  proxy: URL,
  authority: string,
  onSocket: (socket: Socket) => void,
  isCancelled: () => boolean,
): Promise<Socket> {
  if (isCancelled()) throw new Error('browser egress proxy is closing');
  const auth = proxy.username
    ? `Proxy-Authorization: Basic ${Buffer.from(
        `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
      ).toString('base64')}\r\n`
    : '';
  return new Promise<Socket>((resolve, reject) => {
    const socket = connectTcp({ host: proxy.hostname, port: Number(proxy.port || 80) });
    const timer = setTimeout(() => socket.destroy(new Error('isp_upstream_timeout')), 15_000);
    let buffered = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', data);
      socket.off('error', failed);
      socket.off('close', closed);
    };
    const failed = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const closed = () => failed(new Error('isp_upstream_closed'));
    const data = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buffered.length > 16 * 1024) failed(new Error('isp_upstream_bad_response'));
        return;
      }
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(buffered.subarray(0, end).toString('latin1'));
      if (status?.[1] !== '200') {
        failed(new Error(`isp_upstream_status_${status?.[1] ?? 'invalid'}`));
        return;
      }
      cleanup();
      socket.pause();
      const rest = buffered.subarray(end + 4);
      if (rest.length > 0) socket.unshift(rest);
      if (isCancelled()) {
        socket.destroy();
        reject(new Error('browser egress proxy is closing'));
        return;
      }
      resolve(socket);
    };
    socket.on('data', data);
    socket.once('error', failed);
    socket.once('close', closed);
    socket.once('connect', () =>
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`),
    );
    onSocket(socket);
  });
}

function absoluteProxyUrl(req: IncomingMessage): URL | null {
  const raw = req.url ?? '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw);
    const host = req.headers.host;
    return host ? new URL(raw || '/', `http://${host}`) : null;
  } catch {
    return null;
  }
}

function parseConnectAuthority(authority: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(`https://${authority}`);
    const port = parsed.port ? Number(parsed.port) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
    return { host: parsed.hostname.replace(/^\[|\]$/g, ''), port };
  } catch {
    return null;
  }
}

function formatAuthority(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

async function connectApprovedAddress(
  addresses: readonly string[],
  port: number,
  onSocket: (socket: Socket) => void,
  isCancelled: () => boolean,
): Promise<Socket> {
  let lastError: unknown = new Error('no approved target address');
  for (const address of addresses) {
    if (isCancelled()) throw new Error('browser egress proxy is closing');
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connectTcp({ host: address, port, family: isIP(address) });
        const timer = setTimeout(() => socket.destroy(new Error('connect timeout')), 10_000);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect', connected);
          socket.off('error', failed);
          socket.off('close', closed);
        };
        const connected = () => {
          cleanup();
          resolve(socket);
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const closed = () => failed(new Error('browser egress connection closed'));
        socket.once('connect', connected);
        socket.once('error', failed);
        socket.once('close', closed);
        onSocket(socket);
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function sanitizeHeaders(
  raw: IncomingMessage['headers'],
): Record<string, string | string[] | undefined> {
  const {
    'proxy-authorization': _proxyAuthorization,
    'proxy-connection': _proxyConnection,
    ...headers
  } = raw;
  return headers;
}

function bindSocketFailures(left: Duplex, right: Socket): void {
  left.once('error', () => right.destroy());
  right.once('error', () => left.destroy());
  left.once('close', () => right.destroy());
  right.once('close', () => left.destroy());
}

function writeSocketError(socket: Duplex, status: number, text: string): void {
  if (socket.destroyed || !socket.writable) return;
  // The browser may close a speculative CONNECT while DNS verification is
  // still running. Swallow that expected EPIPE instead of crashing the proxy.
  socket.once('error', () => {});
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
