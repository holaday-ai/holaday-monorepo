import { readFileSync } from 'node:fs';
import { stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { verificationPost } from '../agent/browser-tools/cloud-observation.js';
import { deliverableAnswer } from '../agent/generate-answer-guard.js';
import { declaredMissingPriceRows, listPartialNote } from './answer-verifier.js';
import type { ExecutionContract } from './execution-contract.js';

/**
 * FIX-35 0a (Deploy-35 b-p02, tsk_ZGVLqFApMegLHbj2tTHpc): item 1 showed only 「See options」
 * and the answer said so honestly; FIX-34 5d35eb89 looked past it to the snapshot's cut
 * marker (items 2–3 and their prices lie between) and sent the honest answer back.
 *
 * The page: a real amazon.com results page read locally (2026-10-24, the same search),
 * item 1's price lines replaced by the 「See options」 link production recorded (ref=e289;
 * production reads amazon.com from Singapore), cut after item 3 as production's was.
 */
const PAGE = readFileSync(
  new URL('./fixtures/amazon-com-see-options.txt', import.meta.url),
  'utf8',
);
// Row 1 verbatim from the production answer that was sent back.
const ANSWER = `已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品信息如下（价格按页面原样）：

1. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black) — 未获取到（该商品在结果卡片中仅显示“See options”，未直接列出价格）
2. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — $9.99
3. USB C Cable, LED Light up USB A to C 6A Fast Charging Cord Multicolor 3FT — $9.99`;
const contract = {
  successCriteria: [
    {
      id: 'c1',
      type: 'ecommerce_rows',
      description: '',
      data: { minItems: 3, minUniqueUrls: 0, requireLinks: false },
    },
  ],
} as unknown as ExecutionContract;

describe('FIX-35 0a · an item card showing only 「See options」 is an honest gap', () => {
  it('the row’s own state is read before the snapshot’s cut marker → 部分完成', () => {
    expect(declaredMissingPriceRows(ANSWER, PAGE)).toEqual([1]);
    expect(listPartialNote(contract, ANSWER, PAGE)).toMatch(/^部分完成：第 1 条/);
  });
  it('item 1 showing its price: 「未获取到」 is still sent back', () => {
    const priced = PAGE.replace('See options', 'Price, product page\n$9.99');
    expect(declaredMissingPriceRows(ANSWER, priced)).toEqual([]);
  });
  it('no 「See options」 and no cut after the item: still sent back', () => {
    const noState = PAGE.replace('See options', '').replace('[快照截断：以下内容未读到]', '');
    expect(declaredMissingPriceRows(ANSWER, noState)).toEqual([]);
  });
});

describe('FIX-35 0a · a post to the site’s own verification page is a wall, handed over', () => {
  it.each([
    'https://www.amazon.com/checkpoint/validate',
    'https://www.amazon.sg/errors/validateCaptcha?amzn=1',
    'https://example.org/captcha/verify',
  ])('%s', (url) => {
    expect(verificationPost(url)).toBe(true);
  });
  it.each([
    'https://www.amazon.com/cart/add-to-cart/ref=1',
    'https://www.amazon.com/gp/buy/spc/handlers/display.html',
    'https://www.amazon.com.evil.example/checkpoint/validate',
    'https://www.bestbuy.com/checkpoint-deals',
  ])('%s is not', (url) => {
    expect(verificationPost(url)).toBe(false);
  });
});

describe('FIX-35 #1 · plain JSON in prose is not a tool call', () => {
  it.each([
    '用户数据示例：{"name":"Alice","args":["--verbose"]}，其中 args 是命令行参数。',
    '返回体形如 {"name": "Bob", "input": "hello"}，name 是用户名。',
  ])('%s stays', (text) => {
    expect(stripToolCallMarkup(text)).toBe(text);
    expect(deliverableAnswer(text)).toBe(text);
  });
  it.each([
    '第一条结果售价 $14.99。\n{"name":"browser_use","input":{"action":"navigate"}}',
    '第一条结果售价 $14.99。\n{"name":"web_search","query":"x"}',
    '第一条结果售价 $14.99。\n{"name":"search","arguments":{"q":"x"}}',
  ])('%s is still removed', (text) => {
    expect(deliverableAnswer(text)).toBe('第一条结果售价 $14.99。');
  });
});
