import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRuntimeAction } from '../supercar/runtime-action-policy.js';
import { createUnifiedActionGate } from './unified-action-gate.js';

/**
 * FIX-35 (BENCH-1 p02 rerun): the model clicked amazon's 「Continue shopping」 interstitial,
 * which posted {token, continueClick} to /checkpoint/validate before the pause. A click or
 * Enter that would submit to the site's own verification step is handed over before it runs.
 */

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

function gateFor(page: Page, reply: string | null = '已验证') {
  const park = vi.fn(async (_question: string, _kind: string) => reply);
  return {
    park,
    gate: createUnifiedActionGate({
      page,
      onBeforeAction: classifyRuntimeAction,
      labelForRef: () => null,
      park,
      aborted: () => false,
    }),
  };
}

async function refOf(page: Page, pattern: RegExp): Promise<string> {
  const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' } as never);
  const ref = tree
    .split('\n')
    .find((line) => pattern.test(line))
    ?.match(/\[ref=(\w+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern} in ${tree}`);
  return ref;
}

const FORM = (action: string) => `
  <form method="post" action="${action}" onsubmit="window.sent=(window.sent||0)+1;return false">
    <input type="hidden" name="token" value="t">
    <input name="field-keywords" aria-label="Type characters">
    <button type="submit" name="continueClick">Continue shopping</button>
  </form>`;

const sent = (page: Page) => page.evaluate(() => (window as { sent?: number }).sent ?? 0);

describe('FIX-35 verification step is handed over before the action runs', () => {
  it('hands over a click on the checkpoint 「Continue shopping」 button without submitting', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park).toHaveBeenCalledTimes(1);
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(park.mock.calls[0]?.[0]).toContain('amazon.com');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('resolves a relative form action against the amazon page (as served there)', async () => {
    const page = await browser.newPage();
    // Served locally under the real address; nothing goes out.
    await page.route('https://www.amazon.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: FORM('/checkpoint/validate') }),
    );
    await page.goto('https://www.amazon.com/s?k=usb+c+cable');
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('hands over Enter in a field whose form posts to validateCaptcha', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.sg/errors/validateCaptcha'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'type', ref: await refOf(page, /Type characters/), text: 'abc', submit: true },
      'before',
    );
    expect(park.mock.calls[0]?.[1]).toBe('captcha');
    expect(decision).toMatchObject({ kind: 'skip' });
    expect(await sent(page)).toBe(0);
    await page.close();
  });

  it('stops as awaiting_user when nobody takes over', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate } = gateFor(page, null);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'before',
    );
    expect(decision).toMatchObject({ kind: 'stop', outcome: { status: 'awaiting_user' } });
    await page.close();
  });

  it('does not treat an ordinary amazon form (search) as a verification step', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/s'));
    const { gate, park } = gateFor(page);
    await gate({ tool: 'click', ref: await refOf(page, /Continue shopping/) }, 'before');
    expect(park.mock.calls.some((call) => call[1] === 'captcha')).toBe(false);
    await page.close();
  });

  it('only judges before the action, never after it', async () => {
    const page = await browser.newPage();
    await page.setContent(FORM('https://www.amazon.com/checkpoint/validate'));
    const { gate, park } = gateFor(page);
    const decision = await gate(
      { tool: 'click', ref: await refOf(page, /Continue shopping/) },
      'after',
    );
    expect(park).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ kind: 'proceed' });
    await page.close();
  });
});
