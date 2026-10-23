import { describe, expect, it } from 'vitest';
import { declaredMissingPriceRows, listPartialNote } from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import { passiveTelemetryRequest, postBodyShape } from './cloud-observation.js';
import {
  SNAPSHOT_TRUNCATED,
  assessCompletionFacts,
  observedEvidence,
} from './completion-fields.js';

/**
 * FIX-34 #2 (Deploy-34 new-amazon-sg, 2/2 VISION_GAVE_UP): item 3's price was cut off the
 * listing snapshot; an honest 「未获取到」 was sent back, and S$21.41 read beside item 3 was
 * rejected as 「所属页面未成功读取」 and contradicted by 「kitchen bestsellers under s$30」.
 */
const T1 = 'BELKIN BRAIDED USBC-TO-C 2.0 100W CABLE 2M-BLK';
const T2 =
  'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord Compatible with iPhone 15 Pro Max, MacBook Pro, iPad Pro, Dell, Matebook, Chromebook, Pixel, Samsung S23 S22, Switch, 1M';
const T3 = T2.replace(/1M$/, '2M');
const LISTING = 'https://www.amazon.sg/s?k=usb+c+cable&ref=nb_sb_noss';

/** The search results snapshot as the cloud observation returns it (tree cut at its budget). */
function listing(truncated: boolean, item3Price?: string) {
  const tree = [
    '- searchbox "Search Amazon.sg" [ref=e20]: usb c cable',
    `- link "${T1}" [ref=e255]`,
    '- link "S$8.90" [ref=e276]',
    `- link "${T2}" [ref=e331]`,
    '- link "S$17.29" [ref=e344]',
    '- heading "Kitchen bestsellers under S$30" [ref=e360]',
    '- generic: Kitchen bestsellers under S$30',
    `- link "${T3}" [ref=e394]`,
    ...(item3Price ? [`- link "${item3Price}" [ref=e409]`] : []),
  ].join('\n');
  const raw = JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree, truncated });
  return observedEvidence(raw, tree, LISTING);
}
const rows = (third: string) =>
  `在亚马逊新加坡站搜索“usb c cable”，前三个商品的名称和价格（照页面原样）：\n\n1. 名称：${T1}；价格：S$8.90\n2. 名称：${T2}；价格：S$17.29\n3. 名称：${T3}；价格：${third}`;
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

describe('FIX-34 #2 · amazon.sg: each item is checked against its own listing row', () => {
  it('a truncated snapshot marks the cut, and 「未获取到」 for the cut item is 部分完成', () => {
    const page = listing(true);
    expect(page.text.endsWith(SNAPSHOT_TRUNCATED)).toBe(true);
    const answer = rows('未获取到（快照中该商品的价格区域被截断，未读到具体价格文本）');
    expect(declaredMissingPriceRows(answer, page.text)).toEqual([3]);
    expect(listPartialNote(rowsContract, answer, page.text)).toMatch(/^部分完成：第 3 条/);
  });
  it('not truncated and the price is shown: 「未获取到」 is still sent back', () => {
    const page = listing(false, 'S$21.41');
    expect(page.text).not.toContain(SNAPSHOT_TRUNCATED);
    expect(declaredMissingPriceRows(rows('未获取到'), page.text)).toEqual([]);
  });
  it('S$21.41 shown beside item 3 is grounded, though the answer binds it to an unread tab', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.41（从该商品详情页获取）'),
      fields: [
        { name: '商品3名称', value: T3, tabId: 'tab_detail' },
        { name: '商品3价格', value: 'S$21.41', tabId: 'tab_detail' },
      ],
      pages: [listing(false, 'S$21.41')],
    });
    expect(facts.contradictions).toEqual([]);
  });
  it('「kitchen bestsellers under s$30」 does not contradict an item price on a listing', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.41'),
      pages: [listing(false, 'S$21.41')],
    });
    expect(facts.contradictions.join('；')).not.toMatch(/kitchen/i);
  });
  it('a price shown nowhere beside item 3, bound to an unread tab, is still refused', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$19.49'),
      fields: [{ name: '商品3价格', value: 'S$19.49', tabId: 'tab_detail' }],
      pages: [listing(false, 'S$21.41')],
    });
    expect(facts.contradictions.join('；')).toMatch(/未成功读取/);
  });
  it('a single-product page still contradicts a different price (FIX-32 kept)', () => {
    const page = observedEvidence(
      'x',
      '- generic [ref=e12]: S$15.82',
      'https://www.amazon.sg/dp/B0',
    );
    expect(
      assessCompletionFacts({ summary: '价格：S$14.99', pages: [page] }).contradictions,
    ).toEqual([expect.stringContaining('与页面不符')]);
  });
});

describe('FIX-34 #3 · BestBuy: only the verified event stream is telemetry', () => {
  it.each([
    'https://streams.bestbuy.com/customer/web-streams/v1/events/digital-experience-event',
    'https://streams.bestbuy.com/customer/web-streams/v2/events/search-event',
  ])('%s is telemetry', (url) => {
    expect(passiveTelemetryRequest(new URL(url), 'fetch')).toBe(true);
  });
  it.each([
    // The opaque POST from the same production trace stays unknown (pauses) until verified.
    'https://www.bestbuy.com/UwDIPyzV11/p0Vavwpy92/GzamhpEV/EBt0AQ/L0o/-O0UPdlMY',
    'https://streams.bestbuy.com.evil.example/customer/web-streams/v1/events/x',
    'https://streams.bestbuy.com/customer/web-streams/v1/cart/add',
    'https://www.bestbuy.com/customer/web-streams/v1/events/digital-experience-event',
  ])('%s is not', (url) => {
    expect(passiveTelemetryRequest(new URL(url), 'fetch')).toBe(false);
  });
  it('an unknown POST records its body shape — key names and length, never values', () => {
    expect(postBodyShape('{"sensor_data":"3;0;1;0;secret"}')).toBe('json{sensor_data} 32B');
    expect(postBodyShape('a=1&token=xyz')).toBe('form{a,token} 13B');
    expect(postBodyShape('\u0001\u0002binary')).toBe('opaque 8B');
    expect(postBodyShape('{"sensor_data":"x"}')).not.toContain('"x"');
  });
});
