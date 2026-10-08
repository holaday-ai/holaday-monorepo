import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPlaywrightUnifiedExecutor,
  shortenSnapshotUrls,
  shortenUrl,
  snapshotLinks,
} from './playwright-unified-executor.js';
import {
  UNIFIED_BROWSER_TOOLS,
  UNIFIED_BROWSER_TOOL_NAMES,
  UnifiedToolInputError,
  isMutatingBrowserAction,
  parseUnifiedBrowserAction,
} from './unified-tools.js';

const FIXTURE = `<!doctype html><html><head><title>合成商城</title></head><body>
<h1>商品搜索</h1>
<label>关键词 <input id="q" /></label>
<button onclick="document.getElementById('r').textContent='结果：'+document.getElementById('q').value">搜索</button>
<p id="r"></p>
<label>城市 <select id="c"><option value="bj">北京</option><option value="sh">上海</option></select></label>
<table><tr><th>名称</th><th>价格</th></tr><tr><td>收纳盒</td><td>29</td></tr></table>
</body></html>`;

describe('unified browser tool definitions', () => {
  it('exposes one definition per tool name', () => {
    expect(UNIFIED_BROWSER_TOOLS.map((tool) => tool.name)).toEqual([...UNIFIED_BROWSER_TOOL_NAMES]);
  });

  it('parses valid calls and rejects stale or unsafe input with model-readable errors', () => {
    expect(parseUnifiedBrowserAction('type', { ref: 'e3', text: '收纳', submit: true })).toEqual({
      tool: 'type',
      ref: 'e3',
      text: '收纳',
      submit: true,
    });
    expect(() => parseUnifiedBrowserAction('click', { ref: '#q' })).toThrow(UnifiedToolInputError);
    expect(() => parseUnifiedBrowserAction('navigate', { url: 'javascript:alert(1)' })).toThrow(
      UnifiedToolInputError,
    );
    expect(() => parseUnifiedBrowserAction('wait_for', {})).toThrow(UnifiedToolInputError);
    expect(() => parseUnifiedBrowserAction('rm_rf', {})).toThrow(UnifiedToolInputError);
  });

  it('marks only state-changing tools as mutating', () => {
    expect(isMutatingBrowserAction({ tool: 'snapshot' })).toBe(false);
    expect(isMutatingBrowserAction({ tool: 'click', ref: 'e1' })).toBe(true);
  });
});

describe('Playwright unified executor (local static page)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  const refFor = (snapshot: string, pattern: RegExp): string => {
    const line = snapshot.split('\n').find((candidate) => pattern.test(candidate));
    const match = line?.match(/\[ref=(e\d+)\]/);
    if (!match?.[1]) throw new Error(`ref not found for ${pattern}: ${snapshot}`);
    return match[1];
  };

  it('snapshots with refs, types, clicks, selects and extracts', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(FIXTURE);
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 3_000 });
      const first = await tools.execute({ tool: 'snapshot' });
      expect(first.ok).toBe(true);
      expect(first.text).toContain('标题: 合成商城');
      const input = refFor(first.text, /textbox "关键词"/);
      const button = refFor(first.text, /button "搜索"/);
      const select = refFor(first.text, /combobox "城市"/);

      expect((await tools.execute({ tool: 'type', ref: input, text: '收纳' })).ok).toBe(true);
      expect((await tools.execute({ tool: 'click', ref: button })).ok).toBe(true);
      expect((await tools.execute({ tool: 'wait_for', text: '结果：收纳' })).ok).toBe(true);
      expect((await tools.execute({ tool: 'select', ref: select, value: '上海' })).ok).toBe(true);
      expect(await page.locator('#c').inputValue()).toBe('sh');

      const extracted = await tools.execute({
        tool: 'extract',
        instruction: '商品和价格',
        fields: ['名称', '价格'],
      });
      expect(JSON.parse(extracted.text).content).toContain('收纳盒');
      const shot = await tools.execute({ tool: 'screenshot' });
      expect(shot.image?.mediaType).toBe('image/jpeg');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('reports a stale ref without throwing', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(FIXTURE);
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 1_000 });
      const result = await tools.execute({ tool: 'click', ref: 'e9999' });
      expect(result.ok).toBe(false);
      expect(result.text).toMatch(/snapshot/);
    } finally {
      await page.close();
    }
  }, 30_000);
});

describe('snapshot URL shortening (batch 12)', () => {
  it('cuts long link URLs and leaves everything else alone', () => {
    const long = `https://example.com/item?${'utm=x&'.repeat(40)}`;
    const tree = [
      '- link "商品" [ref=e3]:',
      `  - /url: ${long}`,
      '  - /url: https://example.com/short',
      '- text: /url: not a url line',
    ].join('\n');
    const out = shortenSnapshotUrls(tree, 40).split('\n');
    // Tracking query dropped, the item link itself still works.
    expect(out[1]).toBe('  - /url: https://example.com/item');
    expect(out[2]).toBe('  - /url: https://example.com/short');
    expect(out[3]).toBe('- text: /url: not a url line');
    expect(shortenSnapshotUrls(tree, 0)).toBe(tree);
  });
});

describe('snapshot links for grounding (FIX-BATCH-A)', () => {
  it('keeps a usable link when only the query is long, cuts a long path with …', () => {
    expect(shortenUrl(`https://item.jd.com/100.html?bbtf=1&ext=${'x'.repeat(200)}`, 40)).toBe(
      'https://item.jd.com/100.html',
    );
    const longPath = `https://ccc-x.jd.com/dsp/${'a'.repeat(80)}`;
    expect(shortenUrl(longPath, 40)).toBe(`${longPath.slice(0, 40)}…`);
    // A bare host is not a usable item link, so the query stays (cut) instead.
    expect(shortenUrl(`https://jd.com/?${'q'.repeat(80)}`, 40).endsWith('…')).toBe(true);
    expect(shortenUrl('https://a.com/x', 0)).toBe('https://a.com/x');
  });

  it('resolves relative hrefs against the page and adds the form the model saw', () => {
    const tree = [
      '- link "文章" [ref=e3]:',
      '  - /url: /p/4016638963421319',
      '- link "商品" [ref=e4]:',
      `  - /url: //item.jd.com/100.html?bbtf=${'1'.repeat(120)}`,
      '- link "邮件" [ref=e5]:',
      '  - /url: mailto:a@b.c',
    ].join('\n');
    expect(snapshotLinks(tree, 'https://36kr.com/', 100)).toEqual([
      'https://36kr.com/p/4016638963421319',
      `https://item.jd.com/100.html?bbtf=${'1'.repeat(120)}`,
      'https://item.jd.com/100.html',
    ]);
  });
});

describe('unified executor on list pages (FIX-BATCH-A, real Chromium)', () => {
  let browser: Browser;
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      req.url === '/item/1'
        ? '<!doctype html><title>商品 1</title><h1>商品 1 详情</h1><p>¥1498.00</p>'
        : `<!doctype html><title>搜索结果</title>
           <a href="/item/1" target="_blank">降噪耳机 A ¥1498.00</a>
           <a href="/item/2">降噪耳机 B</a><a href="/hidden" style="display:none">隐藏</a>`,
    );
  });
  let base = '';
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('follows a target=_blank click into the controlled page (acceptance A1)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
    const snapshot = await tools.execute({ tool: 'snapshot' });
    expect(snapshot.links).toEqual(expect.arrayContaining([`${base}/item/1`, `${base}/item/2`]));
    const ref = snapshot.text.match(/link "降噪耳机 A[^"]*" \[ref=(e\d+)\]/)?.[1];
    expect(ref).toBeTruthy();
    const clicked = await tools.execute({ tool: 'click', ref: ref as string });
    expect(clicked).toMatchObject({ ok: true, url: `${base}/item/1` });
    expect(clicked.text).toContain('新标签页内容已在当前页打开');
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.title()).toBe('商品 1');
    await page.close();
  }, 60_000);

  it('extract returns visible text links with their URLs', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
    const extracted = await tools.execute({ tool: 'extract', instruction: '商品链接' });
    const payload = JSON.parse(extracted.text) as { links: Array<{ text: string; url: string }> };
    expect(payload.links).toEqual([
      { text: '降噪耳机 A ¥1498.00', url: `${base}/item/1` },
      { text: '降噪耳机 B', url: `${base}/item/2` },
    ]);
    expect(extracted.links).toEqual(expect.arrayContaining([`${base}/item/1`, `${base}/item/2`]));
    await page.close();
  }, 60_000);
});
