import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserNetworkDecision } from '../agent/browser-network-policy.js';
import { BrowserEgressProxy } from './egress-proxy.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('BrowserEgressProxy', () => {
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

    const response = await proxyRequest(
      proxyUrl,
      `http://127.0.0.1:${address.port}/metadata`,
    );

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

    const check = vi.fn(async (rawUrl: string): Promise<BrowserNetworkDecision> => ({
      allowed: true,
      url: rawUrl,
      addresses: ['127.0.0.1'],
    }));
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
        socket.write(
          'CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254:80\r\n\r\n',
        );
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
