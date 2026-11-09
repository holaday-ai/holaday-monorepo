import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dismissSiteGuide } from './site-guides.js';

describe('FIX-61 P1-7: a site guide layer is acknowledged; a login is never touched', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('presses Douyin’s 「我知道了」 under the scroll guide', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <header><a>登录</a></header>
        <div id="guide" style="position:fixed;inset:0">
          <div><p>滚动“鼠标”或点按“键盘上下键”查看更多推荐视频</p><p>同时支持点击屏幕上的「上下按钮」切换视频</p>
          <div onclick="document.getElementById('guide').remove()">我知道了</div></div>
        </div>`);
      expect(await dismissSiteGuide(page, 'https://www.douyin.com/video/1')).toBe('我知道了');
      expect(await page.locator('#guide').count()).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('leaves a login dialog alone, and other sites alone', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <div id="login"><p>扫码登录抖音，或使用手机号登录</p>
        <div onclick="document.getElementById('login').remove()">我知道了</div></div>`);
      expect(await dismissSiteGuide(page, 'https://www.douyin.com/video/1')).toBeNull();
      expect(await page.locator('#login').count()).toBe(1);
      await page.setContent('<div><p>guide</p><div id="b" onclick="this.remove()">我知道了</div></div>');
      expect(await dismissSiteGuide(page, 'https://www.example.com/')).toBeNull();
      expect(await page.locator('#b').count()).toBe(1);
    } finally {
      await page.close();
    }
  });
});
