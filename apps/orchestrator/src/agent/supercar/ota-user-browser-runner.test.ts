import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runOtaUserBrowserReadonly, type ExtensionNavigateResult } from './ota-user-browser-runner.js';
import type { OtaAuditRecord } from './ota-user-browser-policy.js';

const silentLogger = { info: () => {}, warn: () => {} };
const NOW = new Date('2026-08-10T00:00:00Z');

/** Anthropic stub: messages.create returns the queued text replies in order. */
function makeClient(textReplies: string[]): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  let i = 0;
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: textReplies[i++] ?? '' }] }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}
function navOk(result: ExtensionNavigateResult) {
  return vi.fn(async () => ({ ok: true, result }));
}

const FLIGHT_BODY = [
  '携程 北京→上海 直飞 价格排序',
  '东方航空 MU5101 08:00 首都T2 10:15 虹桥T1 2小时15分 直飞 ¥980 订',
  '春秋航空 9C8888 21:05 大兴 23:25 浦东T1 2小时20分 直飞 ¥760 订',
  '中国国航 CA1858 13:30 首都T3 15:50 浦东T2 2小时20分 直飞 ¥1,180 订',
].join('\n');

const SH_HOTEL_BODY = [
  '携程酒店 上海 共找到 1200 家',
  '上海五角场希尔顿花园酒店 高档型 4.5分 五角场商圈 ¥587 起',
  '上海外滩南京东路亚朵酒店 舒适型 4.7分 外滩商圈 ¥734 起',
  '上海静安香格里拉大酒店 豪华型 4.8分 静安寺地铁站 ¥1,164 起',
  '上海虹桥维也纳酒店 经济型 4.3分 虹桥火车站 ¥468 起',
].join('\n');

describe('runOtaUserBrowserReadonly — flights (model URL + deterministic extract)', () => {
  it('navigates, extracts a flight table, completes (未下单)', async () => {
    const { client, create } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha?depdate=2026-08-11&nonstop=1']);
    const dispatchNavigate = navOk({ finalUrl: 'https://flights.ctrip.com/online/list/oneway-bjs-sha?nonstop=1', title: '机票', bodyText: FLIGHT_BODY });
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_f',
      intent: '打开携程查北京到上海的机票，不要下单，筛选直飞给最便宜的3个',
      deps: { client, dispatchNavigate, audit: (r) => audit.push(r), logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('你的浏览器');
    expect(out.summary).toContain('春秋航空');
    expect(out.summary).toContain('未下单/未预订');
    expect(create).toHaveBeenCalledTimes(1); // only URL derive
    expect(audit[0]).toMatchObject({ actionType: 'navigate', decision: 'allowed' });
  });
});

describe('runOtaUserBrowserReadonly — hotels (deterministic URL + extractor)', () => {
  it('上海: deterministic cityId URL, extracts a hotel table with price cap applied', async () => {
    const { client, create } = makeClient([]); // extractor handles it — no model call
    const dispatchNavigate = navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_HOTEL_BODY });
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_h',
      intent: '打开携程查上海酒店，不要下单。筛选 4 星级、价格 800 元以内，给 5 个选项',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('| 酒店名 | 评分 | 价格(¥) | 位置 | 档次 |');
    expect(out.summary).toContain('维也纳'); // ¥468 in
    expect(out.summary).not.toContain('香格里拉'); // ¥1164 over the 800 cap
    expect(out.summary).toContain('未预订');
    expect(create).not.toHaveBeenCalled(); // deterministic path, no model
  });

  it('STALE TAB: Beijing query reads a Shanghai page → fails (no wrong-city table) after retries', async () => {
    const { client } = makeClient([]);
    // city=1 (Beijing) URL but the tab still shows Shanghai content
    const dispatchNavigate = navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=1', title: '酒店', bodyText: SH_HOTEL_BODY });
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_stale',
      intent: '打开携程查北京酒店，不要下单。筛选 4 星级、价格 800 元以内，给 5 个选项',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/北京/);
    expect(out.reason).toMatch(/未输出结果|未稳定/);
    expect(dispatchNavigate).toHaveBeenCalledTimes(3); // retried before giving up
  });

  it('大阪 (unknown schema) → fails, never fakes a URL', async () => {
    const { client } = makeClient([]);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_osaka',
      intent: '打开携程查大阪酒店，给 5 个',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/大阪/);
    expect(dispatchNavigate).not.toHaveBeenCalled(); // no navigate on unknown schema
  });

  it('hotel login wall → awaiting_user (no fake completion)', async () => {
    const { client } = makeClient([]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_hlogin',
      intent: '打开携程查上海酒店，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '登录', bodyText: '请登录后查看' }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('awaiting_user');
    expect(out.question).toContain('登录');
  });

  it('all hotels over the price cap → honest failure with lowest price', async () => {
    const expensive = '上海王府酒店 豪华型 4.8分 静安商圈 ¥1,500 起\n上海国贸酒店 豪华型 4.7分 陆家嘴商圈 ¥1,800 起';
    const { client } = makeClient([]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_cap',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: expensive }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/最低价为 ¥1,500|未找到符合/);
  });

  it('extractor finds nothing → model fallback extraction', async () => {
    // body mentions 上海 (passes city guard) but has no parseable 酒店 names
    const oddBody = '上海 携程酒店搜索结果 共 320 家 以卡片图形展示，文本无结构 '.repeat(6);
    const { client, create } = makeClient(['| 酒店名 | 评分 | 价格(¥) | 位置 | 档次 |\n| --- | --- | --- | --- | --- |\n| 上海某酒店 | 4.6 | 700 | 静安 | 高档型 |\n\n仅查询，未预订']);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_fb',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: oddBody }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('| 酒店名 |');
    expect(create).toHaveBeenCalledTimes(1); // model fallback used
  });
});

describe('runOtaUserBrowserReadonly — safety', () => {
  it('blocks a pay/order URL the flight model derives, never navigates', async () => {
    const { client } = makeClient(['https://hotels.ctrip.com/order/submit?id=123']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_block',
      intent: '查北京到上海机票',
      deps: { client, dispatchNavigate, audit: (r) => audit.push(r), logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/拒绝打开/);
    expect(dispatchNavigate).not.toHaveBeenCalled();
    expect(audit[0]).toMatchObject({ decision: 'blocked' });
  });

  it('canary domain guard blocks a non-ctrip OTA URL the flight model derives', async () => {
    const { client } = makeClient(['https://flights.qunar.com/online/list/oneway?dep=BJS']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_canary',
      intent: '查北京到上海机票',
      deps: { client, dispatchNavigate, audit: (r) => audit.push(r), logger: silentLogger, allowedDomains: new Set(['ctrip.com']) },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/灰度范围/);
    expect(dispatchNavigate).not.toHaveBeenCalled();
    expect(audit.some((r) => r.decision === 'blocked' && /canary allowlist/.test(r.reason))).toBe(true);
  });

  it('only ever dispatches navigate/screenshot — no click/type path', async () => {
    const { client } = makeClient([]);
    const dispatchNavigate = navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_HOTEL_BODY });
    const dispatchScreenshot = vi.fn(async () => ({ ok: true }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_tools',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate, dispatchScreenshot, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.toolsUsed.sort()).toEqual(['navigate', 'screenshot']);
  });
});
