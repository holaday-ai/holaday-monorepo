import { describe, expect, it } from 'vitest';
import { unsupportedSpecPricePairings } from './spec-price-pairing.js';

// FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh).
const NEWSROOM = [
  'Apple 发布 iPhone 16 Pro 和 iPhone 16 Pro Max',
  'iPhone 16 Pro 和 iPhone 16 Pro Max 提供沙漠色、原色、白色和黑色四种外观。',
  'iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量。',
  '价格及供货情况',
  'iPhone 16 Pro 以 RMB 7,999 起售，iPhone 16 Pro Max 以 RMB 9,999 起售。',
].join('\n');
const INTENT = 'iPhone 16 Pro Max 在中国的起售价是多少？';

describe('unsupportedSpecPricePairings', () => {
  it('sends back the online answer: 128GB entry price that the page never pairs, and the 「通常更高」 guess', () => {
    const answer =
      'iPhone 16 Pro Max 的起售价为 RMB 9,999，该机型提供 256GB 容量配置。需要注意的是，这是 128GB 入门版的起售价格，256GB 版本的价格通常会更高。';
    const out = unsupportedSpecPricePairings(answer, [NEWSROOM], INTENT);
    expect(out.join('\n')).toContain('128gb');
    expect(out.some((l) => l.includes('推测'))).toBe(true);
  });

  it('passes the same facts written as the page shows them', () => {
    const answer =
      'iPhone 16 Pro Max 以 RMB 9,999 起售，提供 256GB、512GB 和 1TB 容量（来源：Apple 新闻稿）。';
    expect(unsupportedSpecPricePairings(answer, [NEWSROOM], INTENT)).toEqual([]);
  });

  it('a capacity paired with a price that sits right beside it on a product card passes', () => {
    const card = ['Apple/苹果 iPhone 16 Pro 128GB 原色钛金属', '¥7999', '已售 1万+'].join('\n');
    expect(
      unsupportedSpecPricePairings('iPhone 16 Pro 128GB 售价 ¥7,999。', [card], '京东 iPhone 价格'),
    ).toEqual([]);
  });

  it('the wrong capacity for a price shown on the page is sent back', () => {
    const card = ['iPhone 16 Pro 256GB', '¥8999', 'iPhone 16 Pro 128GB', '¥7999'].join('\n');
    // 128GB is on the page, but not within reach of ¥9999 — there is no ¥9999 at all.
    expect(
      unsupportedSpecPricePairings('iPhone 16 Pro 128GB 售价 ¥9,999。', [card], 'iPhone 价格'),
    ).toHaveLength(1);
  });

  it('says nothing when the answer says it did not read the price, or the task is not about price', () => {
    expect(unsupportedSpecPricePairings('128GB 版本的价格没读到。', [NEWSROOM], INTENT)).toEqual(
      [],
    );
    expect(
      unsupportedSpecPricePairings('这台手机有 128GB 存储。', [NEWSROOM], '这台手机多大存储'),
    ).toEqual([]);
    // FIX-61 wrap-up wording: an honest 「没有列出 256GB 的价格」 claims no pairing.
    expect(
      unsupportedSpecPricePairings(
        '部分完成：官网已不再直接销售这款，没有列出 256GB 的价格；还缺具体售价。',
        [NEWSROOM],
        'iPhone 16 Pro Max 256GB 多少钱',
      ),
    ).toEqual([]);
  });

  it('a length on an Amazon card title (1M) is no capacity and is left alone', () => {
    const card = [
      'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord, Switch, 1M',
      'S$10.92',
    ].join('\n');
    expect(
      unsupportedSpecPricePairings(
        'UGREEN 2 Pack USB C to USB C Charger Cable…1M — S$10.92',
        [card],
        '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
      ),
    ).toEqual([]);
  });
});
