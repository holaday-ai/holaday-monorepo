import { describe, expect, it, vi } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { taskTradingCalendar } from './trading-calendar.js';

/** FIX-36 复审 #1 #7. */
describe('taskTradingCalendar', () => {
  const client = () =>
    ({
      getTradingDay: vi.fn(async (iso: string) => ({
        data: [{ is_trading_day: iso !== '2026-10-25' }],
      })),
    }) as unknown as AkshareClient;

  it('builds one client for the whole task', async () => {
    const make = vi.fn(() => client());
    const logger = { warn: vi.fn() };
    const calendar = taskTradingCalendar(logger, { AKSHARE_HTTP_URL: 'http://ak.test' }, make);
    expect(await calendar('2026-10-25')).toBe(false);
    expect(await calendar('2026-10-26')).toBe(true);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith('http://ak.test');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('says so, once, when AKSHARE_HTTP_URL is unset and it falls back to 127.0.0.1', async () => {
    const make = vi.fn(() => client());
    const logger = { warn: vi.fn() };
    const calendar = taskTradingCalendar(logger, {}, make);
    await calendar('2026-10-25');
    await calendar('2026-10-26');
    expect(make).toHaveBeenCalledWith('http://127.0.0.1:8848');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ code: 'AKSHARE_URL_DEFAULT' });
  });
});
