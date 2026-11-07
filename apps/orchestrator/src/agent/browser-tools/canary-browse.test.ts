import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OBSERVATION_STATE_EXPRESSION } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

describe('canary observation diagnostics', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it('runs the observation collector when a TS runtime injects function-name helpers', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<h1>Visible evidence</h1>');
      const injected = OBSERVATION_STATE_EXPRESSION.replace(
        'return (',
        'return (__name(() => 0, "probe"), ',
      );
      expect(await page.evaluate(injected)).toMatchObject({
        text: 'Visible evidence',
        sensitive: false,
      });
    } finally {
      await page.close();
    }
  });
  it('keeps evaluation failures distinct from stale refs and strips private diagnostic content', async () => {
    const page = await browser.newPage();
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const evaluate = vi
      .spyOn(page.mainFrame(), 'evaluate')
      .mockRejectedValue(
        new Error(
          'frame.evaluate: ReferenceError: __name is not defined https://user:pass@example.com/?token=secret Authorization: Bearer topsecret\n at private stack',
        ),
      );
    try {
      const result = await tools.execute({ tool: 'navigate', url: 'https://example.com' });
      expect(result).toMatchObject({ ok: false, errorCode: 'observation_evaluation_failed' });
      expect(result.errorMessage).toContain('__name is not defined');
      expect(JSON.stringify(result)).not.toMatch(
        /user:pass|token=secret|topsecret|private stack|已失效/,
      );
      expect(page.url()).toBe('about:blank');
    } finally {
      evaluate.mockRestore();
      tools.dispose();
      await page.close();
    }
  });
  it('only reports stale context for an actual foreign tab and preserves real stale revisions', async () => {
    const page = await browser.newPage();
    await page.setContent('<button>Go</button>');
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      expect(await tools.execute({ tool: 'read_page', tabId: 'foreign' })).toMatchObject({
        ok: false,
        errorCode: 'stale_context',
      });
      const read = await tools.execute({ tool: 'read_page' });
      expect(read.ok).toBe(true);
      const meta = JSON.parse(read.text);
      await page.locator('button').evaluate((el) => el.setAttribute('disabled', ''));
      expect(
        await tools.execute({
          tool: 'click',
          ref: 'e1',
          tabId: meta.tabId,
          frameId: meta.frameId,
          observationRevision: meta.observationRevision,
        }),
      ).toMatchObject({ ok: false, errorCode: 'stale_ref' });
    } finally {
      tools.dispose();
      await page.close();
    }
  });
});
