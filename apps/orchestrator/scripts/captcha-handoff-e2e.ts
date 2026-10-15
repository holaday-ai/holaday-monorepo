/** Local-only end-to-end test. Never uses credentials, DB, models or production. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import express from 'express';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { z } from 'zod';
import { runUnifiedSupercarTask } from '../src/agent/browser-tools/unified-supercar-runner.js';
import type { RunSupercarOptions } from '../src/agent/supercar/agent-loop.js';
import { browserControlSessions } from '../src/agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../src/browser-pool/types.js';
import { authorizeCaptchaViewportInput } from '../src/streaming/captcha-viewport-action.js';
import { createScreencastProxy } from '../src/streaming/screencast-proxy.js';
import {
  browserCaptchaProcedure,
  browserControlProcedure,
  browserControlStateProcedure,
} from '../src/trpc/routers/browser-control.js';
import { publicProcedure, router } from '../src/trpc/trpc.js';
const out = process.env.CAPTCHA_E2E_OUTPUT;
if (!out) throw Error('CAPTCHA_E2E_OUTPUT required');
await mkdir(out, { recursive: true });
const logger = pino({ level: 'silent' });
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
      body: `<style>body{font:24px sans-serif;margin:30px}button{position:absolute;left:40px;top:220px;width:300px;height:70px;font:24px sans-serif}</style><h1>Verify you are human</h1><div class="g-recaptcha"></div><p>Local fixed wall: only the human button can clear it.</p><button onclick="document.body.innerHTML='<h1>Public result</h1><p>Verified fixture content</p>';history.replaceState({},'', '/search?q=fixture')">Complete fixture</button>`,
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
const ui = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await ui.route('**/*', (route) =>
  new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
);
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4319/e2e/captcha-handoff.html')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  run = runUnifiedSupercarTask({
    taskId,
    userExternalId: 'usr_fixture',
    intent: '打开网页读取内容',
    executor: instance.executor,
    browserControlFactory: () => browserControlSessions.start(instance),
    browserCapabilities: capabilities,
    timeoutMs: 30000,
    captchaWaitMs: 600000,
    captchaPollMs: 200,
    onAwaitingUser: async () => {
      waiting = true;
      status = 'awaiting_user';
    },
    onCaptchaHandoffEnd: async (resumed) => {
      waiting = false;
      status = resumed ? 'executing' : 'failed';
      return true;
    },
    messagesAdapter: {
      metadata: { provider: 'anthropic', model: 'local-fixture' },
      async create() {
        const name = calls.length === 0 ? 'navigate' : calls.length === 1 ? 'read_page' : 'finish';
        calls.push(name);
        return {
          id: String(calls.length),
          metadata: this.metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: String(calls.length),
              name,
              input:
                name === 'navigate'
                  ? {
                      url: demo
                        ? 'https://www.google.com/recaptcha/api2/demo'
                        : 'https://www.google.com/sorry/index',
                    }
                  : name === 'finish'
                    ? {
                        status: 'completed',
                        summary: 'Verified fixture content',
                        evidence: 'Verified fixture content',
                      }
                    : {},
            },
          ],
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    },
  } as RunSupercarOptions).then((result) => {
    status = result.status;
    return result;
  });
  ui.on('websocket', (socket) => {
    socket.on('framesent', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        console.log(
          JSON.stringify({ sent: m.type, payloadType: m.payload?.type, lease: !!m.controlLease }),
        );
      } catch {}
    });
    socket.on('framereceived', (e) => {
      try {
        const m = JSON.parse(String(e.payload));
        if (!['frame', 'url-changed'].includes(m.type))
          console.log(JSON.stringify({ received: m.type, error: m.error, reason: m.reason }));
      } catch {}
    });
  });
  await ui.goto('http://127.0.0.1:4319/e2e/captcha-handoff.html');
  const errors: string[] = [];
  ui.on('pageerror', (e) => errors.push(e.message));
  await ui
    .getByText('只有你可以操作验证；AI 已暂停。完成后自动继续，最多等待 10 分钟。', { exact: true })
    .waitFor({ timeout: 30000 });
  await ui.waitForFunction(() => document.querySelector('canvas')?.width);
  await ui.waitForSelector('canvas[data-frame-id]');
  await ui.screenshot({ path: `${out}/${demo ? 'official-demo' : 'local-wall'}-desktop.png` });
  await ui.getByRole('button', { name: '我已完成，继续', exact: true }).click();
  await ui.getByText('验证仍未完成，请在浏览器里完成后再继续。', { exact: true }).waitFor();
  const before = calls.length;
  await ui.waitForTimeout(1500);
  assert.equal(calls.length, before);
  if (demo) {
    await writeFile(
      `${out}/official-demo.json`,
      JSON.stringify(
        {
          url: page.url(),
          panelShown: true,
          continueBlocked: true,
          aiActionsDuringWait: 0,
          manualStep:
            'BOSS must complete the real CAPTCHA; no automated CAPTCHA interaction performed.',
          errors,
        },
        null,
        2,
      ),
    );
  } else {
    // Test user clicks only the rendered frontend canvas. Never dispatch to the executor.
    const canvas = ui.locator('canvas');
    const box = await canvas.boundingBox();
    assert.ok(box);
    const size = await canvas.evaluate((el: HTMLCanvasElement) => ({
      width: el.width,
      height: el.height,
    }));
    console.log(JSON.stringify({ canvas: box, size }));
    for (let attempt = 0; attempt < 3 && calls.length === before; attempt++) {
      await ui.mouse.click(
        box.x + (190 / size.width) * box.width,
        box.y + (255 / size.height) * box.height,
      );
      await ui.waitForTimeout(700);
    }
    const result = (await Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('frontend input did not clear wall')), 15000),
      ),
    ])) as { status: string };
    assert.equal(result.status, 'completed');
    assert.deepEqual(calls, ['navigate', 'read_page', 'finish']);
    assert.deepEqual(errors, []);
    await ui.screenshot({ path: `${out}/local-resumed-desktop.png` });
    await writeFile(
      `${out}/local-e2e.json`,
      JSON.stringify(
        { status: result.status, calls, aiActionsDuringWait: 0, frontendOnlyInput: true, errors },
        null,
        2,
      ),
    );
  }
  // Narrow-screen visibility is captured while a real human handoff is active in demo mode.
  if (demo) {
    await ui.setViewportSize({ width: 390, height: 844 });
    await ui.getByRole('button', { name: '全屏浏览器模式', exact: true }).click();
    await ui.getByRole('button', { name: '退出全屏', exact: true }).first().waitFor();
    await ui.getByTitle('放大画面').click();
    assert.equal(
      await ui.getByRole('button', { name: '我已完成，继续', exact: true }).isVisible(),
      true,
    );
    await ui.screenshot({ path: `${out}/official-demo-mobile.png` });
  }
  console.log(JSON.stringify({ demo, status, calls, errors }));
  if (demo && process.argv.includes('--manual')) {
    console.log(
      'BOSS manual verification: http://127.0.0.1:4319/e2e/captcha-handoff.html (10 minute limit)',
    );
    await run;
  }
} catch (error) {
  console.error(error);
  await ui.screenshot({ path: `${out}/e2e-failure.png` }).catch(() => {});
  throw error;
} finally {
  browserControlSessions.get(instance, 'usr_fixture', taskId)?.control.close();
  await run?.catch(() => {});
  await ui.close();
  if (vite.pid) process.kill(-vite.pid, 'SIGTERM');
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
