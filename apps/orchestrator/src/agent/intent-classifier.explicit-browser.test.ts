/**
 * FIX-INTENT-ROUTE-BROWSER (bakeoff-3 D17C-ROUTE-01) — an explicit browser
 * request outranks search / scrape keywords, the decision carries a readable
 * reason, and pure-information tasks still go to scrape.
 */
import { readFileSync } from 'node:fs';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { classifyExecutionMode, explainExecutionMode } from './intent-classifier.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

const corpus = JSON.parse(
  readFileSync(
    new URL('../../scripts/browser-eval/route-audit-corpus.json', import.meta.url),
    'utf8',
  ),
) as { bench1Prefix: string; bench1Core: string[]; scrapeControls: string[] };

const explain = (intent: string) => explainExecutionMode({ intent, logger: fakeLogger() });

describe('explicit browser intent outranks search / scrape keywords', () => {
  it('D17C-ROUTE-01: the cloud-browser request is browser, with its reason', async () => {
    await expect(
      explain('请使用云端浏览器，Google 搜索「HOLA DAY AI」返回前5条标题和链接'),
    ).resolves.toEqual({ mode: 'browser', source: 'kw:explicit-browser', match: '指定使用浏览器' });
  });

  it('without the browser request the same sentence stays a search (scrape)', async () => {
    await expect(explain('Google 搜索「HOLA DAY AI」返回前5条标题和链接')).resolves.toMatchObject({
      mode: 'scrape',
      source: 'kw:search-verb',
    });
  });

  it.each([
    ['用浏览器搜索一下杭州天气', '指定使用浏览器'],
    ['在浏览器里查一下今天的汇率', '在浏览器里操作'],
    ['总结这篇文章 https://example.com/a（起始页面：https://example.com/a）', null],
    ['查看商品价格\n（起始页面：https://example.com/item）', '指定起始页面'],
    ['去京东网站看看 iPhone 16 的价格', null],
    ['搜索 HOLA DAY 然后点击第一条结果', '点击'],
    ['搜索 HOLA DAY 并截图首页', '截图'],
    ['登录后查看一下消息列表', '登录后操作'],
    ['Use a browser to search Google for HOLA DAY', 'use a browser'],
    ['search bing for weather and take a screenshot', 'take a screenshot'],
    ['search for the docs and click the first result', 'click'],
  ])('%s → browser', async (intent, match) => {
    const decision = await explain(intent);
    expect(decision.mode).toBe('browser');
    if (match) expect(decision).toMatchObject({ source: 'kw:explicit-browser', match });
  });

  it.each([
    '分析一下这条广告的点击率为什么下降',
    '帮我写一篇介绍截图工具的文章',
    '这张截图里写了什么',
    '不要用浏览器，直接告诉我 1+1 等于几',
  ])('%s → not browser', async (intent) => {
    expect(await classifyExecutionMode({ intent, logger: fakeLogger() })).not.toBe('browser');
  });

  it.each(corpus.bench1Core)('BROWSER-BENCH-1 with the cloud-browser prefix: %s', async (line) => {
    await expect(explain(`${corpus.bench1Prefix}${line}`)).resolves.toMatchObject({
      mode: 'browser',
      source: 'kw:explicit-browser',
    });
  });

  it.each(corpus.scrapeControls)('scrape control stays scrape: %s', async (intent) => {
    expect(await classifyExecutionMode({ intent, logger: fakeLogger() })).toBe('scrape');
  });

  it('reports why for the default and empty cases too', async () => {
    await expect(explain('')).resolves.toEqual({ mode: 'generate', source: 'empty-intent' });
    await expect(explain('帮我把这段话翻译成英文')).resolves.toMatchObject({ mode: 'generate' });
  });
});
