/**
 * FIX-57 协调方第 2 次代体验: 「上证指数现在多少点」 on the A-share lane reads like an
 * assistant — the asked index first, the time in words, no akshare names, no 「抓取」.
 */
import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { buildIndexAnswer, withoutDataSourceNames } from './ashare-fact-card.js';
import type { AkEnvelope } from './briefing-types.js';

const at = (beijing: string) => new Date(`${beijing}+08:00`);

function env<T>(data: T[], extra: Partial<AkEnvelope<T>> = {}): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source: 'akshare:stock_zh_index_spot_sina',
    fetched_at: '2026-11-06T00:55:00Z',
    ...extra,
  } as AkEnvelope<T>;
}

function client(tradingDay: boolean | null = true): AkshareClient {
  return {
    getTradingDay: () =>
      Promise.resolve(
        tradingDay === null
          ? env([], { error: 'unavailable' })
          : env([{ is_trading_day: tradingDay }]),
      ),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}

const ROWS = (clock: string) => [
  { 名称: '上证指数', 最新价: 3689.91, 涨跌幅: 0.1, 时间: clock },
  { 名称: '深证成指', 最新价: 11471.09, 涨跌幅: 1.2, 时间: clock },
  { 名称: '创业板指', 最新价: 2566.8, 涨跌幅: -0.87, 时间: clock },
];
const INTERNAL = /akshare|stock_zh_|_sina|抓取|HOLA DAY|速览|免责声明|📊/;

describe('FIX-57 · the index lane answers in words', () => {
  it("before the open (08:55): yesterday's close, said as such; 上证 first", async () => {
    const md = await buildIndexAnswer({
      client: client(true),
      now: at('2026-11-06T08:55:00'),
      quote: env(ROWS('15:00:03')),
      intent: '上证指数现在多少点',
    });
    expect(md.split('\n')[0]).toBe('还没开盘，上证指数昨天收在 3,689.91 点，涨 0.10%。');
    expect(md).toContain('另外，深证成指 11,471.09（涨 1.20%），创业板指 2,566.80（跌 0.87%）。');
    expect(md).toContain('开盘后（9:30）我可以再帮你看实时点位。');
    expect(md).toContain('数据来自新浪财经');
    expect(md).toContain('*仅供参考，不构成投资建议。*');
    expect(md).not.toMatch(INTERNAL);
  });

  it('intraday: 「现在是」 with the Beijing time', async () => {
    const md = await buildIndexAnswer({
      client: client(true),
      now: at('2026-11-06T10:21:00'),
      quote: env(ROWS('10:20:30'), { fetched_at: '2026-11-06T02:21:00Z' }),
      intent: '创业板现在怎么样',
    });
    expect(md.split('\n')[0]).toBe(
      '创业板指现在是 2,566.80 点，跌 0.87%（北京时间 10:20 的盘中行情，还没收盘）。',
    );
    expect(md).not.toMatch(INTERNAL);
  });

  it('after the close: 「已经收盘了，…今天收在」; a general question lists all three', async () => {
    const md = await buildIndexAnswer({
      client: client(true),
      now: at('2026-11-06T15:40:00'),
      quote: env(ROWS('15:00:03'), { fetched_at: '2026-11-06T07:40:00Z' }),
      intent: '今天大盘怎么样',
    });
    expect(md.split('\n')[0]).toBe(
      '已经收盘了，三大指数：上证指数今天收在 3,689.91 点，涨 0.10%；深证成指今天收在 11,471.09 点，涨 1.20%；创业板指今天收在 2,566.80 点，跌 0.87%。',
    );
  });

  it('an unknown calendar is said plainly, never as 现在', async () => {
    const md = await buildIndexAnswer({
      client: client(null),
      now: at('2026-11-07T11:00:00'),
      quote: env(ROWS(''), { fetched_at: '2026-11-07T03:00:00Z' }),
      intent: '上证指数多少点',
    });
    expect(md).not.toContain('现在是');
    expect(md).not.toMatch(INTERNAL);
  });

  it('no data: one plain sentence', async () => {
    const md = await buildIndexAnswer({
      client: client(true),
      now: at('2026-11-06T10:00:00'),
      quote: env([], { error: 'timeout' }),
      intent: '上证指数多少点',
    });
    expect(md).toBe(
      '我这边暂时没拿到三大指数的行情，稍后再问我一次，或者我去公开的行情页面帮你看。',
    );
  });

  it('internal data-source names are cleaned from any text', () => {
    expect(
      withoutDataSourceNames('上证 3,689.91（来源 akshare:stock_zh_index_spot_sina · 抓取 08:55）'),
    ).toBe('上证 3,689.91');
    expect(withoutDataSourceNames('数据来源 AkShare，走 sina 接口')).toBe(
      '数据来源 公开行情数据，走 新浪财经',
    );
  });
});
