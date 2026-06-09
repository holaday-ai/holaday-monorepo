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

  // China OTA — the verbatim QA prompts must inject the right playbook.
  it('OTA QA prompts inject the matching travel playbook', () => {
    expect(matchPlaybooks('打开携程查北京到上海的机票，不要下单。筛选直飞，给最便宜的 3 个选项（航空公司/时间/价格）。').map((p) => p.domain)).toEqual(['ctrip.com']);
    expect(matchPlaybooks('打开携程查上海 2026-08-01 到 2026-08-03 的酒店，不要预订。筛选 4 星以上，价格低于 800 元，给 5 个结果。').map((p) => p.domain)).toEqual(['ctrip.com']);
    expect(matchPlaybooks('打开去哪儿查东京到上海机票，不要下单，给前 3 个结果。').map((p) => p.domain)).toEqual(['qunar.com']);
    expect(matchPlaybooks('打开飞猪查大阪酒店，不要预订，给 5 个结果。').map((p) => p.domain)).toEqual(['fliggy.com']);
  });

  it('matches the new 同程 (ly.com) playbook', () => {
    expect(matchPlaybooks('打开同程查上海到北京的火车票').map((p) => p.domain)).toEqual(['ly.com']);
  });

  it('preferUserBrowser is set ONLY on the China-OTA playbooks (B-专项 scope)', () => {
    const prefer = (intent: string) => matchPlaybooks(intent)[0]?.preferUserBrowser === true;
    // OTA scope whitelist → true
    expect(prefer('打开携程查酒店')).toBe(true); // ctrip
    expect(prefer('去哪儿查机票')).toBe(true); // qunar
    expect(prefer('飞猪查酒店')).toBe(true); // fliggy
    expect(prefer('同程查火车票')).toBe(true); // ly
    expect(prefer('美团查酒店')).toBe(true); // meituan
    // non-OTA → not set
    expect(prefer('京东搜手机')).toBe(false); // jd
    expect(prefer('百度搜索 AI')).toBe(false); // baidu
    expect(prefer('Boss直聘找工作')).toBe(false); // zhipin
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

  it('携程 playbook carries the concrete operating steps + no-order reminder', () => {
    const out = formatForPrompt(matchPlaybooks('携程'));
    expect(out).toContain('【携程】');
    // operating sequence cues
    expect(out).toContain('搜索');
    expect(out).toContain('筛选');
    expect(out).toContain('表格');
    // explicit no-order / no-booking guard surfaced to the model
    expect(out).toContain('未下单/未预订');
    expect(out).toContain('严禁点');
    // partial login requirement rendered
    expect(out).toContain('需要登录');
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
