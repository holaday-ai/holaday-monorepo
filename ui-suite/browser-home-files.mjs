/** Built file panel -> actual Home router/Download/FileService -> owned bytes. SQL/auth/process are synthetic. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultBrowserNetworkPolicy } from '../apps/orchestrator/src/agent/browser-network-policy.js';
import { sharedBrowserDownload } from '../apps/orchestrator/src/agent/browser-tools/browser-download.js';
import { browserHomeSessions } from '../apps/orchestrator/src/browser-home/browser-home-session.js';
import { TestKeyProvider } from '../apps/orchestrator/src/browser-session-vault/crypto.js';
import { createVaultRuntime, installVaultRuntime } from '../apps/orchestrator/src/browser-session-vault/runtime.js';
import { MemoryVaultStore } from '../apps/orchestrator/src/browser-session-vault/vault.js';
import { env } from '../apps/orchestrator/src/config/env.js';
import { FileService } from '../apps/orchestrator/src/files/file-service.js';
import { _resetSharedStorageProviderForTesting } from '../apps/orchestrator/src/files/storage-provider.js';
import { browserOutputFixture } from '../apps/orchestrator/src/files/testing/browser-output-fixture.js';
import { createScreencastProxy } from '../apps/orchestrator/src/streaming/screencast-proxy.js';
import { browserHomeRouter } from '../apps/orchestrator/src/trpc/routers/browser-home.js';
import { startSeedServer } from './lib/server.mjs';

const require = createRequire(new URL('../apps/orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');
const { pino } = require('pino');
const output = process.argv[2];
assert.ok(output, 'output directory required');
await mkdir(output, { recursive: true });
const OWNER = 'usr_alice';
const ORIGIN = 'https://reports.fixture.test';
const CSV = 'month,revenue\n11,500\n';
const logger = pino({ level: 'silent' });
const fixture = await browserOutputFixture();
process.env.HOLADAY_FILES_ROOT = fixture.root;
process.env.STORAGE_PROVIDER = 'local';
_resetSharedStorageProviderForTesting();
const files = new FileService(fixture.db, logger);
env.BROWSER_HOME_ENABLED = true;
env.BROWSER_HOME_ALLOWLIST = '';
env.BROWSER_HOME_FILES_V1 = true;
const oldCheck = defaultBrowserNetworkPolicy.check;
defaultBrowserNetworkPolicy.check = async url => new URL(url).origin === ORIGIN
  ? { allowed: true, url, addresses: ['1.1.1.1'] }
  : { allowed: false, reason: 'private_network', message: 'Synthetic site only' };
const runtime = createVaultRuntime({ importEnabled: false, profileEnabled: false, cloudHomeEnabled: true, keys: new TestKeyProvider(), store: new MemoryVaultStore() });
installVaultRuntime(runtime);
const seed = await startSeedServer(fileURLToPath(new URL('../apps/web-workbench', import.meta.url)));
const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
const instances = new Map();
const prepared = new WeakSet();
const setupPage = async page => {
  if (prepared.has(page)) return;
  prepared.add(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route(`${ORIGIN}/**`, route => route.request().url().endsWith('/report.csv')
    ? route.fulfill({ contentType: 'text/csv', headers: { 'content-disposition': 'attachment; filename="monthly.csv"' }, body: CSV })
    : route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><h1>Monthly report</h1><a href="/report.csv">Download report</a>' }));
};
const pool = {
  allocate: async (taskId, userId, _viewport, session) => {
    let context = await browser.newContext();
    let interrupted = false;
    const executor = {
      getPage: async () => { if (interrupted) throw new Error('session interrupted'); const page = context.pages()[0] ?? await context.newPage(); await setupPage(page); return page; },
      navigate: async (page, url) => { await page.goto(url); return { ok: true }; },
      createSessionVaultContext: async config => { console.log(JSON.stringify({ contextAcceptDownloads: config.acceptDownloads })); await context.close(); context = await browser.newContext(config); return context; },
      markSessionInterrupted: () => { interrupted = true; },
    };
    await runtime.prepare(userId, executor, session);
    const instance = { taskId, userId, executor, status: 'ready', createdAt: Date.now(), lastActiveAt: Date.now(), index: 1, sessionPolicy: session?.sessionPolicy, capabilities: { viewportV2: true, collaborationV2: true }, context: () => context, vaultRuntime: runtime };
    instances.set(taskId, instance);
    return instance;
  },
  peek: id => instances.get(id) ?? null,
  browserHomeHolder: () => null,
  peekBrowserHome: userId => instances.get(`bhs_${userId}`) ?? null,
  endBrowserHomeLoan: () => null,
  touch: id => { const instance = instances.get(id); if (instance) instance.lastActiveAt = Date.now(); },
  setIdleTimeout: (id, ms) => { const instance = instances.get(id); if (instance) instance.idleTimeoutMs = ms; return Boolean(instance); },
  release: async id => { const instance = instances.get(id); if (!instance) return false; instances.delete(id); instance.status = 'draining'; await runtime.finish(instance.executor); await instance.context().close(); instance.status = 'dead'; return true; },
};
const caller = owner => browserHomeRouter.createCaller({ userId: owner, db: fixture.db, logger, browserPool: pool });
const stream = createServer();
const proxy = createScreencastProxy({ pool, logger, authenticateToken: async () => OWNER });
stream.on('upgrade', proxy.handleUpgrade);
stream.listen(0, '127.0.0.1'); await once(stream, 'listening');
const streamOrigin = `ws://127.0.0.1:${stream.address().port}`;
const reads = [];
const gateway = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const owner = req.headers.authorization === 'Bearer file-ui-seed' ? OWNER : 'usr_bob';
    if (url.pathname.startsWith('/api/files/')) {
      const id = url.pathname.split('/')[3];
      const loaded = await files.loadForUser(id, owner === OWNER ? 7 : 8);
      reads.push({ id, owner, homeClosed: !pool.peek(`bhs_${OWNER}`), bytes: loaded?.buffer.length ?? 0 });
      res.writeHead(loaded ? 200 : 404, { 'content-type': loaded?.row.mimetype ?? 'text/plain' }); res.end(loaded?.buffer ?? 'not found'); return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const names = url.pathname.startsWith('/api/trpc/') ? decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',') : [];
    if (!names.some(name => name === 'auth.me' || name.startsWith('browserHome.'))) {
      const response = await fetch(seed.origin + url.pathname + url.search, { method: req.method, ...(req.method === 'POST' ? { body, headers: { 'content-type': 'application/json' } } : {}) });
      res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([key]) => !['content-length', 'transfer-encoding', 'connection'].includes(key)))); res.end(Buffer.from(await response.arrayBuffer())); return;
    }
    const inputs = JSON.parse(req.method === 'POST' ? body || '{}' : url.searchParams.get('input') || '{}');
    let original = [];
    if (names.some(name => !name.startsWith('browserHome.'))) {
      const response = await fetch(seed.origin + url.pathname + url.search, { method: req.method, ...(req.method === 'POST' ? { body, headers: { 'content-type': 'application/json' } } : {}) });
      const raw = await response.json(); original = Array.isArray(raw) ? raw : [raw];
    }
    const data = [];
    for (const [index, name] of names.entries()) {
      if (name === 'auth.me') { data.push({ result: { data: { ...original[index]?.result?.data, userId: owner, browserHomeEnabled: true, browserHomeProfilesEnabled: false } } }); continue; }
      if (!name.startsWith('browserHome.')) { data.push(original[index]); continue; }
      const input = url.searchParams.has('batch') ? inputs[index] : inputs;
      try { data.push({ result: { data: await caller(owner)[name.slice('browserHome.'.length)](input?.json ?? input) } }); }
      catch (error) { data.push({ error: { message: error.message, code: -32012, data: { code: error.code ?? 'INTERNAL_SERVER_ERROR', httpStatus: 412, path: name } } }); }
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  } catch (error) { res.writeHead(500); res.end(error.message); }
});
gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
const appOrigin = `http://127.0.0.1:${gateway.address().port}`;
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(({ streamOrigin, seedOrigin }) => {
      localStorage.setItem('holaday.access_token', 'file-ui-seed'); localStorage.setItem('holaday-theme', 'light');
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket { constructor(url, protocols) { const parsed = new URL(url, location.href); super(parsed.pathname.startsWith('/screencast-ws/') ? streamOrigin + parsed.pathname + parsed.search : parsed.pathname === '/ws' ? seedOrigin.replace('http:', 'ws:') + parsed.pathname + parsed.search : url, protocols); } };
    }, { streamOrigin, seedOrigin: seed.origin });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${appOrigin}/browser`);
      await page.getByRole('button', { name: '浏览器文件', exact: true }).waitFor();
      const address = page.getByRole('textbox', { name: /云浏览器地址栏/ }); await address.fill(ORIGIN); await address.press('Enter');
      const remote = await pool.peek(`bhs_${OWNER}`).executor.getPage();
      remote.on('download', download => {
        void download.failure().then(failure => console.log(JSON.stringify({ downloadFailure: failure, suggested: download.suggestedFilename() })));
        void sharedBrowserDownload(download, pool.peek(`bhs_${OWNER}`).executor)?.catch(error => console.log(JSON.stringify({ saveFailure: error.message })));
      });
      await remote.getByRole('link', { name: 'Download report' }).click();
      await page.getByRole('button', { name: '浏览器文件', exact: true }).click();
      await page.getByRole('button', { name: '下载 monthly.csv', exact: true }).first().waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'HOLA DAY 主页', exact: true }).click();
      // Close the actual original context, then fetch bytes through the built authenticated UI.
      await browserHomeSessions.close(pool, OWNER);
      assert.equal(pool.peek(`bhs_${OWNER}`), null);
      await page.getByRole('button', { name: '浏览器文件', exact: true }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 monthly.csv', exact: true }).first().click()]);
      assert.equal(download.suggestedFilename(), 'monthly.csv');
      const bytes = await readFile(await download.path()); assert.equal(bytes.toString(), CSV);
      assert.ok(reads.some(row => row.homeClosed && row.owner === OWNER && row.bytes === bytes.length));
      const wrong = await context.request.get(`${appOrigin}/api/files/${fixture.records.at(-1).externalId}/download`, { headers: { authorization: 'Bearer other-synthetic-owner' } });
      assert.equal(wrong.status(), 404);
      assert.deepEqual((await caller('usr_bob').files()).files, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const dialog = page.getByRole('dialog');
      const bounds = await dialog.boundingBox(); assert.ok(bounds.width <= viewport.width && bounds.x >= 0);
      assert.deepEqual(errors, []);
      assert.equal(await page.getByText(/任务执行失败|出现了未知错误/).count(), 0);
      await page.screenshot({ path: `${output}/files-${viewport.width}.png` });
      results.push({ viewport, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), closedContextRetrieval: true, otherOwner404: true, bounds });
    } catch (error) { await page.screenshot({ path: `${output}/failure-${viewport.width}.png` }); throw error; }
    finally { await context.close(); await browserHomeSessions.close(pool, OWNER); }
  }
  await writeFile(`${output}/result.json`, JSON.stringify({ results, reads, sqlAuthProcessDoubles: true, modelCalls: 0 }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results }));
} finally {
  installVaultRuntime(undefined); defaultBrowserNetworkPolicy.check = oldCheck;
  for (const id of [...instances.keys()]) await pool.release(id);
  await browser.close(); await seed.close();
  gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve));
  stream.closeAllConnections(); await new Promise(resolve => stream.close(resolve));
  _resetSharedStorageProviderForTesting(); await rm(fixture.root, { recursive: true, force: true });
}
