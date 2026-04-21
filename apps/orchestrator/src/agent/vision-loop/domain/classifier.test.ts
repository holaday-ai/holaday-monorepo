import { describe, expect, it } from 'vitest';
import { classify } from './classifier.js';

describe('DomainClassifier.classify', () => {
  it('returns general with confidence 0 for empty intent', () => {
    const r = classify('');
    expect(r.domain).toBe('general');
    expect(r.confidence).toBe(0);
    expect(r.matched).toEqual([]);
  });

  it('routes stock-flavoured Chinese intents to finance', () => {
    const r = classify('帮我查一下茅台最新的财报和市盈率');
    expect(r.domain).toBe('finance');
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.matched).toContain('茅台');
  });

  it('routes a GDPR-flavoured intent to legal, not tech', () => {
    // "compliance" hits legal; the word "GDPR" too. tech has no
    // matching tokens here so it must not outrank legal.
    const r = classify('review this NDA for GDPR compliance');
    expect(r.domain).toBe('legal');
    expect(r.matched.some((t) => t.toLowerCase().includes('gdpr'))).toBe(true);
  });

  it('routes a job search to job', () => {
    const r = classify('在 BOSS直聘 找高级前端岗位，整理 offer');
    expect(r.domain).toBe('job');
    expect(r.matched).toEqual(expect.arrayContaining(['boss直聘', 'offer']));
  });

  it('routes a shopping intent to ecommerce', () => {
    const r = classify('在淘宝和京东比价 iPhone 16，选最便宜的');
    expect(r.domain).toBe('ecommerce');
  });

  it('routes a news intent to news', () => {
    const r = classify('看今天澎湃新闻的头条');
    expect(r.domain).toBe('news');
  });

  it('routes a Weibo-flavoured intent to social', () => {
    const r = classify('微博热搜前十有哪些');
    expect(r.domain).toBe('social');
  });

  it('routes an API-docs intent to tech', () => {
    const r = classify('github 上找 TanStack Query 的 API 文档');
    expect(r.domain).toBe('tech');
  });

  it('collapses to general when no keyword matches', () => {
    const r = classify('帮我写一首诗讲一下夏天的海');
    expect(r.domain).toBe('general');
    expect(r.confidence).toBe(0);
  });

  it('finance beats tech when both match (weighting)', () => {
    // "github" (tech w=0.7) vs "股票 / 财报" (finance w=1.0); finance
    // should still win even though github is an easy hit.
    const r = classify('github 上找一个能拉股票财报数据的 SDK');
    expect(r.domain).toBe('finance');
  });

  it('confidence stays below 0.95 even with many matches', () => {
    const r = classify(
      '股票 基金 财报 K线 涨跌 市盈率 ROE 净利润 ETF 雪球 东方财富',
    );
    expect(r.confidence).toBeLessThanOrEqual(0.95);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('returns the actual matched tokens (for debug logs)', () => {
    const r = classify('搜索 AAPL 股价和 PE');
    expect(r.matched).toEqual(expect.arrayContaining(['股价']));
  });

  it('is case-insensitive on ASCII keywords', () => {
    expect(classify('SEARCH FOR GOOGLE').domain).toBe('general'); // no tech match, no finance
    expect(classify('check the README on GITHUB').domain).toBe('tech');
  });

  it('handles mixed-language intents', () => {
    const r = classify('帮我在 LinkedIn 上找 senior frontend jobs');
    expect(r.domain).toBe('job');
  });
});
