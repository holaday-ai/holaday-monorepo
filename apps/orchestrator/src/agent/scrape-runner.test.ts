/**
 * Phase 24 RC follow-up — scrape-runner unit tests.
 *
 * The scrape runner is the executor for the new 'scrape' execution
 * mode: it asks Firecrawl for the relevant pages, then asks the LLM
 * to synthesise an answer from the returned markdown. Two pure
 * helpers — extractTargetUrl and extractSearchQuery — get most of
 * the test coverage; the runner itself is mostly orchestration over
 * mocked deps (Firecrawl + Anthropic).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import {
  extractTargetUrl,
  extractSearchQuery,
  runScrapeTask,
} from './scrape-runner.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

describe('extractTargetUrl', () => {
  it('extracts https URL', () => {
    expect(extractTargetUrl('总结 https://example.com/article 这篇文章')).toBe(
      'https://example.com/article',
    );
  });

  it('extracts http URL', () => {
    expect(extractTargetUrl('抓 http://blog.example.org')).toBe(
      'http://blog.example.org',
    );
  });

  it('promotes www-prefixed bare host to https', () => {
    expect(extractTargetUrl('看一下 www.zhihu.com')).toBe('https://www.zhihu.com');
  });

  it('returns null when no URL', () => {
    expect(extractTargetUrl('帮我翻译这段话')).toBeNull();
  });

  it('strips trailing punctuation from a URL', () => {
    expect(extractTargetUrl('看 https://example.com/x.')).toBe('https://example.com/x');
    expect(extractTargetUrl('打开 https://example.com/x，然后')).toBe('https://example.com/x');
  });
});

describe('extractSearchQuery', () => {
  it('strips leading 搜索/查询/查找 verbs', () => {
    expect(extractSearchQuery('搜索小红书上露营装备热门笔记')).toBe(
      '小红书上露营装备热门笔记',
    );
    expect(extractSearchQuery('查询苹果最新财报')).toBe('苹果最新财报');
  });

  it('strips English search verbs', () => {
    expect(extractSearchQuery('search for iPhone 16 prices')).toMatch(/iphone 16 prices/i);
    expect(extractSearchQuery('look up github trending')).toMatch(/github trending/i);
  });

  it('keeps the intent intact when no verb matches', () => {
    expect(extractSearchQuery('AI Agent 在国内的应用')).toBe('AI Agent 在国内的应用');
  });

  it('truncates at 200 chars', () => {
    const long = 'a'.repeat(500);
    expect(extractSearchQuery(long).length).toBeLessThanOrEqual(200);
  });

  it('returns empty string for empty input', () => {
    expect(extractSearchQuery('   ')).toBe('');
  });
});

describe('runScrapeTask — happy paths', () => {
  function makeAnthropic(textOut: string): {
    client: { messages: { create: ReturnType<typeof vi.fn> } };
    create: ReturnType<typeof vi.fn>;
  } {
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: textOut }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 200 },
    }));
    return { client: { messages: { create } }, create };
  }

  it('routes a URL intent through firecrawl.scrape', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(async () => ({
        ok: true as const,
        markdown: '# Article\n\nKey insight.',
        url: 'https://example.com/article',
        title: 'Article',
      })),
      search: vi.fn(),
    };
    const { client } = makeAnthropic('## Summary\n\nThe article says X.');
    const out = await runScrapeTask({
      taskId: 'tsk_a',
      userId: 'u',
      intent: '总结 https://example.com/article 这篇文章',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      firecrawl,
      logger: fakeLogger(),
    });

    expect(out.status).toBe('completed');
    if (out.status === 'completed') expect(out.summary).toMatch(/article says X/i);
    expect(firecrawl.scrape).toHaveBeenCalledWith('https://example.com/article');
    expect(firecrawl.search).not.toHaveBeenCalled();
  });

  it('routes a non-URL intent through firecrawl.search', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(),
      search: vi.fn(async () => ({
        ok: true as const,
        results: [
          {
            url: 'https://news.example.com/a',
            markdown: '# News A',
            title: 'News A',
          },
        ],
      })),
    };
    const { client } = makeAnthropic('## Found 1 result.');
    const out = await runScrapeTask({
      taskId: 'tsk_b',
      userId: 'u',
      intent: '搜索小红书上露营装备热门笔记',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any,
      firecrawl,
      logger: fakeLogger(),
    });

    expect(out.status).toBe('completed');
    expect(firecrawl.scrape).not.toHaveBeenCalled();
    expect(firecrawl.search).toHaveBeenCalled();
    const searchCall = (firecrawl.search as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    // Query should NOT contain the leading verb 搜索
    expect(String(searchCall[0])).not.toMatch(/^搜索/);
  });
});

describe('runScrapeTask — failure surfacing', () => {
  it('surfaces firecrawl error as failed outcome', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(async () => ({
        ok: false as const,
        error: 'firecrawl: api key not configured (FIRECRAWL_API_KEY empty)',
      })),
      search: vi.fn(),
    };
    const create = vi.fn();
    const out = await runScrapeTask({
      taskId: 'tsk_x',
      userId: 'u',
      intent: '总结 https://example.com 这篇',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { messages: { create } } as any,
      firecrawl,
      logger: fakeLogger(),
    });

    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.reason).toMatch(/firecrawl|api key/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('failed when firecrawl.search returns no results', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(),
      search: vi.fn(async () => ({ ok: true as const, results: [] })),
    };
    const create = vi.fn();
    const out = await runScrapeTask({
      taskId: 'tsk_y',
      userId: 'u',
      intent: '查找绝对没有结果的偏门关键词',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: { messages: { create } } as any,
      firecrawl,
      logger: fakeLogger(),
    });

    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.reason).toMatch(/没有结果|no results/i);
    expect(create).not.toHaveBeenCalled();
  });
});
