import { once } from 'node:events';
import { createServer } from 'node:http';
import { pino } from 'pino';
import { type Page, chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

/**
 * FIX-61B P0-3 (Deploy-61 online, 14:36:06 `browser_tab_changed` → control closed → task failed):
 * the user pressed a running task's screen; the screen re-sent its size with the lease and that
 * size waited for the assistant's next boundary. Meanwhile the assistant opened the next book in
 * a new tab. The queued size met a page the stream was no longer bound to, failed, and the
 * FIX-29 rule closed control: the task failed. Now the size is dropped, the stream follows the
 * assistant's page, the size is applied there, and the takeover goes on.
 */
it('a takeover whose queued size meets a new tab still takes over; only watching never fails', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const first = await context.newPage();
  await first.setContent('<p>book 1</p>');
  let current: Page = first;
  const instance = {
    taskId: 'tsk_tab_switch',
    userId: 'usr_tab_switch',
    status: 'ready',
    executor: { getPage: async () => current },
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
  let frames = 0;
  const urls: string[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.type === 'frame') frames++;
    if (m.type === 'url-changed') urls.push(m.url);
  });
  const layout = (page: Page) => page.evaluate(() => [window.innerWidth, window.innerHeight]);
  const openTab = async (text: string) => {
    const page = await context.newPage();
    await page.setContent(`<p>${text}</p>`);
    current = page;
    return page;
  };
  let parked: Promise<unknown> | null = null;
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(frames).toBeGreaterThan(0), { timeout: 5000 });

    // 1. Someone only watching (a phone): their size waits for the boundary, the assistant opens
    //    the next book in a new tab first. The run is not hurt.
    ws.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 },
      }),
    );
    await new Promise((r) => setTimeout(r, 150));
    const second = await openTab('book 2');
    await binding.control.checkpoint(async () => undefined);
    expect(binding.control.snapshot()).toMatchObject({ phase: 'agent', error: null });
    expect(await layout(second)).toEqual([1280, 800]);

    // 2. The user presses the screen: control is asked for and granted at the boundary; the
    //    assistant had already opened book 3 in a new tab; then the screen re-sends its size
    //    with the lease (as the workbench does).
    binding.control.requestHuman();
    const third = await openTab('book 3');
    parked = binding.control.checkpoint(async () => undefined);
    const lease = binding.control.snapshot().lease;
    expect(lease).toBeTruthy();
    ws.send(
      JSON.stringify({
        type: 'input',
        controlLease: lease,
        payload: { type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 },
      }),
    );
    // Takeover holds (no viewport_failed); the stream follows the new tab and the size lands there.
    await vi.waitFor(async () => expect(await layout(third)).toEqual([390, 760]), {
      timeout: 8000,
    });
    expect(binding.control.snapshot()).toMatchObject({ phase: 'human', error: null });
    expect(urls.length).toBeGreaterThan(0);

    // Handback: the assistant goes on, on its own 1280x800.
    binding.control.returnToAgent(lease!);
    await parked;
    parked = null;
    expect(binding.control.snapshot().error).toBeNull();
    await vi.waitFor(async () => expect(await layout(third)).toEqual([1280, 800]), {
      timeout: 3000,
    });
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
