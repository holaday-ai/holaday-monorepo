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

const SH_HOTEL_BODY = [
  '携程酒店 上海 共找到 1200 家',
  '上海五角场希尔顿花园酒店 高档型 4.5分 五角场商圈 ¥587 起',
  '上海外滩南京东路亚朵酒店 舒适型 4.7分 外滩商圈 ¥734 起',
  '上海静安香格里拉大酒店 豪华型 4.8分 静安寺地铁站 ¥1,164 起',
  '上海虹桥维也纳酒店 经济型 4.3分 虹桥火车站 ¥468 起',
].join('\n');

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

describe('runOtaUserBrowserReadonly — hotels (deterministic URL + extractor)', () => {
  it('上海: deterministic cityId URL, extracts a hotel table with price cap applied', async () => {
    const { client, create } = makeClient([]);
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
    expect(create).not.toHaveBeenCalled(); // deterministic, no model
  });

  it('STALE TAB: Beijing query reading a Shanghai page → fails (no wrong-city table) after 3 retries', async () => {
    const { client } = makeClient([]);
    const dispatchNavigate = navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=1', title: '酒店', bodyText: SH_HOTEL_BODY });
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_stale',
      intent: '打开携程查北京酒店，不要下单。筛选 4 星级、价格 800 元以内，给 5 个选项',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/北京/);
    expect(dispatchNavigate).toHaveBeenCalledTimes(3);
  });

  it('大阪 (unknown schema) → fails, never fakes a URL, never navigates', async () => {
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
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('only ever dispatches navigate/screenshot — no click/type path', async () => {
    const { client } = makeClient([]);
    const dispatchScreenshot = vi.fn(async () => ({ ok: true }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_tools',
      intent: '打开携程查上海酒店，价格 800 元以内，给 5 个',
      deps: { client, dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=2', title: '酒店', bodyText: SH_HOTEL_BODY }), dispatchScreenshot, audit: () => {}, logger: silentLogger },
      now: NOW,
    });
    expect(out.status).toBe('completed');
    expect(out.toolsUsed.sort()).toEqual(['navigate', 'screenshot']);
  });
});
