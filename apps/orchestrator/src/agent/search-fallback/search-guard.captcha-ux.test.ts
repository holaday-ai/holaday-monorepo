import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { runSearchWithFallback } from './search-engine-fallback.js';
import { type SearchProvider, StubSearchProvider } from './search-provider.js';
import { SEARCH_RESULTS_ORIGIN } from './search-results-page.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
const done: SupercarOutcome = { status: 'completed', summary: 'ok', iterations: 1, toolsUsed: [] };

/** One run of the fallback wrapper whose agent opens the given URLs; where each landed. */
async function run(intent: string, navigations: string[], provider: SearchProvider) {
  const context = await browser.newContext();
  await context.route(/^https:\/\/(?:www\.google\.com|www\.bing\.com|cn\.bing\.com)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>engine page</h1>' }),
  );
  const page = await context.newPage();
  const landed: string[] = [];
  const outcome = await runSearchWithFallback(
    {
      taskId: 'cux',
      intent,
      executor: { getPage: async () => page },
      onEvidence: async () => {},
    } as unknown as RunSupercarOptions,
    {
      originalIntent: intent,
      searchProvider: provider,
      searchApiFirst: true,
      stop: () => true,
      run: async () => {
        for (const url of navigations) {
          await page.goto(url, { waitUntil: 'load' });
          await page
            .waitForURL((u) => !/bing|google/.test(u.hostname), { timeout: 3_000 })
            .catch(() => {});
          landed.push(page.url());
        }
        return done;
      },
    },
  );
  await page.goto('https://cn.bing.com/search?q=after');
  const after = page.url();
  await context.close();
  return { landed, after, outcome };
}

describe('CAPTCHA-UX-1 第 1 条: a search that names no engine never opens an engine results page', () => {
  it('the agent opening Bing / Google search for a plain 「搜一下」 lands on the search API page', async () => {
    const { landed, after } = await run(
      '请使用云端浏览器，搜一下 HOLA DAY AI 是什么',
      ['https://cn.bing.com/search?q=HOLA+DAY+AI', 'https://www.google.com/search?q=HOLA'],
      new StubSearchProvider(),
    );
    for (const url of landed) expect(url.startsWith(SEARCH_RESULTS_ORIGIN), url).toBe(true);
    // Only for that run: afterwards an engine page opens as usual.
    expect(after).toBe('https://cn.bing.com/search?q=after');
  });
  it('a task that names an engine keeps its own path (here Bing, named by the person)', async () => {
    const { landed } = await run(
      '请使用云端浏览器，在必应上搜 HOLA DAY AI',
      ['https://cn.bing.com/search?q=HOLA'],
      new StubSearchProvider(),
    );
    expect(landed).toEqual(['https://cn.bing.com/search?q=HOLA']);
  });
  it('an engine home page is left alone', async () => {
    const { landed } = await run(
      '请使用云端浏览器，查一下 HOLA DAY AI',
      ['https://www.bing.com/'],
      new StubSearchProvider(),
    );
    expect(landed).toEqual(['https://www.bing.com/']);
  });
});

describe('DEPLOY-R4 D16: the notice names every provider whose results the run served', () => {
  it('first search by one provider, the agent’s own search answered by another: both are named', async () => {
    let calls = 0;
    const provider: SearchProvider = {
      id: 'search-api:chain',
      get label() {
        return calls <= 1 ? '甲搜索接口' : '乙搜索接口';
      },
      async search(query: string) {
        calls++;
        return [{ title: `${query} ${calls}`, url: `https://example.com/${calls}`, snippet: 's' }];
      },
    };
    const { outcome } = await run(
      '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接',
      ['https://www.google.com/search?q=HOLA+DAY+AI'],
      provider,
    );
    expect(calls).toBe(2);
    expect(outcome.summary).toContain('本次搜索使用 甲搜索接口、乙搜索接口');
  });
  it('one provider throughout: the notice is as before', async () => {
    const { outcome } = await run(
      '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接',
      [],
      new StubSearchProvider(),
    );
    expect(outcome.summary).toMatch(
      /^本次搜索使用 本地测试搜索接口（不是 Google 结果页）。\n\nok$/,
    );
  });
});
