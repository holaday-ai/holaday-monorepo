/**
 * REBUILD-3 price contract: verifier, renderer, the one send-back, and the new-amazon-sg pattern.
 * Synthetic snapshot trees in the Playwright AI aria format; no model, no browser.
 */
import { describe, expect, it } from 'vitest';
import { createPriceContract, priceFinishTool } from './price-contract.js';
import { renderPriceAnswer } from './price-render.js';
import { type PriceItem, parsePriceResult } from './price-result.js';
import { blockPriceEntries, verifyPriceItems } from './price-verify.js';
import { type ReadPage, blocksFor, plainPageText } from './read-blocks.js';

/** An amazon.sg search page as the snapshot tree reads it (DEPLOY-59 reg-new-amazon-sg shape). */
const SEARCH_TREE = [
  '- main [ref=e1]:',
  '  - heading "1-48 of 303 results for \\"usb c cable\\"" [level=2] [ref=e2]',
  '  - list [ref=e3]:',
  '    - listitem [ref=e10]:',
  '      - link "UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord, 1M" [ref=e11] [cursor=pointer]:',
  '        - /url: /dp/B0AAA11111',
  '      - generic [ref=e12]: S$10.92',
  '    - listitem [ref=e20]:',
  '      - link "Anker USB C to USB C Cable 240W, 6ft" [ref=e21] [cursor=pointer]:',
  '        - /url: /dp/B0BBB22222',
  '      - generic [ref=e22]: S$12.45',
  '    - listitem [ref=e30]:',
  '      - link "Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W)" [ref=e31] [cursor=pointer]:',
  '        - /url: /dp/B0CCC33333',
  '      - generic [ref=e32]: No featured offers available',
].join('\n');

/** The Belkin product page: the variant selector shows another colour's price. */
const DETAIL_TREE = [
  '- main [ref=e1]:',
  '  - heading "Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W)" [level=1] [ref=e2]',
  '  - list "Colour Name" [ref=e40]:',
  '    - listitem [ref=e41]:',
  '      - button "Black" [ref=e42]',
  '      - generic [ref=e43]: S$9.43',
  '    - listitem [ref=e44]:',
  '      - button "White" [ref=e45]',
  '      - generic [ref=e46]: S$6.86',
].join('\n');

const PAGES: ReadPage[] = [
  {
    text: `URL: https://www.amazon.sg/s?k=usb+c+cable\n标题: Amazon.sg : usb c cable\n${SEARCH_TREE}`,
    sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable',
    tabId: 'tab_1',
  },
  {
    text: DETAIL_TREE,
    sourceURL: 'https://www.amazon.sg/dp/B0CCC33333',
    tabId: 'tab_1',
  },
];

const UGREEN: PriceItem = {
  name: 'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord, 1M',
  variant: '1M',
  price: 'S$10.92',
  currency: 'SGD',
  source_url: null,
  quote: 'S$10.92',
  block_ref: 'e10',
};
const ANKER: PriceItem = {
  name: 'Anker USB C to USB C Cable 240W, 6ft',
  variant: null,
  price: 'S$12.45',
  currency: 'SGD',
  source_url: 'https://www.amazon.sg/dp/B0BBB22222',
  quote: 'S$12.45',
  block_ref: 'e20',
};
const BELKIN_WRONG: PriceItem = {
  name: 'Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W)',
  variant: null,
  price: 'S$6.86',
  currency: 'SGD',
  source_url: null,
  quote: 'S$6.86',
  block_ref: 'e30',
};
const BELKIN_MISSING = {
  field: 'price',
  item: 'Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W)',
  reason: '搜索结果卡片只显示 No featured offers available，没有价格',
};

const finishArgs = (result: unknown) => ({
  status: 'completed',
  summary: '查到了',
  price_result: result,
});

describe('read blocks', () => {
  it('a ref heads its subtree: the card is the list item, not its title link', () => {
    const [card] = blocksFor('e10', PAGES);
    expect(card?.text).toContain('UGREEN 2 Pack');
    expect(card?.text).toContain('S$10.92');
    expect(card?.text).not.toContain('Anker');
    expect(card?.links).toEqual(['https://www.amazon.sg/dp/B0AAA11111']);
    const [link] = blocksFor('e11', PAGES);
    expect(link?.text).not.toContain('S$10.92');
  });

  it('a tab-qualified ref keeps to its tab; an unknown ref has no block', () => {
    expect(blocksFor('tab_1/e43', PAGES)[0]?.text).toContain('S$9.43');
    expect(blocksFor('tab_2/e43', [{ ...PAGES[1]!, tabId: 'tab_1' }])).toEqual([]);
    expect(blocksFor('e999', PAGES)).toEqual([]);
    expect(blocksFor('text', PAGES)).toEqual([]);
  });

  it('the visible text drops roles and attributes, keeps names and values', () => {
    const plain = plainPageText(SEARCH_TREE);
    expect(plain).toContain('1-48 of 303 results for "usb c cable"');
    expect(plain).toContain('S$12.45');
    expect(plain).not.toContain('[ref=');
    expect(plain).not.toContain('/dp/');
  });
});

describe('verifier', () => {
  it('quote present in the text read, name / variant / price from one block: passes', () => {
    const out = verifyPriceItems([UGREEN, ANKER], PAGES);
    expect(out.rejected).toEqual([]);
    expect(out.passed.map((v) => v.sourceUrl)).toEqual([
      'https://www.amazon.sg/dp/B0AAA11111',
      'https://www.amazon.sg/dp/B0BBB22222',
    ]);
  });

  it('a quote the run never read is rejected', () => {
    const out = verifyPriceItems([{ ...ANKER, quote: 'S$11.99 limited deal' }], PAGES);
    expect(out.rejected[0]?.problems.join()).toMatch(/不在本次读到的页面文字里/);
  });

  it('name from card A with the price of card B is rejected (mixed blocks)', () => {
    const mixed = { ...UGREEN, variant: null, price: 'S$12.45', quote: 'S$12.45' };
    const out = verifyPriceItems([mixed], PAGES);
    expect(out.passed).toEqual([]);
    expect(out.rejected[0]?.problems.join()).toMatch(/价格「S\$12\.45」不在这个区块里/);
    // The block's own text goes back with it.
    expect(out.rejected[0]?.readText).toContain('S$10.92');
    // Pointing at card B instead does not help: the name is not there.
    const other = verifyPriceItems([{ ...mixed, block_ref: 'e20' }], PAGES);
    expect(other.rejected[0]?.problems.join()).toMatch(/名称.*不在这个区块里/);
  });

  it('a price whose digits only start the page’s price is not that price (12.4 vs 12.45)', () => {
    const out = verifyPriceItems([{ ...ANKER, price: 'S$12.4', quote: 'S$12.4' }], PAGES);
    expect(out.rejected[0]?.problems.join()).toMatch(/价格「S\$12\.4」不在这个区块里/);
  });

  it('text mode: name and price must sit in the quote itself', () => {
    const text: ReadPage[] = [
      {
        text: 'Kindle Paperwhite (16 GB) S$219.00 In stock\nKindle Scribe S$499.00',
        sourceURL: 'https://www.amazon.sg/kindle',
      },
    ];
    const good: PriceItem = {
      name: 'Kindle Paperwhite (16 GB)',
      variant: '16 GB',
      price: 'S$219.00',
      currency: null,
      source_url: null,
      quote: 'Kindle Paperwhite (16 GB) S$219.00',
      block_ref: 'text',
    };
    expect(verifyPriceItems([good], text).passed).toHaveLength(1);
    const split = { ...good, quote: 'S$219.00 In stock' };
    expect(verifyPriceItems([split], text).rejected[0]?.problems.join()).toMatch(
      /名称.*不在quote里/,
    );
  });

  it('a price read only on a search-results page passes but is marked unverified', () => {
    const serp: ReadPage[] = [
      {
        text: '- listitem [ref=e5]:\n  - heading "AirPods Pro 2 京东 ¥1799" [level=3] [ref=e6]',
        sourceURL: 'https://cn.bing.com/search?q=airpods',
      },
    ];
    const item: PriceItem = {
      name: 'AirPods Pro 2',
      variant: null,
      price: '¥1799',
      currency: 'CNY',
      source_url: null,
      quote: 'AirPods Pro 2 京东 ¥1799',
      block_ref: 'e5',
    };
    expect(verifyPriceItems([item], serp).passed[0]?.unverified).toBe('search_snippet');
  });
});

describe('verifier: the block is the smallest variant item or card (review #1 MUST-fix)', () => {
  const BELKIN = 'Belkin Eco-Friendly Braided USB-A to USB-C Cable (6.6ft, 15W)';
  const detailItem = (overrides: Partial<PriceItem>): PriceItem => ({
    name: BELKIN,
    variant: 'Black',
    price: 'S$6.86',
    currency: 'SGD',
    source_url: null,
    quote: 'S$6.86',
    block_ref: 'e1',
    ...overrides,
  });

  it('reviewer case 1: Black + S$6.86 with block_ref e1 (the whole main) is rejected', () => {
    const out = verifyPriceItems([detailItem({})], PAGES);
    expect(out.passed).toEqual([]);
    const problems = out.rejected[0]?.problems.join() ?? '';
    expect(problems).toMatch(/block_ref「e1」太大：里面有 2 个不同价格（9\.43、6\.86）/);
    expect(problems).toMatch(/包住了多个规格（Black、White）/);
  });

  it('reviewer case 2: Black + S$6.86 in text mode with a quote wrapping the whole variant area is rejected', () => {
    const wide = detailItem({
      block_ref: 'text',
      quote: `${BELKIN} Colour Name Black S$9.43 White S$6.86`,
    });
    const pages: ReadPage[] = [
      {
        text: `${BELKIN}\nColour Name Black S$9.43 White S$6.86\nIn stock`,
        sourceURL: 'https://www.amazon.sg/dp/B0CCC33333',
      },
    ];
    // Without the limit the quote holds the name, 「Black」 and 6.86, so it used to pass.
    const out = verifyPriceItems([wide], [...PAGES, ...pages]);
    expect(out.passed).toEqual([]);
    expect(out.rejected[0]?.problems.join()).toMatch(/quote 太宽：里面有 2 个不同价格/);
    // A quote longer than the text-mode limit is rejected on its own.
    const long = detailItem({ block_ref: 'text', quote: `${BELKIN} ${'x'.repeat(300)} S$6.86` });
    const longPage: ReadPage = { text: long.quote, sourceURL: 'https://www.amazon.sg/dp/X' };
    expect(verifyPriceItems([long], [longPage]).rejected[0]?.problems.join()).toMatch(/quote 太长/);
  });

  it('reviewer case 3: White + S$6.86 with block_ref e44 (the White item) passes; the name is the page title', () => {
    const out = verifyPriceItems([detailItem({ variant: 'White', block_ref: 'e44' })], PAGES);
    expect(out.rejected).toEqual([]);
    expect(out.passed).toHaveLength(1);
    expect(out.passed[0]?.sourceUrl).toBe('https://www.amazon.sg/dp/B0CCC33333');
  });

  it('the variant item still has to be the claimed one, and the name still has to be on the page', () => {
    // Black named on the White item: the variant is not in that block.
    const crossed = verifyPriceItems([detailItem({ variant: 'Black', block_ref: 'e44' })], PAGES);
    expect(crossed.rejected[0]?.problems.join()).toMatch(/规格「Black」不在这个区块里/);
    // Black with White's price on the Black item: the price is not in that block.
    const wrongPrice = verifyPriceItems([detailItem({ block_ref: 'e41' })], PAGES);
    expect(wrongPrice.rejected[0]?.problems.join()).toMatch(/价格「S\$6\.86」不在这个区块里/);
    // A name that is neither in the item nor the page title.
    const otherName = verifyPriceItems(
      [detailItem({ name: 'Anker USB C Cable', variant: 'White', block_ref: 'e44' })],
      PAGES,
    );
    expect(otherName.rejected[0]?.problems.join()).toMatch(/名称.*不在这个区块里，也不是本页标题/);
    // The list of all colours is too wide as well.
    const list = verifyPriceItems([detailItem({ variant: 'White', block_ref: 'e40' })], PAGES);
    expect(list.rejected[0]?.problems.join()).toMatch(/太大/);
  });

  it('a 「标题:」 line counts as the page title for the name', () => {
    const pages: ReadPage[] = [
      {
        text: [
          `标题: ${BELKIN} : Amazon.sg`,
          '- list "Colour Name" [ref=e40]:',
          '  - listitem [ref=e44]:',
          '    - button "White" [ref=e45]',
          '    - generic [ref=e46]: S$6.86',
        ].join('\n'),
        sourceURL: 'https://www.amazon.sg/dp/B0CCC33333',
      },
    ];
    expect(
      verifyPriceItems([detailItem({ variant: 'White', block_ref: 'e44' })], pages).passed,
    ).toHaveLength(1);
  });

  it('one price for several options passes only when the claimed option is the selected one', () => {
    const tree = (selected: string) =>
      [
        `- heading "${BELKIN}" [level=1] [ref=e2]`,
        '- group [ref=e50]:',
        '  - generic [ref=e51]: S$9.43',
        `  - button "Black"${selected === 'Black' ? ' [pressed]' : ''} [ref=e52]`,
        `  - button "White"${selected === 'White' ? ' [pressed]' : ''} [ref=e53]`,
      ].join('\n');
    const page = (selected: string): ReadPage[] => [
      { text: tree(selected), sourceURL: 'https://www.amazon.sg/dp/B0CCC33333' },
    ];
    const black = detailItem({ price: 'S$9.43', quote: 'S$9.43', block_ref: 'e50' });
    expect(verifyPriceItems([black], page('Black')).passed).toHaveLength(1);
    expect(verifyPriceItems([black], page('White')).rejected[0]?.problems.join()).toMatch(
      /包住了多个规格（Black、White）/,
    );
  });

  it('a card with a list price, a unit price or a range is still one price', () => {
    expect(
      blockPriceEntries([
        { text: 'UGREEN USB C Cable' },
        { text: 'S$10.92' },
        { text: 'S$5.46/count' },
        { text: 'List: S$15.99' },
        { text: 'S$14.99', role: 'deletion' },
        { text: 'Save S$2.00 with coupon' },
        { text: 'FREE delivery on orders over S$40' },
      ]),
    ).toEqual(['10.92']);
    expect(blockPriceEntries([{ text: 'from S$8.21 - S$12.45' }])).toEqual(['range:8.21-12.45']);
    expect(blockPriceEntries([{ text: '¥' }, { text: '7999' }, { text: '￥7,999.00' }])).toEqual([
      '7999',
    ]);
    expect(blockPriceEntries([{ text: 'Black S$9.43' }, { text: 'White S$6.86' }])).toEqual([
      '9.43',
      '6.86',
    ]);
    // A JD card: the price and the PLUS member price; 「7999元」 is read too.
    expect(blockPriceEntries([{ text: '￥7999.00' }, { text: 'PLUS ￥7899.00' }])).toEqual([
      '7999',
    ]);
    expect(blockPriceEntries([{ text: '到手价 7999元' }, { text: '6899元' }])).toEqual([
      '7999',
      '6899',
    ]);
  });

  it('a short title link beside rating / options links is not a variant group (search card)', () => {
    const card: ReadPage[] = [
      {
        text: [
          '- listitem [ref=e10]:',
          '  - link "Anker Cable 6ft" [ref=e11]',
          '  - link "4.5 out of 5 stars" [ref=e12]',
          '  - link "See options" [ref=e13]',
          '  - generic [ref=e14]: S$12.45',
        ].join('\n'),
        sourceURL: 'https://www.amazon.sg/s?k=anker',
      },
    ];
    const item: PriceItem = {
      name: 'Anker Cable 6ft',
      variant: '6ft',
      price: 'S$12.45',
      currency: 'SGD',
      source_url: null,
      quote: 'S$12.45',
      block_ref: 'e10',
    };
    expect(verifyPriceItems([item], card).passed).toHaveLength(1);
  });
});

describe('renderer', () => {
  const passed = verifyPriceItems([UGREEN, ANKER], PAGES).passed;

  it('zh: numbered items, source links, no partial lead when nothing is missing', () => {
    const out = renderPriceAnswer({ language: 'zh', items: passed, missing: [], note: null });
    expect(out.partial).toBe(false);
    expect(out.summary).not.toMatch(/部分完成|未核实/);
    expect(out.summary).toContain(
      '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…（1M）：S$10.92',
    );
    expect(out.summary).toContain('来源：https://www.amazon.sg/dp/B0AAA11111');
    expect(out.summary).toContain('2. Anker USB C to USB C Cable 240W, 6ft：S$12.45');
    // Each price is said once.
    expect(out.summary.match(/S\$12\.45/g)).toHaveLength(1);
  });

  it('en: the English template, partial opening and missing list when something is missing', () => {
    const out = renderPriceAnswer({
      language: 'en',
      items: passed,
      missing: [{ ...BELKIN_MISSING, reason: 'the card shows No featured offers available' }],
      note: 'Prices are in Singapore dollars.',
    });
    expect(out.partial).toBe(true);
    expect(out.summary.startsWith('Partially completed: not obtained — the price of “Belkin')).toBe(
      true,
    );
    expect(out.summary).toContain('Source: https://www.amazon.sg/dp/B0BBB22222');
    expect(out.summary).toContain('Not obtained:\n- Belkin');
    expect(out.summary).toContain('Prices are in Singapore dollars.');
    expect(out.summary).not.toMatch(/[一-鿿]/);
  });

  it('the 未核实 line only for prices read on a search-results page', () => {
    const plain = renderPriceAnswer({ language: 'zh', items: passed, missing: [], note: null });
    expect(plain.summary).not.toContain('未核实');
    const snippet = renderPriceAnswer({
      language: 'zh',
      items: [{ ...passed[0]!, unverified: 'search_snippet' }],
      missing: [],
      note: null,
    });
    expect(snippet.summary).toMatch(/未核实：以下价格只在搜索结果摘要里读到.*「UGREEN/);
  });

  it('a note or a reason that names an amount does not repeat an unchecked price', () => {
    const out = renderPriceAnswer({
      language: 'zh',
      items: passed,
      missing: [{ ...BELKIN_MISSING, reason: '别的颜色是 S$6.86，搜索的那款没写价格' }],
      note: '另一款大约 S$5',
    });
    expect(out.summary).not.toContain('S$6.86');
    expect(out.summary).not.toContain('S$5');
    expect(out.summary).toContain('（金额未核对，已省略）');
  });
});

describe('price contract decisions', () => {
  const result = (items: PriceItem[], missing: unknown[] = []) => ({
    language: 'zh',
    items,
    missing,
    note: null,
  });

  it('new-amazon-sg: item 3 honestly not obtained is delivered as 部分完成, never sent back', () => {
    const contract = createPriceContract({ wantedCount: 3 });
    const decision = contract.decide(finishArgs(result([UGREEN, ANKER], [BELKIN_MISSING])), PAGES, {
      final: false,
    });
    expect(decision.kind).toBe('deliver');
    if (decision.kind !== 'deliver') return;
    expect(decision.summary.startsWith('部分完成：「Belkin')).toBe(true);
    expect(decision.partial).toEqual({
      found: 2,
      wanted: 3,
      missing: expect.stringContaining('Belkin'),
    });
    expect(decision.summary).not.toContain('S$6.86');
  });

  it('new-amazon-sg: another variant’s price for item 3 is caught by block_ref, sent back once, then moved to missing', () => {
    const contract = createPriceContract({ wantedCount: 3 });
    const first = contract.decide(finishArgs(result([UGREEN, ANKER, BELKIN_WRONG])), PAGES, {
      final: false,
    });
    expect(first.kind).toBe('retry');
    if (first.kind !== 'retry') return;
    expect(first.message).toMatch(/第 3 条「Belkin.*价格「S\$6\.86」不在这个区块里/);
    expect(first.message).toContain('No featured offers available');
    const second = contract.decide(finishArgs(result([UGREEN, ANKER, BELKIN_WRONG])), PAGES, {
      final: false,
    });
    expect(second.kind).toBe('deliver');
    if (second.kind !== 'deliver') return;
    expect(second.summary).not.toContain('S$6.86');
    expect(second.summary).toMatch(/^部分完成：「Belkin/);
    expect(second.partial?.found).toBe(2);
  });

  it('missing items alone never cause a send-back, even on the first finish', () => {
    const contract = createPriceContract({ wantedCount: null });
    const decision = contract.decide(
      finishArgs(result([ANKER], [BELKIN_MISSING, { ...BELKIN_MISSING, item: 'UGREEN 2 Pack' }])),
      PAGES,
      { final: false },
    );
    expect(decision.kind).toBe('deliver');
  });

  it('fewer items than asked for, none declared missing: partial, not a send-back', () => {
    const contract = createPriceContract({ wantedCount: 3 });
    const decision = contract.decide(finishArgs(result([UGREEN])), PAGES, { final: false });
    expect(decision.kind).toBe('deliver');
    if (decision.kind !== 'deliver') return;
    expect(decision.partial).toMatchObject({ found: 1, wanted: 3 });
    expect(decision.summary).toContain('答案只给出了 1 款，要求 3 款');
  });

  it('the final turn never sends back: a wrong item goes straight to missing', () => {
    const contract = createPriceContract({ wantedCount: null });
    const decision = contract.decide(finishArgs(result([UGREEN, BELKIN_WRONG])), PAGES, {
      final: true,
    });
    expect(decision.kind).toBe('deliver');
  });

  it('no item survives: the task fails with what was not obtained', () => {
    const contract = createPriceContract({ wantedCount: null });
    const decision = contract.decide(finishArgs(result([], [BELKIN_MISSING])), PAGES, {
      final: false,
    });
    expect(decision).toMatchObject({ kind: 'fail', reason: expect.stringContaining('Belkin') });
  });

  it('JSON schema failure: retried once, then reported invalid (the caller degrades)', () => {
    const contract = createPriceContract({ wantedCount: null });
    const bad = finishArgs({ language: 'fr', items: [{ name: 'x' }] });
    const first = contract.decide(bad, PAGES, { final: false });
    expect(first.kind).toBe('retry');
    if (first.kind === 'retry') expect(first.message).toMatch(/language 须为 zh 或 en/);
    expect(contract.decide(bad, PAGES, { final: false }).kind).toBe('invalid');
    // A JSON string is accepted as the object it encodes.
    expect(parsePriceResult(JSON.stringify(result([UGREEN]))).ok).toBe(true);
  });

  it('the finish tool for a price task requires price_result and keeps the usual fields', () => {
    const tool = priceFinishTool({
      name: 'finish',
      description: '结束任务。',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string' }, summary: { type: 'string' } },
        required: ['status', 'summary'],
      },
    });
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['status', 'summary', 'price_result']);
    expect(schema.required).toEqual(['status', 'summary', 'price_result']);
  });
});
