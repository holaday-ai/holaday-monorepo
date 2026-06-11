import { describe, expect, it } from 'vitest';
import {
  detectRequiredSites,
  evaluateSourceDomain,
  extractAnswerDomains,
} from './source-domain-consistency.js';

describe('detectRequiredSites', () => {
  it('names 百度地图 / 京东 / 豆瓣 / Notion / Linear / 携程', () => {
    expect(detectRequiredSites('用百度地图查路线').map((r) => r.label)).toEqual(['百度地图']);
    expect(detectRequiredSites('用京东查价格')[0]?.label).toBe('京东');
    expect(detectRequiredSites('打开豆瓣搜索评分')[0]?.label).toBe('豆瓣');
    expect(detectRequiredSites('提取 Notion pricing 页各套餐价格')[0]?.label).toBe('Notion');
    expect(detectRequiredSites('在 Linear 创建一个 issue')[0]?.label).toBe('Linear');
    expect(detectRequiredSites('打开携程查酒店')[0]?.label).toBe('携程');
  });

  it('no named site → empty', () => {
    expect(detectRequiredSites('查今天的特斯拉股价')).toEqual([]);
    expect(detectRequiredSites('')).toEqual([]);
    expect(detectRequiredSites(null)).toEqual([]);
  });
});

describe('extractAnswerDomains', () => {
  it('extracts full URLs, bare domains, and finalUrl host', () => {
    const set = extractAnswerDomains(
      '路线一…数据来自 kan3721.com，详情见 https://map.baidu.com/dir/abc',
      'https://www.jd.com/search?q=x',
    );
    expect(set.has('kan3721.com')).toBe(true);
    expect(set.has('map.baidu.com')).toBe(true);
    expect(set.has('jd.com')).toBe(true); // www. stripped
  });

  it('ignores filenames with file-suffix TLD lookalikes and own domains', () => {
    const set = extractAnswerDomains(
      '已生成 pomodoro-tips.md（2 KB），见 https://hd-app.orangebench.tech/?task=tsk_1',
      null,
    );
    expect(set.has('pomodoro-tips.md')).toBe(false);
    expect([...set].some((d) => d.includes('orangebench'))).toBe(false);
  });
});

describe('evaluateSourceDomain — the 7-case matrix', () => {
  it('用百度地图查路线 + source=kan3721.com → inconsistent (partial)', () => {
    const v = evaluateSourceDomain({
      intent: '用百度地图查从杭州东站到西湖的路线',
      answerText: '路线一：地铁1号线…数据来自 kan3721.com',
    });
    expect(v.inconsistent).toBe(true);
  });

  it('用百度地图查路线 + finalUrl=map.baidu.com → pass', () => {
    const v = evaluateSourceDomain({
      intent: '用百度地图查从杭州东站到西湖的路线',
      answerText: '路线一：地铁1号线，约 17 分钟。',
      finalUrl: 'https://map.baidu.com/dir/xxx',
    });
    expect(v.inconsistent).toBe(false);
  });

  it('用京东查价格 + source=jd.com → pass', () => {
    const v = evaluateSourceDomain({
      intent: '用京东查 AirPods 价格，不要购买',
      answerText: '前 3 个结果…来源 https://search.jd.com/Search?keyword=airpods',
    });
    expect(v.inconsistent).toBe(false);
  });

  it('用京东查价格 + source=smzdm.com → inconsistent', () => {
    const v = evaluateSourceDomain({
      intent: '用京东查 AirPods 价格，不要购买',
      answerText: '比价数据来自 https://www.smzdm.com/p/123',
    });
    expect(v.inconsistent).toBe(true);
  });

  it('Notion pricing + source=notion.com → pass (notion.so alias too)', () => {
    expect(
      evaluateSourceDomain({
        intent: '打开 Notion pricing 页提取套餐价格',
        answerText: '价格见 https://www.notion.com/pricing',
      }).inconsistent,
    ).toBe(false);
    expect(
      evaluateSourceDomain({
        intent: '打开 Notion pricing 页提取套餐价格',
        answerText: '价格见 https://notion.so/pricing',
      }).inconsistent,
    ).toBe(false);
  });

  it('Notion pricing + source=random blog → inconsistent', () => {
    const v = evaluateSourceDomain({
      intent: '打开 Notion pricing 页提取套餐价格',
      answerText: '据 randomblog.io 整理，Plus 为 $12。来源 https://randomblog.io/notion-pricing',
    });
    expect(v.inconsistent).toBe(true);
  });

  it('用户允许其他来源 → no check even with foreign source', () => {
    const v = evaluateSourceDomain({
      intent: '用百度地图查路线，可以使用其他来源',
      answerText: '数据来自 kan3721.com',
    });
    expect(v.inconsistent).toBe(false);
  });
});

describe('evaluateSourceDomain — conservative edges', () => {
  it('named site but NO extractable sources → pass (cannot prove substitution)', () => {
    const v = evaluateSourceDomain({
      intent: '用百度地图查路线',
      answerText: '路线一：地铁1号线，全程约 17 分钟。',
    });
    expect(v.inconsistent).toBe(false);
  });

  it('no named site → never fires', () => {
    const v = evaluateSourceDomain({
      intent: '查今天的特斯拉股价',
      answerText: '据 kan3721.com，股价为…',
    });
    expect(v.inconsistent).toBe(false);
  });

  it('mixed sources: third-party + named site present → pass (any-match)', () => {
    const v = evaluateSourceDomain({
      intent: '用豆瓣查奥本海默评分',
      answerText: '评分 8.8，详情 https://movie.douban.com/subject/35593344/，另见 wiki.example.com',
    });
    expect(v.inconsistent).toBe(false);
  });

  it('multi-site intent (对比携程和去哪儿) — either domain satisfies', () => {
    const v = evaluateSourceDomain({
      intent: '对比携程和去哪儿的机票价格',
      answerText: '数据来自 https://flights.ctrip.com/online/list/oneway-bjs-sha',
    });
    expect(v.inconsistent).toBe(false);
  });
});
