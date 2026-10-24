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
  it('a carousel heading and rating nodes between the cut item and the cut do not count as its price', () => {
    const tree = [
      `- link "${T1}" [ref=e255]`,
      '- link "S$8.90" [ref=e276]',
      `- link "${T2}" [ref=e331]`,
      '- link "S$17.29" [ref=e344]',
      `- link "${T3}" [ref=e394]`,
      '- link "4.5 out of 5 stars, rating details" [ref=e400]',
      '- link "12,345 ratings" [ref=e401]',
      '- generic [ref=e402]: 1K+ bought in past month',
      '- generic [ref=e403]: Climate Pledge Friendly — products with sustainability certifications',
      '- heading "Kitchen bestsellers under S$30" [ref=e404]',
      '- link "Shop now" [ref=e405]',
    ].join('\n');
    const raw = JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree, truncated: true });
    const page = observedEvidence(raw, tree, LISTING);
    expect(declaredMissingPriceRows(rows('未获取到（快照截断）'), page.text)).toEqual([3]);
    // The same page with item 3's own price before the cut: still sent back.
    const priced = tree.replace('- link "4.5 out', '- link "S$21.41" [ref=e399]\n- link "4.5 out');
    const pricedPage = observedEvidence(
      JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree: priced, truncated: true }),
      priced,
      LISTING,
    );
    expect(declaredMissingPriceRows(rows('未获取到'), pricedPage.text)).toEqual([]);
  });
  it('the cut is marked where the tree ends, before the text that follows it (f34e)', () => {
    const tree = [
      `- link "${T1}" [ref=e255]`,
      '- link "S$8.90" [ref=e276]',
      `- link "${T2}" [ref=e331]`,
      '- link "S$17.29" [ref=e344]',
      `- link "${T3}" [ref=e393]:`,
      '  - /url: https://www.amazon.sg/UGREEN/dp/B08D6NCQ1Z/ref=sr_1_3',
      `- heading "${T3}" [level=2] [ref=e394]`,
      '- button "4.7 out of 5 stars, rating details" [ref=e398]',
      '- link "20,384 ratings" [ref=e402]:',
      '  - /url: https://www.amazon.sg/UGREEN/dp/B08D6NCQ1Z/ref=sr_1_3?dib=eyJ2Ij',
    ].join('\n');
    // The decoded observation goes on after the tree: the page's headings — other
    // results, some with prices.
    const decoded = `${tree}\n1-48 of over 6,000 results for "usb c cable"\nAnker USB C Cable S$12.99\nRelated searches\nNeed help?`;
    const raw = JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree, truncated: true });
    const page = observedEvidence(raw, decoded, LISTING);
    expect(page.text.indexOf(SNAPSHOT_TRUNCATED)).toBeLessThan(page.text.indexOf('1-48 of'));
    expect(declaredMissingPriceRows(rows('未获取到（快照截断）'), page.text)).toEqual([3]);
  });
  it('not truncated and the price is shown: 「未获取到」 is still sent back', () => {
    const page = listing(false, 'S$21.41');
    expect(page.text).not.toContain(SNAPSHOT_TRUNCATED);
    expect(declaredMissingPriceRows(rows('未获取到'), page.text)).toEqual([]);
  });
  // 协调方复审阻塞 2：名称与价格必须在同一个商品卡（快照的同一元素块）里。
  const SEARCHBOX = '- searchbox "Search Amazon.sg" [ref=e20]: usb c cable';
  /** A results list as the snapshot nests it: one listitem per product card. */
  const cards = (items: Array<[string, string | null]>) =>
    [
      '- list:',
      ...items.flatMap(([title, price], k) => [
        `  - listitem [ref=e${k}0]:`,
        `    - link "${title}" [ref=e${k}1]:`,
        `      - /url: https://www.amazon.sg/x/dp/B0${k}/ref=sr_1_${k + 1}`,
        `      - heading "${title}" [level=2] [ref=e${k}2]`,
        `    - button "4.7 out of 5 stars, rating details" [ref=e${k}3]`,
        ...(price ? [`    - link "${price}" [ref=e${k}4]`] : []),
      ]),
    ].join('\n');
  const cardPage = (cardTree: string, tree = `${SEARCHBOX}\n${cardTree}`) =>
    observedEvidence(
      JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree }),
      tree,
      LISTING,
    );
  it('S$21.41 in item 3’s own card is grounded, though the answer binds it to an unread tab', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.41（从该商品详情页获取）'),
      fields: [
        { name: '商品3名称', value: T3, tabId: 'tab_detail' },
        { name: '商品3价格', value: 'S$21.41', tabId: 'tab_detail' },
      ],
      pages: [
        cardPage(
          cards([
            [T1, 'S$8.90'],
            [T2, 'S$17.29'],
            [T3, 'S$21.41'],
          ]),
        ),
      ],
    });
    expect(facts.contradictions).toEqual([]);
  });
  it('a variant sharing the first 40 characters does not borrow its price (Codex review #297)', () => {
    // Only the 1M cable and its price were read; the answer names the 2M variant.
    const tree = [`- link "${T2}" [ref=e331]`, '- link "S$17.29" [ref=e344]'].join('\n');
    const page = observedEvidence(
      JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree }),
      tree,
      LISTING,
    );
    const facts = assessCompletionFacts({
      summary: `1. 名称：${T3}；价格：S$17.29`,
      fields: [
        { name: '商品1名称', value: T3, tabId: 'tab_detail' },
        { name: '商品1价格', value: 'S$17.29', tabId: 'tab_detail' },
      ],
      pages: [page],
    });
    expect(facts.contradictions.join('；')).toMatch(/未成功读取/);
  });
  it('the next card’s price is not item 3’s, however close it is', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.41'),
      fields: [{ name: '商品3价格', value: 'S$21.41', tabId: 'tab_detail' }],
      pages: [
        cardPage(
          cards([
            [T1, 'S$8.90'],
            [T2, 'S$17.29'],
            [T3, null],
            ['Anker USB C to USB C Cable 240W 6ft Braided', 'S$21.41'],
          ]),
        ),
      ],
    });
    expect(facts.contradictions.join('；')).toMatch(/未成功读取/);
  });
  it('a 2M title is not found in the 1M card that shares its prefix', () => {
    const facts = assessCompletionFacts({
      summary: `1. 名称：${T3}；价格：S$17.29`,
      fields: [{ name: '商品1价格', value: 'S$17.29', tabId: 'tab_detail' }],
      pages: [cardPage(cards([[T2, 'S$17.29']]))],
    });
    expect(facts.contradictions.join('；')).toMatch(/未成功读取/);
  });
  it('a page without element structure grants no exemption (the page is read instead)', () => {
    const tree = [`- link "${T3}" [ref=e394]`, '- link "S$21.41" [ref=e409]'].join('\n');
    const facts = assessCompletionFacts({
      summary: `3. 名称：${T3}；价格：S$21.41`,
      fields: [{ name: '商品3价格', value: 'S$21.41', tabId: 'tab_detail' }],
      pages: [cardPage(tree)],
    });
    expect(facts.binding).toEqual([expect.objectContaining({ kind: 'unread' })]);
  });
  it('「kitchen bestsellers under s$30」 does not contradict an item price on a listing', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.41'),
      pages: [listing(false, 'S$21.41')],
    });
    expect(facts.contradictions.join('；')).not.toMatch(/kitchen/i);
  });
  it('a price bound to an unread detail tab gets only the binding correction (f34h)', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$21.53'),
      fields: [{ name: '商品3价格', value: 'S$21.53', tabId: 'tab_detail' }],
      pages: [listing(true)],
    });
    expect(facts.contradictions).toHaveLength(1);
    expect(facts.binding).toEqual([expect.objectContaining({ kind: 'unread' })]);
  });
  it('a made-up price bound to the listing tab itself is still sent back (f34i)', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$18.88'),
      fields: [{ name: '商品3价格', value: 'S$18.88', tabId: 'tab_list' }],
      pages: [listing(true)],
    });
    expect(facts.contradictions.join('；')).toMatch(/不在任何已读页面上/);
  });
  it('「from S$19.99」 after the cut item is its price, so 「未获取到」 is sent back (review)', () => {
    const tree = [
      `- link "${T1}" [ref=e255]`,
      '- link "S$8.90" [ref=e276]',
      `- link "${T2}" [ref=e331]`,
      '- link "S$17.29" [ref=e344]',
      `- link "${T3}" [ref=e394]`,
      '- generic [ref=e395]: from S$19.99',
    ].join('\n');
    const page = observedEvidence(
      JSON.stringify({ tabId: 'tab_list', sourceURL: LISTING, tree, truncated: true }),
      tree,
      LISTING,
    );
    expect(declaredMissingPriceRows(rows('未获取到'), page.text)).toEqual([]);
  });
  it('a made-up 「原价 S$x」 note is not refused on its own; the made-up price is (review)', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$18.88（原价 S$23.93）'),
      pages: [listing(true)],
    });
    const all = facts.contradictions.join('；');
    expect(all).toMatch(/价格「S\$18\.88（原价 S\$23\.93）」 不在任何已读页面上/);
    // The note's own fact (原价 S$23.93) is not a whole price value: not refused by itself.
    expect(facts.contradictions.filter((c) => c.startsWith('价格（括注）'))).toEqual([]);
  });
  it('「未获取到（…）」 in a field is an absence, not an unverified value (f34g)', () => {
    const facts = assessCompletionFacts({
      summary: rows('未获取到（快照截断）'),
      fields: [{ name: '第3个商品价格', value: '未获取到（该条目在快照中未显示价格）' }],
      pages: [listing(true)],
    });
    expect(facts.unverified.join('；')).not.toContain('未获取到');
  });
  it('a listed price that no read page shows is sent back (f34f: S$17.90 for the cut item)', () => {
    const facts = assessCompletionFacts({
      summary: rows('S$17.90'),
      pages: [listing(true)],
    });
    expect(facts.contradictions.join('；')).toMatch(/不在任何已读页面上/);
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
