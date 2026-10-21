import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { verifyDeterministic } from '../execution/answer-verifier.js';
import { EvidenceLedger } from '../execution/evidence-ledger.js';
import { buildContract } from '../execution/execution-contract.js';
import { createFirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import type { NeutralResponsesRequest, ResponsesAdapter } from '../llm/responses-adapter.js';
import { scrapeBrowserRetryInput } from '../trpc/routers/tasks.js';
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

  // PR #290 review: a read-only "打开 example.com 查看标题" is routed to scrape;
  // the page is fetched, not searched for.
  it.each([
    ['打开 example.com 查看标题', 'https://example.com'],
    ['看看 news.ycombinator.com 首页第一条', 'https://news.ycombinator.com'],
    ['Open developer.mozilla.org and tell me the title', 'https://developer.mozilla.org'],
  ])('a bare domain is that site: %s', (intent, url) => {
    expect(extractTargetUrl(intent)).toBe(url);
  });

  it.each(['总结 report.pdf 的内容', '把 notes.md 翻译成英文', '邮件发到 a@example.com'])(
    'a file name or an e-mail address is not a site: %s',
    (intent) => {
      expect(extractTargetUrl(intent)).toBeNull();
    },
  );
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

  it.each([
    '打开 https://www.youtube.com/watch?v=abc 读标题和播放量（不播放）',
    '打开 https://www.youtube.com/watch?v=abc 读标题，不要播放视频',
    '打开 https://www.bilibili.com/video/BV1xx 读标题，无需播放',
    '打开 https://www.douyin.com/video/1 读作者，请勿再播放',
    "Open https://www.youtube.com/watch?v=abc and read the title, don't play it",
  ])('a negated playback is not playing (PR #290 review): %s', async (intent) => {
    const d = await route(intent);
    expect(d.mode).toBe('scrape');
  });

  it('playing after a negated clause still is', async () => {
    const d = await route('不要静音，打开 https://www.bilibili.com/video/BV1xx 播放这个视频');
    expect(d).toMatchObject({ mode: 'browser', source: 'kw:interaction' });
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

  const unreachable = async (action: { tool: string }) =>
    action.tool === 'navigate'
      ? {
          ok: false,
          text: '浏览器导航或网络请求失败',
          errorCode: 'browser_network_failed' as const,
          errorMessage: 'page.goto: net::ERR_NAME_NOT_RESOLVED at [URL redacted]',
        }
      : { ok: true, text: '' };

  it('a wall page read_url returns is not content', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: '安全验证',
      markdown: '请完成安全验证后继续访问',
    }));
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://www.zhihu.com/question/1' } },
      { name: 'read_url', input: { url: 'https://www.zhihu.com/question/1' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '读知乎问题的标题',
      adapter,
      execute: unreachable as never,
      readPage,
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(seen.join('\n')).toContain('读取到的是登录、验证或拦截页');
  });

  it('after a wall, web search has no Firecrawl fallback; before it, it does', async () => {
    const withFirecrawl = vi.fn(async () => [{ title: 'A', url: 'https://a.example/' }]);
    const primaryOnly = vi.fn(async () => [{ title: 'B', url: 'https://b.example/' }]);
    const { adapter } = scripted([
      { name: 'web_search', input: { query: '西湖 面积' } },
      { name: 'request_human', input: { reason: 'login', message: '京东需要登录' } },
      { name: 'web_search', input: { query: '京东 商品 价格' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，读京东商品价格',
      adapter,
      execute: async () => ({ ok: true, text: '' }),
      webSearch: withFirecrawl,
      webSearchAfterWall: primaryOnly,
      requestHuman: async () => true,
    });
    expect(withFirecrawl).toHaveBeenCalledTimes(1);
    expect(primaryOnly).toHaveBeenCalledTimes(1);
    expect(primaryOnly).toHaveBeenCalledWith('京东 商品 价格');
  });

  it('a plain read before any wall still works', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '西湖面积6.38平方千米。',
    }));
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://baike.baidu.com/item/西湖' } },
      { name: 'read_url', input: { url: 'https://baike.baidu.com/item/西湖' } },
      { name: 'finish', input: { status: 'completed', summary: '面积 6.38平方千米' } },
    ]);
    await runUnifiedBrowserLoop({
      intent: '读西湖词条的面积',
      adapter,
      execute: unreachable as never,
      readPage,
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(seen.join('\n')).toContain('西湖面积6.38平方千米');
  });

  // fcr4 xhs-b: the note opened on 小红书's risk notice ("IP存在风险"), no blocker
  // was detected, and the model fetched the note through read_url instead.
  it('a page the browser opened is not fetched around, whatever it shows', async () => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '正文'.repeat(400),
    }));
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://www.xiaohongshu.com/explore/abc' } },
      { name: 'read_url', input: { url: 'https://www.xiaohongshu.com/explore/abc' } },
      { name: 'read_url', input: { url: 'https://www.xiaohongshu.com/explore/other' } },
      finishFailed,
    ]);
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，读这篇小红书笔记的标题',
      adapter,
      execute: async () => ({ ok: true, text: '安全限制 IP存在风险，请切换可靠网络环境后重试' }),
      readPage,
    });
    expect(readPage).not.toHaveBeenCalled();
    expect(seen.join('\n')).toContain('只读获取只用于网址无法解析、网络不可达的页面');
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

/** PR #290 review: the browser retry is the same request, attachments included. */
describe('the scrape → browser retry keeps the attachments', () => {
  it('drops only what would make it another task', () => {
    expect(
      scrapeBrowserRetryInput({
        intent: '把上传的 PDF 和 https://example.com/spec 对比',
        fileIds: ['fil_a', 'fil_b'],
        clientRequestId: 'req_1',
        retryOfTaskId: 'tsk_old',
        publicCloudContinuationOf: 'tsk_prev',
        localChrome: true,
        expertMode: 'normal',
      }),
    ).toEqual({
      intent: '把上传的 PDF 和 https://example.com/spec 对比',
      fileIds: ['fil_a', 'fil_b'],
      expertMode: 'normal',
    });
  });
});

/** DEPLOY-29 review, blocking 1: a sentence that also acts on the page is not a read. */
describe('reading and acting in one sentence goes to the browser', () => {
  const route = async (intent: string) =>
    explainExecutionMode({ intent, logger: logger() as never });
  it.each([
    '打开 https://shop.example.com/item/1 查看价格然后下单',
    '打开 https://example.com/cart 下单并告诉我价格',
    '打开 https://x.com/home 发一条推文，内容是hello，然后告诉我链接',
    'Open https://example.com/login and sign in, then tell me my balance',
    '打开 https://example.com 搜索框输入iphone并告诉我结果',
    'Open https://shop.example.com/item/1, add to cart and tell me the total',
    '打开 https://example.com/form 填写姓名并告诉我页面标题',
  ])('→ browser: %s', async (intent) => {
    expect((await route(intent)).mode).toBe('browser');
  });
  it.each([
    '打开 https://www.douyin.com/video/1 读标题、点赞数、评论数和发布日期',
    '打开 https://www.zhihu.com/question/1 读标题和关注者数',
    '打开 https://www.qcc.com/firm/1 读注册资本和注册时间',
    '打开 https://www.xiaohongshu.com/explore/abc 读收藏数和评论区第一条',
    'Open https://example.com/blog/post and summarize the post',
  ])('fields named like actions are still reads → scrape: %s', async (intent) => {
    expect((await route(intent)).mode).toBe('scrape');
  });
});

/** DEPLOY-29 review, blocking 2: challenge and block pages are not content. */
describe('challenge pages, titles and statuses are walls', () => {
  const footer = `\n\n${'Footer link text about the company and its products. '.repeat(30)}`;
  it.each([
    'Verifying you are human. This may take a few seconds.',
    'example.com needs to review the security of your connection before proceeding.',
    'Checking your browser before accessing example.com.',
    'Attention Required! | Cloudflare\n\nSorry, you have been blocked',
    'Access to this page has been denied.',
    'Pardon Our Interruption\n\nAs you were browsing something about your browser made us think you were a bot.',
    '当前环境异常，完成验证后即可继续访问。',
    '访问过于频繁，请稍后再试',
    'Please log in to view this content.',
  ])('a challenge near the top is a wall even on a long page: %s', (markdown) => {
    expect(scrapedWall(markdown + footer)).not.toBeNull();
  });

  // fcr9 jd: Firecrawl got JD's login notice with status 200.
  it("JD's 「京东验证」 login notice is a wall", () => {
    expect(
      scrapedWall(
        '验证一下，购物无忧 请点击下方按钮登录，查看更多精彩内容 前往登录 遇到问题点我反馈',
        '京东验证',
      ),
    ).not.toBeNull();
    expect(
      scrapedWall('验证一下，购物无忧 请点击下方按钮登录，查看更多精彩内容 前往登录'),
    ).not.toBeNull();
  });

  it.each(['安全验证', '京东验证 - 京东', 'Security Check', 'Sign in | Example', 'Access Denied'])(
    'a short notice title makes the page a wall: %s',
    (title) => {
      expect(scrapedWall(`# x${footer}`, title)).not.toBeNull();
    },
  );

  it.each([
    '如何设计登录与验证流程：一份完整指南',
    'Verification of distributed systems — a survey',
    '登录页设计规范',
    'Login form best practices',
  ])('a title that mentions login or verification is a page: %s', (title) => {
    expect(scrapedWall(`# ${title}${footer}`, title)).toBeNull();
  });

  it('a title that is a challenge makes the page a wall', () => {
    expect(scrapedWall(`# Welcome${footer}`, 'Just a moment...')).not.toBeNull();
    expect(scrapedWall(`# Welcome${footer}`, 'Attention Required! | Cloudflare')).not.toBeNull();
  });

  it('an article that discusses such pages further down is not a wall', () => {
    const article = `# How bot protection works\n\n${'Websites protect themselves from automated abuse in several ways. '.repeat(40)}\nOne common message reads "Checking your browser before accessing".`;
    expect(scrapedWall(article, 'How bot protection works')).toBeNull();
  });

  it.each([401, 403, 429, 503])(
    'Firecrawl status %i is a blocked failure, not content',
    async (status) => {
      const firecrawl: FirecrawlLane = {
        scrape: vi.fn(async (url: string) => ({
          ok: true as const,
          url,
          markdown: `# Some page${footer}`,
          title: 'Some page',
          credits: 1,
          statusCode: status,
        })),
        search: vi.fn(),
      };
      const adapter = answers('x');
      const outcome = await run(firecrawl, adapter);
      expect(outcome).toMatchObject({ status: 'failed', failureKind: 'blocked' });
      expect(outcome.reason).toContain(`HTTP ${status}`);
      expect(adapter.stream).not.toHaveBeenCalled();
    },
  );

  it('status 200 with a real page is content', async () => {
    const firecrawl: FirecrawlLane = {
      scrape: vi.fn(async (url: string) => ({
        ok: true as const,
        url,
        markdown: ARTICLE,
        title: '西湖_百度百科',
        credits: 1,
        statusCode: 200,
      })),
      search: vi.fn(),
    };
    expect((await run(firecrawl, answers('西湖湖面面积为6.38平方千米。'))).status).toBe(
      'completed',
    );
  });
});

/** DEPLOY-29 review (non-blocking, fixed): read_url only for a page the network could not reach. */
describe('read_url only where the network failed', () => {
  function scripted2(calls: Array<{ name: string; input: Record<string, unknown> }>) {
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
  it.each([
    [
      'a timeout (a slow verification page)',
      { errorCode: 'browser_timeout', errorMessage: 'Timeout 30000ms exceeded' },
      false,
    ],
    [
      'an HTTP error (an IP block)',
      { errorCode: 'browser_network_failed', errorMessage: 'net::ERR_HTTP_RESPONSE_CODE_FAILURE' },
      false,
    ],
    [
      'a reset connection',
      { errorCode: 'browser_network_failed', errorMessage: 'net::ERR_CONNECTION_RESET' },
      false,
    ],
    [
      'an unresolved name',
      { errorCode: 'browser_network_failed', errorMessage: 'net::ERR_NAME_NOT_RESOLVED' },
      true,
    ],
    [
      'an unreachable address',
      { errorCode: 'browser_network_failed', errorMessage: 'net::ERR_ADDRESS_UNREACHABLE' },
      true,
    ],
  ] as const)('after %s: read_url %s', async (_, failure, allowed) => {
    const readPage = vi.fn(async (url: string) => ({
      url,
      title: 'T',
      markdown: '正文'.repeat(400),
    }));
    const { adapter } = scripted2([
      { name: 'navigate', input: { url: 'https://example.com/a' } },
      { name: 'read_url', input: { url: 'https://example.com/a' } },
      { name: 'finish', input: { status: 'failed', summary: '打不开' } },
    ]);
    await runUnifiedBrowserLoop({
      intent: '读这一页的标题',
      adapter,
      execute: (async (action: { tool: string }) =>
        action.tool === 'navigate'
          ? { ok: false, text: '失败', ...failure }
          : { ok: true, text: '' }) as never,
      readPage,
    });
    expect(readPage).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});

/** DEPLOY-29 review (non-blocking, fixed): one bare domain to read, not a topic or a name. */
describe('bare domains that are not one page to fetch', () => {
  it.each([
    '搜索 openai.com 最新新闻',
    '比较 github.com 和 gitlab.com',
    'compare vercel.com vs netlify.com',
    '介绍一下 ASP.NET 的优点',
    'Socket.IO 怎么用',
  ])('no single target: %s', (intent) => {
    expect(extractTargetUrl(intent)).toBeNull();
  });
});
