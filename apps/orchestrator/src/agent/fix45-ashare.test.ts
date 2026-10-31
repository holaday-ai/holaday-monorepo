import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './a-share/akshare-client.js';
import { buildAshareFactCard, quoteStale } from './a-share/ashare-fact-card.js';
import type { AkEnvelope } from './a-share/briefing-types.js';

const beijing = (at: string) => new Date(`${at}+08:00`);
const envelope = <T>(data: T[]): AkEnvelope<T> =>
  ({
    data,
    count: data.length,
    source: 'akshare:fake',
    fetched_at: '2026-10-28T07:45:00Z',
  }) as AkEnvelope<T>;
const timedOut = <T>(): AkEnvelope<T> =>
  ({
    data: [],
    count: 0,
    source: 'akshare',
    error: '取数失败/超时',
    error_code: 'UPSTREAM_TIMEOUT',
  }) as unknown as AkEnvelope<T>;

/**
 * DEPLOY-45 local A/B as-mt (15:45 Wednesday 10-28): /quote/600519 timed out twice; sina's daily
 * K-line still ended at 10-27 (1,355.90 +0.44%). The day's close was 1,330.75 −1.85%.
 */
function akshare(
  quote: AkEnvelope<unknown>,
  kline: AkEnvelope<unknown>,
  calendar: AkEnvelope<unknown> = envelope([{ is_trading_day: true }]),
): AkshareClient {
  return {
    getStockAnnouncements: () => Promise.resolve(envelope([])),
    getShareUnlock: () => Promise.resolve(envelope([])),
    getStockKline: () => Promise.resolve(kline),
    getStockQuote: () => Promise.resolve(quote),
    getDragonTiger: () => Promise.resolve(envelope([])),
    getNorthboundFlow: () => Promise.resolve(envelope([])),
    getTradingDay: () => Promise.resolve(calendar),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}
const MOUTAI = {
  kind: 'info' as const,
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-10-28',
  dateCompact: '20261028',
};
const KLINE_1027 = envelope([
  { 日期: '2026-10-27', 收盘: 1355.9, 涨跌幅: 0.44, 成交额: 5_227_000_000 },
]);

describe('FIX-45 #3 · as-mt after the close: a close that was not fetched is said so', () => {
  it('replay (quote timed out, K-line at 10-27): 10-27 is labelled not today, delivered as 部分完成', async () => {
    const md = await buildAshareFactCard(
      { client: akshare(timedOut(), KLINE_1027), now: beijing('2026-10-28T15:45:00') },
      MOUTAI,
    );
    expect(md).toContain('- 以下为 10 月 27 日收盘价，今日收盘价暂未取到（行情源未返回当天数据）');
    expect(md).toContain('- 最近收盘（2026-10-27） 1,355.90');
    expect(quoteStale(md)).toBe(true);
  });

  it('reverse: the 15:00 quote came back — it is the day’s close, not partial', async () => {
    const md = await buildAshareFactCard(
      {
        client: akshare(
          envelope([
            { 代码: '600519', 最新价: 1330.75, 涨跌幅: -1.85, 行情时间: '2026-10-28 15:00:00' },
          ]),
          KLINE_1027,
        ),
        now: beijing('2026-10-28T15:45:00'),
      },
      MOUTAI,
    );
    expect(md).toContain('- 最近收盘（2026-10-28 15:00） 1,330.75，涨跌幅 -1.85%（收盘后报价');
    expect(quoteStale(md)).toBe(false);
  });

  it('reverse: the K-line already has today — that is the close, no note', async () => {
    const md = await buildAshareFactCard(
      {
        client: akshare(
          timedOut(),
          envelope([{ 日期: '2026-10-28', 收盘: 1330.75, 涨跌幅: -1.85, 成交额: 5_187_000_000 }]),
        ),
        now: beijing('2026-10-28T18:51:00'),
      },
      MOUTAI,
    );
    expect(md).toContain('- 最近收盘（2026-10-28） 1,330.75');
    expect(quoteStale(md)).toBe(false);
  });

  it('reverse: a weekend evening asks no quote and adds no note', async () => {
    const md = await buildAshareFactCard(
      { client: akshare(timedOut(), KLINE_1027), now: beijing('2026-10-31T16:00:00') },
      { ...MOUTAI, dateIso: '2026-10-31', dateCompact: '20261031' },
    );
    expect(md).toContain('- 最近收盘（2026-10-27） 1,355.90');
    expect(quoteStale(md)).toBe(false);
  });
});

describe('DEPLOY-46 复审 #4 · the not-fetched note only when the calendar confirms a trading day', () => {
  it('calendar unavailable (a weekday holiday cannot be ruled out): no note, not partial', async () => {
    const md = await buildAshareFactCard(
      { client: akshare(timedOut(), KLINE_1027, timedOut()), now: beijing('2026-10-28T15:45:00') },
      MOUTAI,
    );
    expect(md).not.toContain('今日收盘价暂未取到');
    expect(md).toContain('- 最近收盘（2026-10-27） 1,355.90');
    expect(quoteStale(md)).toBe(false);
  });
  it('reverse: the calendar says holiday — no quote asked, no note', async () => {
    const md = await buildAshareFactCard(
      {
        client: akshare(timedOut(), KLINE_1027, envelope([{ is_trading_day: false }])),
        now: beijing('2026-10-28T15:45:00'),
      },
      MOUTAI,
    );
    expect(md).not.toContain('今日收盘价暂未取到');
  });
});
