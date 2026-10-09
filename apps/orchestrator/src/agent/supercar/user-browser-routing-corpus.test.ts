import { describe, expect, it } from 'vitest';
import { decideUserBrowserRoute, requiresUserIdentity } from './user-browser-routing.js';

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
  it.each(PRIVATE)('private → waits for the user Chrome without a cloud fallback: %s', (intent) => {
    expect(requiresUserIdentity(intent)).toBe(true);
    for (const enabled of [false, true]) {
      const route = decideUserBrowserRoute({
        enabled,
        intent,
        extensionOnline: false,
        legacyCookieSyncRetired: true,
        publicCloudRequested: true,
      });
      expect(route).toMatchObject({
        lane: 'awaiting_user',
        reason: 'extension_offline',
        identityRequired: true,
      });
      expect(route.question).toContain('需要连接 HOLA DAY Chrome 插件');
      expect(route.question).not.toContain('用公开云端');
    }
  });
  it('a non-identity wait (first-cohort site preference) offers the public-cloud option', () => {
    const route = decideUserBrowserRoute({
      enabled: true,
      intent: '在京东查一下 iPhone 价格',
      extensionOnline: false,
    });
    expect(route).toMatchObject({ lane: 'awaiting_user', identityRequired: false });
    expect(route.question).toContain('需要连接 HOLA DAY Chrome 插件');
    expect(route.question).toContain('用公开云端（无登录态）继续');
  });
});
