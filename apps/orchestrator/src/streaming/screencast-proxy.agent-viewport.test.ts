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
    // The phone, now holding control, re-sends its size with the lease (as the workbench does).
    ws.send(
      JSON.stringify({
        type: 'input',
        controlLease: lease,
        payload: { type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 },
      }),
    );
    await vi.waitFor(() => expect(applied).toBeGreaterThan(appliedBefore), { timeout: 5000 });
    await vi.waitFor(async () => expect(await layout()).toEqual([390, 760]), { timeout: 3000 });

    // Handback: the assistant observes with its own 1280x800 page.
    binding.control.returnToAgent(lease!);
    await parked;
    parked = null;
    expect(observed).toEqual([{ width: 1280, height: 800 }]);
    // DEPLOY-61 P0-1: handback clears our device-metrics override and puts the assistant's own
    // size back (the only resize from outside the assistant); nothing resized it before.
    expect(resizes).toEqual([{ width: 1280, height: 800 }]);
    expect(await layout()).toEqual([1280, 800]);
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
it('a screen that re-sends its size with the new lease is applied once; without the lease nothing changes', async () => {
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

    // DEPLOY-61 P0-1: a screen whose size did not come with the new lease changes nothing.
    binding.control.returnToAgent(lease!);
    await parked;
    const own = await page.evaluate(() => [innerWidth, innerHeight]);
    binding.control.requestHuman();
    parked = binding.control.checkpoint(async () => undefined);
    expect(binding.control.snapshot().lease).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1_500));
    expect(applied).toBe(2);
    expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual(own);
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

/**
 * FIX-61 DEPLOY-61 P0-1 (real Chromium, real proxy): DEPLOY-61 专项 3 — a phone only watching a
 * running task laid the assistant's page out at 380x480 through the screen's
 * `Emulation.setDeviceMetricsOverride`, and the assistant stopped. Read the page's REAL layout
 * (`innerWidth` / `innerHeight` / `devicePixelRatio` inside the page), not Playwright's record.
 */
it('the page keeps its real layout while a phone or desktop only watches; takeover aligns; handback clears the override', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent('<p>fixture</p>');
  const instance = {
    taskId: 'tsk_real_layout',
    userId: 'usr_real_layout',
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
  const open = () =>
    new WebSocket(
      `ws://127.0.0.1:${addr.port}/screencast-ws/${instance.taskId}?token=fixture&viewportV2=1`,
    );
  const real = () =>
    page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  const initial = await real();
  let applied = 0;
  let frames = 0;
  const watch = (ws: WebSocket) =>
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'viewport-applied') applied++;
      if (m.type === 'frame') frames++;
    });
  const viewport = (
    ws: WebSocket,
    size: { width: number; height: number; deviceScaleFactor: number },
    controlLease?: string,
  ) =>
    ws.send(
      JSON.stringify({
        type: 'input',
        ...(controlLease ? { controlLease } : {}),
        payload: { type: 'viewport', ...size },
      }),
    );
  const phone = open();
  const desktop = open();
  watch(phone);
  watch(desktop);
  let parked: Promise<unknown> | null = null;
  try {
    await Promise.all([once(phone, 'open'), once(desktop, 'open')]);
    await vi.waitFor(() => expect(frames).toBeGreaterThan(0), { timeout: 5000 });
    // 1. A phone and a desktop panel only watch the running task.
    // (One queued size per runner: each watcher's is processed at its own action boundary.)
    for (const [ws, size] of [
      [phone, { width: 380, height: 480, deviceScaleFactor: 2 }],
      [desktop, { width: 1280, height: 1807, deviceScaleFactor: 1 }],
    ] as const) {
      const before = applied;
      viewport(ws, size);
      await new Promise((r) => setTimeout(r, 200));
      await binding.control.checkpoint(async () => undefined);
      await vi.waitFor(() => expect(applied).toBeGreaterThan(before), { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 300));
      expect(await real()).toEqual(initial);
    }

    // 2. The phone takes control: its size is applied to the real layout.
    binding.control.requestHuman();
    // 3. …and at handback, before the assistant observes, the page is its own again.
    const observedAtHandback: unknown[] = [];
    parked = binding.control.checkpoint(async () => {
      observedAtHandback.push(await real());
    });
    const lease = binding.control.snapshot().lease;
    expect(lease).toBeTruthy();
    viewport(phone, { width: 380, height: 480, deviceScaleFactor: 2 }, lease!);
    await vi.waitFor(async () => expect((await real()).w).toBe(380), { timeout: 5000 });
    expect(await real()).toEqual({ w: 380, h: 480, dpr: 2 });

    binding.control.returnToAgent(lease!);
    await parked;
    parked = null;
    expect(observedAtHandback).toEqual([initial]);
    expect(await real()).toEqual(initial);
  } finally {
    phone.close();
    desktop.close();
    await Promise.all([once(phone, 'close'), once(desktop, 'close')]);
    binding.control.close();
    await parked;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 30000);
