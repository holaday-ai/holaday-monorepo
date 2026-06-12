/**
 * Phase 1 指令 #2 ③ — 简报渲染器单测（选1扩展版）.
 *
 * 锁住：内容结构 + 合规不变量 + dev/prod 双模 + 北向口径降级 + 单位「亿元」。
 * 合规哨兵：渲染输出**不出现任何买卖建议措辞**（日后加 LLM 解读漏合规会先红）。
 */

import { describe, expect, it } from 'vitest';
import { POSTMARKET_SAMPLE, PREMARKET_SAMPLE } from './briefing-fixtures.js';
import {
  BRIEFING_DISCLAIMER,
  renderPostmarketBriefing,
  renderPremarketBriefing,
} from './briefing-renderer.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  IndexRow,
  NorthboundRow,
  PremarketBriefingInput,
} from './briefing-types.js';

/** 投资建议措辞黑名单（针对「荐股」措辞，不误伤 净买额/买入成交额 等事实字段）。 */
const ADVICE_PATTERN =
  /建议(买入|卖出|买|卖|加仓|减仓|持有)|目标价|必涨|必跌|强烈推荐|涨停可期|抄底|梭哈|满仓|清仓|值得(买入|入手)/;

describe('renderPremarketBriefing（默认 prod）', () => {
  const md = renderPremarketBriefing(PREMARKET_SAMPLE);

  it('标题 + 日期(周几) + 生成时间', () => {
    expect(md).toContain('# 📋 HOLA DAY · A股盘前简报');
    expect(md).toContain('2026-06-11（周四）');
    expect(md).toContain('生成于 08:30');
  });

  it('G1 隔夜外围：美股三大指数各带收盘 + 隔夜涨跌幅', () => {
    expect(md).toContain('标普500 5,433.21（+0.62%）');
    expect(md).toContain('道琼斯 39,200.00（+0.51%）');
    expect(md).toContain('纳斯达克 17,050.30（+0.85%）');
    expect(md).toContain('恒生指数：18,756.40，+0.92%');
  });

  it('G2 今日关键事项：个股解禁(亿元) + 公告关键词', () => {
    expect(md).toContain('**限售解禁**');
    expect(md).toContain('贵州茅台（600519）：06-20 解禁（流通市值 18.96亿元）');
    expect(md).toContain('疑似「权益分派」');
  });

  it('自选股公告按股分组 + 巨潮链接（空公告股不单列）', () => {
    expect(md).toContain('**贵州茅台（600519）**');
    expect(md).toContain('06-10 贵州茅台2025年年度权益分派实施公告 — [巨潮](http');
    expect(md).not.toContain('**宁德时代（300750）**'); // 300750 公告为空 → 不单列
  });

  it('上一交易日龙虎榜回顾段：标日期 + 只列自选股命中 + 解读列 + 过滤非自选股', () => {
    expect(md).toContain('## 四、上一交易日龙虎榜回顾（2026-06-10（周三））');
    expect(md).toContain(
      '宁德时代（300750）：日跌幅偏离值达7%的证券 ｜ 龙虎榜净买额 +1.20亿元 ｜ 解读：主力净卖出，机构现身卖方',
    );
    expect(md).not.toContain('中国国航'); // 非自选股过滤
  });

  it('prod 模式无任何 [dev] 诊断行', () => {
    expect(md).not.toContain('[dev]');
  });

  it('结尾固定免责声明', () => {
    expect(md).toContain(BRIEFING_DISCLAIMER);
    expect(md).toContain('> **免责声明**');
  });

  it('合规：不含任何买卖建议措辞', () => {
    expect(md).not.toMatch(ADVICE_PATTERN);
  });
});

describe('renderPremarketBriefing（dev）', () => {
  it('dev 模式带 G2 backlog 诊断', () => {
    const md = renderPremarketBriefing(PREMARKET_SAMPLE, { mode: 'dev' });
    expect(md).toContain('[dev] G2');
    expect(md).toContain('新股日历');
  });
});

describe('renderPostmarketBriefing（默认 prod）', () => {
  const md = renderPostmarketBriefing(POSTMARKET_SAMPLE);

  it('G3 大盘速览：指数 → 成交额（顺序；北向停披露被省略）', () => {
    expect(md).toContain('## 一、大盘速览');
    expect(md).toContain('指数：上证指数 3,125.40（+0.42%）');
    expect(md).toContain('创业板指 1,987.30（-0.25%）');
    expect(md).toContain('成交额：上证指数 4350.00亿元');
    expect(md.indexOf('- 指数：')).toBeLessThan(md.indexOf('- 成交额：'));
  });

  it('北向资金停披露(0.0) → 整行省略，不显示 +0.00', () => {
    expect(md).not.toContain('- 北向资金');
    expect(md).not.toContain('+0.00亿元');
  });

  it('自选股当日表现表格 + 成交额「亿元」', () => {
    expect(md).toContain('| 名称 | 代码 | 收盘 | 涨跌幅 | 成交额 |');
    expect(md).toContain('| 贵州茅台 | 600519 | 1,580.00 | +1.23% | 38.20亿元 |');
    expect(md).toContain('| 宁德时代 | 300750 | 198.50 | -0.85% | 41.00亿元 |');
  });

  it('盘后不再含龙虎榜段（已移到盘前回顾）', () => {
    expect(md).not.toContain('龙虎榜');
    expect(md).not.toContain('## 三、龙虎榜');
  });

  it('prod 无 [dev]，含免责，合规无建议措辞', () => {
    expect(md).not.toContain('[dev]');
    expect(md).toContain(BRIEFING_DISCLAIMER);
    expect(md).not.toMatch(ADVICE_PATTERN);
  });
});

describe('北向资金 2024-08 停披露（0.0 → 整行省略）', () => {
  it('北向 0.0 → prod 省略整行，dev 给诊断（POSTMARKET_SAMPLE 已是停披露形态）', () => {
    const prod = renderPostmarketBriefing(POSTMARKET_SAMPLE, { mode: 'prod' });
    expect(prod).not.toContain('- 北向资金');
    expect(prod).not.toContain('[dev]');
    const dev = renderPostmarketBriefing(POSTMARKET_SAMPLE, { mode: 'dev' });
    expect(dev).toContain('[dev] 北向净买额停披露');
  });

  it('若恢复披露(非 0) → 仅北向行展示，南向港股通不混入', () => {
    const disclosedNb: AkEnvelope<NorthboundRow> = {
      data: [
        { 板块: '沪股通', 资金方向: '北向', 成交净买额: 25.3 },
        { 板块: '深股通', 资金方向: '北向', 成交净买额: 16.88 },
        { 板块: '港股通(沪)', 资金方向: '南向', 成交净买额: -4.2 },
      ],
      count: 3,
      source: 'akshare:stock_hsgt_fund_flow_summary_em',
      fetched_at: '2026-06-11T07:25:00Z',
      disclaimer: 'x',
    };
    const md = renderPostmarketBriefing({ ...POSTMARKET_SAMPLE, northbound: disclosedNb });
    expect(md).toContain('北向资金：沪股通 净买额 +25.30亿元 ｜ 深股通 净买额 +16.88亿元');
    expect(md).not.toContain('港股通(沪)'); // 南向不混入北向资金行
  });
});

describe('验收新增：异常非泄漏 / 链接 / 龙虎榜空集 / 无新公告', () => {
  const errUs: AkEnvelope<IndexRow> = {
    data: [],
    count: 0,
    source: 'http:/index/us',
    fetched_at: '2026-06-11T00:25:00Z',
    disclaimer: 'x',
    error: "接口调用失败: 'NoneType' object is not subscriptable",
  };

  it('prod：error envelope 只显示「数据暂不可用」，原始异常不泄漏', () => {
    const md = renderPremarketBriefing({ ...PREMARKET_SAMPLE, indexUs: errUs });
    expect(md).toContain('- 美股：数据暂不可用');
    expect(md).not.toContain('NoneType');
    expect(md).not.toContain('接口调用失败');
  });

  it('dev：保留原始异常便于排查', () => {
    const md = renderPremarketBriefing({ ...PREMARKET_SAMPLE, indexUs: errUs }, { mode: 'dev' });
    expect(md).toContain('数据暂不可用（接口调用失败');
  });

  it('公告链接含空格/圆括号 → safeLinkUrl 编码（不裸 URL 断链，P2-1）', () => {
    const withSpace: PremarketBriefingInput = {
      ...PREMARKET_SAMPLE,
      announcements: {
        '600519': {
          data: [
            {
              公告标题: '某公告',
              公告时间: '2026-06-10',
              // 同时含空格 + 圆括号（encodeURI 不编码括号 → 会断链）。
              公告链接: 'http://x.cn/d?t=2026-06-10 20:50:29&n=(test)',
            },
          ],
          count: 1,
          source: 's',
          fetched_at: '2026-06-11T00:26:00Z',
          disclaimer: 'x',
        },
      },
      shareUnlock: {},
    };
    const md = renderPremarketBriefing(withSpace);
    expect(md).toContain('[巨潮](http://x.cn/d?t=2026-06-10%2020:50:29&n=%28test%29)');
    expect(md).not.toContain('20:50:29)'); // 原始空格不再断链
    expect(md).not.toContain('(test)'); // 原始括号已编码
  });

  it('龙虎榜全市场空集(count=0，未发布) → 友好提示而非「上榜」', () => {
    const emptyDt: AkEnvelope<DragonTigerRow> = {
      data: [],
      count: 0,
      source: 'akshare:stock_lhb_detail_em(当日无数据)',
      fetched_at: '2026-06-11T00:27:00Z',
      disclaimer: 'x',
    };
    const md = renderPremarketBriefing({ ...PREMARKET_SAMPLE, dragonTiger: emptyDt });
    expect(md).toContain('当日无龙虎榜数据');
  });

  it('盘后全员当日无新公告 → 整段收敛为「今日无新公告」', () => {
    const emptyAnn = (): AkEnvelope<AnnouncementRow> => ({
      data: [],
      count: 0,
      source: 's',
      fetched_at: '2026-06-11T07:26:00Z',
      disclaimer: 'x',
    });
    const md = renderPostmarketBriefing({
      ...POSTMARKET_SAMPLE,
      announcements: { '600519': emptyAnn(), '300750': emptyAnn(), '000001': emptyAnn() },
    });
    expect(md).toContain('今日无新公告');
  });
});

describe('v2 盘后：速读 / 市场温度计 / 板块主线（BOSS 四原则）', () => {
  const md = renderPostmarketBriefing(POSTMARKET_SAMPLE);

  it('原则1 金字塔：顶部一行「今日速读」压缩 5 项关键指标', () => {
    expect(md).toContain('📊 **今日速读**：沪指 +0.42%');
    expect(md).toContain('涨3208/跌1892');
    expect(md).toContain('涨停87(炸板28.1%)');
    expect(md).toContain('主力净流入+86亿');
    expect(md).toContain('主线:汽车零部件');
  });

  it('原则2 固定段序：速读 → 大盘 → 温度计 → 板块主线 → 自选股 → 公告', () => {
    const order = [
      '今日速读',
      '## 一、大盘速览',
      '## 二、市场温度计',
      '## 三、板块主线',
      '## 四、自选股当日表现',
      '## 五、自选股新公告',
    ].map((s) => md.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('市场温度计：涨停/连板/跌停/炸板率 + 涨跌家数/成交额/主力净流入（行内，无表格）', () => {
    expect(md).toContain('涨停 87 家，最高 5 连板');
    expect(md).toContain('跌停 3 家');
    expect(md).toContain('炸板 34 家（炸板率 28.1%）');
    expect(md).toContain('涨跌家数 3208/1892');
    expect(md).toContain('两市成交额 1.54万亿');
    expect(md).toContain('主力净流入 +86.00亿元');
  });

  it('板块主线：涨幅前5（含龙头领涨股）+ 跌幅前5', () => {
    expect(md).toContain('涨幅前5：汽车零部件 +3.20%（迪生力）');
    expect(md).toContain('小金属 +2.80%（金钼股份）');
    expect(md).toContain('跌幅前5：白酒 -2.10%');
  });

  it('原则3 数据密度：全文只有 1 张表（自选股表现），市场级数据全部行内化', () => {
    const tableSeparators = md.split('\n').filter((l) => /^\|[\s-]*:?-+:?[\s-]*\|/.test(l.trim()));
    expect(tableSeparators.length).toBe(1);
  });

  it('原则4 长度硬约束：盘后正文内容 ≤ 600 字，超了砍内容而非缩字号', () => {
    // BOSS「砍内容」的「内容」= 用户实读的正文：
    //   - 排除表格行（自选股表现 = 独立「+1表」预算）；
    //   - 排除段尾来源 +「免责声明」boilerplate（原则3 视觉噪音/合规 chrome，定长不随内容膨胀）；
    //   - markdown 链接只计可见文字（URL 不渲染、非阅读负担）。
    const content = md
      .split('\n')
      .filter((l) => !l.trim().startsWith('|')) // 表格 → +1表 预算
      .filter((l) => !l.includes('（来源')) // 段尾来源 chrome
      .filter((l) => !l.includes('免责声明') && l.trim() !== '---') // 免责 boilerplate
      .join('')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [巨潮](http…) → 巨潮
      .replace(/\s/g, '');
    expect(content.length).toBeLessThanOrEqual(600);
  });

  it('合规哨兵：纯指标，不出现任何周期定性/情绪标签（BOSS 红线）', () => {
    expect(md).not.toMatch(/高潮|退潮|冰点|亢奋|见顶|筑底|过热|恐慌|贪婪|牛市|熊市/);
    expect(md).not.toMatch(ADVICE_PATTERN);
  });

  it('marketPulse 不可达 → 温度计/板块降级「数据暂不可用」，速读仍出沪指（不崩）', () => {
    const errPulse = {
      data: [],
      count: 0,
      source: 'http:/market-pulse',
      fetched_at: '2026-06-11T07:25:00Z',
      disclaimer: 'x',
      error: 'HTTP 500',
    };
    const degraded = renderPostmarketBriefing({ ...POSTMARKET_SAMPLE, marketPulse: errPulse });
    expect(degraded).toContain('📊 **今日速读**：沪指 +0.42%'); // 速读不崩
    expect(degraded).toContain('市场温度：数据暂不可用');
    expect(degraded).toContain('板块：数据暂不可用');
    expect(degraded).not.toContain('NaN');
  });
});

describe('v2 盘前：昨日涨停回顾进龙虎榜回顾段', () => {
  it('盘前回顾段含「昨日涨停回顾」：家数 + 连板 + 活跃行业（纯指标）', () => {
    const md = renderPremarketBriefing(PREMARKET_SAMPLE);
    expect(md).toContain('**昨日涨停回顾**');
    expect(md).toContain('上一交易日涨停 72 家，最高 4 连板');
    expect(md).toContain('活跃行业 汽车零部件(6)、半导体(4)、证券(3)');
  });

  it('ztReview 缺失（旧数据） → prod 静默不出回顾行，不崩', () => {
    const { ztReview, ...noReview } = PREMARKET_SAMPLE;
    void ztReview;
    const md = renderPremarketBriefing(noReview);
    expect(md).not.toContain('**昨日涨停回顾**');
    expect(md).toContain(BRIEFING_DISCLAIMER); // 其余照常
  });
});

describe('边界', () => {
  it('空自选股 → 盘前优雅提示而非崩溃，免责仍在', () => {
    const empty: PremarketBriefingInput = {
      ...PREMARKET_SAMPLE,
      watchlist: [],
      announcements: {},
      shareUnlock: {},
    };
    const md = renderPremarketBriefing(empty);
    expect(md).toContain('自选股清单为空');
    expect(md).toContain(BRIEFING_DISCLAIMER);
  });
});

describe('日期星期（P1 时区 off-by-one 回归）', () => {
  // 2026-06-12 是周五（曾误显示周四：00:00+08:00 在 UTC runtime 退一天）。
  // 锁死：星期由「正午 UTC + getUTCDay()」算，与 runtime 时区无关。
  it.each([
    ['2026-06-11', '周四'],
    ['2026-06-12', '周五'],
    ['2026-06-13', '周六'],
    ['2026-06-14', '周日'],
    ['2026-06-15', '周一'],
  ])('%s → %s', (date, wd) => {
    expect(renderPremarketBriefing({ ...PREMARKET_SAMPLE, date })).toContain(`${date}（${wd}）`);
    expect(renderPostmarketBriefing({ ...POSTMARKET_SAMPLE, date })).toContain(`${date}（${wd}）`);
  });
});
