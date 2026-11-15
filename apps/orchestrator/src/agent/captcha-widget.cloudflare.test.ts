import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captchaWidgetState, captchaWidgetStateCdp } from './captcha-widget.js';
import { cloudflareChallengePage } from './fixtures/cloudflare-challenge.js';

/**
 * G2e: a Cloudflare security check (「Performing security verification … Verify you are human」)
 * puts its Turnstile iframe inside a CLOSED shadow root — document.querySelectorAll('iframe')
 * never sees it, so the screen was not zoomed onto the box. The page and the provider frame are
 * served locally (challenges.cloudflare.com is routed to a fixture, nothing leaves the machine).
 */

/** The challenge page, checking its frame really is out of the document's reach. */
async function challengePage(page: Page): Promise<void> {
  await cloudflareChallengePage(page);
  expect(await page.evaluate(() => document.querySelectorAll('iframe').length)).toBe(0);
}

const BOX = { x: 120, y: 240, width: 300, height: 65 };

// Without and with site isolation (the frame in the page's process, or out of it).
describe.each([
  ['same-process frame', [] as string[]],
  ['out-of-process frame (site isolation)', ['--site-per-process']],
])('Cloudflare check, %s', (_name, args) => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args });
  });
  afterAll(async () => {
    await browser.close();
  });

  for (const via of ['playwright', 'cdp'] as const) {
    it(`${via}: the Turnstile box in a closed shadow root is found with its rect; its own response passes it`, async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      // Another tab on the same check: its frame must not be taken for this page's.
      const other = await context.newPage();
      await challengePage(other);
      await other.evaluate(() => {
        document.getElementById('challenge-stage')!.style.cssText =
          'position:absolute;left:700px;top:500px';
      });
      const page = await context.newPage();
      try {
        await challengePage(page);
        const session = via === 'cdp' ? await context.newCDPSession(page) : null;
        const read = () => (session ? captchaWidgetStateCdp(session) : captchaWidgetState(page));
        await expect
          .poll(read, { timeout: 5000 })
          .toEqual({ known: true, unpassed: true, passed: false, box: BOX });
        // The person passes it: Turnstile writes its token into the box's own field.
        await page.evaluate(() => {
          (document.getElementById('cf-chl-widget-a1b2c_response') as HTMLInputElement).value =
            '0.'.padEnd(300, 'x');
        });
        expect(await read()).toEqual({ known: true, unpassed: false, passed: true, box: null });
      } finally {
        await context.close();
      }
    }, 30000);
  }

  it('a hidden widget (the stage not shown yet) is no box — and not passed either', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      await challengePage(page);
      await page.evaluate(() => {
        document.getElementById('challenge-stage')!.style.opacity = '0';
      });
      const session = await context.newCDPSession(page);
      for (const state of [await captchaWidgetState(page), await captchaWidgetStateCdp(session)])
        expect(state).toEqual({ known: true, unpassed: false, passed: false, box: null });
    } finally {
      await context.close();
    }
  }, 30000);
});
