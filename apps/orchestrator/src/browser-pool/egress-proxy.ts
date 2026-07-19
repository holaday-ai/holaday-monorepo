import {
  createServer,
  request as forwardHttpRequest,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http';
import { connect as connectTcp, isIP, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { BrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { defaultBrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import { browserUrlForLog } from './log-url.js';

interface BrowserEgressProxyOptions {
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
    void this.handleHttp(req, res).catch((error) => {
      this.logger?.warn({ error: errorMessage(error) }, 'browser egress proxy HTTP failure');
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('browser proxy request failed');
    });
  });
  private readonly clientSockets = new Set<Socket>();
  private readonly upstreamSockets = new Set<Socket>();
  private readonly upstreamRequests = new Set<ClientRequest>();
  private startPromise: Promise<string> | null = null;
  private closing = false;

  constructor(options: BrowserEgressProxyOptions = {}) {
    this.policy = options.policy ?? defaultBrowserNetworkPolicy;
    this.logger = options.logger;
    this.server.on('connect', (req, client, head) => {
      void this.handleConnect(req, client, head).catch((error) => {
        this.logger?.warn(
          { error: errorMessage(error), target: req.url ?? '' },
          'browser egress proxy CONNECT failure',
        );
        writeSocketError(client, 502, 'Bad Gateway');
      });
    });
    this.server.on('upgrade', (req, client, head) => {
      void this.handleUpgrade(req, client, head).catch((error) => {
        this.logger?.warn(
          { error: errorMessage(error), target: req.url ?? '' },
          'browser egress proxy WebSocket failure',
        );
        writeSocketError(client, 502, 'Bad Gateway');
      });
    });
    this.server.on('connection', (socket) => {
      this.clientSockets.add(socket);
      socket.once('close', () => this.clientSockets.delete(socket));
    });
    this.server.requestTimeout = 30_000;
    this.server.headersTimeout = 15_000;
    this.server.keepAliveTimeout = 5_000;
  }

  start(): Promise<string> {
    if (this.startPromise) return this.startPromise;
    this.closing = false;
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

  async close(): Promise<void> {
    this.closing = true;
    if (!this.server.listening) {
      this.startPromise = null;
      return;
    }
    for (const socket of this.clientSockets) socket.destroy();
    this.clientSockets.clear();
    for (const socket of this.upstreamSockets) socket.destroy();
    this.upstreamSockets.clear();
    for (const request of this.upstreamRequests) request.destroy();
    this.upstreamRequests.clear();
    this.server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeIdleConnections?.();
    });
    this.startPromise = null;
  }

  private async handleHttp(
    req: IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const target = absoluteProxyUrl(req);
    if (!target || target.protocol !== 'http:') {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('browser proxy requires an absolute http URL');
      return;
    }

    const decision = await this.policy.check(target.href);
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
        host: address,
        family: isIP(address),
        port: target.port ? Number(target.port) : 80,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
        timeout: 30_000,
      },
      (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(res);
      },
    );
    this.upstreamRequests.add(upstream);
    upstream.once('close', () => this.upstreamRequests.delete(upstream));
    upstream.once('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.once('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`browser proxy upstream failed: ${errorMessage(error)}`);
    });
    req.pipe(upstream);
  }

  private async handleConnect(
    req: IncomingMessage,
    client: Duplex,
    head: Buffer,
  ): Promise<void> {
    const authority = req.url ?? '';
    const target = parseConnectAuthority(authority);
    if (!target) {
      writeSocketError(client, 400, 'Bad Request');
      return;
    }

    const decision = await this.policy.check(`https://${formatAuthority(target.host, target.port)}/`);
    if (!decision.allowed) {
      this.logBlocked(authority, decision.reason);
      writeSocketError(client, 403, 'Forbidden');
      return;
    }

    const upstream = await connectApprovedAddress(
      decision.addresses,
      target.port,
      (socket) => this.trackUpstreamSocket(socket),
      () => this.closing,
    );
    client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Holaday\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    bindSocketFailures(client, upstream);
  }

  private async handleUpgrade(
    req: IncomingMessage,
    client: Duplex,
    head: Buffer,
  ): Promise<void> {
    const target = absoluteProxyUrl(req);
    if (!target || target.protocol !== 'http:') {
      writeSocketError(client, 400, 'Bad Request');
      return;
    }
    const decision = await this.policy.check(target.href);
    if (!decision.allowed) {
      this.logBlocked(target.href, decision.reason);
      writeSocketError(client, 403, 'Forbidden');
      return;
    }

    const upstream = await connectApprovedAddress(
      decision.addresses,
      target.port ? Number(target.port) : 80,
      (socket) => this.trackUpstreamSocket(socket),
      () => this.closing,
    );
    const headers = sanitizeHeaders(req.headers);
    headers.host = target.host;
    upstream.write(`${req.method ?? 'GET'} ${target.pathname}${target.search} HTTP/1.1\r\n`);
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
    }
    upstream.write('\r\n');
    if (head.length > 0) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    bindSocketFailures(client, upstream);
  }

  private logBlocked(target: string, reason: string): void {
    this.logger?.warn({ target: browserUrlForLog(target), reason }, 'browser egress proxy blocked target');
  }

  private trackUpstreamSocket(socket: Socket): void {
    this.upstreamSockets.add(socket);
    socket.once('close', () => this.upstreamSockets.delete(socket));
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
        onSocket(socket);
        const timer = setTimeout(() => socket.destroy(new Error('connect timeout')), 10_000);
        socket.once('connect', () => {
          clearTimeout(timer);
          socket.removeListener('error', reject);
          resolve(socket);
        });
        socket.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
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
  const headers = { ...raw };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];
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
  socket.end(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
