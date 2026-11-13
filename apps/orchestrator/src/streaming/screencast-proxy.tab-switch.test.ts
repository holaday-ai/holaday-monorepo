import { once } from 'node:events';
import { createServer } from 'node:http';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import { type Page, chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

/**
 * FIX-61B P0-3, REBUILD-4: the person presses the screen of a running task while the assistant has
 * just opened the next book in a new tab. The press was aimed at the page the assistant left: it is
 * dropped (never landing on the new tab), the stream follows the assistant's page, and the control
 * stays open — the task is not hurt. A press on the new tab's frame then lands there. A viewer's
 * size message never resizes either page.
 */
it('input aimed at a tab the assistant left is dropped, the stream follows, the run is not hurt', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const button = (text: string) =>
    `<button id="b" style="position:absolute;left:0;top:0;width:400px;height:300px">${text}</button><script>window.hits=0;document.getElementById("b").addEventListener("click",()=>window.hits++)</script>`;
  const first = await context.newPage();
  await first.setContent(button('book 1'));
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
    beforeViewportAction: async (_i, envelope) => ({
      request: {
        taskId: instance.taskId,
        runId: 'run',
        actor: 'human',
        lane: 'cdp',
        tabId: envelope.observation?.tabId ?? '',
        origin: 'https://fixture.example',
        observationRevision: envelope.observation?.viewportRevision ?? 0,
        actionDigest: 'click',
        lease: '',
      },
      decision: { kind: 'allow', sensitive: false },
    }),
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const ws = new WebSocket(
    `ws://127.0.0.1:${addr.port}/screencast-ws/${instance.taskId}?token=fixture&viewportV2=1`,
  );
  let frame: BrowserFrameGeometry | undefined;
  const urls: string[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.geometry) frame = m.geometry;
    if (m.type === 'url-changed') urls.push(m.url);
  });
  const layout = (page: Page) => page.evaluate(() => [window.innerWidth, window.innerHeight]);
  const hits = (page: Page) => page.evaluate(() => (window as unknown as { hits: number }).hits);
  const click = (ref: BrowserFrameGeometry | undefined) => {
    for (const type of ['mouseDown', 'mouseUp'] as const)
      ws.send(
        JSON.stringify({
          type: 'input',
          observation: ref,
          payload: { type, x: 50, y: 50, button: 'left', clickCount: 1 },
        }),
      );
  };
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
    const firstFrame = frame as BrowserFrameGeometry;

    // A phone's size message changes nothing.
    ws.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 },
      }),
    );

    // The assistant opens the next book in a new tab; the person presses the old frame.
    const second = await context.newPage();
    await second.setContent(button('book 2'));
    current = second;
    urls.length = 0;
    click(firstFrame);
    // The stream follows the assistant's page: frames now come from the new tab.
    await vi.waitFor(() => expect(frame?.tabId).not.toBe(firstFrame.tabId), { timeout: 8000 });
    expect(await hits(second)).toBe(0);
    expect(await hits(first)).toBe(0);
    expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });

    // A press on the frame now shown lands on the new tab.
    click(frame);
    await vi.waitFor(async () => expect(await hits(second)).toBe(1), { timeout: 5000 });
    expect(await hits(first)).toBe(0);
    expect(binding.control.humanInputLog().count).toBeGreaterThan(0);
    expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    // No page was resized for the viewer.
    expect(await layout(first)).toEqual([1280, 800]);
    expect(await layout(second)).toEqual([1280, 800]);
  } finally {
    ws.close();
    await once(ws, 'close');
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 30000);
