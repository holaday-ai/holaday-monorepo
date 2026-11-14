import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { probeBrowserBlocker } from './browser-blocker-probe.js';

/**
 * CAPTCHA-UX-1（协调方追加）: the captcha wall is judged by the box on the page, not the address.
 * Real Chromium; the provider's frames and the demo page are served locally.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

const DEMO = `<!doctype html><title>ReCAPTCHA demo</title><body>
<h1>reCAPTCHA demo: Simple page</h1>
<form><div class="g-recaptcha">
<iframe id="anchor" title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=fixture" style="width:304px;height:78px;border:0"></iframe>
<textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
</div><input type="submit"></form>
<div id="wrap" style="visibility:hidden;position:absolute;left:10px;top:120px"><iframe title="recaptcha challenge" src="https://www.google.com/recaptcha/api2/bframe?k=fixture" style="width:400px;height:580px;border:0"></iframe></div>
</body>`;

async function demoPage(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('https://www.google.com/recaptcha/api2/demo', (route) =>
    route.fulfill({ contentType: 'text/html', body: DEMO }),
  );
  await page.route('https://www.google.com/recaptcha/api2/{anchor,bframe}*', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<body>box</body>' }),
  );
  await page.goto('https://www.google.com/recaptcha/api2/demo');
  return page;
}

it('the demo page (its address contains /recaptcha): a wall while the box is to be done, none once it is passed', async () => {
  const page = await demoPage();
  try {
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
    // The person passes it: the provider writes its response into the page.
    await page.evaluate(() => {
      (document.getElementById('g-recaptcha-response') as HTMLTextAreaElement).value = 'x'.repeat(
        400,
      );
    });
    expect(await probeBrowserBlocker(page)).toBeNull();
  } finally {
    await page.close();
  }
}, 30000);

it('an open image grid is a wall even with an old response on the page', async () => {
  const page = await demoPage();
  try {
    await page.evaluate(() => {
      (document.getElementById('g-recaptcha-response') as HTMLTextAreaElement).value = 'x'.repeat(
        400,
      );
      document.getElementById('wrap')!.style.visibility = 'visible';
    });
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
  } finally {
    await page.close();
  }
}, 30000);

it('a page without a known captcha component keeps the address / text rules (a slider check)', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.route('https://slider.fixture.test/captcha', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>安全验证</title><body><h1>安全验证</h1><p>请拖动滑块完成验证</p><div style="width:300px;height:40px;background:#eee"></div></body>',
      }),
    );
    await page.goto('https://slider.fixture.test/captcha');
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
  } finally {
    await page.close();
  }
}, 30000);
