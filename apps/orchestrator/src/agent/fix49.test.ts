import { describe, expect, it } from 'vitest';
import { amazonToasterDismiss, keyedLogCheck } from './browser-tools/cloud-observation.js';
import { everyAskedFieldGiven } from './browser-tools/completion-fields.js';
import { answerNotObtained } from './scrape-answer-check.js';

/** The Deploy-49 dy prompts (dy-2 / reg-dy-2). */
const DY =
  '打开 https://www.douyin.com/video/7377304298310389027 读视频标题、作者，以及点赞数、评论数、收藏数、分享数（不播放）';
/** The coordinator's rd2.mjs answer: every asked field read. */
const READ =
  '- 标题：柠檬巴巴露亚\n- 作者：小喵麻麻\n- 点赞数：4741\n- 评论数：215\n- 收藏数：4369\n- 分享数：1652';

describe('FIX-49 #1–#5 · 「没有加载出来」「无法提供」 tied to the asked fields (rd2.mjs)', () => {
  it.each([
    '推荐视频没有加载出来。',
    '页面右侧推荐视频没有加载出来。',
    '无法提供下载。',
    '无法提供原视频文件。',
    '无法提供更多评论。',
    '视频本身没有加载出来（不影响读取上述信息）。',
    '其他视频的信息无法提供。',
    '更多评论内容无法提供。',
  ])('every field read, then 「%s」 stays completed', (aside) => {
    expect(answerNotObtained(`${READ}\n${aside}`, DY)).toBe(false);
  });

  it('a side part or something else unprovided is no 没拿到 even with fields missing (#1, #2)', () => {
    expect(answerNotObtained('标题：柠檬巴巴露亚。页面右侧推荐视频没有加载出来。', DY)).toBe(false);
    expect(answerNotObtained('标题：柠檬巴巴露亚。页面侧栏没有加载出来。', DY)).toBe(false);
    expect(answerNotObtained('标题：柠檬巴巴露亚。其他视频的信息无法提供。', DY)).toBe(false);
    expect(answerNotObtained('标题：柠檬巴巴露亚。更多评论内容无法提供。', DY)).toBe(false);
    expect(answerNotObtained('标题：柠檬巴巴露亚。相关推荐数据都无法提供。', DY)).toBe(false);
  });

  it('the fields asked given, the page aside is not 没拿到 (#3)', () => {
    expect(
      answerNotObtained(
        '标题：A，作者：B。视频内容没有加载出来，但页面文字已读到。',
        '读视频标题和作者',
      ),
    ).toBe(false);
  });

  it.each([
    '目标视频的正文内容没有加载出来。',
    '这个视频页面没有加载出来。',
    '要查的视频没有加载出来。',
    '要查的视频（7377304298310389027）的正文没有加载出来。',
    '标题、作者等信息均无法提供。',
    '以下字段无法提供：标题、作者。',
    '缺失信息（无法提供）：标题',
    '以上信息均无法提供。',
    '所需数据都无法提供。',
    // A field named before 「其他」 is still asked for.
    '标题以及其他信息均无法提供。',
    // A field named after the colon.
    '这些信息无法提供：点赞数、评论数。',
  ])('「%s」 is 没拿到 (#1, #4)', (answer) => {
    expect(answerNotObtained(answer, DY)).toBe(true);
  });

  it('one asked field missing keeps the not-loaded reading (#3 needs every field)', () => {
    expect(
      answerNotObtained('- 标题：柠檬巴巴露亚\n- 作者：小喵麻麻\n视频本身没有加载出来。', DY),
    ).toBe(true);
    expect(
      answerNotObtained(
        '- 标题：柠檬巴巴露亚\n- 作者：无法确认\n- 点赞数：4741\n- 评论数：215\n- 收藏数：4369\n- 分享数：1652\n页面没有加载出来。',
        DY,
      ),
    ).toBe(true);
    // A guessed count is no value.
    expect(
      answerNotObtained(
        '- 标题：柠檬巴巴露亚\n- 作者：小喵麻麻\n- 点赞数：可能是4741\n- 评论数：215\n- 收藏数：4369\n- 分享数：1652\n页面没有加载出来。',
        DY,
      ),
    ).toBe(true);
  });

  it('a question naming no field: 「无法提供」 counts unless it is about something else', () => {
    expect(answerNotObtained('这些数据都无法提供。', '上证指数现在多少点')).toBe(true);
    expect(answerNotObtained('上证指数 3599.02 点。其他数据无法提供。', '上证指数现在多少点')).toBe(
      false,
    );
  });

  it('with no named field nothing is known to be given — the not-loaded reading stands', () => {
    expect(answerNotObtained('目标页面没有加载出来。', '帮我看看这个页面')).toBe(true);
    expect(answerNotObtained('以上信息均无法提供。', '')).toBe(true);
  });

  it('the DEPLOY-49 A verbatim is still 没拿到', () => {
    const a =
      '这个视频页面抓取时遇到了"服务器出现问题，请稍后重试"的错误，目标视频（7377304298310389027）的正文内容没有加载出来。\n\n**缺失信息（无法提供）：**\n- 视频标题\n- 作者\n- 点赞数、评论数、收藏数、分享数';
    expect(answerNotObtained(a, DY)).toBe(true);
  });
});

describe('FIX-49 local A/B · B dy-2 「目标视频页面加载失败」 judged complete', () => {
  /** B dy-2 (f49B-dy-2, scrape only, 10.5 s), verbatim. Base 390097b1 judged it complete too. */
  const B_DY2 =
    '目标视频页面加载失败，显示"服务器出现问题"。\n\n抓取到的内容只包含推荐列表中的其他视频，目标视频（7377304298310389027）的标题、作者、点赞数、评论数、收藏数、分享数都没有加载出来。\n\n需要重新抓取该页面才能获取这些信息。\n\n来源：https://www.douyin.com/video/7377304298310389027';

  it('the verbatim answer is 没拿到 — and each half of it on its own', () => {
    expect(answerNotObtained(B_DY2, DY)).toBe(true);
    expect(answerNotObtained('目标视频页面加载失败，显示"服务器出现问题"。', DY)).toBe(true);
    expect(answerNotObtained('该页面加载失败。', DY)).toBe(true);
    expect(
      answerNotObtained('目标视频（7377304298310389027）的标题、作者、点赞数都没有加载出来。', DY),
    ).toBe(true);
    expect(answerNotObtained('以上信息都没有加载出来。', DY)).toBe(true);
  });

  it('reverse: a load retried and read, a side part, another item’s field', () => {
    expect(answerNotObtained(`目标视频页面加载失败后刷新重试，已读到：\n${READ}`, DY)).toBe(false);
    expect(answerNotObtained(`${READ}\n该视频的评论区没有加载出来。`, DY)).toBe(false);
    expect(answerNotObtained('标题：柠檬巴巴露亚。推荐视频的作者没有加载出来。', DY)).toBe(false);
    expect(
      answerNotObtained('上证指数 3599.02 点。评论区没有加载出来。', '上证指数现在多少点'),
    ).toBe(false);
  });
});

describe('FIX-49 #3 · everyAskedFieldGiven', () => {
  it('reads labelled values, counts in prose, and 「为」', () => {
    expect(everyAskedFieldGiven(DY, READ)).toBe(true);
    expect(
      everyAskedFieldGiven(
        DY,
        '视频标题为「第52集 | 柠檬巴巴露亚」，作者为「小喵麻麻」。互动数据：点赞数4741、评论数215、收藏数4369、分享数1652。',
      ),
    ).toBe(true);
  });

  it('no named field, a missing marker, a guess or a doubted count is not given', () => {
    expect(everyAskedFieldGiven('帮我看看这个视频', READ)).toBe(false);
    expect(everyAskedFieldGiven(DY, READ.replace('小喵麻麻', '页面未显示'))).toBe(false);
    expect(everyAskedFieldGiven(DY, READ.replace('柠檬巴巴露亚', '推测为柠檬'))).toBe(false);
    expect(everyAskedFieldGiven(DY, READ.replace('- 收藏数：4369', '- 收藏数：无法确认'))).toBe(
      false,
    );
    expect(everyAskedFieldGiven(DY, READ.replace('\n- 分享数：1652', ''))).toBe(false);
  });
});

describe('PR #313 review · values of another item, quoted markers and placeholders give nothing', () => {
  const TA = '读视频标题和作者';

  it('another item’s fields do not stand for the asked one (comment 4425441566)', () => {
    expect(answerNotObtained('目标视频没有加载出来。推荐视频标题：A，作者：B。', TA)).toBe(true);
    expect(answerNotObtained('目标视频没有加载出来。相关视频的标题为A，作者为B。', TA)).toBe(true);
    expect(
      everyAskedFieldGiven(DY, `${READ.replace('- 点赞数：4741\n', '')}\n推荐视频点赞数：100`),
    ).toBe(false);
    // The asked item's own values before a 推荐 aside still count.
    expect(answerNotObtained('标题：A，作者：B。页面右侧推荐视频没有加载出来。', TA)).toBe(false);
    expect(everyAskedFieldGiven(TA, '标题：A，作者：B，其他推荐视频没加载。')).toBe(true);
  });

  it.each([
    '目标视频没有加载出来。标题：「未知」，作者：「未知」。',
    '目标视频没有加载出来。标题：“未显示”，作者：“未显示”。',
    '目标视频没有加载出来。标题：—，作者：—。',
    '目标视频没有加载出来。标题：…，作者：？',
    '目标视频没有加载出来。标题：N/A，作者：无。',
    '目标视频没有加载出来。标题：**页面未显示**，作者：「页面上未显示」。',
  ])('「%s」 is 没拿到 (comment 4425441575)', (answer) => {
    expect(answerNotObtained(answer, TA)).toBe(true);
  });

  it('a quoted real value is a value; a title that starts with 未 / 无 is not a marker', () => {
    expect(everyAskedFieldGiven(TA, '标题：「柠檬巴巴露亚」，作者：“小喵麻麻”。')).toBe(true);
    expect(everyAskedFieldGiven(TA, '标题：《未来简史》读书笔记，作者：无名氏。')).toBe(true);
  });
});

describe('FIX-49 #6 · amazon location toaster dismiss (Deploy-49 b-p02)', () => {
  /** The online trigger: `https://www.amazon.com/portal-migration/hz/glow/dismiss-toaster`, json{toasterType,actionSource} 58B. */
  const PATH = '/portal-migration/hz/glow/dismiss-toaster';
  const BODY = '{"toasterType":"AIS_INGRESS","actionSource":"glow_closed"}';
  const dismiss = (url: string, body = BODY, method = 'POST') =>
    amazonToasterDismiss(new URL(url), method, body);

  it('the online request passes — amazon.com and the other stores', () => {
    expect(BODY.length).toBe(58);
    expect(dismiss(`https://www.amazon.com${PATH}`)).toBe(true);
    expect(dismiss(`https://www.amazon.sg${PATH}`)).toBe(true);
    expect(dismiss(`https://www.amazon.co.uk${PATH}`)).toBe(true);
    expect(
      dismiss(`https://amazon.com${PATH}`, '{"actionSource":"glow","toasterType":"AIS_INGRESS"}'),
    ).toBe(true);
  });

  it('reverse: adding to cart and changing the address still pause', () => {
    expect(
      dismiss(
        'https://www.amazon.com/cart/add-to-cart/ref=dp_start-bbf_1_glance',
        '{"items":[{"asin":"B0C1234567","quantity":1}]}',
      ),
    ).toBe(false);
    expect(
      dismiss(
        'https://www.amazon.com/portal-migration/hz/glow/address-change?actionSource=glow',
        '{"locationType":"LOCATION_INPUT","zipCode":"10001","deviceType":"web","storeContext":"generic","pageType":"Gateway","actionSource":"glow"}',
      ),
    ).toBe(false);
    // The dismiss path carrying an address change.
    expect(
      dismiss(
        `https://www.amazon.com${PATH}`,
        '{"locationType":"LOCATION_INPUT","zipCode":"10001","actionSource":"glow"}',
      ),
    ).toBe(false);
  });

  it.each<[string, string, string?, string?]>([
    [
      'a write word in a value',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":"ADD_TO_CART","actionSource":"glow"}',
    ],
    [
      'an address word',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":"ADDRESS_SET","actionSource":"glow"}',
    ],
    [
      'an order word',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":"AIS","actionSource":"order_now"}',
    ],
    [
      'a third key',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":"AIS","actionSource":"glow","zipCode":"10001"}',
    ],
    ['one key only', `https://www.amazon.com${PATH}`, '{"toasterType":"AIS"}'],
    [
      'a value that is not a short token',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":"AIS INGRESS now","actionSource":"glow"}',
    ],
    [
      'a nested value',
      `https://www.amazon.com${PATH}`,
      '{"toasterType":{"a":1},"actionSource":"glow"}',
    ],
    [
      'a long value',
      `https://www.amazon.com${PATH}`,
      `{"toasterType":"${'A'.repeat(41)}","actionSource":"glow"}`,
    ],
    ['not JSON', `https://www.amazon.com${PATH}`, 'toasterType=AIS&actionSource=glow'],
    ['a query string', `https://www.amazon.com${PATH}?zip=10001`],
    ['another path', 'https://www.amazon.com/portal-migration/hz/glow/dismiss-toaster/add'],
    ['a subdomain', `https://unagi.amazon.com${PATH}`],
    ['a lookalike host', `https://www.amazon.com.evil.io${PATH}`],
    ['not amazon', `https://www.bestbuy.com${PATH}`],
    ['a GET', `https://www.amazon.com${PATH}`, BODY, 'GET'],
  ])('reverse: %s still pauses', (_label, url, body = BODY, method = 'POST') => {
    expect(dismiss(url, body, method)).toBe(false);
  });
});

describe('FIX-49 #7 · the widened URL keys (confirmed) still go through host / query / write checks', () => {
  const XHS = new URL('https://apm-fe.xiaohongshu.com/api/data');
  const base = {
    clientTime: 1793520000000,
    context_sdkSessionId: 'a1b2',
    context_platform: 'PC',
    context_route: '/explore',
    context_userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130',
    context_userId: '',
    measurement_name: 'renderPerf',
    measurement_data: {
      duration: 120,
      keyJsName:
        'https://fe-static.xhscdn.com/formula-static/xhs-pc-web/public/resource/js/index.1a2b3c.js',
      keyApiName: 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed',
    },
  };
  const render = (d: Record<string, unknown> = {}) =>
    keyedLogCheck(
      XHS,
      JSON.stringify([{ ...base, measurement_data: { ...base.measurement_data, ...d } }]),
    );

  it('a read API and the SDK’s own script pass', () => {
    expect(render()).toBeNull();
  });

  it.each<[string, string]>([
    ['https://edith.xiaohongshu.com/api/sns/web/v1/feed/post', 'url-write'],
    ['https://edith.xiaohongshu.com/api/store/order/create', 'url-write'],
    ['edith.xiaohongshu.com/api/sns/web/v1/feed/post', 'url-write'],
    ['https://edith.xiaohongshu.com/api/sns/web/v1/note/like', 'value'],
    ['/api/sns/web/v1/comment/post', 'value'],
    ['https://edith.xiaohongshu.com/api/sns/web/v1/homefeed?num=1', 'url-query'],
    ['https://evil.io/api/sns/web/v1/homefeed', 'url-host'],
  ])('keyApiName 「%s」 is refused (%s)', (value, why) => {
    expect(render({ keyApiName: value })).toBe(`record0:measurement_data:${why}:keyApiName`);
  });

  it('keyJsName off the SDK’s hosts is refused', () => {
    expect(render({ keyJsName: 'https://evil.io/a.js' })).toBe(
      'record0:measurement_data:url-host:keyJsName',
    );
  });

  it('the per-kind keys hold no URL for another kind; matchedPath = url is still checked as a URL', () => {
    const timing = (d: Record<string, unknown>) =>
      keyedLogCheck(
        XHS,
        JSON.stringify([
          {
            ...base,
            measurement_name: 'httpRequestTiming',
            measurement_data: d,
          },
        ]),
      );
    expect(
      timing({
        duration: 1,
        keyApiName: 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed',
      }),
    ).toBe('record0:measurement_data:url-key:keyApiName');
    const post = 'https://edith.xiaohongshu.com/api/sns/web/v1/feed/post';
    expect(timing({ url: post, matchedPath: post, duration: 1 })).toBe(
      'record0:measurement_data:url-write:url',
    );
    const feed = 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed';
    expect(timing({ url: feed, matchedPath: feed, duration: 1 })).toBeNull();
  });
});

describe('DEPLOY-50 复审 #1 · the asked thing named as not loaded, then another item’s data (rd3_313.mjs)', () => {
  const VALS = '标题：A，作者：B，点赞数：1，评论数：2，收藏数：3，分享数：4';
  it.each([
    `目标视频没有加载出来。首页第一个视频的${VALS}`,
    `目标视频没有加载出来。以下是热门视频：${VALS}`,
    `这个视频页面没有加载出来，页面显示的是别的视频：${VALS}`,
    `目标视频没有加载出来，页面跳转到了首页，首页视频${VALS}`,
    '要查的视频没有加载出来。标题：A，作者：B，点赞数：0，评论数：0，收藏数：0，分享数：0',
    `目标视频没有加载出来。${VALS}`,
  ])('「%s」 is 没拿到', (answer) => {
    expect(answerNotObtained(answer, DY)).toBe(true);
  });

  it('read anyway, said so, still counts (不影响 / 已读取 / 仍读到)', () => {
    expect(
      answerNotObtained(`目标视频的画面没有加载出来（不影响读取以下信息）。\n${READ}`, DY),
    ).toBe(false);
    expect(answerNotObtained(`该视频没有加载出来，刷新后已读取。\n${READ}`, DY)).toBe(false);
    expect(answerNotObtained(`这个视频页面没有加载出来，但仍读到以下信息。\n${READ}`, DY)).toBe(
      false,
    );
    // …but not when what was read is another item's.
    expect(
      answerNotObtained(`目标视频没有加载出来（不影响读取）。首页第一个视频的${VALS}`, DY),
    ).toBe(true);
  });

  it('a generic aside with every value read stays completed', () => {
    expect(answerNotObtained(`${VALS}。视频画面没有加载出来。`, DY)).toBe(false);
    expect(answerNotObtained(`${VALS}。视频页面加载失败后刷新已读取。`, DY)).toBe(false);
    expect(answerNotObtained(`视频本身没有加载出来（不影响读取上述信息）。\n${READ}`, DY)).toBe(
      false,
    );
  });

  it('首页 / 热门 / 第一个视频 / 跳转 mark another item, unless the request asks for that place', () => {
    expect(everyAskedFieldGiven(DY, `首页第一个视频的${VALS}`)).toBe(false);
    expect(everyAskedFieldGiven(DY, `以下是热门视频：${VALS}`)).toBe(false);
    expect(everyAskedFieldGiven(DY, `页面跳转到了首页，${VALS}`)).toBe(false);
    const home = '打开抖音首页，读第一个视频的标题、作者';
    expect(everyAskedFieldGiven(home, '首页第一个视频的标题：A，作者：B')).toBe(true);
  });
});

describe('DEPLOY-50 复审 #2 · a count named without its 数 / 量', () => {
  it('「点赞、评论、收藏、分享数据均无法提供」 is the asked counts unprovided', () => {
    expect(answerNotObtained('标题：A。作者：B。点赞、评论、收藏、分享数据均无法提供。', DY)).toBe(
      true,
    );
    expect(answerNotObtained('标题：A。作者：B。点赞和评论数据都无法提供。', DY)).toBe(true);
    const plays = '打开 https://www.bilibili.com/video/BV1 读标题和播放量';
    expect(answerNotObtained('标题：A。播放数据无法提供。', plays)).toBe(true);
  });

  it('a word that only starts like the stem is not the count (「评论区」)', () => {
    expect(answerNotObtained('标题：A，作者：B。评论区内容无法提供。', DY)).toBe(false);
    expect(answerNotObtained(`评论区没有加载出来。\n${READ}`, DY)).toBe(false);
  });
});

describe('DEPLOY-50 复审 #3 · still loading, a pointer elsewhere, or one value for all is no value', () => {
  const ALL = (v: string) =>
    `要查的视频没有加载出来。标题：${v}，作者：${v}，点赞数：${v}，评论数：${v}，收藏数：${v}，分享数：${v}`;
  it.each(['加载中', '正在加载', 'Loading', '见上', '同上', '如上', '页面未显示'])(
    '「%s」 in every field is 没拿到',
    (v) => {
      expect(answerNotObtained(ALL(v), DY)).toBe(true);
    },
  );

  it.each(['加载中', '正在加载...', 'loading…', '见上', '同上', '如上'])(
    '「%s」 gives the field no value',
    (v) => {
      expect(everyAskedFieldGiven('读标题和作者', `标题：A，作者：${v}`)).toBe(false);
    },
  );

  it('the same value for every asked field tells none — except 0', () => {
    expect(everyAskedFieldGiven('读标题和作者', '标题：小喵，作者：小喵')).toBe(false);
    expect(everyAskedFieldGiven('读标题和作者', '标题：「小喵」，作者：小喵')).toBe(false);
    expect(
      everyAskedFieldGiven(DY, '标题：A，作者：B，点赞数：0，评论数：0，收藏数：0，分享数：0'),
    ).toBe(true);
    expect(everyAskedFieldGiven('读标题和作者', '标题：小喵日记，作者：小喵')).toBe(true);
    expect(everyAskedFieldGiven('读标题', '标题：小喵')).toBe(true);
  });
});
