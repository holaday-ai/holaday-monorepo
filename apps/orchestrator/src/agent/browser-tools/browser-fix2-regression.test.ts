import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { completionGap, receiptEvidence } from './browser-completion.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
let browser: Browser;
let base: string;
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.url === '/api')
    res.end(
      `<main>Public results</main><script>fetch('/youtubei/v1/search',{method:'POST',body:'{}'})</script>`,
    );
  else if (req.url === '/order')
    res.end(`<main>Public results</main><script>fetch('/order/create',{method:'POST'})</script>`);
  else
    res.end(
      `<h1>Long page</h1><label>Name<input></label><button>Continue</button><main>${'<p>Stable article paragraph.</p>'.repeat(100)}</main>`,
    );
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
});
it('allows read-only search POST on navigation', async () => {
  const p = await browser.newPage();
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const r = await t.execute({ tool: 'navigate', url: `${base}/api` });
    expect(r.interruption).toBeUndefined();
    expect(r.effect?.unexpected).toBe(false);
  } finally {
    t.dispose();
    await p.close();
  }
});
it('records the write branch and sanitized request', async () => {
  const p = await browser.newPage();
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const r = await t.execute({ tool: 'navigate', url: `${base}/order` });
    expect(r.interruption?.reason).toBe('unexpected_effect');
    expect(r.effect).toMatchObject({
      triggers: expect.arrayContaining([
        expect.objectContaining({
          branch: 'transaction_request',
          method: 'POST',
          url: `${base}/order/create`,
        }),
      ]),
    });
  } finally {
    t.dispose();
    await p.close();
  }
});
it('keeps snapshot cursor across read_page and DOM churn but not navigation', async () => {
  const p = await browser.newPage();
  await p.goto(base);
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const first = JSON.parse((await t.execute({ tool: 'get_page_text', maxChars: 100 })).text);
    await t.execute({ tool: 'read_page' });
    await p.locator('button').evaluate((el) => el.setAttribute('data-clock', 'changed'));
    const next = await t.execute({ tool: 'get_page_text', cursor: first.cursor, maxChars: 100 });
    expect(next.ok).toBe(true);
    expect(JSON.parse(next.text).range).toEqual([100, 200]);
    await p.reload();
    expect(
      (await t.execute({ tool: 'get_page_text', cursor: JSON.parse(next.text).cursor })).ok,
    ).toBe(false);
  } finally {
    t.dispose();
    await p.close();
  }
});
it('new_tab returns fresh active frame context', async () => {
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(base);
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const r = JSON.parse((await t.execute({ tool: 'new_tab' })).text);
    expect(r.frameId).toBeTruthy();
    expect(
      (
        await t.execute({
          tool: 'navigate',
          url: base,
          tabId: r.tabId,
          frameId: r.frameId,
          observationRevision: r.observationRevision,
        })
      ).ok,
    ).toBe(true);
  } finally {
    t.dispose();
    await p.context().close();
  }
});
it('stale action does not replay and returns a fresh observation', async () => {
  const p = await browser.newPage();
  await p.goto(base);
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const s = JSON.parse((await t.execute({ tool: 'read_page' })).text);
    const ref = s.tree.match(/textbox "Name" \[ref=(e\d+)\]/)[1];
    await p.locator('input').evaluate((el) => el.replaceWith(el.cloneNode(true)));
    const r = await t.execute({
      tool: 'type',
      ref,
      text: 'Alice',
      observationRevision: s.observationRevision,
    });
    expect(r.errorCode).toBe('stale_ref');
    expect(r.text).toContain('fresh_observation');
    expect(await p.locator('input').inputValue()).toBe('');
  } finally {
    t.dispose();
    await p.close();
  }
});
const scripted = (calls: () => { name: string; input: unknown }): MessagesAdapter => ({
  metadata: { provider: 'anthropic', model: 'scripted' },
  async create() {
    return {
      id: 'x',
      metadata: this.metadata,
      content: [{ type: 'tool_use', id: 'x', ...calls() }],
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
});
it('bounds repeated reads with no new information', async () => {
  let calls = 0;
  const r = await runUnifiedBrowserLoop({
    intent: 'Read title',
    adapter: scripted(() => {
      calls++;
      return { name: 'read_page', input: {} };
    }),
    observationV2: true,
    maxSteps: 40,
    execute: async () => ({
      ok: true,
      text: JSON.stringify({
        tree: 'same',
        observationRevision: String(calls),
        capturedAt: String(calls),
      }),
      url: base,
    }),
  });
  expect(calls).toBeLessThanOrEqual(7);
  expect(r.status).toBe('failed');
});
it.each(['滚动5次', '5次向下滚动', 'scroll 5 times'])(
  'requires actual scroll count for %s',
  (intent) => {
    expect(
      completionGap(
        intent,
        intent,
        [
          { tool: 'navigate', ok: true, url: base },
          {
            tool: 'scroll',
            ok: true,
            scroll: { beforeHeight: 1, afterHeight: 2, addedChars: 1, grew: true },
          },
        ],
        true,
      ),
    ).toBeTruthy();
  },
);
it('accepts download receipt without filename in page text', async () => {
  let turn = 0;
  const r = await runUnifiedBrowserLoop({
    intent: '下载文件并报告文件名与大小',
    observationV2: true,
    requireBrowserEvidence: true,
    maxSteps: 4,
    adapter: scripted(() =>
      ++turn === 1
        ? { name: 'navigate', input: { url: base } }
        : turn === 2
          ? { name: 'download', input: { ref: 'e1' } }
          : {
              name: 'finish',
              input: {
                status: 'completed',
                summary: 'baseline.txt，53字节，已保存',
                evidence: 'baseline.txt 53 bytes',
              },
            },
    ),
    supportedTools: { download: true, upload: false, tabs: true },
    execute: async (a) =>
      a.tool === 'download'
        ? {
            ok: true,
            text: 'baseline.txt 53 bytes',
            download: {
              fileId: 'f',
              filename: 'baseline.txt',
              sizeBytes: 53,
              sha256: 'a'.repeat(64),
              downloadUrl: '/api/files/f/download',
            },
          }
        : { ok: true, text: 'download page', url: base },
  });
  expect(r.status).toBe('completed');
});
it('fails after three stale attempts instead of consuming forty turns', async () => {
  let calls = 0;
  const r = await runUnifiedBrowserLoop({
    intent: 'Fill name',
    maxSteps: 40,
    adapter: scripted(() => {
      calls++;
      return { name: 'type', input: { ref: 'e1', text: 'Alice' } };
    }),
    execute: async () => ({
      ok: false,
      text: 'stale_ref fresh_observation',
      errorCode: 'stale_ref',
    }),
  });
  expect(calls).toBe(3);
  expect(r.status).toBe('failed');
});
it('requires host form and screenshot receipts for a claimed filled form', () => {
  expect(
    completionGap(
      '只填表不提交并截图',
      '已填表并截图',
      [{ tool: 'navigate', ok: true, url: base }],
      true,
    ),
  ).toBeTruthy();
});
it('rejects forbidden form submission even with a screenshot', () => {
  expect(
    completionGap(
      '填表不提交并截图',
      '已填写',
      [
        { tool: 'navigate', ok: true, url: base },
        { tool: 'type', ok: true, form: { ref: 'e1', filled: true, submitted: true } },
        { tool: 'screenshot', ok: true, screenshot: true },
      ],
      true,
    ),
  ).toBeTruthy();
});

it('stops an unprovable finish after forcing conclusion', async () => {
  let turn = 0;
  const r = await runUnifiedBrowserLoop({
    intent: '下载文档',
    observationV2: true,
    maxSteps: 40,
    adapter: scripted(() =>
      ++turn <= 5
        ? { name: 'read_page', input: {} }
        : { name: 'finish', input: { status: 'completed', summary: '已经下载', evidence: 'same' } },
    ),
    execute: async () => ({
      ok: true,
      text: JSON.stringify({ tree: 'same', frames: [{ frameId: String(turn) }] }),
      url: base,
    }),
  });
  expect(turn).toBe(6);
  expect(r.status).toBe('failed');
});
it('uses only host scroll receipts as completion evidence', () => {
  const trace = [
    {
      tool: 'scroll_until',
      ok: true,
      scroll: {
        beforeHeight: 100,
        afterHeight: 200,
        addedChars: 10,
        grew: true,
        steps: [{ beforeHeight: 100, afterHeight: 200, addedChars: 10, grew: true }],
      },
    },
  ];
  expect(JSON.parse(receiptEvidence('scroll 1 times', trace)).scrollCount).toBe(1);
  expect(receiptEvidence('scroll 1 times', [])).toBe('');
});
it('counts actual scroll_until steps and does not stop at text budget', async () => {
  const p = await browser.newPage();
  await p.goto(base);
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    const r = await t.execute({ tool: 'scroll_until', maxSteps: 3, maxChars: 100, maxMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.scroll?.steps).toHaveLength(3);
    expect(JSON.parse(r.text).steps).toBe(3);
  } finally {
    t.dispose();
    await p.close();
  }
});
it('bounds alternating repeated reads too', async () => {
  let turn = 0;
  const r = await runUnifiedBrowserLoop({
    intent: 'Read',
    maxSteps: 40,
    adapter: scripted(() => ({ name: ++turn % 2 ? 'read_page' : 'get_page_text', input: {} })),
    execute: async (action) => ({
      ok: true,
      text: action.tool === 'read_page' ? 'same tree' : 'same text',
    }),
  });
  expect(turn).toBeLessThanOrEqual(8);
  expect(r.status).toBe('failed');
});
it('accepts verified filled form and screenshot without inventing page text', async () => {
  let turn = 0;
  const actions = [
    { name: 'navigate', input: { url: base } },
    { name: 'type', input: { ref: 'e1', text: 'Alice' } },
    { name: 'screenshot', input: {} },
    { name: 'finish', input: { status: 'completed', summary: '表单已填写，未提交并截图' } },
  ];
  const r = await runUnifiedBrowserLoop({
    intent: '填表不提交并截图',
    observationV2: true,
    requireBrowserEvidence: true,
    adapter: scripted(() => actions[turn++]!),
    execute: async (a) =>
      a.tool === 'type'
        ? { ok: true, text: 'filled', form: { ref: 'e1', filled: true, submitted: false } }
        : a.tool === 'screenshot'
          ? { ok: true, text: 'screenshot', image: { mediaType: 'image/jpeg', data: 'test' } }
          : { ok: true, text: 'page', url: base },
  });
  expect(r.status).toBe('completed');
});

it('allows only observed public-site initialization endpoints, retaining unknown POST protection', async () => {
  const p = await browser.newPage();
  await p.route('https://www.youtube.com/**', (route) =>
    route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'application/json',
      body: route.request().isNavigationRequest()
        ? `<main>public results</main><script>fetch('/youtubei/v1/guide',{method:'POST'});fetch('/youtubei/v1/log_event',{method:'POST'});fetch('/api/jnn/v1/GenerateIT',{method:'POST'});fetch('/youtubei/v1/notification_registration/set_registration',{method:'POST'});</script>`
        : '{}',
    }),
  );
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    expect(
      (await t.execute({ tool: 'navigate', url: 'https://www.youtube.com/results' })).effect
        ?.unexpected,
    ).toBe(false);
    await p.evaluate(() => fetch('/youtubei/v1/like', { method: 'POST' }));
    expect((await t.execute({ tool: 'read_page' })).interruption?.reason).toBe('unexpected_effect');
  } finally {
    t.dispose();
    await p.close();
  }
});

it('attributes initial navigation telemetry to its destination origin', async () => {
  const p = await browser.newPage();
  await p.route('https://en.wikipedia.org/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: r.request().isNavigationRequest()
        ? `<main>public article</main><script>navigator.sendBeacon('/beacon/impression','view')</script>`
        : '',
    }),
  );
  const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
  try {
    expect(
      (await t.execute({ tool: 'navigate', url: 'https://en.wikipedia.org/wiki/Example' })).effect
        ?.unexpected,
    ).toBe(false);
  } finally {
    t.dispose();
    await p.close();
  }
});

it('does not keep asking after the forced final turn omits a tool', async () => {
  let n = 0;
  const adapter = scripted(() => ({ name: 'read_page', input: {} }));
  const original = adapter.create.bind(adapter);
  adapter.create = async (...args) => {
    const response = await original(...args);
    if (++n > 5) response.content = [];
    return response;
  };
  const r = await runUnifiedBrowserLoop({
    intent: 'read',
    adapter,
    maxSteps: 40,
    execute: async () => ({ ok: true, text: 'same' }),
  });
  expect(n).toBe(6);
  expect(r.status).toBe('failed');
});
it.each([
  '读取页面，不要截图',
  '只读页面，不要填写表单',
  '不要滚动5次，只读取标题',
  'Read page; do not screenshot',
])('does not require prohibited actions: %s', (intent) => {
  expect(
    completionGap(intent, '已读取页面', [{ tool: 'navigate', ok: true, url: base }], true),
  ).toBeNull();
});
it.each([
  ['/1/public-site/tinymce/5.10.9-138/cdn-init', false],
  ['/1/public-site/tinymce/5.10.9-138/save', true],
] as const)('classifies TinyMCE initialization narrowly: %s', async (path, unexpected) => {
  const page = await browser.newPage();
  await page.route('https://cdn.tiny.cloud/**', (route) =>
    route.fulfill({
      contentType: route.request().isNavigationRequest() ? 'text/html' : 'application/json',
      body: route.request().isNavigationRequest()
        ? `<main>Editor</main><script>fetch('${path}',{method:'POST'})</script>`
        : '{}',
    }),
  );
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    expect(
      (await tools.execute({ tool: 'navigate', url: 'https://cdn.tiny.cloud/test' })).effect
        ?.unexpected,
    ).toBe(unexpected);
  } finally {
    tools.dispose();
    await page.close();
  }
});
