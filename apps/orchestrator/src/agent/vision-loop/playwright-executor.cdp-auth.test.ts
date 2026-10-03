import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { createOwnedCdpConnection } from './owned-cdp-connection.js';
import { PlaywrightExecutor } from './playwright-executor.js';

vi.mock('../../config/logger.js', () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}));
const cleanup: Array<() => Promise<unknown>> = [];
beforeEach(() => vi.stubEnv('STEALTH_ENABLED', 'false'));
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

// Actual installed Playwright SDK, HTTP and WebSocket transport. Only the
// remote Chromium protocol peer is synthetic; no browser process is launched.
async function peer() {
  const server = http.createServer((_request, response) => response.writeHead(403).end());
  const websocket = new WebSocketServer({ noServer: true });
  const state = { accepted: 0, refused: 0, versions: 0 };
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/cdp' || request.headers['x-holaday-cdp'] !== 'synthetic-private-cdp') {
      state.refused++;
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      return;
    }
    state.accepted++;
    websocket.handleUpgrade(request, socket, head, (client) => {
      client.on('message', (bytes) => {
        const message = JSON.parse(bytes.toString()) as { id: number; method: string };
        let result: object;
        switch (message.method) {
          case 'Browser.getVersion':
            state.versions++;
            result = {
              protocolVersion: '1.3',
              product: 'Chrome/130.0.0.0',
              revision: 'synthetic',
              userAgent: 'HeadlessChrome/130.0.0.0',
              jsVersion: '12',
            };
            break;
          case 'Target.setAutoAttach':
          case 'Browser.setDownloadBehavior':
            result = {};
            break;
          case 'Target.getTargetInfo':
            result = {
              targetInfo: {
                targetId: 'synthetic-browser',
                type: 'browser',
                title: '',
                url: '',
                attached: false,
              },
            };
            break;
          default:
            client.send(
              JSON.stringify({
                id: message.id,
                error: { code: -32601, message: 'Unsupported synthetic protocol method' },
              }),
            );
            return;
        }
        client.send(JSON.stringify({ id: message.id, result }));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    for (const client of websocket.clients) client.terminate();
    await new Promise<void>((resolve) => websocket.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    endpoint: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/cdp`,
    state,
    websocket,
  };
}

it('passes a snapshotted private CDP header through the actual lazy Playwright SDK', async () => {
  const fixture = await peer();
  const executor = new PlaywrightExecutor();
  cleanup.push(() => executor.disconnect().catch(() => {}));
  const headers = { 'x-holaday-cdp': 'synthetic-private-cdp' };
  const connecting = executor.connect(fixture.endpoint, { cdpHeaders: headers });
  headers['x-holaday-cdp'] = 'changed-after-start';
  expect(await connecting).toEqual({ ok: true });
  expect(fixture.state).toEqual({ accepted: 1, refused: 0, versions: 1 });
  await executor.disconnect();
  await vi.waitFor(() => expect(fixture.websocket.clients.size).toBe(0));
});

it('does not expose authenticated SDK connection diagnostics in the returned result', async () => {
  const executor = new PlaywrightExecutor({
    chromium: {
      connectOverCDP: async () => {
        throw new Error('synthetic-private-cdp in upstream diagnostics');
      },
    },
  });
  cleanup.push(() => executor.disconnect().catch(() => {}));
  const result = await executor.connect('ws://127.0.0.1:1/cdp', {
    cdpHeaders: { 'x-holaday-cdp': 'synthetic-private-cdp' },
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain('synthetic-private-cdp');
});

it('keeps private CDP headers out of enumerable executor state', async () => {
  const fixture = await peer();
  const executor = new PlaywrightExecutor();
  cleanup.push(() => executor.disconnect().catch(() => {}));
  expect(
    await executor.connect(fixture.endpoint, {
      cdpHeaders: { 'x-holaday-cdp': 'synthetic-private-cdp' },
    }),
  ).toEqual({ ok: true });
  const exposed = Object.values(executor).some(
    (value) =>
      value && typeof value === 'object' && Object.values(value).includes('synthetic-private-cdp'),
  );
  expect(exposed).toBe(false);
});

it('contains throwing header getters before any SDK dispatch', async () => {
  const dispatch = vi.fn(async () => {
    throw new Error('must not dispatch');
  });
  const executor = new PlaywrightExecutor({ chromium: { connectOverCDP: dispatch } });
  const headers = Object.defineProperty({}, 'x-holaday-cdp', {
    enumerable: true,
    get() {
      throw new Error('synthetic-private-cdp');
    },
  });
  await expect(executor.connect('ws://127.0.0.1:1/cdp', { cdpHeaders: headers })).resolves.toEqual({
    ok: false,
    error: 'CDP_AUTHENTICATED_CONNECTION_FAILED',
  });
  expect(dispatch).not.toHaveBeenCalled();
});

it('contains throwing owned-connection header getters without dispatch', () => {
  const dispatch = vi.fn(async () => {
    throw new Error('must not dispatch');
  });
  const headers = Object.defineProperty({}, 'x-holaday-cdp', {
    enumerable: true,
    get() {
      throw new Error('synthetic-private-cdp');
    },
  });
  expect(() =>
    createOwnedCdpConnection({ connectOverCDP: dispatch }, 'ws://127.0.0.1:1/cdp', () => true, {
      headers,
    }),
  ).toThrow('CDP_AUTHENTICATED_CONNECTION_FAILED');
  expect(dispatch).not.toHaveBeenCalled();
});

it('reads the caller header property only once', async () => {
  const fixture = await peer();
  const executor = new PlaywrightExecutor();
  cleanup.push(() => executor.disconnect().catch(() => {}));
  let reads = 0;
  const opts = {
    get cdpHeaders() {
      if (++reads > 1) throw new Error('synthetic-private-cdp');
      return { 'x-holaday-cdp': 'synthetic-private-cdp' };
    },
  };
  await expect(executor.connect(fixture.endpoint, opts)).resolves.toEqual({ ok: true });
  expect(reads).toBe(1);
});

it('snapshots the owned transport header property once before deferred dispatch', async () => {
  let reads = 0;
  const headers = { 'x-holaday-cdp': 'synthetic-private-cdp' };
  const browser = { close: async () => {} };
  const dispatch = vi.fn(async () => browser as never);
  const connection = createOwnedCdpConnection(
    { connectOverCDP: dispatch },
    'ws://127.0.0.1:1/cdp',
    () => true,
    {
      get headers() {
        if (++reads > 1) throw new Error('synthetic-private-cdp');
        return headers;
      },
    },
  );
  cleanup.push(() => connection.dispose());
  headers['x-holaday-cdp'] = 'changed';
  await connection.ready;
  expect(reads).toBe(1);
  expect(dispatch).toHaveBeenCalledWith('ws://127.0.0.1:1/cdp', {
    headers: { 'x-holaday-cdp': 'synthetic-private-cdp' },
  });
});

it.skipIf(process.env.HOLADAY_SYNTHETIC_CDP_DEBUG_CHILD !== '1')(
  'authenticated diagnostic child',
  async () => {
    if (process.env.HOLADAY_SYNTHETIC_CDP_DEBUG_CACHED === '1') {
      await import('playwright');
      // The SDK retains its original diagnostic state after DEBUG disappears.
      // biome-ignore lint/performance/noDelete: process.env coerces assigned undefined to a string; this tests absence.
      delete process.env.DEBUG;
    }
    const fixture = await peer();
    const executor = new PlaywrightExecutor();
    cleanup.push(() => executor.disconnect().catch(() => {}));
    expect(
      await executor.connect(fixture.endpoint, {
        cdpHeaders: { 'x-holaday-cdp': 'synthetic-private-cdp' },
      }),
    ).toEqual({ ok: false, error: 'CDP_AUTHENTICATED_CONNECTION_FAILED' });
    expect(fixture.state.accepted).toBe(0);
  },
);

it.skipIf(process.env.HOLADAY_SYNTHETIC_CDP_DEBUG_CHILD === '1').each([false, true])(
  'refuses actual SDK channel diagnostics before private headers can be logged (cached=%s)',
  async (cached) => {
    let code = 0;
    let output = '';
    try {
      const child = await promisify(execFile)(
        process.execPath,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          'src/agent/vision-loop/playwright-executor.cdp-auth.test.ts',
          '-t',
          'authenticated diagnostic child',
          '--poolOptions.threads.maxThreads=1',
          '--poolOptions.threads.minThreads=1',
          '--no-file-parallelism',
        ],
        {
          timeout: 7000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            DEBUG: 'pw:channel',
            DEBUG_FILE: '',
            HOLADAY_SYNTHETIC_CDP_DEBUG_CHILD: '1',
            HOLADAY_SYNTHETIC_CDP_DEBUG_CACHED: cached ? '1' : '0',
            NODE_OPTIONS: '--max-old-space-size=2048',
          },
        },
      );
      output = child.stdout + child.stderr;
    } catch (error) {
      const child = error as { code: number; stdout: string; stderr: string };
      code = child.code;
      output = child.stdout + child.stderr;
    }
    // Match the real SDK SEND record, not a failing test's displayed source line.
    expect(/SEND>.*"method":"connectOverCDP".*synthetic-private-cdp/.test(output)).toBe(false);
    expect(output.includes('synthetic-private-cdp')).toBe(false);
    expect(code).toBe(0);
  },
  10_000,
);
