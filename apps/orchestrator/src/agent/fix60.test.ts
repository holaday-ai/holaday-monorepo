/**
 * FIX-60: 没拿到就别说完成 + 英文问题用英文答 + 价格对准那一款.
 */
import { readFileSync } from 'node:fs';
import {
  isEnglishRequestText,
  replyLanguage,
  replyLanguageRule,
  replyPlan,
  requestLanguage,
  writingRequest,
} from '@holaday/shared-types';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import { scrapedErrorPage, scrapedWall } from '../firecrawl/scraped-page.js';
import { resolveCoreModelRuntime, unassignedModelDataRegion } from '../llm/core-model-runtime.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../llm/messages-adapter.js';
import type {
  NeutralResponsesRequest,
  NeutralResponsesResult,
  ResponsesAdapter,
} from '../llm/responses-adapter.js';
import type { AkshareClient } from './a-share/akshare-client.js';
import { buildIndexAnswer } from './a-share/ashare-fact-card.js';
import { isIndexQuery } from './a-share/ashare-qa-matcher.js';
import type { AkEnvelope, IndexRow } from './a-share/briefing-types.js';
import { assessCompletionFacts, missingAskedFields } from './browser-tools/completion-fields.js';
import { effectPauseQuestion } from './browser-tools/effect-pause-copy.js';
import { isEnglishIntent } from './browser-tools/unified-browser-loop.js';
import {
  searchCardPriceMismatches,
  unmatchedVariantPrices,
} from './browser-tools/variant-price.js';
import { runGenerateTask } from './generate-runner.js';
import { isEnglishRequest } from './next-steps-generator.js';
import { answerNotObtained } from './scrape-answer-check.js';
import {
  type AskedFieldJudge,
  createAskedFieldJudge,
  mostFieldsWithoutValue,
  scrapeAnswerDoubt,
} from './scrape-field-judge.js';
import { runScrapeTask } from './scrape-runner.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/fix60/${name}`, import.meta.url), 'utf8');

const DOUYIN_INTENT =
  '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
/** DEPLOY-59 第 1 步 B dy-1 (tsk_V9EpHRgDrMbkQ3WWu4Eh6), verbatim. */
const D59_DY1 = `目标视频页面返回"服务器出现问题 请稍后重试"，未能加载出标题、作者和互动数据。

推荐列表里出现一条标题相近的视频"赌上 1500 公里路程｜世界最窄酒店，真的能住人吗？"，但那是另一个视频（ID 7694188040943570219，作者 @记录生活的蛋黄派，点赞 439.5K，评论 3），不是你要查的 7507106798919601427。

缺：目标视频 7507106798919601427 的标题、作者、点赞/评论/收藏/分享数（页面未返回）。

来源：https://www.douyin.com/video/7507106798919601427`;
/** DEPLOY-59 第 1 步 B reg-dy-2 (tsk_ktSXPPe4YRyLut8rz3CZU), verbatim. */
const D59_REG_DY2 = `这个视频页面打不开——抖音返回了"服务器出现问题，请稍后重试"，同时弹出了登录框。

目标视频（ID 7377304298310389027）的标题、作者、点赞/评论/收藏/分享数都没加载出来，页面只有错误提示和登录弹窗。侧边栏"接下来播放"里能看到的是另一条推荐视频（@记录生活的蛋黄派 的"世界最窄酒店"），不是你要查的那条。

缺的就是目标视频本身的页面数据，服务器没给。你可以：
- 稍后让我再试一次
- 或者你自己登录后告诉我继续（我不会代填账号密码）

来源：https://www.douyin.com/video/7377304298310389027`;
/** DEPLOY-59 线上 dy-1, verbatim — every field given. */
const ONLINE_DY1 =
  '已读取抖音视频页面信息：标题为「仙桥洞 真的好美，喜欢的小伙伴，冲冲冲，#瀑布之美#绿野仙踪#杭州美景#抖音推荐官#杭州游攻略」，作者为「利利的旅行盲盒」；互动数据分别为点赞 20、评论 2、收藏 10、分享 97。';

describe('FIX-60 P0-1: a scraped error page', () => {
  it('Douyin 「服务器出现问题 请稍后重试」 beside a recommended-video list is an error page', () => {
    expect(scrapedErrorPage(fixture('douyin-error.md'), '抖音')).toMatch(/服务器出现问题/);
    // Not a wall: the wall check let it through before.
    expect(scrapedWall(fixture('douyin-error.md'), '抖音')).toBeNull();
  });

  it('a web server 503 page, a Cloudflare 522 page and an error status are error pages', () => {
    expect(
      scrapedErrorPage(fixture('nginx-503.md'), '503 Service Temporarily Unavailable'),
    ).not.toBeNull();
    expect(
      scrapedErrorPage(
        fixture('cloudflare-522.md'),
        'shop.example.com | 522: Connection timed out',
      ),
    ).not.toBeNull();
    expect(scrapedErrorPage('# Gone', 'Gone', 410)).toBe('HTTP 410');
    expect(scrapedErrorPage('# Not here', 'Not here', 404)).toBe('HTTP 404');
  });

  it('a long article about errors and a short page with its fields are pages', () => {
    expect(scrapedErrorPage(fixture('long-404-article.md'), '404 Not Found - HTTP')).toBeNull();
    expect(scrapedErrorPage(fixture('short-product.md'), 'Belkin Eco USB-C Cable')).toBeNull();
    // A wall status stays the wall check's (handed over, not retried as an error page).
    expect(scrapedErrorPage('# Blocked', 'Blocked', 403)).toBeNull();
  });
});

describe('FIX-60 复审 #1 #1: the asked fields are read for their values, not their names', () => {
  /** 复审 #1 的两句：值都给了，只是没写「标题」二字。 */
  const CAT_BOLD = '**猫咪跳舞**，作者小王，12.3万赞';
  const CAT_SENTENCE = '视频《猫咪跳舞》由 @小王 发布，获赞 12.3 万';
  const CAT_INTENT = '打开 https://www.douyin.com/video/123 读视频标题、作者和点赞数';
  const EN_INTENT =
    'Get the title, author and like count of this video https://www.douyin.com/video/123';
  const EN_FAILED = 'The page failed to load; I could not read the title, author or likes.';

  const toolAnswer = (fields: Array<[string, boolean]>) => ({
    id: 'msg_judge',
    metadata: { provider: 'alibaba-model-studio', model: 'qwen3.8-flash' },
    content: [
      {
        type: 'tool_use' as const,
        id: 'tu_1',
        name: 'report_asked_fields',
        input: { fields: fields.map(([field, has_value]) => ({ field, has_value })) },
      },
    ],
    stopReason: 'tool_use' as const,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
      complete: true,
    },
  });
  const judgeAdapter = (create: MessagesAdapter['create']): MessagesAdapter =>
    ({ metadata: { provider: 'alibaba-model-studio' }, create }) as unknown as MessagesAdapter;

  it('the two natural answers of the review give every value: no doubt, no call, completed', () => {
    for (const answer of [CAT_BOLD, CAT_SENTENCE]) {
      expect(scrapeAnswerDoubt(answer, [`${'页面正文。'.repeat(400)}`])).toBeNull();
      expect(answerNotObtained(answer, CAT_INTENT)).toBe(false);
    }
  });

  it('the judge is asked with structured output and its verdict decides', async () => {
    const create = vi.fn(async () =>
      toolAnswer([
        ['标题', true],
        ['作者', true],
        ['点赞数', true],
      ]),
    );
    const judge = createAskedFieldJudge(judgeAdapter(create as never));
    const verdicts = await judge({ request: CAT_INTENT, answer: CAT_SENTENCE });
    expect(verdicts).toEqual([
      { field: '标题', hasValue: true },
      { field: '作者', hasValue: true },
      { field: '点赞数', hasValue: true },
    ]);
    expect(mostFieldsWithoutValue(verdicts!)).toBe(false);
    const request = (create.mock.calls[0] as unknown as [NeutralMessagesRequest])[0];
    expect(request.toolChoice).toEqual({ type: 'tool', name: 'report_asked_fields' });
    expect(request.temperature).toBe(0);
    expect(JSON.stringify(request.messages)).toContain('猫咪跳舞');
  });

  it('English: 「The page failed to load…」 has none of title, author, likes', async () => {
    expect(scrapeAnswerDoubt(EN_FAILED, ['# Douyin'])).toBe('missing_wording');
    const judge = createAskedFieldJudge(
      judgeAdapter(
        vi.fn(async () =>
          toolAnswer([
            ['title', false],
            ['author', false],
            ['like count', false],
          ]),
        ) as never,
      ),
    );
    const verdicts = await judge({ request: EN_INTENT, answer: EN_FAILED });
    expect(mostFieldsWithoutValue(verdicts!)).toBe(true);
  });

  it('a failed, timed-out or malformed call returns null (the previous verdict stands)', async () => {
    const failing = createAskedFieldJudge(
      judgeAdapter(
        vi.fn(async () => {
          throw new Error('timeout');
        }) as never,
      ),
    );
    expect(await failing({ request: CAT_INTENT, answer: CAT_BOLD })).toBeNull();
    const malformed = createAskedFieldJudge(
      judgeAdapter(
        vi.fn(async () => ({
          ...toolAnswer([]),
          content: [{ type: 'text', text: '{}' }],
        })) as never,
      ),
    );
    expect(await malformed({ request: CAT_INTENT, answer: CAT_BOLD })).toBeNull();
  });

  it('doubt: short pages, missing wording, an error message on a page; none for a full page', () => {
    expect(scrapeAnswerDoubt(D59_DY1, [fixture('douyin-error.md')])).toBe('missing_wording');
    expect(scrapeAnswerDoubt(D59_REG_DY2, [fixture('douyin-error.md')])).toBe('missing_wording');
    expect(scrapeAnswerDoubt(ONLINE_DY1, ['服务器出现问题 请稍后重试'])).toBe('page_error_signal');
    expect(scrapeAnswerDoubt(ONLINE_DY1, ['# 仙桥洞\n\n点赞 20'])).toBe('short_pages');
    expect(scrapeAnswerDoubt(ONLINE_DY1, [`# 仙桥洞\n\n${'页面正文。'.repeat(400)}`])).toBeNull();
    // A request naming no field: the judge returns no fields, nothing is missing.
    expect(mostFieldsWithoutValue([])).toBe(false);
  });

  it('the wording check alone still misses DEPLOY-59 dy-1 (the judge is what catches it)', () => {
    expect(answerNotObtained(D59_DY1, DOUYIN_INTENT)).toBe(false);
    expect(missingAskedFields(DOUYIN_INTENT, ONLINE_DY1)).toEqual([]);
  });
});

const METADATA = {
  provider: 'alibaba-model-studio' as const,
  region: 'cn' as const,
  deploymentScope: 'china_mainland' as const,
  model: 'qwen3.8-plus',
  endpointKind: 'public' as const,
  protocol: 'responses' as const,
};

function adapterSaying(text: string): ResponsesAdapter {
  const stream = vi.fn(
    async (_request: NeutralResponsesRequest): Promise<NeutralResponsesResult> => ({
      id: 'resp_fix60',
      metadata: METADATA,
      text,
      sources: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      status: 'completed',
    }),
  );
  return { metadata: METADATA, stream };
}

function laneServing(markdown: string, title: string, statusCode?: number): FirecrawlLane {
  return {
    scrape: vi.fn(async (url: string) => ({
      ok: true as const,
      markdown,
      url,
      title,
      ...(statusCode ? { statusCode } : {}),
    })),
    search: vi.fn(async () => ({ ok: true as const, results: [] })),
  } as unknown as FirecrawlLane;
}

/** The instructions of the adapter's first request. */
const firstInstructions = (adapter: ResponsesAdapter): string =>
  (vi.mocked(adapter.stream).mock.calls[0]?.[0].instructions ?? '').trimEnd();

const scrape = (
  intent: string,
  adapter: ResponsesAdapter,
  firecrawl: FirecrawlLane,
  fieldJudge?: AskedFieldJudge,
) =>
  runScrapeTask({
    taskId: 'tsk_fix60',
    userId: 'usr_fix60',
    intent,
    responsesAdapter: adapter,
    firecrawl,
    logger: pino({ level: 'silent' }),
    ...(fieldJudge ? { fieldJudge } : {}),
  });

describe('FIX-60 P0-1: the scrape lane', () => {
  it('hands an error page to the browser before asking the model anything', async () => {
    const adapter = adapterSaying(D59_DY1);
    const outcome = await scrape(
      DOUYIN_INTENT,
      adapter,
      laneServing(fixture('douyin-error.md'), '抖音'),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failureKind).toBe('empty');
    expect(outcome.reason).toMatch(/报错页.*服务器出现问题/);
    expect(vi.mocked(adapter.stream)).not.toHaveBeenCalled();
  });

  // A page that is not an error page, and an answer that says it got none of the asked fields.
  // Every quote of the answer is on the page, so only the asked fields decide.
  const D59_PAGE = `服务器出现问题 请稍后重试\n\n接下来播放：赌上 1500 公里路程｜世界最窄酒店，真的能住人吗？ @记录生活的蛋黄派 点赞 439.5K 评论 3\n\n${'抖音页面的其他正文。'.repeat(60)}`;
  const judging = (verdicts: Array<[string, boolean]> | null) =>
    vi.fn<AskedFieldJudge>(async () =>
      verdicts ? verdicts.map(([field, hasValue]) => ({ field, hasValue })) : null,
    );

  it('does not complete an answer the judge reads as missing most asked fields', async () => {
    const judge = judging([
      ['标题', false],
      ['作者', false],
      ['点赞数', false],
      ['评论数', false],
      ['收藏数', false],
      ['分享数', false],
    ]);
    const outcome = await scrape(
      DOUYIN_INTENT,
      adapterSaying(D59_DY1),
      laneServing(D59_PAGE, '抖音'),
      judge,
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failureKind).toBe('empty');
    expect(judge).toHaveBeenCalledWith({ request: DOUYIN_INTENT, answer: expect.any(String) });
  });

  it('the judge failing leaves the previous verdict: no new failure', async () => {
    const outcome = await scrape(
      DOUYIN_INTENT,
      adapterSaying(D59_DY1),
      laneServing(D59_PAGE, '抖音'),
      judging(null),
    );
    expect(outcome.status).toBe('completed');
  });

  it('the review’s natural answers complete with the judge reading every value', async () => {
    const page = `# 猫咪跳舞\n\n小王\n\n12.3万赞\n\n${'页面正文。'.repeat(40)}`;
    for (const answer of [
      '**猫咪跳舞**，作者小王，12.3万赞',
      '视频《猫咪跳舞》由 @小王 发布，获赞 12.3 万',
    ]) {
      const judge = judging([
        ['标题', true],
        ['作者', true],
        ['点赞数', true],
      ]);
      const outcome = await scrape(
        '打开 https://www.douyin.com/video/123 读视频标题、作者和点赞数',
        adapterSaying(answer),
        laneServing(page, '抖音'),
        judge,
      );
      expect(outcome.status).toBe('completed');
    }
  });

  it('an English request: the judge reads the English answer the same way', async () => {
    const outcome = await scrape(
      'Get the title, author and like count of this video https://www.douyin.com/video/123',
      adapterSaying('The page failed to load; I could not read the title, author or likes.'),
      laneServing(D59_PAGE, 'Douyin'),
      judging([
        ['title', false],
        ['author', false],
        ['like count', false],
      ]),
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.failureKind).toBe('empty');
  });

  it('completes an ordinary page and an answer with every field', async () => {
    const page = `# 仙桥洞 真的好美，喜欢的小伙伴，冲冲冲，#瀑布之美#绿野仙踪#杭州美景#抖音推荐官#杭州游攻略\n\n利利的旅行盲盒\n\n点赞 20\n评论 2\n收藏 10\n分享 97\n\n${'页面正文。'.repeat(40)}`;
    const outcome = await scrape(
      DOUYIN_INTENT,
      adapterSaying(ONLINE_DY1),
      laneServing(page, '抖音'),
    );
    expect(outcome.status).toBe('completed');
  });
});

describe('FIX-60 P0-2: the answer follows the language of the request', () => {
  it('reads Chinese, English and the main language of a mixed request', () => {
    expect(requestLanguage('写一个程序员深夜加班的小说片段')).toBe('zh');
    expect(requestLanguage('Write a short story about a programmer')).toBe('en');
    // Mixed: the main language decides.
    expect(requestLanguage('Write a short story about a 程序员')).toBe('en');
    expect(
      requestLanguage('Write a short product description for our new 蓝牙耳机, about 80 words'),
    ).toBe('en');
    expect(requestLanguage('在 BestBuy 搜 usb c cable 告诉我第一个结果')).toBe('zh');
    expect(requestLanguage('帮我写一段 300 字左右的 Chrome 浏览器使用小技巧介绍')).toBe('zh');
    expect(requestLanguage('打开 google.com 搜索 Claude 并总结第一条')).toBe('zh');
    // Quoted search terms and links are content, not the request's language.
    expect(
      requestLanguage('请使用云端浏览器，YouTube 搜索「Playwright tutorial」返回前5个视频标题'),
    ).toBe('zh');
    expect(
      requestLanguage(
        'Open https://gs.ctrip.com/html5/you/sight/hangzhou14/49894.html and tell me the attraction name',
      ),
    ).toBe('en');
    expect(requestLanguage('Search “故宫门票” on Baidu and tell me the price')).toBe('en');
  });

  it('falls back to the account region only when the words do not tell', () => {
    expect(requestLanguage('https://example.com/a 123')).toBeNull();
    expect(replyLanguage('https://example.com/a 123', 'cn')).toBe('zh');
    expect(replyLanguage('https://example.com/a 123', 'intl')).toBe('en');
    // The region never overrides the request's own language.
    expect(replyLanguage('Write a short story about a programmer', 'cn')).toBe('en');
    expect(replyLanguage('写一首诗', 'intl')).toBe('zh');
  });

  it('every English check reads the same main language (copy, next steps, browser)', () => {
    for (const text of [
      'Write a short story about a 程序员',
      '写一首关于代码的诗',
      'USB C cable price on Amazon Singapore',
    ]) {
      expect(isEnglishIntent(text)).toBe(isEnglishRequestText(text));
      expect(isEnglishRequest(text)).toBe(isEnglishRequestText(text));
    }
  });

  it('the generate lane ends its instructions with the request language', async () => {
    const adapter = adapterSaying('A story.');
    await runGenerateTask({
      taskId: 'tsk_fix60',
      userId: 'usr_fix60',
      intent: 'Write a short story about a programmer',
      responsesAdapter: adapter,
      logger: pino({ level: 'silent' }),
    });
    expect(firstInstructions(adapter).endsWith(replyLanguageRule('en'))).toBe(true);
    const zh = adapterSaying('一个故事。');
    await runGenerateTask({
      taskId: 'tsk_fix60',
      userId: 'usr_fix60',
      intent: '写一个程序员深夜加班的小说片段',
      responsesAdapter: zh,
      logger: pino({ level: 'silent' }),
    });
    expect(firstInstructions(zh).endsWith(replyLanguageRule('zh'))).toBe(true);
  });

  it('the scrape lane ends its instructions with the request language', async () => {
    const adapter = adapterSaying(
      'The page says the status code means the resource was not found.',
    );
    await scrape(
      'Summarize https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 in three sentences',
      adapter,
      laneServing(fixture('long-404-article.md'), '404 Not Found - HTTP'),
    );
    expect(firstInstructions(adapter).endsWith(replyLanguageRule('en'))).toBe(true);
  });
});

const ANSWER_VARIANT_WRONG = `在亚马逊新加坡站搜索 "usb c cable" 后，前三个商品的名称和价格如下：

1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…1M — S$10.92
2. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…2M — S$12.45
3. Belkin Eco-Friendly Braided USB-A to USB-C Cable… — S$6.86`;

describe('FIX-60 P1: a product page price is the searched variant’s', () => {
  const pages = [fixture('amazon-search-truncated.txt'), fixture('amazon-variant-detail.txt')];

  it('DEPLOY-59 reg-new-amazon-sg: another variant’s S$6.86 for the searched one is sent back', () => {
    const out = unmatchedVariantPrices(ANSWER_VARIANT_WRONG, pages);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/S\$6\.86.*规格选择区.*Colour Name: White/);
  });

  it('…through the completion-facts check, as a contradiction', () => {
    const facts = assessCompletionFacts({
      summary: ANSWER_VARIANT_WRONG,
      intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
      pages: pages.map((text, i) => ({ text, sourceURL: `https://www.amazon.sg/p${i}` })),
    });
    expect(facts.contradictions.some((c) => c.includes('S$6.86') && c.includes('规格'))).toBe(true);
  });

  it('the card’s 「options from」 price, a named variant, or a price shown elsewhere is the answer’s', () => {
    const from = ANSWER_VARIANT_WRONG.replace('S$6.86', 'S$8.21 起（2 个卖家报价）');
    expect(unmatchedVariantPrices(from, pages)).toEqual([]);
    const named = ANSWER_VARIANT_WRONG.replace('S$6.86', '黑色款 S$6.86');
    expect(unmatchedVariantPrices(named, pages)).toEqual([]);
    const plain8 = ANSWER_VARIANT_WRONG.replace('S$6.86', 'S$8.21');
    expect(
      unmatchedVariantPrices(plain8, [
        fixture('amazon-search-full.txt'),
        fixture('amazon-variant-detail.txt'),
      ]),
    ).toEqual([]);
  });

  it('a page without a variant selector, or with one price per selector, checks nothing', () => {
    expect(
      unmatchedVariantPrices(ANSWER_VARIANT_WRONG, [fixture('amazon-search-truncated.txt')]),
    ).toEqual([]);
    expect(
      unmatchedVariantPrices('Belkin cable — S$9.43', [
        'Belkin cable\nColour Name: White\nS$9.43\nAbout this item',
      ]),
    ).toEqual([]);
  });
});

describe('FIX-60 P2: a guide is not the booking', () => {
  const ask = (label: string) =>
    effectPauseQuestion({
      english: true,
      site: 'OpenTable',
      action: { tool: 'click', label, value: null } as never,
      readOnly: true,
      background: false,
    });

  it('「Reserve a table guide」 (21 characters, cut at 20 for display) gets the light copy', () => {
    expect(ask('Reserve a table guide')).not.toMatch(/may already have gone through/);
  });

  it('「Reserve a table」 itself still reads as the booking', () => {
    expect(ask('Reserve a table')).toMatch(/may already have gone through/);
  });
});

describe('FIX-60 复审 #1 #2: an asked-for language first, then the main language', () => {
  it('a language the user asks for in so many words wins', () => {
    expect(requestLanguage('请用英语回答：故宫门票多少钱')).toBe('en');
    expect(requestLanguage('介绍一下杭州，answer in English')).toBe('en');
    expect(requestLanguage('Answer in Chinese: what is the capital of France')).toBe('zh');
    expect(requestLanguage('Write a haiku about the sea, reply in Chinese please')).toBe('zh');
    expect(replyPlan('请用英语回答：故宫门票多少钱', 'cn')).toMatchObject({
      language: 'en',
      source: 'explicit',
    });
    // DEPLOY-60 第 0 步 #1: 「用英文写一封感谢信」 names the letter's language, not the whole
    // answer's: the letter in English, a note around it in Chinese.
    expect(replyPlan('用英文写一封感谢信', 'cn')).toMatchObject({
      language: 'zh',
      writing: { target: '英文', piece: '感谢信' },
    });
  });

  it('a translation: the translation in the target, anything around it in the instruction’s language', () => {
    const zh = replyPlan('翻译成英文：今天天气很好', 'cn');
    expect(zh).toMatchObject({ language: 'zh', translation: { target: '英文' } });
    expect(replyLanguageRule(zh)).toContain('本次是翻译：译文用英文。');
    expect(replyLanguageRule(zh)).not.toContain('整段回答');
    const en = replyPlan('translate to Chinese: hello world', 'cn');
    expect(en).toMatchObject({ language: 'en', translation: { target: 'Chinese' } });
    expect(replyLanguageRule('translate to Chinese: hello world')).toContain(
      'This time it is a translation: the translation is in Chinese.',
    );
    expect(requestLanguage('Please translate this into English: 你好世界')).toBe('en');
  });

  describe('DEPLOY-60 第 0 步 #1: a piece of writing asked for in a named language', () => {
    it('the piece in the named language, everything around it in the request’s main language', () => {
      for (const [text, target, piece] of [
        ['写一封英文邮件给客户，说明发货延迟两天', '英文', '邮件'],
        ['帮我写一段英文自我介绍', '英文', '自我介绍'],
        ['写一份英文简历', '英文', '简历'],
        ['写一份英文版的简历', '英文', '简历'],
        ['用英文写一封邮件给客户', '英文', '邮件'],
      ] as const) {
        const plan = replyPlan(text, 'cn');
        expect(plan, text).toMatchObject({ language: 'zh', writing: { target, piece } });
        const rule = replyLanguageRule(text, 'cn');
        expect(rule).toContain(`本次要写的${piece}用${target}。`);
        expect(rule).toContain('1. 你对用户说的话');
        // Not 「整段回答都用中文」.
        expect(rule).not.toContain('整段回答');
        expect(requestLanguage(text)).toBe('zh');
      }
      const en = replyPlan('write a cover letter in Chinese', 'intl');
      expect(en).toMatchObject({
        language: 'en',
        writing: { target: 'Chinese', piece: 'cover letter' },
      });
      expect(replyLanguageRule(en)).toContain('This time the cover letter is written in Chinese.');
      expect(isEnglishRequestText('write a cover letter in Chinese')).toBe(true);
      expect(writingRequest('Draft an English email to my landlord')).toEqual({
        target: 'English',
        piece: 'email',
      });
    });

    it('no named language, an answer language, or a translation is not a writing request', () => {
      expect(
        writingRequest('Write a short story about a programmer working late at night'),
      ).toBeNull();
      expect(writingRequest('帮我写一封邮件给客户')).toBeNull();
      expect(writingRequest('用英文回答：故宫门票多少钱')).toBeNull();
      expect(writingRequest('翻译成英文：今天天气很好')).toBeNull();
      expect(writingRequest('帮我查英文介绍')).toBeNull();
      expect(replyPlan('用英文回答：故宫门票多少钱', 'cn')).toMatchObject({
        language: 'en',
        source: 'explicit',
      });
      expect(replyPlan('写一封英文邮件给客户', 'cn').translation).toBeUndefined();
    });

    it('the generate lane ends its instructions with the writing rule', async () => {
      const adapter = adapterSaying('Dear customer, ...');
      const intent = '写一封英文邮件给客户，说明发货延迟两天';
      await runGenerateTask({
        taskId: 'tsk_fix60',
        userId: 'usr_fix60',
        intent,
        responsesAdapter: adapter,
        logger: pino({ level: 'silent' }),
      });
      expect(firstInstructions(adapter).endsWith(replyLanguageRule(intent))).toBe(true);
      expect(firstInstructions(adapter)).toContain('本次要写的邮件用英文。');
    });
  });

  describe('DEPLOY-60 协调方核对 必须修 1: one two-part rule for every request', () => {
    const ZH_TALK = '1. 你对用户说的话（说明、提问、总结、标题、列表、追问建议、失败说明）用中文。';
    const ZH_PRODUCE =
      '2. 用户要你产出的文本（译文、改写或润色后的原文、指定了语言的邮件或文章），用用户指定的语言；没指定时，用原文的语言；没有原文时用中文。';
    const EN_TALK =
      '1. What you say to the user (explanations, questions, summaries, headings, lists, follow-up suggestions, failure explanations) is in English';
    const EN_PRODUCE =
      '2. Text the user asks you to produce (a translation, a rewritten or polished version of their text, an email or article in a language they name) is in the language the user names; if they name none, in the language of the original text; if there is no original text, in English.';

    it('rewriting or polishing an original: what is said to the user in its language, the text in the original’s', () => {
      for (const text of [
        '帮我把这封英文邮件改得更礼貌：Dear John, send me the file now.',
        '把这段英文改得更地道：I very like it.',
        '帮我写个英文版的周报',
      ]) {
        const rule = replyLanguageRule(text, 'cn');
        expect(rule, text).toContain(ZH_TALK);
        expect(rule, text).toContain(ZH_PRODUCE);
        expect(rule, text).not.toContain('整段');
        expect(rule, text).not.toContain('Answer language: English');
      }
      expect(replyPlan('帮我写个英文版的周报', 'cn').writing).toEqual({
        target: '英文',
        piece: '周报',
      });
      const polish = replyLanguageRule(
        'Polish this Chinese paragraph: 我们的产品很好用，大家都喜欢。',
        'cn',
      );
      // FIX-61 P1-1: only the instruction (before the colon) decides the talk language, so the
      // explanation is English; the paragraph itself stays Chinese by part 2.
      expect(polish).toContain(EN_TALK);
      expect(polish).toContain(EN_PRODUCE);
      expect(polish).not.toMatch(/whole answer|entirely in/);
      const polishEn = replyLanguageRule(
        'Polish this Chinese paragraph for me, please, and tell me what you changed: 我们的产品很好用。',
        'cn',
      );
      expect(polishEn).toContain(EN_TALK);
      expect(polishEn).toContain(EN_PRODUCE);
      expect(polishEn).not.toMatch(/whole answer|entirely in/);
    });

    it('every request gets the same two parts: plain questions, asked-for languages, translations, writing', () => {
      for (const [text, talk, produce] of [
        ['iPhone 16 Pro Max 256GB 多少钱', ZH_TALK, ZH_PRODUCE],
        ['用英文回答：故宫门票多少钱', EN_TALK, EN_PRODUCE],
        ['Write a short story about a programmer working late at night', EN_TALK, EN_PRODUCE],
        ['翻译成英文：今天天气很好', ZH_TALK, ZH_PRODUCE],
        ['写一封英文邮件给客户，说明发货延迟两天', ZH_TALK, ZH_PRODUCE],
        ['write a cover letter in Chinese', EN_TALK, EN_PRODUCE],
      ] as const) {
        const rule = replyLanguageRule(text, 'cn');
        expect(rule, text).toContain(talk);
        expect(rule, text).toContain(produce);
        expect(rule, text).not.toMatch(/整段|whole answer|entirely in/);
      }
      expect(replyLanguageRule('zh')).toContain(ZH_TALK);
      expect(replyLanguageRule('en')).toContain(EN_TALK);
    });
  });

  it('mixed: product, brand, model and site names do not count; a Chinese verb or particle makes it Chinese', () => {
    expect(requestLanguage('帮我查 iPhone 16 Pro price')).toBe('zh');
    expect(requestLanguage('iPhone 16 Pro Max 256GB 多少钱')).toBe('zh');
    expect(requestLanguage('USB C cable 价格')).toBe('zh');
    expect(requestLanguage('在 BestBuy 搜 usb c cable')).toBe('zh');
    expect(requestLanguage('Summarize 这篇文章')).toBe('zh');
    expect(requestLanguage("What is 故宫's ticket price")).toBe('en');
    // English grammar plainly carrying the sentence keeps it English.
    expect(requestLanguage('Write a story about a cat who asks 为什么')).toBe('en');
    expect(requestLanguage('Show me the price of 华为 Mate 60')).toBe('en');
    expect(requestLanguage('这个有货吗')).toBe('zh');
  });

  it('the front end, the next-step suggestions and the browser read it with the same function', () => {
    for (const text of [
      '帮我查 iPhone 16 Pro price',
      "What is 故宫's ticket price",
      '请用英语回答：故宫门票多少钱',
      '翻译成英文：今天天气很好',
    ]) {
      expect(isEnglishIntent(text)).toBe(isEnglishRequestText(text));
      expect(isEnglishRequest(text)).toBe(isEnglishRequestText(text));
    }
  });

  it('the scrape lane reads the language from the user’s own words, not a follow-up’s context', async () => {
    const adapter = adapterSaying(
      'The page says the status code means the resource was not found.',
    );
    await runScrapeTask({
      taskId: 'tsk_fix60',
      userId: 'usr_fix60',
      intent: `【上一轮任务】用户问了一个中文问题，回答是中文的长篇内容。\n\n${'上一轮的中文上下文。'.repeat(20)}\n\nSummarize https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404`,
      userIntent:
        'Summarize https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404 in English',
      responsesAdapter: adapter,
      firecrawl: laneServing(fixture('long-404-article.md'), '404 Not Found - HTTP'),
      logger: pino({ level: 'silent' }),
    });
    expect(firstInstructions(adapter).endsWith(replyLanguageRule('en'))).toBe(true);
  });
});

describe('FIX-60 复审 #1 #3: the search card comes along to the detail page', () => {
  // The detail page's main price is its default (black) variant's and sits outside every
  // selector; the searched card is the white 200 cm one, 「2 options from S$8.21」.
  const SEARCH = [
    '1-48 of 303 results for "usb c cable"',
    'Belkin Braided USB-A to USB-C Cable, White, 200cm',
    '4.4 out of 5 stars',
    '2 options from S$8.21',
    'Anker USB-C to USB-C Cable 240W, Black, 1.8m',
    'S$12.99',
  ].join('\n');
  const DETAIL = [
    'Belkin Braided USB-A to USB-C Cable, White, 200cm',
    'Brand: Belkin',
    'S$6.86',
    'Colour Name: Black',
    'Black',
    'White',
    'Size Name: 200 centimeters',
    '100 centimeters',
    '200 centimeters',
    'About this item',
    'Made with recycled materials and plastic-free packaging, this cable charges and syncs your phone.',
  ].join('\n');
  const pages = [SEARCH, DETAIL];
  const line = (price: string) => `3. Belkin Braided USB-A to USB-C Cable — ${price}`;

  it('the default variant’s S$6.86 outside the selector, below the card’s from price: sent back', () => {
    // The selector check alone lets it through: the price is shown outside every selector.
    expect(unmatchedVariantPrices(line('S$6.86'), pages)).toEqual([]);
    const out = searchCardPriceMismatches(line('S$6.86'), pages);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/S\$6\.86.*起价「S\$8\.21」.*没写是哪个规格/);
    const facts = assessCompletionFacts({
      summary: line('S$6.86'),
      intent: '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
      pages: pages.map((text, i) => ({ text, sourceURL: `https://www.amazon.sg/p${i}` })),
    });
    expect(facts.contradictions.some((c) => c.includes('起价「S$8.21」'))).toBe(true);
  });

  it('a variant other than the card’s is sent back (黑色 for the white card, 1 m for 2 m)', () => {
    expect(
      searchCardPriceMismatches('3. Belkin Braided USB-A to USB-C Cable — 黑色款 S$6.86', pages),
    ).toHaveLength(1);
    expect(
      searchCardPriceMismatches('3. Belkin Braided USB-A to USB-C Cable — 100cm S$9.10', pages)[0],
    ).toMatch(/不是同一款/);
  });

  it('the card’s price, the card’s variant, or a price above its from price is the answer’s', () => {
    expect(searchCardPriceMismatches(line('2 options from S$8.21'), pages)).toEqual([]);
    expect(searchCardPriceMismatches(line('S$8.21'), pages)).toEqual([]);
    expect(
      searchCardPriceMismatches(
        '3. Belkin Braided USB-A to USB-C Cable — 白色 200cm S$8.21',
        pages,
      ),
    ).toEqual([]);
    expect(searchCardPriceMismatches(line('S$9.50'), pages)).toEqual([]);
    // Another product's line, and a line no card matches, check nothing.
    expect(
      searchCardPriceMismatches('4. Anker USB-C to USB-C Cable 240W — S$12.99', pages),
    ).toEqual([]);
    expect(searchCardPriceMismatches('5. 某品牌数据线 — S$3.00', pages)).toEqual([]);
  });

  describe('DEPLOY-60 第 0 步 #2: tied titles are checked, not skipped', () => {
    // Two cards whose titles the answer's name matches equally well.
    const TIED = [
      '1-48 of 303 results for "usb c cable"',
      'Belkin Braided USB-A to USB-C Cable, White, 200cm',
      '2 options from S$8.21',
      'Belkin Braided USB-A to USB-C Cable, Blue, 100cm',
      '3 options from S$7.50',
    ].join('\n');
    const tied = (price: string) => `3. Belkin Braided USB-A to USB-C Cable — ${price}`;

    it('below the lowest from price of the tied cards, no variant named: sent back', () => {
      const out = searchCardPriceMismatches(tied('S$6.86'), [TIED, DETAIL]);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatch(/S\$6\.86.*起价「S\$7\.50」/);
    });

    it('a variant none of the tied cards is: sent back; one of them is: kept', () => {
      expect(searchCardPriceMismatches(tied('黑色款 S$6.86'), [TIED])[0]).toMatch(/不是同一款/);
      expect(searchCardPriceMismatches(tied('蓝色 100cm S$7.50'), [TIED])).toEqual([]);
      expect(searchCardPriceMismatches(tied('白色 200cm S$8.21'), [TIED])).toEqual([]);
    });

    it('at or above the lowest from price is kept; one tied card with a from price is enough to check', () => {
      expect(searchCardPriceMismatches(tied('S$7.80'), [TIED])).toEqual([]);
      // 协调方核对 必须修 2: the other tied card shows a plain price, not a from price — the from
      // price is still checked, and the plain card's own price is still that card's.
      const plain = TIED.replace('3 options from S$7.50', 'S$5.00');
      expect(searchCardPriceMismatches(tied('S$6.86'), [plain])[0]).toMatch(
        /S\$6\.86.*起价「S\$8\.21」/,
      );
      expect(searchCardPriceMismatches(tied('S$5.00'), [plain])).toEqual([]);
    });

    it('协调方核对 必须修 2: a detail page’s heading is not a search card (the Belkin case)', () => {
      const search = [
        '1-48 of 303 results for "usb c cable"',
        'Belkin Braided USB-A to USB-C Cable, White 200cm',
        '2 options from S$8.21',
      ].join('\n');
      const detail = [
        'Belkin Braided USB-A to USB-C Cable',
        'Brand: Belkin',
        'S$6.86',
        'Colour Name: Black',
        'Black',
        'White',
        'About this item',
      ].join('\n');
      const answer = '3. Belkin Braided USB-A to USB-C Cable — S$6.86';
      const out = searchCardPriceMismatches(answer, [search, detail]);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatch(/S\$6\.86.*起价「S\$8\.21」/);
      // The card's own price, or its variant named, is still the answer's.
      expect(
        searchCardPriceMismatches('3. Belkin Braided USB-A to USB-C Cable — S$8.21', [
          search,
          detail,
        ]),
      ).toEqual([]);
      // Only a detail page read: its heading is all there is, and no from price to hold to.
      expect(searchCardPriceMismatches(answer, [detail])).toEqual([]);
    });
  });

  it('DEPLOY-59 page structure: the earlier fixtures still pass and fail as before', () => {
    const old = [fixture('amazon-search-full.txt'), fixture('amazon-variant-detail.txt')];
    expect(
      searchCardPriceMismatches(ANSWER_VARIANT_WRONG.replace('S$6.86', 'S$8.21'), old),
    ).toEqual([]);
    expect(searchCardPriceMismatches(ANSWER_VARIANT_WRONG, old)).toHaveLength(1);
  });
});

describe('FIX-60 复审 #1 建议: an error word as a short page’s topic is not an error page', () => {
  it('a song, an album or a design note named after an error message is a page', () => {
    expect(
      scrapedErrorPage(
        '# Access Denied\n\nAccess Denied 是一首歌，收录于 2019 年的同名专辑。',
        'Access Denied - 百度百科',
      ),
    ).toBeNull();
    expect(
      scrapedErrorPage(
        '# Something Went Wrong\n\nSomething Went Wrong 专辑，共 10 首歌。',
        'Something Went Wrong',
      ),
    ).toBeNull();
    expect(
      scrapedErrorPage(
        '# 404 页面设计\n\n404 页面设计要点：说明原因、给出返回入口。',
        '404 页面设计',
      ),
    ).toBeNull();
  });

  it('a notice on its own line, or an error status, is still an error page', () => {
    expect(scrapedErrorPage('页面不存在\n\n返回首页', '页面不存在 - 某站')).toMatch(/页面不存在/);
    expect(scrapedErrorPage('# Something went wrong\n\nPlease try again later.', 'Oops')).toMatch(
      /something went wrong/i,
    );
    expect(scrapedErrorPage('# Access Denied', 'Access Denied')).toMatch(/access denied/i);
    expect(scrapedErrorPage('# Access Denied 是一首歌', 'Access Denied', 451)).toBe('HTTP 451');
  });
});

describe('FIX-60 复审 #1 建议: the A-share index answer follows an English question', () => {
  const quote = {
    data: [
      { 名称: '上证指数', 最新价: 3689.91, 涨跌幅: 0.1, 时间: '15:00:03' },
      { 名称: '深证成指', 最新价: 11471.09, 涨跌幅: 1.2, 时间: '15:00:03' },
      { 名称: '创业板指', 最新价: 2566.8, 涨跌幅: -0.87, 时间: '15:00:03' },
    ],
    count: 3,
    source: 'akshare:stock_zh_index_spot_sina',
    fetched_at: '2026-11-06T07:05:00Z',
  } as unknown as AkEnvelope<IndexRow>;
  const aks = {
    getTradingDay: () =>
      Promise.resolve({ data: [{ is_trading_day: true }], count: 1, source: 'x', fetched_at: '' }),
  } as unknown as AkshareClient;

  it('「How did the Shanghai Composite close today?」 gets the English template', async () => {
    expect(isIndexQuery('How did the Shanghai Composite close today?')).toBe(true);
    const md = await buildIndexAnswer({
      client: aks,
      now: new Date('2026-11-06T15:30:00+08:00'),
      quote,
      intent: 'How did the Shanghai Composite close today?',
    });
    expect(md.split('\n')[0]).toMatch(
      /^The market has closed: the Shanghai Composite closed today at 3,689\.91, up 0\.10%\.$/,
    );
    expect(md).toContain(
      'Also, the Shenzhen Component 11,471.09 (up 1.20%), the ChiNext Index 2,566.80 (down 0.87%).',
    );
    expect(md).toContain('Data from Sina Finance');
    expect(md).not.toMatch(/\p{Script=Han}/u);
  });

  it('a Chinese question keeps the Chinese answer', async () => {
    const md = await buildIndexAnswer({
      client: aks,
      now: new Date('2026-11-06T15:30:00+08:00'),
      quote,
      intent: '上证指数今天收盘多少',
    });
    expect(md).toMatch(/^已经收盘了，上证指数今天收在 3,689\.91 点/);
  });
});

describe('FIX-60 BOSS 决定: the region selection is off by default', () => {
  const ENV = {
    NODE_ENV: 'test' as const,
    MODEL_RUNTIME_POLICY: 'qwen_only' as const,
    QWEN_CORE_ROLLOUT_MODE: 'synthetic' as const,
    QWEN_CORE_ENABLED_LANES: 'generate',
    QWEN_CORE_ALLOWLIST: 'usr_a',
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    DASHSCOPE_API_KEY: '',
    DASHSCOPE_WORKSPACE_ID: '',
    DASHSCOPE_INTL_API_KEY: 'intl-key',
    DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
    DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    DASHSCOPE_INTL_WORKSPACE_ID: '',
    DASHSCOPE_CN_API_KEY: 'cn-key',
    DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
    DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    DASHSCOPE_CN_WORKSPACE_ID: '',
    QWEN_REASONING_MODEL: 'qwen3.8-max',
    QWEN_STANDARD_MODEL: 'qwen3.7-plus',
    QWEN_FAST_MODEL: 'qwen3.8-flash',
    QWEN_CODING_MODEL: 'qwen3-coder-plus',
    QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
    QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
    QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
    QWEN_VISION_MODEL: 'qwen3.8-max',
  };
  const resolve = (environment: object, userRegion: unknown) =>
    resolveCoreModelRuntime({
      environment: environment as never,
      actorExternalId: 'usr_a',
      lane: 'generate',
      ownership: { scope: 'personal', userRegion },
    });

  it('off: an account that never chose runs in the default region (cn unless configured)', () => {
    expect(resolve(ENV, null)).toMatchObject({ kind: 'ready', region: 'cn' });
    expect(resolve({ ...ENV, MODEL_DATA_REGION_SELECTION_ENABLED: false }, null)).toMatchObject({
      kind: 'ready',
      region: 'cn',
    });
    expect(resolve({ ...ENV, MODEL_DATA_REGION_DEFAULT: 'intl' }, null)).toMatchObject({
      kind: 'ready',
      region: 'intl',
    });
    expect(unassignedModelDataRegion({})).toBe('cn');
  });

  it('off: an account that chose keeps its choice; an invalid stored value is still refused', () => {
    expect(resolve(ENV, 'intl')).toMatchObject({ kind: 'ready', region: 'intl' });
    expect(resolve(ENV, 'cn')).toMatchObject({ kind: 'ready', region: 'cn' });
    expect(resolve(ENV, 'mars')).toEqual({
      kind: 'unavailable',
      reason: 'MODEL_DATA_REGION_UNASSIGNED',
    });
  });

  it('on: as before — an account without a region must choose first', () => {
    const on = { ...ENV, MODEL_DATA_REGION_SELECTION_ENABLED: true };
    expect(resolve(on, null)).toEqual({
      kind: 'unavailable',
      reason: 'MODEL_DATA_REGION_UNASSIGNED',
    });
    expect(resolve(on, 'intl')).toMatchObject({ kind: 'ready', region: 'intl' });
  });
});
