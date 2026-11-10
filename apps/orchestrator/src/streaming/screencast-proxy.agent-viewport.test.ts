import { once } from 'node:events';
import { createServer } from 'node:http';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

/**
 * FIX-61 复审 #1 #1 (real Chromium, real proxy): the viewport message needs no lease, so a
 * person who only watches — say on a phone — must not resize the assistant's page. Only the
 * lease holder's screen aligns it, and handback puts the task's own 1280x800 back before the
 * assistant observes again.
 */
it('watching never resizes the agent page; takeover aligns it; handback restores 1280x800', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<p>fixture</p>');
  // Every resize of the agent page from outside the assistant is recorded.
  const agentResize = page.setViewportSize.bind(page);
  const resizes: Array<{ width: number; height: number }> = [];
  page.setViewportSize = async (size) => {
    resizes.push(size);
    await agentResize(size);
  };
  const instance = {
    taskId: 'tsk_agent_viewport',
    userId: 'usr_agent_viewport',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const server = createServer();
  const proxy = createScreencastProxy({
    pool: { peek: () => instance, touch: () => {} } as unknown as BrowserPool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => instance.userId,
    beforeViewportAction: async () => {
      throw new Error('not used');
    },
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const ws = new WebSocket(
    `ws://127.0.0.1:${addr.port}/screencast-ws/${instance.taskId}?token=fixture&viewportV2=1`,
  );
  let applied = 0;
  let frames = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'viewport-applied') applied++;
    if (m.type === 'frame') frames++;
  });
  const layout = () => page.evaluate(() => [window.innerWidth, window.innerHeight]);
  let parked: Promise<unknown> | null = null;
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(frames).toBeGreaterThan(0), { timeout: 5000 });
    // A phone watching the running task.
    ws.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 },
      }),
    );
    await new Promise((r) => setTimeout(r, 200));
    // The assistant reaches its next action boundary: the queued resize is applied there.
    await binding.control.checkpoint(async () => undefined);
    await vi.waitFor(() => expect(applied).toBeGreaterThan(0), { timeout: 5000 });
    expect(resizes).toEqual([]);
    expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });

    // The assistant's own emulation decides the layout again (as on the cloud browser after
    // a task: frames requested at one size, the page laid out at 1280x800).
    await agentResize({ width: 1281, height: 800 });
    await agentResize({ width: 1280, height: 800 });
    // Settles within a frame or two; read at once it raced the stream on a busy machine.
    await vi.waitFor(async () => expect(await layout()).toEqual([1280, 800]), { timeout: 3000 });
    const appliedBefore = applied;

    // The user takes control: their screen size is applied again right away, so the page
    // they are about to press lays out like the frames they see.
    binding.control.requestHuman();
    const observed: unknown[] = [];
    parked = binding.control.checkpoint(async () => {
      observed.push(page.viewportSize());
    });
    const lease = binding.control.snapshot().lease;
    expect(lease).toBeTruthy();
    await vi.waitFor(() => expect(applied).toBeGreaterThan(appliedBefore), { timeout: 5000 });
    expect(await layout()).toEqual([390, 760]);

    // Handback: the assistant observes with its own 1280x800 page.
    binding.control.returnToAgent(lease!);
    await parked;
    parked = null;
    expect(observed).toEqual([{ width: 1280, height: 800 }]);
    // Chromium followed our override here, so nothing needed aligning; the align/restore
    // path for a page that keeps its own layout is covered in cdp-input.test.ts.
    expect(resizes).toEqual([]);
  } finally {
    ws.close();
    await once(ws, 'close');
    binding.control.close();
    await parked;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 20000);

/**
 * DEPLOY-61 第 0 步 #2: the screen re-sends its size itself once it has the lease. The server's
 * lease watch applied it a second time, opening a second 「尺寸待定」 window right where the click
 * that asked for control is delivered (refused as stale: the first click only took over). Now
 * the watch steps in only when no viewport with the new lease arrived within a second.
 */
it('a screen that re-sends its size with the new lease is applied once, not twice', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<p>fixture</p>');
  const instance = {
    taskId: 'tsk_lease_viewport_once',
    userId: 'usr_lease_viewport_once',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const server = createServer();
  const proxy = createScreencastProxy({
    pool: { peek: () => instance, touch: () => {} } as unknown as BrowserPool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => instance.userId,
    beforeViewportAction: async () => {
      throw new Error('not used');
    },
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const ws = new WebSocket(
    `ws://127.0.0.1:${addr.port}/screencast-ws/${instance.taskId}?token=fixture&viewportV2=1`,
  );
  let applied = 0;
  let frames = 0;
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'viewport-applied') applied++;
    if (m.type === 'frame') frames++;
  });
  const viewport = (controlLease?: string) =>
    ws.send(
      JSON.stringify({
        type: 'input',
        ...(controlLease ? { controlLease } : {}),
        payload: { type: 'viewport', width: 1280, height: 805, deviceScaleFactor: 1 },
      }),
    );
  let parked: Promise<unknown> | null = null;
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(frames).toBeGreaterThan(0), { timeout: 5000 });
    viewport();
    await new Promise((r) => setTimeout(r, 200));
    // The assistant reaches its next action boundary: the queued resize is applied there.
    await binding.control.checkpoint(async () => undefined);
    await vi.waitFor(() => expect(applied).toBe(1), { timeout: 5000 });

    // Takeover; the screen learns its lease and re-sends its size right away (as the workbench
    // does) — applied once, and nothing more from the watch.
    binding.control.requestHuman();
    parked = binding.control.checkpoint(async () => undefined);
    const lease = binding.control.snapshot().lease;
    expect(lease).toBeTruthy();
    viewport(lease!);
    await vi.waitFor(() => expect(applied).toBe(2), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1_800));
    expect(applied).toBe(2);

    // A screen that does not re-send still gets its size applied by the watch, a bit later.
    binding.control.returnToAgent(lease!);
    await parked;
    binding.control.requestHuman();
    parked = binding.control.checkpoint(async () => undefined);
    expect(binding.control.snapshot().lease).toBeTruthy();
    await vi.waitFor(() => expect(applied).toBe(3), { timeout: 5000 });
  } finally {
    ws.close();
    await once(ws, 'close');
    binding.control.close();
    await parked;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 30000);
