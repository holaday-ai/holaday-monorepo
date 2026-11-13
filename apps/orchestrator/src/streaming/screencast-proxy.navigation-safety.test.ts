import { once } from 'node:events';
import { type Server, createServer } from 'node:http';
import type { BrowserFrameGeometry } from '@holaday/shared-types';
import { pino } from 'pino';
import { type Browser, type Page, chromium } from 'playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/index.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createScreencastProxy } from './screencast-proxy.js';

/**
 * FIX-62 P0-1 (DEPLOY-61 第三次 单列 4): after a person's search left Google's start page, the
 * page restored later had Google's 「Share public link」 dialog open — nobody had pressed 分享.
 * Human input may only ever reach the document the person was looking at:
 *   - the release of a key or button pressed on a page that has since changed is not sent onto
 *     the NEW page (REBUILD-4: there is no handback; the person's own release names the old frame);
 *   - a same-document navigation (pushState swapping the content) retires the old frames, so an
 *     Enter made on the old frame never reaches the new page's focused control.
 */

// Page B's controls count every event they get; a human key or click that reaches them was meant
// for page A.
const PAGE_B = `<!doctype html><button id="share" autofocus style="position:absolute;left:0;top:0;width:1280px;height:800px">Share</button>
<script>
window.hits = [];
const b = document.getElementById('share');
for (const t of ['keydown', 'keyup', 'mousedown', 'mouseup', 'click']) b.addEventListener(t, (e) => window.hits.push(t + ':' + (e.key || '')));
b.focus();
</script>`;
const PAGE_A = `<!doctype html><form id="f" action="/b"><input id="q" name="q" style="position:absolute;left:40px;top:40px"></form>
<a id="nav" href="/b" style="position:absolute;left:400px;top:300px;width:300px;height:100px;display:block">go</a>
<div id="tick"></div>
<script>
// An animating page (a caret, a suggestion list): a new frame every few dozen milliseconds.
let n = 0; setInterval(() => { document.getElementById('tick').textContent = String(++n); }, 40);
// Like a results page that leaves on mousedown (tracking links), not on click.
document.getElementById('nav').addEventListener('mousedown', () => { location.href = '/b'; });
document.getElementById('q').focus();
</script>`;
// A single-page app: Enter swaps the content in place (pushState) and focuses a new button.
const PAGE_SPA = `<!doctype html><input id="q" style="position:absolute;left:40px;top:40px"><div id="tick"></div>
<script>
window.hits = [];
let n = 0; setInterval(() => { document.getElementById('tick').textContent = String(++n); }, 40);
const q = document.getElementById('q');
q.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  history.pushState({}, '', '/spa?q=' + encodeURIComponent(q.value));
  document.body.innerHTML = '<button id="share" style="position:absolute;left:0;top:0;width:1280px;height:800px">Share</button>';
  const b = document.getElementById('share');
  for (const t of ['keydown', 'keyup', 'click']) b.addEventListener(t, (ev) => window.hits.push(t + ':' + (ev.key || '')));
  b.focus();
});
q.focus();
</script>`;

// 复审 #1 #1/#2: a search box that mirrors every letter into the URL (replaceState), and a map
// that writes its position into the URL while dragged. Neither is a new document.
const PAGE_MIRROR = `<!doctype html><input id="q" style="position:absolute;left:40px;top:40px"><div id="pad" style="position:absolute;left:300px;top:300px;width:400px;height:300px"></div><div id="tick"></div>
<script>
window.hits = [];
let n = 0; setInterval(() => { document.getElementById('tick').textContent = String(++n); }, 40);
const q = document.getElementById('q');
q.addEventListener('input', () => history.replaceState({}, '', '/mirror?q=' + encodeURIComponent(q.value)));
const pad = document.getElementById('pad');
pad.addEventListener('mousedown', () => { window.hits.push('down'); history.replaceState({}, '', '/mirror?at=' + Date.now()); });
window.addEventListener('mouseup', () => window.hits.push('up'));
q.focus();
</script>`;

// 复审 #2 A: a press that swaps the page in place (pushState) — the press and its release are
// not the new content's.
const PAGE_PUSH = `<!doctype html><input id="q" style="position:absolute;left:40px;top:40px"><div id="pad" style="position:absolute;left:300px;top:300px;width:400px;height:300px"></div><div id="tick"></div>
<script>
window.hits = [];
let n = 0; setInterval(() => { document.getElementById('tick').textContent = String(++n); }, 40);
const swap = () => {
  history.pushState({}, '', '/push?swapped=1');
  document.body.innerHTML = '<button id="share" style="position:absolute;left:0;top:0;width:1280px;height:800px">Share</button>';
  const b = document.getElementById('share');
  for (const t of ['keydown', 'keyup', 'mousedown', 'mouseup', 'click']) b.addEventListener(t, (ev) => window.hits.push(t + ':' + (ev.key || '')));
  b.focus();
};
document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); swap(); } });
document.getElementById('pad').addEventListener('mousedown', () => swap());
document.getElementById('q').focus();
</script>`;

// 复审 #3 #1: a page that writes into the URL every frame (a video's ?t=, a scroll position).
const PAGE_EVERY_FRAME = `<!doctype html><input id="q" style="position:absolute;left:40px;top:40px"><div id="pad" style="position:absolute;left:300px;top:300px;width:400px;height:300px"></div>
<script>
window.downs = 0; window.ups = 0;
let n = 0; (function tick() { history.replaceState({}, '', '/frames?t=' + (++n)); requestAnimationFrame(tick); })();
document.getElementById('pad').addEventListener('mousedown', () => window.downs++);
window.addEventListener('mouseup', () => window.ups++);
document.getElementById('q').focus();
</script>`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length)
    await cleanups
      .pop()?.()
      .catch(() => undefined);
  vi.unstubAllEnvs();
});

async function site(): Promise<string> {
  const server: Server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url?.startsWith('/b')) res.end(PAGE_B);
    else if (req.url?.startsWith('/spa')) res.end(PAGE_SPA);
    else if (req.url?.startsWith('/mirror')) res.end(PAGE_MIRROR);
    else if (req.url?.startsWith('/push')) res.end(PAGE_PUSH);
    else if (req.url?.startsWith('/frames')) res.end(PAGE_EVERY_FRAME);
    else res.end(PAGE_A);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function harness(path: string) {
  vi.stubEnv('BROWSER_VIEWPORT_V2', 'true');
  const origin = await site();
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--renderer-process-limit=2'],
  });
  cleanups.push(() => browser.close());
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(origin + path);
  const taskId = `tsk_nav_safety_${Math.random().toString(36).slice(2, 8)}`;
  const instance = {
    taskId,
    userId: 'usr_nav',
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
        origin,
        observationRevision: envelope.observation?.viewportRevision ?? 0,
        actionDigest: 'input',
      },
      decision: { kind: 'allow', sensitive: false },
    }),
  });
  server.on('upgrade', proxy.handleUpgrade);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = new WebSocket(
    `ws://127.0.0.1:${(server.address() as { port: number }).port}/screencast-ws/${taskId}?token=fixture&viewportV2=1`,
  );
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.geometry) frame = m.geometry;
  });
  cleanups.push(async () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
      await once(ws, 'close');
    }
    binding.finish();
    await new Promise<void>((r) => server.close(() => r()));
  });
  await once(ws, 'open');
  await vi.waitFor(() => expect(frame).toBeDefined(), { timeout: 5000 });
  const send = (payload: Record<string, unknown>, ref: BrowserFrameGeometry | undefined = frame) =>
    ws.send(JSON.stringify({ type: 'input', observation: ref, payload }));
  const key = (
    type: 'keyDown' | 'keyUp',
    k: string,
    ref: BrowserFrameGeometry | undefined = frame,
  ) =>
    send(
      k === 'Enter'
        ? { type, key: 'Enter', code: 'Enter', keyCode: 13 }
        : { type, key: k, code: `Key${k.toUpperCase()}`, keyCode: k.toUpperCase().charCodeAt(0) },
      ref,
    );
  const hits = async (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { hits?: string[] }).hits ?? []);
  return { page, origin, send, key, hits, frame: () => frame };
}

it('an Enter still held when the search left the page is not released onto the new page', async () => {
  const h = await harness('/a');
  for (const ch of 'xy') {
    h.key('keyDown', ch);
    h.key('keyUp', ch);
  }
  await vi.waitFor(async () => expect(await h.page.locator('#q').inputValue()).toBe('xy'), {
    timeout: 5000,
  });
  const before = h.frame();
  h.key('keyDown', 'Enter', before);
  await h.page.waitForURL(/\/b\?q=xy/, { timeout: 5000 });
  await h.page.waitForFunction(() => document.activeElement?.id === 'share');
  // The release arrives naming the old page's frame (it is refused: that page is gone).
  h.key('keyUp', 'Enter', before);
  await new Promise((r) => setTimeout(r, 300));
  expect(await h.hits()).toEqual([]);
}, 30000);

it('a press on a link that leaves on mousedown is not released onto the new page', async () => {
  const h = await harness('/a');
  const before = h.frame();
  h.send({ type: 'mouseDown', x: 500, y: 350, button: 'left', clickCount: 1 }, before);
  await h.page.waitForURL(/\/b$/, { timeout: 5000 });
  await h.page.waitForFunction(() => document.activeElement?.id === 'share');
  h.send({ type: 'mouseUp', x: 500, y: 350, button: 'left', clickCount: 1 }, before);
  await new Promise((r) => setTimeout(r, 600));
  expect(await h.hits()).toEqual([]);
}, 30000);

it('after a pushState page swap, an Enter made on the old frame does not reach the new focused button', async () => {
  const h = await harness('/spa');
  h.key('keyDown', 'z');
  h.key('keyUp', 'z');
  await vi.waitFor(async () => expect(await h.page.locator('#q').inputValue()).toBe('z'), {
    timeout: 5000,
  });
  const before = h.frame();
  // The first Enter swaps the page (the person meant it); a second one, pressed at once while
  // the screen still shows the search box, names that same old frame.
  h.key('keyDown', 'Enter', before);
  h.key('keyUp', 'Enter', before);
  await h.page.waitForURL(/\/spa\?q=z/, { timeout: 5000 });
  await h.page.waitForFunction(() => document.activeElement?.id === 'share');
  h.key('keyDown', 'Enter', before);
  h.key('keyUp', 'Enter', before);
  await new Promise((r) => setTimeout(r, 500));
  expect(await h.hits()).toEqual([]);
}, 30000);

it('a search box that writes each letter into the URL (replaceState) still gets every letter (复审 #1 #1)', async () => {
  const h = await harness('/mirror');
  for (const ch of 'holadayai') {
    h.key('keyDown', ch);
    h.key('keyUp', ch);
    await new Promise((r) => setTimeout(r, 30));
  }
  await vi.waitFor(async () => expect(await h.page.locator('#q').inputValue()).toBe('holadayai'), {
    timeout: 5000,
  });
}, 30000);

it('a drag on a page that writes its position into the URL is released there (复审 #1 #2)', async () => {
  const h = await harness('/mirror');
  h.send({ type: 'mouseDown', x: 500, y: 450, button: 'left', clickCount: 1 });
  await vi.waitFor(async () => expect(await h.hits()).toEqual(['down']), { timeout: 5000 });
  // The person's release, on the frame now shown (the URL changed, the document did not).
  h.send({ type: 'mouseUp', x: 500, y: 450, button: 'left', clickCount: 1 });
  await vi.waitFor(async () => expect(await h.hits()).toEqual(['down', 'up']), { timeout: 5000 });
}, 30000);

it('the audit description names buttons only, never options, links or fields, and the page by origin', async () => {
  const { describeTargetExpression } = await import('./cdp-input.js');
  const browser = await chromium.launch({ headless: true });
  cleanups.push(() => browser.close());
  const page = await browser.newPage();
  const origin = await site();
  await page.goto(`${origin}/a`);
  await page.setContent(
    '<button id="b" style="position:absolute;left:0;top:0;width:100px;height:50px">Share</button>' +
      '<div role="option" style="position:absolute;left:0;top:100px;width:100px;height:50px">my secret query</div>' +
      '<a href="#" style="position:absolute;left:0;top:200px;width:100px;height:50px;display:block">inbox of someone@example.com</a>' +
      '<input id="f" value="typed text" style="position:absolute;left:0;top:300px">',
  );
  const at = (x: number, y: number) =>
    page.evaluate(describeTargetExpression({ type: 'mouseDown', x, y }));
  expect(await at(10, 10)).toEqual({ role: 'button', name: 'Share', page: origin });
  expect(await at(10, 110)).toEqual({ role: 'option', name: null, page: origin });
  expect(await at(10, 210)).toEqual({ role: 'a', name: null, page: origin });
  expect(await at(10, 310)).toEqual({ role: 'input', name: null, page: origin });
  await page.goto('data:text/html,<p>private</p>');
  expect(await at(5, 5)).toMatchObject({ page: 'data:' });
}, 30000);

it('an Enter whose press swapped the page in place (pushState) is not released onto the new content (复审 #2 A)', async () => {
  const h = await harness('/push');
  const before = h.frame();
  h.key('keyDown', 'Enter', before);
  await h.page.waitForURL(/swapped=1/, { timeout: 5000 });
  await h.page.waitForFunction(() => document.activeElement?.id === 'share');
  h.key('keyUp', 'Enter', before);
  await new Promise((r) => setTimeout(r, 600));
  expect(await h.hits()).toEqual([]);
}, 30000);

it('a mouse press that swapped the page in place is not released onto the new content (复审 #2 A)', async () => {
  const h = await harness('/push');
  const before = h.frame();
  h.send({ type: 'mouseDown', x: 500, y: 450, button: 'left', clickCount: 1 }, before);
  await h.page.waitForURL(/swapped=1/, { timeout: 5000 });
  h.send({ type: 'mouseUp', x: 500, y: 450, button: 'left', clickCount: 1 }, before);
  await new Promise((r) => setTimeout(r, 600));
  expect(await h.hits()).toEqual([]);
}, 30000);

it('a page that replaceStates every frame loses no letter and keeps no button held (复审 #3 #1)', async () => {
  const h = await harness('/frames');
  const word = 'abcdefghijklmnopqrstuvwxyz';
  for (const ch of word) {
    h.key('keyDown', ch);
    h.key('keyUp', ch);
    await new Promise((r) => setTimeout(r, 30));
  }
  await vi.waitFor(async () => expect(await h.page.locator('#q').inputValue()).toBe(word), {
    timeout: 8000,
  });
  for (let i = 0; i < 15; i++) {
    h.send({ type: 'mouseDown', x: 500, y: 450, button: 'left', clickCount: 1 });
    h.send({ type: 'mouseUp', x: 500, y: 450, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 500));
  const counts = await h.page.evaluate(() => {
    const w = window as unknown as { downs: number; ups: number };
    return { downs: w.downs, ups: w.ups };
  });
  // Every press that landed was released on the same page.
  expect(counts.ups).toBe(counts.downs);
  expect(counts.downs).toBeGreaterThan(10);
}, 40000);
