/**
 * FIX-34 #1 (Deploy-34 as-mt): the ★走势 line said 「当前价格处在近一年区间的中部」 — intraday
 * without a live quote that rests on yesterday's close. Every price now says which one it is.
 */
import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { buildIndexCard } from './ashare-fact-card.js';
import { complianceGate } from './ashare-qa-gate.js';
import { runAsharePanorama, runAshareQa } from './ashare-qa-runner.js';
import type { AkEnvelope } from './briefing-types.js';
import { detectAllPerf, detectF1, detectF3 } from './perf-trend-engine.js';

const at = (beijing: string) => new Date(`${beijing}+08:00`);
const INTRADAY = at('2026-10-26T10:20:00');
const AFTER_CLOSE = at('2026-10-23T23:24:00');
const HOLIDAY = at('2026-10-01T12:10:00');

function env<T>(data: T[], extra: Partial<AkEnvelope<T>> = {}): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source: 'akshare:fake',
    fetched_at: '2026-10-26T02:20:00Z',
    ...extra,
  } as AkEnvelope<T>;
}
/** 250 trading days, closes 1000..1500 then the last close 1335 on 2026-10-23. */
function series(lastDate = '2026-10-23') {
  const rows = Array.from({ length: 249 }, (_, i) => ({
    日期: `2025-${String(1 + Math.floor(i / 22)).padStart(2, '0')}-${String(1 + (i % 22)).padStart(2, '0')}`,
    收盘: 1000 + (i % 50) * 10,
    成交量: 1000,
  }));
  rows.push({ 日期: lastDate, 收盘: 1335, 成交量: 1000 });
  return rows;
}

describe('FIX-34 #1 · 走势 says which price it uses', () => {
  it('after the close / no live quote: 最近收盘价 with its date, never 当前', () => {
    const f3 = detectF3(series());
    expect(f3?.finding).toMatch(/^最近收盘价 1,335\.00（2026-10-23）位于近一年区间的 \d+%，/);
    expect(`${f3?.finding}${f3?.measure}`).not.toMatch(/当前|现价|实时/);
    expect(detectF1(series())?.finding).toContain('（截至 2026-10-23 收盘）');
  });
  it('intraday with a live quote: 当前价 with its time, position from the live price', () => {
    const f3 = detectF3(series(), { price: 1500, time: '2026-10-26 10:19:58' });
    expect(f3?.finding).toBe(
      '当前价 1,500.00（行情时间 2026-10-26 10:19:58）位于近一年区间的 100%，接近近一年高位区间，处于相对高位。',
    );
  });
  it('detectAllPerf passes the live price only when given', () => {
    const withLive = detectAllPerf({
      series: series(),
      live: { price: 1000, time: '2026-10-26 10:19' },
    });
    expect(withLive.find((s) => s.key === 'position')?.finding).toMatch(/^当前价 1,000\.00/);
    expect(detectAllPerf({ series: series() }).find((s) => s.key === 'position')?.finding).toMatch(
      /^最近收盘价/,
    );
  });

  function client(opts: {
    quote?: AkEnvelope<Record<string, unknown>>;
    tradingDay?: boolean;
  }): AkshareClient {
    return {
      getStockAnnouncements: () => Promise.resolve(env([])),
      getShareUnlock: () => Promise.resolve(env([])),
      getStockKline: () => Promise.resolve(env(series())),
      getStockQuote: () => Promise.resolve(opts.quote ?? env([])),
      getDragonTiger: () => Promise.resolve(env([])),
      getNorthboundFlow: () => Promise.resolve(env([])),
      getStockNews: () => Promise.resolve(env([])),
      getFundamentals: () => Promise.resolve(env([])),
      getValuation: () => Promise.resolve(env([])),
      getTradingDay: () => Promise.resolve(env([{ is_trading_day: opts.tradingDay ?? true }])),
      // biome-ignore lint/suspicious/noExplicitAny: fake
    } as any;
  }
  const MATCH = {
    kind: 'info' as const,
    stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
    dateIso: '2026-10-26',
    dateCompact: '20261026',
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const run = (
    now: Date,
    quote?: AkEnvelope<Record<string, unknown>>,
    tradingDay?: boolean,
    deep = false,
  ) =>
    (deep ? runAsharePanorama : runAshareQa)(
      {
        client: client({ quote, tradingDay }),
        now,
        logger,
        perfTrend: true,
        interpret: async () => '',
      } as never,
      (deep ? { ...MATCH, deep: true } : MATCH) as never,
    );
  const position = (answer: string) => answer.split('\n').find((l) => l.includes('区间位置')) ?? '';
  const LIVE = env([
    { 代码: '600519', 最新价: 1340.5, 涨跌幅: 0.4, 行情时间: '2026-10-26 10:19:58' },
  ]);
  const OLD = env([{ 代码: '600519', 最新价: 1330, 涨跌幅: 0.1, 行情时间: '2026-10-26 09:40:00' }]);

  it.each([
    [
      'intraday, live quote',
      INTRADAY,
      LIVE,
      true,
      /当前价 1,340\.50（行情时间 2026-10-26 10:19:58）/,
    ],
    ['intraday, stale quote', INTRADAY, OLD, true, /最近收盘价 1,335\.00（2026-10-23）/],
    ['after the close', AFTER_CLOSE, undefined, true, /最近收盘价 1,335\.00（2026-10-23）/],
    ['holiday noon', HOLIDAY, LIVE, false, /最近收盘价 1,335\.00（2026-10-23）/],
  ] as const)('light and panorama cards, %s', async (_label, now, quote, tradingDay, expected) => {
    for (const deep of [false, true]) {
      const answer = (await run(now, quote, tradingDay, deep)).answer;
      expect(position(answer)).toMatch(expected);
      if (!/当前价 1,340/.test(position(answer)))
        expect(position(answer)).not.toMatch(/当前|现价|实时/);
    }
  });

  it('after the close a same-day morning quote never replaces the close (Codex review #297)', async () => {
    const EVENING = at('2026-10-26T20:30:00');
    const morning = env([
      { 代码: '600519', 最新价: 1100, 涨跌幅: -3, 行情时间: '2026-10-26 10:19:58' },
    ]);
    for (const deep of [false, true]) {
      const line = position((await run(EVENING, morning, true, deep)).answer);
      expect(line).toMatch(/最近收盘价 1,335\.00（2026-10-23）/);
      expect(line).not.toMatch(/当前价|1,100/);
    }
  });

  // 协调方复审阻塞 1：盘外没有「实时」。收盘后同日上午的缓存报价不进卡片、不进模型输入；
  // 15:00 以后、带日期的报价才算今天的收盘价。
  const panoramaAt = async (now: Date, quote: AkEnvelope<Record<string, unknown>>) => {
    const seen: string[] = [];
    const out = await runAsharePanorama(
      {
        client: client({ quote, tradingDay: true }),
        now,
        logger,
        perfTrend: true,
        interpret: async (...args: unknown[]) => {
          seen.push(String((args[0] as { user?: string })?.user ?? JSON.stringify(args)));
          return '';
        },
      } as never,
      { ...MATCH, deep: true } as never,
    );
    return { answer: out.answer, input: seen.join('\n') };
  };
  it('evening: a cached 10:19 quote is not 实时/最新价/当前价 anywhere, card or model input', async () => {
    const morning = env([
      { 代码: '600519', 最新价: 1100, 涨跌幅: -3, 行情时间: '2026-10-26 10:19:58' },
    ]);
    const { answer, input } = await panoramaAt(at('2026-10-26T20:30:00'), morning);
    expect(answer).not.toMatch(/实时报价|最新价 1,100|当前价/);
    expect(answer).toContain('最近收盘（2026-10-23） 1,335.00');
    expect(input).not.toMatch(/实时报价|1,100/);
    expect(input).not.toMatch(/收盘价（2026-10-26）/);
  });
  it('evening: a dated quote from 15:00 is today’s close', async () => {
    const closed = env([
      { 代码: '600519', 最新价: 1342, 涨跌幅: 0.52, 行情时间: '2026-10-26 15:00:03' },
    ]);
    const { answer, input } = await panoramaAt(at('2026-10-26T20:30:00'), closed);
    expect(answer).toContain('最近收盘（2026-10-26） 1,342.00');
    expect(answer).not.toMatch(/实时报价|当前价/);
    expect(input).toContain('收盘价（2026-10-26）');
  });
  it('a time-only 15:00 snapshot fetched on a holiday is not a close of that day', async () => {
    const snapshot = {
      ...env([{ 代码: '600519', 最新价: 1342, 涨跌幅: 0.52, 行情时间: '15:00:03' }]),
      fetched_at: '2026-10-01T04:00:00Z',
    };
    const { answer } = await panoramaAt(HOLIDAY, snapshot);
    expect(answer).not.toContain('最近收盘（2026-10-01）');
  });

  it('an interpretation calling the close 「当前股价」 is dropped unless a live quote is in context', () => {
    const closeOnly = '- 盘面：最近收盘（2026-10-23） 1,335.00 涨跌幅 +1.25%';
    expect(complianceGate('当前股价 1,335.00 处在年内中部。', closeOnly)).toMatchObject({
      passed: false,
      subReason: 'stale_price',
    });
    expect(
      complianceGate(
        '当前股价 1,340.50 较前收略高。',
        `${closeOnly}\n- 实时报价：最新价 1,340.50 涨跌幅 +0.40%（行情时间 2026-10-26 10:19:58）`,
      ).passed,
    ).toBe(true);
    expect(complianceGate('最近收盘 1,335.00，处在年内中部。', closeOnly).passed).toBe(true);
  });
});

describe('FIX-34 #1 · the index card calls only a fresh snapshot 盘中实时', () => {
  const indexClient = () =>
    ({
      getTradingDay: async () => ({
        data: [{ is_trading_day: true }],
        count: 1,
        source: 'fixture',
        fetched_at: '',
      }),
    }) as unknown as AkshareClient;
  const card = (fetchedAt: string, nowIso: string) =>
    buildIndexCard({
      client: indexClient(),
      now: new Date(nowIso),
      quote: {
        data: [{ 名称: '上证指数', 最新价: 3301.2, 涨跌幅: 0.4 }],
        count: 1,
        source: 'fixture',
        fetched_at: fetchedAt,
      },
    } as never);
  it('fetched 2 minutes ago, intraday → 盘中实时', async () => {
    expect(await card('2026-10-26T06:18:00Z', '2026-10-26T14:20:00+08:00')).toContain(
      '（盘中实时，未收盘）',
    );
  });
  it('a cached 09:40 snapshot read at 14:20 → 最近报价, 非实时', async () => {
    const text = await card('2026-10-26T01:40:00Z', '2026-10-26T14:20:00+08:00');
    expect(text).toContain('- 最近报价（抓取于 2026-10-26 09:40，非实时（未取到今日实时行情））');
    expect(text).not.toContain('盘中实时');
  });
  it('lunch: a snapshot from 11:29 is still the latest trade at 12:40', async () => {
    expect(await card('2026-10-26T03:29:00Z', '2026-10-26T12:40:00+08:00')).toContain(
      '（盘中实时，未收盘）',
    );
  });
});
