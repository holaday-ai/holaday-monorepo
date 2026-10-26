import { readLoginContext } from '@holaday/shared-types';
import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { probeBrowserBlocker } from './browser-blocker-probe.js';
import { LOGIN_POPUP_NOTICE } from './full-page-read.js';

/**
 * FIX-38 #3 (Deploy-38 b-m01, `deploy38/wall-evidence/b-m01.png`): Gaode's login popup as
 * read on www.amap.com on 2026-10-27 — a plain full-screen `position:fixed` mask (z-index
 * 10000, transparent, no role=dialog) holding an absolute white box: 短信登录, 手机号码, an Aliyun
 * slider 「请按住滑块，拖动到最右边」, 发送验证码, 立即登录 and the 「我已阅读并同意《服务条款》
 * 《隐私政策》」 line. The page behind is readable (text and links), so neither the dialog
 * regions nor the whole-page text saw it.
 */
const PAGE_BEHIND = `<main><h1>高德地图</h1>${Array.from(
  { length: 24 },
  (_, i) => `<a href="/place/${i}">杭州景点 ${i}：西湖、灵隐寺、宋城、西溪湿地等热门地点的路线与周边信息</a>`,
).join('<br>')}</main>`;
const popup = (slider: boolean) => `<!doctype html><meta charset="utf-8"><title>高德地图</title>
${PAGE_BEHIND}
<div class="mask--jss-0-16" style="position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0)">
  <div class="root--jss-0-9 lbs-passport-modal" style="position:absolute;left:190px;top:150px;width:900px;height:500px;background:#fff">
    <span class="close" role="button" aria-label="关闭" onclick="this.closest('.mask--jss-0-16').remove()">×</span>
    <div>短信登录 二维码登录</div>
    <form>
      <input id="phone" placeholder="手机号码">
      ${slider ? '<div class="aliyunCaptcha-sliding"><span id="aliyunCaptcha-sliding-text">请按住滑块，拖动到最右边</span></div>' : ''}
      <input id="code" placeholder="短信验证码"><button type="button" id="send">发送验证码</button>
      <button type="button" id="login">立即登录</button>
    </form>
    <div>我已阅读并同意 《高德服务条款》《高德地图基本功能隐私政策》；未注册的手机号将自动注册</div>
  </div>
</div>`;

describe('FIX-38 #3 · Gaode: a full-screen login mask is a popup; with a slider it is a captcha', () => {
  let browser: Browser;
  const saved = process.env.BROWSER_FULL_PAGE_READ;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BROWSER_FULL_PAGE_READ;
    else process.env.BROWSER_FULL_PAGE_READ = saved;
  });

  const open = async (html: string) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('https://www.amap.com/**', (r) =>
      r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
    );
    await page.goto('https://www.amap.com/');
    return page;
  };

  it('the slider popup hands over as a captcha (never 「回车提交什么」, never typed into)', async () => {
    const page = await open(popup(true));
    try {
      const hit = await probeBrowserBlocker(page, '高德地图查一下杭州东站到西湖断桥怎么走，大概多久');
      expect(hit).toMatchObject({ reason: 'captcha' });
      expect((hit as { disposition?: string }).disposition).toBeUndefined();
      // Its boxes and buttons stay out of the AI's hands.
      const read = (css: string) => page.locator(css).evaluate(readLoginContext, false);
      expect((await read('#phone')).loginField).toBe(true);
      expect((await read('#send')).loginControl).toBe(true);
      expect((await read('#login')).loginControl).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('an SMS-only popup is a login popup the AI may close first (FIX-36 #9)', async () => {
    const page = await open(popup(false));
    try {
      expect(await probeBrowserBlocker(page)).toMatchObject({
        reason: 'login',
        disposition: 'continue',
        message: LOGIN_POPUP_NOTICE,
      });
      await page.click('.close');
      expect(await probeBrowserBlocker(page)).toBeNull();
    } finally {
      await page.close();
    }
  });

  it.each([
    [
      'a full-screen app shell with no box on top',
      `<div style="position:fixed;inset:0;z-index:1">${PAGE_BEHIND}<a href="/login">登录</a></div>`,
    ],
    [
      'a cookie bar along the bottom',
      `${PAGE_BEHIND}<div style="position:fixed;left:0;right:0;bottom:0;height:80px;z-index:9999;background:#fff">本站使用 cookie，继续浏览即表示同意隐私条款 <button>同意</button></div>`,
    ],
    [
      'a big fixed promo layer that asks nothing',
      `${PAGE_BEHIND}<div style="position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.5)"><div style="margin:20% auto;width:300px;background:#fff">双十一地图新功能上线 <button>知道了</button></div></div>`,
    ],
  ])('reverse: %s is no wall', async (_label, body) => {
    const page = await open(`<!doctype html><meta charset="utf-8"><title>高德地图</title>${body}`);
    try {
      expect(await probeBrowserBlocker(page)).toBeNull();
    } finally {
      await page.close();
    }
  });

  it('reverse: a cookie banner is still not a blocking popup', async () => {
    const page = await open(
      `<!doctype html><meta charset="utf-8"><title>x</title>${PAGE_BEHIND}<div role="dialog" style="position:fixed;inset:30%;background:#fff">我们使用 cookie 并请您同意隐私条款 <button>同意</button></div>`,
    );
    try {
      expect(await probeBrowserBlocker(page)).toBeNull();
    } finally {
      await page.close();
    }
  });
});
