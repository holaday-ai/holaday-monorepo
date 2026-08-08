/**
 * Phase 1 #2 ④ — A股即时问答 M1 单测：resolver + matcher + 接地事实卡（无 LLM）.
 *
 * 锁住：个股解析（代码/自选名/误判过滤）+ 意图门槛 + 异动/资讯分类 + 事实卡
 * ①② 组装 + 逐条溯源 + 降级（数据暂不可用/未上榜/无公告）+ 合规无建议措辞。
 */

import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { buildAshareFactCard } from './ashare-fact-card.js';
import { matchAshareQa, resolveAshareInContext } from './ashare-qa-matcher.js';
import type { ResolvedStock } from './ashare-qa-types.js';
import { resolveStocks } from './ashare-stock-resolver.js';
import type { AkEnvelope } from './briefing-types.js';

const WL: ResolvedStock[] = [
  { symbol: '600519', displayName: '贵州茅台' },
  { symbol: '300750', displayName: '宁德时代' },
];
const NOW = new Date('2026-06-12T07:00:00Z'); // 北京 15:00 周五

// 合规哨兵（同 briefing：荐股措辞黑名单）。
const ADVICE_PATTERN =
  /建议(买入|卖出|买|卖|加仓|减仓|持有)|目标价|必涨|必跌|强烈推荐|涨停可期|抄底|梭哈|满仓|清仓|值得(买入|入手)/;

function env<T>(data: T[], extra: Partial<AkEnvelope<T>> = {}): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source: 'akshare:fake',
    fetched_at: '2026-06-12T07:00:00Z',
    disclaimer: 'x',
    ...extra,
  };
}
function errEnv<T>(error: string): AkEnvelope<T> {
  return {
    data: [],
    count: 0,
    source: 'http:/fake',
    fetched_at: '2026-06-12T07:00:00Z',
    disclaimer: 'x',
    error,
  };
}

// ---- resolver ----
describe('resolveStocks', () => {
  it('6 位代码命中（带自选名回填）', () => {
    expect(resolveStocks('600519今天为什么跌', WL)).toEqual([
      { symbol: '600519', displayName: '贵州茅台' },
    ]);
  });
  it('自选股全名命中', () => {
    expect(resolveStocks('贵州茅台有什么公告', WL)).toEqual([
      { symbol: '600519', displayName: '贵州茅台' },
    ]);
  });
  it('非 A股 6 位数（1 打头）+ 8 位日期 不误判', () => {
    expect(resolveStocks('123456 和 20260612', WL)).toEqual([]);
  });
  it('去重', () => {
    expect(resolveStocks('600519 600519 茅台', WL)).toHaveLength(1);
  });
  it('未知代码（不在自选）displayName 为 null', () => {
    expect(resolveStocks('看看 000001', WL)).toEqual([{ symbol: '000001', displayName: null }]);
  });
});

// ---- matcher ----
describe('matchAshareQa', () => {
  it('异动问句 → anomaly + 个股 + 北京日期', () => {
    const m = matchAshareQa({ intent: '贵州茅台今天为什么跌', watchlist: WL, now: NOW });
    expect(m).toMatchObject({ kind: 'anomaly', dateIso: '2026-06-12', dateCompact: '20260612' });
    expect(m?.stocks).toEqual([{ symbol: '600519', displayName: '贵州茅台' }]);
  });
  it('资讯问句 → info', () => {
    expect(matchAshareQa({ intent: '600519有什么公告', watchlist: WL, now: NOW })?.kind).toBe(
      'info',
    );
  });
  it('roleId=a-share-analyst + 自选全名 → 命中（M1 不解析短名「茅台」）', () => {
    expect(
      matchAshareQa({ intent: '贵州茅台', roleId: 'a-share-analyst', watchlist: WL, now: NOW }),
    ).not.toBeNull();
    // M1 已知限制：短名需 name-search（M2）。
    expect(
      matchAshareQa({ intent: '茅台', roleId: 'a-share-analyst', watchlist: WL, now: NOW }),
    ).toBeNull();
  });
  it('非 A股问题 → null', () => {
    expect(matchAshareQa({ intent: '今天天气怎么样', watchlist: WL, now: NOW })).toBeNull();
  });
  it('自选股整体问 → 全 watchlist', () => {
    const m = matchAshareQa({ intent: '我的自选股今天有什么动静', watchlist: WL, now: NOW });
    expect(m?.stocks).toHaveLength(2);
  });
  it('有 A股术语但无个股（市场级）→ null（M1 限个股）', () => {
    expect(matchAshareQa({ intent: '大盘今天怎么样', watchlist: WL, now: NOW })).toBeNull();
  });

  it('持仓语境词「套牢」+ 自选股全名 → 命中（Q3 修：持仓问句进合规框架）', () => {
    const m = matchAshareQa({ intent: '贵州茅台套牢了怎么办', watchlist: WL, now: NOW });
    expect(m?.stocks).toEqual([{ symbol: '600519', displayName: '贵州茅台' }]);
  });

  it('持仓语境词但无个股（被套了怎么办）→ matchAshareQa null（由 a-share lane 兜底引导）', () => {
    // 持仓词 gates 但解析不出个股 → sync 返 null；产品里 resolveAshareQa 也 null →
    // tasks.ts 选了 a-share 技能时走静态引导话术，绝不落通用 LLM（无泄漏）。
    expect(
      matchAshareQa({ intent: '被套了怎么办', roleId: 'a-share-analyst', watchlist: WL, now: NOW }),
    ).toBeNull();
  });

  it('上下文内遇到非 A 股证券查询 → 放回通用路径，不给 A 股引导兜底', async () => {
    const r = await resolveAshareInContext(
      {
        intent: '帮我查今天特斯拉股价并给出来源链接',
        roleId: 'a-share-analyst',
        watchlist: WL,
        now: NOW,
      },
      async () => [],
    );
    expect(r).toEqual({ match: null, hasSignal: false, indexIntent: false });
  });

  it('基金名称查询不被关注列表劫持，也不做 A 股名称搜索', async () => {
    let searched = false;
    const r = await resolveAshareInContext(
      {
        intent: 'leopold的基金最近发生了什么事？',
        roleId: 'a-share-analyst',
        watchlist: WL,
        now: NOW,
      },
      async () => {
        searched = true;
        return [{ symbol: '600519', displayName: '贵州茅台' }];
      },
    );

    expect(r).toEqual({ match: null, hasSignal: false, indexIntent: false });
    expect(searched).toBe(false);
  });

  it('基金查询即使携带旧版自动附加的关注代码，也不进入 A 股个股速览', async () => {
    const r = await resolveAshareInContext(
      {
        intent: 'leopold的基金最近发生了什么事？请优先结合我的关注列表（600519、300750）进行分析。',
        roleId: 'a-share-analyst',
        watchlist: WL,
        now: NOW,
      },
      async () => [],
    );

    expect(r).toEqual({ match: null, hasSignal: false, indexIntent: false });
  });

  it('显式 A 股代码仍进入个股事实链路', async () => {
    const r = await resolveAshareInContext(
      {
        intent: '603528 最近发生了什么事？',
        roleId: 'a-share-analyst',
        watchlist: WL,
        now: NOW,
      },
      async () => [],
    );

    expect(r.match?.stocks.map((stock) => stock.symbol)).toEqual(['603528']);
    expect(r.hasSignal).toBe(true);
    expect(r.indexIntent).toBe(false);
  });

  it('上下文内 A 股持仓语境仍保留引导兜底', async () => {
    const r = await resolveAshareInContext(
      { intent: '被套了怎么办', roleId: 'a-share-analyst', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(r).toEqual({ match: null, hasSignal: true, indexIntent: false });
  });
});

// ---- fact-card ----
interface FakeOver {
  kline?: AkEnvelope;
  ann?: AkEnvelope;
  unlock?: AkEnvelope;
  dt?: AkEnvelope;
  nb?: AkEnvelope;
}
function fakeClient(over: FakeOver = {}): AkshareClient {
  return {
    getIndexQuote: () => Promise.resolve(env([])),
    getStockAnnouncements: () =>
      Promise.resolve(
        over.ann ??
          env([
            {
              公告标题: '贵州茅台2025年度股东会决议公告',
              公告时间: '2026-06-12',
              公告链接: 'http://www.cninfo.com.cn/d?t=2026-06-12 20:50',
            },
          ]),
      ),
    getShareUnlock: () => Promise.resolve(over.unlock ?? env([])),
    getStockKline: () =>
      Promise.resolve(over.kline ?? env([{ 收盘: 1279, 涨跌幅: 0.24, 成交额: 3_230_000_000 }])),
    getStockQuote: () => Promise.resolve(env([])),
    getDragonTiger: () =>
      Promise.resolve(
        over.dt ??
          env([
            {
              代码: '600519',
              上榜原因: '日涨幅偏离值达7%',
              解读: '机构净买入',
              龙虎榜净买额: 120_000_000,
            },
          ]),
      ),
    getNorthboundFlow: () =>
      Promise.resolve(over.nb ?? env([{ 板块: '沪股通', 资金方向: '北向', 成交净买额: 0.0 }])),
    getTradingDay: () => Promise.resolve(env([{ is_trading_day: true }])),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}

const ONE = {
  kind: 'anomaly' as const,
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-06-12',
  dateCompact: '20260612',
};

describe('buildAshareFactCard', () => {
  it('①盘面事实 + ②同期信息 全段 + 溯源 + 免责 + 合规无建议措辞', async () => {
    const md = await buildAshareFactCard({ client: fakeClient(), now: NOW }, ONE);
    expect(md).toContain('# 📈 HOLA DAY · A股个股速览（2026-06-12（周五））');
    expect(md).toContain('③（如有）为分析师判断·未经证实');
    expect(md).toContain('**均不构成投资建议**');
    expect(md).toContain('## 贵州茅台（600519）');
    expect(md).toContain('收盘 1,279.00，涨跌幅 +0.24%，成交额 32.30亿元');
    // 公告：当日 + 含空格链接 encodeURI
    expect(md).toContain(
      '06-12 贵州茅台2025年度股东会决议公告 — [巨潮](http://www.cninfo.com.cn/d?t=2026-06-12%2020:50)',
    );
    // 龙虎榜命中 + 解读列
    expect(md).toContain('日涨幅偏离值达7% ｜ 龙虎榜净买额 +1.20亿元 ｜ 解读：机构净买入');
    // 北向停披露诚实标注
    expect(md).toContain('沪深股通净买额自 2024-08 停披露');
    expect(md).toContain('免责声明');
    expect(md).not.toMatch(ADVICE_PATTERN);
  });

  it('kline 取数失败 → 「当日行情：数据暂不可用」，prod 不泄漏原始异常', async () => {
    const md = await buildAshareFactCard(
      { client: fakeClient({ kline: errEnv('This operation was aborted') }), now: NOW },
      ONE,
    );
    expect(md).toContain('当日行情：数据暂不可用');
    expect(md).not.toContain('aborted');
  });

  it('dev 模式保留原始异常', async () => {
    const md = await buildAshareFactCard(
      { client: fakeClient({ kline: errEnv('boom') }), now: NOW, mode: 'dev' },
      ONE,
    );
    expect(md).toContain('数据暂不可用（boom）');
  });

  it('龙虎榜空集 → 「当日无龙虎榜数据」；命中股不在榜 → 「当日未上榜」', async () => {
    const empty = await buildAshareFactCard({ client: fakeClient({ dt: env([]) }), now: NOW }, ONE);
    expect(empty).toContain('当日无龙虎榜数据');
    const other = await buildAshareFactCard(
      { client: fakeClient({ dt: env([{ 代码: '000001', 上榜原因: 'x' }]) }), now: NOW },
      ONE,
    );
    expect(other).toContain('当日未上榜');
  });

  it('公告窗口内无新公告 → 「近 7 日无新公告」', async () => {
    const md = await buildAshareFactCard({ client: fakeClient({ ann: env([]) }), now: NOW }, ONE);
    expect(md).toContain('近 7 日无新公告');
  });
});
