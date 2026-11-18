/** Built candidate + real Chromium/CDP stream, with synthetic auth and a local fixture only. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { browserControlSessions } from '../apps/orchestrator/src/agent/supercar/browser-control-sessions.js';
import { env } from '../apps/orchestrator/src/config/env.js';
import { createScreencastProxy } from '../apps/orchestrator/src/streaming/screencast-proxy.js';
import { startSeedServer } from './lib/server.mjs';

const require = createRequire(new URL('../apps/orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');
const { pino } = require('pino');
const appDir = fileURLToPath(new URL('../apps/web-workbench', import.meta.url));
const output = process.env.BA_COLLABORATION_OUTPUT;
if (!output) throw new Error('BA_COLLABORATION_OUTPUT is required');
await mkdir(output, { recursive: true });
env.BROWSER_HOME_ENABLED = true;
env.BROWSER_HOME_ALLOWLIST = 'usr_ui';
const seed = await startSeedServer(appDir);
const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
const remote = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await remote.route('https://fixture.example/**', (route) => route.fulfill({
  contentType: 'text/html',
  body: '<!doctype html><meta charset="utf-8"><style>body{padding:50px;font:24px sans-serif}input{font:24px sans-serif;width:550px}</style><h1>本机协作输入验证</h1><label>备注 <input id="q"></label>',
}));
await remote.goto('https://fixture.example/');
const instance = {
  taskId: 'bhs_usr_ui', userId: 'usr_ui', status: 'ready',
  executor: { getPage: async () => remote },
  capabilities: { viewportV2: true, collaborationV2: true, observationV2: false, replayV1: false, routingV2: false },
};
const binding = browserControlSessions.start(instance);
const server = createServer();
const pool = {
  peek: (id) => id === instance.taskId ? instance : null,
  peekBrowserHome: (id) => id === instance.userId ? instance : null,
  browserHomeHolder: () => null,
  touch: () => {},
  release: async () => { throw new Error('Unexpected unsettled input on teardown'); },
};
const proxy = createScreencastProxy({
  pool, logger: pino({ level: 'silent' }), authenticateToken: async () => 'usr_ui',
  beforeViewportAction: async (_, envelope) => ({
    request: { taskId: instance.taskId, runId: 'fixture', actor: 'human', lane: 'cdp', tabId: envelope.observation.tabId, origin: 'https://fixture.example', observationRevision: envelope.observation.viewportRevision, actionDigest: 'fixture' },
    decision: { kind: 'allow', sensitive: false },
  }),
});
server.on('upgrade', proxy.handleUpgrade);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const streamOrigin = `ws://127.0.0.1:${server.address().port}`;
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await remote.locator('#q').fill('');
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addInitScript(({ streamOrigin }) => {
      localStorage.setItem('holaday.access_token', 'ui-local-seed');
      localStorage.setItem('holaday-theme', 'light');
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(url, protocols) {
          const parsed = new URL(url, location.href);
          super(parsed.pathname.startsWith('/screencast-ws/') ? streamOrigin + parsed.pathname + parsed.search : url, protocols);
        }
      };
    }, { streamOrigin });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== seed.origin && !url.protocol.startsWith('data')) return route.abort();
      if (!url.pathname.startsWith('/api/trpc/')) return route.continue();
      const names = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
      if (!names.some((name) => name === 'auth.me' || name.startsWith('browserHome.'))) return route.continue();
      const existing = await route.fetch();
      const raw = await existing.json();
      const rows = Array.isArray(raw) ? raw : [raw];
      const data = names.map((name, index) => {
        if (name === 'auth.me') return { result: { data: { ...rows[index].result.data, browserHomeEnabled: true } } };
        if (name === 'browserHome.open') return { result: { data: { sessionId: instance.taskId, url: 'https://fixture.example/', capabilities: instance.capabilities } } };
        if (name === 'browserHome.close') return { result: { data: { released: false } } };
        return rows[index];
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.searchParams.has('batch') ? data : data[0]) });
    });
    await page.goto(`${seed.origin}/browser`);
    const canvas = page.locator('canvas');
    await page.waitForFunction(() => Boolean(document.querySelector('canvas')?.dataset.frameId));
    const remoteBox = await remote.locator('#q').boundingBox();
    const canvasBox = await canvas.boundingBox();
    assert.ok(remoteBox && canvasBox);
    await page.mouse.click(canvasBox.x + (remoteBox.x + 20) / 1280 * canvasBox.width, canvasBox.y + (remoteBox.y + 12) / 800 * canvasBox.height);
    await page.keyboard.type('Hello ');
    await remote.waitForFunction(() => document.querySelector('#q').value === 'Hello ');
    const hidden = page.locator('.cdp-screencast-host input');
    await hidden.evaluate((input) => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
    const holdDeadline = Date.now() + 3000;
    while (!binding.control.humanActivity.hasHeld() && Date.now() < holdDeadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(binding.control.humanActivity.hasHeld(), true);
    const held = await binding.control.checkpoint(async () => { throw new Error('Observed while IME still held'); }, { maxWaitMs: 2100 });
    assert.equal(held.blocked, true);
    await hidden.evaluate((input) => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
    await remote.waitForFunction(() => document.querySelector('#q').value === 'Hello 中文');
    let observed = 0;
    assert.equal((await binding.control.checkpoint(async () => { await remote.screenshot(); observed++; })).resumed, true);
    assert.equal(observed, 1);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/home-collaboration-${viewport.width}.png`, fullPage: true });
    console.log(JSON.stringify({ viewport, text: await remote.locator('#q').inputValue(), heldCompositionBlocked: true, freshObservations: observed, errors }));
    await context.close();
  }
} finally {
  binding.finish();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await seed.close();
}
