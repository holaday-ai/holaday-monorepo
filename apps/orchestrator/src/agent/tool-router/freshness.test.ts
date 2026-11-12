import { describe, expect, it } from 'vitest';
import { freshnessHandover, freshnessProblem, isTimeSensitive } from './freshness.js';

// Bench a1, 2026-11-12 13:15 Beijing (05:15 UTC).
const NOW = new Date('2026-11-12T05:15:00Z');
const RETRIEVAL =
  '检索于：百炼联网搜索增强版 · 2026-11-12 13:15（这是检索时间，不是数据本身的时间）';

describe('REBUILD-2 ruling: a time-sensitive interface answer is current or goes to the browser', () => {
  it('live-sh as it happened: the 11-09 close said as 「13:15 左右」 is not delivered', () => {
    const results = [
      '# 上证指数 sh000001',
      '11月9日（周一）收盘 3,660.79 点；11月6日（周五）收盘 3,649.18 点，跌 1.10%；11月5日收盘 3,689.91 点',
      RETRIEVAL,
    ].join('\n\n');
    const answer =
      '截至北京时间 13:15 左右，上证指数报 **3660.79** 点。\n\n- 11月9日（周一）收盘 3,660.79 点';
    const problem = freshnessProblem({ intent: '上证指数现在多少', answer, results, now: NOW });
    expect(problem).toEqual({ kind: 'stale', latest: '2026-11-09' });
    expect(freshnessHandover(problem!)).toBe(
      '接口最新只查到 11 月 9 日的数据，已自动改用云端浏览器去页面上取实时数',
    );
  });

  it('today’s data with its own time passes (b-n06 at a1)', () => {
    const results = [
      '# 上证指数',
      '2026-11-12 11:30 午间休市，上证指数报 3688.05 点，涨 0.20%',
      RETRIEVAL,
    ].join('\n\n');
    const answer = '截至北京时间 11 月 12 日 11:30（午间休市），上证指数报 **3688.05** 点。';
    expect(
      freshnessProblem({ intent: '上证指数现在多少点', answer, results, now: NOW }),
    ).toBeNull();
  });

  it('today’s data, but a time the results never state (the retrieval time) is sent away', () => {
    const results = ['2026-11-12 11:30 上证指数报 3688.05 点', RETRIEVAL].join('\n\n');
    const answer = '截至 13:15，上证指数报 3688.05 点。';
    expect(
      freshnessProblem({ intent: '上证指数现在多少', answer, results, now: NOW }),
    ).toMatchObject({ kind: 'unsupported_time', stated: '13:15' });
  });

  it('weather: tomorrow’s forecast is current; news: yesterday counts', () => {
    const weather = ['杭州 11月13日 多云转小雨 18/14℃', RETRIEVAL].join('\n');
    expect(
      freshnessProblem({
        intent: '杭州明天天气怎么样',
        answer: '杭州明天（11月13日）多云，夜间小雨，18/14℃。',
        results: weather,
        now: NOW,
      }),
    ).toBeNull();
    const news = ['2026年11月11日 中汽协：10月新能源汽车销量占比 64.3%', RETRIEVAL].join('\n');
    expect(
      freshnessProblem({
        intent: '今天关于新能源汽车有哪些新闻',
        answer: '中汽协 11月11日发布：10月占比 64.3%。',
        results: news,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('questions that are not time-sensitive are not checked', () => {
    expect(isTimeSensitive('中国最高的山是哪座')).toBe(false);
    expect(isTimeSensitive('帮我写 3 条小红书露营文案')).toBe(false);
    expect(
      freshnessProblem({ intent: '中国最高的山是哪座', answer: '珠峰', results: '', now: NOW }),
    ).toBeNull();
  });

  it('spaced dates are read too: an answer naming another day than the data is refused', () => {
    const results = ['2026-11-12 11:30 上证指数报 3688.05 点', RETRIEVAL].join('\n\n');
    expect(
      freshnessProblem({
        intent: '上证指数现在多少',
        answer: '截至 11 月 10 日 11:30，上证指数报 3688.05 点。',
        results,
        now: NOW,
      }),
    ).toMatchObject({ kind: 'unsupported_time', stated: '2026-11-10' });
  });
});
