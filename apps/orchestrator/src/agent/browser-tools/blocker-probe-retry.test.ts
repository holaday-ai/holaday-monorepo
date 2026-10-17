import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { probeBrowserBlocker } from './browser-blocker-probe.js';

/** ACCEPT-283-R6 (R5 core-08-b): a probe that ran into a navigation reads the page again. */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

async function pageWhoseProbe(failures: number) {
  const page = await browser.newPage();
  await page.setContent('<main><h1>Date input</h1><input type="date"></main>');
  const frame = page.mainFrame();
  const evaluate = frame.evaluate.bind(frame);
  let calls = 0;
  Object.assign(frame, {
    evaluate: (...args: Parameters<typeof frame.evaluate>) =>
      calls++ < failures
        ? Promise.reject(
            new Error('Execution context was destroyed, most likely because of a navigation'),
          )
        : evaluate(...args),
  });
  return page;
}

it('a context destroyed by a navigation is read again, not reported as unreadable', async () => {
  const page = await pageWhoseProbe(1);
  expect(await probeBrowserBlocker(page)).toBeNull();
  await page.close();
});

it('a page that stays unreadable is still reported', async () => {
  const page = await pageWhoseProbe(99);
  expect(await probeBrowserBlocker(page)).toMatchObject({ reason: 'page_unreadable' });
  await page.close();
});
