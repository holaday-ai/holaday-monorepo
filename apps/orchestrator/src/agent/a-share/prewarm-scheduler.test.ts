/**
 * Phase 1 #2 — 简报缓存预热调度单测.
 *
 * 锁住：北京时刻换算 + 命中 08:25/15:25 触发、其它时刻不触发、同分钟只发一次 +
 * warmSharedCaches 调 us/hk/cn 且单接口失败不抛。
 */

import { describe, expect, it, vi } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { beijingHm, startPrewarmScheduler, warmSharedCaches } from './prewarm-scheduler.js';

describe('beijingHm', () => {
  it('UTC → 北京 HH:MM（+8）', () => {
    expect(beijingHm(new Date('2026-06-12T00:25:00Z'))).toBe('08:25');
    expect(beijingHm(new Date('2026-06-12T07:25:00Z'))).toBe('15:25');
    expect(beijingHm(new Date('2026-06-12T03:00:00Z'))).toBe('11:00');
  });
});

describe('startPrewarmScheduler', () => {
  it('命中 08:25/15:25 触发预热；其它时刻不触发；同分钟只发一次', async () => {
    vi.useFakeTimers();
    try {
      let warmCount = 0;
      const warm = async () => {
        warmCount += 1;
      };
      const logger = { info: () => {}, warn: () => {} };
      let t = new Date('2026-06-12T00:24:30Z'); // 北京 08:24:30
      const stop = startPrewarmScheduler({ warm, logger, now: () => t, intervalMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000); // 08:24 → 不触发
      expect(warmCount).toBe(0);

      t = new Date('2026-06-12T00:25:10Z'); // 08:25 → 触发
      await vi.advanceTimersByTimeAsync(1000);
      expect(warmCount).toBe(1);

      t = new Date('2026-06-12T00:25:50Z'); // 同分钟 → 不重复
      await vi.advanceTimersByTimeAsync(1000);
      expect(warmCount).toBe(1);

      t = new Date('2026-06-12T00:26:10Z'); // 08:26 → 不触发
      await vi.advanceTimersByTimeAsync(1000);
      expect(warmCount).toBe(1);

      t = new Date('2026-06-12T07:25:05Z'); // 15:25 → 再触发
      await vi.advanceTimersByTimeAsync(1000);
      expect(warmCount).toBe(2);

      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('warmSharedCaches', () => {
  it('调 /index us·hk·cn 各一次，单接口失败不抛', async () => {
    const calls: string[] = [];
    const client = {
      getIndexQuote: (m: 'hk' | 'us' | 'cn') => {
        calls.push(m);
        return m === 'hk'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({ data: [], count: 0, source: 's', fetched_at: 'x', disclaimer: 'x' });
      },
    } as unknown as AkshareClient;
    await expect(warmSharedCaches(client)).resolves.toBeUndefined();
    expect([...calls].sort()).toEqual(['cn', 'hk', 'us']);
  });
});
