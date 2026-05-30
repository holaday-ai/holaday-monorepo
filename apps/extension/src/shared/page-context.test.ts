import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeContextTail,
  getActivePageContext,
  sanitizePageContextSnippet,
  type PageContext,
} from './page-context.js';

afterEach(() => {
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).chrome;
});

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

describe('getActivePageContext', () => {
  it('falls back to the last focused page when the current window has no tab', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 7, title: 'Fallback page', url: 'https://example.com/' } as chrome.tabs.Tab,
      ]);
    globalThis.chrome = {
      tabs: { query },
      scripting: {
        executeScript: vi.fn(async () => [
          {
            result: {
              title: 'Extracted title',
              url: 'https://example.com/final',
              selectedText: 'selected',
              metaDescription: 'meta',
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    await expect(getActivePageContext()).resolves.toEqual({
      tabId: 7,
      title: 'Extracted title',
      url: 'https://example.com/final',
      selectedText: 'selected',
      metaDescription: 'meta',
    });
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });

  it('returns tab metadata when page injection is unavailable', async () => {
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          { id: 8, title: 'No script', url: 'https://example.com/restricted' } as chrome.tabs.Tab,
        ]),
      },
      scripting: {
        executeScript: vi.fn(async () => {
          throw new Error('Cannot access contents of url');
        }),
      },
    } as unknown as typeof chrome;

    await expect(getActivePageContext()).resolves.toEqual({
      tabId: 8,
      title: 'No script',
      url: 'https://example.com/restricted',
      selectedText: '',
      metaDescription: '',
    });
  });
});
