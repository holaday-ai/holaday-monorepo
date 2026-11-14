import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { describeUnifiedAction } from './unified-action-gate.js';

/**
 * FIX-53 #6 (Deploy-53 local b-m01): Enter in 高德's search box paused on 「无法确认回车会提交什么」.
 * The page Gaode serves the cloud browser has a bare `<input id="searchipt">` (no class, no form;
 * DOM checked 2026-11-03). Anchored to it on amap.com, as LocationItem_input is; every other
 * site's Enter is still asked about before the action.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const SEARCH_JS = `<script>document.querySelector('input').addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();fetch('/api/poi?keywords='+encodeURIComponent(e.target.value));document.body.insertAdjacentHTML('beforeend','<p>结果</p>');});</script>`;
// As Gaode serves it (2026-11-03): `div.iptbox > input#searchipt`, in `header.searchbox`.
const AMAP_BOX = `<section id="search" class="search"><header class="searchbox"><div class="iptbox"><input type="text" id="searchipt" placeholder="搜索位置、公交站、地铁站" maxlength="256" autocomplete="off"></div></header></section>${SEARCH_JS}`;
const PAGES: Record<string, string> = {
  'ditu.amap.com/': AMAP_BOX,
  'www.amap.com/': AMAP_BOX,
  'shop.test/': `<input role="combobox" placeholder="搜索商品">${SEARCH_JS}`,
  'shop.test/searchipt': `<input id="searchipt" placeholder="搜索商品">${SEARCH_JS}`,
  'ditu.amap.com/other': `<input role="combobox" placeholder="搜索地点">${SEARCH_JS}`,
};

const open = async (url: string): Promise<Page> => {
  const page = await browser.newPage();
  await page.route('https://**/*', (route) => {
    const u = new URL(route.request().url());
    return u.pathname.startsWith('/api/')
      ? route.fulfill({ contentType: 'application/json', body: '[]' })
      : route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body>${PAGES[`${u.host}${u.pathname}`] ?? 'ok'}</body>`,
        });
  });
  await page.goto(url);
  return page;
};

describe('the gate before Enter', () => {
  const gate = async (url: string) => {
    const page = await open(url);
    try {
      return await describeUnifiedAction(
        page,
        { tool: 'type', ref: 'e1', text: '西湖断桥', submit: true } as never,
        () => null,
        undefined,
        page.mainFrame(),
        () => page.locator('input'),
      );
    } finally {
      await page.close();
    }
  };

  it.each(['https://ditu.amap.com/', 'https://www.amap.com/'])(
    "Gaode's search box goes through: %s",
    async (url) => {
      expect((await gate(url)).unverified).toBeNull();
    },
    30_000,
  );

  it.each([
    ['a combobox 「搜索商品」 on another site', 'https://shop.test/'],
    ['#searchipt on another site', 'https://shop.test/searchipt'],
    ['another box on amap.com', 'https://ditu.amap.com/other'],
  ])(
    '%s is still asked about',
    async (_label, url) => {
      expect((await gate(url)).unverified).toBe(
        '无法确认回车会提交什么（表单没有可识别的提交按钮）',
      );
    },
    30_000,
  );
});

describe('the observer after Enter', () => {
  it("a search in Gaode's box does not pause", async () => {
    const page = await open('https://ditu.amap.com/');
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const ref = state.tree.match(/textbox[^\n]*\[ref=(e\d+)\]/)![1];
      const r = await tools.execute({
        tool: 'type',
        ref,
        text: '西湖断桥',
        submit: true,
        observationRevision: state.observationRevision,
      } as never);
      expect(r.interruption).toBeUndefined();
    } finally {
      tools.dispose();
      await page.close();
    }
  }, 30_000);
});
