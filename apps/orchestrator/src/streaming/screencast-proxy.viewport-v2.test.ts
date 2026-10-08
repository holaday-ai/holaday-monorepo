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

it('real V2 proxy denies writes without policy, denies sensitive writes without nonce, and drops forged observations', async () => {
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
  binding.control.requestHuman();
  const parked = binding.control.checkpoint(async () => undefined);
  const lease = binding.control.snapshot().lease;
  if (!lease) throw new Error('fixture lease missing');
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
    `ws://127.0.0.1:${addr.port}/screencast-ws/tsk_v2?token=fixture&viewportV2=1`,
  );
  let frame: BrowserFrameGeometry | undefined;
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.geometry) frame = m.geometry;
  });
  const currentFrame = () => {
    if (!frame) throw new Error('fixture frame missing');
    return frame;
  };
  const send = (type: string, observation = frame) =>
    ws.send(
      JSON.stringify({
        type: 'input',
        controlLease: lease,
        observation,
        payload: { type, x: 150, y: 130, text: '不得输入' },
      }),
    );
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
    send('mouseDown');
    send('mouseUp');
    send('insertText');
    await new Promise((r) => setTimeout(r, 120));
    expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(0);
    expect(await page.locator('#text').inputValue()).toBe('');
    expect(calls).toBe(3);
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
        lease: envelope.controlLease ?? '',
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
        lease: envelope.controlLease ?? '',
      },
      decision: { kind: 'allow', sensitive: false },
    });
    send('mouseDown');
    send('mouseUp');
    await vi.waitFor(async () =>
      expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(1),
    );
    const previous = currentFrame();
    const beforeResizeCalls = calls;
    ws.send(
      JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 800, height: 600 } }),
    );
    send('mouseDown', previous);
    send('mouseUp', previous);
    await new Promise((r) => setTimeout(r, 350));
    expect(calls).toBe(beforeResizeCalls);
    expect(await page.evaluate(() => (window as unknown as { hits: number }).hits)).toBe(1);
  } finally {
    ws.close();
    await once(ws, 'close');
    binding.control.returnToAgent(lease);
    await parked;
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await browser.close();
    vi.unstubAllEnvs();
  }
}, 15000);
