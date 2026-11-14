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

it('复审 P0: not seeing a box is never "passed" — the box below the fold with no response is still a wall', async () => {
  const page = await demoPage();
  try {
    await page.evaluate(() => {
      document.getElementById('anchor')!.style.cssText = 'position:absolute;top:5000px';
    });
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
  } finally {
    await page.close();
  }
}, 30000);

it('复审 P0: a Cloudflare check with a Turnstile field (no box in the document) keeps its rules', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.route('https://cf.fixture.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Just a moment...</title><body><div id="challenge-running">Checking your browser before accessing the site.</div><input type="hidden" name="cf-turnstile-response" value=""></body>',
      }),
    );
    await page.goto('https://cf.fixture.test/');
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
  } finally {
    await page.close();
  }
}, 30000);

it('复审 P1-2: an invisible reCAPTCHA badge with its own response does not clear the demo page box', async () => {
  const page = await demoPage();
  try {
    await page.evaluate(() => {
      const f = document.createElement('iframe');
      f.src = 'https://www.google.com/recaptcha/api2/anchor?k=v3&size=invisible';
      f.style.cssText = 'width:256px;height:60px;border:0;position:fixed;right:0;bottom:0';
      document.body.appendChild(f);
    });
    // The visible box is not done; the badge is no box to do and does not count as one.
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
  } finally {
    await page.close();
  }
}, 30000);

it('复审 #2 P1-2: a v3 token filled elsewhere on the page does not answer the visible box still to tick', async () => {
  const page = await demoPage();
  try {
    await page.evaluate(() => {
      const holder = document.createElement('div');
      holder.innerHTML =
        '<iframe src="https://www.google.com/recaptcha/api2/anchor?k=v3&size=invisible" style="width:256px;height:60px;border:0"></iframe>' +
        '<textarea name="g-recaptcha-response" style="display:none"></textarea>';
      document.body.appendChild(holder);
      (holder.querySelector('textarea') as HTMLTextAreaElement).value = 'v'.repeat(400);
    });
    expect((await probeBrowserBlocker(page))?.reason).toBe('captcha');
    // The visible box's own field filled: passed.
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
