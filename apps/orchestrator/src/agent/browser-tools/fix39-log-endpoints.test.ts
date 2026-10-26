import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchoredLogPost } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/**
 * FIX-39 #1/#2: BestBuy's `upa-logger.<region>.aws.openshift.bestbuy.com/log-events` (paused
 * new-bestbuy in Deploy-35, reg-new-bestbuy in Deploy-36 and Deploy-39: opaque 0 B, while typing)
 * and Xiaohongshu's `t2.xiaohongshu.com/api/v2/collect` (paused xhs-read in Deploy-39: opaque
 * 680 B, after closing the login popup). Evidence: fix-39/evidence.txt.
 */
const UPA = 'https://upa-logger.east.aws.openshift.bestbuy.com/log-events';
const XHS = 'https://t2.xiaohongshu.com/api/v2/collect';
const OPAQUE_680 = '\u0008\u0001\u0012§'.padEnd(680, '\u0000');

describe('FIX-39 · anchoredLogPost: exact host + path, empty / opaque body only', () => {
  it.each([
    ['BestBuy upa-logger, 0 B (Deploy-39 reg-new-bestbuy)', UPA, 'POST', '', true],
    [
      'BestBuy upa-logger in another region',
      'https://upa-logger.west.aws.openshift.bestbuy.com/log-events',
      'POST',
      '',
      true,
    ],
    ['Xiaohongshu t2 collect, opaque 680 B (Deploy-39 xhs-read)', XHS, 'POST', OPAQUE_680, true],
    ['look-alike host', 'https://upa-logger.x.bestbuy.com.evil.io/log-events', 'POST', '', false],
    [
      'bestbuy look-alike suffix',
      'https://upa-logger.east.aws.openshift.bestbuy.com.evil.io/log-events',
      'POST',
      '',
      false,
    ],
    ['another bestbuy host', 'https://www.bestbuy.com/log-events', 'POST', '', false],
    [
      'another path on upa-logger',
      'https://upa-logger.east.aws.openshift.bestbuy.com/log-events/cart',
      'POST',
      '',
      false,
    ],
    ['upa-logger with a JSON body', UPA, 'POST', '{"action":"addToCart","sku":"6505727"}', false],
    ['upa-logger with a form body', UPA, 'POST', 'email=a%40b.com&password=x', false],
    ['upa-logger by GET', UPA, 'GET', '', false],
    [
      'Xiaohongshu real 收藏',
      'https://edith.xiaohongshu.com/api/sns/web/v1/note/collect',
      'POST',
      '{"note_id":"1"}',
      false,
    ],
    [
      'Xiaohongshu 收藏 on www',
      'https://www.xiaohongshu.com/api/v2/collect',
      'POST',
      OPAQUE_680,
      false,
    ],
    ['t2 collect with a JSON body', XHS, 'POST', '{"note_id":"1"}', false],
    [
      't2 another path',
      'https://t2.xiaohongshu.com/api/v2/note/collect',
      'POST',
      OPAQUE_680,
      false,
    ],
  ])('%s → %s', (_label, url, method, body, expected) => {
    expect(anchoredLogPost(new URL(url), method, body)).toBe(expected);
  });
});

describe('FIX-39 · in the executor: the log posts no longer pause, writes still do', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  const post = (url: string, body: string) =>
    `fetch('${url}',{method:'POST',mode:'no-cors',body:${body}})`;
  const PAGES: Record<string, string> = {
    // BestBuy: typing into the search box sends the 0 B log post (Deploy-39 reg-new-bestbuy).
    '/bb-search': `<form role="search" action="/site/searchpage.jsp"><input name="st" aria-label="Search" oninput="${post(UPA, "''")}"></form>`,
    // Xiaohongshu: closing the login popup sends the opaque collect (Deploy-39 xhs-read).
    '/xhs-close': `<div><button aria-label="关闭" onclick="${post(XHS, 'new Uint8Array(680)')}">×</button></div>`,
    '/bb-lookalike': `<button onclick="${post('https://upa-logger.x.bestbuy.com.evil.io/log-events', "''")}">Go</button>`,
    '/bb-json': `<button onclick="${post(UPA, `JSON.stringify({action:'addToCart',sku:'1'})`)}">Go</button>`,
    '/bb-cart': `<button onclick="${post('https://www.bestbuy.com/cart/api/v1/addToCart', `JSON.stringify({items:[{skuId:'1'}]})`)}">Add to Cart</button>`,
    '/bb-signin': `<button onclick="${post('https://www.bestbuy.com/identity/authenticate', `JSON.stringify({token:'x'})`)}">Sign In</button>`,
    '/xhs-favourite': `<button onclick="${post('https://edith.xiaohongshu.com/api/sns/web/v1/note/collect', `JSON.stringify({note_id:'1'})`)}">收藏</button>`,
  };

  const act = async (path: string, ref: RegExp, action: 'type' | 'click') => {
    const page = await browser.newPage();
    await page.route('https://**/*', (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'POST') return route.fulfill({ status: 204, body: '' });
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body>${PAGES[url.pathname] ?? 'ok'}</body>`,
      });
    });
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      await tools.execute({ tool: 'navigate', url: `https://www.bestbuy.com${path}` } as never);
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

  it('typing into BestBuy search: the upa-logger post does not pause', async () => {
    const r = await act('/bb-search', /(?:searchbox|textbox) "Search" \[ref=(e\d+)\]/, 'type');
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it('closing the Xiaohongshu popup: the t2 collect post does not pause', async () => {
    const r = await act('/xhs-close', /button "关闭" \[ref=(e\d+)\]/, 'click');
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it.each([
    ['a look-alike upa-logger host', '/bb-lookalike', /button "Go" \[ref=(e\d+)\]/],
    ['upa-logger carrying a JSON write', '/bb-json', /button "Go" \[ref=(e\d+)\]/],
    ['BestBuy add to cart', '/bb-cart', /button "Add to Cart" \[ref=(e\d+)\]/],
    ['BestBuy sign in', '/bb-signin', /button "Sign In" \[ref=(e\d+)\]/],
    ['Xiaohongshu real 收藏', '/xhs-favourite', /button "收藏" \[ref=(e\d+)\]/],
  ])(
    'reverse: %s still pauses',
    async (_label, path, ref) => {
      const r = await act(path, ref, 'click');
      expect(r.interruption?.reason).toBe('unexpected_effect');
    },
    30_000,
  );
});
