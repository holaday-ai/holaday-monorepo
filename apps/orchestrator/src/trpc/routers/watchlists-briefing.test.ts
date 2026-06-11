/**
 * §6c — watchlistsRouter 每日简报 opt-in 单测（fake db，不连 MySQL）.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  POSTMARKET_BRIEFING_INTENT,
  PREMARKET_BRIEFING_INTENT,
} from '../../agent/a-share/briefing-dispatch.js';
import { watchlistsRouter } from './watchlists.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeCtx(opts: { sched?: Array<{ id: number }>; userKnown?: boolean } = {}) {
  const sched = opts.sched ?? [];
  const userKnown = opts.userKnown ?? true;
  const inserts: Array<Record<string, unknown>> = [];
  const deletes: boolean[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: () => ({
      from: (table: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tName = (table as any)?.[Symbol.for('drizzle:Name')] ?? '';
        return {
          where: () => {
            // requireUserId 用 .limit(1)；briefingStatus 直接 await .where()。
            // 用真 Promise（非对象字面量），规避 biome noThenProperty。
            const statusRows = tName === 'scheduled_tasks' ? sched : [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p: any = Promise.resolve(statusRows);
            p.limit = () =>
              Promise.resolve(tName === 'users' ? (userKnown ? [{ id: 42 }] : []) : statusRows);
            return p;
          },
        };
      },
    }),
    insert: () => ({
      values: async (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(v) ? v : [v];
        inserts.push(...arr);
        return { affectedRows: arr.length };
      },
    }),
    delete: () => ({
      where: async () => {
        deletes.push(true);
        return { affectedRows: sched.length };
      },
    }),
  };
  return { ctx: { db, userId: 'usr_test', logger: fakeLogger }, inserts, deletes };
}

describe('watchlistsRouter — 每日简报 opt-in', () => {
  it('enableDailyBriefing 先清旧再建两条(盘前00:30 / 盘后07:30 UTC, daily, SH)', async () => {
    const { ctx, inserts, deletes } = makeCtx();
    const r = await watchlistsRouter.createCaller(ctx as never).enableDailyBriefing();
    expect(r).toEqual({ ok: true, enabled: true });
    expect(deletes).toHaveLength(1); // 幂等：先 cancel
    expect(inserts).toHaveLength(2);
    const byIntent = Object.fromEntries(inserts.map((x) => [x.intent, x]));
    const pre = byIntent[PREMARKET_BRIEFING_INTENT];
    const post = byIntent[POSTMARKET_BRIEFING_INTENT];
    expect(pre).toBeTruthy();
    expect(post).toBeTruthy();
    // 中国无 DST：08:30 SH = 00:30 UTC，15:30 SH = 07:30 UTC
    expect((pre?.nextRunAt as Date).getUTCHours()).toBe(0);
    expect((pre?.nextRunAt as Date).getUTCMinutes()).toBe(30);
    expect((post?.nextRunAt as Date).getUTCHours()).toBe(7);
    expect((post?.nextRunAt as Date).getUTCMinutes()).toBe(30);
    expect(pre?.repeatType).toBe('daily');
    expect(pre?.timezone).toBe('Asia/Shanghai');
  });

  it('disableDailyBriefing 删该用户简报定时', async () => {
    const { ctx, deletes } = makeCtx({ sched: [{ id: 1 }, { id: 2 }] });
    const r = await watchlistsRouter.createCaller(ctx as never).disableDailyBriefing();
    expect(r).toEqual({ ok: true, enabled: false });
    expect(deletes).toHaveLength(1);
  });

  it('briefingStatus 反映开启状态', async () => {
    const on = makeCtx({ sched: [{ id: 1 }, { id: 2 }] });
    expect(await watchlistsRouter.createCaller(on.ctx as never).briefingStatus()).toEqual({
      enabled: true,
    });
    const off = makeCtx({ sched: [] });
    expect(await watchlistsRouter.createCaller(off.ctx as never).briefingStatus()).toEqual({
      enabled: false,
    });
  });
});
