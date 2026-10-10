import { describe, expect, it } from 'vitest';
import { browserTaskTargetUrl, decideUserBrowserRoute } from './user-browser-routing.js';
const base = { enabled: true, extensionOnline: true };
describe('identity-aware user Chrome route', () => {
  it.each([
    '在京东查价格',
    '查询淘宝商品',
    '搜索小红书笔记',
    '在微博查公开帖子',
    '在携程查上海酒店',
  ])('defaults %s to Chrome awaiting exact-origin selection', (intent) => {
    expect(decideUserBrowserRoute({ ...base, intent }).lane).toBe('awaiting_user');
  });
  it('does not silently fall back when offline', () => {
    const r = decideUserBrowserRoute({
      ...base,
      intent: '查看我的京东订单',
      extensionOnline: false,
    });
    expect(r.lane).toBe('awaiting_user');
    expect(r.question).toMatch(/安装.*连接.*在线/);
  });
  it('public sites use cloud, flag off preserves legacy', () => {
    expect(decideUserBrowserRoute({ ...base, intent: '打开 https://example.com' }).lane).toBe(
      'cloud',
    );
    expect(decideUserBrowserRoute({ ...base, enabled: false, intent: '查看京东订单' }).lane).toBe(
      'legacy',
    );
  });
  it('public cloud choice is explicit and limited; identity requests cannot use it', () => {
    const r = decideUserBrowserRoute({
      ...base,
      intent: '查询京东公开商品价格',
      publicCloudRequested: true,
    });
    expect(r.lane).toBe('cloud');
    expect(r.limitation).toMatch(/无登录态/);
    expect(
      decideUserBrowserRoute({ ...base, intent: '查看我的京东订单', publicCloudRequested: true })
        .lane,
    ).toBe('awaiting_user');
  });
  it('requires exact origin selection for target URL; no suffix or subdomain grants', () => {
    expect(
      decideUserBrowserRoute({
        ...base,
        intent: '打开 https://item.jd.com/123',
        selectionOrigin: 'https://www.jd.com',
      }).lane,
    ).toBe('awaiting_user');
    expect(
      decideUserBrowserRoute({
        ...base,
        intent: '打开 https://item.jd.com/123',
        selectionOrigin: 'https://item.jd.com',
      }).lane,
    ).toBe('user-chrome');
    expect(
      decideUserBrowserRoute({ ...base, intent: '打开 https://jd.com.attacker.test' }).lane,
    ).toBe('cloud');
  });
});

describe('ordinary login / private-data wording needs the user Chrome (FIX-PR250)', () => {
  const offline = { enabled: true, extensionOnline: false };
  it.each([
    '登录 GitHub 后读取私有仓库列表',
    '查看 Gmail 收件箱',
    '看看京东购物车里有什么',
    '查一下我淘宝的订单',
    '读取私有仓库的 issue',
    '打开邮箱看看有没有新邮件',
    '查看我的账户余额',
    '看下微博私信和消息列表',
    '整理我收藏的小红书笔记',
    '打开个人中心查看会员到期时间',
    '去后台看看今天的销售数据',
    'check my inbox',
    'list my private repositories on github.com',
    'log in to github.com and open notifications',
  ])('%s: waits for Chrome, and a public-cloud choice cannot override it', (intent) => {
    for (const publicCloudRequested of [false, true]) {
      const route = decideUserBrowserRoute({ ...offline, intent, publicCloudRequested });
      expect(route.lane).toBe('awaiting_user');
      expect(route.reason).toBe('extension_offline');
    }
    expect(decideUserBrowserRoute({ ...base, intent }).lane).toBe('awaiting_user');
  });
  it('a usually-logged-in service without explicit wording waits; an explicit public choice is honoured', () => {
    for (const intent of ['打开 Notion 看看这周的计划', '在飞书文档里找到上线清单']) {
      expect(decideUserBrowserRoute({ ...offline, intent }).lane).toBe('awaiting_user');
      expect(
        decideUserBrowserRoute({ ...offline, intent, publicCloudRequested: true }),
      ).toMatchObject({ lane: 'cloud', reason: 'explicit_public_cloud' });
    }
  });
  it.each([
    '打开36kr首页',
    '搜索今天的科技新闻',
    '打开 https://example.com/login 页面截图登录页',
    '查询北京明天的天气',
    '打开 https://github.com/vercel/next.js 看最新 release',
  ])('public task %s still uses the cloud', (intent) => {
    expect(decideUserBrowserRoute({ ...offline, intent })).toMatchObject({
      lane: 'cloud',
      reason: 'public_site',
    });
  });
});

describe('retired automatic cookie sync and vault sessions (FIX-PR252)', () => {
  const off = { enabled: false, extensionOnline: false, legacyCookieSyncRetired: true };
  it('with the routing flag off, login-required tasks wait for the user Chrome', () => {
    for (const intent of ['查看我的京东订单', '看看淘宝购物车', '登录 GitHub 后读取私有仓库列表'])
      expect(decideUserBrowserRoute({ ...off, intent })).toMatchObject({
        lane: 'awaiting_user',
        reason: 'extension_offline',
      });
  });
  it('with the routing flag off, public and site-only queries keep the legacy route', () => {
    for (const intent of ['在京东查价格', '打开36kr首页', '查询北京明天的天气'])
      expect(decideUserBrowserRoute({ ...off, intent })).toEqual({
        lane: 'legacy',
        reason: 'flag_off',
      });
    expect(
      decideUserBrowserRoute({
        ...off,
        legacyCookieSyncRetired: false,
        intent: '查看我的京东订单',
      }),
    ).toEqual({ lane: 'legacy', reason: 'flag_off' });
  });
  it('a connected site grant serves an identity task from the cloud session', () => {
    expect(
      decideUserBrowserRoute({ ...off, intent: '查看我的京东订单', cloudSessionAvailable: true }),
    ).toMatchObject({ lane: 'cloud', reason: 'vault_session', origin: 'https://www.jd.com' });
  });
  it('derives the task target site from an explicit URL or a known site name', () => {
    expect(browserTaskTargetUrl('打开 https://item.jd.com/1.html 看看')).toBe(
      'https://item.jd.com/1.html',
    );
    expect(browserTaskTargetUrl('查看我的京东订单')).toBe('https://www.jd.com');
    expect(browserTaskTargetUrl('搜索今天的新闻')).toBeNull();
  });
});
