import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeContextTail,
  getActivePageContext,
  sanitizePageContextUrl,
  sanitizePageContextSnippet,
  type PageContext,
} from './page-context.js';

afterEach(() => {
  vi.useRealTimers();
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

describe('sanitizePageContextUrl', () => {
  it('drops sensitive query params and fragments from sidepanel context', () => {
    expect(
      sanitizePageContextUrl(
        'https://example.com/callback?code=abc&state=keep&access_token=secret#frag',
      ),
    ).toBe('https://example.com/callback?state=keep');
  });

  it('keeps ordinary query params that help page context', () => {
    expect(sanitizePageContextUrl('https://shop.example/search?q=laptop&page=2')).toBe(
      'https://shop.example/search?q=laptop&page=2',
    );
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

  it('falls back when the first active-tab query hangs', async () => {
    vi.useFakeTimers();
    const query = vi
      .fn()
      .mockReturnValueOnce(new Promise<chrome.tabs.Tab[]>(() => undefined))
      .mockResolvedValueOnce([
        { id: 12, title: 'Fallback page', url: 'https://example.com/fallback' } as chrome.tabs.Tab,
      ]);
    globalThis.chrome = {
      tabs: { query },
      scripting: {
        executeScript: vi.fn(async () => [
          {
            result: {
              title: 'Fallback extracted',
              url: 'https://example.com/fallback',
              selectedText: '',
              metaDescription: '',
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    const pending = getActivePageContext();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toEqual({
      tabId: 12,
      title: 'Fallback extracted',
      url: 'https://example.com/fallback',
      selectedText: '',
      metaDescription: '',
    });
    expect(query).toHaveBeenNthCalledWith(1, { active: true, currentWindow: true });
    expect(query).toHaveBeenNthCalledWith(2, { active: true, lastFocusedWindow: true });
  });

  it('returns tab metadata when page injection hangs', async () => {
    vi.useFakeTimers();
    globalThis.chrome = {
      tabs: {
        query: vi.fn(async () => [
          { id: 11, title: 'Slow page', url: 'https://example.com/slow' } as chrome.tabs.Tab,
        ]),
      },
      scripting: {
        executeScript: vi.fn(() => new Promise(() => undefined)),
      },
    } as unknown as typeof chrome;

    const pending = getActivePageContext();
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toEqual({
      tabId: 11,
      title: 'Slow page',
      url: 'https://example.com/slow',
      selectedText: '',
      metaDescription: '',
    });
  });

  it('prefers a web page over an internal Chrome page for task context', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 9, title: 'Extensions', url: 'chrome://extensions/' } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([
        { id: 10, title: 'Holaday', url: 'https://holaday.ai/app' } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
      scripting: {
        executeScript: vi.fn(async () => [
          {
            result: {
              title: 'Holaday app',
              url: 'https://holaday.ai/app',
              selectedText: '',
              metaDescription: '',
            },
          },
        ]),
      },
    } as unknown as typeof chrome;

    await expect(getActivePageContext()).resolves.toEqual({
      tabId: 10,
      title: 'Holaday app',
      url: 'https://holaday.ai/app',
      selectedText: '',
      metaDescription: '',
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 10 } }),
    );
  });

  it('returns null instead of task context for internal Chrome pages', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 9, title: 'Extensions', url: 'chrome://extensions/' } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    globalThis.chrome = {
      tabs: { query },
      scripting: {
        executeScript: vi.fn(),
      },
    } as unknown as typeof chrome;

    await expect(getActivePageContext()).resolves.toBeNull();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });
});
