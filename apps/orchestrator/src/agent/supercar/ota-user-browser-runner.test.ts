import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runOtaUserBrowserReadonly, type ExtensionNavigateResult } from './ota-user-browser-runner.js';
import type { OtaAuditRecord } from './ota-user-browser-policy.js';

const silentLogger = { info: () => {}, warn: () => {} };

/** Anthropic stub: messages.create returns the queued text replies in order. */
function makeClient(textReplies: string[]): { client: Anthropic; calls: () => number } {
  let i = 0;
  const create = vi.fn(async () => ({
    content: [{ type: 'text', text: textReplies[i++] ?? '' }],
  }));
  return { client: { messages: { create } } as unknown as Anthropic, calls: () => create.mock.calls.length };
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

describe('runOtaUserBrowserReadonly — flights', () => {
  it('navigates the user browser, extracts a flight table, completes (未下单)', async () => {
    const { client } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha?depdate=2026-08-01&nonstop=1']);
    const dispatchNavigate = navOk({
      finalUrl: 'https://flights.ctrip.com/online/list/oneway-bjs-sha?depdate=2026-08-01&nonstop=1',
      title: '机票',
      bodyText: FLIGHT_BODY,
    });
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_f',
      intent: '打开携程查北京到上海的机票，不要下单，筛选直飞给最便宜的3个',
      deps: { client, dispatchNavigate, audit: (r) => audit.push(r), logger: silentLogger },
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('你的浏览器');
    expect(out.summary).toContain('春秋航空'); // cheapest
    expect(out.summary).toContain('未下单/未预订');
    expect(out.toolsUsed).toContain('navigate');
    // audit recorded an allowed navigate, never a click/type
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actionType: 'navigate', decision: 'allowed', lane: 'user-browser' });
  });

  it('flight results page with unreadable text → specific failure, not generic error', async () => {
    const { client } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha?nonstop=1']);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_f2',
      intent: '携程北京到上海机票直飞',
      deps: {
        client,
        dispatchNavigate: navOk({ finalUrl: 'https://flights.ctrip.com/online/list/oneway-bjs-sha?nonstop=1', title: '机票', bodyText: '加载中……航班信息以图形展示，暂无可解析文本占位占位占位占位占位占位占位占位占位占位' }),
        audit: () => {},
        logger: silentLogger,
      },
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toBe('已进入携程结果页，但未能稳定读取航班列表。');
  });
});

describe('runOtaUserBrowserReadonly — hotels', () => {
  it('extracts a hotel table from the logged-in page text via the model', async () => {
    const { client } = makeClient([
      'https://hotels.ctrip.com/hotels/list?city=上海&checkin=2026-08-01&checkout=2026-08-03&star=4,5',
      '| 酒店名 | 星级 | 价格(¥) | 评分 |\n| --- | --- | --- | --- |\n| 上海某酒店 | 4 | 680 | 4.7 |\n\n仅查询，未预订',
    ]);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_h',
      intent: '打开携程查上海酒店，不要预订，4星以上低于800给5个',
      deps: {
        client,
        dispatchNavigate: navOk({
          finalUrl: 'https://hotels.ctrip.com/hotels/list?city=上海&star=4,5',
          title: '酒店',
          bodyText: '上海酒店 4钻 ¥680起 评分4.7 某某酒店 ……'.repeat(20),
        }),
        audit: () => {},
        logger: silentLogger,
      },
    });
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('你的浏览器');
    expect(out.summary).toContain('| 酒店名 |');
    expect(out.summary).toContain('未预订');
  });

  it('hotel page still a login wall → awaiting_user (no fake completion)', async () => {
    const { client } = makeClient(['https://hotels.ctrip.com/hotels/list?city=上海&star=4,5']);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_h2',
      intent: '携程上海酒店4星以上',
      deps: {
        client,
        dispatchNavigate: navOk({ finalUrl: 'https://hotels.ctrip.com/hotels/list?city=上海', title: '登录', bodyText: '请登录后查看' }),
        audit: () => {},
        logger: silentLogger,
      },
    });
    expect(out.status).toBe('awaiting_user');
    expect(out.question).toContain('登录');
  });
});

describe('runOtaUserBrowserReadonly — safety', () => {
  it('blocks a pay/order URL from the model and never navigates', async () => {
    const { client } = makeClient(['https://hotels.ctrip.com/order/submit?id=123']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_block',
      intent: '携程酒店',
      deps: { client, dispatchNavigate, audit: (r) => audit.push(r), logger: silentLogger },
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/拒绝打开/);
    expect(dispatchNavigate).not.toHaveBeenCalled(); // never dispatched
    expect(audit[0]).toMatchObject({ decision: 'blocked', actionType: 'navigate' });
    expect(audit[0]!.reason).toMatch(/payment\/order url/);
  });

  it('blocks an off-whitelist URL from the model', async () => {
    const { client } = makeClient(['https://booking.com/hotels/shanghai']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_off',
      intent: '查酒店',
      deps: { client, dispatchNavigate, audit: () => {}, logger: silentLogger },
    });
    expect(out.status).toBe('failed');
    expect(dispatchNavigate).not.toHaveBeenCalled();
  });

  it('extension navigate failure → friendly failure (extension offline mid-run)', async () => {
    const { client } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha']);
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_nav',
      intent: '携程机票北京到上海',
      deps: {
        client,
        dispatchNavigate: vi.fn(async () => ({ ok: false, error: { message: '扩展无响应', code: 'no_extension' } })),
        audit: () => {},
        logger: silentLogger,
      },
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/无法在你的浏览器中打开/);
  });

  it('canary domain guard: blocks a non-canary OTA URL even if it is a valid OTA site', async () => {
    // allowedDomains = {ctrip.com}; model derives a qunar URL → blocked,
    // never dispatched (defence-in-depth beyond the lane decision).
    const { client } = makeClient(['https://flights.qunar.com/online/list/oneway?dep=BJS&arr=SHA']);
    const dispatchNavigate = vi.fn(async () => ({ ok: true, result: { finalUrl: '', title: '', bodyText: '' } }));
    const audit: OtaAuditRecord[] = [];
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_canary',
      intent: '查机票',
      deps: {
        client,
        dispatchNavigate,
        audit: (r) => audit.push(r),
        logger: silentLogger,
        allowedDomains: new Set(['ctrip.com']),
      },
    });
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/灰度范围/);
    expect(dispatchNavigate).not.toHaveBeenCalled();
    expect(audit.some((r) => r.decision === 'blocked' && /canary allowlist/.test(r.reason))).toBe(true);
  });

  it('the runner only ever dispatches navigate/screenshot — no click/type path exists', async () => {
    // Structural guarantee: the deps shape has no click/type dispatcher,
    // and the only browser call made is navigate (+ optional screenshot).
    const { client } = makeClient(['https://flights.ctrip.com/online/list/oneway-bjs-sha?nonstop=1']);
    const dispatchNavigate = navOk({ finalUrl: 'https://flights.ctrip.com/online/list/oneway-bjs-sha?nonstop=1', title: '机票', bodyText: FLIGHT_BODY });
    const dispatchScreenshot = vi.fn(async () => ({ ok: true }));
    const out = await runOtaUserBrowserReadonly({
      taskId: 'tsk_tools',
      intent: '携程北京到上海机票直飞',
      deps: { client, dispatchNavigate, dispatchScreenshot, audit: () => {}, logger: silentLogger },
    });
    expect(out.status).toBe('completed');
    expect(dispatchNavigate).toHaveBeenCalledTimes(1);
    expect(out.toolsUsed.sort()).toEqual(['navigate', 'screenshot']);
  });
});
