import { describe, expect, it } from 'vitest';
import {
  classifyIdentityNeed,
  decideUserBrowserRoute,
  requiresUserIdentity,
} from './user-browser-routing.js';

/**
 * A private request: identity is required with a readable reason; with the
 * routing flag on or off it waits for the user's Chrome, the wait offers
 * "用公开云端继续（看不到你的个人信息）", and only that explicit choice runs it
 * publicly (logged out, with the limitation stated).
 */
function expectPrivateWait(intent: string) {
  const decision = classifyIdentityNeed(intent);
  expect(decision).toMatchObject({ required: true, reason: expect.stringMatching(/「.+」/) });
  for (const enabled of [false, true]) {
    const route = decideUserBrowserRoute({
      enabled,
      intent,
      extensionOnline: false,
      legacyCookieSyncRetired: true,
    });
    expect(route).toMatchObject({
      lane: 'awaiting_user',
      reason: 'extension_offline',
      identityRequired: true,
      identityReason: decision.reason,
    });
    expect(route.question).toContain('需要连接 HOLA DAY Chrome 插件');
    expect(route.question).toContain('用公开云端继续（看不到你的个人信息）');
    expect(
      decideUserBrowserRoute({
        enabled,
        intent,
        extensionOnline: false,
        legacyCookieSyncRetired: true,
        publicCloudRequested: true,
      }),
    ).toMatchObject({
      lane: 'cloud',
      reason: 'explicit_public_cloud',
      limitation: expect.stringContaining('看不到你的个人信息'),
    });
  }
}

/**
 * FIX-D11-ROUTING: Deploy-11 sent public pages to "插件未连接". Only explicit
 * personal-login / private-data requests may wait for the user's Chrome; public
 * pages, news, public repos / PRs / issues always run in the cloud.
 */
const PUBLIC = [
  // Deploy-11 originals (both carried "不登录").
  '【Deploy-11验收 GitHub】打开公开仓库 microsoft/playwright 的 PR 页面 https://github.com/microsoft/playwright/pull/43246，只读查看标题、作者、合并状态及讨论中两条具体内容，提供可核实原页链接。不登录GitHub、不评论、不改代码或设置。',
  '【Deploy-11验收 新闻】只读打开36kr首页 https://36kr.com/ ，总结北京时间2026年10月9日发布的前三条新闻。每条给原标题、实际发布日期和具体文章链接。没有足够可验证的今天新闻时如实说明，不能只交首页链接。不登录、不评论、不付费。',
  '打开 https://github.com/vercel/next.js/issues/1 总结这个公开 issue 的讨论',
  '查看 microsoft/vscode 仓库最近的 release 说明（公开页面，无需登录）',
  '只读打开 https://news.ycombinator.com 列出前五条新闻标题和链接',
  '打开新浪财经首页总结今天的要闻，不需要登录',
  '查一下 OpenAI 官方账号最近发布的公告',
  '找到这家公司官网上的联系邮箱和电话',
  '查看京东 Plus 会员价格介绍页面并总结权益',
  '统计这个 GitHub 仓库的收藏数和 fork 数 https://github.com/facebook/react',
  '打开学校官网的通知列表，整理本周通知标题',
  '打开 https://status.openai.com 看看服务状态 dashboard',
  '读一下余额宝最新的七日年化收益率',
  '打开 https://example.com/login 截图登录页的样式',
  '在维基百科查一下杭州的人口',
  '打开 B 站热门排行榜，列出前十个视频标题',
  '不用登录，帮我看看 GitHub trending 今天前五的仓库',
  'without logging in, open https://github.com/nodejs/node/pull/1 and summarize the review comments',
  '查看 npm 上 react 包的周下载量',
  '打开 https://www.zhihu.com/hot 列出热榜前五（不登录）',
];
const PRIVATE = [
  '查看我的京东订单',
  '登录 GitHub 后读取私有仓库列表',
  '查看 Gmail 收件箱',
  '看看淘宝购物车里有什么',
  '查一下我淘宝的订单物流',
  '读取私有仓库的 issue',
  '打开邮箱看看有没有新邮件',
  '查看我的账户余额',
  '看下微博私信',
  '整理我收藏的小红书笔记',
  '打开个人中心查看会员到期时间',
  '去后台看看今天的销售数据',
  'check my inbox',
  'list my private repositories on github.com',
  'log in to github.com and open my notifications',
  '用我的账号登录知乎看看消息中心',
  '查看携程订单详情',
  '打开支付宝账单明细',
  '打开钉钉工作台看看待办',
  '帮我查一下我关注的博主最近更新',
];

describe('identity routing corpus (≥40 sentences, half public / half private)', () => {
  it('has the required size and balance', () => {
    expect(PUBLIC.length + PRIVATE.length).toBeGreaterThanOrEqual(40);
    expect(PUBLIC.length).toBe(PRIVATE.length);
  });
  it.each(PUBLIC)('public → never waits for the extension: %s', (intent) => {
    expect(requiresUserIdentity(intent)).toBe(false);
    // Production today: routing flag off, legacy cookie sync retired.
    expect(
      decideUserBrowserRoute({
        enabled: false,
        intent,
        extensionOnline: false,
        legacyCookieSyncRetired: true,
      }),
    ).toEqual({ lane: 'legacy', reason: 'flag_off' });
    // Flag on: never an identity wait (a named first-cohort site may still prefer Chrome).
    const on = decideUserBrowserRoute({ enabled: true, intent, extensionOnline: false });
    if (on.lane === 'awaiting_user') expect(on.identityRequired).toBe(false);
  });
  it.each(PRIVATE)(
    'private → waits for the user Chrome, public cloud only by explicit choice: %s',
    (intent) => {
      expectPrivateWait(intent);
    },
  );
  it('a public first-cohort query no longer waits before departure (FIX-ROUTING-IDENTITY-2)', () => {
    expect(
      decideUserBrowserRoute({
        enabled: true,
        intent: '在京东查一下 iPhone 价格',
        extensionOnline: false,
      }),
    ).toMatchObject({ lane: 'cloud', reason: 'public_site' });
  });
});

/**
 * FIX-PR259-2 P1-1: a negated login only cancels the login itself. A personal /
 * private request after it ("无需登录直接查看我的订单") still needs the user's Chrome.
 */
const NEGATED_LOGIN_PRIVATE = [
  '打开京东网页，无需登录直接查看我的订单', // review B04
  '打开 GitHub 不用登录直接读取私有仓库',
  '不登录也帮我看看购物车里有什么',
  "don't sign in again, just open my orders on jd.com",
];
const NEGATED_LOGIN_PUBLIC = [
  '打开 GitHub 不用登录直接读取公开仓库 README',
  '无需登录直接查看京东首页的促销活动',
];
describe('negated login keeps the personal-data request that follows it', () => {
  it.each(NEGATED_LOGIN_PRIVATE)('still waits for the user Chrome: %s', (intent) => {
    expectPrivateWait(intent);
  });
  it.each(NEGATED_LOGIN_PUBLIC)('a negated login on a public page stays public: %s', (intent) => {
    expect(requiresUserIdentity(intent)).toBe(false);
  });
});

/**
 * FIX-ROUTING-NEG (browser-bench-1): a stop condition ("若有验证码、登录墙…立即停止")
 * or a forbidden action ("不加购物车", "不要下单") is not a request for the
 * user's account. Real personal-data requests in the same sentence still are.
 */
const BENCH_ORIGINALS = [
  '【BROWSER-BENCH-1 / 01】公开信息只读对照测试。请使用云端浏览器打开 Google 搜索“HOLA DAY AI”，只从 Google 实际页面读取前 5 条自然搜索结果，返回每条标题和链接。不得换搜索引擎或用已有知识补结果。不登录任何站点，不处理验证码；若有验证码、登录墙或网络错误，立即停止并报告页面原文及当前 URL。不得购买、提交表单或发送消息。',
  '【BROWSER-BENCH-1 / 05】使用公共云端浏览器打开 https://search.jd.com/Search?keyword=%E6%9D%AF%E5%AD%90 ，只从实际商品搜索页读取前5个商品名称和价格。仅公开查询，不购买、不加购物车、不提交任何表单。遇到验证或账号门槛立即暂停，不绕过。',
];
const CONDITION_OR_NEGATION_PUBLIC = [
  '遇到登录墙就停下交给我',
  '只读商品搜索，不加购物车、不购买',
  '打开 https://www.jd.com 搜索保温杯，不要加入购物车，不要下单',
  '在淘宝搜索机械键盘，只看价格，不收藏、不关注店铺，遇到登录弹窗就停止',
  '查看小红书上的露营攻略，若需要验证码或登录就暂停并告诉我，不评论不点赞',
  'Open https://github.com/trending and list the top 5 repos; if a sign-in page appears, stop and report',
  "search amazon for headphones, don't add anything to the cart and don't check out",
];
const CONDITION_OR_NEGATION_PRIVATE = [
  '遇到登录页就用我的账号登录，然后查看我的订单',
  '不要下单，帮我看看我的订单物流',
  '如果需要验证就停下，否则打开我的收藏夹整理商品',
  '不加购物车，查看我的购物车里已有的商品',
  "don't place an order, just check my orders on jd.com",
];
describe('stop conditions and forbidden actions are not identity needs', () => {
  it('has the required size', () => {
    expect(CONDITION_OR_NEGATION_PUBLIC.length).toBeGreaterThanOrEqual(4);
    expect(CONDITION_OR_NEGATION_PRIVATE.length).toBeGreaterThanOrEqual(4);
  });
  it.each([...BENCH_ORIGINALS, ...CONDITION_OR_NEGATION_PUBLIC])('public: %s', (intent) => {
    expect(requiresUserIdentity(intent)).toBe(false);
    // Production today: routing flag off → the legacy cloud route, never an extension wait.
    expect(
      decideUserBrowserRoute({
        enabled: false,
        intent,
        extensionOnline: false,
        legacyCookieSyncRetired: true,
      }),
    ).toEqual({ lane: 'legacy', reason: 'flag_off' });
    const on = decideUserBrowserRoute({ enabled: true, intent, extensionOnline: false });
    if (on.lane === 'awaiting_user') expect(on.identityRequired).toBe(false);
  });
  it.each(CONDITION_OR_NEGATION_PRIVATE)('private: %s', (intent) => {
    expectPrivateWait(intent);
  });
});

/** Public sites usually unreachable from mainland China stay in the cloud with routing v2. */
describe('mainland-unreachable public sites prefer the cloud', () => {
  it.each([
    'https://www.youtube.com/results?search_query=微信使用教程', // "微信" alone would wait for Chrome
    '在谷歌搜索支付宝最新新闻',
    'Wikipedia 上查一下杭州的人口',
    '打开 https://en.wikipedia.org/wiki/Hangzhou 总结第一段',
    'https://www.google.com.hk/search?q=钉钉 价格',
    BENCH_ORIGINALS[0] as string,
  ])('cloud even with the extension online: %s', (intent) => {
    for (const extensionOnline of [false, true])
      expect(decideUserBrowserRoute({ enabled: true, intent, extensionOnline })).toMatchObject({
        lane: 'cloud',
        reason: 'public_site',
        limitation: expect.stringContaining('中国大陆'),
      });
  });
  it('a private request on such a site still waits for the user Chrome', () => {
    expect(
      decideUserBrowserRoute({
        enabled: true,
        intent: '打开 YouTube 查看我的订阅列表',
        extensionOnline: false,
      }),
    ).toMatchObject({ lane: 'awaiting_user', identityRequired: true });
  });
  it('an explicit Chrome page choice is honoured', () => {
    expect(
      decideUserBrowserRoute({
        enabled: true,
        intent: '在 https://www.youtube.com/ 搜索露营视频',
        extensionOnline: true,
        selectionOrigin: 'https://www.youtube.com',
      }),
    ).toMatchObject({ lane: 'user-chrome' });
  });
  it('a first-cohort site named alongside is public too: cloud, without the unreachable note', () => {
    expect(
      decideUserBrowserRoute({
        enabled: true,
        intent: '在京东搜索谷歌手机',
        extensionOnline: false,
      }),
    ).toEqual({ lane: 'cloud', reason: 'public_site' });
  });
});

/**
 * FIX-ROUTING-IDENTITY-2 (bakeoff-2 D16-B01): mentioning 登录 / 验证 / 账号 never
 * makes a task private. Only reading or acting on the user's own data does.
 */
const D16_B01_ORIGINAL =
  '【Deploy-16 核心验收 01】使用真实浏览器打开 https://www.google.com/search?q=HOLA+DAY+AI ，读取 Google 搜索「HOLA DAY AI」前5条自然搜索结果，逐条返回标题和实际链接，并保留步骤截图。只读，不提交表单、不购买、不登录、不播放视频；如果遇到真实登录墙或验证码，明确说明当前页面证据并暂停交给用户，禁止绕过，也不要把导航链接中的登录按钮误当成登录墙。';
const LOGIN_WORDS_PUBLIC = [
  D16_B01_ORIGINAL,
  '公开搜索 Google HOLA DAY AI，不要把导航链接中的登录按钮误当成登录墙。',
  '遇到登录墙就停',
  '别把登录按钮当成墙，继续读取搜索结果',
  '不需要登录，直接看京东首页的秒杀活动',
  '登录页面长什么样？帮我截图 https://github.com/login',
  '帮我看看这个网站的登录方式 https://www.zhihu.com',
  '对比一下淘宝和京东的登录页设计',
  '页面右上角有登录按钮，不用管它，只读取正文',
  '如果弹出验证码就停下来告诉我',
  '这个网站需要注册账号吗？查一下 https://www.notion.so 的定价页',
  '查一下微博官方账号最近发布的公告',
  '总结 https://docs.github.com 上关于账号安全的公开文档',
  '检查这个页面是否要求登录才能看评论 https://www.douban.com',
  'Open https://www.reddit.com/r/programming and list the top posts; ignore the login button in the header',
  'find out whether https://www.figma.com requires an account to view the pricing page',
  '看看 B 站首页是不是需要登录才能看热门视频',
  '登录墙、验证码、账号门槛一律不处理，只读公开内容',
];
const OWN_DATA_PRIVATE = [
  '帮我看看我的京东订单到哪了',
  '整理我在小红书收藏的笔记',
  '用我的 GitHub 账号查看我的私有仓库列表',
  '读取我的 Gmail 收件箱里的未读邮件',
  '以我的身份在微博发一条动态',
  '查看我的支付宝账户余额',
  '打开我的淘宝购物车，列出里面的商品',
  'check my orders on amazon and tell me which ones have shipped',
  '帮我看看我在知乎关注的人最近发了什么',
];
describe('login / verification / account wording is not an identity need (FIX-ROUTING-IDENTITY-2)', () => {
  it('has the required size', () => {
    expect(LOGIN_WORDS_PUBLIC.length).toBeGreaterThanOrEqual(15);
    expect(OWN_DATA_PRIVATE.length).toBeGreaterThanOrEqual(8);
  });
  it.each(LOGIN_WORDS_PUBLIC)('public, runs in the cloud before any login wall: %s', (intent) => {
    const decision = classifyIdentityNeed(intent);
    expect(decision.required).toBe(false);
    expect(decision.reason).toContain('提到登录、验证或账号不算');
    for (const enabled of [false, true])
      for (const extensionOnline of [false, true])
        expect(
          decideUserBrowserRoute({
            enabled,
            intent,
            extensionOnline,
            legacyCookieSyncRetired: true,
          }).lane,
        ).toBe(enabled ? 'cloud' : 'legacy');
  });
  it.each(OWN_DATA_PRIVATE)('private, the reason names the personal-data object: %s', (intent) => {
    expectPrivateWait(intent);
  });
  it('the D16-B01 original routes to the public cloud with the unreachable-site note', () => {
    expect(
      decideUserBrowserRoute({ enabled: true, intent: D16_B01_ORIGINAL, extensionOnline: false }),
    ).toMatchObject({
      lane: 'cloud',
      reason: 'public_site',
      limitation: expect.stringContaining('中国大陆'),
    });
  });
});
