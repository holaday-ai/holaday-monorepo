import { createServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestKeyProvider } from './crypto.js';
import { installVaultRoutes, vaultBodyErrorHandler } from './http.js';
import { createVaultRuntime } from './runtime.js';
import { MemoryVaultStore } from './vault.js';
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});
async function app(enabled = true) {
  const runtime = enabled
    ? createVaultRuntime({
        importEnabled: true,
        profileEnabled: true,
        keys: new TestKeyProvider(),
        store: new MemoryVaultStore(),
      })
    : undefined;
  const app = express();
  app.use(express.json());
  app.use(vaultBodyErrorHandler);
  app.use((req, _res, next) => {
    (req as typeof req & { userId?: string }).userId = req.header('x-test-user');
    next();
  });
  const send = vi.fn(async () => ({ ok: true }));
  installVaultRoutes({
    get: (path, handler) => {
      app.get(path, handler);
    },
    post: (path, handler) => {
      app.post(path, handler);
    },
    runtime,
    importEnabled: enabled,
    profileEnabled: enabled,
    send,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, body?: unknown, user = 'alice') =>
    fetch(`${url}/browser-data${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { request, send, url };
}
describe('metadata-only authenticated vault HTTP boundary', () => {
  it('is off by default and requires an authenticated owner', async () => {
    const f = await app(false);
    expect((await (await f.request('')).json()).enabled).toBe(false);
    expect((await f.request('/grants', { consent: 'session-import-v1', request: {} })).status).toBe(
      409,
    );
    expect((await f.request('', undefined, '')).status).toBe(401);
  });
  it('does not echo parser errors or malformed credential bodies', async () => {
    const f = await app();
    const response = await fetch(`${f.url}/browser-data/grants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"SYNTHETIC_ONLY":invalid}',
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"invalid_request"}');
  });
  it('requires consent, enforces owner and origin before dispatch, never returns values', async () => {
    const f = await app();
    const request = {
      origin: 'https://fixture.test',
      purposes: ['read', 'session-import'],
      storageKeys: [],
    };
    expect((await f.request('/grants', { request })).status).toBe(400);
    const grant = await (
      await f.request('/grants', { consent: 'session-import-v1', request })
    ).json();
    expect((await f.request(`/grants/${grant.id}/scope`, undefined, 'bob')).status).toBe(409);
    expect(
      (
        await f.request('/dispatch', {
          grantId: grant.id,
          extensionClientId: 'ext',
          target: {
            tabId: 1,
            expectedUrl: 'https://other.test/',
            selectionId: '11111111-1111-4111-8111-111111111111',
          },
        })
      ).status,
    ).toBe(400);
    expect(f.send).not.toHaveBeenCalled();
    const imported = await f.request(`/grants/${grant.id}/import`, {
      cookies: [
        {
          name: 'sid',
          value: 'SYNTHETIC_ONLY',
          domain: 'fixture.test',
          path: '/',
          secure: true,
          httpOnly: true,
          hostOnly: true,
          sameSite: 'lax',
          session: true,
        },
      ],
      storage: [],
    });
    expect(imported.status).toBe(200);
    expect(await imported.text()).not.toContain('SYNTHETIC_ONLY');
    const clear = await f.request('/clear', {});
    expect(clear.status).toBe(200);
    expect(await (await f.request('')).text()).not.toContain('SYNTHETIC_ONLY');
  });
});
