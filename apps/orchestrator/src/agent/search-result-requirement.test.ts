import { describe, expect, it } from 'vitest';
import {
  resultLinks,
  searchResultRequirement,
  searchResultsSatisfy,
} from './search-result-requirement.js';

describe('searchResultRequirement', () => {
  it.each([
    [
      'Google 搜索「HOLA DAY AI」返回前5条标题和链接',
      { engine: 'Google', count: 5, needsLinks: true },
    ],
    ['用百度搜一下杭州天气，给我前三条结果', { engine: '百度', count: 3, needsLinks: false }],
    [
      'search bing for playwright and list the top 3 links',
      { engine: 'bing', count: 3, needsLinks: true },
    ],
    ['YouTube 搜索 lofi，返回视频链接', { engine: 'YouTube', count: null, needsLinks: true }],
  ])('%s', (intent, expected) => {
    expect(searchResultRequirement(intent)).toEqual(expected);
  });

  it.each([
    '搜索一下最近关于新能源汽车补贴的新闻',
    'Google 搜索「新加坡 天气」读出天气卡片',
    '总结 https://www.google.com/search?q=x 这个页面',
    '谷歌公司最新财报怎么样',
  ])('no link/count requirement: %s', (intent) => {
    expect(searchResultRequirement(intent)).toBeNull();
  });
});

describe('searchResultsSatisfy', () => {
  const need5Links = { engine: 'Google', count: 5, needsLinks: true };

  it('the D17 answer (3 titles, no links) is not enough', () => {
    expect(searchResultsSatisfy(need5Links, '1. HOLA DAY\n2. HOLA DAY AI\n3. 新闻')).toEqual({
      ok: false,
      reason: '需要 5 条带真实链接的结果，只取得 0 条',
    });
  });

  it('counts distinct result links, not the engine pages themselves', () => {
    const text = [
      '来源：https://www.google.com/search?q=HOLA+DAY+AI',
      '1. https://holaday.ai/',
      '2. https://holaday.ai/（重复）',
      '3. https://example.com/a.',
      '4. https://www.youtube.com/results?search_query=x',
      '5. https://www.youtube.com/watch?v=abc',
    ].join('\n');
    expect(resultLinks(text)).toEqual([
      'https://holaday.ai/',
      'https://example.com/a',
      'https://www.youtube.com/watch?v=abc',
    ]);
    expect(searchResultsSatisfy(need5Links, text)).toMatchObject({ ok: false });
    expect(searchResultsSatisfy({ ...need5Links, count: 3 }, text)).toEqual({ ok: true });
  });

  it('a count without links counts list items', () => {
    const req = { engine: '百度', count: 3, needsLinks: false };
    expect(searchResultsSatisfy(req, '1. a\n2. b\n3. c')).toEqual({ ok: true });
    expect(searchResultsSatisfy(req, '- a\n- b')).toEqual({
      ok: false,
      reason: '需要 3 条结果，只取得 2 条',
    });
  });
});
