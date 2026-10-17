/**
 * 批次 11.2 — 长句（>16 字）抽股票名 + 短句名称误配防护 单测.
 *
 * search mock 模拟生产 akshare `search_symbol` 的两段行为：①全名是 query 子串；②query 的 2-4 字
 * 中文窗口是某个名称的子串（短名匹配，误配来源）。全程无网络。
 */

import { describe, expect, it } from 'vitest';
import {
  LONG_SENTENCE_MAX_CANDIDATES,
  extractNameCandidates,
  resolveAshareInContext,
  resolveAshareQa,
} from './ashare-qa-matcher.js';
import type { ResolvedStock } from './ashare-qa-types.js';

const NOW = new Date('2026-06-15T07:00:00Z');

const TABLE: ReadonlyArray<ResolvedStock> = [
  { symbol: '300750', displayName: '宁德时代' },
  { symbol: '600519', displayName: '贵州茅台' },
  { symbol: '603335', displayName: '迪生力' },
  { symbol: '300532', displayName: '今天国际' },
  { symbol: '002402', displayName: '和而泰' },
];

/** 仿生产 search_symbol：全名在 query 里优先；否则 2-4 字窗口命中名称（≤4 只才返回）。 */
function akshareLikeSearch() {
  const calls: string[] = [];
  const fn = async (q: string): Promise<ResolvedStock[]> => {
    calls.push(q);
    const full = TABLE.filter((s) => s.displayName && q.includes(s.displayName));
    if (full.length) return full;
    const hits = new Map<string, ResolvedStock>();
    for (const len of [4, 3, 2]) {
      for (let i = 0; i + len <= q.length; i += 1) {
        const w = q.slice(i, i + len);
        if (!/^[一-鿿]+$/.test(w)) continue;
        const m = TABLE.filter((s) => s.displayName?.includes(w));
        if (m.length >= 1 && m.length <= 4) for (const s of m) hits.set(s.symbol, s);
      }
    }
    return [...hits.values()];
  };
  return { fn, calls };
}

async function inContext(intent: string) {
  const s = akshareLikeSearch();
  const r = await resolveAshareInContext({ intent, watchlist: [], now: NOW }, s.fn);
  return { r, calls: s.calls };
}

describe('extractNameCandidates', () => {
  it('切掉命令词 / 虚词，留下名称片段', () => {
    expect(extractNameCandidates('用 DCF 算一下宁德时代的合理估值')).toEqual(['宁德时代']);
    expect(extractNameCandidates('帮我用 DCF 估一下迪生力这家公司的内在价值')).toEqual(['迪生力']);
  });
  it('exclude 的名称先挖掉', () => {
    expect(extractNameCandidates('对比宁德时代和迪生力的估值', ['宁德时代'])).toEqual(['迪生力']);
  });
});

describe('长句（>16 字）抽股票名 → 带合规闸门的个股流程', () => {
  it('「用 DCF 算一下宁德时代的合理估值」→ 宁德时代个股速览（本地字典命中，零请求）', async () => {
    const { r, calls } = await inContext('用 DCF 算一下宁德时代的合理估值');
    expect(r.match?.stocks).toEqual([{ symbol: '300750', displayName: '宁德时代' }]);
    expect(r.match?.deep).toBe(false);
    expect(r.hasSignal).toBe(true);
    expect(calls).toEqual([]);
  });

  it('字典里没有的名称 → 抽候选词逐个查 akshare（不拿整句查）', async () => {
    const intent = '帮我用 DCF 估一下迪生力这家公司的内在价值';
    const { r, calls } = await inContext(intent);
    expect(r.match?.stocks).toEqual([{ symbol: '603335', displayName: '迪生力' }]);
    expect(calls).toEqual(['迪生力']);
    expect(calls).not.toContain(intent);
  });

  it('深度分析长句 → 全景（deep）', async () => {
    const { r } = await inContext('请帮我详细分析一下迪生力这家公司的基本面和估值情况');
    expect(r.match?.stocks[0]?.symbol).toBe('603335');
    expect(r.match?.deep).toBe(true);
  });

  it('多只股票：字典 + 远程都收', async () => {
    const { r } = await inContext('对比一下宁德时代和迪生力这两家公司的估值水平谁更高');
    expect(r.match?.stocks.map((s) => s.symbol)).toEqual(['300750', '603335']);
  });

  it('别名在有 A股信号的长句里生效：「茅台」→ 贵州茅台（字典，零请求）', async () => {
    const { r, calls } = await inContext('用DCF帮我算一下茅台现在的内在价值是多少');
    expect(r.match?.stocks[0]).toEqual({ symbol: '600519', displayName: '贵州茅台' });
    expect(calls).toEqual([]);
  });

  it(`候选词查询有上限（≤${LONG_SENTENCE_MAX_CANDIDATES} 次）`, async () => {
    const { calls } = await inContext(
      '用 DCF 估值模型算一下甲乙丙那家，丁戊己这家，庚辛壬还有癸子丑三家公司的内在价值',
    );
    expect(
      extractNameCandidates(
        '用 DCF 估值模型算一下甲乙丙那家，丁戊己这家，庚辛壬还有癸子丑三家公司的内在价值',
      ).length,
    ).toBeGreaterThan(LONG_SENTENCE_MAX_CANDIDATES);
    expect(calls.length).toBe(LONG_SENTENCE_MAX_CANDIDATES);
  });

  it('akshare 查询抛错 → 不崩，落引导兜底', async () => {
    const r = await resolveAshareInContext(
      { intent: '帮我用 DCF 估一下迪生力这家公司的内在价值', watchlist: [], now: NOW },
      async () => {
        throw new Error('akshare down');
      },
    );
    expect(r).toEqual({ match: null, hasSignal: true, indexIntent: false });
  });

  it('非上下文（未启用技能）：门槛已过的长问句也能抽名', async () => {
    const s = akshareLikeSearch();
    const m = await resolveAshareQa(
      { intent: '迪生力最近一个交易日的收盘价和涨跌幅分别是多少呢', watchlist: [], now: NOW },
      s.fn,
    );
    expect(m?.stocks[0]?.symbol).toBe('603335');
  });
});

describe('误匹配反例：不能被当成股票请求', () => {
  it('「帮我写一份关于宁德的旅游攻略」（短句）→ 通用路径（短名窗口命中宁德时代也不收）', async () => {
    const { r, calls } = await inContext('帮我写一份关于宁德的旅游攻略');
    expect(calls.length).toBe(1); // 短句照旧整句查一次，akshare 会返回宁德时代
    expect(r).toEqual({ match: null, hasSignal: false, indexIntent: false });
  });

  it('长版旅游攻略（无 A股信号）→ 不抽名、不请求、通用路径', async () => {
    const { r, calls } = await inContext(
      '帮我写一份关于宁德的旅游攻略，顺便推荐一下当地的美食和住宿',
    );
    expect(calls).toEqual([]);
    expect(r).toEqual({ match: null, hasSignal: false, indexIntent: false });
  });

  it('旅游话题里带了「行业」：别名「茅台」不生效，akshare 短名命中也不收', async () => {
    const { r } = await inContext('帮我写一份茅台镇旅游攻略，顺便说说当地的白酒行业发展');
    expect(r.match).toBeNull();
  });

  it('只说了地名片段「宁德」的估值长句 → 不猜成宁德时代，落引导兜底', async () => {
    const { r } = await inContext('用 DCF 模型帮我估一下宁德那边那家电池公司的内在价值');
    expect(r.match).toBeNull();
    expect(r.hasSignal).toBe(true);
  });

  it('长句里的「今天」不会配成今天国际（E16）', async () => {
    const { r } = await inContext('今天想用 DCF 模型估一下这家公司的内在价值可以吗');
    expect(r.match).toBeNull();
  });

  it('长指数问句仍走指数 lane，不抽名', async () => {
    const { r, calls } = await inContext('帮我查一下今天A股三大指数的收盘点位和涨跌幅情况');
    expect(r.indexIntent).toBe(true);
    expect(calls).toEqual([]);
  });

  it('长句没有 A股信号（普通闲聊）→ 不请求', async () => {
    const { r, calls } = await inContext('今天有什么消息可以帮我整理一下最近的情况吗谢谢');
    expect(calls).toEqual([]);
    expect(r.match).toBeNull();
  });
});

describe('短句行为不回退', () => {
  it('「茅台为什么跌」→ 短名命中贵州茅台（有 A股术语）', async () => {
    const { r } = await inContext('茅台为什么跌');
    expect(r.match?.stocks[0]?.symbol).toBe('600519');
  });
  it('只打一个短名「茅台」→ 命中', async () => {
    const { r } = await inContext('茅台');
    expect(r.match?.stocks[0]?.symbol).toBe('600519');
  });
  it('短句全名「迪生力今天为什么涨」→ 命中', async () => {
    const { r } = await inContext('迪生力今天为什么涨');
    expect(r.match?.stocks.map((s) => s.symbol)).toContain('603335');
  });
});
