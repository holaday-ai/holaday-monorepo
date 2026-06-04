/**
 * Phase 23 Step 3 — unit tests for the Apify-backed agent tools.
 *
 * These tests cover the pure helpers — actor IDs, result formatters —
 * not the full agent-loop dispatch (which would need a running mock
 * Anthropic client + executor harness, out of scope for unit tests).
 *
 * The dispatch logic itself is one if-branch + a fetch through the
 * adapter, both already covered by the formatter contract here and by
 * the existing apify adapter wiring (createApifyAdapter just delegates
 * to fetch + JSON.parse).
 */

import { describe, expect, it } from 'vitest';
import {
  APIFY_ECOMMERCE_ACTORS,
  APIFY_SCRAPE_WEBSITE_ACTOR,
  absolutizeMarkdownLinks,
  extractEcommerceProductLinks,
  formatFirecrawlSearchEcommerceResult,
  formatScrapeWebsiteResult,
  formatSearchEcommerceResult,
} from './agent-loop.js';

describe('Apify actor id constants', () => {
  it('scrape_website default is apify/website-content-crawler', () => {
    expect(APIFY_SCRAPE_WEBSITE_ACTOR).toBe('apify/website-content-crawler');
  });

  it('search_ecommerce maps the three platforms', () => {
    expect(Object.keys(APIFY_ECOMMERCE_ACTORS).sort()).toEqual(['amazon', 'jd', 'taobao']);
    for (const v of Object.values(APIFY_ECOMMERCE_ACTORS)) {
      expect(v).toMatch(/^[a-z0-9_-]+\/[a-z0-9_-]+$/i);
    }
  });
});

describe('formatScrapeWebsiteResult', () => {
  it('empty items → guidance to try browser / different URL', () => {
    const out = formatScrapeWebsiteResult([], 'https://example.com');
    expect(out).toMatch(/没有抓取到内容/);
    expect(out).toContain('https://example.com');
  });

  it('single item with markdown → markdown shown, follow-up reminder appended', () => {
    const out = formatScrapeWebsiteResult(
      [
        {
          url: 'https://example.com/article',
          title: 'My Article',
          markdown: '# Headline\nSome content here.',
        },
      ],
      'https://example.com/article',
    );
    expect(out).toContain('My Article');
    expect(out).toContain('# Headline');
    expect(out).toContain('Some content here.');
    expect(out).toMatch(/记得回到浏览器/);
  });

  it('falls back to text when markdown absent', () => {
    const out = formatScrapeWebsiteResult(
      [{ url: 'https://x.com', title: 'X', text: 'plain text body' }],
      'https://x.com',
    );
    expect(out).toContain('plain text body');
  });

  it('truncates at 30KB so giant pages cannot blow context', () => {
    const huge = 'A'.repeat(60_000);
    const out = formatScrapeWebsiteResult(
      [{ url: 'https://x.com', title: 'X', text: huge }],
      'https://x.com',
    );
    expect(out.length).toBeLessThan(31_500); // 30K body + header + footer
    expect(out).toMatch(/truncated/);
  });

  it('absolutizes relative markdown links before giving them to the model', () => {
    const out = formatScrapeWebsiteResult(
      [
        {
          url: 'https://docs.python.org/3/tutorial/',
          title: 'The Python Tutorial',
          markdown:
            '[Whetting Your Appetite](appetite.html)\n' +
            '[Library](../library/index.html)\n' +
            '[Top](#top)\n' +
            '[Email](mailto:hello@example.com)',
        },
      ],
      'https://docs.python.org/3/tutorial/',
    );
    expect(out).toContain(
      '[Whetting Your Appetite](https://docs.python.org/3/tutorial/appetite.html)',
    );
    expect(out).toContain('[Library](https://docs.python.org/3/library/index.html)');
    expect(out).toContain('[Top](#top)');
    expect(out).toContain('[Email](mailto:hello@example.com)');
  });
});

describe('absolutizeMarkdownLinks', () => {
  it('keeps absolute links unchanged', () => {
    expect(
      absolutizeMarkdownLinks(
        '[External](https://example.com/path)',
        'https://docs.python.org/3/tutorial/',
      ),
    ).toBe('[External](https://example.com/path)');
  });
});

describe('formatSearchEcommerceResult', () => {
  it('empty items → guidance to widen query / change platform', () => {
    const out = formatSearchEcommerceResult([], 'amazon', 'mechanical keyboard');
    expect(out).toMatch(/没有结果/);
    expect(out).toContain('mechanical keyboard');
  });

  it('normalises Amazon-shape items to {name, price, rating, url}', () => {
    const items = [
      {
        title: 'Keychron Q1',
        price: '$170',
        stars: 4.7,
        url: 'https://amazon.com/p/q1',
      },
      {
        productName: 'Keychron K2', // alternative key
        priceText: '$99',
        rating: 4.5,
        productUrl: 'https://amazon.com/p/k2',
      },
    ];
    const out = formatSearchEcommerceResult(items, 'amazon', 'mech keyboard');
    expect(out).toContain('amazon');
    expect(out).toContain('mech keyboard');
    expect(out).toContain('Keychron Q1');
    expect(out).toContain('Keychron K2');
    expect(out).toContain('$170');
    expect(out).toContain('4.7');
    expect(out).toContain('https://amazon.com/p/q1');
    // Tail prompt that pushes the model back to the browser.
    expect(out).toMatch(/记得回到浏览器/);
  });

  it('caps at 30 items even when actor returns more', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      name: `Item ${i}`,
      price: '$1',
      rating: 4,
      url: `https://x.com/${i}`,
    }));
    const out = formatSearchEcommerceResult(items, 'jd', 'thing');
    // Header reports the unbounded count from the actor's actual output…
    expect(out).toContain('100 items');
    // …but the JSON body only includes the first 30.
    expect(out).toContain('"Item 0"');
    expect(out).toContain('"Item 29"');
    expect(out).not.toContain('"Item 30"');
  });

  it('handles weird-shaped items by passing through empty strings', () => {
    const items = [{ unrelatedField: 'x' }];
    const out = formatSearchEcommerceResult(items, 'taobao', 'q');
    // Should still produce structured JSON, just with empty fields
    expect(out).toContain('"name": ""');
    expect(out).toContain('"price": ""');
    expect(out).toContain('"url": ""');
  });
});

describe('formatFirecrawlSearchEcommerceResult', () => {
  it('front-loads source candidates so final answers can preserve URLs', () => {
    const out = formatFirecrawlSearchEcommerceResult(
      [
        {
          title: 'Apple iPhone 16 京东自营',
          url: 'https://item.jd.com/100123.html',
          markdown: 'Apple iPhone 16 128GB 到手价 4599 元',
        },
        {
          title: 'iPhone 16 搜索结果',
          url: 'https://search.jd.com/Search?keyword=iPhone%2016',
          markdown: '搜索页包含多款 iPhone 16',
        },
      ],
      'jd',
      'iPhone 16',
      5,
    );
    expect(out).toContain('可引用来源清单');
    expect(out).toContain('"product_link_candidates"');
    expect(out).toContain('"product_links"');
    expect(out).toContain('"source_candidates"');
    expect(out).toContain('"url": "https://item.jd.com/100123.html"');
    expect(out).toContain('不要输出空 url');
    expect(out).toContain('优先使用 product_link_candidates 里的不同商品链接');
    expect(out).toContain('最终答案每行商品必须带一个可点击来源链接');
    expect(out).toContain('Apple iPhone 16 128GB 到手价 4599 元');
  });

  it('caps the source candidate list and markdown blocks at maxResults', () => {
    const out = formatFirecrawlSearchEcommerceResult(
      Array.from({ length: 4 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        markdown: `body ${i}`,
      })),
      'jd',
      'phone',
      2,
    );
    expect(out).toContain('4 pages');
    expect(out).toContain('https://example.com/0');
    expect(out).toContain('https://example.com/1');
    expect(out).not.toContain('https://example.com/2');
    expect(out).not.toContain('body 2');
  });
});

describe('extractEcommerceProductLinks', () => {
  it('keeps Taobao/Tmall product detail links and drops broad catalogue pages', () => {
    const links = extractEcommerceProductLinks(
      [
        {
          title: 'iPhone 16 搜索结果',
          url: 'https://mobile-phone.taobao.com/chanpin/iPhone16.html',
          markdown:
            '[iPhone 16 A](https://pcdetail.taobao.com/abc123) ' +
            '[品牌频道](https://mobile-phone.taobao.com/chanpin/iPhone16.html) ' +
            '[天猫商品](https://detail.tmall.com/item.htm?id=123)',
        },
      ],
      'taobao',
    );
    expect(links).toEqual([
      { title: 'iPhone 16 A', url: 'https://pcdetail.taobao.com/abc123' },
      { title: '天猫商品', url: 'https://detail.tmall.com/item.htm?id=123' },
    ]);
  });

  it('extracts JD item pages from markdown and source URLs', () => {
    const links = extractEcommerceProductLinks(
      [
        {
          title: 'JD search',
          url: 'https://search.jd.com/Search?keyword=iPhone16',
          markdown:
            '[iPhone 16](https://item.jd.com/100123.html) ' +
            'https://item.jd.com/100456.html。',
        },
        {
          title: 'iPhone 16 Plus',
          url: 'https://item.jd.com/100789.html',
          markdown: 'detail page',
        },
      ],
      'jd',
    );
    expect(links).toEqual([
      { title: 'iPhone 16', url: 'https://item.jd.com/100123.html' },
      { title: 'JD search', url: 'https://item.jd.com/100456.html' },
      { title: 'iPhone 16 Plus', url: 'https://item.jd.com/100789.html' },
    ]);
  });
});
