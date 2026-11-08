/**
 * FIX-60: 没拿到就别说完成 + 英文问题用英文答 + 价格对准那一款.
 */
import { readFileSync } from 'node:fs';
import {
  isEnglishRequestText,
  replyLanguage,
  replyLanguageRule,
  requestLanguage,
} from '@holaday/shared-types';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import { scrapedErrorPage, scrapedWall } from '../firecrawl/scraped-page.js';
import type {
  NeutralResponsesRequest,
  NeutralResponsesResult,
  ResponsesAdapter,
} from '../llm/responses-adapter.js';
import { assessCompletionFacts, missingAskedFields } from './browser-tools/completion-fields.js';
import { effectPauseQuestion } from './browser-tools/effect-pause-copy.js';
import { isEnglishIntent } from './browser-tools/unified-browser-loop.js';
import { unmatchedVariantPrices } from './browser-tools/variant-price.js';
import { runGenerateTask } from './generate-runner.js';
import { isEnglishRequest } from './next-steps-generator.js';
import { answerNotObtained, mostAskedFieldsMissing } from './scrape-answer-check.js';
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

describe('FIX-60 P0-1: most asked fields missing', () => {
  it('DEPLOY-59 dy-1 and reg-dy-2 answers have none of the asked fields (the other video is not)', () => {
    expect(missingAskedFields(DOUYIN_INTENT, D59_DY1)).toHaveLength(6);
    expect(mostAskedFieldsMissing(D59_DY1, DOUYIN_INTENT)).toBe(true);
    expect(mostAskedFieldsMissing(D59_REG_DY2, DOUYIN_INTENT)).toBe(true);
    // The wording check missed dy-1 (「未能加载出」) on production and the candidate alike.
    expect(answerNotObtained(D59_DY1, DOUYIN_INTENT)).toBe(false);
  });

  it('a normal short answer with every field is an answer', () => {
    expect(missingAskedFields(DOUYIN_INTENT, ONLINE_DY1)).toEqual([]);
    expect(mostAskedFieldsMissing(ONLINE_DY1, DOUYIN_INTENT)).toBe(false);
    expect(
      mostAskedFieldsMissing(
        '这篇小红书笔记的标题是「📍杭州｜西湖一日游攻略（保姆级不费腿版）」，作者是 Clara。',
        '打开 https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8 读这篇笔记的标题和作者',
      ),
    ).toBe(false);
  });

  it('fields given in a Markdown table, either way round, are given', () => {
    const keyValue =
      '这篇笔记的信息：\n\n| 字段 | 内容 |\n|------|------|\n| 标题 | 📍杭州｜西湖一日游攻略 |\n| 作者 | Clara |\n| 点赞数 | 1,572 |';
    expect(
      mostAskedFieldsMissing(
        keyValue,
        '打开 https://www.xiaohongshu.com/explore/x 读这篇笔记的标题、作者和点赞数',
      ),
    ).toBe(false);
    const headerRow =
      '**标题**：仙桥洞 真的好美\n\n**作者**：利利的旅行盲盒\n\n**互动数据**：\n| 点赞 | 评论 | 收藏 | 分享 |\n|------|------|------|------|\n| 20 | 2 | 10 | 97 |';
    expect(missingAskedFields(DOUYIN_INTENT, headerRow)).toEqual([]);
  });

  it('a request naming one field is left to the other checks (an answer that just gives it)', () => {
    expect(mostAskedFieldsMissing('**全年全天开放**', '携程上 杭州西湖风景名胜区 的开放时间')).toBe(
      false,
    );
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

const scrape = (intent: string, adapter: ResponsesAdapter, firecrawl: FirecrawlLane) =>
  runScrapeTask({
    taskId: 'tsk_fix60',
    userId: 'usr_fix60',
    intent,
    responsesAdapter: adapter,
    firecrawl,
    logger: pino({ level: 'silent' }),
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

  it('does not complete an answer missing most asked fields, whatever its wording', async () => {
    // A page that is not an error page, and an answer that says it got none of the asked fields.
    // Every quote of the answer is on the page, so only the asked fields decide.
    const page = `服务器出现问题 请稍后重试\n\n接下来播放：赌上 1500 公里路程｜世界最窄酒店，真的能住人吗？ @记录生活的蛋黄派 点赞 439.5K 评论 3\n\n${'抖音页面的其他正文。'.repeat(60)}`;
    const outcome = await scrape(DOUYIN_INTENT, adapterSaying(D59_DY1), laneServing(page, '抖音'));
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
