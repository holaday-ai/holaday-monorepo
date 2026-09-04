import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import { ResponsesAdapterError } from '../llm/responses-adapter.js';
import { extractSearchQuery, extractTargetUrl, runScrapeTask } from './scrape-runner.js';

const METADATA = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  model: 'qwen3.8-plus',
  endpointKind: 'public' as const,
  protocol: 'responses' as const,
};

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

function makeAdapter(
  input: {
    text?: string;
    sources?: Array<{ title: string; url: string; provenance: 'web_search' }>;
    error?: Error;
    hang?: boolean;
    status?: 'completed' | 'incomplete';
  } = {},
): ResponsesAdapter {
  const stream = vi.fn(
    async (
      _request: NeutralResponsesRequest,
      options?: { signal?: AbortSignal; onTextDelta?: (delta: string) => void },
    ) => {
      if (input.hang) {
        return new Promise<never>((_resolve, reject) => {
          const abort = () => reject(new ResponsesAdapterError('REQUEST_ABORTED'));
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      if (input.error) throw input.error;
      const text = input.text ?? '整理后的结果';
      if (text) options?.onTextDelta?.(text);
      return {
        id: 'resp_scrape',
        metadata: METADATA,
        text,
        sources: input.sources ?? [],
        usage: { inputTokens: 100, outputTokens: 200 },
        status: input.status ?? ('completed' as const),
        ...(input.status === 'incomplete'
          ? { incompleteReason: 'max_output_tokens' as const }
          : {}),
      };
    },
  );
  return { metadata: METADATA, stream };
}

function scrapeLane(override: Partial<FirecrawlLane> = {}): FirecrawlLane {
  return {
    scrape: vi.fn(async (url: string) => ({
      ok: true as const,
      markdown: '# Article\n\nObserved content.',
      url,
      title: 'Article',
    })),
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
    ...override,
  };
}

function run(input: {
  intent?: string;
  adapter?: ResponsesAdapter;
  firecrawl?: FirecrawlLane;
  timeoutMs?: number;
  expertMode?: 'normal' | 'expert' | 'auto';
  onStreamDelta?: (delta: string) => void;
  onProgress?: (message: string) => void;
}) {
  return runScrapeTask({
    taskId: 'tsk_scrape',
    userId: 'usr_test',
    intent: input.intent ?? '总结 https://example.com/article',
    responsesAdapter: input.adapter ?? makeAdapter(),
    firecrawl: input.firecrawl ?? scrapeLane(),
    logger: fakeLogger(),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.expertMode ? { expertMode: input.expertMode } : {}),
    ...(input.onStreamDelta ? { onStreamDelta: input.onStreamDelta } : {}),
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
  });
}

describe('extractTargetUrl', () => {
  it('extracts http(s) and promotes www', () => {
    expect(extractTargetUrl('总结 https://example.com/article 这篇文章')).toBe(
      'https://example.com/article',
    );
    expect(extractTargetUrl('抓 http://blog.example.org')).toBe('http://blog.example.org');
    expect(extractTargetUrl('看一下 www.zhihu.com')).toBe('https://www.zhihu.com');
  });

  it('strips punctuation and returns null without a URL', () => {
    expect(extractTargetUrl('看 https://example.com/x，然后')).toBe('https://example.com/x');
    expect(extractTargetUrl('帮我翻译这段话')).toBeNull();
  });
});

describe('extractSearchQuery', () => {
  it('strips Chinese and English search verbs', () => {
    expect(extractSearchQuery('搜索小红书上露营装备热门笔记')).toBe('小红书上露营装备热门笔记');
    expect(extractSearchQuery('look up github trending')).toBe('github trending');
  });

  it('keeps plain intent, caps length and handles empty input', () => {
    expect(extractSearchQuery('AI Agent 在国内的应用')).toBe('AI Agent 在国内的应用');
    expect(extractSearchQuery('a'.repeat(500))).toHaveLength(200);
    expect(extractSearchQuery('   ')).toBe('');
  });
});

describe('runScrapeTask — Qwen synthesis', () => {
  it('routes a URL through Firecrawl scrape and streams the result', async () => {
    const firecrawl = scrapeLane();
    const deltas: string[] = [];
    const progress: string[] = [];
    const outcome = await run({
      firecrawl,
      onStreamDelta: (delta) => deltas.push(delta),
      onProgress: (message) => progress.push(message),
    });

    expect(firecrawl.scrape).toHaveBeenCalledWith('https://example.com/article');
    expect(firecrawl.search).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: '整理后的结果',
      sources: ['https://example.com/article'],
      inputTokens: 100,
      outputTokens: 200,
    });
    expect(deltas).toEqual(['整理后的结果']);
    expect(progress).toEqual(['正在抓取网页数据…', '正在分析整理…']);
  });

  it('routes a non-URL intent through Firecrawl search', async () => {
    const firecrawl = scrapeLane();
    const outcome = await run({
      intent: '搜索小红书上露营装备热门笔记',
      firecrawl,
    });
    expect(firecrawl.scrape).not.toHaveBeenCalled();
    expect(firecrawl.search).toHaveBeenCalledWith('小红书上露营装备热门笔记', {
      limit: 5,
    });
    expect(outcome.sources).toEqual(['https://news.example.com/a']);
  });

  it('disables provider tools and keeps provider prose URLs out of evidence', async () => {
    const adapter = makeAdapter({
      text: '摘要里出现 https://invented.test，但它不是证据。',
      sources: [
        {
          title: 'Provider source',
          url: 'https://provider.example/untracked',
          provenance: 'web_search',
        },
      ],
    });
    const outcome = await run({ adapter });
    expect(vi.mocked(adapter.stream).mock.calls[0]?.[0]).toMatchObject({ tools: [] });
    expect(outcome.sources).toEqual(['https://example.com/article']);
    expect(outcome.sources).not.toContain('https://provider.example/untracked');
    expect(outcome.sources).not.toContain('https://invented.test');
  });

  it('passes bounded Firecrawl context and the expert quality contract', async () => {
    const adapter = makeAdapter();
    await run({ adapter, expertMode: 'expert' });
    const request = vi.mocked(adapter.stream).mock.calls[0]?.[0];
    expect(request?.instructions).toContain('专家模式质量合同');
    expect(JSON.stringify(request?.input)).toContain('Observed content');
    expect(request?.maxOutputTokens).toBe(8192);
  });

  it('adds a visible notice to an incomplete response', async () => {
    const outcome = await run({ adapter: makeAdapter({ text: '部分结果', status: 'incomplete' }) });
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('内容因长度限制被截断');
  });

  it('returns a fixed error for empty Qwen output', async () => {
    const outcome = await run({ adapter: makeAdapter({ text: '' }) });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'AI 没有生成内容，请重试。' });
    expect(outcome.sources).toEqual(['https://example.com/article']);
  });

  it('sanitizes provider failures', async () => {
    const outcome = await run({ adapter: makeAdapter({ error: new Error('secret endpoint') }) });
    expect(outcome.reason).toBe('内容整理服务暂时不可用，请稍后重试。');
    expect(outcome.reason).not.toContain('secret endpoint');
  });

  it('aborts a hanging synthesis at the task timeout', async () => {
    const outcome = await run({ adapter: makeAdapter({ hang: true }), timeoutMs: 10 });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('生成超时');
  });
});

describe('runScrapeTask — Firecrawl failures', () => {
  it('sanitizes a scrape error and never calls Qwen', async () => {
    const adapter = makeAdapter();
    const firecrawl = scrapeLane({
      scrape: vi.fn(async () => ({ ok: false as const, error: 'secret key missing' })),
    });
    const outcome = await run({ adapter, firecrawl });
    expect(outcome).toMatchObject({ status: 'failed', reason: '网页抓取失败，请稍后重试。' });
    expect(adapter.stream).not.toHaveBeenCalled();
  });

  it('returns a clear result when search has no matches', async () => {
    const adapter = makeAdapter();
    const firecrawl = scrapeLane({
      search: vi.fn(async () => ({ ok: true as const, results: [] })),
    });
    const outcome = await run({
      intent: '查找绝对没有结果的偏门关键词',
      adapter,
      firecrawl,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: '搜索没有结果，换个关键词试试。' });
    expect(adapter.stream).not.toHaveBeenCalled();
  });

  it('rejects an empty search query before calling dependencies', async () => {
    const adapter = makeAdapter();
    const firecrawl = scrapeLane();
    const outcome = await run({ intent: '搜索', adapter, firecrawl });
    expect(outcome).toMatchObject({ status: 'failed', reason: '请输入要搜索的内容。' });
    expect(firecrawl.search).not.toHaveBeenCalled();
    expect(adapter.stream).not.toHaveBeenCalled();
  });
});
