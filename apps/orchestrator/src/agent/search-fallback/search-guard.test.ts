import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { runSearchWithFallback } from './search-engine-fallback.js';
import { StubSearchProvider } from './search-provider.js';
import { SEARCH_RESULTS_ORIGIN, engineResultsQuery } from './search-results-page.js';

/** SEARCH-GUARD-1: with the search API first, the agent never opens an engine's results page. */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});
const intent = '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接';
const done: SupercarOutcome = { status: 'completed', summary: 'ok', iterations: 1, toolsUsed: [] };

describe('engine results pages', () => {
  it('are the web results and walls, not home pages or verticals', () => {
    expect(engineResultsQuery('https://www.google.com/search?q=a+b')).toBe('a b');
    expect(engineResultsQuery('https://www.google.co.uk/search?q=x')).toBe('x');
    expect(
      engineResultsQuery(
        'https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3DHOLA',
      ),
    ).toBe('HOLA');
    expect(engineResultsQuery('https://cn.bing.com/search?q=y')).toBe('y');
    expect(engineResultsQuery('https://html.duckduckgo.com/html/?q=z')).toBe('z');
    for (const url of [
      'https://www.google.com/',
      'https://www.google.com/maps/search/coffee',
      'https://www.google.com/search?q=shoes&tbm=shop',
      'https://www.google.com/search?q=cats&udm=2',
      'https://www.google.com/travel/flights',
      'https://www.bing.com/',
      'https://example.com/search?q=x',
    ])
      expect(engineResultsQuery(url), url).toBeNull();
  });
});

describe('the search guard while the API answers', () => {
  async function run(navigations: string[], provider = new StubSearchProvider()) {
    const context = await browser.newContext();
    // A stand-in for the real engines: whatever the guard lets through lands here.
    await context.route(/^https:\/\/(?:www\.google\.com|www\.bing\.com)\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>engine page</h1>' }),
    );
    const page = await context.newPage();
    const landed: Array<{ url: string; text: string }> = [];
    const evidence: string[] = [];
    await runSearchWithFallback(
      {
        taskId: 'guard',
        intent,
        executor: { getPage: async () => page },
        onEvidence: async (e: { fact: string }) => {
          evidence.push(e.fact);
        },
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
              .waitForURL(
                (u) =>
                  !u.href.includes('/search?q=') ||
                  u.origin === SEARCH_RESULTS_ORIGIN ||
                  !/google|bing/.test(u.hostname),
                { timeout: 5_000 },
              )
              .catch(() => {});
            landed.push({ url: page.url(), text: await page.locator('body').innerText() });
          }
          return done;
        },
      },
    );
    // After the search the guard is gone: an engine page opens normally.
    await page.goto('https://www.google.com/search?q=after');
    const after = page.url();
    await context.close();
    return { landed, evidence, after };
  }

  it('sends an engine results page to the API results page, saying so', async () => {
    const { landed, evidence, after } = await run([
      'https://www.google.com/search?q=other+query',
      'https://www.bing.com/search?q=bing+query',
    ]);
    expect(landed[0]!.url).toBe(`${SEARCH_RESULTS_ORIGIN}/search?q=other%20query`);
    expect(landed[0]!.text).toContain('已改用搜索接口结果页');
    expect(landed[0]!.text).toContain('other query result 1');
    expect(landed[1]!.url).toBe(`${SEARCH_RESULTS_ORIGIN}/search?q=bing%20query`);
    expect(evidence).toContain('web_search_url=https://example.com/other%20query/1');
    expect(after).toBe('https://www.google.com/search?q=after');
  }, 30_000);

  it('leaves the engine home page, Maps and Shopping alone', async () => {
    const { landed } = await run([
      'https://www.google.com/',
      'https://www.google.com/maps/search/coffee',
      'https://www.google.com/search?q=shoes&tbm=shop',
    ]);
    expect(landed.map((l) => l.url)).toEqual([
      'https://www.google.com/',
      'https://www.google.com/maps/search/coffee',
      'https://www.google.com/search?q=shoes&tbm=shop',
    ]);
    expect(landed.every((l) => l.text.includes('engine page'))).toBe(true);
  }, 30_000);

  it('opens the engine when the API has nothing for that query', async () => {
    const provider = new StubSearchProvider((q) =>
      q === 'nothing'
        ? []
        : [{ title: `${q} hit`, url: `https://example.com/${encodeURIComponent(q)}` }],
    );
    const { landed } = await run(['https://www.google.com/search?q=nothing'], provider);
    expect(landed[0]!.url).toBe('https://www.google.com/search?q=nothing');
  }, 30_000);
});

describe('a failed API call (SEARCH-GUARD-1 s282-D16)', () => {
  it('is retried once before the engine is used', async () => {
    let calls = 0;
    const provider = {
      id: 'search-api:flaky',
      label: '测试接口',
      search: async (query: string) => {
        calls++;
        if (calls === 1) throw new Error('search_api_http_503');
        return [{ title: `${query} hit`, url: 'https://example.com/hit' }];
      },
    };
    const context = await browser.newContext();
    const page = await context.newPage();
    const events: Array<{ reason: string; phase: string }> = [];
    let intentSeen = '';
    await runSearchWithFallback(
      {
        taskId: 'flaky',
        intent,
        executor: { getPage: async () => page },
      } as unknown as RunSupercarOptions,
      {
        originalIntent: intent,
        searchProvider: provider,
        searchApiFirst: true,
        stop: () => true,
        onFallback: async (e) => {
          events.push(e as never);
        },
        run: async (a) => {
          intentSeen = a.intent;
          return done;
        },
      },
    );
    await context.close();
    expect(calls).toBe(2);
    expect(intentSeen).toContain('【搜索接口】');
    expect(events.map((e) => e.phase)).toEqual(['started', 'completed']);
  }, 30_000);

  it('a provider that keeps failing is recorded, and the engine path runs', async () => {
    const provider = {
      id: 'search-api:down',
      label: '测试接口',
      search: async () => {
        throw new Error('search_api_http_503');
      },
    };
    const context = await browser.newContext();
    const page = await context.newPage();
    const events: Array<{ reason: string; phase: string }> = [];
    let intentSeen = '';
    await runSearchWithFallback(
      {
        taskId: 'down',
        intent,
        executor: { getPage: async () => page },
      } as unknown as RunSupercarOptions,
      {
        originalIntent: intent,
        searchProvider: provider,
        searchApiFirst: true,
        stop: () => true,
        onFallback: async (e) => {
          events.push(e as never);
        },
        run: async (a) => {
          intentSeen = a.intent;
          return done;
        },
      },
    );
    await context.close();
    expect(events).toEqual([
      expect.objectContaining({ reason: 'search_api_first', phase: 'failed' }),
    ]);
    expect(intentSeen).toBe(intent);
  }, 30_000);
});
