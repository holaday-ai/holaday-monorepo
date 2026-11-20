import { createRequire } from 'node:module';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchTargetProbe } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/**
 * G2c (DEPLOY-R5 online, FIX-62 candidates 协调方 P1): 「在 BestBuy 搜 usb c cable 告诉我第一个结果」
 * paused after typing into the site's search box — 「我在Best Buy在一个输入框里输入了内容。页面像是提交了
 * 一个请求，我先停下了」. Typing a search word and pressing Enter / the search button is a read;
 * comment, chat, login, address, cart and order boxes still pause.
 */
const page = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;
/** A 1.2 KB opaque sensor string, the shape BestBuy's bot sensor posts. */
const SENSOR = `Array.from({length:1200},(_,i)=>'aZ0bY9cX8+/='[i%12]).join('')`;
const post = (path: string, body: string) =>
  `fetch(${JSON.stringify(path)},{method:'POST',headers:{'content-type':'text/plain'},body:${body}})`;
/** The fixture's `on` listener on `#target` runs `run`. */
const wire = (on: string, run: string) =>
  `<script>document.querySelector('#target').addEventListener('${on}',()=>{${run}})</script>`;

const FIXTURES: Record<string, string> = {
  // BestBuy: the header search is a bare combobox textarea inside a label, which the snapshot shows
  // as a nameless 「- generic [ref=…]:」 holding the box — the ref the online run typed into (the
  // pause said 「在一个输入框里」: no name). Its bot sensor posts a 1.2 KB `{"body":…}` to a
  // 4-segment random path.
  '/bestbuy-label': page(
    `<header><div class="header-search"><label class="search-wrap" id="target"><span class="sr-only">Search</span><textarea id="gh-search" role="combobox" aria-autocomplete="list" aria-label="Type to search. Navigate forward to hear suggestions" placeholder="What can we help you find today?"></textarea></label></div></header>${wire('input', post('/Xk9aBq/Qw7/Rt7Yu/Pl2', `JSON.stringify({body:${SENSOR}})`))}`,
  ),
  '/bestbuy-combobox': page(
    `<header><div class="header-search"><textarea id="target" role="combobox" aria-autocomplete="list" aria-label="Type to search. Navigate forward to hear suggestions" placeholder="What can we help you find today?"></textarea></div></header>${wire('input', post('/lByGV9hoI/F/uHglT4qg/X1YQ', `JSON.stringify({sensor_data:${SENSOR}})`))}`,
  ),
  '/bestbuy-button': page(
    `<header><div class="header-search"><textarea role="combobox" aria-label="Type to search. Navigate forward to hear suggestions"></textarea><button id="target" aria-label="submit search" class="header-search-button"><svg width="16" height="16"></svg></button></div></header>${wire('click', `${post('/clickstream/log', "'e=search'")};setTimeout(()=>location.assign('/site/searchpage.jsp?st=usb+c+cable'),50)`)}`,
  ),
  // 京东: `#key` with aria-label 「搜索」, no form; typing and the 搜索 button report to a log path.
  '/jd': page(
    `<div id="search"><div class="form"><input type="text" id="target" aria-label="搜索" autocomplete="off" class="text"><button class="button" id="go" aria-label="搜索"><i class="iconfont">&#xe6a9;</i></button></div></div>${wire('input', post('/uba/v1/track', "'k=1'"))}<script>document.querySelector('#go').addEventListener('click',()=>{${post('/uba/v1/track', "'click=search'")};setTimeout(()=>location.assign('/Search?keyword=usb'),50)})</script>`,
  ),
  // 淘宝: the React search box — name="q", no form; typing asks mtop for suggestions.
  '/taobao': page(
    `<div class="search-suggest-combobox"><input id="target" name="q" role="combobox" aria-label="请输入搜索文字" class="search-suggest-combobox-input" autocomplete="off"></div>${wire('input', post('/h5/mtop.relationrecommend.wirelessrecommend.recommend/2.0/', "'data=1'"))}`,
  ),

  // Still pauses: a comment box wrapped in a label (its text names it), even posting to a log path.
  '/comment-label': page(
    `<label id="target">写评论<textarea placeholder="说点什么…"></textarea></label>${wire('input', post('/api/track', "'x'"))}`,
  ),
  // Still pauses: a search box's opaque POST is no proof of a read.
  '/search-opaque': page(
    `<div class="form"><input type="text" id="target" aria-label="搜索"></div>${wire('input', post('/lByGV9hoI/F/uHglT4qg/X1YQ', "'x'"))}`,
  ),
  // Still pauses: a sensor-shaped body to a cart path, and a write named in the query.
  '/search-cart': page(
    `<div class="form"><input type="text" id="target" aria-label="搜索"></div>${wire('input', post('/api/cart/add', `JSON.stringify({body:${SENSOR}})`))}`,
  ),
  '/search-intent': page(
    `<div class="form"><input type="text" id="target" aria-label="搜索"></div>${wire('input', post('/api/log?action=addCart', "'q=1'"))}`,
  ),
  // Still pauses: a message box named q.
  '/message-q': page(
    `<div class="composer"><input type="text" id="target" name="q" placeholder="Send a message"></div>${wire('input', post('/suggest', "'q=1'"))}`,
  ),
  // 复审: a support / chat box named q whose label says so (「联系客服」) is no search box.
  '/support-label': page(
    `<label>联系客服 <input type="text" id="target" name="q"></label>${wire('input', post('/suggest', "'q=1'"))}`,
  ),
  // Still pauses: a login box and a checkout address box.
  '/login': page(
    `<form action="/passport/login" method="post"><input type="text" id="target" name="username" aria-label="账号" placeholder="手机号/邮箱"></form>${wire('input', post('/passport/track', "'x'"))}`,
  ),
  '/address': page(
    `<form action="/checkout/address" method="post"><input type="text" id="target" name="address" aria-label="收货地址"></form>${wire('input', post('/log/track', "'x'"))}`,
  ),
  // Still pauses: a click that is not the search button, though a search box sits beside it.
  '/addcart-beside-search': page(
    `<div class="bar"><input type="search" aria-label="Search"><button id="target">加入购物车</button></div>${wire('click', post('/log/v1/event', "'x'"))}`,
  ),
  // Still pauses: the search button that posts an order.
  '/search-button-order': page(
    `<div class="form"><input type="text" aria-label="搜索"><button id="target">搜索</button></div>${wire('click', post('/api/order/submit', "'x'"))}`,
  ),
  // Still pauses: an icon button shared by a search box and a comment box belongs to neither.
  '/button-two-boxes': page(
    `<div class="pane"><input type="text" aria-label="搜索"><textarea aria-label="写评论"></textarea><button id="target" aria-label=""><svg width="16" height="16"></svg></button></div>${wire('click', post('/log/v1/event', "'x'"))}`,
  ),
};

describe('G2c · a site search box is a read; real writes still pause', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  /** Serves the fixture on `host` and acts on `#target` by its snapshot ref, as the model does. */
  const act = async (path: string, tool: 'type' | 'click', host = 'www.example.test') => {
    const p = await browser.newPage();
    await p.route(`https://${host}/**`, (route) => {
      if (route.request().method() === 'POST')
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: FIXTURES[new URL(route.request().url()).pathname] ?? page('ok'),
      });
    });
    const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
    try {
      await t.execute({ tool: 'navigate', url: `https://${host}${path}` } as never);
      const state = JSON.parse((await t.execute({ tool: 'read_page' } as never)).text);
      // The snapshot's ref for #target, found the way the executor resolves refs.
      let ref: string | null = null;
      for (const [, one] of (state.tree as string).matchAll(/\[ref=(e\d+)\]/g)) {
        const id = await p
          .locator(`aria-ref=${one}`)
          .evaluate((el) => el.id, undefined, { timeout: 1000 })
          .catch(() => null);
        if (id === 'target') {
          ref = one ?? null;
          break;
        }
      }
      expect(ref, `no ref for #target on ${path}`).toBeTruthy();
      const result = await t.execute(
        (tool === 'type'
          ? {
              tool,
              ref,
              text: 'usb c cable',
              observationRevision: state.observationRevision,
            }
          : { tool, ref, observationRevision: state.observationRevision }) as never,
      );
      return { result, tree: state.tree as string, ref: ref as string };
    } finally {
      t.dispose();
      await p.close();
    }
  };

  it('BestBuy: typing through the nameless label wrapper (the online 「generic」 ref) does not pause', async () => {
    const { result, tree, ref } = await act('/bestbuy-label', 'type', 'www.bestbuy.com');
    // The model only sees a nameless wrapper here, as online.
    expect(tree).toMatch(new RegExp(`generic \\[ref=${ref}\\]`));
    expect(result.ok).toBe(true);
    expect(result.interruption).toBeUndefined();
  }, 30000);
  it('BestBuy: typing into the combobox textarea (no form) with a sensor POST does not pause', async () => {
    const { result } = await act('/bestbuy-combobox', 'type', 'www.bestbuy.com');
    expect(result.interruption).toBeUndefined();
  }, 30000);
  it('BestBuy: the icon 「submit search」 button that logs and opens the results does not pause', async () => {
    const { result } = await act('/bestbuy-button', 'click', 'www.bestbuy.com');
    expect(result.interruption).toBeUndefined();
  }, 30000);
  it('京东: typing into #key (aria-label 搜索) that reports to a log path does not pause', async () => {
    const { result } = await act('/jd', 'type', 'www.jd.com');
    expect(result.interruption).toBeUndefined();
  }, 30000);
  it('淘宝: typing into the formless q box that asks mtop for suggestions does not pause', async () => {
    const { result } = await act('/taobao', 'type', 'www.taobao.com');
    expect(result.interruption).toBeUndefined();
  }, 30000);

  it.each([
    ['/comment-label', 'type', 'www.example.test'],
    ['/search-opaque', 'type', 'www.example.test'],
    ['/search-cart', 'type', 'www.bestbuy.com'],
    ['/search-intent', 'type', 'www.example.test'],
    ['/message-q', 'type', 'www.example.test'],
    ['/support-label', 'type', 'www.example.test'],
    ['/login', 'type', 'www.example.test'],
    ['/address', 'type', 'www.example.test'],
    ['/addcart-beside-search', 'click', 'www.example.test'],
    ['/search-button-order', 'click', 'www.example.test'],
    ['/button-two-boxes', 'click', 'www.example.test'],
    // The sensor body passes on BestBuy's own host only.
    ['/bestbuy-label', 'type', 'www.bestbuy.com.evil.test'],
  ] as const)(
    'a write still pauses: %s (%s on %s)',
    async (path, tool, host) => {
      const { result } = await act(path, tool, host);
      expect(result.interruption?.reason).toBe('unexpected_effect');
    },
    30000,
  );
});

describe('G2c · the probe survives serialisation and judges the control', () => {
  it('compiled with keepNames (as tsx runs it), its source has no __name helper', async () => {
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const { transformSync } = createRequire(tsx)('esbuild') as {
      transformSync: (code: string, options: Record<string, unknown>) => { code: string };
    };
    const { code } = transformSync(
      `${searchTargetProbe.toString()}\nglobalThis.__g2cProbe = searchTargetProbe;`,
      { keepNames: true, loader: 'js' },
    );
    new Function(code)();
    const compiled = (globalThis as { __g2cProbe?: (el: Element, tool: string) => boolean })
      .__g2cProbe!;
    expect(compiled.toString()).not.toContain('__name');
    const browser = await chromium.launch({ headless: true });
    try {
      const p = await browser.newPage();
      await p.setContent(
        page(
          '<label id="wrap"><textarea aria-label="Search Best Buy"></textarea></label><label id="c">评论<textarea></textarea></label><div class="f"><input id="k" aria-label="搜索"><button id="b">搜索</button></div>',
        ),
      );
      expect(await p.locator('#wrap').evaluate(compiled as never, 'type')).toBe(true);
      expect(await p.locator('#c').evaluate(compiled as never, 'type')).toBe(false);
      expect(await p.locator('#k').evaluate(compiled as never, 'type')).toBe(true);
      expect(await p.locator('#b').evaluate(compiled as never, 'click')).toBe(true);
      expect(await p.locator('#b').evaluate(compiled as never, 'type')).toBe(false);
    } finally {
      await browser.close();
    }
  }, 30000);
});
