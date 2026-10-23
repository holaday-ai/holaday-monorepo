import { describe, expect, it } from 'vitest';
import { siteOf as egressSiteOf } from '../browser-pool/egress-learning.js';
import {
  declaredMissingPriceRows,
  extractStructuredItems,
  listPartialNote,
  reviewListAnswer,
} from '../execution/answer-verifier.js';
import type { ExecutionContract } from '../execution/execution-contract.js';
import { classifyIntentForOutputRequirement } from '../execution/execution-contract.js';
import { namedSiteDomains } from '../execution/source-domain-consistency.js';
import { answerQualityFailure, pastedMaterial } from './generate-answer-guard.js';
import { detectNavFailure } from './nav-failure-detector.js';
import { answerNotObtained } from './scrape-runner.js';
import { sharedHostingSite } from './shared-hosting.js';

/** FIX-32 (QUEUE 31): Deploy-32 findings and the FIX-30/31 review leftovers. */

// Deploy-32 b-p02, first finish (tsk_cPH4awzoUj9oZnbxoKjta), verbatim.
const P02_ROUND1 = `已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品的名称和价格（照页面原样）：

1. 名称：Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)；价格：未获取到（该商品卡片仅显示 "See options"，无具体价格）。
2. 名称：LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT)；价格：SGD 11.46。
3. 名称：USB C Monitor Cable 2FT, 8K@60Hz, 20Gbps, 100W；价格：SGD 15.32。`;

const rowsContract = {
  successCriteria: [
    {
      id: 'c1',
      type: 'ecommerce_rows',
      description: '',
      data: { minItems: 3, minUniqueUrls: 0, requireLinks: false },
    },
  ],
} as unknown as ExecutionContract;

describe('b-p02: a regional price is a price; a price the page lacks is said, not missing', () => {
  it('reads SGD / S$ / codes after the amount as prices', () => {
    expect(extractStructuredItems(P02_ROUND1).map((row) => row.price)).toEqual([
      null,
      11.46,
      15.32,
    ]);
    expect(
      extractStructuredItems('1. 线缆 A；价格：S$12.76\n2. 线缆 B；价格：9.90 USD').map(
        (r) => r.price,
      ),
    ).toEqual([12.76, 9.9]);
    // A model name is not a currency amount.
    expect(
      extractStructuredItems('1. USB C 100W Cable\n2. 8K 60Hz Cable').map((r) => r.price),
    ).toEqual([null, null]);
  });
  it('the Deploy-32 first answer is not sent back; it is delivered as 部分完成', () => {
    expect(declaredMissingPriceRows(P02_ROUND1)).toEqual([1]);
    expect(reviewListAnswer(rowsContract, P02_ROUND1)).toBeNull();
    expect(listPartialNote(rowsContract, P02_ROUND1)).toBe(
      '部分完成：第 1 条页面未显示价格（答案已如实说明）',
    );
  });
  it('a row that just leaves the price out is still sent back', () => {
    const silent = P02_ROUND1.replace(
      '；价格：未获取到（该商品卡片仅显示 "See options"，无具体价格）',
      '',
    );
    expect(reviewListAnswer(rowsContract, silent)).toContain('第 1 行缺少价格');
    expect(listPartialNote(rowsContract, silent)).toBeNull();
  });
  it('a complete answer is neither sent back nor partial', () => {
    const full = P02_ROUND1.replace(
      '未获取到（该商品卡片仅显示 "See options"，无具体价格）',
      'S$14.99',
    );
    expect(reviewListAnswer(rowsContract, full)).toBeNull();
    expect(listPartialNote(rowsContract, full)).toBeNull();
  });
});

describe('b-m01: the site the user named', () => {
  it.each([
    [
      '请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走，大概多久',
      ['amap.com', 'gaode.com'],
    ],
    ['请使用云端浏览器，去京东搜 AirPods 价格', ['jd.com']],
    ['在亚马逊上搜 usb c cable', ['amazon.com', 'amazon.cn']],
  ])('%s → %j', (intent, domains) => {
    expect(namedSiteDomains(intent)).toEqual(domains);
  });
  it.each([
    '苹果和亚马逊的市值对比',
    '用 linear regression 拟合这组数据',
    '高德地图查一下杭州东站到西湖断桥怎么走，可以用其他网站',
  ])('a subject, an English word, or other sources allowed: %s', (intent) => {
    expect(namedSiteDomains(intent)).toEqual([]);
  });
});

describe('FIX-30 review: pasted material, not length, exempts 「根据…」', () => {
  const cited = '根据网页内容，这款产品的续航是 20 小时。';
  it.each([
    [
      'a colon then the text',
      `总结这段：${'这款产品续航二十小时，支持快充，重量三百克，适合通勤携带。'.repeat(3)}`,
    ],
    ['a quote block', '帮我总结：\n> 这款产品续航二十小时，支持快充。\n> 重量三百克。'],
    [
      'a long quoted passage',
      `翻译「${'This product lasts twenty hours and supports fast charging. '.repeat(2)}」`,
    ],
  ])('pasted (%s): may be cited', (_case, material) => {
    expect(pastedMaterial(material)).toBe(true);
    expect(answerQualityFailure(cited, { readSources: false, userMaterial: material })).toBeNull();
  });
  it.each([
    [
      'a long request with nothing pasted',
      `帮我查一下这款产品的续航时间，${'我想知道它适不适合每天通勤使用，'.repeat(12)}`,
    ],
    ['a bare URL nobody read', '看看 https://example.com/product 这个产品续航多少'],
  ])('not pasted (%s): 「根据网页」 is an unread source', (_case, material) => {
    expect(pastedMaterial(material)).toBe(false);
    expect(answerQualityFailure(cited, { readSources: false, userMaterial: material })).toBe(
      'UNREAD_SOURCE',
    );
  });
});

describe('FIX-30 review: shared hosting is one site per subdomain', () => {
  it('siteOf', () => {
    expect(sharedHostingSite('docs.alice.github.io')).toBe('alice.github.io');
    expect(sharedHostingSite('my-app.vercel.app')).toBe('my-app.vercel.app');
    expect(sharedHostingSite('github.io')).toBeNull();
    expect(sharedHostingSite('www.github.com')).toBeNull();
    expect(egressSiteOf('alice.github.io')).toBe('alice.github.io');
    expect(egressSiteOf('bob.netlify.app')).toBe('bob.netlify.app');
    expect(egressSiteOf('www.reddit.com')).toBe('reddit.com');
  });
  it('a failed jump that left another github.io site open is still a nav failure', () => {
    const summary = '页面加载超时，无法访问该网址';
    const text = `Bob's notes. 页面加载超时，无法访问该网址。${'更多内容。'.repeat(400)}`;
    const intent = '打开 https://alice.github.io/notes 看看第一篇';
    expect(
      detectNavFailure(summary, { url: 'https://bob.github.io/', text, intent }).detected,
    ).toBe(true);
    expect(
      detectNavFailure(summary, { url: 'https://alice.github.io/notes/', text, intent }).detected,
    ).toBe(false);
  });
});

describe('core-07 vp=0: opening links is not asking for links', () => {
  it.each([
    '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个',
    '打开维基百科「Browser」页面，点开 3 个链接读标题',
  ])('%s → no link requirement', (intent) => {
    expect(classifyIntentForOutputRequirement(intent).kind).toBe('general');
  });
  it.each([
    'python.org 最新版 python 的 macOS 安装包下载链接给我（不用真下载）',
    '找一下 RFC 9110 的原文，附上链接',
  ])('%s → still needs a link', (intent) => {
    expect(classifyIntentForOutputRequirement(intent).kind).toBe('general_with_links');
  });
});

describe('BENCH-1 r06: an English 「not in the fetched content」 is not obtained', () => {
  it('the f32d answer (「抓取的内容里没有」) goes to the browser too', () => {
    expect(
      answerNotObtained(
        '从 [rfc-editor.org](https://rfc-editor.org) 首页抓取的内容里没有 RFC 9110 的信息——页面只列出了最新的几篇 RFC。要拿到标题和发布日期，需要访问它的专属信息页，所以标题和发布日期我无法给出。',
        "what's the title of RFC 9110 and when was it published? check rfc-editor.org",
      ),
    ).toBe(true);
  });
  it('the f32b answer goes to the browser; a real answer does not', () => {
    expect(
      answerNotObtained(
        "The fetched content from rfc-editor.org only shows the latest RFCs (RFC10054, RFC10055, RFC10065 from October 2026) on the homepage. RFC 9110's title and publication date are not included in the provided content.",
        "what's the title of RFC 9110 and when was it published? check rfc-editor.org",
      ),
    ).toBe(true);
    expect(
      answerNotObtained(
        'RFC 9110 is titled "HTTP Semantics" and was published in June 2022.',
        "what's the title of RFC 9110 and when was it published? check rfc-editor.org",
      ),
    ).toBe(false);
  });
});
