/** Real bundled extension -> local HTTP vault -> encrypted state -> isolated Chromium.
 * Synthetic cookies/accounts only; no external services, real keys, or user profile.
 * NODE_ENV=test node --test e2e/session-vault.e2e.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockOrchestrator } from './mock-orchestrator.mjs';

const require = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');
const express = require('express');
const root = fileURLToPath(new URL('..', import.meta.url));
const backend = fileURLToPath(new URL('../../orchestrator/', import.meta.url));
const token = 'synthetic-vault-fixture-token';
const secret = 'SYNTHETIC_SESSION_ONLY';
async function source(path) {
  const { tsImport } = await import(
    pathToFileURL(join(backend, 'node_modules/tsx/dist/esm/api/index.mjs')).href
  );
  return tsImport(pathToFileURL(join(backend, 'src', path)).href, import.meta.url);
}

test(
  'bundled extension consent/import/encryption/login/reuse/revoke/expiry',
  { timeout: 180000 },
  async () => {
    const server = new MockOrchestrator();
    const temp = mkdtempSync(join(tmpdir(), 'holaday-vault-e2e-'));
    let local;
    let cloud;
    let writes = 0;
    try {
      const { TestKeyProvider } = await source('browser-session-vault/crypto.ts');
      const { MemoryVaultStore, SessionVault } = await source('browser-session-vault/vault.ts');
      const { VaultBrowserWorker } = await source('browser-session-vault/worker.ts');
      const { installVaultRoutes, vaultBodyErrorHandler } = await source(
        'browser-session-vault/http.ts',
      );
      let now = Date.now();
      const store = new MemoryVaultStore();
      const vault = new SessionVault({
        store,
        keys: new TestKeyProvider(),
        now: () => now,
        importEnabled: true,
        profileEnabled: true,
      });
      await server.start();
      cloud = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
      const worker = new VaultBrowserWorker(vault, {
        context: (options) => cloud.newContext(options),
        networkPolicy: {
          check: async (url) => ({
            allowed: new URL(url).origin === server.origin,
            url,
            addresses: ['127.0.0.1'],
          }),
        },
        probes: new Map([
          [server.origin, { path: '/account-check', selector: '[data-session-ready]' }],
        ]),
      });
      const app = express();
      app.use(express.json());
      app.use(vaultBodyErrorHandler);
      app.use((req, _res, next) => {
        if (req.header('authorization') === `Bearer ${token}`) req.userId = 'alice';
        next();
      });
      installVaultRoutes({
        get: (path, handler) => app.get(path, handler),
        post: (path, handler) => app.post(path, handler),
        runtime: { vault, worker },
        importEnabled: true,
        profileEnabled: true,
        send: async () => ({ ok: false }),
      });
      const original = server.http.listeners('request')[0];
      server.http.removeAllListeners('request');
      server.http.on('request', (req, res) => {
        const path = new URL(req.url, server.origin).pathname;
        if (path.startsWith('/browser-data')) return app(req, res);
        if (path === '/vault-fixture') {
          res.setHeader('content-type', 'text/html');
          return res.end(
            "<title>Vault fixture</title><button onclick=\"fetch('/write', {method:'POST'})\">Write</button>",
          );
        }
        if (path === '/account-check') {
          res.setHeader('content-type', 'text/html');
          if (req.headers.cookie?.includes(`sid=${secret}`))
            return res.end('<div data-session-ready>Connected</div>');
          res.statusCode = 401;
          return res.end('Needs login');
        }
        if (path === '/write') {
          writes++;
          return res.end('unexpected');
        }
        return original(req, res);
      });
      const out = join(temp, 'extension');
      const built = spawnSync(
        process.execPath,
        [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir'],
        {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'production',
            VITE_LOCAL_CHROME_QA: '1',
            VITE_WORKBENCH_URL: `http://localhost:${server.port}`,
            VITE_ORCHESTRATOR_HTTP: server.origin,
            VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${server.port}/ws`,
          },
        },
      );
      assert.equal(built.status, 0, 'synthetic extension build must succeed');
      // QA intentionally strips cookies permission. Restore only that production
      // permission in this disposable loopback fixture, never in a shipped build.
      const manifestPath = join(out, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert.ok(
        manifest.host_permissions.every((host) =>
          /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(host),
        ),
      );
      assert.ok(!manifest.permissions.includes('cookies'));
      manifest.permissions.push('cookies');
      writeFileSync(manifestPath, JSON.stringify(manifest));

      local = await chromium.launchPersistentContext(join(temp, 'profile'), {
        channel: 'chromium',
        headless: true,
        args: [
          '--renderer-process-limit=2',
          `--disable-extensions-except=${out}`,
          `--load-extension=${out}`,
        ],
      });
      const sw =
        local.serviceWorkers()[0] ??
        (await local.waitForEvent('serviceworker', { timeout: 15000 }));
      const connection = server.waitForConnection(1, 20000);
      for (let i = 0; i < 20 && !server.connections.some((c) => c.helloAt); i++) {
        await sw.evaluate(
          async (value) => chrome.storage.local.set({ 'holaday.access_token': value }),
          token,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await connection;
      const page = await local.newPage();
      await page.goto(`${server.origin}/vault-fixture`);
      await local.addCookies([
        { name: 'sid', value: secret, url: server.origin, httpOnly: true, sameSite: 'Lax' },
      ]);
      await page.bringToFront();
      const tabs = await server.call('vault-fixture-task', 'tabs');
      const selected = tabs.result.tabs.find((tab) => tab.title === 'Vault fixture' && tab.active);
      assert.ok(selected);
      const request = async (path, body) => {
        const response = await fetch(`${server.origin}/browser-data${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      const importGrant = async () => {
        const grant = await request('/grants', {
          consent: 'session-import-v1',
          request: {
            origin: server.origin,
            purposes: ['read', 'session-import', 'profile-persist'],
            storageKeys: [],
          },
        });
        const reply = await server.call('vault-fixture-task', 'session_import', {
          sessionImport: {
            grantId: grant.id,
            target: {
              tabId: selected.tabId,
              selectionId: selected.selectionId,
              expectedUrl: selected.url,
            },
          },
        });
        assert.equal(reply.ok, true, reply.error?.code);
        assert.equal(reply.result.status, 'connected');
        assert.equal(reply.result.cookieCount, 1);
        assert.ok(!JSON.stringify(reply).includes(secret));
        assert.ok(!JSON.stringify(await store.dump('alice')).includes(secret));
        return grant;
      };
      const grant = await importGrant();
      await assert.rejects(vault.checkout('bob', grant.id), /grant_unavailable/);
      const task = await worker.open('alice', grant.id);
      await task.page.goto(`${server.origin}/account-check`);
      assert.equal(await task.page.locator('[data-session-ready]').count(), 1);
      await task.page.goto(`${server.origin}/vault-fixture`);
      await task.page.getByRole('button', { name: 'Write' }).click();
      await task.page.waitForTimeout(100);
      assert.equal(writes, 0);
      await task.close();
      const next = await worker.open('alice', grant.id);
      await next.page.goto(`${server.origin}/account-check`);
      assert.equal(await next.page.locator('[data-session-ready]').count(), 1);
      await request(`/grants/${grant.id}/revoke`, {});
      assert.equal(next.page.isClosed(), true);
      await assert.rejects(worker.open('alice', grant.id), /grant_unavailable/);
      const expires = await importGrant();
      const active = await worker.open('alice', expires.id);
      now += 7 * 86400000 + 1;
      assert.equal((await request('')).grants.find((g) => g.id === expires.id).status, 'expired');
      assert.equal(active.page.isClosed(), true);
      await assert.rejects(worker.open('alice', expires.id), /grant_unavailable/);
      assert.ok(!JSON.stringify(server.received).includes(secret));
    } finally {
      await local?.close();
      await cloud?.close();
      await server.stop();
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
