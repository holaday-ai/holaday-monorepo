import { once } from 'node:events';
import { createServer } from 'node:http';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

/**
 * HOTFIX-R4A: 「页面刚变了，再点一次」 must mean the page changed, not that its picture moved.
 * Real Chromium, a page whose own animation publishes a new frame every 100 ms.
 */
let browser: Browser;
beforeAll(async () => {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  vi.unstubAllEnvs();
});

const PAGE = `<!doctype html><body style="margin:0">
<div id="tick" style="position:absolute;left:700px;top:400px;width:120px;height:60px;background:#e22">0</div>
<button id="b" style="position:absolute;left:100px;top:100px;width:160px;height:80px">按钮</button>
<iframe id="f" src="https://tiles.fixture.test/tile?n=0" style="position:absolute;left:400px;top:100px;width:200px;height:200px;border:0"></iframe>
<script>
  window.hits = 0; window.ups = 0; window.tiles = 0;
  let n = 0;
  setInterval(() => { const t = document.getElementById('tick'); t.textContent = String(++n); t.style.background = n % 2 ? '#e22' : '#22e'; }, 100);
  const b = document.getElementById('b');
  b.addEventListener('click', () => window.hits++);
  b.addEventListener('mouseup', () => window.ups++);
  addEventListener('message', (e) => { if (e.data === 'tile') window.tiles++; });
</script></body>`;
// The iframe swaps its picture by reloading itself every 300 ms (like reCAPTCHA's new tiles).
const TILE = (n: number) =>
  `<body style="margin:0;background:hsl(${(n * 40) % 360},70%,60%)"><button style="width:200px;height:200px" onclick="parent.postMessage('tile','*')">${n}</button><script>setTimeout(()=>location.replace('/tile?n=${n + 1}'),300)</script></body>`;

async function screen() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('https://page.fixture.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE }),
  );
  await page.route('https://tiles.fixture.test/**', (route) => {
    const n = Number(new URL(route.request().url()).searchParams.get('n') ?? 0);
    return route.fulfill({ contentType: 'text/html', body: TILE(n) });
  });
  await page.goto('https://page.fixture.test/');
  const instance = {
    taskId: `tsk_doc_${Math.random().toString(36).slice(2)}`,
    userId: 'usr_doc',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const server = createServer();
  const proxy = createScreencastProxy({
    pool: { peek: () => instance, touch: () => {} } as unknown as BrowserPool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => instance.userId,
    beforeViewportAction: async (_, envelope) => ({
      request: {
        taskId: instance.taskId,
        runId: 'run',
        actor: 'human',
        lane: 'cdp',
        tabId: envelope.observation!.tabId,
        origin: 'https://page.fixture.test',
        observationRevision: envelope.observation!.viewportRevision,
        actionDigest: 'x',
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
  const expired: string[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.geometry) frame = m.geometry;
    if (m.type === 'input-expired') expired.push(m.input);
  });
  await once(ws, 'open');
  await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
  // The screen has been open a moment (dialog counts are read while frames flow).
  await new Promise((r) => setTimeout(r, 700));
  const send = (observation: BrowserFrameGeometry, payload: Record<string, unknown>) =>
    ws.send(JSON.stringify({ type: 'input', observation, payload }));
  const click = (x: number, y: number, observation: BrowserFrameGeometry) => {
    for (const type of ['mouseDown', 'mouseUp'])
      send(observation, { type, x, y, button: 'left', clickCount: 1 });
  };
  /** The frame on screen when the person looked, replaced by newer ones `ms` later. */
  const lookedAt = async (ms = 500): Promise<BrowserFrameGeometry> => {
    const shown = frame!;
    await vi.waitFor(() => expect(frame?.frameId).not.toBe(shown.frameId), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, ms));
    return shown;
  };
  const read = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { hits: number; ups: number; tiles: number };
      return { hits: w.hits, ups: w.ups, tiles: w.tiles };
    });
  const close = async () => {
    ws.close();
    await once(ws, 'close');
    binding.finish();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await page.close();
  };
  return { page, click, send, lookedAt, read: () => read(page), expired, close, now: () => frame! };
}

it('HOTFIX-R4A: on a page animating every 100 ms, 10 clicks on frames superseded 0.5 s ago all land', async () => {
  const s = await screen();
  try {
    for (let i = 0; i < 10; i++) {
      s.click(180, 140, await s.lookedAt(500));
      await vi.waitFor(async () => expect((await s.read()).hits).toBe(i + 1), { timeout: 3000 });
    }
    expect(s.expired).toEqual([]);
  } finally {
    await s.close();
  }
}, 40000);

it('HOTFIX-R4A: a click on a tile inside an iframe that keeps swapping its picture lands', async () => {
  const s = await screen();
  try {
    for (let i = 0; i < 3; i++) {
      s.click(500, 200, await s.lookedAt(600));
      await vi.waitFor(async () => expect((await s.read()).tiles).toBe(i + 1), { timeout: 3000 });
    }
    expect(s.expired).toEqual([]);
  } finally {
    await s.close();
  }
}, 30000);

it('HOTFIX-R4A: the same-document grace ends at the URL — after a replaceState the old frame is refused', async () => {
  const s = await screen();
  try {
    const shown = s.now();
    await s.page.evaluate(() => history.replaceState(null, '', '/?q=changed'));
    await new Promise((r) => setTimeout(r, 500));
    s.click(180, 140, shown);
    await vi.waitFor(() => expect(s.expired).toEqual(['pointer']), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    // Neither the press nor its lone release reached the button.
    expect(await s.read()).toMatchObject({ hits: 0, ups: 0 });
  } finally {
    await s.close();
  }
}, 20000);

it('HOTFIX-R4A: a dialog opened after the frame was shown — the press on it is refused', async () => {
  const s = await screen();
  try {
    await new Promise((r) => setTimeout(r, 700)); // dialog counts are being read
    const shown = s.now();
    await s.page.evaluate(() => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.textContent = '确认支付？';
      d.style.cssText =
        'position:absolute;left:900px;top:600px;width:200px;height:80px;background:#fff';
      document.body.appendChild(d);
    });
    await new Promise((r) => setTimeout(r, 500));
    s.click(180, 140, shown);
    await vi.waitFor(() => expect(s.expired).toEqual(['pointer']), { timeout: 3000 });
    expect(await s.read()).toMatchObject({ hits: 0, ups: 0 });
    // On the newest frame (the person sees the dialog) the press is the person's choice.
    s.click(180, 140, s.now());
    await vi.waitFor(async () => expect((await s.read()).hits).toBe(1), { timeout: 3000 });
  } finally {
    await s.close();
  }
}, 20000);

it('HOTFIX-R4A: past the 1.5 s same-document grace the old frame is refused as before', async () => {
  const s = await screen();
  try {
    s.click(180, 140, await s.lookedAt(1800));
    await vi.waitFor(() => expect(s.expired).toEqual(['pointer']), { timeout: 3000 });
    expect(await s.read()).toMatchObject({ hits: 0, ups: 0 });
  } finally {
    await s.close();
  }
}, 20000);

it('HOTFIX-R4A: the key-up of an Enter whose page then changed is dropped without 「再点一次」', async () => {
  const s = await screen();
  try {
    const shown = s.now();
    await s.page.goto('https://page.fixture.test/next');
    await new Promise((r) => setTimeout(r, 500));
    s.send(shown, { type: 'keyUp', key: 'Enter', code: 'Enter' });
    s.send(shown, { type: 'mouseUp', x: 180, y: 140, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 600));
    expect(s.expired).toEqual([]);
  } finally {
    await s.close();
  }
}, 20000);

it('HOTFIX-R4A: another document is never the same document — after a pushState or a navigation the old frame is refused', async () => {
  const s = await screen();
  try {
    const before = s.now();
    await s.page.evaluate(() => history.pushState(null, '', '/pushed'));
    await new Promise((r) => setTimeout(r, 500));
    s.click(180, 140, before);
    await vi.waitFor(() => expect(s.expired.length).toBe(1), { timeout: 3000 });
    const beforeNav = s.now();
    await s.page.goto('https://page.fixture.test/other');
    await new Promise((r) => setTimeout(r, 500));
    s.click(180, 140, beforeNav);
    await vi.waitFor(() => expect(s.expired.length).toBe(2), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(await s.read()).toMatchObject({ hits: 0, ups: 0 });
  } finally {
    await s.close();
  }
}, 20000);
