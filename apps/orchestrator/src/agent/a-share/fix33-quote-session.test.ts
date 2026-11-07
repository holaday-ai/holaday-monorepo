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
  buildPanoramaContext,
  fetchFactData,
  fetchPanoramaData,
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
  /** Trading calendar answer: true/false, null = calendar unavailable. */
  tradingDay?: boolean | null;
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
    getTradingDay: () =>
      Promise.resolve(
        opts.tradingDay === undefined
          ? env([{ is_trading_day: true }])
          : opts.tradingDay === null
            ? env([], { error: 'unavailable' })
            : env([{ is_trading_day: opts.tradingDay }]),
      ),
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

  it('outside trading hours: 「最近收盘（日期）」, not partial', async () => {
    // FIX-38: a trading day's evening asks once for the 15:00 quote (a 14:19 one is not a close);
    // before the open and at weekends there is no quote to ask for.
    for (const [now, day, quoted] of [
      [AFTER_CLOSE, '2026-10-23', ['quote']],
      [PRE_OPEN, '2026-10-22', []],
      [SATURDAY, '2026-10-23', []],
    ] as const) {
      const calls: string[] = [];
      const md = await buildAshareFactCard(
        { client: client({ klineDate: day, quote: LIVE, calls }), now },
        MATCH,
      );
      expect(calls).toEqual(quoted);
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
    const ctx = buildFactContext(data, MATCH, undefined, INTRADAY);
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

  it('the interpretation context leaves out a quote the card does not show as live', async () => {
    const at1130 = env([
      { 代码: '600519', 最新价: 1330, 涨跌幅: 0.9, 行情时间: '2026-10-23 11:30:00' },
    ]);
    const data = await fetchFactData(client({ klineDate: '2026-10-22', quote: at1130 }), MATCH, {
      now: INTRADAY,
    });
    const ctx = buildFactContext(data, MATCH, undefined, INTRADAY);
    // 复审 1: an old quote is 「最近报价」 with its time — never 实时 / 当前价.
    expect(ctx).toContain('最近报价：1,330.00（报价时间 2026-10-23 11:30:00');
    expect(ctx).not.toMatch(/实时|当前价/);
    expect(buildFactContext(data, MATCH)).not.toContain('实时报价');
  });

  it("a time-only snapshot ahead of the trading clock (yesterday's 15:00 at 9:35) is not live", async () => {
    const early = at('2026-10-23T09:35:00');
    const quote = env([{ 代码: '600519', 最新价: 1318.49, 涨跌幅: 0.67, 行情时间: '15:00:00' }], {
      fetched_at: '2026-10-23T01:35:02Z',
    });
    const md = await buildAshareFactCard(
      { client: client({ klineDate: '2026-10-22', quote }), now: early },
      MATCH,
    );
    expect(md).toContain('以下为 10 月 22 日收盘价，非实时');
    expect(quoteStale(md)).toBe(true);
  });

  // 复审 3: 国庆 (2026-10-01, a Thursday) is not a trading session.
  const NATIONAL_DAY_NOON = at('2026-10-01T12:10:00');
  it('National Day noon: no quote, 「最近收盘（日期）」, not partial', async () => {
    const calls: string[] = [];
    const md = await buildAshareFactCard(
      {
        client: client({ klineDate: '2026-09-30', quote: LIVE, calls, tradingDay: false }),
        now: NATIONAL_DAY_NOON,
      },
      { ...MATCH, dateIso: '2026-10-01', dateCompact: '20261001' },
    );
    expect(calls).toEqual([]);
    expect(md).toContain('- 最近收盘（2026-09-30） 1,318.49');
    expect(md).not.toMatch(/非实时|盘中/);
    expect(quoteStale(md)).toBe(false);
  });
  it('index card on National Day noon never says 盘中实时; an unknown calendar says 最近报价', async () => {
    const quote = env([{ 名称: '上证指数', 最新价: 3301.2, 涨跌幅: 0.4 }], {
      fetched_at: '2026-10-01T04:10:00Z',
    });
    const holiday = await buildIndexCard({
      client: client({ klineDate: '', tradingDay: false }),
      now: NATIONAL_DAY_NOON,
      quote,
    });
    expect(holiday).not.toContain('盘中实时');
    expect(holiday).toContain('非交易时段，为最近一个交易日收盘后的行情');
    const unknown = await buildIndexCard({
      client: client({ klineDate: '', tradingDay: null }),
      now: NATIONAL_DAY_NOON,
      quote,
    });
    expect(unknown).not.toContain('盘中实时');
    expect(unknown).toContain('- 最近报价（抓取于 2026-10-01 12:10；未能确认今天是否交易日）');
  });
  it('the light card with an unavailable calendar stays conservative (non-real-time, partial)', async () => {
    const md = await buildAshareFactCard(
      {
        client: client({ klineDate: '2026-10-22', quote: env([]), tradingDay: null }),
        now: INTRADAY,
      },
      MATCH,
    );
    expect(quoteStale(md)).toBe(true);
  });

  it('the panorama model input labels an old intraday quote 最近报价, never 实时/当前价', async () => {
    const at1130 = env([
      { 代码: '600519', 最新价: 1330, 涨跌幅: 0.9, 行情时间: '2026-10-23 11:30:00' },
    ]);
    const c = client({ klineDate: '2026-10-22', quote: at1130 });
    const data = await fetchPanoramaData(c, MATCH, INTRADAY);
    const ctx = buildPanoramaContext(data, MATCH, INTRADAY);
    expect(ctx).toContain('最近报价：1,330.00（报价时间 2026-10-23 11:30:00');
    expect(ctx).not.toMatch(/实时|当前价|最新价 1,330/);
  });
});
