import { describe, expect, it } from 'vitest';
import {
  buildOtaAuditRecord,
  classifyOtaAction,
  classifyOtaIntentSubtype,
  decideOtaLane,
  isHostAllowed,
  isOtaDomain,
  parseOtaAllowlist,
  resolveOtaCanaryLane,
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

describe('classifyOtaIntentSubtype', () => {
  it('hotel markers → hotel', () => {
    for (const i of ['打开携程查上海酒店', '携程查北京住宿 4 星级', 'ctrip hotel checkin']) {
      expect(classifyOtaIntentSubtype(i), i).toBe('hotel');
    }
  });
  it('flight markers → flight (precedence over a stray hotel word)', () => {
    for (const i of ['携程查北京到上海的机票', '携程直飞航班', '查机场到酒店附近的机票']) {
      expect(classifyOtaIntentSubtype(i), i).toBe('flight');
    }
  });
  it('train / maps → their subtype', () => {
    expect(classifyOtaIntentSubtype('携程高铁车次')).toBe('train');
    expect(classifyOtaIntentSubtype('携程火车票')).toBe('train');
    expect(classifyOtaIntentSubtype('查路线导航')).toBe('maps');
  });
  it('no markers → unknown', () => {
    expect(classifyOtaIntentSubtype('携程营销策略')).toBe('unknown');
    expect(classifyOtaIntentSubtype('')).toBe('unknown');
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

describe('parseOtaAllowlist / isHostAllowed', () => {
  it('parses comma lists, trimming but PRESERVING case (userIds are case-sensitive)', () => {
    const s = parseOtaAllowlist(' ctrip.com , usr_EeYpvsvLtyDzN4VLQi7BT ,, ');
    expect([...s].sort()).toEqual(['ctrip.com', 'usr_EeYpvsvLtyDzN4VLQi7BT'].sort());
    expect(parseOtaAllowlist(undefined).size).toBe(0);
  });
  it('host match is case-insensitive (exact or subdomain); empty set ⇒ false', () => {
    const allow = parseOtaAllowlist('Ctrip.com'); // mixed-case env entry
    expect(isHostAllowed('ctrip.com', allow)).toBe(true);
    expect(isHostAllowed('hotels.ctrip.com', allow)).toBe(true);
    expect(isHostAllowed('qunar.com', allow)).toBe(false);
    expect(isHostAllowed('ctrip.com', new Set())).toBe(false);
  });
});

describe('resolveOtaCanaryLane (Step 2.5 gate matrix)', () => {
  const HOTEL = '打开携程查上海酒店，不要预订。筛选 4 星以上，给 5 个结果。';
  const USER = 'usr_test';
  const allowedUserIds = new Set([USER]);
  const allowedDomains = parseOtaAllowlist('ctrip.com,flights.ctrip.com,hotels.ctrip.com');

  it('flag off → server-browser', () => {
    const d = resolveOtaCanaryLane({ intent: HOTEL, userId: USER, extensionOnline: true, masterEnabled: false, allowedUserIds, allowedDomains });
    expect(d.lane).toBe('server-browser');
    expect(d.reason).toMatch(/master flag off/);
  });
  it('flag on but user NOT allowlisted → server-browser', () => {
    const d = resolveOtaCanaryLane({ intent: HOTEL, userId: 'usr_other', extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.lane).toBe('server-browser');
    expect(d.userAllowed).toBe(false);
    expect(d.reason).toMatch(/user not in canary/);
  });
  it('flag on + user allowlisted but DOMAIN not allowlisted → server-browser', () => {
    const d = resolveOtaCanaryLane({ intent: '去哪儿查东京到上海机票', userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.matchedDomain).toBe('qunar.com');
    expect(d.lane).toBe('server-browser');
    expect(d.domainAllowed).toBe(false);
    expect(d.reason).toMatch(/domain not in canary/);
  });
  it('flag on + user + domain allowlisted + extension online + HOTEL → user-browser', () => {
    const d = resolveOtaCanaryLane({ intent: HOTEL, userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.lane).toBe('user-browser');
    expect(d.userAllowed).toBe(true);
    expect(d.domainAllowed).toBe(true);
    expect(d.intentSubtype).toBe('hotel');
  });

  it('Step 7: a Ctrip FLIGHT with ALL canary gates satisfied is forced to server-browser', () => {
    for (const intent of ['打开携程查北京到上海的机票，不要下单，筛选直飞', '打开携程查上海到北京机票']) {
      const d = resolveOtaCanaryLane({ intent, userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
      expect(d.intentSubtype, intent).toBe('flight');
      expect(d.lane, intent).toBe('server-browser');
      expect(d.reason, intent).toBe('flight-prefers-server-brave-adapter');
    }
  });

  it('Step 7: Ctrip 火车票/高铁 → server-browser', () => {
    const d = resolveOtaCanaryLane({ intent: '携程查上海到北京的高铁车次', userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.intentSubtype).toBe('train');
    expect(d.lane).toBe('server-browser');
    expect(d.reason).toMatch(/train-prefers-server-browser/);
  });
  it('extension offline → server-browser', () => {
    const d = resolveOtaCanaryLane({ intent: HOTEL, userId: USER, extensionOnline: false, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.lane).toBe('server-browser');
    expect(d.reason).toMatch(/extension offline/);
  });
  it('non-OTA intent → null (routing unchanged)', () => {
    const d = resolveOtaCanaryLane({ intent: '打开 https://example.com 看看', userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds, allowedDomains });
    expect(d.lane).toBeNull();
  });
  it('REGRESSION: mixed-case userId matches a mixed-case allowlist entry (no lowercasing)', () => {
    const mixed = 'usr_EeYpvsvLtyDzN4VLQi7BT';
    const d = resolveOtaCanaryLane({
      intent: HOTEL,
      userId: mixed,
      extensionOnline: true,
      masterEnabled: true,
      allowedUserIds: parseOtaAllowlist(mixed),
      allowedDomains,
    });
    expect(d.userAllowed).toBe(true);
    expect(d.lane).toBe('user-browser');
  });

  it('empty allowlists (prod default) → never user-browser', () => {
    const d = resolveOtaCanaryLane({ intent: HOTEL, userId: USER, extensionOnline: true, masterEnabled: true, allowedUserIds: new Set(), allowedDomains: new Set() });
    expect(d.lane).toBe('server-browser');
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
