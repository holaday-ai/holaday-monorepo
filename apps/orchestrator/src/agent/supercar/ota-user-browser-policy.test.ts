import { describe, expect, it } from 'vitest';
import {
  buildOtaAuditRecord,
  classifyOtaAction,
  decideOtaLane,
  isOtaDomain,
  resolveOtaLaneForIntent,
} from './ota-user-browser-policy.js';

describe('isOtaDomain', () => {
  it('matches the 5 OTA bases + subdomains + leading dot', () => {
    for (const h of [
      'ctrip.com',
      'hotels.ctrip.com',
      'flights.ctrip.com',
      'https://hotels.ctrip.com/hotels/list?city=2',
      '.ctrip.com',
      'qunar.com',
      'fliggy.com',
      'ly.com',
      'hotel.meituan.com',
    ]) {
      expect(isOtaDomain(h), h).toBe(true);
    }
  });
  it('rejects off-whitelist + malformed', () => {
    for (const h of ['example.com', 'ctrip.com.evil.com', 'booking.com', 'has space', '']) {
      expect(isOtaDomain(h), h).toBe(false);
    }
  });
});

describe('decideOtaLane', () => {
  it('flag off → null (routing unchanged)', () => {
    expect(decideOtaLane({ preferUserBrowser: true, extensionOnline: true, flagEnabled: false })).toBeNull();
  });
  it('not an OTA-prefer site → null', () => {
    expect(decideOtaLane({ preferUserBrowser: false, extensionOnline: true, flagEnabled: true })).toBeNull();
  });
  it('OTA-prefer + extension online → user-browser', () => {
    expect(decideOtaLane({ preferUserBrowser: true, extensionOnline: true, flagEnabled: true })).toBe('user-browser');
  });
  it('OTA-prefer + extension offline → server-browser (fallback)', () => {
    expect(decideOtaLane({ preferUserBrowser: true, extensionOnline: false, flagEnabled: true })).toBe('server-browser');
  });
});

describe('resolveOtaLaneForIntent (Task 4 lane cases)', () => {
  it('携程酒店 prompt + extension online → user-browser', () => {
    expect(
      resolveOtaLaneForIntent({
        intent: '打开携程查上海 2026-08-01 到 2026-08-03 的酒店，不要预订。筛选 4 星以上，价格低于 800 元，给 5 个结果。',
        extensionOnline: true,
        flagEnabled: true,
      }),
    ).toBe('user-browser');
  });

  it('携程酒店 prompt + extension offline → server-browser fallback', () => {
    expect(
      resolveOtaLaneForIntent({
        intent: '打开携程查北京酒店，不要预订。筛选 4 星以上，给 5 个结果。',
        extensionOnline: false,
        flagEnabled: true,
      }),
    ).toBe('server-browser');
  });

  it('携程机票 prompt also allowed on user-browser (and server Brave still usable offline)', () => {
    expect(
      resolveOtaLaneForIntent({ intent: '打开携程查北京到上海的机票，不要下单', extensionOnline: true, flagEnabled: true }),
    ).toBe('user-browser');
    expect(
      resolveOtaLaneForIntent({ intent: '打开携程查北京到上海的机票，不要下单', extensionOnline: false, flagEnabled: true }),
    ).toBe('server-browser');
  });

  it('non-OTA browser task is NOT forced to user-browser', () => {
    expect(
      resolveOtaLaneForIntent({ intent: '打开 https://example.com 看看页面', extensionOnline: true, flagEnabled: true }),
    ).toBeNull();
    expect(
      resolveOtaLaneForIntent({ intent: '登录 LinkedIn 查看我的主页', extensionOnline: true, flagEnabled: true }),
    ).toBeNull();
  });

  it('flag off → never user-browser, even for OTA', () => {
    expect(
      resolveOtaLaneForIntent({ intent: '打开携程查上海酒店', extensionOnline: true, flagEnabled: false }),
    ).toBeNull();
  });
});

describe('classifyOtaAction — read/navigate allowed, order/pay/account blocked', () => {
  it('read + screenshot always allowed', () => {
    expect(classifyOtaAction({ kind: 'read' }).allowed).toBe(true);
    expect(classifyOtaAction({ kind: 'screenshot' }).allowed).toBe(true);
  });

  it('navigate to a whitelisted OTA query url is allowed', () => {
    expect(
      classifyOtaAction({ kind: 'navigate', url: 'https://hotels.ctrip.com/hotels/list?city=2&star=4,5&price=0,800' }).allowed,
    ).toBe(true);
  });

  it('navigate to a payment/checkout/order url is blocked', () => {
    for (const url of [
      'https://hotels.ctrip.com/order/submit?id=1',
      'https://m.ctrip.com/webapp/cashier/index',
      'https://www.ctrip.com/checkout/pay',
    ]) {
      const v = classifyOtaAction({ kind: 'navigate', url });
      expect(v.allowed, url).toBe(false);
      expect(v.reason).toMatch(/payment\/order url/);
    }
  });

  it('navigate off-whitelist is blocked', () => {
    expect(classifyOtaAction({ kind: 'navigate', url: 'https://booking.com/hotels' }).allowed).toBe(false);
  });

  it('benign clicks (filters / search) are allowed', () => {
    for (const label of ['筛选', '4星及以上', '价格从低到高', '搜索', '查看详情', '下一页']) {
      expect(classifyOtaAction({ kind: 'click', label }).allowed, label).toBe(true);
    }
  });

  it('clicking 提交订单 / 去支付 / 立即预订 is BLOCKED with a reason', () => {
    for (const label of ['提交订单', '去支付', '立即预订', '确认下单', '立即支付', '确认支付', '去结算', 'Pay now', 'Place order']) {
      const v = classifyOtaAction({ kind: 'click', label });
      expect(v.allowed, label).toBe(false);
      expect(v.reason).toMatch(/forbidden action label/);
    }
  });

  it('account-edit / message / review clicks are blocked', () => {
    for (const label of ['修改密码', '账号设置', '绑定银行卡', '保存支付', '发表评论', '发送', '私信']) {
      expect(classifyOtaAction({ kind: 'click', label }).allowed, label).toBe(false);
    }
  });

  it('form submit is never allowed', () => {
    expect(classifyOtaAction({ kind: 'submit', label: '搜索' }).allowed).toBe(false);
  });
});

describe('buildOtaAuditRecord', () => {
  it('records taskId / domain / actionType / target / decision / reason for a blocked action', () => {
    const action = { kind: 'click' as const, label: '提交订单' };
    const verdict = classifyOtaAction(action);
    const rec = buildOtaAuditRecord({ taskId: 'tsk_x', domain: 'hotels.ctrip.com', lane: 'user-browser', action, verdict });
    expect(rec).toMatchObject({
      event: 'ota.user_browser.action',
      taskId: 'tsk_x',
      domain: 'hotels.ctrip.com',
      lane: 'user-browser',
      actionType: 'click',
      target: '提交订单',
      decision: 'blocked',
    });
    expect(rec.reason).toMatch(/forbidden action label/);
  });

  it('records an allowed navigate', () => {
    const action = { kind: 'navigate' as const, url: 'https://hotels.ctrip.com/hotels/list?city=2' };
    const rec = buildOtaAuditRecord({
      taskId: 'tsk_y',
      domain: 'hotels.ctrip.com',
      lane: 'user-browser',
      action,
      verdict: classifyOtaAction(action),
    });
    expect(rec.decision).toBe('allowed');
    expect(rec.actionType).toBe('navigate');
  });
});
