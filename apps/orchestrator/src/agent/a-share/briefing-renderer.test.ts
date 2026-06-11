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

  it('G3 大盘速览：指数 → 成交额 → 北向（顺序）', () => {
    expect(md).toContain('## 一、大盘速览');
    expect(md).toContain('指数：上证指数 3,125.40（+0.42%）');
    expect(md).toContain('创业板指 1,987.30（-0.25%）');
    expect(md).toContain('成交额：上证指数 4350.00亿元');
    // 顺序：指数行在成交额行之前，成交额行在北向行之前
    const iIdx = md.indexOf('- 指数：');
    const iAmt = md.indexOf('- 成交额：');
    const iNb = md.indexOf('- 北向资金');
    expect(iIdx).toBeLessThan(iAmt);
    expect(iAmt).toBeLessThan(iNb);
  });

  it('北向资金（有净买额口径）带正负号 + 亿元', () => {
    expect(md).toContain('北向资金：沪股通 净买额 +25.30亿元 ｜ 深股通 净买额 +16.88亿元');
  });

  it('自选股当日表现表格 + 成交额「亿元」', () => {
    expect(md).toContain('| 名称 | 代码 | 收盘 | 涨跌幅 | 成交额 |');
    expect(md).toContain('| 贵州茅台 | 600519 | 1,580.00 | +1.23% | 38.20亿元 |');
    expect(md).toContain('| 宁德时代 | 300750 | 198.50 | -0.85% | 41.00亿元 |');
  });

  it('龙虎榜只列自选股命中(宁德时代)，单位亿元，过滤非自选股', () => {
    expect(md).toContain('宁德时代（300750）：日跌幅偏离值达7%的证券 ｜ 龙虎榜净买额 +1.20亿元');
    expect(md).not.toContain('中国国航');
  });

  it('prod 无 [dev]，含免责，合规无建议措辞', () => {
    expect(md).not.toContain('[dev]');
    expect(md).toContain(BRIEFING_DISCLAIMER);
    expect(md).not.toMatch(ADVICE_PATTERN);
  });
});

describe('北向净买额口径降级（2024-08 规则变更）', () => {
  const degradedNb: AkEnvelope<NorthboundRow> = {
    data: [
      { 板块: '沪股通', 成交额: 599.5, 买入成交额: 312.4, 卖出成交额: 287.1 },
      { 板块: '深股通', 成交额: 544.3 },
    ],
    count: 2,
    source: 'akshare:stock_hsgt_fund_flow_summary_em',
    fetched_at: '2026-06-11T07:25:00Z',
    disclaimer: 'x',
  };

  it('净买额不可得 → 降级为成交额并明确标注，禁用过期口径', () => {
    const md = renderPostmarketBriefing(
      { ...POSTMARKET_SAMPLE, northbound: degradedNb },
      { mode: 'prod' },
    );
    expect(md).toContain('净买额口径 2024-08 后已停披露');
    expect(md).toContain('沪股通 成交额 599.50亿元');
    expect(md).not.toContain('净买额 +25.30'); // 不再用净买额口径
    expect(md).not.toContain('[dev]'); // prod 仍无诊断
  });

  it('dev 模式额外给降级诊断', () => {
    const md = renderPostmarketBriefing(
      { ...POSTMARKET_SAMPLE, northbound: degradedNb },
      { mode: 'dev' },
    );
    expect(md).toContain('[dev] 北向净买额缺失');
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
