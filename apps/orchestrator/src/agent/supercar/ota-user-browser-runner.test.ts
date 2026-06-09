import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runOtaUserBrowserReadonly, type ExtensionNavigateResult } from './ota-user-browser-runner.js';

const silentLogger = { info: () => {}, warn: () => {} };
const NOW = new Date('2026-08-10T00:00:00Z');

function makeClient(textReplies: string[]): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  let i = 0;
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: textReplies[i++] ?? '' }] }));
  return { client: { messages: { create } } as unknown as Anthropic, create };
}
function navOk(result: ExtensionNavigateResult) {
  return vi.fn(async () => ({ ok: true, result }));
}


describe('runOtaUserBrowserReadonly — Step 7 subtype gate (hotels only)', () => {
  it('REJECTS a flight intent (no navigate) — flights belong on server Brave', async () => {
    const { client } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_flt',
      intent: '打开携程查北京到上海的机票，不要下单，筛选直飞给最便宜的3个',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/仅支持酒店|flight/);
    expect(dispatchNavigate).not.toHaveBeenCalled();
  });

  it('REJECTS a train intent (no navigate)', async () => {
    const { client } = makeClient([]);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_trn',
      intent: '携程查上海到北京的高铁车次',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(dispatchNavigate).not.toHaveBeenCalled();
  });
});

// Real Ctrip text where the price-adjacent token is a PROMO label (the
// Step-8 junk). A naive parser grabbed these as names; the model must not.
const SH_PROMO_BODY = [
  '携程酒店 上海 共找到 1380 家',
  '上海五角场希尔顿花园酒店 高档型 4.7分 复旦大学 百达屋会员价 ¥587 起',
  '上海外滩亚朵酒店 舒适型 4.7分 南京路步行街 特惠一口价 ¥678 起',
  '上海虹桥全季酒店 经济型 4.5分 虹桥火车站 比收藏时降价 ¥420 起',
].join('\n');
const GOOD_JSON = JSON.stringify([
  { hotelName: '上海五角场希尔顿花园酒店', rating: '4.7', price: 587, location: '复旦大学', starOrTier: '高档型' },
  { hotelName: '上海外滩亚朵酒店', rating: '4.7', price: 678, location: '南京路步行街', starOrTier: '舒适型' },
  { hotelName: '上海虹桥全季酒店', rating: '4.5', price: 420, location: '虹桥火车站', starOrTier: '经济型' },
]);

describe('runOtaUserBrowserReadonly — hotels (Step 9 model-primary + validator)', () => {
  it('上海: model JSON → validated hotel table with real names (price cap applied)', async () => {
    const { client, create } = makeClient([GOOD_JSON]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_h',
      intent: '打开携程查上海酒店，不要下单。筛选 4 星级、价格 800 元以内，给 5 个选项',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_PROMO_BODY }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('| 酒店名 | 评分 | 价格(¥) | 位置 | 档次 |');
    expect(out.summary).toContain('希尔顿花园');
    expect(out.summary).toContain('亚朵');
    expect(out.summary).toContain('全季');
    expect(out.summary).toContain('未预订');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('JUNK NAMES (Step-8 promo labels) returned by model → ALL rejected → honest failure, no table', async () => {
    const junk = JSON.stringify([
      { hotelName: '百达屋会员价', price: 587 },
      { hotelName: '优惠74', price: 678 },
      { hotelName: '特惠一口价', price: 790 },
      { hotelName: '比收藏时降价', price: 495 },
      { hotelName: '连续39位住客好评', price: 728 },
    ]);
    const { client } = makeClient([junk]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_junk',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_PROMO_BODY }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.summary ?? '').not.toContain('百达屋会员价');
    expect(out.reason).toMatch(/未能稳定识别|最低价/);
  });

  it('MIXED (good + junk + over-cap) → only the valid in-budget hotels survive', async () => {
    const mixed = JSON.stringify([
      { hotelName: '上海外滩亚朵酒店', price: 678, rating: '4.7' },
      { hotelName: '特惠一口价', price: 420 }, // junk name → dropped
      { hotelName: '上海静安香格里拉大酒店', price: 1164 }, // over 800 → dropped
      { hotelName: '上海虹桥全季酒店', price: 420, rating: '4.5' },
    ]);
    const { client } = makeClient([mixed]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_mix',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_PROMO_BODY }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('亚朵');
    expect(out.summary).toContain('全季');
    expect(out.summary).not.toContain('特惠一口价');
    expect(out.summary).not.toContain('香格里拉'); // over cap
  });

  it('0 valid + deterministic lowest over cap → honest lowest-price failure', async () => {
    const expensiveBody = '上海王府酒店 豪华型 4.8分 静安商圈 ¥1,500 起\n上海国贸酒店 豪华型 4.7分 陆家嘴商圈 ¥1,800 起';
    const { client } = makeClient(['[]']); // model finds no real hotel
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_cap',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: expensiveBody }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/最低价为 ¥1,500/);
  });

  it('STALE TAB: Beijing query reading a Shanghai page → fails before any model call', async () => {
    const { client, create } = makeClient([GOOD_JSON]);
    const dispatchNavigate = navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=1', title: '酒店', bodyText: SH_PROMO_BODY });
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_stale',
      intent: '打开携程查北京酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/北京/);
    expect(dispatchNavigate).toHaveBeenCalledTimes(3);
    expect(create).not.toHaveBeenCalled(); // stale → no model call
  });

  it('大阪 (unknown schema) → fails, never navigates', async () => {
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
    expect(dispatchNavigate).not.toHaveBeenCalled();
  });

  it('hotel login wall → awaiting_user (no fake completion)', async () => {
    const { client } = makeClient([GOOD_JSON]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_hlogin',
      intent: '打开携程查上海酒店，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '登录', bodyText: '请登录后查看' }), audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('awaiting_user');
    expect(out.question).toContain('登录');
  });

  it('only ever dispatches navigate/screenshot — no click/type path', async () => {
    const { client } = makeClient([GOOD_JSON]);
    const dispatchScreenshot = vi.fn(async () => ({ ok: true }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_tools',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_PROMO_BODY }), dispatchScreenshot, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.toolsUsed.sort()).toEqual(['navigate', 'screenshot']);
  });
});
