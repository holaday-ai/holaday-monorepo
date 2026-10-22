import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchExpertWorkflow } from '../execution/expert-workflow-registry.js';
import { scrapedWall } from '../firecrawl/scraped-page.js';
import { platformFailureReason } from '../quota/platform-failure-refunds.js';
import { unperformedActions } from './browser-tools/action-claims.js';
import { completionGap } from './browser-tools/browser-completion.js';
import {
  answerDates,
  namedTargets,
  staleForRecentIntent,
  uncoveredTargets,
} from './browser-tools/completion-coverage.js';
import { assessCompletionFacts, observedEvidence } from './browser-tools/completion-fields.js';
import { assessEngagementClaims } from './browser-tools/engagement-counts.js';
import { createPlaywrightUnifiedExecutor } from './browser-tools/playwright-unified-executor.js';
import { readsOnePage } from './browser-tools/unified-supercar-runner.js';
import { CORE_QUALITY_FAILURE_COPY } from './core-task-settlement.js';
import { answerQualityFailure } from './generate-answer-guard.js';
import { explainExecutionMode } from './intent-classifier.js';
import { detectNavFailure } from './nav-failure-detector.js';
import { answerNotObtained, extractTargetUrl } from './scrape-runner.js';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = async (intent: string) => (await explainExecutionMode({ intent, logger })).mode;

describe('1 · questions answered from the web do not go to generate (BENCH-1)', () => {
  it.each([
    ['r01', '帮我看下维基百科上杭洲(Hangzhou)这个词条，人口多少？'],
    ['r03', 'nodejs官网最新的LTS版本是多少'],
    ['r05', 'python 3.13 有啥新特性，官方文档里的，给我列3个'],
    ['r06', "what's the title of RFC 9110 and when was it published? check rfc-editor.org"],
    ['p04', '帮我比较下苹果官网 iPhone 16 和 iPhone 16 Pro 起售价（apple.com.cn）'],
    ['n01', '今天新浪新闻首页头条是啥'],
    ['n03', '最近一周关于 OpenAI 的新闻有哪些，给3条带链接'],
    ['n06', '上证指数现在多少点'],
    ['m03', 'google maps 上 Eiffel Tower 的地址和评分'],
    ['v03', '网易云音乐 周杰伦 晴天 这首歌在哪张专辑'],
    ['v04', 'spotify 上 Taylor Swift 的月听众数'],
    ['v06', 'QQ音乐热歌榜第一名是啥'],
    ['c01', '百度百科 鲁迅 的出生日期'],
  ])('%s goes to scrape', async (_id, intent) => {
    expect(await route(intent)).toBe('scrape');
  });
  it('going into pages of a site (t04) goes to the browser', async () => {
    expect(await route('books.toscrape.com 进第一本书和第二本书的详情页，告诉我各自库存')).toBe(
      'browser',
    );
  });
  it.each([
    '帮我写一篇介绍维基百科的短文',
    '把这段话翻译成英文：今天天气很好',
    'Google Maps 营销策略',
    '什么是 Google Flights',
    '二分查找的时间复杂度是多少',
    '写一首关于最近天气的诗',
  ])('writing, strategy and common knowledge stay in generate: %s', async (intent) => {
    expect(await route(intent)).toBe('generate');
  });
});

describe('1 · a generate "answer" that is not an answer is not delivered', () => {
  const none = { readSources: false };
  it.each([
    [
      'r05',
      '<computer_use>{"action":"web_search","query":"python 3.13 new features"}</computer_use>',
    ],
    ['n06', '<tool_name>screenshot</tool_name>'],
    ['t04', '我来帮你查看books.toscrape.com上第一本书和第二本书的库存情况，先打开网站看看。'],
    ['r06', "I'll check rfc-editor.org for RFC 9110."],
    ['bare json', '{"action": "navigate", "url": "https://www.rfc-editor.org/rfc/rfc9110"}'],
  ])('%s: tool text or an opener is NON_ANSWER', (_id, answer) => {
    expect(answerQualityFailure(answer, none)).toBe('NON_ANSWER');
  });
  it('r01: 「根据维基百科」 with nothing read is UNREAD_SOURCE; with research it is fine', () => {
    expect(answerQualityFailure('根据维基百科，杭州人口约为1252万。', none)).toBe('UNREAD_SOURCE');
    expect(
      answerQualityFailure('根据维基百科，杭州人口约为1252万。', { readSources: true }),
    ).toBeNull();
  });
  it.each([
    '杭州是浙江省省会，常住人口约1252万（2023年）。',
    '下面是一个 JSON 示例：\n```json\n{"action": "deploy", "env": "prod"}\n```\n其中 action 表示动作。',
    '我来解释一下：二分查找的时间复杂度是 O(log n)，因为每次把区间减半。',
    '根据《民法典》第一千零四十三条，家庭应当树立优良家风。',
  ])('a real answer passes: %s', (answer) => {
    expect(answerQualityFailure(answer, none)).toBeNull();
  });
  it('the failure says what is missing, and is not a platform refund', () => {
    for (const copy of Object.values(CORE_QUALITY_FAILURE_COPY)) {
      expect(copy).toMatch(/请补充具体网址/);
      expect(
        platformFailureReason({
          status: 'failed',
          errorCode: 'CORE_EXECUTION_FAILED',
          errorMessage: copy,
        }),
      ).toBeNull();
    }
  });
});

describe('1 · recent means recent; 3 · every named target answered', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  it('n03: one item from months before is not 「最近一周」', () => {
    expect(
      staleForRecentIntent(
        '最近一周关于 OpenAI 的新闻有哪些',
        '1. OpenAI 发布 GPT-5（2025-08-07）',
        now,
      ),
    ).toContain('2025-08-07');
    expect(
      staleForRecentIntent('最近一周关于 OpenAI 的新闻有哪些', '1. xx（2026年10月19日）', now),
    ).toBeNull();
    expect(staleForRecentIntent('OpenAI 的历史', '2015-12-11 成立', now)).toBeNull();
    expect(
      answerDates('Oct 19, 2026 and 3 March 2025').map((d) => d.toISOString().slice(0, 10)),
    ).toEqual(['2026-10-19', '2025-03-03']);
  });
  it("the read pages' newest date is the anchor when they have dates", () => {
    const intent = '今天新浪新闻首页头条是啥';
    // Pages from 2026-10-08 and an answer from that day: today for those pages.
    expect(
      staleForRecentIntent(intent, '头条（2026-10-08）', now, ['更新于 2026-10-08']),
    ).toBeNull();
    // Pages from this week and an answer from August: not today's.
    expect(
      staleForRecentIntent(intent, '头条（2026-08-01）', now, ['更新于 2026-10-21']),
    ).toContain('2026-08-01');
  });
  it('Deploy-30 core-10: the iframe half left out is sent back', () => {
    const intent = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
    expect(namedTargets(intent)).toEqual(['iframe', 'JavaScript alerts']);
    const alertsOnly =
      '已在 javascript_alerts 页面点击三个按钮：弹出 alert「I am a JS Alert」，页面结果显示 "You entered: null"';
    expect(uncoveredTargets(intent, alertsOnly)).toEqual(['iframe']);
    expect(
      uncoveredTargets(intent, `${alertsOnly}；iframe 内文字为 Your content goes here.`),
    ).toEqual([]);
    const page = observedEvidence('x', 'I am a JS Alert You entered: null', 'https://x/');
    expect(
      assessCompletionFacts({ summary: alertsOnly, pages: [page], intent }).contradictions,
    ).toEqual([expect.stringContaining('「iframe」在答案里没有出现')]);
  });
  it.each([
    'Google 搜索「HOLA DAY AI」返回前5条标题和链接',
    'httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件',
    'Read https://en.wikipedia.org/wiki/West_Lake and tell me the lake area and the year',
  ])('field lists and English prose name no targets: %s', (intent) => {
    expect(namedTargets(intent)).toEqual([]);
  });
});

describe('7 · content-topic takes content planning, not page reads (Deploy-29)', () => {
  it.each([
    '打开 https://www.xiaohongshu.com/explore/6929ba55000000001e023ef8 读这篇笔记的标题、作者和点赞数',
    '打开 https://www.douyin.com/video/7507106798919601427 读视频标题、作者和点赞数（不播放）',
  ])('a page read is not content-topic: %s', (intent) => {
    expect(matchExpertWorkflow({ intent } as never)).toBeNull();
  });
  it.each([
    '帮我想 5 个小红书爆款选题，品类是护肤',
    '抖音 母婴品类 生成 10 个选题',
    '小红书标题怎么起更吸引人',
  ])('content planning still is: %s', (intent) => {
    expect(matchExpertWorkflow({ intent } as never)?.workflowId).toBe('content-topic');
  });
});

describe('3 · interactive tasks go to the browser; scrape "not obtained" is retried', () => {
  it.each([
    [
      'f05',
      '在 https://www.w3schools.com/html/html_forms.asp 那个示例表单里填 First name Tom, Last name Lee，别提交',
    ],
    [
      'd02',
      '帮我下载 https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf 告诉我几页',
    ],
    ['v01', 'B站搜一下 罗翔说刑法 播放量最高的一个视频叫啥（不用播放）'],
    ['c05', '小红书上搜 杭州西湖攻略 第一条笔记标题和作者'],
  ])('%s goes to the browser', async (_id, intent) => {
    expect(await route(intent)).toBe('browser');
  });
  it.each([
    'fill out rate analysis',
    '下载量最高的 npm 包有哪些',
    'python.org 最新版 python 的 macOS 安装包下载链接给我（不用真下载）',
  ])('no form or download to do: %s is not routed by those rules', async (intent) => {
    const decision = await explainExecutionMode({ intent, logger });
    expect(decision.match ?? '').not.toMatch(/填写表单|下载文件/);
  });
  it.each([
    '页面没有显示外婆家的评分，抓取到的内容里没有点评数据。',
    '缺少浏览器环境，无法在此填写表单。以下是表单 HTML：<form>…</form>',
    '- 评分：页面未显示\n- 人均：页面未显示\n- 地址：杭州市西湖区',
  ])('a scrape answer that did not get it is retried: %s', (answer) => {
    expect(answerNotObtained(answer)).toBe(true);
  });
  it.each([
    '- 标题：仙桥洞\n- 作者：Clara\n- 点赞数：页面未显示',
    'Slack 在 G2 上总评分 4.5/5，共 40,008 条评论。',
  ])('a real answer with one missing field is not: %s', (answer) => {
    expect(answerNotObtained(answer)).toBe(false);
  });
});

describe('4 · a balanced 「)」 stays in the URL (r09)', () => {
  it('keeps the closing paren of a wiki title and trims a stray one', () => {
    expect(
      extractTargetUrl(
        'Read https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture) and summarize',
      ),
    ).toBe('https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)');
    expect(extractTargetUrl('看下 (https://example.com/a) 这页')).toBe('https://example.com/a');
    expect(extractTargetUrl('open https://x.com/a)。')).toBe('https://x.com/a');
  });
});

describe('5 · checks that misjudged and a time cap', () => {
  it('d04: 「下载链接给我（不用真下载）」 needs no download receipt', () => {
    const trace = [{ tool: 'navigate', ok: true, url: 'https://www.python.org/downloads/macos/' }];
    expect(
      completionGap(
        'python.org 最新版 python 的 macOS 安装包下载链接给我（不用真下载）',
        '下载链接：https://www.python.org/ftp/python/3.13.0/python-3.13.0-macos11.pkg',
        trace as never,
        true,
      ),
    ).toBeNull();
    expect(
      completionGap('下载这个文件 https://x.com/a.txt', '已下载 a.txt', trace as never, true),
    ).toMatch(/下载没有成功保存回执/);
  });
  it('r04: a page that loaded is no nav failure, even if it says 「服务器拒绝」', () => {
    const summary = "418 I'm a teapot：服务器拒绝尝试用茶壶煮咖啡。";
    expect(detectNavFailure(summary).detected).toBe(true);
    expect(
      detectNavFailure(
        summary,
        'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Status/418',
      ).detected,
    ).toBe(false);
    expect(detectNavFailure('无法连接到该站点', 'chrome-error://chromewebdata/').detected).toBe(
      true,
    );
  });
  it('c03: one page read gets the 300 s cap; multi-step work does not', () => {
    expect(
      readsOnePage(
        '请使用云端浏览器，B站 https://www.bilibili.com/video/BV1GJ411x7h7 这个视频标题和UP主是谁',
      ),
    ).toBe(true);
    expect(readsOnePage('请使用云端浏览器，httpbin.org/forms/post 填个披萨订单')).toBe(false);
    expect(
      readsOnePage('请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个'),
    ).toBe(false);
  });
});

describe('6 · reads are not page actions; an article title is not a wall', () => {
  it.each([
    '打开 https://www.zhihu.com/question/1 读热门评论的第一条',
    '打开 https://example.com/news 读第一条回复是谁写的',
    '打开 https://example.com/about 读发布者和注册号',
    '打开 https://example.com/pay 读支付宝的结算周期',
    '打开 https://example.com/login/help 读这页讲了什么',
  ])('%s routes as a read', async (intent) => {
    expect(await route(intent)).toBe('scrape');
  });
  it('an action word still makes it a page action', async () => {
    expect(await route('打开 https://example.com 帮我登录然后评论一下')).not.toBe('scrape');
  });
  const article = `# Captcha\n\n${Array.from({ length: 40 }, (_, i) => `Paragraph ${i} explains a different aspect of the topic.`).join(' ')}`;
  it.each(['Captcha - Wikipedia', '两步验证', 'Login - Wikipedia', '验证码识别技术综述'])(
    'an article titled %s is not a wall',
    (title) => {
      expect(scrapedWall(article, title)).toBeNull();
    },
  );
  it('a short page under a notice title still is', () => {
    expect(scrapedWall('验证一下，购物无忧 请点击下方按钮登录', '京东验证')).not.toBeNull();
  });
});

describe('FIX-29 leftovers', () => {
  const run = { visitedUrls: ['https://www.douyin.com/video/1'], searched: false };
  it.each([
    '在页面上查找了相关数据，均未显示。',
    'The page has a search bar at the top.',
    '用户可在站内搜索该视频。',
  ])('not a claimed search: %s', (text) => {
    expect(unperformedActions(text, run)).toEqual([]);
  });
  it('赞助商 is not a like word; YouTube English likes are', () => {
    expect(assessEngagementClaims('点赞数：12', ['- generic: 赞助商 12 家'])).toEqual([]);
    expect(
      assessEngagementClaims('Likes: 471', [
        '- button "like this video along with 471 other people" [ref=e52]:\n  - generic: "471"',
      ]),
    ).toEqual([]);
  });
});

/** 2 · BENCH-1 pauses (fix-30/pause-triggers.md): requests from typing into search are not writes. */
describe('2 · read-only search is not a write; real writes still pause', () => {
  let server: Server;
  let base: string;
  let browser: Browser;
  const page = (body: string) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const html =
        req.url === '/search'
          ? // BestBuy: a sensor POST with a random path, fired by the search box's input listener.
            page(
              `<form role="search" action="/s"><input name="q" aria-label="Search" oninput="fetch('/lByGV9hoI/F/uHglT4qg/sensor',{method:'POST',body:'x'})"></form>`,
            )
          : req.url === '/comment'
            ? // Typing into a comment box that posts by XHR: still a write.
              page(
                `<textarea aria-label="写评论" oninput="fetch('/x/7/post',{method:'POST',body:'x'})"></textarea>`,
              )
            : req.url === '/favorite'
              ? page(
                  `<button onclick="fetch('/api/favorite',{method:'POST',body:'x'})">收藏</button>`,
                )
              : page('ok');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise((r) => server.close(r));
  });
  const act = async (path: string, ref: RegExp, action: 'type' | 'click') => {
    const p = await browser.newPage();
    const t = createPlaywrightUnifiedExecutor(p, { observationV2: true });
    try {
      await t.execute({ tool: 'navigate', url: `${base}${path}` } as never);
      const state = JSON.parse((await t.execute({ tool: 'read_page' } as never)).text);
      const target = state.tree.match(ref)![1];
      return await t.execute(
        (action === 'type'
          ? {
              tool: 'type',
              ref: target,
              text: 'AirPods Pro 2',
              observationRevision: state.observationRevision,
            }
          : {
              tool: 'click',
              ref: target,
              observationRevision: state.observationRevision,
            }) as never,
      );
    } finally {
      t.dispose();
      await p.close();
    }
  };
  it('BestBuy: a sensor POST while typing into the search box does not pause', async () => {
    const r = await act('/search', /(?:searchbox|textbox) "Search" \[ref=(e\d+)\]/, 'type');
    expect(r.interruption).toBeUndefined();
  }, 30000);
  it('typing into a comment box that posts still pauses', async () => {
    const r = await act('/comment', /textbox "写评论" \[ref=(e\d+)\]/, 'type');
    expect(r.interruption?.reason).toBe('unexpected_effect');
  }, 30000);
  it('a 收藏 click that posts still pauses', async () => {
    const r = await act('/favorite', /button "收藏" \[ref=(e\d+)\]/, 'click');
    expect(r.interruption?.reason).toBe('unexpected_effect');
  }, 30000);
});
