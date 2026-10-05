import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPlaywrightUnifiedExecutor,
  shortenSnapshotUrls,
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
    expect(out[1]).toBe(`  - /url: ${long.slice(0, 40)}…`);
    expect(out[2]).toBe('  - /url: https://example.com/short');
    expect(out[3]).toBe('- text: /url: not a url line');
    expect(shortenSnapshotUrls(tree, 0)).toBe(tree);
  });
});
