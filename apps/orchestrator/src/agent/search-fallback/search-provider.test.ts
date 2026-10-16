import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { runSearchWithFallback } from './search-engine-fallback.js';
import {
  BraveSearchProvider,
  QwenWebSearchProvider,
  StubSearchProvider,
  normalizeResults,
  searchProviderFromEnv,
} from './search-provider.js';
import {
  SEARCH_RESULTS_ORIGIN,
  searchResultsHtml,
  serveSearchResults,
} from './search-results-page.js';

/** CAPTCHA-REDUCE-1: search results from an API instead of a google.com page. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('search providers (local stand-ins only, no real key)', () => {
  it('keeps only public http(s) results, deduplicated and trimmed', () => {
    expect(
      normalizeResults(
        [
          { title: '<b>One</b>', url: 'https://a.test/1', snippet: ' x ' },
          { title: 'Dup', url: 'https://a.test/1' },
          { title: 'Script', url: 'javascript:alert(1)' },
          { title: '', url: 'https://a.test/empty' },
          { title: 'Two', url: 'http://b.test/' },
        ],
        5,
      ),
    ).toEqual([
      { title: 'One', url: 'https://a.test/1', snippet: 'x' },
      { title: 'Two', url: 'http://b.test/' },
    ]);
  });
  it('Brave: sends the key as a header and maps web results', async () => {
    const fetchImpl = vi.fn(async (url: URL | string, init?: RequestInit) => {
      expect(String(url)).toContain('q=HOLA+DAY+AI');
      expect((init?.headers as Record<string, string>)['x-subscription-token']).toBe('k');
      return json({
        web: { results: [{ title: 'HOLA', url: 'https://hola.test/', description: 'd' }] },
      });
    });
    const results = await new BraveSearchProvider('k', fetchImpl as never).search('HOLA DAY AI', {
      count: 5,
    });
    expect(results).toEqual([{ title: 'HOLA', url: 'https://hola.test/', snippet: 'd' }]);
  });
  it('Qwen: forces a sourced search and returns its sources, not the model text', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.parameters).toMatchObject({
        enable_search: true,
        search_options: { forced_search: true, enable_source: true },
      });
      return json({
        output: {
          choices: [{ message: { content: 'model prose' } }],
          search_info: {
            search_results: [{ index: 1, title: 'Weather', url: 'https://w.test/sg' }],
          },
        },
      });
    });
    const results = await new QwenWebSearchProvider('k', fetchImpl as never).search('新加坡 天气', {
      count: 5,
    });
    expect(results).toEqual([{ title: 'Weather', url: 'https://w.test/sg' }]);
  });
  it('rejects a failed API call (the fallback then uses another engine)', async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    await expect(
      new BraveSearchProvider('k', fetchImpl as never).search('q', { count: 5 }),
    ).rejects.toThrow('search_api_http_429');
  });
  it('is configured only by name, and never silently without its key', () => {
    expect(searchProviderFromEnv({})).toBeNull();
    expect(searchProviderFromEnv({ BROWSER_SEARCH_API_PROVIDER: 'brave' })).toBeNull();
    expect(
      searchProviderFromEnv({ BROWSER_SEARCH_API_PROVIDER: 'stub', NODE_ENV: 'production' }),
    ).toBeNull();
    expect(searchProviderFromEnv({ BROWSER_SEARCH_API_PROVIDER: 'stub' })?.id).toBe(
      'search-api:stub',
    );
    expect(
      searchProviderFromEnv({ BROWSER_SEARCH_API_PROVIDER: 'brave', BRAVE_SEARCH_API_KEY: 'k' })
        ?.id,
    ).toBe('search-api:brave');
  });
});

describe('GOOGLE-WALL-2: legacy Brave name, mainland Qwen and an ordered chain', () => {
  const braveBody = { web: { results: [{ title: 'Brave hit', url: 'https://brave.example/1' }] } };
  const qwenBody = {
    output: {
      search_info: { search_results: [{ title: 'Qwen hit', url: 'https://qwen.example/1' }] },
    },
  };
  it('reads the early BRAVE_API_KEY, the current name winning', async () => {
    const keys: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      keys.push(String((init?.headers as Record<string, string>)['x-subscription-token']));
      return json(braveBody);
    }) as unknown as typeof fetch;
    await searchProviderFromEnv(
      { BROWSER_SEARCH_API_PROVIDER: 'brave', BRAVE_API_KEY: 'old' },
      fetchImpl,
    )!.search('q', { count: 1 });
    await searchProviderFromEnv(
      { BROWSER_SEARCH_API_PROVIDER: 'brave', BRAVE_API_KEY: 'old', BRAVE_SEARCH_API_KEY: 'new' },
      fetchImpl,
    )!.search('q', { count: 1 });
    expect(keys).toEqual(['old', 'new']);
  });
  it('qwen-cn uses the mainland key and endpoint and says so', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push(`${String(url)} ${(init?.headers as Record<string, string>).authorization}`);
      return json(qwenBody);
    }) as unknown as typeof fetch;
    const provider = searchProviderFromEnv(
      {
        BROWSER_SEARCH_API_PROVIDER: 'qwen-cn',
        DASHSCOPE_CN_API_KEY: 'cn-key',
        DASHSCOPE_INTL_API_KEY: 'intl-key',
      },
      fetchImpl,
    )!;
    expect(await provider.search('q', { count: 1 })).toEqual([
      { title: 'Qwen hit', url: 'https://qwen.example/1' },
    ]);
    expect(calls).toEqual([
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation Bearer cn-key',
    ]);
    expect(provider.id).toBe('search-api:qwen-cn');
    expect(provider.label).toContain('大陆');
    expect(
      searchProviderFromEnv({
        BROWSER_SEARCH_API_PROVIDER: 'qwen-cn',
        DASHSCOPE_INTL_API_KEY: 'k',
      }),
    ).toBeNull();
  });
  it('tries providers in order and names the one that answered', async () => {
    const fetchImpl = vi.fn(async (url: unknown) =>
      String(url).includes('brave') ? json({}, 429) : json(qwenBody),
    ) as unknown as typeof fetch;
    const provider = searchProviderFromEnv(
      {
        BROWSER_SEARCH_API_PROVIDER: 'brave, qwen-cn, engine-fallback',
        BRAVE_API_KEY: 'b',
        DASHSCOPE_CN_API_KEY: 'c',
      },
      fetchImpl,
    )!;
    expect((await provider.search('q', { count: 1 }))[0]?.title).toBe('Qwen hit');
    expect(provider.id).toBe('search-api:qwen-cn');
  });
  it('skips a provider without its key, and fails only when every provider fails', async () => {
    expect(
      searchProviderFromEnv({
        BROWSER_SEARCH_API_PROVIDER: 'brave,qwen-cn',
        DASHSCOPE_CN_API_KEY: 'c',
      })?.id,
    ).toBe('search-api:qwen-cn');
    expect(
      searchProviderFromEnv({ BROWSER_SEARCH_API_PROVIDER: 'brave,qwen-cn,engine-fallback' }),
    ).toBeNull();
    const failing = vi.fn(async () => json({}, 500)) as unknown as typeof fetch;
    await expect(
      searchProviderFromEnv(
        {
          BROWSER_SEARCH_API_PROVIDER: 'brave,qwen-cn',
          BRAVE_API_KEY: 'b',
          DASHSCOPE_CN_API_KEY: 'c',
        },
        failing,
      )!.search('q', { count: 1 }),
    ).rejects.toThrow('search_api_http_500');
  });
});

describe('the results page', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  it('escapes result text and names its source', () => {
    const html = searchResultsHtml({
      query: '<q>',
      label: 'Brave 搜索接口',
      results: [{ title: '<script>x</script>', url: 'https://a.test/?a=1&b="2"' }],
    });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('来源：Brave 搜索接口（不是 Google 结果页）');
  });
  it('is served inside the browser on a host that never resolves', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const served = await serveSearchResults(context, {
      query: 'HOLA DAY AI',
      label: '本地测试搜索接口',
      results: await new StubSearchProvider().search('HOLA DAY AI', { count: 5 }),
    });
    expect(served.url.startsWith(SEARCH_RESULTS_ORIGIN)).toBe(true);
    await page.goto(served.url);
    expect(await page.locator('ol li').count()).toBe(5);
    expect(await page.locator('a').first().getAttribute('href')).toBe(
      'https://example.com/HOLA%20DAY%20AI/1',
    );
    await served.dispose();
    await context.close();
  });
});

describe('a Google wall on a search task goes to the search API, not the user', () => {
  const intent = '请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接';
  const sorry =
    'https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch&q=EgTPlEZqGOfHwtYG';
  const blocked: SupercarOutcome = {
    status: 'awaiting_user',
    question: '验证码',
    iterations: 2,
    toolsUsed: ['navigate'],
  };
  const completed: SupercarOutcome = {
    status: 'completed',
    summary: '1. HOLA',
    iterations: 3,
    toolsUsed: ['read_page'],
  };
  const tick = {
    iteration: 2,
    execution: {
      actionKind: 'browser_blocker',
      actionSummary: '验证墙',
      ok: false,
      errorCode: 'browser_captcha_wall',
      blockerEvidence: {
        frameHost: 'www.google.com',
        framePath: '/sorry/index',
        visible: true,
        rule: 'captcha:url:/sorry/',
        scope: 'document' as const,
      },
    },
    toolsInTurn: [],
    textPreamble: '',
    apiLatencyMs: 0,
  };
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const run = async (provider: StubSearchProvider | null) => {
    const page = await browser.newPage();
    const calls: RunSupercarOptions[] = [];
    const events: Array<Record<string, unknown>> = [];
    const awaitUser = vi.fn();
    const result = await runSearchWithFallback(
      {
        taskId: 'task',
        intent,
        executor: { getPage: async () => page },
        onAwaitingUser: awaitUser,
      } as unknown as RunSupercarOptions,
      {
        originalIntent: intent,
        searchProvider: provider,
        stop: vi.fn(() => true),
        onFallback: async (e) => {
          events.push(e as never);
        },
        run: async (a) => {
          calls.push(a);
          if (calls.length === 1) {
            // The wall a search fallback can answer is not handed to the user.
            expect(a.searchWallReplaceable?.(sorry)).toBe(true);
            expect(a.searchWallReplaceable?.('https://accounts.google.com/signin')).toBe(false);
            await a.onTick?.(tick);
            await a.onAwaitingUser?.({
              question: 'q',
              at: new Date(),
              awaitingKind: 'captcha',
              currentUrl: sorry,
            });
            return blocked;
          }
          expect(a.searchWallReplaceable?.(sorry)).toBe(false);
          const start = a.intent.match(/从 (\S+) 开始/)?.[1] ?? '';
          await page.goto(start).catch(() => null);
          return completed;
        },
      },
    );
    const text = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    await page.close();
    return { result, calls, events, awaitUser, text };
  };
  it('serves the API results with the original query and declares the source', async () => {
    const { result, calls, events, awaitUser, text } = await run(new StubSearchProvider());
    expect(awaitUser).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.intent).toContain('原查询为「HOLA DAY AI」');
    expect(calls[1]!.intent).toContain(SEARCH_RESULTS_ORIGIN);
    expect(calls[1]!.intent).not.toContain('EgTPlEZq');
    expect(text).toContain('HOLA DAY AI result 1');
    expect(result.summary).toContain('已改用 本地测试搜索接口');
    expect(events[0]).toMatchObject({ to: 'search-api:stub', endpoint: 'api', phase: 'started' });
  });
  it('with search-API-first, a Google search never opens google.com', async () => {
    const page = await browser.newPage();
    const calls: RunSupercarOptions[] = [];
    const events: Array<Record<string, unknown>> = [];
    const result = await runSearchWithFallback(
      {
        taskId: 'task',
        intent,
        executor: { getPage: async () => page },
      } as unknown as RunSupercarOptions,
      {
        originalIntent: intent,
        searchProvider: new StubSearchProvider(),
        searchApiFirst: true,
        stop: vi.fn(() => true),
        onFallback: async (e) => {
          events.push(e as never);
        },
        run: async (a) => {
          calls.push(a);
          return completed;
        },
      },
    );
    await page.close();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.intent).toContain('【搜索接口】');
    expect(calls[0]!.intent).toContain(SEARCH_RESULTS_ORIGIN);
    expect(calls[0]!.intent).not.toContain('验证墙');
    expect(result.summary).toContain('本次搜索使用 本地测试搜索接口（不是 Google 结果页）');
    expect(events.map((e) => [e.reason, e.phase])).toEqual([
      ['search_api_first', 'started'],
      ['search_api_first', 'completed'],
    ]);
  });
  it('uses the alternate engine when the API has nothing', async () => {
    const { calls } = await run(new StubSearchProvider(() => []));
    expect(calls[1]!.intent).toContain('https://www.bing.com/search?q=HOLA+DAY+AI');
  });
});
