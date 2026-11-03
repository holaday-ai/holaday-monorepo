import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { describeUnifiedAction } from './unified-action-gate.js';

/**
 * FIX-53 #6 (Deploy-53 local b-m01): Enter in 高德's search box paused on 「无法确认回车会提交什么」.
 * Narrow: a searchbox / combobox (or a 「搜索」 placeholder) goes through, and the observer still
 * pauses unless a read request follows the Enter. The general Enter rule is unchanged.
 */
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const SEARCH_JS = (read: boolean) =>
  `<script>document.querySelector('input').addEventListener('keydown',e=>{if(e.key!=='Enter')return;e.preventDefault();${
    read ? "fetch('/api/poi?keywords='+encodeURIComponent(e.target.value));" : ''
  }document.body.insertAdjacentHTML('beforeend','<p>结果</p>');});</script>`;
const PAGES: Record<string, string> = {
  '/combobox': `<input role="combobox" aria-label="搜索地点" placeholder="搜索地点、公交、地铁">${SEARCH_JS(true)}`,
  '/placeholder': `<input placeholder="搜索地点、公交、地铁">${SEARCH_JS(true)}`,
  '/no-read': `<input role="combobox" placeholder="搜索地点">${SEARCH_JS(false)}`,
  '/chat': `<input placeholder="搜索或咨询客服">${SEARCH_JS(true)}`,
  '/plain': `<input placeholder="昵称">${SEARCH_JS(true)}`,
  '/post': `<form method="post" action="/save"><input role="combobox" placeholder="搜索"></form>`,
};

const open = async (path: string): Promise<Page> => {
  const page = await browser.newPage();
  await page.route('https://**/*', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/')
      ? route.fulfill({ contentType: 'application/json', body: '[]' })
      : route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body>${PAGES[new URL(route.request().url()).pathname] ?? 'ok'}</body>`,
        }),
  );
  await page.goto(`https://ditu.amap.com${path}`);
  return page;
};

describe('the gate before Enter', () => {
  const gate = async (path: string) => {
    const page = await open(path);
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

  it.each(['/combobox', '/placeholder', '/no-read'])(
    'a search box goes through: %s',
    async (p) => {
      expect((await gate(p)).unverified).toBeNull();
    },
    30_000,
  );

  it.each(['/chat', '/plain', '/post'])(
    'anything else still asks: %s',
    async (p) => {
      expect((await gate(p)).unverified).toBe('无法确认回车会提交什么（表单没有可识别的提交按钮）');
    },
    30_000,
  );
});

describe('the observer after Enter', () => {
  const enter = async (path: string) => {
    const page = await open(path);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const ref = state.tree.match(/(?:combobox|textbox)[^\n]*\[ref=(e\d+)\]/)![1];
      return await tools.execute({
        tool: 'type',
        ref,
        text: '西湖断桥',
        submit: true,
        observationRevision: state.observationRevision,
      } as never);
    } finally {
      tools.dispose();
      await page.close();
    }
  };

  it('a search that reads results does not pause', async () => {
    const r = await enter('/combobox');
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it('the same box with no read after Enter pauses', async () => {
    const r = await enter('/no-read');
    expect(r.interruption).toMatchObject({ reason: 'unexpected_effect' });
    expect(r.effect?.triggers?.map((t) => t.branch)).toContain('search_without_read');
  }, 30_000);
});
