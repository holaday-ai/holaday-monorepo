import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { verifyDeterministic } from '../execution/answer-verifier.js';
import { EvidenceLedger } from '../execution/evidence-ledger.js';
import { buildContract } from '../execution/execution-contract.js';
import { createFirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import { runUnifiedBrowserLoop } from './browser-tools/unified-browser-loop.js';
import { explainExecutionMode } from './intent-classifier.js';
import {
  compactMarkdown,
  extractTargetUrl,
  runScrapeTask,
  scrapedEvidence,
  scrapedWall,
} from './scrape-runner.js';

/**
 * FIRECRAWL-1 — read-only page tasks go to Firecrawl first; a page it cannot
 * read (error, wall, nothing but navigation) or an answer that disagrees with
 * the page goes to the cloud browser; only basic fetching is ever asked for.
 */

const METADATA = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  model: 'qwen3.8-plus',
  endpointKind: 'public' as const,
  protocol: 'responses' as const,
};

function logger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => logger(),
  } as unknown as Logger;
}

/** A model that answers with each text in turn. */
function answers(...texts: string[]): ResponsesAdapter & { requests: NeutralResponsesRequest[] } {
  const requests: NeutralResponsesRequest[] = [];
  let turn = 0;
  return {
    metadata: METADATA,
    requests,
    stream: vi.fn(async (request: NeutralResponsesRequest) => {
      requests.push(request);
      const text = texts[Math.min(turn++, texts.length - 1)]!;
      return {
        id: `resp_${turn}`,
        metadata: METADATA,
        text,
        sources: [],
        usage: { inputTokens: 10, outputTokens: 20 },
        status: 'completed' as const,
      };
    }),
  } as unknown as ResponsesAdapter & { requests: NeutralResponsesRequest[] };
}

const ARTICLE = [
  '[首页](https://example.com/) [新闻](https://example.com/news) [关于](https://example.com/about) [登录](https://example.com/login)',
  '![logo](https://example.com/logo.png)',
  '# 西湖',
  '',
  '西湖位于浙江省杭州市西湖区龙井路1号，杭州市区西部，汇水面积为21.22平方千米，湖面面积为6.38平方千米。',
  '',
  '2011年6月24日，杭州西湖文化景观被列入《世界遗产名录》。',
].join('\n');

function page(markdown: string, url = 'https://baike.baidu.com/item/西湖'): FirecrawlLane {
  return {
    scrape: vi.fn(async () => ({
      ok: true as const,
      markdown,
      url,
      title: '西湖_百度百科',
      credits: 1,
    })),
    search: vi.fn(),
  };
}

function run(
  firecrawl: FirecrawlLane,
  adapter: ResponsesAdapter,
  intent = '打开 https://baike.baidu.com/item/西湖 总结这一页',
) {
  return runScrapeTask({
    taskId: 'tsk_fc1',
    userId: 'usr_fc1',
    intent,
    responsesAdapter: adapter,
    firecrawl,
    logger: logger(),
  });
}

describe('walls and empty pages', () => {
  it.each([
    '请完成安全验证后继续访问',
    '## 访问受限\n您的请求可能存在威胁，已被拦截！',
    'Just a moment...\nEnable JavaScript and cookies to continue',
    '登录后查看更多精彩内容 [立即登录](https://www.xiaohongshu.com/login)',
    'Please verify you are human. CAPTCHA',
  ])('a short notice page is a wall: %s', (markdown) => {
    expect(scrapedWall(markdown)).not.toBeNull();
  });

  it('a long article that mentions 验证码 is not a wall', () => {
    const article = `# 短信验证码的安全设计\n\n${'验证码是一种常见的身份校验手段，本文介绍它的历史、原理与常见攻击方式。'.repeat(20)}`;
    expect(scrapedWall(article)).toBeNull();
    expect(scrapedWall(ARTICLE)).toBeNull();
  });

  it('drops navigation-only lines and images, keeps links inside sentences', () => {
    const compact = compactMarkdown(
      `${ARTICLE}\n\n更多内容见[官方网站](https://example.com/official)。`,
    );
    expect(compact).not.toContain('[首页]');
    expect(compact).not.toContain('logo.png');
    expect(compact).toContain('西湖位于浙江省杭州市');
    expect(compact).toContain('[官方网站](https://example.com/official)');
  });

  it('the page evidence is its words, with its links listed', () => {
    const evidence = scrapedEvidence({
      url: 'https://baike.baidu.com/item/西湖',
      title: '西湖_百度百科',
      markdown: `${ARTICLE}\n\n更多内容见[官方网站](https://example.com/official)。`,
    });
    expect(evidence.sourceURL).toBe('https://baike.baidu.com/item/西湖');
    expect(evidence.text).toContain('西湖_百度百科');
    expect(evidence.text).toContain('更多内容见官方网站。');
    expect(evidence.text).not.toContain('](');
    expect(evidence.links).toContainEqual({
      text: '官方网站',
      url: 'https://example.com/official',
    });
  });

  it('a bare domain with a page path is that page', () => {
    expect(extractTargetUrl('baike.baidu.com/item/西湖 讲了什么')).toBe(
      'https://baike.baidu.com/item/西湖',
    );
    expect(extractTargetUrl('总结 report.pdf 的内容')).toBeNull();
  });
});

describe('the scrape runner', () => {
  it('a wall is a blocked failure, and the model is never asked', async () => {
    const adapter = answers('不该被调用');
    const outcome = await run(page('请完成安全验证后继续访问'), adapter);
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'blocked' });
    expect(outcome.reason).toContain('Firecrawl');
    expect(outcome.reason).toContain('验证');
    expect(adapter.stream).not.toHaveBeenCalled();
  });

  it('a navigation-only page is an empty failure', async () => {
    const outcome = await run(
      page('[首页](https://a.cn/) [新闻](https://a.cn/n) [关于](https://a.cn/a)'),
      answers('x'),
    );
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'empty' });
  });

  it('a Firecrawl error says so, without its raw text', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(async () => ({
        ok: false as const,
        error: 'firecrawl HTTP 500: {"code":"SCRAPE_ALL_ENGINES_FAILED"}',
      })),
      search: vi.fn(),
    };
    const outcome = await run(firecrawl, answers('x'));
    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'firecrawl',
      reason: '网页抓取（Firecrawl）没有拿到正文：目标站点拒绝了抓取',
    });
  });

  it('a misquote is sent back once with the page wording; the corrected answer is delivered', async () => {
    const adapter = answers(
      '西湖湖面面积为「6.83平方千米」。',
      '西湖湖面面积为「6.38平方千米」，2011年列入世界遗产名录。',
    );
    const outcome = await run(page(ARTICLE), adapter);
    expect(adapter.stream).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(adapter.requests[1]?.input)).toContain('与抓取原文不符');
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('6.38平方千米');
    expect(outcome.summary).toContain('来源：https://baike.baidu.com/item/西湖');
  });

  it('an answer that still disagrees with the page is a facts failure', async () => {
    const adapter = answers('湖面面积为「6.83平方千米」。', '湖面面积为「7.38平方千米」。');
    const outcome = await run(page(ARTICLE), adapter);
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'facts' });
    expect(outcome.reason).toContain('抓取内容核验未通过');
  });

  it('facts the page does not show verbatim are delivered with the same 未核实 note', async () => {
    const outcome = await run(page(ARTICLE), answers('西湖位于杭州市。\n- 作者：杭州市园林文物局'));
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('未核实：以下内容未能在已读页面中逐字找到');
  });

  it('an answer that cites the fetched page gets no extra source line', async () => {
    const outcome = await run(
      page(ARTICLE),
      answers('西湖在杭州市（来源 https://baike.baidu.com/item/西湖）。'),
    );
    expect(outcome.summary).not.toContain('来源：https://');
  });

  it('search results that are only walls are not material', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(),
      search: vi.fn(async () => ({
        ok: true as const,
        credits: 2,
        results: [
          { url: 'https://a.example/1', markdown: '请先登录' },
          { url: 'https://a.example/2', markdown: 'Access Denied' },
        ],
      })),
    };
    const outcome = await run(firecrawl, answers('x'), '搜索一下西湖的面积');
    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'blocked',
      firecrawl: { calls: 1, credits: 2 },
    });
  });
});

describe('only basic fetching is asked for', () => {
  it('scrape and search send no stealth, proxy or bypass option, and read the credits used', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          success: true,
          data: _url.endsWith('/v1/scrape')
            ? { markdown: '# A', metadata: { sourceURL: 'https://a.example/', creditsUsed: 1 } }
            : [{ url: 'https://a.example/', markdown: '# A' }],
          creditsUsed: 3,
        }),
        { status: 200 },
      );
    });
    const lane = createFirecrawlLane({ apiKey: 'fc-test', fetch: fetchFn as typeof fetch });
    const scraped = await lane.scrape('https://a.example/');
    const searched = await lane.search('a', { limit: 3 });
    expect(scraped).toMatchObject({ ok: true, credits: 1 });
    expect(searched).toMatchObject({ ok: true, credits: 3 });
    expect(Object.keys(bodies[0]!).sort()).toEqual(['formats', 'url']);
    expect(Object.keys(bodies[1]!).sort()).toEqual(['limit', 'query', 'scrapeOptions']);
    expect(Object.keys(bodies[1]!.scrapeOptions as object)).toEqual(['formats']);
    const sent = JSON.stringify(bodies);
    for (const option of ['stealth', 'proxy', 'mobile', 'location', 'actions', 'headers'])
      expect(sent).not.toContain(option);
  });
});

describe('routing: reading one page goes to Firecrawl, driving a page to the browser', () => {
  const route = async (intent: string) =>
    explainExecutionMode({ intent, logger: logger() as never });

  it.each([
    '打开 https://baike.baidu.com/item/西湖 总结这一页的简介',
    '访问 https://www.zhihu.com/question/123 读标题和前3个回答的作者',
    '打开 https://www.xiaohongshu.com/explore/abc 读笔记标题、作者和点赞数',
    '打开京东 https://item.jd.com/100012043978.html 读商品标题和价格',
    'Open https://example.com/blog/post and summarize it',
    'Open https://docs.python.org/3/whatsnew/3.12.html and list the first three highlights',
    'baike.baidu.com/item/西湖 讲了什么',
  ])('read-only page → scrape: %s', async (intent) => {
    const d = await route(intent);
    expect(d.mode).toBe('scrape');
  });

  it.each([
    ['请使用云端浏览器，打开 https://baike.baidu.com/item/西湖 总结简介', 'kw:explicit-browser'],
    ['打开 https://example.com', 'kw:interaction'],
    ['打开 https://example.com 并截图', 'kw:explicit-browser'],
    ['打开 https://example.com 点击登录按钮', 'kw:explicit-browser'],
    ['打开 https://example.com/form 填写表单里的姓名和邮箱', 'kw:interaction'],
    ['the-internet.herokuapp.com/infinite_scroll 滚动5次后读内容', 'kw:interaction'],
    ['从 https://en.wikipedia.org/wiki/Web_browser 打开3个链接到新标签读标题', 'kw:interaction'],
    ['打开 https://www.bilibili.com/video/BV1xx 播放这个视频', 'kw:interaction'],
    ['打开 https://web2.0calc.com/ 用计算器算 128 × 128 读结果', 'kw:interaction'],
    ['用京东搜索 iPhone 16 的价格', 'kw:interaction'],
  ])('needs the live page → browser: %s', async (intent, source) => {
    const d = await route(intent);
    expect(d).toMatchObject({ mode: 'browser', source });
  });

  it('「不播放 / 播放量」 is not playing', async () => {
    const d = await route('打开 https://www.youtube.com/watch?v=abc 读标题和播放量（不播放）');
    expect(d.mode).toBe('scrape');
  });
});

/**
 * Coordinator 06:20 — fetching goes Firecrawl → browser, never back: once the
 * browser meets a login, verification or block wall in a task, its read-only
 * reader (Firecrawl) is closed for that task, and a wall page it returns is
 * not content.
 */
describe('the browser never fetches around a wall', () => {
  function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
    let turn = 0;
    const seen: string[] = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'scripted' },
      async create(request) {
        seen.push(JSON.stringify(request.messages.at(-1)));
        const call = calls[Math.min(turn++, calls.length - 1)]!;
        return {
          id: String(turn),
          metadata: { provider: 'anthropic', model: 'scripted' },
          content: [{ type: 'tool_use', id: String(turn), ...call }],
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
    return { adapter, seen };
  }
  const finishFailed = {
    name: 'finish',
    input: { status: 'failed', summary: '页面需要登录，拿不到正文。' },
  };

  it('after a login handover, read_url is refused and Firecrawl is not called', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '正文'.repeat(400),
    }));
    const { adapter, seen } = scripted([
      { name: 'request_human', input: { reason: 'login', message: '知乎需要登录' } },
      { name: 'read_url', input: { url: 'https://www.zhihu.com/question/1' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，读知乎问题 https://www.zhihu.com/question/1 的标题',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      readPage,
      requestHuman: async () => true,
    });
    expect(readPage).not.toHaveBeenCalled();
    expect(seen.join('\n')).toContain('不能改用只读抓取去取被挡住的内容');
  });

  it('after the page probe meets a wall, read_url is refused', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '正文'.repeat(400),
    }));
    let probes = 0;
    const { adapter } = scripted([
      { name: 'finish', input: { status: 'completed', summary: '标题是 X' } },
      { name: 'read_url', input: { url: 'https://www.zhihu.com/question/1' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，读知乎问题 https://www.zhihu.com/question/1 的标题',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      readPage,
      probeBlocker: async () =>
        probes++ === 0 ? { reason: 'login', message: '页面要求登录' } : null,
      requestHuman: async () => true,
    } as never);
    expect(readPage).not.toHaveBeenCalled();
  });

  it('a wall page read_url returns is not content', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: '安全验证',
      markdown: '请完成安全验证后继续访问',
    }));
    const { adapter, seen } = scripted([
      { name: 'read_url', input: { url: 'https://www.zhihu.com/question/1' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '读知乎问题的标题',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      readPage,
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(seen.join('\n')).toContain('读取到的是登录、验证或拦截页');
  });

  it('a plain read before any wall still works', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '西湖面积6.38平方千米。',
    }));
    const { adapter, seen } = scripted([
      { name: 'read_url', input: { url: 'https://baike.baidu.com/item/西湖' } },
      { name: 'finish', input: { status: 'completed', summary: '面积 6.38平方千米' } },
    ]);
    await runUnifiedBrowserLoop({
      intent: '读西湖词条的面积',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      readPage,
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(seen.join('\n')).toContain('西湖面积6.38平方千米');
  });
});

/** Coordinator 06:20 — the 30-character floor for one short page read, both ways. */
describe('one short page read: 30 characters, not 100', () => {
  const verify = (intent: string, answerText: string) => {
    const contract = buildContract({ taskId: 'tsk_len', intent, executionMode: 'scrape' });
    const id = contract.successCriteria.find((c) => c.type === 'word_count')?.id;
    return verifyDeterministic({
      contract,
      ledger: new EvidenceLedger('tsk_len'),
      answerText,
    }).checks.find((check) => check.criterionId === id);
  };
  const PAGE = '访问 https://www.zhihu.com/question/287581453 读这个问题的标题和第一个回答的作者';

  it('a complete short answer passes', () => {
    expect(
      verify(
        PAGE,
        '问题标题：杭州西湖多大面积？\n第一个回答的作者：郝穴老汉\n来源：https://www.zhihu.com/question/287581453',
      )?.passed,
    ).toBe(true);
  });

  it('a short answer that says nothing still fails', () => {
    expect(verify(PAGE, '页面未显示。')?.passed).toBe(false);
    expect(verify(PAGE, '标题：杭州西湖')?.passed).toBe(false);
  });

  it('a search keeps the 100-character floor', () => {
    expect(
      verify('搜索一下杭州西湖有多大', '西湖面积约6.38平方千米，位于杭州市西湖区。')?.passed,
    ).toBe(false);
  });
});
