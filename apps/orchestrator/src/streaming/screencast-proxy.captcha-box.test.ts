import { once } from 'node:events';
import { createServer } from 'node:http';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

it('CAPTCHA-UX-1 第 2 条: while a verification is waited for, the screen is told where the visible captcha box is — the open challenge first — and that it is gone afterwards', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('https://www.google.com/recaptcha/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<body>box</body>' }),
  );
  await page.setContent(`
    <iframe id="anchor" src="https://www.google.com/recaptcha/api2/anchor?k=f" style="position:absolute;left:40px;top:300px;width:304px;height:78px;border:0"></iframe>
    <div id="wrap" style="visibility:hidden"><iframe id="bframe" src="https://www.google.com/recaptcha/api2/bframe?k=f" style="position:absolute;left:200px;top:100px;width:400px;height:580px;border:0"></iframe></div>
    <iframe src="https://example.com/ad" style="position:absolute;left:700px;top:0;width:500px;height:500px;border:0"></iframe>`);
  const instance = {
    taskId: 'tsk_box',
    userId: 'usr_box',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const server = createServer();
  const proxy = createScreencastProxy({
    pool: { peek: () => instance, touch: () => {} } as unknown as BrowserPool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => instance.userId,
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const ws = new WebSocket(
    `ws://127.0.0.1:${addr.port}/screencast-ws/tsk_box?token=fixture&viewportV2=1`,
  );
  const boxes: unknown[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'captcha-box') boxes.push(m.rect);
  });
  const stop = new AbortController();
  let wall = true;
  try {
    await once(ws, 'open');
    await new Promise((r) => setTimeout(r, 1000));
    expect(boxes).toEqual([]); // no verification waited for: nothing is said
    const waited = captchaHandoffs.wait({
      taskId: instance.taskId,
      userId: instance.userId,
      control: binding.control,
      hasWall: async () => wall,
      onWaiting: async () => {},
      onResumed: async () => true,
      signal: stop.signal,
      pollMs: 100,
    });
    // The checkbox (the challenge is hidden, the ad frame is not a captcha).
    await vi.waitFor(
      () => expect(boxes.at(-1)).toEqual({ x: 40, y: 300, width: 304, height: 78 }),
      {
        timeout: 3000,
      },
    );
    // The image grid opens: the box follows it.
    await page.evaluate(() => {
      document.getElementById('wrap')!.style.visibility = 'visible';
    });
    await vi.waitFor(
      () => expect(boxes.at(-1)).toEqual({ x: 200, y: 100, width: 400, height: 580 }),
      { timeout: 3000 },
    );
    // Passed: the wall is gone and the wait ends — the box is gone with it.
    wall = false;
    await waited;
    await vi.waitFor(() => expect(boxes.at(-1)).toBeNull(), { timeout: 3000 });
  } finally {
    stop.abort();
    ws.close();
    await once(ws, 'close');
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 20000);
