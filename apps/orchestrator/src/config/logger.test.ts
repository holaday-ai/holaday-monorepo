import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { pinoHttp } from 'pino-http';
import { loggerOptions } from './logger.js';

describe('HTTP request logging', () => {
  it('redacts authentication headers and cookies from serialized logs', async () => {
    const authorization = 'Bearer production-token-value';
    const cookie = 'session=private-cookie-value';
    const apiKey = 'private-api-key-value';
    const alternateApiKey = 'private-alternate-api-key-value';
    const proxyAuthorization = 'Basic private-proxy-credentials';
    const setCookie = 'session=private-response-cookie';
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const httpLogger = pinoHttp({ logger: pino(loggerOptions, sink) });
    const server = createServer((req, res) => {
      httpLogger(req, res, () => {
        res.setHeader('set-cookie', setCookie);
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            headers: {
              authorization,
              cookie,
              'api-key': alternateApiKey,
              'proxy-authorization': proxyAuthorization,
              'x-api-key': apiKey,
            },
          },
          (res) => {
            res.resume();
            res.on('end', resolve);
          },
        );
        req.on('error', reject);
        req.end();
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    const output = chunks.join('');
    expect(output).not.toContain(authorization);
    expect(output).not.toContain(cookie);
    expect(output).not.toContain(apiKey);
    expect(output).not.toContain(alternateApiKey);
    expect(output).not.toContain(proxyAuthorization);
    expect(output).not.toContain(setCookie);

    const entry = JSON.parse(output) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(entry.req.headers.authorization).toBe('[Redacted]');
    expect(entry.req.headers.cookie).toBe('[Redacted]');
    expect(entry.req.headers['api-key']).toBe('[Redacted]');
    expect(entry.req.headers['proxy-authorization']).toBe('[Redacted]');
    expect(entry.req.headers['x-api-key']).toBe('[Redacted]');
    expect(entry.res.headers['set-cookie']).toBe('[Redacted]');
  });
});
