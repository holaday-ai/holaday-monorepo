import { describe, expect, it } from 'vitest';
import { unsupportedSpecPricePairings as check } from './spec-price-pairing.js';

// FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh), with 复审 #2's cases.
const NEWSROOM = [
  'Apple 发布 iPhone 16 Pro 和 iPhone 16 Pro Max',
  'iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量。',
  '价格及供货情况',
  'iPhone 16 Pro Max 以 RMB 9,999 起售。',
].join('\n');
const INTENT = 'iPhone 16 Pro Max 在中国的起售价是多少？';

describe('FIX-62 P0-2: capacity ↔ price pairings', () => {
  it('sends back the online answer: the 128GB pairing and the 「通常更高」 guess', () => {
    const answer =
      'iPhone 16 Pro Max 的起售价为 RMB 9,999，该机型提供 256GB 容量配置。需要注意的是，这是 128GB 入门版的起售价格，256GB 版本的价格通常会更高。';
    const out = check(answer, [NEWSROOM], INTENT);
    expect(out.join('\n')).toContain('128GB');
    expect(out.some((l) => l.includes('推测'))).toBe(true);
  });

  it('passes the facts as the page shows them', () => {
    expect(
      check(
        'iPhone 16 Pro Max 以 RMB 9,999 起售，提供 256GB、512GB 和 1TB 容量。',
        [NEWSROOM],
        INTENT,
      ),
    ).toEqual([]);
  });

  it('a card price with .00 is the same price (复审 #2 误伤 1)', () => {
    const card = ['Apple iPhone 16 Pro 128GB 原色钛金属', '¥7999.00', '已售 1万+'].join('\n');
    expect(check('iPhone 16 Pro 128GB 售价 ¥7,999。', [card], '京东 iPhone 价格')).toEqual([]);
  });

  it('a capacity paired with a price far from it on the page is sent back', () => {
    const page = [
      'iPhone 16 Pro 128GB',
      '¥7999',
      ...Array(9).fill('x'),
      'iPhone 16 Pro 256GB',
      '¥8999',
    ].join('\n');
    expect(check('128GB ¥7,999，256GB ¥8,999。', [page], 'iPhone 价格')).toEqual([]);
    expect(check('128GB 售价 ¥8,999。', [page], 'iPhone 价格')).toHaveLength(1);
  });

  it('1TB and 8+128 are capacities (复审 #2 漏网 3)', () => {
    const pro = ['iPhone 16 Pro 256GB', '¥8999'].join('\n');
    expect(check('1TB 售价 ¥8,999。', [pro], 'iPhone 价格')).toHaveLength(1);
    const card = ['小米 15 8+128 黑色', '¥3999'].join('\n');
    expect(check('小米 15 8+128 售价 ¥3,999。', [card], '小米 15 多少钱')).toEqual([]);
    expect(check('小米 15 12+256 售价 ¥3,999。', [card], '小米 15 多少钱')).toHaveLength(1);
  });

  it('500g is grams, and RM prices are prices (复审 #2 误伤 5)', () => {
    const page = ['Nescafe Gold 500g', 'RM 45.90'].join('\n');
    expect(check('Nescafe Gold 500g 售价 RM 45.90。', [page], 'price of nescafe')).toEqual([]);
  });

  it('comparing two prices the pages show is no guess (复审 #2 误伤 4)', () => {
    const page = ['iPhone 16 Pro 256GB 京东价 ¥8499', 'Apple 官网 256GB ¥8999'].join('\n');
    expect(
      check(
        '256GB 京东价 ¥8,499，一般比官网 ¥8,999 更便宜。',
        [page],
        'iPhone 16 Pro 256GB 多少钱',
      ),
    ).toEqual([]);
  });

  it('a guess without 通常 but with a number is checked as a pairing (复审 #2 漏网 5)', () => {
    expect(check('128GB 版本会便宜 1000 元左右。', [NEWSROOM], INTENT)).toHaveLength(1);
  });

  it('only a clause that says it did not read the price is exempt (复审 #2 漏网 4)', () => {
    expect(check('256GB 版本的价格没读到。', [NEWSROOM], INTENT)).toEqual([]);
    expect(
      check('128GB 入门版售价 RMB 9,999（是否含税不确定）。', [NEWSROOM], INTENT),
    ).toHaveLength(1);
  });

  it('honest wrap-up wording stays: 「没有列出 256GB 的价格；还缺具体售价」', () => {
    expect(
      check(
        '部分完成：官网已不再直接销售这款，没有列出 256GB 的价格；还缺具体售价。',
        [NEWSROOM],
        'iPhone 16 Pro Max 256GB 多少钱',
      ),
    ).toEqual([]);
  });

  it('a non-price task and a length (1M) on an Amazon title are left alone', () => {
    expect(check('这台手机有 128GB 存储。', [NEWSROOM], '这台手机多大存储')).toEqual([]);
    const card = [
      'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord, Switch, 1M',
      'S$10.92',
    ].join('\n');
    expect(
      check(
        'UGREEN 2 Pack USB C to USB C Charger Cable…1M — S$10.92',
        [card],
        '列出前三个的名称和价格',
      ),
    ).toEqual([]);
  });

  it('English: a guess sentence is its own sentence, not the paragraph (复审 #2 误伤 4)', () => {
    const page = ['iPhone 16 Pro Max', '256GB', 'From $1,199'].join('\n');
    expect(
      check(
        'The iPhone 16 Pro Max 256GB starts at $1,199. Larger storage models are usually more expensive.',
        [page],
        'iPhone 16 Pro Max price',
      ),
    ).toHaveLength(1);
    expect(
      check('The iPhone 16 Pro Max 256GB starts at $1,199.', [page], 'iPhone 16 Pro Max price'),
    ).toEqual([]);
  });

  it('复审 #3 layouts are not sent back: price above title, table cells, configurator, 分别为', () => {
    const priceFirst = [
      '¥7999',
      'Apple iPhone 16 Pro 128GB',
      '¥8999',
      'Apple iPhone 16 Pro 256GB',
    ].join('\n');
    expect(check('iPhone 16 Pro 256GB ¥8,999。', [priceFirst], 'iPhone 价格')).toEqual([]);
    const cells = ['容量', '128GB', '256GB', '512GB', '价格', '¥7999', '¥8999', '¥10999'].join(
      '\n',
    );
    expect(check('128GB ¥7,999，512GB ¥10,999。', [cells], 'iPhone 价格')).toEqual([]);
    const config = [
      '选择容量',
      '256GB',
      '512GB',
      '1TB',
      '颜色',
      '沙漠色',
      '原色',
      'RMB 9,999 起',
    ].join('\n');
    expect(check('256GB 版 RMB 9,999 起。', [config], 'iPhone 价格')).toEqual([]);
    const both = ['128GB ¥7999', '256GB ¥8999'].join('\n');
    expect(check('128GB、256GB 售价分别为 ¥7,999、¥8,999。', [both], 'iPhone 价格')).toEqual([]);
  });

  it('5G is a network, not a capacity', () => {
    const page = ['华为 Mate 60 5G 版', '¥5999'].join('\n');
    expect(check('Mate 60 5G 版售价 ¥5,999。', [page], 'Mate 60 多少钱')).toEqual([]);
  });

  it('the incident wording is sent back even when 128GB is elsewhere on the page (another model)', () => {
    const page = [
      'iPhone 16 Pro 提供 128GB、256GB、512GB 和 1TB 容量。',
      'iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量。',
      '新机采用钛金属设计，提供四种外观。',
      '机身更轻，屏幕更大。',
      '价格及供货情况',
      'iPhone 16 Pro Max 以 RMB 9,999 起售。',
    ].join('\n');
    expect(
      check(
        'iPhone 16 Pro Max 的起售价为 RMB 9,999。这是 128GB 入门版的起售价格。',
        [page],
        INTENT,
      ),
    ).toHaveLength(1);
    // Split over two lines: 「对应 128GB 版本」 points at the line before's price.
    expect(check('起售价 RMB 9,999\n对应 128GB 版本', [page], INTENT)).toHaveLength(1);
  });

  it('复审 #4: pointing sentences on common layouts are not sent back', () => {
    const news = [
      'iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量。',
      '新机采用钛金属设计。',
      'iPhone 16 Pro Max 以 RMB 9,999 起售。',
    ].join('\n');
    expect(check('起售价 RMB 9,999。这是 256GB 版本的价格。', [news], INTENT)).toEqual([]);
    expect(check('起售价 RMB 9,999，对应 256GB 起步容量。', [news], INTENT)).toEqual([]);
    const card = [
      'Apple iPhone 15 (128 GB) - Black',
      '4.6 out of 5 stars',
      'List: $829.00',
      '$729.00',
    ].join('\n');
    expect(
      check('It costs $729. That is for the 128 GB model.', [card], 'iPhone 15 price'),
    ).toEqual([]);
  });

  it('复审 #4: the incident and its variants are caught when the 128GB on the page is another model’s', () => {
    // Both models in one paragraph, as Apple newsrooms write.
    const sameLine =
      'iPhone 16 Pro 提供 128GB、256GB、512GB 和 1TB 容量，iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量；iPhone 16 Pro 以 RMB 7,999 起售，iPhone 16 Pro Max 以 RMB 9,999 起售。';
    for (const answer of [
      'iPhone 16 Pro Max 的起售价为 RMB 9,999。这是 128GB 入门版的起售价格。',
      '起售价 RMB 9,999\n对应 128GB 版本',
      'RMB 9,999 是 128GB 版本的起售价。',
      'iPhone 16 Pro Max 起售价 RMB 9,999（128GB）。',
    ])
      expect(check(answer, [sameLine], INTENT)).toHaveLength(1);
    // The right pairing on the same page passes.
    expect(check('iPhone 16 Pro Max 256GB 起售价 RMB 9,999。', [sameLine], INTENT)).toEqual([]);
  });

  it('复审 #5: model words that are not models, pages naming several models, the base model', () => {
    const both =
      'iPhone 16 Pro 和 iPhone 16 Pro Max 提供 256GB、512GB 和 1TB 容量。\niPhone 16 Pro 以 RMB 8,999 起售。';
    expect(check('iPhone 16 Pro 256GB 售价 RMB 8,999。', [both], 'iPhone 16 Pro 多少钱')).toEqual(
      [],
    );
    const base =
      'iPhone 16 和 iPhone 16 Plus 提供 128GB、256GB 和 512GB 容量。\niPhone 16 以 RMB 5,999 起售。';
    expect(
      check(
        'iPhone 16 Pro Max 起售价 RMB 9,999。iPhone 16 标准版 128GB 售价 RMB 5,999。',
        [base, NEWSROOM],
        'iPhone 16 系列价格',
      ),
    ).toEqual([]);
    const jd = ['Apple iPhone 16 Pro 128GB 原色', '¥7899 PLUS会员价'].join('\n');
    expect(check('128GB 版本京东 PLUS 会员价 ¥7,899。', [jd], 'iPhone 16 Pro 价格')).toEqual([]);
    const amazon = ['Samsung Galaxy S24 Ultra 256GB', '$19.99'].join('\n');
    expect(check('The 256GB case costs $19.99 plus shipping.', [amazon], 'case price')).toEqual([]);
    const caseCard = ['iPhone 15 Pro 128GB Case Plus Screen Protector', '¥99'].join('\n');
    expect(check('iPhone 15 Pro 128GB 手机壳 ¥99。', [caseCard], '手机壳价格')).toEqual([]);
    const pro = 'iPhone 16 Pro 提供 128GB、256GB 容量。\niPhone 16 Pro 以 RMB 7,999 起售。';
    expect(
      check(
        'iPhone 16 Pro Max 起售价 RMB 9,999。而 128GB 起步的那款售价 RMB 7,999。',
        [pro, NEWSROOM],
        'iPhone 16 价格',
      ),
    ).toEqual([]);
  });
});
