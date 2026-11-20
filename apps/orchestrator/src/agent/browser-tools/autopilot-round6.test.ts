import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { assessCompletionFacts } from './completion-fields.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/** BROWSER-AUTOPILOT-1 round 5 live findings, fixed in round 6. */
const alerts = {
  text: 'button "Click for JS Alert"\nResult:\nYou successfully clicked an alert',
  sourceURL: 'https://the-internet.herokuapp.com/javascript_alerts',
};
describe('quoted literals (core-10-b reported "You clicked: Ok" for an alert)', () => {
  const assess = (summary: string, extra: Record<string, unknown> = {}) =>
    assessCompletionFacts({ summary, pages: [alerts], ...extra });
  it('blocks a quoted page text that was never on the page', () => {
    expect(assess('Alert → "You clicked: Ok"').contradictions).toHaveLength(1);
  });
  it('accepts a quoted text that was read', () => {
    expect(assess('Alert → "You successfully clicked an alert"').contradictions).toEqual([]);
  });
  it('does not treat the user’s own query or a negated mention as a page claim', () => {
    expect(
      assess('搜索「Playwright tutorial」完成；页面文案并非 "You accepted a JS Alert!"', {
        intent: 'YouTube 搜索「Playwright tutorial」',
      }).contradictions,
    ).toEqual([]);
  });
  it('accepts a quoted host error the model actually saw', () => {
    expect(
      assess(`读取失败："Selector 'body' does not match any element"`, {
        toolTexts: "locator.ariaSnapshot: Selector 'body' does not match any element",
      }).contradictions,
    ).toEqual([]);
  });
});

describe('host facts and titles', () => {
  it('typed values and receipts ground facts even when bound to a page', () => {
    expect(
      assessCompletionFacts({
        summary: '完成',
        fields: [
          { name: 'customer_name', value: 'TestUser', sourceURL: 'https://httpbin.org/forms/post' },
          { name: '文件大小', value: '11 bytes', sourceURL: 'https://dl.test/download' },
        ],
        pages: [
          { text: 'Customer name:', sourceURL: 'https://httpbin.org/forms/post' },
          { text: 'hello.txt', sourceURL: 'https://dl.test/download' },
        ],
        receipts: 'TestUser\nhello.txt | 11 bytes/字节',
      }),
    ).toEqual({ contradictions: [], unverified: [] });
  });
  it('a document title and an h1 with its edit link are the same title', () => {
    expect(
      assessCompletionFacts({
        summary: '页面标题：人工智能 - 维基百科',
        pages: [{ text: 'heading "人工智能 编辑" [level=1]' }],
      }).contradictions,
    ).toEqual([]);
  });
});

describe('live pages', () => {
  it('a ref stays valid when unrelated text on the page changes (carousel, clock)', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://live.test/**', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<p id="clock">0</p><button onclick="this.textContent=\'clicked\'">Go</button><script>let n=0;setInterval(()=>{document.getElementById("clock").textContent=String(++n)},50)</script>',
        }),
      );
      await page.goto('http://live.test/');
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
      try {
        const read = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
        const ref = read.tree.match(/button "Go" \[ref=(e\d+)\]/)?.[1];
        await page.waitForTimeout(300);
        const clicked = await tools.execute({
          tool: 'click',
          ref,
          observationRevision: read.observationRevision,
        } as never);
        expect(clicked.ok, clicked.text).toBe(true);
      } finally {
        tools.dispose();
      }
    } finally {
      await browser.close();
    }
  });
});
