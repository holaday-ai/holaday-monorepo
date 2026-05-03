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
