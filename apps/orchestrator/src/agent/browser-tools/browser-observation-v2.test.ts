import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';

// Real Chromium and local HTTP; the only scripted component is the model.
describe('cloud observation v2', () => {
  let browser: Browser;
  let base: string;
  let writes = 0;
  const server = createServer((req, res) => {
    if (req.method === 'POST') writes++;
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') res.end('<label>Date<input type="date"></label><button>Pay</button>');
    else
      res.end(`<h1>Catalog</h1><form role="search" action="/search"><label>Query<input name="q" onkeydown="if(event.key==='Enter'){event.preventDefault();fetch('/write',{method:'POST'});document.querySelector('h1').textContent='Order created'}"></label><button>Search</button></form>
      <a href="/article?id=42&utm_source=x#part">Article</a><a target="_blank" href="/popup">Popup</a>
      <table><caption>Prices</caption><tr><th>Name</th><th>Price</th></tr><tr><td>Box</td><td>29</td></tr></table>
      <iframe src="http://localhost:${(server.address() as AddressInfo).port}/frame"></iframe>
      <main>${'long article paragraph '.repeat(500)}</main>`);
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  async function fixture() {
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, {
      observationV2: true,
      actionTimeoutMs: 2000,
    });
    return { page, tools };
  }
  const read = async (
    tools: ReturnType<typeof createPlaywrightUnifiedExecutor>,
    action: UnifiedBrowserAction,
  ) => {
    const result = await tools.execute(action);
    expect(result.ok, result.text).toBe(true);
    return JSON.parse(result.text);
  };
  const refFor = (tree: string, label: string) =>
    tree
      .split('\n')
      .find((l) => l.includes(label) && /ref=e\d+/.test(l))!
      .match(/ref=(e\d+)/)![1]!;

  it('rejects cursors after DOM mutation and never mixes page versions', async () => {
    const { page, tools } = await fixture();
    try {
      const first = await read(tools, { tool: 'get_page_text', maxChars: 256 });
      expect(first.truncated).toBe(true);
      expect(first.end).toBe(false);
      const second = await read(tools, {
        tool: 'get_page_text',
        cursor: first.cursor,
        maxChars: 256,
      });
      expect(second.observationRevision).toBe(first.observationRevision);
      expect(second.range).toEqual([256, 512]);
      await page.locator('h1').evaluate((n) => (n.textContent = 'Changed'));
      expect((await tools.execute({ tool: 'get_page_text', cursor: second.cursor })).ok).toBe(
        false,
      );
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('binds refs to observation and invalidates same-label node replacement', async () => {
    const { page, tools } = await fixture();
    try {
      const state = await read(tools, { tool: 'read_page' });
      const ref = refFor(state.tree, 'Query');
      await page.locator('input').evaluate((n) => n.replaceWith(n.cloneNode(true)));
      expect(
        (
          await tools.execute({
            tool: 'type',
            ref,
            text: 'x',
            observationRevision: state.observationRevision,
          })
        ).ok,
      ).toBe(false);
      expect(await page.locator('input').inputValue()).toBe('');
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('keeps resource identity and returns table row/source ranges', async () => {
    const { page, tools } = await fixture();
    try {
      const links = await read(tools, { tool: 'links' });
      expect(links.items[0].url).toBe(`${base}/article?id=42`);
      const tables = await read(tools, { tool: 'tables', start: 0, limit: 1 });
      expect(tables.items[0]).toMatchObject({
        columns: ['Name', 'Price'],
        rows: [['Box', '29']],
        range: [0, 1],
        sourceURL: base + '/',
      });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('reads cross-origin frames and verifies date values in the frame', async () => {
    const { page, tools } = await fixture();
    try {
      const top = await read(tools, { tool: 'read_page' });
      const frame = top.frames.find((f: { sourceURL: string }) => f.sourceURL.endsWith('/frame'));
      const state = await read(tools, { tool: 'read_page', frameId: frame.frameId });
      const result = await tools.execute({
        tool: 'type',
        ref: refFor(state.tree, 'Date'),
        text: '2026-12-31',
        frameId: frame.frameId,
        observationRevision: state.observationRevision,
      });
      expect(result.ok, result.text).toBe(true);
      expect(await page.frames()[1]!.locator('input').inputValue()).toBe('2026-12-31');
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('observes a popup without closing it or navigating the parent', async () => {
    const { page, tools } = await fixture();
    try {
      const state = await read(tools, { tool: 'read_page' });
      const result = await tools.execute({
        tool: 'click',
        ref: refFor(state.tree, 'Popup'),
        observationRevision: state.observationRevision,
      });
      expect(result.ok, result.text).toBe(true);
      expect(page.url()).toBe(base + '/');
      expect(page.context().pages()).toHaveLength(2);
      expect(result.text).toContain('popup');
      expect(result.text).toContain('Catalog');
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });
  it('stops a stagnant infinite list and explicitly marks the unread remainder', async () => {
    const { page, tools } = await fixture();
    try {
      const result = await read(tools, {
        tool: 'scroll_until',
        maxSteps: 3,
        maxMs: 2000,
        maxChars: 256,
      });
      expect(result.truncated).toBe(true);
      expect(['stalled', 'step_limit', 'text_limit']).toContain(result.reason);
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('detects the first JS-rewritten search side effect and stops the rest of the turn', async () => {
    const { page, tools } = await fixture();
    writes = 0;
    try {
      const state = await read(tools, { tool: 'read_page' });
      const ref = refFor(state.tree, 'Query');
      const adapter = {
        create: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'a',
              name: 'type',
              input: {
                ref,
                text: 'x',
                submit: true,
                observationRevision: state.observationRevision,
              },
            },
            {
              type: 'tool_use',
              id: 'b',
              name: 'type',
              input: {
                ref,
                text: 'x',
                submit: true,
                observationRevision: state.observationRevision,
              },
            },
            {
              type: 'tool_use',
              id: 'c',
              name: 'finish',
              input: { status: 'completed', summary: 'done', evidence: 'Order created' },
            },
          ],
        }),
      } as unknown as MessagesAdapter;
      const result = await runUnifiedBrowserLoop({
        intent: 'Search',
        adapter,
        execute: tools.execute,
        observationV2: true,
        maxSteps: 1,
      });
      expect(result.status).toBe('awaiting_user');
      expect(writes).toBe(1); // The first side effect cannot be prevented in advance.
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('pauses the exact review-3 Enter interceptor even when its effect has no DOM or network receipt', async () => {
    const { page, tools } = await fixture();
    try {
      await page.setContent(
        `<form method="get" action="/search" role="search"><input name="q" aria-label="Query" onkeydown="if(event.key==='Enter'){event.preventDefault();window.effects=(window.effects||0)+1}"><button>搜索</button></form>`,
      );
      const state = await read(tools, { tool: 'read_page' });
      const result = await tools.execute({
        tool: 'type',
        ref: refFor(state.tree, 'Query'),
        text: '1',
        submit: true,
        observationRevision: state.observationRevision,
      });
      expect(result.interruption?.reason).toBe('unexpected_effect');
      expect(await page.evaluate(() => (window as unknown as { effects: number }).effects)).toBe(1);
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('refuses a completed claim that invents evidence instead of reading the current page', async () => {
    const { page, tools } = await fixture();
    try {
      let turn = 0;
      const adapter = {
        create: async () => ({
          content:
            ++turn === 1
              ? [{ type: 'tool_use', id: 'r', name: 'read_page', input: {} }]
              : [
                  {
                    type: 'tool_use',
                    id: 'f',
                    name: 'finish',
                    input: {
                      status: 'completed',
                      summary: 'invented',
                      evidence: 'not on this page',
                    },
                  },
                ],
        }),
      } as unknown as MessagesAdapter;
      const result = await runUnifiedBrowserLoop({
        intent: 'Read catalog',
        adapter,
        execute: tools.execute,
        observationV2: true,
        maxSteps: 2,
      });
      expect(result.status).toBe('failed');
    } finally {
      tools.dispose();
      await page.close();
    }
  });
  it('detects a write in the initial request of a new popup', async () => {
    const { page, tools } = await fixture();
    writes = 0;
    try {
      await page.setContent(
        `<form target="_blank" method="get" action="${base}/search" onsubmit="this.method='post';this.action='${base}/write'"><button>Search</button></form>`,
      );
      const state = await read(tools, { tool: 'read_page' });
      const result = await tools.execute({
        tool: 'click',
        ref: refFor(state.tree, 'Search'),
        observationRevision: state.observationRevision,
      });
      expect(writes).toBe(1);
      expect(result.interruption?.reason).toBe('unexpected_effect');
    } finally {
      tools.dispose();
      await page.context().close();
    }
  });
  it('does not discard the first data row of a table without header cells', async () => {
    const { page, tools } = await fixture();
    try {
      await page.setContent(
        '<table><tr><td>Box</td><td>29</td></tr><tr><td>Bag</td><td>10</td></tr></table>',
      );
      const result = await read(tools, { tool: 'tables' });
      expect(result.items[0].rows).toEqual([
        ['Box', '29'],
        ['Bag', '10'],
      ]);
      expect(result.items[0].range).toEqual([0, 2]);
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});
