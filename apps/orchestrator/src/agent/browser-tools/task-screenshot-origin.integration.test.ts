import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { captureMaskedTaskScreenshot } from '../../../../../packages/browser-driver/src/task-screenshot.js';

it.runIf(process.env.HOLADAY_SCREENSHOT_ORIGIN_PROBE === '1')(
  'refuses an actual foreign iframe without evaluating it or returning an image',
  async () => {
    const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
    try {
      const page = await browser.newPage();
      await page.route('https://granted.example/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<p>Ready</p><iframe src="https://foreign.example/account"></iframe>',
        }),
      );
      await page.route('https://foreign.example/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<p>PRIVATE-UNGRANTED-ACCOUNT</p>',
        }),
      );
      await page.goto('https://granted.example/task');
      await page.frameLocator('iframe').locator('p').waitFor();
      const foreign = page
        .frames()
        .find((frame) => frame.url().startsWith('https://foreign.example/'))!;
      const read = vi.spyOn(foreign, 'evaluate');
      const screenshot = vi.spyOn(page, 'screenshot');
      const cdp = await page.context().newCDPSession(page);
      await expect(
        captureMaskedTaskScreenshot(
          page as unknown as Parameters<typeof captureMaskedTaskScreenshot>[0],
          () => true,
          () => cdp.send('Page.getFrameTree'),
          ['https://granted.example'],
        ),
      ).rejects.toThrow('screenshot_unavailable');
      expect(read).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      await cdp.detach();
    } finally {
      vi.restoreAllMocks();
      await browser.close();
    }
  },
);
