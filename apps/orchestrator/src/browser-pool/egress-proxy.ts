import {
  type ClientRequest,
  type IncomingMessage,
  createServer,
  request as forwardHttpRequest,
} from 'node:http';
import { type Socket, connect as connectTcp, isIP } from 'node:net';
import type { AddressInfo } from 'node:net';
import { type Duplex, type Readable, Writable } from 'node:stream';
import type { BrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import { browserUrlForLog } from './log-url.js';

interface BrowserEgressProxyOptions {
  /** Private original group owner. Presence disables the legacy TCP listener. */
  lifetime?: OperationLifetime;
  policy?: Pick<BrowserNetworkPolicy, 'check'>;
  logger?: {
    warn(context: Record<string, unknown>, message: string): void;
  };
}

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
  private readonly server = createServer((req, res) => {
    void this.trackPending(
      this.handleHttp(req, res).catch((error) => {
        this.logger?.warn({ error: errorMessage(error) }, 'browser egress proxy HTTP failure');
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('browser proxy request failed');
      }),
    );
  });
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
    this.server.on('connect', (req, client, head) => {
      void this.trackPending(
        this.handleConnect(req, client, head).catch((error) => {
          this.logger?.warn(
            { error: errorMessage(error), target: req.url ?? '' },
            'browser egress proxy CONNECT failure',
          );
          writeSocketError(client, 502, 'Bad Gateway');
        }),
      );
    });
    this.server.on('upgrade', (req, client, head) => {
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
    this.server.on('connection', (socket) => {
      this.trackClient(socket);
      if (this.closing) socket.destroy();
    });
    this.server.requestTimeout = 30_000;
    this.server.headersTimeout = 15_000;
    this.server.keepAliveTimeout = 5_000;
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

  private async handleConnect(req: IncomingMessage, client: Duplex, head: Buffer): Promise<void> {
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

    const upstream = await connectApprovedAddress(
      decision.addresses,
      target.port,
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
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Holaday\r\n\r\n');
    if (head.length > 0) {
      this.assertDispatch();
      upstream.write(head);
    }
    this.guardedPipe(upstream, client);
    this.guardedPipe(client, upstream);
    bindSocketFailures(client, upstream);
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
