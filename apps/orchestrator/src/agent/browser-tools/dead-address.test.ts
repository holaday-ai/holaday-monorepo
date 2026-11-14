import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPlaywrightUnifiedExecutor,
  deadAddressHint,
  pageDoesNotExist,
} from './playwright-unified-executor.js';

describe('FIX-61 P1-3: a page that answered 404 is not reopened', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('the second open of Apple’s 404 buy page is refused with where to look instead', async () => {
    const page = await browser.newPage();
    let hits = 0;
    await page.route('https://www.apple.com.cn/**', (route) => {
      hits += 1;
      return route.fulfill({
        status: 404,
        contentType: 'text/html',
        body: '<title>未找到页面</title>',
      });
    });
    try {
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
      const url = 'https://www.apple.com.cn/shop/buy-iphone/iphone-16-pro-max';
      const first = await tools.execute({ tool: 'navigate', url });
      expect(first.text).toContain('HTTP 404');
      expect(first.text).toContain('/shop/buy-iphone');
      const second = await tools.execute({ tool: 'navigate', url: `${url}/` });
      expect(second.ok).toBe(false);
      expect(second.text).toContain('已经返回过 HTTP 404');
      expect(hits).toBe(1);
      tools.dispose();
    } finally {
      await page.close();
    }
  });

  it('复审 #1: a different query is a different page, so it still opens', async () => {
    const page = await browser.newPage();
    const opened: string[] = [];
    await page.route('https://shop.example.com/**', (route) => {
      const url = new URL(route.request().url());
      opened.push(url.search);
      return route.fulfill({
        status: url.searchParams.get('k') === 'a' ? 404 : 200,
        contentType: 'text/html',
        body: '<title>s</title>',
      });
    });
    try {
      const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
      const a = await tools.execute({ tool: 'navigate', url: 'https://shop.example.com/s?k=a' });
      expect(a.text).toContain('HTTP 404');
      const b = await tools.execute({ tool: 'navigate', url: 'https://shop.example.com/s?k=b' });
      expect(b.ok).toBe(true);
      expect(b.text).not.toContain('HTTP');
      const again = await tools.execute({
        tool: 'navigate',
        url: 'https://shop.example.com/s?k=a',
      });
      expect(again.ok).toBe(false);
      expect(opened).toEqual(['?k=a', '?k=b']);
      tools.dispose();
    } finally {
      await page.close();
    }
  });

  it('复审 #1: 403, 429 and 5xx are never recorded — the same address can be opened again', async () => {
    for (const status of [403, 429, 500, 503]) {
      const page = await browser.newPage();
      let hits = 0;
      await page.route('https://busy.example.com/**', (route) => {
        hits += 1;
        return route.fulfill({ status, contentType: 'text/html', body: '<title>x</title>' });
      });
      try {
        const tools = createPlaywrightUnifiedExecutor(page, { actionTimeoutMs: 5_000 });
        const url = 'https://busy.example.com/item/1';
        const first = await tools.execute({ tool: 'navigate', url });
        expect(first.text).toContain(`HTTP ${status}`);
        if (status !== 403) expect(first.text).toContain('过一会儿再打开一次');
        const second = await tools.execute({ tool: 'navigate', url });
        expect(second.ok).toBe(true);
        expect(second.text).not.toContain('已经返回过');
        expect(hits).toBe(2);
        tools.dispose();
      } finally {
        await page.close();
      }
    }
  });

  it('复审 #1: only 404 and 410 mean the page does not exist', () => {
    expect(pageDoesNotExist(404)).toBe(true);
    expect(pageDoesNotExist(410)).toBe(true);
    for (const status of [200, 400, 401, 403, 429, 500, 502, 503]) {
      expect(pageDoesNotExist(status)).toBe(false);
    }
  });

  it('other sites get the general hint', () => {
    expect(deadAddressHint('https://item.example.com/p/1')).toContain('已停售或地址不对');
  });
});
