import { createHash } from 'node:crypto';
import { type Server, createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveBrowserCapabilities } from '../../config/browser-capabilities.js';
import type { MessagesAdapter, NeutralOutputContentBlock } from '../../llm/messages-adapter.js';
import { persistBrowserDownload } from './browser-download.js';
import { installDomainEgress } from './domain-egress.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

function adapter(turns: Array<Array<[string, unknown]>>): MessagesAdapter {
  let n = 0;
  return {
    metadata: { provider: 'anthropic', model: 'fixed-test' },
    async create() {
      const content: NeutralOutputContentBlock[] = (
        turns[n++] ?? [['finish', { status: 'failed', summary: 'script exhausted' }]]
      ).map(([name, input], i) => ({ type: 'tool_use', name, input, id: `${n}-${i}` }));
      return {
        id: `r${n}`,
        metadata: this.metadata,
        content,
        stopReason: 'tool_use',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
}
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

describe('BROWSER-FIX-1 fixed-call real Chromium acceptance', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/file') {
        res.writeHead(200, { 'content-disposition': 'attachment; filename="some-file.txt"' });
        res.end('hello, browser\n');
        return;
      }
      if (req.url === '/video.mp4') {
        res.end('video');
        return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/wall') res.end('<title>Watch</title><iframe src="/bot"></iframe>');
      else if (req.url === '/bot') res.end('Sign in to confirm you’re not a bot');
      else if (req.url === '/scroll')
        res.end(
          `<title>scroll</title><style>p{height:1000px}</style><p>start</p><script>let n=0,busy=false;addEventListener('scroll',()=>{if(!busy&&n<5&&innerHeight+scrollY>=document.body.scrollHeight-100){busy=true;n++;let loading=document.createElement('div');loading.className='jscroll-loading';loading.textContent='Loading...';document.body.append(loading);setTimeout(()=>{loading.remove();let p=document.createElement('p');p.textContent='new paragraph '+n;p.style.height='600px';document.body.append(p);busy=false},200)}})</script>`,
        );
      else
        res.end(
          '<title>fixture</title><h1>Evidence from real page</h1><a href="/file">Download file</a>',
        );
    });
    base = await listen(server);
    browser = await chromium.launch({ headless: true });
  }, 60000);
  afterAll(async () => {
    await browser?.close();
    await close(server);
  });
  it('stores the exact download with file ID, hash and size; oversize fails', async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, {
      saveDownload: (d) =>
        persistBrowserDownload(d, async (input) => ({
          fileId: 'fixture-id',
          filename: input.filename,
          sizeBytes: input.buffer.length,
          sha256: input.sha256,
          downloadUrl: '/api/files/fixture-id/download',
        })),
    });
    const snapshot = await tools.execute({ tool: 'snapshot' });
    const ref = snapshot.text.match(/link "Download file" \[ref=(e\d+)\]/)?.[1];
    expect(ref).toBeTruthy();
    const result = await tools.execute({ tool: 'download', ref: ref! });
    expect(result.download).toMatchObject({
      fileId: 'fixture-id',
      sizeBytes: 15,
      sha256: createHash('sha256').update('hello, browser\n').digest('hex'),
    });
    const small = createPlaywrightUnifiedExecutor(page, {
      saveDownload: (d) =>
        persistBrowserDownload(
          d,
          async () => {
            throw new Error('must not store');
          },
          2,
        ),
    });
    expect((await small.execute({ tool: 'download', ref: ref! })).ok).toBe(false);
    tools.dispose();
    small.dispose();
    await page.close();
  });
  it('cannot complete on an iframe bot wall even with OBSERVATION off', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/wall`);
    await page.locator('iframe').contentFrame().locator('body').waitFor();
    const tools = createPlaywrightUnifiedExecutor(page);
    const result = await runUnifiedBrowserLoop({
      intent: '浏览器读取视频',
      adapter: adapter([
        [['snapshot', {}]],
        [['finish', { status: 'completed', summary: '未触发验证', evidence: 'Watch' }]],
      ]),
      execute: tools.execute,
      probeBlocker: tools.blocker,
      requireBrowserEvidence: true,
      supportedTools: tools.supportedTools,
    });
    expect(result.status).toBe('awaiting_user');
    expect(JSON.stringify(result)).toContain('验证');
    tools.dispose();
    await page.close();
  });
  it('zero-step finish is rejected, then real navigation and snapshot permits delivery', async () => {
    const page = await browser.newPage();
    const tools = createPlaywrightUnifiedExecutor(page);
    const result = await runUnifiedBrowserLoop({
      intent: '必须浏览器读取页面',
      adapter: adapter([
        [['finish', { status: 'completed', summary: 'invented', evidence: 'invented' }]],
        [
          ['navigate', { url: base }],
          ['snapshot', {}],
        ],
        [
          [
            'finish',
            {
              status: 'completed',
              summary: 'Evidence from real page',
              evidence: 'Evidence from real page',
            },
          ],
        ],
      ]),
      execute: tools.execute,
      probeBlocker: tools.blocker,
      requireBrowserEvidence: true,
      supportedTools: tools.supportedTools,
    });
    expect(result.status).toBe('completed');
    expect(page.url()).toBe(`${base}/`);
    tools.dispose();
    await page.close();
  });
  it.each([false, true])(
    'creates three owned tabs and switches back, observation=%s',
    async (observationV2) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(base);
      const foreign = await context.newPage();
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2 });
      const listed = await tools.execute({ tool: 'list_tabs' });
      const first = JSON.parse(listed.text).tabs[0].tabId;
      for (let i = 0; i < 3; i++) {
        const created = await tools.execute({ tool: 'new_tab' });
        expect(created.ok).toBe(true);
        expect(created.tabId).toBeTruthy();
        await tools.execute({ tool: 'navigate', url: `${base}/?tab=${i}` });
      }
      expect(JSON.parse((await tools.execute({ tool: 'list_tabs' })).text).tabs).toHaveLength(4);
      const switched = await tools.execute({ tool: 'switch_tab', targetTabId: first });
      expect(switched.ok).toBe(true);
      // AP2 core-07: in cloud observation the read after a switch names the title.
      if (observationV2) expect(JSON.parse(switched.text).title).toBe('fixture');
      expect(tools.page).toBe(page);
      expect((await tools.execute({ tool: 'close_tab', targetTabId: 'foreign' })).ok).toBe(false);
      expect(foreign.isClosed()).toBe(false);
      tools.dispose();
      await context.close();
    },
  );
  it('records five asynchronous scroll growth receipts and a stalled receipt', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/scroll`);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 500 });
    for (let n = 0; n < 5; n++) {
      const result = await tools.execute({ tool: 'scroll', direction: 'down', amount: 1 });
      expect(result.scroll?.grew).toBe(true);
      expect(result.scroll?.addedChars).toBeGreaterThanOrEqual(15);
    }
    const final = await tools.execute({ tool: 'scroll', direction: 'down', amount: 1 });
    expect(final.scroll?.grew).toBe(false);
    tools.dispose();
    await page.close();
  });
  it('canary is exact account membership and retains global flags for all other users', () => {
    expect(resolveBrowserCapabilities('tester', { allowlist: 'tester, second' })).toEqual({
      viewportV2: true,
      observationV2: true,
      replayV1: true,
      routingV2: true,
    });
    expect(resolveBrowserCapabilities('test', { allowlist: 'tester', observation: true })).toEqual({
      viewportV2: false,
      observationV2: true,
      replayV1: false,
      routingV2: false,
    });
    expect(resolveBrowserCapabilities(undefined, { allowlist: 'tester' }).viewportV2).toBe(false);
  });
  it('uses a fake domain proxy, counts actual payload, blocks media and falls back on connect failure', async () => {
    let forwarded = 0;
    const proxy = createServer((req, res) => {
      forwarded++;
      const target = new URL(req.url!);
      const upstream = httpRequest(target, { headers: req.headers }, (r) => {
        res.writeHead(r.statusCode!, r.headers);
        r.pipe(res);
      });
      req.pipe(upstream);
    });
    const proxyUrl = await listen(proxy);
    const page = await browser.newPage();
    const policy = {
      check: async (url: string) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
    };
    const egress = await installDomainEgress(
      page,
      { enabled: true, domains: ['127.0.0.1'], proxyUrl },
      policy,
    );
    await page.goto(base);
    expect(forwarded).toBeGreaterThan(0);
    expect(egress.metrics.proxyResponseBytes).toBeGreaterThan(0);
    await page.evaluate(() => fetch('/video.mp4').catch(() => null));
    expect(egress.metrics.blockedMedia).toBe(1);
    await close(proxy);
    await page.goto(`${base}/?fallback=1`);
    expect(egress.metrics.directFallbacks).toBeGreaterThan(0);
    await egress.dispose();
    await page.close();
  });
  it('falls back on explicit proxy unavailability for reads without replaying writes', async () => {
    let directWrites = 0;
    const origin = createServer((req, res) => {
      if (req.method === 'POST') directWrites++;
      res.end('<h1>direct fallback</h1>');
    });
    const originUrl = await listen(origin);
    const proxy = createServer((_req, res) => {
      res.writeHead(503);
      res.end('proxy unavailable');
    });
    const proxyUrl = await listen(proxy);
    const page = await browser.newPage();
    const egress = await installDomainEgress(
      page,
      { enabled: true, domains: ['127.0.0.1'], proxyUrl },
      { check: async (url) => ({ allowed: true, url, addresses: ['127.0.0.1'] }) },
    );
    try {
      await page.goto(originUrl);
      expect(await page.locator('h1').innerText()).toBe('direct fallback');
      expect(egress.metrics.directFallbacks).toBe(1);
      await page.evaluate(() => fetch('/write', { method: 'POST' }).catch(() => null));
      expect(directWrites).toBe(0);
      expect(egress.metrics.directFallbacks).toBe(1);
    } finally {
      await egress.dispose();
      await page.close();
      await close(proxy);
      await close(origin);
    }
  });
  it('binds a provider sticky session to the authenticated user/task and site', async () => {
    const sessions: Array<string | undefined> = [];
    const proxy = createServer((req, res) => {
      sessions.push(req.headers['proxy-authorization']);
      res.setHeader('content-type', 'text/html');
      res.end('<h1>sticky proxy</h1>');
    });
    const endpoint = new URL(await listen(proxy));
    endpoint.username = 'session-{session}';
    const policy = {
      check: async (url: string) => ({ allowed: true as const, url, addresses: ['127.0.0.1'] }),
    };
    try {
      for (const owner of ['alice:task-a', 'bob:task-b']) {
        const page = await browser.newPage();
        const egress = await installDomainEgress(
          page,
          {
            enabled: true,
            domains: ['a.example.test', 'b.example.test'],
            proxyUrl: endpoint.href,
          },
          policy,
          undefined,
          undefined,
          owner,
        );
        try {
          await page.goto('http://a.example.test/one');
          if (owner.startsWith('alice')) {
            await page.goto('http://a.example.test/two');
            await page.goto('http://b.example.test/one');
          }
        } finally {
          await egress.dispose();
          await page.close();
        }
      }
      expect(sessions).toHaveLength(4);
      expect(sessions[0]).toBe(sessions[1]);
      expect(sessions[0]).not.toBe(sessions[2]);
      expect(sessions[0]).not.toBe(sessions[3]);
    } finally {
      await close(proxy);
    }
  });
  it('cancelling a proxied request never retries it through the direct connection', async () => {
    const proxy = createServer(() => {});
    const proxyUrl = await listen(proxy);
    const page = await browser.newPage();
    const controller = new AbortController();
    const egress = await installDomainEgress(
      page,
      { enabled: true, domains: ['127.0.0.1'], proxyUrl },
      { check: async (url) => ({ allowed: true, url, addresses: ['127.0.0.1'] }) },
      undefined,
      controller.signal,
    );
    try {
      const navigation = page.goto(base, { timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(100);
      controller.abort();
      await navigation;
      expect(egress.metrics.directFallbacks).toBe(0);
    } finally {
      await egress.dispose();
      await page.close();
      await close(proxy);
    }
  });
});
