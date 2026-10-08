import { describe, expect, it } from 'vitest';
import { decideUserBrowserRoute } from './user-browser-routing.js';
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
