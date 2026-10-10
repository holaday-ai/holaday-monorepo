import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPlaywrightUnifiedExecutor,
  shortenSnapshotUrls,
  shortenUrl,
  snapshotLinks,
  yamlScalar,
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
    const long = `https://example.com/item?${'utm_source=x&'.repeat(40)}`;
    const tree = [
      '- link "商品" [ref=e3]:',
      `  - /url: ${long}`,
      '  - /url: https://example.com/short',
      '- text: /url: not a url line',
    ].join('\n');
    const out = shortenSnapshotUrls(tree, 40).split('\n');
    // Tracking query dropped, the item link itself still works.
    // Only tracking parameters were long; the item link itself is kept whole.
    expect(out[1]).toBe('  - /url: https://example.com/item');
    expect(out[2]).toBe('  - /url: https://example.com/short');
    expect(out[3]).toBe('- text: /url: not a url line');
    expect(shortenSnapshotUrls(tree, 0)).toBe(tree);
  });
});

describe('snapshot links for grounding (FIX-BATCH-A)', () => {
  it('drops only tracking parameters; a resource id in the query survives', () => {
    // PR #247 review P1: ?id=42 used to be cut off with the whole query.
    const article = `https://news.example.test/article?id=42&utm_source=${'x'.repeat(120)}`;
    expect(shortenUrl(article, 100)).toBe('https://news.example.test/article?id=42');
    expect(shortenUrl('https://a.test/p/1?spm=a.b#top', 100)).toBe('https://a.test/p/1');
    expect(shortenUrl('https://app.test/#/item/42', 100)).toBe('https://app.test/#/item/42');
    expect(shortenUrl('https://a.test/x?utm_source=1', 0)).toBe('https://a.test/x?utm_source=1');
  });

  it('cuts, never re-routes, a link whose meaningful part is too long', () => {
    const signed = `https://cdn.example.test/v.mp4?sign=${'s'.repeat(120)}&expires=1791400000`;
    expect(shortenUrl(signed, 60)).toBe(`${signed.slice(0, 60)}…`);
    const opaque = `https://news.example.test/article?id=42&tracking=${'t'.repeat(120)}`;
    expect(shortenUrl(opaque, 100)).toBe(`${opaque.slice(0, 100)}…`);
  });

  it('records the page URL without tracking parameters, never a cut display form', () => {
    const signed = `/v.mp4?sign=${'s'.repeat(120)}&expires=1&utm_medium=share`;
    const tree = [
      '- link "文章" [ref=e3]:',
      '  - /url: /p/4016638963421319?spm=a.b#comments',
      '- link "视频" [ref=e4]:',
      `  - /url: ${signed}`,
      '- link "邮件" [ref=e5]:',
      '  - /url: mailto:a@b.c',
    ].join('\n');
    const links = snapshotLinks(tree, 'https://36kr.com/', 100);
    expect(links).toEqual([
      'https://36kr.com/p/4016638963421319',
      `https://36kr.com/v.mp4?sign=${'s'.repeat(120)}&expires=1`,
    ]);
    expect(links.some((link) => link.includes('…'))).toBe(false);
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

describe('relative links resolve like the browser (PR #247 review 2, P1-2)', () => {
  let browser: Browser;
  const pages: Record<string, string> = {
    '/news/index':
      '<a href="article?id=42">目录内文章</a><a href="../about">上级页面</a><a href="?id=2">同页参数</a>',
    '/based/page': '<base href="/library/"><a href="item?id=7">base 下的条目</a>',
  };
  const ok = new Set(['/news/article?id=42', '/about', '/news/index?id=2', '/library/item?id=7']);
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const html = pages[req.url ?? ''];
    if (html) res.end(`<!doctype html><title>fixture</title>${html}`);
    else if (ok.has(req.url ?? '')) res.end('ok');
    else {
      res.statusCode = 404;
      res.end('not found');
    }
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

  it.each([
    ['/news/index', ['/news/article?id=42', '/about', '/news/index?id=2']],
    ['/based/page', ['/library/item?id=7']],
  ])(
    'on %s the shown link, the evidence and the browser target agree',
    async (path, expected) => {
      const page = await browser.newPage();
      await page.goto(`${base}${path}`);
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
      const snapshot = await tools.execute({ tool: 'snapshot' });
      const shown = [...snapshot.text.matchAll(/- \/url: (\S+)/g)].map((match) => match[1]);
      const browserTargets = await page.$$eval('a[href]', (anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
      );
      const want = expected.map((suffix) => `${base}${suffix}`);
      expect(shown).toEqual(want);
      expect(browserTargets).toEqual(want);
      expect(snapshot.links).toEqual(want);
      const extracted = await tools.execute({ tool: 'extract', instruction: '链接' });
      expect(extracted.links).toEqual(want);
      for (const url of want) expect((await fetch(url)).status).toBe(200);
      await page.close();
    },
    60_000,
  );
});

it('reads YAML-quoted snapshot URLs as their scalar value', () => {
  expect(yamlScalar('"?id=2"')).toBe('?id=2');
  expect(yamlScalar("'a''b'")).toBe("a'b");
  expect(yamlScalar('/plain?x=1')).toBe('/plain?x=1');
});
