/** Local-only end-to-end test. Never uses credentials, DB, models or production. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { z } from 'zod';
import { browserControlSessions } from '../src/agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../src/agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../src/browser-pool/types.js';
import { authorizeCaptchaViewportInput } from '../src/streaming/captcha-viewport-action.js';
import { createScreencastProxy } from '../src/streaming/screencast-proxy.js';
import {
  browserCaptchaProcedure,
  browserControlProcedure,
  browserControlStateProcedure,
  browserNavProcedure,
} from '../src/trpc/routers/browser-control.js';
import { publicProcedure, router } from '../src/trpc/trpc.js';
const out = process.env.CAPTCHA_E2E_OUTPUT;
if (!out) throw Error('CAPTCHA_E2E_OUTPUT required');
await mkdir(out, { recursive: true });
const logger = pino({ level: process.env.LIVE_TRACE ? 'debug' : 'silent' });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const taskId = 'tsk_captcha_e2e';
const calls: string[] = [];
let waiting = false;
let status = 'executing';
let run: Promise<unknown> | undefined;
const demo = process.argv.includes('--demo');
if (!demo)
  await page.route('https://www.google.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><style>body{font:18px system-ui;margin:20px}button,input{font:20px system-ui;margin:10px 0;display:block;max-width:90%}button{padding:12px}p{line-height:1.5}</style><h1>Public input fixture</h1><div class="g-recaptcha"></div><button id="hit">Click target</button><input id="text" aria-label="Public sample text"><input type="range" id="slider" aria-label="Public range" value="0"><a href="https://www.google.com/second">Next page</a><output id="count">0</output>${'<p>Readable long article — scroll text at native CSS size.</p>'.repeat(80)}<script>window.events=[];for(const type of ['mousedown','mouseup','input','wheel','mousemove'])document.addEventListener(type,e=>{events.push({type,at:Date.now(),x:e.clientX,y:e.clientY,target:e.target.id,value:e.target.value});if(type==='mouseup'&&e.target.id==='hit')document.querySelector('#count').textContent=Number(document.querySelector('#count').textContent)+1;},{passive:true});</script>`,
    }),
  );
const capabilities = { viewportV2: true, observationV2: true, replayV1: false, routingV2: false };
const instance = {
  taskId,
  userId: 'usr_fixture',
  index: 0,
  status: 'ready',
  capabilities,
  executor: { getPage: async () => page },
  createdAt: Date.now(),
  lastActiveAt: Date.now(),
} as unknown as BrowserInstance;
const pool = {
  touch: () => {},
  peek: (id: string) => (id === taskId ? instance : null),
  peekActiveForUser: (id: string) => (id === 'usr_fixture' ? instance : null),
};
const row = { status: 'executing', userExternalId: 'usr_fixture', userId: 1 };
const query = {
  from: () => query,
  innerJoin: () => query,
  where: () => query,
  limit: async () => [{ ...row, status }],
};
const appRouter = router({
  tasks: router({
    browserControlState: browserControlStateProcedure,
    browserControl: browserControlProcedure,
    browserNav: browserNavProcedure,
    browserCaptcha: browserCaptchaProcedure,
    checkpointBrowserSession: publicProcedure.input(z.any()).mutation(() => ({ ok: true })),
  }),
  browserReplay: router({
    capabilities: publicProcedure.input(z.any().optional()).query(() => capabilities),
  }),
});
const app = express();
app.post('/stream-token', (_req, res) => res.json({ token: 'local-fixture-only' }));
app.get('/fixture/state', (_req, res) => res.json({ status, waiting, calls: calls.length }));
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
  beforeViewportAction: authorizeCaptchaViewportInput,
});
server.on('upgrade', (req, socket, head) => proxy.handleUpgrade(req, socket, head));
await new Promise<void>((resolve) => server.listen(4318, '127.0.0.1', resolve));
const vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1'], {
  cwd: fileURLToPath(new URL('../../web-workbench', import.meta.url)),
  env: {
    ...process.env,
    HOLADAY_WEB_PORT: '4319',
    HOLADAY_API_PROXY_TARGET: 'http://127.0.0.1:4318',
    HOLADAY_BROWSER_WS_PROXY_TARGET: 'ws://127.0.0.1:4318',
  },
  stdio: 'ignore',
  detached: true,
});

const binding = browserControlSessions.start(instance);
await page.goto(
  demo ? 'https://www.google.com/recaptcha/api2/demo' : 'https://www.google.com/sorry/index',
);
run = captchaHandoffs.wait({
  taskId,
  userId: 'usr_fixture',
  control: binding.control,
  hasWall: async () => true,
  onWaiting: async () => {
    waiting = true;
    status = 'awaiting_user';
  },
  onResumed: async () => true,
});
const results: unknown[] = [];
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4319/e2e/captcha-handoff.html')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (demo) {
    console.log('READY http://127.0.0.1:4319/e2e/captcha-handoff.html');
    await run;
  } else {
    for (const [width, height] of [
      [390, 844],
      [800, 900],
      [1440, 1000],
    ])
      for (const dpr of [1, 2]) {
        if (process.env.LIVE_DPR && dpr !== Number(process.env.LIVE_DPR)) continue;
        if (process.env.LIVE_WIDTH && width !== Number(process.env.LIVE_WIDTH)) continue;
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: dpr,
        });
        const ui = await context.newPage();
        const errors: string[] = [];
        ui.on('pageerror', (e) => errors.push(e.message));
        let frame: BrowserFrameGeometry | undefined;
        ui.on('websocket', (s) => {
          s.on('framereceived', (e) => {
            try {
              const m = JSON.parse(String(e.payload));
              if (m.type === 'frame') frame = m.geometry;
            } catch {}
          });
        });
        await ui.goto('http://127.0.0.1:4319/e2e/captcha-handoff.html');
        await ui.waitForSelector('canvas[data-frame-id]', { timeout: 20000 });
        await ui.waitForFunction(() => !document.querySelector('[aria-label="接管浏览器"]'));
        await ui.waitForTimeout(6500); // reproduce first input after old 5s expiry, no retry
        const canvas = ui.locator('canvas');
        const box = await canvas.boundingBox();
        assert.ok(box);
        const metrics = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        }));
        const source = await canvas.evaluate((el: HTMLCanvasElement) => ({
          width: el.width,
          height: el.height,
        }));
        console.log(JSON.stringify({ width, height, dpr, metrics, source, box, frame }));
        assert.equal(metrics.dpr, dpr);
        assert.equal(metrics.width, Math.round(box.width));
        assert.equal(metrics.height, Math.round(box.height));
        assert.equal(source.width, metrics.width * dpr);
        assert.equal(source.height, metrics.height * dpr);
        assert.ok(frame);
        assert.equal(frame.cssWidth, metrics.width);
        assert.equal(frame.cssHeight, metrics.height);
        const at = async (selector: string) => {
          const b = await page.locator(selector).boundingBox();
          assert.ok(b);
          const c = await canvas.boundingBox();
          assert.ok(c);
          return {
            x: c.x + ((b.x + b.width / 2) * c.width) / metrics.width,
            y: c.y + ((b.y + b.height / 2) * c.height) / metrics.height,
          };
        };
        const pos = await at('#hit');
        const started = Date.now();
        await ui.mouse.click(pos.x, pos.y);
        await page.waitForFunction(
          () => Number(document.querySelector('#count')?.textContent) > 0,
          {},
          { timeout: 2000 },
        );
        const event = await page.evaluate(() =>
          (
            window as unknown as { events: Array<{ type: string; target: string; at: number }> }
          ).events
            .filter((e) => e.type === 'mouseup' && e.target === 'hit')
            .at(-1),
        );
        assert.ok(event);
        const latency = event.at - started;
        assert.ok(latency <= 150, `input took ${latency}ms`);
        const latencySamples = [latency];
        for (let i = 1; i < 5; i++) {
          const start = Date.now();
          await ui.mouse.click(pos.x, pos.y);
          await page.waitForFunction(
            (n) => Number(document.querySelector('#count')?.textContent) > n,
            i,
            { timeout: 2000 },
          );
          const event = await page.evaluate(() =>
            (
              window as unknown as { events: Array<{ type: string; target: string; at: number }> }
            ).events
              .filter((e) => e.type === 'mouseup' && e.target === 'hit')
              .at(-1),
          );
          assert.ok(event);
          latencySamples.push(event.at - start);
        }
        assert.ok(Math.max(...latencySamples) <= 150, `input samples: ${latencySamples}`);
        const p = await at('#text');
        await ui.mouse.click(p.x, p.y);
        await ui.keyboard.type('Readable input');
        await page
          .waitForFunction(
            () => (document.querySelector('#text') as HTMLInputElement).value === 'Readable input',
            {},
            { timeout: 2000 },
          )
          .catch(async (error) => {
            console.log(
              JSON.stringify({
                value: await page.locator('#text').inputValue(),
                events: await page.evaluate(
                  () => (window as unknown as { events: unknown[] }).events,
                ),
              }),
            );
            throw error;
          });
        const slider = await page.locator('#slider').boundingBox();
        const c = await canvas.boundingBox();
        assert.ok(slider && c);
        const y = c.y + ((slider.y + slider.height / 2) * c.height) / metrics.height;
        await ui.mouse.move(c.x + ((slider.x + 5) * c.width) / metrics.width, y);
        await ui.mouse.down();
        await ui.mouse.move(c.x + ((slider.x + slider.width - 10) * c.width) / metrics.width, y, {
          steps: 8,
        });
        await ui.mouse.up();
        await page
          .waitForFunction(
            () => Number((document.querySelector('#slider') as HTMLInputElement).value) > 90,
            {},
            { timeout: 2000 },
          )
          .catch(async (error) => {
            console.log(
              JSON.stringify({
                stage: 'drag',
                value: await page.locator('#slider').inputValue(),
                events: await page.evaluate(
                  () => (window as unknown as { events: unknown[] }).events,
                ),
              }),
            );
            throw error;
          });
        const range = await page.locator('#slider').inputValue();
        assert.ok(Number(range) > 90, `drag range=${range}`);
        await ui.mouse.move(pos.x, pos.y);
        await ui.mouse.wheel(0, 600);
        await page.waitForFunction(() => scrollY > 0, {}, { timeout: 2000 });
        const scroll = await page.evaluate(() => scrollY);
        assert.equal(await ui.getByTitle('放大画面').count(), 0);
        assert.equal(await ui.locator('[data-testid="fixture-state"]').count(), 0);
        const address = await ui.getByPlaceholder('尚未打开网页').count();
        const urls = await ui
          .locator('input')
          .evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
        assert.ok(urls.includes(page.url()), JSON.stringify(urls));
        assert.deepEqual(errors, []);
        await ui.screenshot({ path: `${out}/panel-${width}-dpr${dpr}.png` });
        results.push({
          width,
          height,
          dpr,
          metrics,
          source,
          frame,
          latencyMs: latency,
          latencySamples,
          range,
          scroll,
          errors,
          address,
        });
        if (width === 1440 && dpr === 2) {
          const url = ui.locator('input[aria-label^="浏览器地址栏"]');
          await url.fill('https://www.google.com/second');
          await url.press('Enter');
          await page.waitForURL('https://www.google.com/second');
          await ui.waitForFunction(
            () =>
              (document.querySelector('input[aria-label^="浏览器地址栏"]') as HTMLInputElement)
                ?.value === 'https://www.google.com/second',
          );
          await ui.getByRole('button', { name: '后退', exact: true }).click();
          await page.waitForURL('https://www.google.com/sorry/index');
          await ui.getByRole('button', { name: '前进', exact: true }).click();
          await page.waitForURL('https://www.google.com/second');
          const loaded = page.waitForEvent('load');
          await ui.getByRole('button', { name: '刷新', exact: true }).click();
          await loaded;
          await writeFile(
            `${out}/navigation.json`,
            JSON.stringify({
              goto: true,
              back: true,
              forward: true,
              reload: true,
              url: page.url(),
            }),
          );
        }
        await context.close();
        await page.reload();
        await page.evaluate(() => scrollTo(0, 0));
      }
    await writeFile(`${out}/matrix.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ cases: results.length, results }));
  }
} finally {
  binding.control.close();
  await run;
  binding.finish();
  if (vite.pid) process.kill(-vite.pid, 'SIGTERM');
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
