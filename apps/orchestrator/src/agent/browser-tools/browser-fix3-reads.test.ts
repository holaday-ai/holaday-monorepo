import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

it('reads links and tables despite unrelated live DOM updates', async () => {
  const page = await browser.newPage();
  await page.setContent(
    `<div id="clock"></div><a href="https://example.com/a">Article</a><table><tr><th>Name</th></tr><tr><td>Known value</td></tr></table><script>setInterval(()=>document.getElementById('clock').textContent=String(performance.now()),1)</script>`,
  );
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    for (const tool of ['links', 'tables'] as const) {
      const result = await tools.execute({ tool });
      expect(result.ok, result.text).toBe(true);
      expect(result.text).toContain(tool === 'links' ? 'Article' : 'Known value');
    }
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('returns structural headings even when the main snapshot is truncated', async () => {
  const page = await browser.newPage();
  await page.setContent(
    `<h1>Long article</h1><p>${'Long introduction. '.repeat(2500)}</p><h2>First</h2><h2>Second</h2><h2>Third target</h2>`,
  );
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const result = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    expect(result.truncated).toBe(true);
    expect(
      result.headings
        .filter((h: { level: number }) => h.level === 2)
        .map((h: { text: string }) => h.text),
    ).toEqual(['First', 'Second', 'Third target']);
  } finally {
    tools.dispose();
    await page.close();
  }
});

it('reads and paginates the requested section rather than a duplicate table-of-contents label', async () => {
  const page = await browser.newPage();
  await page.setContent(
    '<nav>Third target</nav><p>Introduction</p><h2>First</h2><p>First body</p><h2>Second</h2><p>Second body</p><h2>Third target</h2><p>Actual third section evidence.</p><h2>Fourth</h2><p>Other body</p>',
  );
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const request = { tool: 'get_page_text' as const, section: 3, maxChars: 18 };
    let reply = JSON.parse((await tools.execute(request)).text);
    let body = reply.text;
    while (reply.cursor) {
      reply = JSON.parse(
        (await tools.execute({ tool: 'get_page_text', cursor: reply.cursor, maxChars: 18 })).text,
      );
      body += reply.text;
    }
    expect(body).toContain('Actual third section evidence.');
    expect(body).not.toContain('Introduction');
    expect(body).not.toContain('Other body');
  } finally {
    tools.dispose();
    await page.close();
  }
});
