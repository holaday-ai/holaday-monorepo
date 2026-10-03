import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_LOCAL_CHROME_QA', '1');
  vi.stubEnv('VITE_WORKBENCH_URL', 'http://127.0.0.1:5201');
  vi.stubEnv('VITE_ORCHESTRATOR_HTTP', 'http://127.0.0.1:3001');
  vi.stubEnv('VITE_ORCHESTRATOR_WS', 'ws://127.0.0.1:3002');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  ['http://127.0.0.1:5198/', false],
  ['http://127.0.0.1:5201/', true],
])('local QA content auth bridge reads only the exact workbench: %s', async (href, allowed) => {
  vi.useFakeTimers();
  const getItem = vi.fn(() => 'synthetic-qa-token');
  const sendMessage = vi.fn((_message: unknown, callback: () => void) => callback());
  vi.stubGlobal('window', {
    location: { href },
    localStorage: { getItem },
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  await import('../content/auth-bridge.js');
  await vi.advanceTimersByTimeAsync(6_000);
  if (allowed) {
    expect(getItem).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  } else {
    expect(getItem).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  }
});

function nativeBoundary() {
  const getAll = vi.fn(async () => []);
  const search = vi.fn(async () => []);
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          synced: 1,
          domains: [],
          deferred: true,
          ingested: 1,
          rejected: 0,
          topDomains: [],
        }),
      ),
  );
  vi.stubGlobal('chrome', {
    cookies: { getAll },
    history: { search },
    storage: { local: { get: vi.fn(async () => ({ 'holaday.access_token': 'synthetic-token' })) } },
  });
  vi.stubGlobal('fetch', fetch);
  return { getAll, search, fetch };
}

async function loadManifest() {
  const manifest = await (await import('../../manifest.config.js')).default;
  if (typeof manifest === 'function') throw new Error('Expected an object manifest');
  return manifest;
}

it('production-built local QA passes HTTP health and reaches the separate WS handshake', async () => {
  vi.stubEnv('PROD', true);
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return new Response('', { status: url === 'http://127.0.0.1:3001/healthz' ? 200 : 426 });
    }),
  );
  const opened: string[] = [];
  vi.stubGlobal(
    'WebSocket',
    class {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      constructor(url: string) {
        opened.push(url);
      }
      addEventListener() {}
      close() {}
    },
  );
  vi.stubGlobal('chrome', {
    runtime: { onSuspend: { addListener() {} } },
    storage: { local: { get: async () => ({}) } },
  });
  const client = await import('../background/ws-client.js');
  try {
    client.connect('synthetic-qa-token');
    await vi.waitFor(() => expect(opened).toEqual(['ws://127.0.0.1:3002']));
    expect(fetched).toEqual(['http://127.0.0.1:3001/healthz', 'http://127.0.0.1:3002/']);
  } finally {
    client.disconnect();
  }
});

it.each([
  ['http://127.0.0.1:5198/', null],
  ['http://127.0.0.1:5201/', 'synthetic-qa-token'],
])('QA injected auto-login rechecks the committed document: %s', async (href, expected) => {
  const getItem = vi.fn(() => 'synthetic-qa-token');
  vi.stubGlobal('window', {
    location: { origin: new URL(href).origin },
    localStorage: { getItem },
  });
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [
        {
          id: 2,
          url: href,
          pendingUrl: 'http://127.0.0.1:5201/',
        },
      ]),
    },
    scripting: {
      executeScript: vi.fn(
        async (options: {
          func: (...args: unknown[]) => unknown;
          args?: unknown[];
        }) => [{ result: options.func(...(options.args ?? [])) }],
      ),
    },
  });
  const { tryAutoLogin } = await import('./auto-login.js');
  expect(await tryAutoLogin()).toBe(expected);
  if (expected === null) expect(getItem).not.toHaveBeenCalled();
});

it('build rejects disagreement between shell manifest and Vite runtime QA flags', async () => {
  vi.stubEnv('VITE_LOCAL_CHROME_QA', '');
  const config = await import('../../manifest.config.js');
  expect(() => config.assertLocalQaBuildEnv({ VITE_LOCAL_CHROME_QA: '1' })).toThrow(
    /QA configuration/,
  );
});

it('build rejects QA endpoint disagreement and accepts identical configuration', async () => {
  const config = await import('../../manifest.config.js');
  const env = {
    VITE_LOCAL_CHROME_QA: '1',
    VITE_WORKBENCH_URL: 'http://127.0.0.1:5201',
    VITE_ORCHESTRATOR_HTTP: 'http://127.0.0.1:3001',
    VITE_ORCHESTRATOR_WS: 'ws://127.0.0.1:3002',
  };
  expect(() => config.assertLocalQaBuildEnv(env)).not.toThrow();
  expect(() =>
    config.assertLocalQaBuildEnv({ ...env, VITE_WORKBENCH_URL: 'https://holaday.ai/' }),
  ).toThrow(/QA configuration/);
});

it('local QA login button focuses the configured QA tab, never production', async () => {
  const update = vi.fn(async () => ({}));
  const create = vi.fn(async () => ({}));
  const query = vi.fn(async () => [
    { id: 1, url: 'https://holaday.ai/', active: true },
    { id: 2, url: 'http://127.0.0.1:5201/' },
  ]);
  vi.stubGlobal('chrome', { tabs: { query, update, create } });
  const { openOrFocusWorkbench } = await import('./open-workbench.js');
  await openOrFocusWorkbench('http://127.0.0.1:5201');
  expect(query).toHaveBeenCalledWith({});
  expect(update).toHaveBeenCalledWith(2, { active: true });
  expect(create).not.toHaveBeenCalled();
});

it('local QA collect and welcome/manual sync never read cookies', async () => {
  const boundary = nativeBoundary();
  const { collectCookies, runCookieSync } = await import('../background/cookie-sync.js');
  expect(await collectCookies()).toEqual([]);
  await runCookieSync();
  expect(boundary.getAll).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('local QA rejects direct cookie upload even when a caller supplies values', async () => {
  const boundary = nativeBoundary();
  const { syncCookiesToServer } = await import('../background/cookie-sync.js');
  expect(
    await syncCookiesToServer([
      {
        domain: 'example.com',
        name: 'session',
        value: 'synthetic',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
      },
    ]),
  ).toBeNull();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('local QA collect and welcome/manual sync never read browsing history', async () => {
  const boundary = nativeBoundary();
  const { collectBrowsingHistory, runHistorySync } = await import('../background/history-sync.js');
  expect(await collectBrowsingHistory()).toEqual([]);
  expect(await runHistorySync()).toBeNull();
  expect(boundary.search).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('local QA rejects direct history upload', async () => {
  const boundary = nativeBoundary();
  const { syncHistoryToServer } = await import('../background/history-sync.js');
  expect(
    await syncHistoryToServer([
      {
        domain: 'example.com',
        visitCount: 1,
        lastVisitAt: '2026-09-15T00:00:00.000Z',
      },
    ]),
  ).toBeNull();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('local QA login-state discovery never reads cookie jars', async () => {
  const boundary = nativeBoundary();
  const { readLoginStates } = await import('../background/cookie-bridge.js');
  expect(await readLoginStates()).toEqual({});
  expect(boundary.getAll).not.toHaveBeenCalled();
});

it('local QA accepts auth only from its configured workbench origin', async () => {
  const { isTrustedAuthBridgeSender } = await import('../background/auth-bridge-trust.js');
  expect(isTrustedAuthBridgeSender('http://127.0.0.1:5201/')).toBe(true);
  for (const url of ['https://holaday.ai/', 'http://127.0.0.1:5198/', 'http://localhost:5201/']) {
    expect(isTrustedAuthBridgeSender(url)).toBe(false);
  }
});

it('local QA auto-login does not lift production or unrelated localhost tokens', async () => {
  const executeScript = vi.fn(async () => [{ result: 'synthetic-production-token' }]);
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [
        { id: 1, url: 'https://holaday.ai/', active: true },
        { id: 2, url: 'http://127.0.0.1:5198/' },
      ]),
    },
    scripting: { executeScript },
  });
  const { tryAutoLogin } = await import('./auto-login.js');
  expect(await tryAutoLogin()).toBeNull();
  expect(executeScript).not.toHaveBeenCalled();
});

it('local QA manifest cannot request cookie/history or production auth access', async () => {
  const manifest = await loadManifest();
  expect(manifest.permissions).not.toContain('cookies');
  expect(manifest.permissions).not.toContain('history');
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.content_scripts?.[0]?.matches).toEqual(['http://127.0.0.1/*']);
  expect(manifest.name).toContain('Local QA');
});

it('local QA can still obtain the token from its exact workbench', async () => {
  const executeScript = vi.fn(async (_options: unknown) => [{ result: 'synthetic-qa-token' }]);
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [
        { id: 1, url: 'https://holaday.ai/', active: true },
        { id: 2, url: 'http://127.0.0.1:5201/tasks' },
      ]),
    },
    scripting: { executeScript },
  });
  const { tryAutoLogin } = await import('./auto-login.js');
  expect(await tryAutoLogin()).toBe('synthetic-qa-token');
  expect(executeScript).toHaveBeenCalledTimes(1);
  expect(executeScript.mock.calls[0]?.[0]).toMatchObject({ target: { tabId: 2 } });
});

it.each(['VITE_WORKBENCH_URL', 'VITE_ORCHESTRATOR_HTTP', 'VITE_ORCHESTRATOR_WS'])(
  'local QA build rejects a remote %s endpoint',
  async (key) => {
    vi.stubEnv(key, key.endsWith('_WS') ? 'wss://holaday.ai/ws' : 'https://holaday.ai');
    await expect(import('../../manifest.config.js')).rejects.toThrow('loopback endpoints');
  },
);

it('normal release keeps its original manifest permissions and auth hosts', async () => {
  vi.stubEnv('VITE_LOCAL_CHROME_QA', '');
  vi.stubEnv('VITE_EXTENSION_INCLUDE_DEV_HOSTS', '');
  const manifest = await loadManifest();
  expect(manifest.name).toBe('HOLA DAY');
  // The installed 0.0.1 release cannot speak selected-session v1.
  // Chrome must recognize this compatible build as an update, not the same release.
  expect(manifest.version.localeCompare('0.0.1', undefined, { numeric: true })).toBeGreaterThan(0);
  expect(manifest.version).toBe((await import('../../package.json')).version);
  expect(manifest.permissions).toContain('cookies');
  expect(manifest.permissions).toContain('history');
  expect(manifest.host_permissions).toEqual(['<all_urls>']);
  expect(manifest.content_scripts?.[0]?.matches).toEqual([
    'https://holaday.ai/*',
    'https://*.holaday.ai/*',
    'https://hd-app.orangebench.tech/*',
  ]);
});
