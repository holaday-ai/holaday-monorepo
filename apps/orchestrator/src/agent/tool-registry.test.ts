import { describe, expect, it } from 'vitest';

import { filterTools, isToolAllowed } from './tool-registry.js';

describe('tool registry', () => {
  it('keeps scraper tools available for hybrid browser tasks', () => {
    const tools = [
      { name: 'navigate' },
      { name: 'web_search' },
      { name: 'scrape_website' },
      { name: 'search_ecommerce' },
      { name: 'code_execution' },
    ];

    expect(filterTools(tools, 'hybrid').map((tool) => tool.name)).toEqual([
      'navigate',
      'web_search',
      'scrape_website',
      'search_ecommerce',
    ]);
    expect(isToolAllowed('search_ecommerce', 'hybrid')).toBe(true);
    expect(isToolAllowed('scrape_website', 'browser')).toBe(true);
  });

  it('does not expose scraper tools to pure search shortcuts', () => {
    expect(isToolAllowed('search_ecommerce', 'search')).toBe(false);
    expect(isToolAllowed('scrape_website', 'search')).toBe(false);
  });
});
