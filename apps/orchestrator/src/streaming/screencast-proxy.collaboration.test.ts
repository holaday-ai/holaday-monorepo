import { once } from 'node:events';
import { createServer } from 'node:http';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

it('real owned stream waits for composition, delivers committed text once and stops an interrupted held gesture', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  await page.setContent('<label>备注<input id="q"></label>');
  await page.locator('#q').focus();
  const pointerReceipts: string[] = [];
  await page.exposeFunction('recordPointerReceipt', (kind: string) => pointerReceipts.push(kind));
  await page.evaluate(() => {
    const record = (window as unknown as { recordPointerReceipt: (kind: string) => void })
      .recordPointerReceipt;
    document.addEventListener('mousedown', () => record('down'));
    document.addEventListener('mouseup', () => record('up'));
  });
  const instance = {
    taskId: 'tsk_collaboration',
    userId: 'fixture-owner',
    status: 'ready',
    executor: { getPage: async () => page },
    capabilities: {
      viewportV2: true,
      observationV2: true,
      routingV2: false,
      replayV1: false,
      collaborationV2: true,
    },
  } as unknown as BrowserInstance;
  let current: BrowserInstance | null = instance;
  const release = vi.fn(async () => {
    await browser.close();
    current = null;
    return true;
  });
  const binding = browserControlSessions.start(instance);
  const server = createServer();
  const proxy = createScreencastProxy({
    pool: { peek: () => current, touch: () => {}, release } as unknown as BrowserPool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => instance.userId,
    beforeViewportAction: async (_, envelope) => ({
      request: {
        taskId: instance.taskId,
        runId: 'fixture',
        actor: 'human',
        lane: 'cdp',
        tabId: envelope.observation!.tabId,
        origin: 'https://fixture.test',
        observationRevision: envelope.observation!.viewportRevision,
        actionDigest: 'fixture-text',
      },
      decision: { kind: 'allow', sensitive: false },
    }),
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as { port: number }).port}/screencast-ws/tsk_collaboration?token=fixture&viewportV2=1&collaborationV2=1`,
  );
  let geometry: BrowserFrameGeometry | undefined;
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.geometry) geometry = message.geometry;
  });
  try {
    await once(ws, 'open');
    await vi.waitFor(() => expect(geometry).toBeDefined(), { timeout: 5000 });
    const old = new WebSocket(
      `ws://127.0.0.1:${(server.address() as { port: number }).port}/screencast-ws/tsk_collaboration?token=fixture&viewportV2=1`,
    );
    let oldFrame: BrowserFrameGeometry | undefined;
    let refused = false;
    old.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.geometry) oldFrame = m.geometry;
      if (m.type === 'input-closed' && m.reason === 'client_update_required') refused = true;
    });
    try {
      await once(old, 'open');
      await vi.waitFor(() => expect(oldFrame).toBeDefined(), { timeout: 5000 });
      old.send(
        JSON.stringify({
          type: 'input',
          payload: { type: 'insertText', text: 'must-not-apply' },
          observation: oldFrame,
        }),
      );
      await vi.waitFor(() => expect(refused).toBe(true));
      expect(await page.locator('#q').inputValue()).toBe('');
      expect(release).not.toHaveBeenCalled();
    } finally {
      old.close();
      await once(old, 'close');
    }
    ws.send(JSON.stringify({ type: 'activity', keys: 0, pointers: 0, composing: true }));
    await vi.waitFor(() => expect(binding.control.humanBusy()).toBe(true));
    const observe = vi.fn(async () => {});
    expect(await binding.control.checkpoint(observe, { maxWaitMs: 2_100 })).toMatchObject({
      blocked: true,
    });
    expect(observe).not.toHaveBeenCalled();
    ws.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'insertText', text: '中文一次' },
        observation: geometry,
      }),
    );
    ws.send(JSON.stringify({ type: 'activity', keys: 0, pointers: 0, composing: false }));
    await vi.waitFor(async () => expect(await page.locator('#q').inputValue()).toBe('中文一次'));
    expect(await binding.control.checkpoint(observe)).toMatchObject({ resumed: true });
    expect(observe).toHaveBeenCalledOnce();
    ws.send(JSON.stringify({ type: 'activity', keys: 0, pointers: 1, composing: false }));
    const box = await page.locator('#q').boundingBox();
    if (!box) throw new Error('fixture input missing');
    ws.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'mouseDown', x: box.x + 5, y: box.y + 5, button: 'left' },
        observation: geometry,
      }),
    );
    await vi.waitFor(() => expect(pointerReceipts).toEqual(['down']));
    await vi.waitFor(() => expect(binding.control.humanBusy()).toBe(true));
    await vi.waitFor(() => expect(binding.control.isSettled()).toBe(true));
    ws.close();
    await once(ws, 'close');
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(browser.isConnected()).toBe(false));
    expect(binding.control.snapshot()).toMatchObject({
      phase: 'closed',
      error: 'input_outcome_unknown',
    });
    expect(pointerReceipts).toEqual(['down']);
  } finally {
    if (ws.readyState !== WebSocket.CLOSED) {
      ws.close();
      await once(ws, 'close');
    }
    await browser.close();
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15_000);
