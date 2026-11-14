import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunSupercarOptions, SupercarOutcome } from '../supercar/index.js';
import { runSearchWithFallback } from './search-engine-fallback.js';
import { StubSearchProvider } from './search-provider.js';
import {
  ENGINE_RESULTS_ROUTE,
  SEARCH_RESULTS_ORIGIN,
  engineResultsQuery,
  routeWithin,
  routingUnreliable,
} from './search-results-page.js';

/**
 * G2d: the run-wide search guard (CAPTCHA-UX-1) is installed only when the run heads for an
 * engine, with a matcher Playwright resolves itself, and every route change is bounded; a context
 * whose route removal stalled is marked so the pool does not hand it to another task.
 */
let browser: Browser;
let server: http.Server;
let origin = '';
let assetHits = 0;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/app.js')) {
      assetHits++;
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=3600' });
      res.end('window.loaded = true;');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<script src="/app.js"></script><a id="go" href="https://cn.bing.com/search?q=via+link">search</a>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const done: SupercarOutcome = { status: 'completed', summary: 'ok', iterations: 1, toolsUsed: [] };
const intent = '请使用云端浏览器，在 BestBuy 搜索 usb c cable，告诉我第一个结果';

/** Stand-in engines: whatever the guard lets through lands here, nothing goes to the network. */
async function engineStandIn(context: BrowserContext) {
  await context.route(/^https:\/\/(?:www\.google\.com|www\.bing\.com|cn\.bing\.com)\//, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>engine page</h1><a id="s" href="https://cn.bing.com/search?q=race">search</a>',
    }),
  );
}

async function runGuarded(
  context: BrowserContext,
  page: Page,
  steps: (page: Page) => Promise<void>,
) {
  const executor = { getPage: async () => page };
  const started = Date.now();
  const outcome = await runSearchWithFallback(
    {
      taskId: 'g2d',
      intent,
      executor,
      onEvidence: async () => {},
    } as unknown as RunSupercarOptions,
    {
      originalIntent: intent,
      searchProvider: new StubSearchProvider(),
      searchApiFirst: true,
      stop: () => true,
      run: async () => {
        await steps(page);
        return done;
      },
    },
  );
  return { outcome, executor, ms: Date.now() - started, context };
}

/** Records every matcher the code under test hands to `context.route`. */
function recordRoutes(context: BrowserContext) {
  const matchers: unknown[] = [];
  const route = context.route.bind(context);
  context.route = ((url, handler, options) => {
    matchers.push(url);
    return route(url, handler, options);
  }) as BrowserContext['route'];
  return matchers;
}

describe('G2d: the run-wide guard is installed only when the run heads for an engine', () => {
  it('a run that never opens an engine installs no route — the page keeps its browser cache', async () => {
    const context = await browser.newContext();
    const matchers = recordRoutes(context);
    const page = await context.newPage();
    assetHits = 0;
    await runGuarded(context, page, async (p) => {
      await p.goto(`${origin}/a`, { waitUntil: 'load' });
      await p.goto(`${origin}/b`, { waitUntil: 'load' });
    });
    // Any Playwright route turns Chromium's cache off (the asset would be fetched twice).
    expect(matchers).toEqual([]);
    expect(assetHits).toBe(1);
    await context.close();
  });

  it('heading for an engine installs it first, with a matcher that leaves other hosts alone', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    const matchers = recordRoutes(context);
    const page = await context.newPage();
    let landed = '';
    await runGuarded(context, page, async (p) => {
      await p.goto(`${origin}/a`, { waitUntil: 'load' });
      await p.goto('https://cn.bing.com/search?q=HOLA', { waitUntil: 'load' });
      await p.waitForURL((u) => u.origin === SEARCH_RESULTS_ORIGIN, { timeout: 5_000 });
      landed = p.url();
    });
    expect(landed.startsWith(SEARCH_RESULTS_ORIGIN)).toBe(true);
    expect(matchers.length).toBeGreaterThan(0);
    // A function matcher is sent to Playwright as "every URL": each request came to this process.
    for (const matcher of matchers) expect(typeof matcher).not.toBe('function');
    await context.close();
  });

  it('a results page reached by a link is replaced by the search API page', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    const page = await context.newPage();
    let landed = '';
    await runGuarded(context, page, async (p) => {
      await p.goto(`${origin}/a`, { waitUntil: 'load' });
      await p.click('#go');
      await p.waitForURL((u) => u.origin === SEARCH_RESULTS_ORIGIN, { timeout: 5_000 });
      landed = p.url();
    });
    expect(landed.startsWith(SEARCH_RESULTS_ORIGIN)).toBe(true);
    await context.close();
  });

  it('a search submitted while the guard is still installing is reopened through it', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    const route = context.route.bind(context);
    context.route = (async (...args: Parameters<BrowserContext['route']>) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return route(...args);
    }) as BrowserContext['route'];
    const page = await context.newPage();
    let landed = '';
    await runGuarded(context, page, async (p) => {
      // The engine's home page starts the install; the search goes out before it is in.
      await p.goto('https://www.bing.com/', { waitUntil: 'load' });
      await p.click('#s');
      await p.waitForURL((u) => u.origin === SEARCH_RESULTS_ORIGIN, { timeout: 8_000 });
      landed = p.url();
    });
    expect(landed.startsWith(SEARCH_RESULTS_ORIGIN)).toBe(true);
    await context.close();
  }, 30_000);

  it('the engine matcher covers every engine results page and no other host', () => {
    for (const url of [
      'https://www.google.com/search?q=a',
      'https://www.google.co.uk/search?q=x',
      'https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3DHOLA',
      'https://cn.bing.com/search?q=y',
      'https://html.duckduckgo.com/html/?q=z',
      'https://lite.duckduckgo.com/lite/?q=z',
      'https://duckduckgo.com/?q=z',
    ]) {
      expect(engineResultsQuery(url), url).not.toBeNull();
      expect(ENGINE_RESULTS_ROUTE.test(url), url).toBe(true);
    }
    for (const url of [
      'https://www.bestbuy.com/site/searchpage.jsp?st=usb',
      'https://example.com/search?q=x',
      'https://www.google-analytics.com/collect?v=1',
      'https://fonts.googleapis.com/css2?family=Inter',
      'https://pictures.bestbuy.com/search?q=x',
    ])
      expect(ENGINE_RESULTS_ROUTE.test(url), url).toBe(false);
  });
});

describe('G2d: route changes are bounded and a stalled one marks the browser', () => {
  it('installing the guard stalls: the run goes on without it, within seconds', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    context.route = (() => new Promise<void>(() => {})) as unknown as BrowserContext['route'];
    const page = await context.newPage();
    let landed = '';
    const { outcome, ms, executor } = await runGuarded(context, page, async (p) => {
      await p.goto('https://cn.bing.com/search?q=HOLA', { waitUntil: 'load' });
      landed = p.url();
    });
    expect(outcome.status).toBe('completed');
    expect(ms).toBeLessThan(10_000);
    // Without the guard the engine opens as it did before CAPTCHA-UX-1.
    expect(landed).toBe('https://cn.bing.com/search?q=HOLA');
    // A slow install is not a broken route table (review P1-b): only its removal decides.
    expect(routingUnreliable(executor)).toBe(false);
    await context.close();
  }, 30_000);

  it('a slow install that lands later is taken down in the background; the browser stays usable', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    const route = context.route.bind(context);
    const unroute = context.unroute.bind(context);
    const removed: unknown[] = [];
    context.route = (async (...args: Parameters<BrowserContext['route']>) => {
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      return route(...args);
    }) as BrowserContext['route'];
    context.unroute = (async (...args: Parameters<BrowserContext['unroute']>) => {
      removed.push(args[0]);
      return unroute(...args);
    }) as BrowserContext['unroute'];
    const page = await context.newPage();
    const { outcome, executor } = await runGuarded(context, page, async (p) => {
      await p.goto('https://cn.bing.com/search?q=HOLA', { waitUntil: 'load' });
    });
    expect(outcome.status).toBe('completed');
    await vi.waitFor(() => expect(removed.length).toBeGreaterThan(0), { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Not marked: the pool keeps / hands back this browser as usual.
    expect(routingUnreliable(context)).toBe(false);
    expect(routingUnreliable(executor)).toBe(false);
    await context.close();
  }, 30_000);

  it('the background removal of a given-up install that never settles marks the context', async () => {
    const context = await browser.newContext();
    context.route = (() => new Promise<void>(() => {})) as unknown as BrowserContext['route'];
    expect(await routeWithin(context, /never/, () => {}, 50, 200)).toBeNull();
    expect(routingUnreliable(context)).toBe(false);
    await vi.waitFor(() => expect(routingUnreliable(context)).toBe(true), { timeout: 2_000 });
    await context.close();
  });

  it('taking the guard down stalls: the run returns and its browser is marked unreliable', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    context.unroute = (() => new Promise<void>(() => {})) as typeof context.unroute;
    const page = await context.newPage();
    const { outcome, ms, executor } = await runGuarded(context, page, async (p) => {
      await p.goto('https://cn.bing.com/search?q=HOLA', { waitUntil: 'load' });
    });
    expect(outcome.status).toBe('completed');
    // Two routes, but once the first removal stalled nothing waits for the second.
    expect(ms).toBeLessThan(6_000);
    expect(routingUnreliable(executor)).toBe(true);
    await context.close();
  }, 30_000);

  it('a run whose routes came down normally leaves its browser reusable', async () => {
    const context = await browser.newContext();
    await engineStandIn(context);
    const page = await context.newPage();
    const { executor } = await runGuarded(context, page, async (p) => {
      await p.goto('https://cn.bing.com/search?q=HOLA', { waitUntil: 'load' });
    });
    expect(routingUnreliable(executor)).toBe(false);
    expect(routingUnreliable(context)).toBe(false);
    await context.close();
  });
});
