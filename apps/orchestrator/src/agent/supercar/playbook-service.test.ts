import { describe, expect, it } from 'vitest';
import {
  composePlaybookPreamble,
  formatForPrompt,
  getPlaybook,
  getRecommendedLane,
  matchPlaybooks,
} from './playbook-service.js';

/**
 * Phase 14 验证 — 实现规格里的五条 acceptance criteria：
 * 1. "京东" → 注入京东操作手册
 * 2. "淘宝" → 注入淘宝手册 + 反爬警告
 * 3. "京东和淘宝" → 两个手册都注入
 * 4. 不提任何网站 → 不注入手册
 * 5. preferredLane 可被 router 决策参考
 */
describe('matchPlaybooks', () => {
  it('matches Chinese name "京东"', () => {
    const matched = matchPlaybooks('帮我在京东搜 MacBook 价格');
    expect(matched.map((p) => p.domain)).toEqual(['jd.com']);
  });

  it('matches Chinese name "淘宝"', () => {
    const matched = matchPlaybooks('淘宝上 AirPods 多少钱');
    expect(matched.map((p) => p.domain)).toEqual(['taobao.com']);
  });

  it('matches both 京东 and 淘宝 in the same intent', () => {
    const matched = matchPlaybooks('对比一下京东和淘宝上 MacBook Air M4 的价格');
    const domains = matched.map((p) => p.domain).sort();
    expect(domains).toEqual(['jd.com', 'taobao.com']);
  });

  it('returns empty array when no site is mentioned', () => {
    expect(matchPlaybooks('今天天气怎么样')).toEqual([]);
    expect(matchPlaybooks('帮我写一份周报总结')).toEqual([]);
  });

  it('matches by domain string', () => {
    const matched = matchPlaybooks('看 jd.com 上这个商品');
    expect(matched.map((p) => p.domain)).toEqual(['jd.com']);
  });

  it('matches by English name (≥4 chars)', () => {
    const matched = matchPlaybooks('check Taobao price');
    expect(matched.map((p) => p.domain)).toEqual(['taobao.com']);
  });

  it('does not double-match the same playbook on multiple criteria', () => {
    const matched = matchPlaybooks('在京东 jd.com 搜 JD.com 这个');
    expect(matched.map((p) => p.domain)).toEqual(['jd.com']);
  });

  it('handles null/undefined/empty input', () => {
    expect(matchPlaybooks(null)).toEqual([]);
    expect(matchPlaybooks(undefined)).toEqual([]);
    expect(matchPlaybooks('')).toEqual([]);
  });

  it('matches Boss直聘 招聘平台', () => {
    const matched = matchPlaybooks('在 Boss直聘上找 AI 产品经理');
    expect(matched.map((p) => p.domain)).toEqual(['zhipin.com']);
  });

  it('matches multiple categories together', () => {
    const matched = matchPlaybooks('在小红书和大众点评上看上海餐厅');
    const domains = matched.map((p) => p.domain).sort();
    expect(domains).toEqual(['dianping.com', 'xiaohongshu.com']);
  });
});

describe('formatForPrompt', () => {
  it('returns empty string when no playbooks matched', () => {
    expect(formatForPrompt([])).toBe('');
  });

  it('renders 京东 with the operating-tip line', () => {
    const matched = matchPlaybooks('京东');
    const out = formatForPrompt(matched);
    expect(out).toContain('【京东】');
    expect(out).toContain('jd.com');
    expect(out).toContain('操作提示');
    expect(out).toContain('自营');
  });

  it('淘宝 surface includes anti-bot warning', () => {
    const matched = matchPlaybooks('淘宝');
    const out = formatForPrompt(matched);
    expect(out).toContain('【淘宝】');
    expect(out).toContain('反爬警告');
  });

  it('百度 (low anti-bot) does not include anti-bot warning line', () => {
    const matched = matchPlaybooks('百度');
    const out = formatForPrompt(matched);
    expect(out).toContain('【百度】');
    expect(out).not.toContain('反爬警告');
  });

  it('12306 (login required) shows "必须登录"', () => {
    const matched = matchPlaybooks('12306');
    const out = formatForPrompt(matched);
    expect(out).toContain('必须登录');
  });

  it('renders both playbooks when two are matched', () => {
    const matched = matchPlaybooks('对比京东和淘宝');
    const out = formatForPrompt(matched);
    expect(out).toContain('【京东】');
    expect(out).toContain('【淘宝】');
  });

  it('wraps the block in --- delimiters', () => {
    const matched = matchPlaybooks('京东');
    const out = formatForPrompt(matched);
    expect(out.startsWith('---')).toBe(true);
    expect(out.endsWith('---')).toBe(true);
  });
});

describe('composePlaybookPreamble', () => {
  it('returns empty string for site-less intents', () => {
    expect(composePlaybookPreamble('今天天气')).toBe('');
  });

  it('returns the rendered block for site-bearing intents', () => {
    const out = composePlaybookPreamble('在京东搜索');
    expect(out).toContain('【京东】');
    expect(out).toContain('---');
  });
});

describe('getPlaybook', () => {
  it('exact root-domain lookup', () => {
    expect(getPlaybook('jd.com')?.name).toBe('京东');
  });

  it('strips www / m / wap prefixes', () => {
    expect(getPlaybook('www.jd.com')?.name).toBe('京东');
    expect(getPlaybook('m.taobao.com')?.name).toBe('淘宝');
  });

  it('extracts host from full URL', () => {
    expect(getPlaybook('https://search.jd.com/Search?keyword=x')?.name).toBe('京东');
  });

  it('sub-domain falls back to root playbook', () => {
    expect(getPlaybook('list.tmall.com')?.name).toBe('天猫');
    expect(getPlaybook('s.weibo.com')?.name).toBe('微博');
  });

  it('returns null for unknown domain', () => {
    expect(getPlaybook('unknown-site.example')).toBeNull();
  });

  it('handles null/undefined', () => {
    expect(getPlaybook(null)).toBeNull();
    expect(getPlaybook(undefined)).toBeNull();
  });
});

describe('getRecommendedLane', () => {
  it('returns brave_api for jd.com (low anti-bot, search-friendly)', () => {
    expect(getRecommendedLane('jd.com')).toBe('brave_api');
  });

  it('returns browser_cdp for ctrip.com (anti-bot + dynamic pricing)', () => {
    expect(getRecommendedLane('ctrip.com')).toBe('browser_cdp');
  });

  it('returns null for unknown sites — caller falls back to default route', () => {
    expect(getRecommendedLane('unknown.example')).toBeNull();
  });
});
