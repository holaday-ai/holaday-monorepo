/**
 * Phase 1 #2 ④ M2 — runner（LLM③ + 合规闸门 + 降级日志/计数）+ 异步 name-search 解析.
 */

import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { buildIndexCard } from './ashare-fact-card.js';
import { isIndexQuery, resolveAshareInContext, resolveAshareQa } from './ashare-qa-matcher.js';
import { ASHARE_QA_GUIDANCE, runAshareQa } from './ashare-qa-runner.js';
import type { AshareQaMatch, ResolvedStock } from './ashare-qa-types.js';

const MATCH: AshareQaMatch = {
  kind: 'anomaly',
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-06-12',
  dateCompact: '20260612',
};
const NOW = new Date('2026-06-12T07:00:00Z');

function env<T>(data: T[]) {
  return {
    data,
    count: data.length,
    source: 's',
    fetched_at: '2026-06-12T07:00:00Z',
    disclaimer: 'x',
  };
}
function fakeClient(): AkshareClient {
  return {
    getIndexQuote: () => Promise.resolve(env([])),
    getStockAnnouncements: () =>
      Promise.resolve(env([{ 公告标题: '2025年度股东会决议公告', 公告时间: '2026-06-12' }])),
    getShareUnlock: () => Promise.resolve(env([])),
    getStockKline: () =>
      Promise.resolve(env([{ 收盘: 1291.91, 涨跌幅: 1.01, 成交额: 6_478_000_000 }])),
    getDragonTiger: () => Promise.resolve(env([])),
    getNorthboundFlow: () =>
      Promise.resolve(env([{ 板块: '沪股通', 资金方向: '北向', 成交净买额: 0 }])),
    getTradingDay: () => Promise.resolve(env([{ is_trading_day: true }])),
    searchSymbol: () => Promise.resolve(env([])),
    // biome-ignore lint/suspicious/noExplicitAny: fake
  } as any;
}
function fakeLogger() {
  // biome-ignore lint/suspicious/noExplicitAny: log payload
  const warns: { obj: any; msg: string }[] = [];
  return {
    // biome-ignore lint/suspicious/noExplicitAny: log payload
    logger: { info: () => {}, warn: (obj: any, msg: string) => warns.push({ obj, msg }) },
    warns,
  };
}

describe('runAshareQa', () => {
  it('合规③ → 通过：含③ + 钉固定话术 + 免责，不降级', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAshareQa(
      {
        client: fakeClient(),
        skillMarkdown: '你是 A股分析师，只聚合不荐股。',
        interpret: async () => '- 本次上涨或与近期股东会决议公告披露有关',
        logger,
        now: NOW,
      },
      MATCH,
    );
    expect(r.degraded).toBe(false);
    expect(r.interpreted).toBe(true);
    expect(r.answer).toContain('## ③ 可能相关因素');
    expect(r.answer).toContain('以上因素与股价变动的关联未经证实'); // 缺则自动补
    expect(r.answer).toContain('免责声明');
    expect(warns).toHaveLength(0);
  });

  it('诱导买卖 → 降级为纯数据 + 打日志(event=ashare_qa_degrade,reason)', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAshareQa(
      {
        client: fakeClient(),
        skillMarkdown: 's',
        interpret: async () => '建议逢低买入，目标价 1500 元',
        logger,
        now: NOW,
        context: { userId: 'usr_x', taskId: 'tsk_y' },
      },
      MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('advice');
    expect(r.answer).toContain('降级为**纯数据呈现**');
    expect(r.answer).not.toContain('## ③ 可能相关因素');
    // 降级必打日志 + 计数（event 字段 = 计数锚点）
    const hit = warns.find((w) => w.obj?.event === 'ashare_qa_degrade');
    expect(hit).toBeTruthy();
    expect(hit?.obj.reason).toBe('advice');
    expect(hit?.obj.userId).toBe('usr_x');
  });

  it('LLM 自带「③ 可能相关因素」标题行 → 剥重复标题（不双标题，P2-2）', async () => {
    const { logger } = fakeLogger();
    const r = await runAshareQa(
      {
        client: fakeClient(),
        skillMarkdown: 's',
        interpret: async () => '③ 可能相关因素\n\n• 或与近期公告有关',
        logger,
        now: NOW,
      },
      MATCH,
    );
    expect(r.interpreted).toBe(true);
    expect(r.answer).toContain('## ③ 可能相关因素（分析师判断 · 非定论）');
    expect(r.answer).toContain('• 或与近期公告有关');
    expect(r.answer).not.toMatch(/分析师判断 · 非定论）\n+③ 可能相关因素/);
  });

  it('LLM 返回空 → 无③ + 记日志（P2-2）', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAshareQa(
      { client: fakeClient(), skillMarkdown: 's', interpret: async () => '   ', logger, now: NOW },
      MATCH,
    );
    expect(r.interpreted).toBe(false);
    expect(r.answer).not.toContain('## ③');
    expect(warns.some((w) => /空解读/.test(w.msg))).toBe(true);
  });

  it('诱导预测 → 降级(predict)', async () => {
    const { logger } = fakeLogger();
    const r = await runAshareQa(
      {
        client: fakeClient(),
        skillMarkdown: 's',
        interpret: async () => '后市有望继续上涨',
        logger,
        now: NOW,
      },
      MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('predict');
  });

  it('无技能上下文 → 纯事实卡（不解读不降级）', async () => {
    const { logger } = fakeLogger();
    const r = await runAshareQa(
      { client: fakeClient(), interpret: async () => 'x', logger, now: NOW },
      MATCH,
    );
    expect(r.interpreted).toBe(false);
    expect(r.degraded).toBe(false);
    expect(r.answer).toContain('① 盘面事实');
    expect(r.answer).not.toContain('## ③');
  });

  it('LLM 调用失败 → 回退纯数据（非合规降级，不记 degrade）', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAshareQa(
      {
        client: fakeClient(),
        skillMarkdown: 's',
        interpret: async () => {
          throw new Error('boom');
        },
        logger,
        now: NOW,
      },
      MATCH,
    );
    expect(r.interpreted).toBe(false);
    expect(r.degraded).toBe(false);
    expect(warns.find((w) => w.obj?.event === 'ashare_qa_degrade')).toBeUndefined();
  });
});

describe('resolveAshareQa（异步 name-search）', () => {
  const WL: ResolvedStock[] = [{ symbol: '600519', displayName: '贵州茅台' }];

  it('sync 命中（代码）→ 直接返回，不调 name-search', async () => {
    let called = false;
    const m = await resolveAshareQa(
      { intent: '600519为什么涨', watchlist: WL, now: NOW },
      async () => {
        called = true;
        return [];
      },
    );
    expect(m?.stocks[0]?.symbol).toBe('600519');
    expect(called).toBe(false);
  });

  it('门槛过但无 sync 个股 → name-search 补（短名/非自选全名）', async () => {
    const m = await resolveAshareQa(
      { intent: '比亚迪今天为什么跌', watchlist: WL, now: NOW },
      async () => [{ symbol: '002594', displayName: '比亚迪' }],
    );
    expect(m?.stocks).toEqual([{ symbol: '002594', displayName: '比亚迪' }]);
  });

  it('name-search 返空 → null（降级走通用路径）', async () => {
    const m = await resolveAshareQa(
      { intent: '行情怎么样啊', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(m).toBeNull();
  });

  it('非 A股问题 → null，不调 name-search', async () => {
    let called = false;
    const m = await resolveAshareQa(
      { intent: '今天天气怎么样', watchlist: WL, now: NOW },
      async () => {
        called = true;
        return [];
      },
    );
    expect(m).toBeNull();
    expect(called).toBe(false);
  });

  it('持仓语境词「茅台套牢了」短名 → name-search 命中 600519（Q3 修）', async () => {
    const m = await resolveAshareQa(
      { intent: '茅台套牢了怎么办', watchlist: WL, now: NOW },
      async () => [{ symbol: '600519', displayName: '贵州茅台' }],
    );
    expect(m?.stocks[0]?.symbol).toBe('600519');
  });
});

describe('resolveAshareInContext（启用技能·signal-based 门控，BOSS 反向用例长期保留）', () => {
  const WL: ResolvedStock[] = [{ symbol: '600519', displayName: '贵州茅台' }];
  it('已启用 + 「帮我写个周报」(无 A股信号) → 放行通用（match=null, hasSignal=false）', async () => {
    const r = await resolveAshareInContext(
      { intent: '帮我写个周报', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(r.match).toBeNull();
    expect(r.hasSignal).toBe(false);
  });

  it('已启用 + 「被套了怎么办」(持仓语境词，无个股) → 引导兜底（match=null, hasSignal=true）', async () => {
    const r = await resolveAshareInContext(
      { intent: '被套了怎么办', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(r.match).toBeNull();
    expect(r.hasSignal).toBe(true);
  });

  it('已启用 + 「茅台为什么涨」短名 → name-search 命中 → 出 lane', async () => {
    const r = await resolveAshareInContext(
      { intent: '茅台为什么涨', watchlist: WL, now: NOW },
      async () => [{ symbol: '600519', displayName: '贵州茅台' }],
    );
    expect(r.match?.stocks[0]?.symbol).toBe('600519');
    expect(r.hasSignal).toBe(true);
  });
});

describe('E16 回归：指数查询走指数 lane，不误命中个股（勿删）', () => {
  const WL: ResolvedStock[] = [{ symbol: '600519', displayName: '贵州茅台' }];
  // 这个 search fn 模拟服务端短名窗口把「今天」误命中「今天国际(300532)」——必须**不被调用**。
  const trapSearch = async () => [{ symbol: '300532', displayName: '今天国际' }];

  it('isIndexQuery：指数/大盘问句 true，个股问句 false', () => {
    expect(isIndexQuery('查今天A股三大指数收盘')).toBe(true);
    expect(isIndexQuery('大盘今天怎么样')).toBe(true);
    expect(isIndexQuery('上证指数多少点')).toBe(true);
    expect(isIndexQuery('茅台为什么涨')).toBe(false);
  });

  it('「查今天A股三大指数收盘」→ indexIntent=true，match=null，**不调 name-search**（不命中 300532）', async () => {
    let searched = false;
    const r = await resolveAshareInContext(
      { intent: '查今天A股三大指数收盘', watchlist: WL, now: NOW },
      async () => {
        searched = true;
        return trapSearch();
      },
    );
    expect(r.indexIntent).toBe(true);
    expect(r.match).toBeNull(); // 不会变成今天国际(300532)
    expect(r.hasSignal).toBe(true);
    expect(searched).toBe(false); // 指数问句不进 name-search
  });

  it('长查询（>16字，无个股指向）不 name-search（防长句乱匹配名称）', async () => {
    let searched = false;
    const r = await resolveAshareInContext(
      { intent: '今天有什么消息可以帮我整理一下最近的情况吗谢谢', watchlist: WL, now: NOW },
      async () => {
        searched = true;
        return trapSearch();
      },
    );
    expect(searched).toBe(false);
    expect(r.match).toBeNull();
  });

  it('短个股问句仍正常 name-search（不误伤）', async () => {
    let searched = false;
    const r = await resolveAshareInContext(
      { intent: '比亚迪为什么涨', watchlist: WL, now: NOW },
      async () => {
        searched = true;
        return [{ symbol: '002594', displayName: '比亚迪' }];
      },
    );
    expect(searched).toBe(true);
    expect(r.match?.stocks[0]?.symbol).toBe('002594');
  });

  it('buildIndexCard：渲染三大指数 + 免责（指数 lane 产物）', async () => {
    const idxClient = {
      getIndexQuote: () =>
        Promise.resolve({
          data: [
            { 名称: '上证指数', 代码: 'sh000001', 最新价: 4031.51, 涨跌幅: 1.12, 成交额: 1.5e12 },
            { 名称: '深证成指', 代码: 'sz399001', 最新价: 14963.41, 涨跌幅: 0.75, 成交额: 1.6e12 },
            { 名称: '创业板指', 代码: 'sz399006', 最新价: 3830.35, 涨跌幅: 0.5, 成交额: 8e11 },
          ],
          count: 3,
          source: 'akshare:stock_zh_index_spot_sina',
          fetched_at: '2026-06-12T07:25:00Z',
          disclaimer: 'x',
        }),
      // biome-ignore lint/suspicious/noExplicitAny: fake
    } as any;
    const md = await buildIndexCard({ client: idxClient, now: NOW });
    expect(md).toContain('A股大盘速览');
    expect(md).toContain('上证指数 4,031.51（+1.12%）');
    expect(md).toContain('创业板指 3,830.35（+0.50%）');
    expect(md).toContain('免责声明');
    expect(md).not.toContain('今天国际');
  });
});

describe('ASHARE_QA_GUIDANCE（P0 兜底引导话术）', () => {
  it('含引导 + 免责 + 不含任何买卖/预测措辞', () => {
    expect(ASHARE_QA_GUIDANCE).toContain('股票名称或代码');
    expect(ASHARE_QA_GUIDANCE).toContain('免责声明');
    expect(ASHARE_QA_GUIDANCE).toContain('不提供买卖建议');
    // 静态引导本身不得含建议/预测措辞
    expect(ASHARE_QA_GUIDANCE).not.toMatch(/建议买入|目标价|会涨|会跌|抄底|割肉/);
  });
});
