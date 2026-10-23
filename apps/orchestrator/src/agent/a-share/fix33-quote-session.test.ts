/**
 * FIX-33 #3 (Deploy-33 as-mt): 14:20 intraday 「贵州茅台今天股价多少」 got 10/22's close
 * (1318.49) under a 10/23 header; the live price was 1332.27. Simulated clocks below.
 */
import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import {
  ashareIntraday,
  buildAshareFactCard,
  buildFactContext,
  buildIndexCard,
  fetchFactData,
  quoteStale,
} from './ashare-fact-card.js';
import { runAsharePanorama, runAshareQa } from './ashare-qa-runner.js';
import type { AkEnvelope } from './briefing-types.js';

const at = (beijing: string) => new Date(`${beijing}+08:00`);
const INTRADAY = at('2026-10-23T14:20:00');
const LUNCH = at('2026-10-23T12:10:00');
const AFTER_CLOSE = at('2026-10-23T15:20:00');
const PRE_OPEN = at('2026-10-23T09:00:00');
const SATURDAY = at('2026-10-24T11:00:00');

function env<T>(data: T[], extra: Partial<AkEnvelope<T>> = {}): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source: 'akshare:fake',
    fetched_at: '2026-10-23T06:20:05Z',
    ...extra,
  } as AkEnvelope<T>;
}

function client(opts: {
  klineDate: string;
  quote?: AkEnvelope<Record<string, unknown>>;
  calls?: string[];
}): AkshareClient {
  return {
    getStockAnnouncements: () => Promise.resolve(env([])),
    getShareUnlock: () => Promise.resolve(env([])),
    getStockKline: () =>
      Promise.resolve(
        env([{ 日期: opts.klineDate, 收盘: 1318.49, 涨跌幅: 0.67, 成交额: 5_576_000_000 }]),
      ),
    getStockQuote: () => {
      opts.calls?.push('quote');
      return Promise.resolve(opts.quote ?? env([]));
    },
    getDragonTiger: () => Promise.resolve(env([])),
    getNorthboundFlow: () => Promise.resolve(env([])),
    getStockNews: () => Promise.resolve(env([])),
    getFundamentals: () => Promise.resolve(env([])),
    getValuation: () => Promise.resolve(env([])),
    getTradingDay: () => Promise.resolve(env([{ is_trading_day: true }])),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}

const MATCH = {
  kind: 'info' as const,
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-10-23',
  dateCompact: '20261023',
};
const LIVE = env([
  { 代码: '600519', 最新价: 1332.27, 涨跌幅: 1.05, 行情时间: '2026-10-23 14:19:58' },
]);
const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe('FIX-33 #3 · an A-share price always says when it is from', () => {
  it('trading hours are weekdays 9:30–15:00 Beijing (lunch included)', () => {
    expect(ashareIntraday(INTRADAY)).toBe(true);
    expect(ashareIntraday(LUNCH)).toBe(true);
    expect(ashareIntraday(AFTER_CLOSE)).toBe(false);
    expect(ashareIntraday(PRE_OPEN)).toBe(false);
    expect(ashareIntraday(SATURDAY)).toBe(false);
  });

  it('as-mt intraday: the live quote with its time comes first, the close is dated', async () => {
    const calls: string[] = [];
    const md = await buildAshareFactCard(
      { client: client({ klineDate: '2026-10-22', quote: LIVE, calls }), now: INTRADAY },
      MATCH,
    );
    expect(calls).toEqual(['quote']);
    expect(md).toContain('- 最新价 1,332.27，涨跌幅 +1.05%；行情时间 2026-10-23 14:19:58');
    expect(md).toContain('- 最近收盘（2026-10-22） 1,318.49');
    expect(md).not.toMatch(/- 收盘 1,318.49/);
    expect(quoteStale(md)).toBe(false);
  });

  it('intraday without a live quote: 「以下为 10 月 22 日收盘价，非实时」 and partial', async () => {
    for (const quote of [
      env([]),
      env([], { error: 'timeout' }),
      // Yesterday's quote is not today's price.
      env([{ 代码: '600519', 最新价: 1318.49, 涨跌幅: 0.67, 行情时间: '2026-10-22 15:00:00' }]),
    ]) {
      const md = await buildAshareFactCard(
        { client: client({ klineDate: '2026-10-22', quote }), now: INTRADAY },
        MATCH,
      );
      expect(md).toContain('- 以下为 10 月 22 日收盘价，非实时（未取到今日实时行情）');
      expect(md).toContain('- 最近收盘（2026-10-22） 1,318.49');
      expect(md).not.toContain('最新价');
      expect(quoteStale(md)).toBe(true);
    }
  });

  it('a time-only snapshot taken today counts as live, dated with today', async () => {
    const quote = env([{ 代码: '600519', 最新价: 1332.27, 涨跌幅: 1.05, 行情时间: '14:19:58' }]);
    const md = await buildAshareFactCard(
      { client: client({ klineDate: '2026-10-22', quote }), now: INTRADAY },
      MATCH,
    );
    expect(md).toContain('行情时间 2026-10-23 14:19');
    expect(quoteStale(md)).toBe(false);
  });

  it('after the close: no quote call, 「最近收盘（日期）」, not partial', async () => {
    for (const [now, day] of [
      [AFTER_CLOSE, '2026-10-23'],
      [PRE_OPEN, '2026-10-22'],
      [SATURDAY, '2026-10-23'],
    ] as const) {
      const calls: string[] = [];
      const md = await buildAshareFactCard(
        { client: client({ klineDate: day, quote: LIVE, calls }), now },
        MATCH,
      );
      expect(calls).toEqual([]);
      expect(md).toContain(`- 最近收盘（${day}） 1,318.49`);
      expect(md).not.toContain('非实时');
      expect(quoteStale(md)).toBe(false);
    }
  });

  it('a kline row dated today during trading hours is not called a close', async () => {
    const md = await buildAshareFactCard(
      { client: client({ klineDate: '2026-10-23', quote: LIVE }), now: INTRADAY },
      MATCH,
    );
    expect(md).toContain('- 今日盘中（2026-10-23，未收盘，非最终收盘价）');
    expect(md).not.toContain('最近收盘');
  });

  it('the interpretation context dates the close and carries the live quote', async () => {
    const data = await fetchFactData(client({ klineDate: '2026-10-22', quote: LIVE }), MATCH, {
      now: INTRADAY,
    });
    const ctx = buildFactContext(data, MATCH);
    expect(ctx).toContain('最近收盘（2026-10-22） 1,318.49');
    expect(ctx).toContain('实时报价：最新价 1,332.27');
  });

  it('runner and panorama: stale intraday answers say so; live ones do not', async () => {
    const deps = (quote: AkEnvelope<Record<string, unknown>>) => ({
      client: client({ klineDate: '2026-10-22', quote }),
      now: INTRADAY,
      logger,
      interpret: async () => ({ text: '' }),
    });
    // biome-ignore lint/suspicious/noExplicitAny: fake deps
    const qa = await runAshareQa(deps(env([])) as any, MATCH);
    expect(quoteStale(qa.answer)).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: fake deps
    const pano = await runAsharePanorama(deps(env([])) as any, { ...MATCH, deep: true } as never);
    expect(quoteStale(pano.answer)).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: fake deps
    const live = await runAsharePanorama(deps(LIVE) as any, { ...MATCH, deep: true } as never);
    expect(quoteStale(live.answer)).toBe(false);
    expect(live.answer).toContain('行情时间 2026-10-23 14:19:58');
    expect(live.answer).toContain('最近收盘（2026-10-22）');
  });

  it('the index card says when its prices are from', async () => {
    const quote = env([{ 名称: '上证指数', 最新价: 3301.2, 涨跌幅: 0.4 }]);
    const live = await buildIndexCard({ client: client({ klineDate: '' }), now: INTRADAY, quote });
    expect(live).toContain('- 行情时间：抓取于 2026-10-23 14:20（盘中实时，未收盘）');
    const closed = await buildIndexCard({
      client: client({ klineDate: '' }),
      now: SATURDAY,
      quote: { ...quote, fetched_at: '2026-10-24T03:00:00Z' },
    });
    expect(closed).toContain('非交易时段，为最近一个交易日收盘后的行情');
  });

  it('an intraday quote must be fresh: hours old is not real-time; lunch counts from 11:30', async () => {
    const at1130 = env([
      { 代码: '600519', 最新价: 1330, 涨跌幅: 0.9, 行情时间: '2026-10-23 11:30:00' },
    ]);
    const card = (quote: AkEnvelope<Record<string, unknown>>, now: Date) =>
      buildAshareFactCard({ client: client({ klineDate: '2026-10-22', quote }), now }, MATCH);
    expect(quoteStale(await card(at1130, INTRADAY))).toBe(true);
    expect(quoteStale(await card(at1130, LUNCH))).toBe(false);
    const at1412 = env([
      { 代码: '600519', 最新价: 1331, 涨跌幅: 1, 行情时间: '2026-10-23 14:12:00' },
    ]);
    expect(quoteStale(await card(at1412, INTRADAY))).toBe(false);
  });
});
