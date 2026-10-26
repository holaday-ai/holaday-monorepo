import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/**
 * FIX-38 #4 (Deploy-38 new-bestbuy / reg-new-bestbuy paused on typing into the search box):
 * the trigger was `POST www.bestbuy.com/8KDozX93j/xk/gO/RcnBJZU540yNkQ/z8hYSJf3/XC4bVFoYBA/…`
 * with a one-field JSON body of about 4.3 KB — BestBuy's bot sensor.
 */
const SENSOR_PATH = '/8KDozX93j/xk/gO/RcnBJZU540yNkQ/z8hYSJf3/XC4bVFoYBA/cxo1EB/c4UXsY';
const sensor = (path = SENSOR_PATH, body = `{body:'3;0;1;0;'.padEnd(4276,'x')}`) =>
  `fetch('${path}',{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify(${body})})`;

const PAGES: Record<string, string> = {
  // Typing into the search box (Deploy-38) and clicking 搜索: only the sensor goes out.
  '/search': `<form role="search" action="/site/searchpage.jsp"><input name="st" aria-label="Search" oninput="${sensor()}"><button type="button" onclick="${sensor('/8KDozX93j/xk/gO/RcnBJZU540yNkQ/z3hYSJf3EmEfhf/K0ESVFoYBA/Fk5rH0/tkCC8')}">搜索</button></form>`,
  // Real writes on BestBuy pause as before.
  '/cart': `<button onclick="fetch('/cart/api/v1/addToCart',{method:'POST',body:JSON.stringify({items:[{skuId:'6505727'}]})})">Add to Cart</button>`,
  '/signin': `<button onclick="fetch('/identity/authenticate',{method:'POST',body:JSON.stringify({token:'x'})})">Sign In</button>`,
  // Look-alikes of the sensor are not the sensor.
  '/two-fields': `<button onclick="${sensor(SENSOR_PATH, `{body:'x',sku:'1'}`)}">Go</button>`,
  '/words': `<button onclick="${sensor('/api/v1/cart/items/add/now/please', `{body:'x'}`)}">Go</button>`,
  '/short': `<button onclick="${sensor('/8KDozX93j/RcnBJZU540yNkQ', `{body:'x'}`)}">Go</button>`,
};

describe('FIX-38 #4 · BestBuy: the bot sensor POST is not a write; BestBuy writes still pause', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  const act = async (host: string, path: string, ref: RegExp, action: 'type' | 'click') => {
    const page = await browser.newPage();
    await page.route(`https://${host}/**`, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST')
        return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><meta charset="utf-8"><title>Best Buy</title><body>${PAGES[url.pathname] ?? 'ok'}</body>`,
      });
    });
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      await tools.execute({ tool: 'navigate', url: `https://${host}${path}` } as never);
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const target = state.tree.match(ref)![1];
      return await tools.execute(
        (action === 'type'
          ? {
              tool: 'type',
              ref: target,
              text: 'usb c cable',
              observationRevision: state.observationRevision,
            }
          : {
              tool: 'click',
              ref: target,
              observationRevision: state.observationRevision,
            }) as never,
      );
    } finally {
      tools.dispose();
      await page.close();
    }
  };

  it('typing usb c cable into the search box: the sensor fires, no pause', async () => {
    const r = await act(
      'www.bestbuy.com',
      '/search',
      /(?:searchbox|textbox) "Search" \[ref=(e\d+)\]/,
      'type',
    );
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it('clicking a plain button that fires the sensor: no pause', async () => {
    const r = await act('www.bestbuy.com', '/search', /button "搜索" \[ref=(e\d+)\]/, 'click');
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it.each([
    ['add to cart', '/cart', /button "Add to Cart" \[ref=(e\d+)\]/],
    ['sign in', '/signin', /button "Sign In" \[ref=(e\d+)\]/],
    ['a two-field body on the sensor path', '/two-fields', /button "Go" \[ref=(e\d+)\]/],
    ['a path of words', '/words', /button "Go" \[ref=(e\d+)\]/],
    ['a short random path', '/short', /button "Go" \[ref=(e\d+)\]/],
  ])(
    'reverse: %s still pauses',
    async (_label, path, ref) => {
      const r = await act('www.bestbuy.com', path, ref, 'click');
      expect(r.interruption?.reason).toBe('unexpected_effect');
    },
    30_000,
  );

  it('reverse: the same sensor POST on another host still pauses', async () => {
    const r = await act(
      'www.bestbuy.com.evil.test',
      '/search',
      /button "搜索" \[ref=(e\d+)\]/,
      'click',
    );
    expect(r.interruption?.reason).toBe('unexpected_effect');
  }, 30_000);
});
