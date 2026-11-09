import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor, deadAddressHint } from './playwright-unified-executor.js';

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

  it('other sites get the general hint', () => {
    expect(deadAddressHint('https://item.example.com/p/1')).toContain('已停售或地址不对');
  });
});
