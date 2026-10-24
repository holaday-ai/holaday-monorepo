import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/** ACCEPT-283-R6 (BBC core-07): opening an observed link in a new tab when the middle click cannot. */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

async function openInNewTab(home: string) {
  const context = await browser.newContext();
  await context.route('http://site.test/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: 'text/html',
      body: path === '/article' ? '<title>Article</title><h1>Article body</h1>' : home,
    });
  });
  const page = await context.newPage();
  await page.goto('http://site.test/');
  const tools = createPlaywrightUnifiedExecutor(page, {
    observationV2: true,
    actionTimeoutMs: 8_000,
  });
  try {
    const observed = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const ref = /link "Read the article" \[ref=(e\d+)\]/.exec(observed.tree)?.[1];
    const result = await tools.execute({
      tool: 'click',
      ref: ref!,
      newTab: true,
      observationRevision: observed.observationRevision,
      tabId: observed.tabId,
      frameId: observed.frameId,
    } as never);
    return { result, pages: context.pages().length, first: page.url() };
  } finally {
    tools.dispose();
    await context.close();
  }
}

describe('click newTab on an observed link', () => {
  it('opens the link itself when an overlay keeps the middle click from landing', async () => {
    const { result, pages, first } = await openInNewTab(
      '<a href="/article">Read the article</a><div style="position:fixed;inset:0;z-index:9;background:transparent"></div>',
    );
    expect(result.ok, result.text).toBe(true);
    expect(result.openedTab).toBe(true);
    expect(result.url).toBe('http://site.test/article');
    expect(pages).toBe(2);
    expect(first).toBe('http://site.test/');
  }, 30_000);

  it('reports the opened page, not its initial about:blank', async () => {
    const { result } = await openInNewTab('<a href="/article">Read the article</a>');
    expect(result.ok, result.text).toBe(true);
    expect(result.url).toBe('http://site.test/article');
  }, 30_000);
});
