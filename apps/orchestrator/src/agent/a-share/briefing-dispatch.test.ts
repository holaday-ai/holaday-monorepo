/**
 * §6c — briefing-dispatch 单测（fake notify + Stub client + fake db）.
 */

import { describe, expect, it } from 'vitest';
import type { NotifyInput } from '../../notifications/notification-service.js';
import { StubAkshareClient } from './akshare-client.js';
import {
  POSTMARKET_BRIEFING_INTENT,
  PREMARKET_BRIEFING_INTENT,
  isBriefingIntent,
  runBriefingDispatch,
} from './briefing-dispatch.js';
import type { BriefingServiceDeps } from './briefing-service.js';

const WL = [{ symbol: '600519', market: 'A', displayName: '贵州茅台' }];
const NOW = new Date('2026-06-11T01:00:00Z');

function fakeDb(rows: typeof WL): BriefingServiceDeps['db'] {
  return {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as BriefingServiceDeps['db'];
}

function harness() {
  const calls: NotifyInput[] = [];
  const deps = {
    db: fakeDb(WL),
    client: new StubAkshareClient(),
    notify: async (i: NotifyInput) => {
      calls.push(i);
    },
    now: NOW,
  };
  return { deps, calls };
}

describe('isBriefingIntent', () => {
  it('识别简报哨兵，普通 intent 不命中', () => {
    expect(isBriefingIntent(PREMARKET_BRIEFING_INTENT)).toBe(true);
    expect(isBriefingIntent(POSTMARKET_BRIEFING_INTENT)).toBe(true);
    expect(isBriefingIntent('查一下茅台今天为什么跌')).toBe(false);
  });
});

describe('runBriefingDispatch', () => {
  it('盘前 intent → 组装 + notify(标题/类型/正文)', async () => {
    const { deps, calls } = harness();
    const r = await runBriefingDispatch(deps, {
      scheduledTaskInternalId: 7,
      userInternalId: 42,
      intent: PREMARKET_BRIEFING_INTENT,
    });
    expect(r).toEqual({ handled: true, ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userInternalId: 42,
      type: 'task_complete',
      title: 'A股盘前简报',
      scheduledTaskInternalId: 7,
    });
    expect(calls[0]?.message).toContain('A股盘前简报');
    expect(calls[0]?.message).toContain('贵州茅台（600519）');
  });

  it('盘后 intent → 标题 A股盘后复盘', async () => {
    const { deps, calls } = harness();
    await runBriefingDispatch(deps, {
      scheduledTaskInternalId: 8,
      userInternalId: 42,
      intent: POSTMARKET_BRIEFING_INTENT,
    });
    expect(calls[0]?.title).toBe('A股盘后复盘');
    expect(calls[0]?.message).toContain('A股盘后复盘');
  });

  it('非简报 intent → handled:false，不 notify', async () => {
    const { deps, calls } = harness();
    const r = await runBriefingDispatch(deps, {
      scheduledTaskInternalId: 9,
      userInternalId: 42,
      intent: '帮我查询茅台股价',
    });
    expect(r).toEqual({ handled: false, ok: false });
    expect(calls).toHaveLength(0);
  });

  it('Stub client(传输未接) → 仍出简报骨架(数据暂不可用)，不崩', async () => {
    const { deps, calls } = harness();
    await runBriefingDispatch(deps, {
      scheduledTaskInternalId: 7,
      userInternalId: 42,
      intent: PREMARKET_BRIEFING_INTENT,
    });
    expect(calls[0]?.message).toContain('数据暂不可用');
    expect(calls[0]?.message).toContain('不构成任何投资建议');
  });

  it('非交易日(周末) → skip 不投递，返回 skipped+reason（P1）', async () => {
    const { deps, calls } = harness();
    // 2026-06-13 周六；StubClient.getTradingDay 返 error → 退周末兜底 → 非交易日。
    const r = await runBriefingDispatch(
      { ...deps, now: new Date('2026-06-13T01:00:00Z') },
      { scheduledTaskInternalId: 7, userInternalId: 42, intent: PREMARKET_BRIEFING_INTENT },
    );
    expect(r).toMatchObject({ handled: true, ok: true, skipped: true });
    expect(r.reason).toContain('非交易日');
    expect(calls).toHaveLength(0);
  });
});
