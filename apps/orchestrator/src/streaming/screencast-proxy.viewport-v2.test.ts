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
import { type ScreencastProxyOptions, createScreencastProxy } from './screencast-proxy.js';

it.each([false, true])(
  'real V2 proxy denies writes, including legacy query downgrade (negotiated=%s)',
  async (negotiated) => {
    vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
    const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(
      '<button style="position:absolute;left:100px;top:100px;width:100px;height:60px">搜索</button><input id="text">',
    );
    await page.evaluate(() => {
      (window as unknown as { hits: number }).hits = 0;
      const button = document.querySelector('button');
      if (!button) throw new Error('fixture target missing');
      button.addEventListener('click', () => {
        (window as unknown as { hits: number }).hits++;
      });
    });
    const instance = {
      taskId: 'tsk_v2',
      userId: 'usr_v2',
      status: 'ready',
      executor: { getPage: async () => page },
    } as unknown as BrowserInstance;
    const binding = browserControlSessions.start(instance);
    let policy: ScreencastProxyOptions['beforeViewportAction'];
    let calls = 0;
    const server = createServer();
    const proxy = createScreencastProxy({
      pool: { peek: () => instance, touch: () => {} } as unknown as BrowserPool,
      logger: pino({ level: 'silent' }),
      authenticateToken: async () => instance.userId,
      beforeViewportAction: async (i, envelope, signal) => {
        calls++;
        if (!policy) throw new Error('unavailable');
        return policy(i, envelope, signal);
      },
    });
    server.on('upgrade', proxy.handleUpgrade);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address() as { port: number };
    const ws = new WebSocket(
      `ws://127.0.0.1:${addr.port}/screencast-ws/tsk_v2?token=fixture${negotiated ? '&viewportV2=1' : ''}`,
    );
    let frame: BrowserFrameGeometry | undefined;
    let receivedFrame = false;
    let appliedWidth = 0;
    let viewportReady = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'viewport-applied') appliedWidth = m.width;
      if (m.type === 'viewport-v2-ready') viewportReady = true;
      if (m.geometry) frame = m.geometry;
      if (m.type === 'frame') receivedFrame = true;
    });
    const currentFrame = () => {
      if (!frame) throw new Error('fixture frame missing');
      return frame;
    };
    const send = (type: string, observation = frame) =>
      ws.send(
        JSON.stringify({
          type: 'input',
          observation,
          payload: { type, x: 150, y: 130, text: '不得输入' },
        }),
      );
    try {
      await once(ws, 'open');
      await vi.waitFor(() => expect(receivedFrame).toBe(true), { timeout: 5000 });
      // An authenticated legacy client must not bypass policy by omitting the
      // V2 query parameter and its observation reference.
      for (const type of ['mouseDown', 'mouseUp'])
        ws.send(
          JSON.stringify({
            type: 'input',
            payload: { type, x: 150, y: 130 },
          }),
        );
      await new Promise((r) => setTimeout(r, 120));
      expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(0);
      expect(calls).toBe(0);
      await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
      send('mouseDown');
      send('mouseUp');
      send('insertText');
      await new Promise((r) => setTimeout(r, 120));
      expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(0);
      expect(await page.locator('#text').inputValue()).toBe('');
      // HOTFIX-R4A: the refused press's release is dropped before the policy (2, not 3).
      expect(calls).toBe(2);
      policy = async (_, envelope) => ({
        request: {
          taskId: instance.taskId,
          runId: 'run',
          actor: 'human',
          lane: 'cdp',
          tabId: currentFrame().tabId,
          origin: 'https://fixture.example',
          observationRevision: currentFrame().viewportRevision,
          actionDigest: 'exact-button',
        },
        decision: { kind: 'allow', sensitive: true },
      });
      send('mouseDown');
      send('mouseUp');
      await new Promise((r) => setTimeout(r, 120));
      expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(0);
      const previousCalls = calls;
      send('mouseDown', { ...currentFrame(), frameId: 'forged' });
      await new Promise((r) => setTimeout(r, 100));
      expect(calls).toBe(previousCalls);
      policy = async (_, envelope) => ({
        request: {
          taskId: instance.taskId,
          runId: 'run',
          actor: 'human',
          lane: 'cdp',
          tabId: currentFrame().tabId,
          origin: 'https://fixture.example',
          observationRevision: currentFrame().viewportRevision,
          actionDigest: 'search-button',
        },
        decision: { kind: 'allow', sensitive: false },
      });
      send('mouseDown');
      send('mouseUp');
      await vi.waitFor(async () =>
        expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(1),
      );
      // DEPLOY-61 重跑 #2: a size message (someone only watching) changes nothing on the page, so
      // the frame shown stays valid for the person's input.
      ws.send(
        JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 800, height: 600 } }),
      );
      send('mouseDown');
      send('mouseUp');
      await vi.waitFor(async () =>
        expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(2),
      );
      expect(await page.evaluate(() => innerWidth)).toBe(1280);
      // REBUILD-4 第 4 条: a size message, even from an old client that still sends a lease, is
      // ignored: the page keeps its layout and a press already sent lands where it was aimed.
      const aimed = currentFrame();
      send('mouseDown', aimed);
      ws.send(
        JSON.stringify({
          type: 'input',
          controlLease: 'stale-lease',
          payload: { type: 'viewport', width: 1000, height: 700 },
        }),
      );
      send('mouseUp', aimed);
      await vi.waitFor(async () =>
        expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(3),
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(await page.evaluate(() => innerWidth)).toBe(1280);
      expect(appliedWidth).toBe(0);
      expect(currentFrame().cssWidth).toBe(1280);
      // The server flag enforces V2 even when the URL dropped the negotiation parameter.
      expect(viewportReady).toBe(true);
      // The person's input was recorded on the task's control; it stays open (no lease).
      expect(binding.control.humanInputLog().count).toBeGreaterThan(0);
      expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    } finally {
      ws.close();
      await once(ws, 'close');
      binding.finish();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await browser.close();
      vi.unstubAllEnvs();
    }
  },
  15000,
);
