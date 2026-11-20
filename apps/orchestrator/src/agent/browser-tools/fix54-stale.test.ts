import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/**
 * FIX-54 (local A/B B r2 new-amazon-sg): a read on a tab that is gone threw out of the action
 * gate and ended the task. The gate now looks at the current page; the action itself must then
 * come back as a stale_context error the loop already handles (re-read), never a throw.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe('an action on a tab that is gone', () => {
  it('reports stale_context instead of throwing', async () => {
    const page = await browser.newPage();
    await page.setContent('<h1>Item</h1>');
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const read = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const r = await tools.execute({
        tool: 'read_page',
        tabId: 'tab_00000000-0000-0000-0000-000000000000',
        observationRevision: read.observationRevision,
      } as never);
      expect(r.ok).toBe(false);
      expect(r.errorCode).toBe('stale_context');
      expect(() =>
        tools.observation!.resolve({ tool: 'read_page', tabId: 'tab_gone' } as never),
      ).toThrow('stale_context');
    } finally {
      tools.dispose();
      await page.close();
    }
  }, 30_000);
});
