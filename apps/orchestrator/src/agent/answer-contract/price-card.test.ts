import { describe, expect, it } from 'vitest';
import type { PriceItem } from './price-result.js';
import { blockPriceEntries, pagesQuotingInOrder, verifyPriceItems } from './price-verify.js';
import type { ReadPage } from './read-blocks.js';

// Bench a1 (coordinator ruling): a search result's product card is one block; a was / list price
// beside the current price does not make it 「too big」. Shapes from the recorded amazon.sg page.
const UGREEN_1M =
  'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord Compatible with iPhone 15 Pro Max, MacBook Pro, iPad Pro, Dell, Matebook, Chromebook, Pixel, Samsung S23 S22, Switch, 1M';

function card(ref: number, title: string, price: string, was: string): string {
  const [whole, cents] = price.split('.');
  return [
    `- listitem [ref=e${ref}]:`,
    `  - generic [ref=e${ref + 1}]:`,
    `    - link "${title}" [ref=e${ref + 2}] [cursor=pointer]:`,
    '      - /url: https://www.amazon.sg/dp/B09N94MZG9',
    `      - heading "${title}" [level=2] [ref=e${ref + 3}]`,
    `    - generic [ref=e${ref + 4}]: 50+ bought in past month`,
    `    - generic [ref=e${ref + 5}]:`,
    `      - generic [ref=e${ref + 6}]: Price, product page`,
    `      - 'link "S$${price} Was: S$${was} Was: S$${was}" [ref=e${ref + 7}] [cursor=pointer]':`,
    `        - generic [ref=e${ref + 8}]:`,
    `          - generic [ref=e${ref + 9}]: S$${price}`,
    `          - generic [ref=e${ref + 10}]:`,
    '            - text: S$',
    `            - generic [ref=e${ref + 11}]:`,
    `              - text: "${whole}"`,
    `              - generic [ref=e${ref + 12}]: .`,
    `            - text: "${cents}"`,
    `        - generic [ref=e${ref + 13}]: "Was: S$${was}"`,
    `        - generic [ref=e${ref + 14}]:`,
    '          - text: "Was:"',
    `          - generic [ref=e${ref + 15}]:`,
    `            - generic [ref=e${ref + 16}]: S$${was}`,
    `            - text: S$${was}`,
    `    - button "Add to cart" [ref=e${ref + 17}]`,
  ]
    .map((l) => `  ${l}`)
    .join('\n');
}

const LIST = [
  '- list [ref=e200]:',
  card(244, UGREEN_1M, '10.92', '17.42'),
  card(316, UGREEN_1M.replace(', 1M', ', 2M'), '12.45', '21.22'),
].join('\n');
const PAGES: ReadPage[] = [
  { text: LIST, sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable', tabId: 'tab_1' },
];
const item = (over: Partial<PriceItem>): PriceItem => ({
  name: UGREEN_1M,
  variant: null,
  price: 'S$10.92',
  currency: 'SGD',
  source_url: 'https://www.amazon.sg/dp/B09N94MZG9',
  quote: 'S$10.92',
  block_ref: 'e244',
  ...over,
});

describe('bench a1: one product card is one block', () => {
  it('the card with its current price and its 「Was:」 price passes (new-amazon-sg)', () => {
    const out = verifyPriceItems([item({})], PAGES);
    expect(out.rejected.map((r) => r.problems)).toEqual([]);
    expect(out.passed).toHaveLength(1);
  });

  it('the struck 「Was」 price is not the card’s price', () => {
    const out = verifyPriceItems([item({ price: 'S$17.42', quote: 'S$17.42' })], PAGES);
    expect(out.rejected[0]?.problems.join()).toMatch(/划线价/);
  });

  it('the whole list (two cards) is still too big for one item', () => {
    const out = verifyPriceItems([item({ block_ref: 'e200' })], PAGES);
    expect(out.rejected[0]?.problems.join()).toMatch(/太大/);
  });

  it('an amazon.com card price split into 「$」「9」「99」 reads as $9.99 (b-p02)', () => {
    const name = 'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)';
    const page: ReadPage[] = [
      {
        text: [
          '- listitem [ref=e10]:',
          `  - link "${name}" [ref=e11]:`,
          '    - /url: https://www.amazon.com/dp/B088NRLMPV',
          '  - generic [ref=e12]:',
          '    - text: $',
          '    - text: "9"',
          '    - text: "99"',
          '  - generic [ref=e13]: "List: $15.99"',
          '  - generic [ref=e14]: Save 5% on 3 select item(s)',
        ].join('\n'),
        sourceURL: 'https://www.amazon.com/s?k=usb+c+cable',
      },
    ];
    const out = verifyPriceItems(
      [
        item({
          name,
          price: '$9.99',
          quote: 'Anker USB C to USB C Cable',
          block_ref: 'e10',
          source_url: 'https://www.amazon.com/dp/B088NRLMPV',
        }),
      ],
      page,
    );
    expect(out.rejected.map((r) => r.problems)).toEqual([]);
  });
});

describe('bench r3 b-p02: a quote that skips the rating lines between name and price', () => {
  const READ: ReadPage[] = [
    {
      text: [
        'Best Sellers',
        'Gift Shop',
        'Best Seller',
        'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)',
        'For iPhone 18 / 17 Series, iPad mini 6, and More',
        '4.7',
        '4.7 out of 5 stars',
        ' (91.3K)',
        '10K+ bought in past month',
        'Price, product page',
        '$9.99',
        '$9',
        '.',
        '99 (',
      ].join('\n'),
      sourceURL: 'https://www.amazon.com/s?k=usb+c+cable',
    },
    ...PAGES,
  ];
  const elided =
    'Best Seller\nAnker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)\n$9.99';

  it('its lines in order, close together on one read page, count as read (block mode)', () => {
    expect(pagesQuotingInOrder(elided, READ)).toHaveLength(1);
    // A snapshot card repeats the title (link + heading); the quote gives it once, then the price.
    const checked = verifyPriceItems(
      [item({ quote: `${UGREEN_1M}\n50+ bought in past month\nS$10.92` })],
      PAGES,
    );
    expect(checked.rejected).toEqual([]);
    // The block still has to hold every line: a badge outside the card is not in it.
    const outside = verifyPriceItems(
      [item({ quote: 'Best Seller\nUGREEN 2 Pack USB C\nS$10.92' })],
      [{ text: `Best Seller\n${LIST}`, sourceURL: PAGES[0]!.sourceURL, tabId: 'tab_1' }],
    );
    expect(outside.rejected[0]?.problems).toEqual([expect.stringMatching(/不在这个区块里/)]);
  });

  it('out of order, too far apart, or text mode: still rejected', () => {
    expect(
      pagesQuotingInOrder('$9.99\nAnker USB C to USB C Cable, 60W Fast Charging Cable', READ),
    ).toEqual([]);
    const far: ReadPage[] = [{ text: `Anker cable\n${'x '.repeat(600)}\n$9.99`, sourceURL: 'u' }];
    expect(pagesQuotingInOrder('Anker cable\n$9.99', far)).toEqual([]);
    const text = verifyPriceItems(
      [item({ quote: 'Best Seller\nUGREEN 2 Pack USB C\nS$10.92', block_ref: 'text' })],
      [{ text: `Best Seller\n${LIST}`, sourceURL: PAGES[0]!.sourceURL, tabId: 'tab_1' }],
    );
    expect(text.rejected[0]?.problems[0]).toMatch(/不在本次读到的页面文字里/);
  });
});

it('bench r3 b-p02: a unit price split over nodes (「$5.00」「/count)」) is not a second price', () => {
  const lines = [
    'Price, product page',
    '$9.99 ( $5.00 /count)',
    '$9.99',
    '$',
    '9',
    '.',
    '99',
    '(',
    '$5.00',
    '$5.00',
    '/count)',
  ];
  expect(blockPriceEntries(lines.map((text) => ({ text })))).toEqual(['9.99']);
  // Not a unit marker: a second card's price stays a second price.
  expect(blockPriceEntries(['$9.99', '$12.99', 'Add to cart'].map((text) => ({ text })))).toEqual([
    '9.99',
    '12.99',
  ]);
});
