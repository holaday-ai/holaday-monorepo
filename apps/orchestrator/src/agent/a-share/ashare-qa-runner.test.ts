/**
 * Phase 1 #2 ④ M2 — runner（LLM③ + 合规闸门 + 降级日志/计数）+ 异步 name-search 解析.
 */

import { describe, expect, it } from 'vitest';
import type { AkshareClient } from './akshare-client.js';
import { buildIndexCard } from './ashare-fact-card.js';
import {
  isDeepQuery,
  isIndexQuery,
  resolveAshareInContext,
  resolveAshareQa,
} from './ashare-qa-matcher.js';
import { ASHARE_QA_GUIDANCE, runAsharePanorama, runAshareQa } from './ashare-qa-runner.js';
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
    getFundamentals: () =>
      Promise.resolve(
        env([
          {
            report_period: '2026-03-31',
            revenue: 1.71e8,
            revenue_yoy: -33.43,
            revenue_qoq: -12.5,
            net_profit: -1.98172e7,
            net_profit_yoy: 12.4,
            net_profit_qoq: -122.75,
            deduct_net_profit: -1.98452e7,
            deduct_net_profit_yoy: 12.17,
            gross_margin: 18.48,
            net_margin: -14.31,
            roe: -6.76,
            debt_ratio: 64.65,
            ocf_per_share: 0.03,
            trend3y: [
              { report_period: '2023-12-31', net_profit: -1.49e8 },
              { report_period: '2024-12-31', net_profit: -1.45e8 },
              { report_period: '2025-12-31', net_profit: 4.848e7 },
            ],
          },
        ]),
      ),
    getValuation: () =>
      Promise.resolve(
        env([
          {
            pe_ttm: 67.2,
            pb: 12.21,
            pe_pctile_5y: 87.1,
            pb_pctile_5y: 95.1,
            as_of: '2026-06-14',
            total_mv_yi: 34.47,
            industry: '汽车制造业',
            industry_pe_median: 31.63,
          },
        ]),
      ),
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

describe('Phase2 全景速览：deep 触发 + ⑦ 分析师视角（勿删）', () => {
  const WL: ResolvedStock[] = [{ symbol: '603335', displayName: '迪生力' }];
  const DEEP_MATCH: AshareQaMatch = {
    kind: 'info',
    stocks: [{ symbol: '603335', displayName: '迪生力' }],
    dateIso: '2026-06-14',
    dateCompact: '20260614',
    deep: true,
  };

  it('isDeepQuery：深度意图 true，轻量速览 false', () => {
    expect(isDeepQuery('详细分析迪生力')).toBe(true);
    expect(isDeepQuery('全面看看茅台')).toBe(true);
    expect(isDeepQuery('深度分析600519')).toBe(true);
    expect(isDeepQuery('迪生力为什么涨')).toBe(false);
    expect(isDeepQuery('茅台速览')).toBe(false);
  });

  it('deep 意图带个股 → match.deep=true；普通问句不误触发', async () => {
    const deep = await resolveAshareInContext(
      { intent: '详细分析迪生力', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(deep.match?.deep).toBe(true);
    const light = await resolveAshareInContext(
      { intent: '迪生力为什么涨', watchlist: WL, now: NOW },
      async () => [],
    );
    expect(light.match?.deep).toBe(false);
  });

  it('合规 ⑦ → 全景版含 ①-⑤ + ⑦分析师视角，不降级', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () =>
          '迪生力是总市值34.47亿的小盘股，今天盘面活跃；2026Q1营收1.71亿、同比-33.43%，归母还亏1981.72万但亏损收窄，近几年盈利不稳；估值偏高，PE-TTM67.2、PB12.21都处历史高位，比行业中位31.63贵。一句话：盈利不稳、估值在历史高位的小盘股。以上为客观信息聚合，未经证实，不构成任何投资建议。',
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(false);
    expect(r.interpreted).toBe(true);
    expect(r.answer).toContain('全景速览');
    expect(r.answer).toContain('**④ 基本面**');
    expect(r.answer).toContain('PE-TTM 67.20'); // ⑤ 估值确定性渲染
    expect(r.answer).toContain('## ⑦ 分析师视角');
    expect(r.answer).toContain('免责声明');
  });

  it('④⑤ 确定性段：纯数字 + 时效标注，零判断形容词', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      { client: fakeClient(), interpret: async () => '客观状态画像。', logger, now: NOW },
      DEEP_MATCH,
    );
    expect(r.answer).toContain('基于 2026Q1财报，会计准则 CAS');
    expect(r.answer).toContain('估值截至 06-14');
    expect(r.answer).toContain('营业总收入 1.71亿元（同比 -33.43%，环比 -12.50%）'); // P1 季度环比
    expect(r.answer).toContain('归母净利润 -1981.72万元（同比 +12.40%，环比 -122.75%）');
    expect(r.answer).toContain('扣非净利润 -1984.52万元'); // P1 扣非
    expect(r.answer).toContain('净利率 -14.31%');
    expect(r.answer).toContain('每股经营现金流 0.03 元'); // P1 现金流
    expect(r.answer).toContain('行业静态PE中位 31.63（本股 PE-TTM 高于行业中位）'); // P1 行业对比落地
  });

  it('⑦ 含买卖词 → 降级，丢⑦留①-⑤数据', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => '估值偏高，建议逢低买入，目标价翻倍',
        logger,
        now: NOW,
        context: { userId: 'u', taskId: 't' },
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.answer).not.toContain('## ⑦ 分析师视角');
    expect(r.answer).toContain('**④ 基本面**'); // ①-⑤ 数据围栏隔离，仍在
    expect(
      warns.some((w) => w.obj?.event === 'ashare_qa_degrade' && w.obj?.lane === 'panorama'),
    ).toBe(true);
  });

  it('⑦ 凭空捏造估值数（PE 90）→ 降级 ungrounded', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      { client: fakeClient(), interpret: async () => 'PE-TTM 90，估值中性', logger, now: NOW },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe('ungrounded');
  });

  // ── Phase2 ⑦ 第二层：LLM 意图判官（regex 之后，BOSS 拍板。双层不削弱+救误杀，勿删）──
  // 接地、无买卖/技术黑话，但 "跌到" 触发 SOFT(predict) regex → 是 regex 误杀典型，judge 可救回。
  const SOFT_PREDICT =
    '股价已从高位跌到近期低点，估值仍处历史高位区间。以上为客观信息聚合，不构成投资建议。';
  // 接地且过 regex 的合规⑦（沿用上文"合规⑦"用例原文）。
  const GROUNDED_OK =
    '迪生力是总市值34.47亿的小盘股，今天盘面活跃；2026Q1营收1.71亿、同比-33.43%，归母还亏1981.72万但亏损收窄；估值偏高，PE-TTM67.2、PB12.21都处历史高位，比行业中位31.63贵。以上为客观信息聚合，未经证实，不构成任何投资建议。';

  it('judge 未注入 → regex-only 原行为：SOFT 命中即降级（零变化）', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      { client: fakeClient(), interpret: async () => SOFT_PREDICT, logger, now: NOW },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true); // 无 judge，"跌到"误杀照旧（这正是要救的）
  });

  it('judge 开 + SOFT 误杀 + judge pass → 救回⑦（不降级，拉高通过率）', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => SOFT_PREDICT,
        judge: async () => '{"verdict":"pass","redline":"none","quote":""}',
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(false);
    expect(r.interpreted).toBe(true);
    expect(r.answer).toContain('## ⑦ 分析师视角');
  });

  it('judge 开 + SOFT + judge block → 维持降级（judge 同意 regex）', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => SOFT_PREDICT,
        judge: async () => '{"verdict":"block","redline":"B","quote":"跌到"}',
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.answer).not.toContain('## ⑦ 分析师视角');
  });

  it('judge 开 + SOFT + judge 失败(unclear) → 回落 regex（仍降级，不放过误杀）', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => SOFT_PREDICT,
        judge: async () => {
          throw new Error('judge down');
        },
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true); // SOFT 通道 fail-closed
  });

  it('judge 开 + regex PASS + judge block → 补抓 regex 漏网，降级 reason=judge', async () => {
    const { logger, warns } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => GROUNDED_OK,
        judge: async () => '{"verdict":"block","redline":"B","quote":"暗示后市"}',
        logger,
        now: NOW,
        context: { userId: 'u', taskId: 't' },
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true);
    expect(r.answer).not.toContain('## ⑦ 分析师视角');
    expect(r.answer).toContain('**④ 基本面**'); // ①-⑤ 安全网仍在
    expect(warns.some((w) => w.obj?.reason === 'judge' && w.obj?.layer === 'intent-judge')).toBe(
      true,
    );
  });

  it('judge 开 + regex PASS + judge 失败(unclear) → 仍出⑦（稳定优先，不制造新降级）', async () => {
    const { logger } = fakeLogger();
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => GROUNDED_OK,
        judge: async () => {
          throw new Error('judge down');
        },
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(false); // PASS 通道 fail-open：regex 已背书，judge 抖动不拉下马
    expect(r.interpreted).toBe(true);
    expect(r.answer).toContain('## ⑦ 分析师视角');
  });

  it('judge 开 + HARD(advice) → regex 终判降级，judge 根本不被调用', async () => {
    const { logger } = fakeLogger();
    let judgeCalls = 0;
    const r = await runAsharePanorama(
      {
        client: fakeClient(),
        interpret: async () => '估值偏高，建议逢低买入，目标价翻倍',
        judge: async () => {
          judgeCalls += 1;
          return '{"verdict":"pass","redline":"none","quote":""}'; // 即便 judge 想放行
        },
        logger,
        now: NOW,
      },
      DEEP_MATCH,
    );
    expect(r.degraded).toBe(true); // HARD 红线不可救
    expect(judgeCalls).toBe(0); // judge 不介入 HARD，红线 regex 终判
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
