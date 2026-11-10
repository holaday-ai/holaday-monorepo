/**
 * FIX-61 复审 #2 #2 — local-only end-to-end test. Never uses credentials, DB, models or production.
 *
 * An ended task (部分完成 by default; `--status=completed` etc.) whose browser was released:
 * the real BrowserPanel, the real browserControl / browserControlState procedures and the real
 * screencast proxy over a real Chromium page. The user only clicks and types on the rendered
 * canvas: the panel reopens the browser on the task's page, takes control by itself, and the
 * link click and the search-box typing land on the page.
 *
 * The click that asks for control must itself land (one click, no retry) on a still page.
 *
 * Run from apps/orchestrator (the config loader needs these three set; nothing connects to them):
 *   DATABASE_URL=mysql://fixture@127.0.0.1:1/none REDIS_URL=redis://127.0.0.1:1 \
 *   JWT_SECRET=local-fixture-only-local-fixture-only-0000 TERMINAL_TAKEOVER_E2E_OUTPUT=<dir> \
 *   pnpm exec tsx scripts/terminal-takeover-e2e.ts [--status=partial_success|completed|failed]
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pino } from 'pino';
import { type Page, chromium } from 'playwright';
import { z } from 'zod';
import { browserControlSessions } from '../src/agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../src/browser-pool/types.js';
import { authorizeHumanViewportInput } from '../src/streaming/captcha-viewport-action.js';
import { createScreencastProxy } from '../src/streaming/screencast-proxy.js';
import {
  browserControlProcedure,
  browserControlStateProcedure,
} from '../src/trpc/routers/browser-control.js';
import { publicProcedure, router } from '../src/trpc/trpc.js';

const out = process.env.TERMINAL_TAKEOVER_E2E_OUTPUT;
if (!out) throw Error('TERMINAL_TAKEOVER_E2E_OUTPUT required');
await mkdir(out, { recursive: true });
const status = process.argv.find((a) => a.startsWith('--status='))?.slice(9) ?? 'partial_success';
const webPort = Number(process.env.TERMINAL_TAKEOVER_WEB_PORT ?? 4329);
const apiPort = Number(process.env.TERMINAL_TAKEOVER_API_PORT ?? 4328);
const logger = pino({ level: process.env.E2E_TRACE ? 'debug' : 'silent' });
const taskId = 'tsk_terminal_takeover_e2e';
const FINAL_URL = 'https://compare.holaday-fixture.test/iphone/compare';
const browser = await chromium.launch({ headless: true });
const capabilities = { viewportV2: true, observationV2: true, replayV1: false, routingV2: false };

const PAGE_STYLE =
  '<style>body{font:22px system-ui;margin:0}a,input{position:absolute;font:22px system-ui}a{left:60px;top:160px;padding:12px 20px;background:#eef}input{left:60px;top:300px;width:420px;height:44px}</style>';
async function routeFixture(page: Page) {
  await page.route('https://compare.holaday-fixture.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body:
        path === '/iphone/compare'
          ? `<!doctype html>${PAGE_STYLE}<h1 style="margin:40px 60px">机型比较（本地固定页）</h1><a id="iphone" href="/iphone">iPhone</a>`
          : `<!doctype html>${PAGE_STYLE}<h1 style="margin:40px 60px">iPhone（本地固定页）</h1><input id="q" aria-label="搜索" placeholder="搜索">`,
    });
  });
}

// The pool: the task's browser starts released. ensureBrowserSession (fixture of the real
// restore: same task, same page) reopens it; everything after that is the real code path.
let instance: BrowserInstance | null = null;
let page: Page | null = null;
const effects: string[] = [];
async function reopen() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  await routeFixture(page);
  await page.goto(FINAL_URL);
  const current = page;
  instance = {
    taskId,
    userId: 'usr_fixture',
    index: 0,
    status: 'ready',
    capabilities,
    executor: { getPage: async () => current },
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  } as unknown as BrowserInstance;
}
const pool = {
  touch: () => {},
  peek: (id: string) => (id === taskId ? instance : null),
  peekActiveForUser: (id: string) => (id === 'usr_fixture' ? instance : null),
};
const row = { status, userExternalId: 'usr_fixture', userId: 1 };
const query = {
  from: () => query,
  innerJoin: () => query,
  where: () => query,
  limit: async () => [row],
};
const appRouter = router({
  tasks: router({
    browserControlState: browserControlStateProcedure,
    browserControl: browserControlProcedure,
    ensureBrowserSession: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async () => {
        effects.push('ensure');
        const restored = !instance;
        if (restored) await reopen();
        return { status: 'ready' as const, restored, url: page?.url() ?? FINAL_URL };
      }),
    checkpointBrowserSession: publicProcedure.input(z.any()).mutation(() => ({ ok: true })),
  }),
  browserReplay: router({
    capabilities: publicProcedure.input(z.any().optional()).query(() => capabilities),
  }),
});
const app = express();
app.use((req, _res, next) => {
  if (req.path.startsWith('/trpc/tasks.browserControl') && req.method === 'POST')
    effects.push('takeover-request');
  next();
});
app.post('/stream-token', (_req, res) => res.json({ token: 'local-fixture-only' }));
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: () =>
      ({ userId: 'usr_fixture', db: { select: () => query }, browserPool: pool, logger }) as never,
  }),
);
const server = createServer(app);
const proxy = createScreencastProxy({
  pool: pool as never,
  logger,
  authenticateToken: async (token) => (token === 'local-fixture-only' ? 'usr_fixture' : null),
  beforeViewportAction: authorizeHumanViewportInput,
});
server.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head));
await new Promise<void>((resolve) => server.listen(apiPort, '127.0.0.1', resolve));
const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--strictPort'], {
  cwd: fileURLToPath(new URL('../../web-workbench', import.meta.url)),
  env: {
    ...process.env,
    HOLADAY_WEB_PORT: String(webPort),
    HOLADAY_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    HOLADAY_BROWSER_WS_PROXY_TARGET: `ws://127.0.0.1:${apiPort}`,
  },
  stdio: 'ignore',
  detached: true,
});
const ui = await browser.newPage({ viewport: { width: 1024, height: 768 } });
await ui.route('**/*', (route) =>
  new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
);
const errors: string[] = [];
if (process.env.E2E_WS_TRACE)
  ui.on('websocket', (socket) => {
    const t0 = Date.now();
    socket.on('framesent', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        console.log(
          JSON.stringify({
            ms: Date.now() - t0,
            sent: m.type,
            p: m.payload?.type ?? m.width ?? '',
            lease: !!m.controlLease,
          }),
        );
      } catch {}
    });
    socket.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        console.log(
          JSON.stringify({
            ms: Date.now() - t0,
            recv: m.type,
            w: m.width ?? m.geometry?.cssWidth,
            h: m.height ?? m.geometry?.cssHeight,
            r: m.reason ?? m.error,
          }),
        );
      } catch {}
    });
  });
ui.on('pageerror', (e) => errors.push(e.message));
const header = async () =>
  ui.evaluate(() =>
    [...document.querySelectorAll('header, [role="status"]')]
      .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 240),
  );

/** Click the canvas at the point showing page element `selector` (page CSS px → canvas). */
async function clickOnScreen(selector: string) {
  assert.ok(page);
  const target = await page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth, h: innerHeight };
  }, selector);
  const box = await ui.locator('canvas').boundingBox();
  assert.ok(box);
  await ui.mouse.click(
    box.x + (target.x / target.w) * box.width,
    box.y + (target.y / target.h) * box.height,
  );
}

try {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${webPort}/e2e/terminal-takeover.html`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await ui.goto(
    `http://127.0.0.1:${webPort}/e2e/terminal-takeover.html?status=${encodeURIComponent(status)}`,
  );
  // 1. The released browser is reopened on the task's page and its live frame is shown.
  await ui.waitForFunction(
    () => (document.querySelector('canvas') as HTMLCanvasElement | null)?.width,
    undefined,
    { timeout: 30000 },
  );
  await ui.getByText('画面实时同步').first().waitFor({ timeout: 30000 });
  await ui.waitForTimeout(1200);
  const opened = { header: await header(), effects: [...effects] };
  await ui.screenshot({ path: `${out}/1-reopened-${status}.png` });
  assert.ok(effects.includes('ensure'), 'the released browser was not reopened');

  // 2. Click the 「iPhone」 link on the screen once: control is taken by itself and that same
  // click lands (the page is still: no frame comes by itself after the takeover).
  await clickOnScreen('#iphone');
  await page!.waitForURL(/\/iphone$/, { timeout: 8000 }).catch(() => {});
  assert.ok(page!.url().endsWith('/iphone'), `the link click did not land: ${page!.url()}`);
  await ui.waitForTimeout(800);
  const afterClick = { header: await header(), url: page!.url() };
  await ui.screenshot({ path: `${out}/2-link-clicked-${status}.png` });
  const session = browserControlSessions.get(instance!, 'usr_fixture', taskId);
  assert.equal(session?.control.snapshot().phase, 'human', 'the user does not hold control');

  // 3. Type into the search box on the screen.
  await page!.waitForSelector('#q');
  await ui.waitForTimeout(800);
  await clickOnScreen('#q');
  await ui.waitForTimeout(500);
  await ui.keyboard.type('holaday', { delay: 40 });
  await page!.waitForFunction(
    () => (document.querySelector('#q') as HTMLInputElement).value === 'holaday',
    undefined,
    { timeout: 8000 },
  );
  await ui.waitForTimeout(600);
  const typed = {
    header: await header(),
    value: await page!.$eval('#q', (el) => (el as HTMLInputElement).value),
  };
  await ui.screenshot({ path: `${out}/3-typed-${status}.png` });
  assert.deepEqual(errors, []);
  const result = { status, ok: true, opened, afterClick, typed, effects, errors };
  await writeFile(`${out}/result-${status}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(String(error));
  await ui.screenshot({ path: `${out}/failure-${status}.png` }).catch(() => {});
  await writeFile(
    `${out}/result-${status}.json`,
    JSON.stringify(
      { status, ok: false, error: String(error), header: await header().catch(() => ''), effects },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  if (instance) browserControlSessions.get(instance, 'usr_fixture', taskId)?.control.close();
  await ui.close();
  if (vite.pid) process.kill(-vite.pid, 'SIGTERM');
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
