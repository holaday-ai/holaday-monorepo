import { describe, expect, it } from 'vitest';
import {
  unsupportedSpecPricePairings as check,
  partialAnswerPrices,
  withoutUnmatchedPrices,
} from './spec-price-pairing.js';

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

  it('复审 #6: S24+ is the Plus, Mate 60 Pro+ is not the Pro, 小米 14 Ultra is no base, Windows Pro is no model', () => {
    const s24 = [
      'Samsung Galaxy S24 Plus 256GB',
      '¥7999',
      'Samsung Galaxy S24 256GB',
      '¥5999',
    ].join('\n\n\n\n\n\n\n\n\n\n');
    expect(check('Galaxy S24+ 256GB ¥7,999。', [s24], 'S24+ 价格')).toEqual([]);
    const plusOnly = ['Samsung Galaxy S24+ 256GB', '¥7999'].join('\n');
    expect(check('Galaxy S24 256GB ¥7,999。', [plusOnly], 'Galaxy S24 价格')).toHaveLength(1);
    const mate = ['华为 Mate 60 Pro+ 512GB', '¥8999'].join('\n');
    expect(check('Mate 60 Pro 512GB ¥8,999。', [mate], 'Mate 60 Pro 价格')).toHaveLength(1);
    const mi = ['小米 14 512GB', '¥4999'].join('\n');
    expect(check('小米 14 Ultra 512GB ¥4,999。', [mi], '小米 14 Ultra 价格')).toHaveLength(1);
    const xps = ['Dell XPS 13 Plus 512GB SSD Windows 11 Pro', '$1,299'].join('\n');
    expect(check('XPS 13 Plus 512GB $1,299.', [xps], 'XPS 13 Plus price')).toEqual([]);
  });

  it('复审 #7: bundles 「Pro + AppleCare+」「Pro +保护壳」 are the Pro; Pro XL is not the Pro', () => {
    const bundle = ['Apple iPhone 16 Pro + AppleCare+ 256GB 套装', '¥9498'].join('\n');
    expect(check('iPhone 16 Pro 256GB 套装 ¥9,498。', [bundle], 'iPhone 16 Pro 价格')).toEqual([]);
    const caseBundle = ['iPhone 15 Pro +保护壳 128GB', '¥6999'].join('\n');
    expect(check('iPhone 15 Pro 128GB ¥6,999。', [caseBundle], 'iPhone 15 Pro 价格')).toEqual([]);
    const pixel = ['Google Pixel 9 Pro 256GB', '$999'].join('\n');
    expect(check('Pixel 9 Pro XL 256GB $999.', [pixel], 'Pixel 9 Pro XL price')).toHaveLength(1);
    expect(check('Pixel 9 Pro 256GB $999.', [pixel], 'Pixel 9 Pro price')).toEqual([]);
  });
});

// FIX-62 P0-3 (f62i1): a failure explanation's price must be this item's on a read page.
describe('FIX-62 P0-3: prices in a failure / partial explanation', () => {
  const COMPARE = [
    '机型比较',
    'iPhone 17 Pro Max',
    'RMB 9,999 起',
    'iPhone 17 Pro',
    'RMB 9,299 起',
    'iPhone 16 Pro Max',
    '于授权经销商处有售',
  ].join('\n');
  const F62I1 =
    '未能拿到 iPhone 16 Pro Max 256GB 的当前在售价格。已确认：Apple 官网对比页显示该机型起售价为「RMB 9,299 起」，但官网购买链接已返回 404。';
  it('f62i1: the other model’s 9,299 is not said as the 16 Pro Max’s', () => {
    const out = withoutUnmatchedPrices(F62I1, [COMPARE], 'iPhone 16 Pro Max 256GB 多少钱');
    expect(out).not.toMatch(/9,299/);
    expect(out).toContain('（没读到准确价格）');
    expect(out).toContain('官网购买链接已返回 404');
  });
  it('a price the page gives this model is kept; one no page shows goes', () => {
    const page = ['iPhone 16 Pro Max', 'RMB 9,999 起'].join('\n');
    expect(
      withoutUnmatchedPrices(
        '官网显示 iPhone 16 Pro Max 起售价 RMB 9,999 起，但已停售。',
        [page],
        'iPhone 16 Pro Max 多少钱',
      ),
    ).toContain('RMB 9,999');
    expect(
      withoutUnmatchedPrices('京东价格是 ¥8,888，但需要登录。', [page], 'iPhone 16 Pro Max 多少钱'),
    ).not.toMatch(/8,888/);
  });
  it('text without prices is unchanged', () => {
    const text = '京东要登录才能看价格，官网已不再销售。';
    expect(withoutUnmatchedPrices(text, [COMPARE], 'iPhone 16 Pro Max 多少钱')).toBe(text);
  });
});

// FIX-62 iPhone run f62j2 (completed, red line): the comparison page's 18 Pro Max price was said as
// the 16 Pro Max's — 「iPhone 16 Pro Max 256GB 在 Apple 中国官网机型比较页显示的价格为 RMB 10,999 起」.
describe('FIX-62 f62j2: a model named in the task is priced from its own column or card', () => {
  const INTENT_16 = 'iPhone 16 Pro Max 256GB 多少钱';
  const ANSWER = 'iPhone 16 Pro Max 256GB 在 Apple 中国官网机型比较页显示的价格为 RMB 10,999 起。';
  it('column by column: 10,999 sits under 18 Pro Max → sent back', () => {
    const page = [
      'iPhone 机型比较',
      'iPhone 16 Pro Max',
      '于授权经销商处有售',
      '256GB 512GB 1TB',
      'iPhone 18 Pro Max',
      'RMB 10,999 起',
      '256GB 512GB 1TB 2TB',
      'iPhone 18 Pro',
      'RMB 9,299 起',
    ].join('\n');
    expect(check(ANSWER, [page], INTENT_16).join('\n')).toMatch(/挨着的是别的机型/);
  });
  it('row by row (a flattened table): no model beside the price → sent back', () => {
    const page = [
      'iPhone 16 Pro Max',
      'iPhone 18 Pro Max',
      'iPhone 18 Pro',
      '价格',
      '于授权经销商处有售',
      'RMB 10,999 起',
      'RMB 9,299 起',
    ].join('\n');
    expect(check(ANSWER, [page], INTENT_16).join('\n')).toMatch(/挨着的是别的机型/);
  });
  it('a store list with each card’s title above its price passes', () => {
    const page = [
      'Apple iPhone 16 Pro Max 256GB 原色钛金属',
      '¥8999',
      'Apple iPhone 16 Pro 256GB 黑色钛金属',
      '¥7999',
    ].join('\n');
    expect(check('iPhone 16 Pro Max 256GB 京东价 ¥8,999。', [page], INTENT_16)).toEqual([]);
    expect(check('iPhone 16 Pro Max 256GB 京东价 ¥7,999。', [page], INTENT_16).join()).toMatch(
      /挨着的是别的机型/,
    );
  });
  it('the same holds for a failure explanation (P0-3)', () => {
    const page = [
      'iPhone 16 Pro Max',
      '于授权经销商处有售',
      'iPhone 18 Pro Max',
      'RMB 10,999 起',
    ].join('\n');
    expect(withoutUnmatchedPrices(`没拿到准确价格；${ANSWER}`, [page], INTENT_16)).not.toMatch(
      /10,999/,
    );
  });
});

// FIX-62 iPhone run f62k2 (部分完成): the answer's own text named a refurbished price no read page
// was shown to give, with only a 未核实 line under it.
describe('FIX-62 P0-3 f62k2: a partial answer’s prices are checked like an explanation', () => {
  const K2 = [
    '部分完成：Apple 官网已不再直接销售 iPhone 16 Pro Max 256GB，因此无法从官网获取全新机售价。在 Apple 官方翻新商店页面读到的同款翻新机价格为 $929.00（Refurbished iPhone 16 Pro Max 256GB）。',
    '',
    '- Apple 官网全新机售价：官网已下架，未读到',
    '',
    '未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「$929.00（Refurbished iPhone 16 Pro Max 256GB）」',
  ].join('\n');
  const INTENT = 'iPhone 16 Pro Max 256GB 多少钱';
  it('a price no read page shows goes from the text; the 未核实 line stays as written', () => {
    const out = partialAnswerPrices(
      K2,
      [['iPhone 16 Pro Max', '于授权经销商处有售'].join('\n')],
      INTENT,
    );
    const [body] = out.split('\n');
    expect(body).not.toMatch(/929/);
    expect(body).toContain('（没读到准确价格）');
    expect(out).toContain('未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「$929.00');
  });
  it('the price the refurbished page gives this model is kept', () => {
    const page = [
      'Refurbished iPhone 16 Pro Max 256GB - Black Titanium (Unlocked)',
      '$929.00',
    ].join('\n');
    expect(partialAnswerPrices(K2, [page], INTENT)).toBe(K2);
  });
  it('a task naming no model is left alone (list answers keep their own checks)', () => {
    expect(partialAnswerPrices(K2, [], '帮我找 3 款 USB-C 数据线的价格')).toBe(K2);
  });
});

// FIX-62 复审 #8: what the partial-answer check must leave alone.
describe('FIX-62 复审 #8: partial answers keep the right prices and the person’s own numbers', () => {
  const INTENT = 'iPhone 16 Pro Max 256GB 多少钱';
  it('a list with each price above its title: the right price stays, the other card’s goes', () => {
    const page = ['¥8,999', 'iPhone 16 Pro', '¥9,999', 'iPhone 16 Pro Max'].join('\n');
    expect(
      partialAnswerPrices('部分完成：iPhone 16 Pro Max 售价 ¥9,999。', [page], INTENT),
    ).toContain('¥9,999');
    expect(
      partialAnswerPrices('部分完成：iPhone 16 Pro Max 售价 ¥8,999。', [page], INTENT),
    ).not.toMatch(/8,999/);
  });
  it('a card with its 「List」 price above the price: the price stays', () => {
    const page = ['Apple iPhone 16 Pro Max 256GB (Renewed)', 'List: $1,099.00', '$929.00'].join(
      '\n',
    );
    const text = '部分完成：亚马逊翻新 iPhone 16 Pro Max 256GB 为 $929.00。';
    expect(partialAnswerPrices(text, [page], INTENT)).toBe(text);
  });
  it('a budget, a conversion and a difference are left as written', () => {
    const page = ['iPhone 16 Pro Max', 'RMB 9,999 起'].join('\n');
    for (const text of [
      '部分完成：没有找到 ¥8,000 以内的 iPhone 16 Pro Max。',
      '部分完成：iPhone 16 Pro Max 官网 RMB 9,999 起，约合人民币 ¥8,600 的翻新机没读到。',
      '部分完成：iPhone 16 Pro Max 比官网便宜 ¥100 的渠道没找到。',
    ])
      expect(partialAnswerPrices(text, [page], INTENT)).toBe(text);
  });
  it('an English answer gets an English placeholder', () => {
    const out = partialAnswerPrices(
      'Partially completed: iPhone 16 Pro Max 256GB is $1,234 on Amazon.',
      [['iPhone 16 Pro Max', '$1,199'].join('\n')],
      'iPhone 16 Pro Max 256GB price',
    );
    expect(out).toContain('(exact price not read)');
    expect(out).not.toMatch(/[一-鿿]/);
  });
  it('a 未核实 line written as a list item is left as written', () => {
    const line = '- 未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「$929.00」';
    expect(partialAnswerPrices(`部分完成：没读到。\n${line}`, [], INTENT)).toContain(line);
  });
  it('when reads have dropped out, a price no kept read shows is kept (another model’s still goes)', () => {
    const compare = [
      'iPhone 17 Pro',
      'RMB 9,299 起',
      'iPhone 16 Pro Max',
      '于授权经销商处有售',
    ].join('\n');
    const absent = '部分完成：iPhone 16 Pro Max 京东价 ¥8,888。';
    expect(partialAnswerPrices(absent, [compare], INTENT, { absent: false })).toBe(absent);
    expect(
      partialAnswerPrices('部分完成：iPhone 16 Pro Max 官网 RMB 9,299 起。', [compare], INTENT, {
        absent: false,
      }),
    ).not.toMatch(/9,299/);
  });
});

// FIX-62 复审 #9: 「约 / about / 左右」 is how a price is written, not the person's own number; a page
// with two layouts is judged section by section.
describe('FIX-62 复审 #9: no exemption for 「约」, and layouts by section', () => {
  const INTENT = 'iPhone 16 Pro Max 256GB 多少钱';
  const COMPARE = [
    'iPhone 17 Pro Max',
    'RMB 9,299 起',
    'iPhone 16 Pro Max',
    '于授权经销商处有售',
  ].join('\n');
  it.each([
    '部分完成：iPhone 16 Pro Max 售价约 RMB 9,299。',
    '部分完成：iPhone 16 Pro Max 大概 RMB 9,299 左右。',
    '部分完成：iPhone 16 Pro Max 合约价 RMB 9,299。',
    '部分完成：iPhone 16 Pro Max 预约价 RMB 9,299。',
  ])('another model’s price written 「%s」 still goes', (text) => {
    expect(partialAnswerPrices(text, [COMPARE], INTENT)).not.toMatch(/9,299/);
  });
  it('English 「about」 does not keep it either', () => {
    expect(
      partialAnswerPrices(
        'Partially completed: the iPhone 16 Pro Max costs about RMB 9,299.',
        [COMPARE],
        'iPhone 16 Pro Max 256GB price',
      ),
    ).not.toMatch(/9,299/);
  });
  it('main results with prices above titles, then recommendations with titles above', () => {
    const page = [
      '- heading "搜索结果" [level=2]',
      '¥8,999',
      'iPhone 16 Pro',
      '¥9,999',
      'iPhone 16 Pro Max',
      '- heading "猜你喜欢" [level=2]',
      'iPhone 15',
      '¥4,999',
      'iPhone 15 Plus',
      '¥5,499',
      'iPhone 14',
      '¥3,999',
    ].join('\n');
    expect(
      partialAnswerPrices('部分完成：iPhone 16 Pro Max 售价 ¥9,999。', [page], INTENT),
    ).toContain('¥9,999');
    expect(
      partialAnswerPrices('部分完成：iPhone 16 Pro Max 售价 ¥8,999。', [page], INTENT),
    ).not.toMatch(/8,999/);
    expect(
      partialAnswerPrices(
        '部分完成：iPhone 15 Plus 售价 ¥5,499。',
        [page],
        'iPhone 15 Plus 多少钱',
      ),
    ).toContain('¥5,499');
  });
});
