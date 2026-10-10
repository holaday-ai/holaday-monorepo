import { describe, expect, it, vi } from 'vitest';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';
import { READ_URL_TOOL, runUnifiedBrowserLoop } from './unified-browser-loop.js';
import { createFallbackWebSearch, createFirecrawlReadPage } from './web-search-fallback.js';

const firecrawl = () => ({
  search: vi.fn(async () => ({
    ok: true as const,
    results: [{ url: 'https://example.com/a', markdown: '', title: 'A' }],
  })),
  scrape: vi.fn(async (url: string) => ({
    ok: true as const,
    url,
    title: '页面',
    markdown: '正文：收纳盒 ￥29',
  })),
});

describe('web search fallback', () => {
  it('uses the built-in search when it returns results', async () => {
    const fc = firecrawl();
    const search = createFallbackWebSearch({
      primary: async () => [{ title: 'Q', url: 'https://q.example' }],
      firecrawl: fc,
    });
    expect(await search?.('x')).toEqual([{ title: 'Q', url: 'https://q.example' }]);
    expect(fc.search).not.toHaveBeenCalled();
  });

  it.each([
    [
      'error',
      async () => {
        throw new Error('403');
      },
    ],
    ['empty', async () => []],
  ])('falls back to Firecrawl on primary %s', async (_label, primary) => {
    const fc = firecrawl();
    const onFallback = vi.fn();
    const search = createFallbackWebSearch({ primary, firecrawl: fc, onFallback });
    expect(await search?.('x')).toEqual([{ title: 'A', url: 'https://example.com/a' }]);
    expect(onFallback).toHaveBeenCalled();
  });

  it('falls back on a primary timeout', async () => {
    const fc = firecrawl();
    const search = createFallbackWebSearch({
      primary: () => new Promise(() => {}),
      firecrawl: fc,
      primaryTimeoutMs: 10,
    });
    expect(await search?.('x')).toHaveLength(1);
  });

  it('skips Firecrawl entirely when it is not configured', async () => {
    expect(createFallbackWebSearch({ primary: null, firecrawl: null })).toBeUndefined();
    expect(createFirecrawlReadPage(null)).toBeUndefined();
    const search = createFallbackWebSearch({
      primary: async () => {
        throw new Error('down');
      },
      firecrawl: null,
    });
    await expect(search?.('x')).rejects.toThrow('down');
  });
});

describe('read_url tool', () => {
  const adapter = (turns: Array<(r: NeutralMessagesRequest) => NeutralOutputContentBlock[]>) => {
    const requests: NeutralMessagesRequest[] = [];
    let i = 0;
    const a: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'scripted' },
      async create(request) {
        requests.push(request);
        const turn = turns[i++];
        if (!turn) throw new Error('exhausted');
        return {
          id: `r${i}`,
          metadata: this.metadata,
          content: turn(request),
          stopReason: 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    return { a, requests };
  };

  it('is offered only with a reader, and its page text can back the evidence', async () => {
    const fc = firecrawl();
    const { a, requests } = adapter([
      () => [
        { type: 'tool_use', id: 'r1', name: 'read_url', input: { url: 'https://example.com/a' } },
      ],
      () => [
        {
          type: 'tool_use',
          id: 'f1',
          name: 'finish',
          input: { status: 'completed', summary: '收纳盒 ￥29' },
        },
      ],
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: 'x',
      adapter: a,
      execute: async () => ({ ok: true, text: '' }),
      readPage: createFirecrawlReadPage(fc),
    });
    expect(requests[0]?.tools?.some((tool) => tool.name === READ_URL_TOOL.name)).toBe(true);
    expect(outcome).toMatchObject({ status: 'completed', evidence: '收纳盒 ￥29' });

    const { a: plain, requests: plainRequests } = adapter([
      () => [
        { type: 'tool_use', id: 'f', name: 'finish', input: { status: 'failed', summary: 'x' } },
      ],
    ]);
    await runUnifiedBrowserLoop({
      intent: 'x',
      adapter: plain,
      execute: async () => ({ ok: true, text: '' }),
    });
    expect(plainRequests[0]?.tools?.some((tool) => tool.name === 'read_url')).toBe(false);
  });
});
