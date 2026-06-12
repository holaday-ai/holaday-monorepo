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
import type { AkEnvelope, NorthboundRow, PremarketBriefingInput } from './briefing-types.js';

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

  it('自选股公告按股分组 + 巨潮链接', () => {
    expect(md).toContain('**贵州茅台（600519）**');
    expect(md).toContain('06-10 贵州茅台2025年年度权益分派实施公告 — [巨潮](http');
    expect(md).toContain('近期无新公告'); // 300750 公告为空
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

  it('龙虎榜只列自选股命中(宁德时代)，含 akshare 解读列，过滤非自选股', () => {
    expect(md).toContain(
      '宁德时代（300750）：日跌幅偏离值达7%的证券 ｜ 龙虎榜净买额 +1.20亿元 ｜ 解读：主力净卖出，机构现身卖方',
    );
    expect(md).not.toContain('中国国航');
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
