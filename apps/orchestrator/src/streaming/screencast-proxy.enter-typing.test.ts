import { once } from 'node:events';
import { createServer } from 'node:http';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

// DEPLOY-61 第 0 步 #1 (safety): a change inside the page — focus jumping to 「确认支付」 — does
// not bump the viewport revision. A user still looking at the older frame must not fire that
// button with Enter or Space; ordinary letters on an older frame of the same page still land.
/**
 * FIX-61B P1-5 (Deploy-61 online: the first Enter after typing 「holaday」 into Google was dropped
 * without a word). On an animating page (caret, suggestion list) the frame the person sees is
 * superseded within 250ms; an Enter on it goes through when the focus is still the element they
 * typed into — and only then (the 「确认支付」 test above keeps refusing).
 */
it('real proxy: Enter after typing reaches the same box on a superseded frame', async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(
    '<form id="f"><input id="q" style="position:absolute;left:40px;top:40px"></form><div id="tick"></div>',
  );
  await page.evaluate(() => {
    const w = window as unknown as { hits: number };
    w.hits = 0;
    document.getElementById('f')?.addEventListener('submit', (e) => {
      e.preventDefault();
      w.hits++;
    });
    // An animating page: a new frame every few dozen milliseconds, same tab and revision.
    let n = 0;
    setInterval(() => {
      const t = document.getElementById('tick');
      if (t) t.textContent = String(++n);
    }, 40);
    document.getElementById('q')?.focus();
  });
  const instance = {
    taskId: 'tsk_enter_typing',
    userId: 'usr_keys',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  let frame: BrowserFrameGeometry | undefined;
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
        actionDigest: 'key',
      },
      decision: { kind: 'allow', sensitive: false },
    }),
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as { port: number };
  const ws = new WebSocket(
    `ws://127.0.0.1:${addr.port}/screencast-ws/tsk_enter_typing?token=fixture&viewportV2=1`,
  );
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.geometry) frame = m.geometry;
  });
  const key = (type: 'keyDown' | 'keyUp', k: string, code: string, keyCode: number, ref = frame) =>
    ws.send(
      JSON.stringify({
        type: 'input',
        observation: ref,
        payload: { type, key: k, code, keyCode },
      }),
    );
  // The frame the user is looking at, once a newer one of the same page has superseded it by
  // more than the 250ms transit grace (a late paint on a busy screen).
  const staleFrame = async () => {
    await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
    const old = frame as BrowserFrameGeometry;
    await vi.waitFor(() => expect(frame?.frameId).not.toBe(old.frameId), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    expect(frame?.viewportRevision).toBe(old.viewportRevision);
    return old;
  };
  const hits = () => page.evaluate(() => (window as unknown as { hits: number }).hits);
  try {
    await once(ws, 'open');
    // The person types 「holaday」 into the box, then presses Enter on the frame they see — one a
    // newer frame of the same page superseded by more than 250ms.
    await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
    for (const ch of 'holaday') {
      key('keyDown', ch, `Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0));
      key('keyUp', ch, `Key${ch.toUpperCase()}`, ch.toUpperCase().charCodeAt(0));
    }
    await vi.waitFor(async () => expect(await page.locator('#q').inputValue()).toBe('holaday'), {
      timeout: 5000,
    });
    const old = await staleFrame();
    key('keyDown', 'Enter', 'Enter', 13, old);
    key('keyUp', 'Enter', 'Enter', 13, old);
    await vi.waitFor(async () => expect(await hits()).toBe(1), { timeout: 5000 });
  } finally {
    ws.close();
    await once(ws, 'close');
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 30000);
