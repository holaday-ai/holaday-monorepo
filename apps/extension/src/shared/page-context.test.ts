import { describe, expect, it } from 'vitest';
import {
  composeContextTail,
  sanitizePageContextSnippet,
  type PageContext,
} from './page-context.js';

describe('sanitizePageContextSnippet', () => {
  it('bounds page metadata before it reaches the side panel', () => {
    const snippet = sanitizePageContextSnippet({
      title: 't'.repeat(800),
      url: `https://example.com/${'a'.repeat(3000)}`,
      selectedText: 's'.repeat(2500),
      metaDescription: 'm'.repeat(800),
    });

    expect(snippet.title).toHaveLength(512);
    expect(snippet.url).toHaveLength(2048);
    expect(snippet.selectedText).toHaveLength(2000);
    expect(snippet.metaDescription).toHaveLength(512);
  });

  it('normalizes malformed injected results to empty strings', () => {
    expect(sanitizePageContextSnippet({ title: 123 as unknown as string })).toEqual({
      title: '',
      url: '',
      selectedText: '',
      metaDescription: '',
    });
  });
});

describe('composeContextTail', () => {
  it('keeps selected text capped in submitted task context', () => {
    const ctx: PageContext = {
      tabId: 1,
      title: 'Example',
      url: 'https://example.com/',
      selectedText: 's'.repeat(2500),
      metaDescription: '',
    };

    const tail = composeContextTail(ctx);

    expect(tail).toContain('[当前页面] Example (https://example.com/)');
    expect(tail).toContain('[选中内容]');
    expect(tail.length).toBeLessThan(2200);
  });
});
