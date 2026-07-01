/**
 * 看懂层 P1 — 注解引擎单测：逐指标档位 + **合规哨兵**（长期保留，勿删）.
 *
 * 哨兵 = BOSS 硬要求：任何注解输出（measure + note）**绝不含** 买/卖/涨/跌/好/差/建议/目标价。
 * 这组用例锁死「看懂层只陈述+风险提示、不下买卖/涨跌/好坏结论」，任何放松注解措辞的改动都先在此红。
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_SEETHROUGH_KEYS,
  type SeethroughKey,
  annotate,
  seethroughLine,
} from './annotation-engine.js';

describe('注解档位（腿A 确定性查表）', () => {
  it('A1 净利率：亏损/薄利/中等/较高', () => {
    expect(annotate('net_margin', { value: -5 })?.note).toContain('目前是亏损的');
    expect(annotate('net_margin', { value: 3 })?.note).toContain('赚得比较薄');
    expect(annotate('net_margin', { value: 10 })?.note).toContain('中等水平');
    expect(annotate('net_margin', { value: 20 })?.note).toContain('盈利比例较高');
    expect(annotate('net_margin', {})).toBeNull(); // 缺值不臆造
  });

  it('A2 扣非vs归母：主业在亏 / 实在 / 一次性多 / 归母≤0→null', () => {
    expect(annotate('deduct_vs_net', { value: -100, aux: 200 })?.note).toContain('主业其实在亏');
    expect(annotate('deduct_vs_net', { value: 180, aux: 200 })?.note).toContain('赚得比较实在');
    expect(annotate('deduct_vs_net', { value: 100, aux: 200 })?.note).toContain('一次性收入');
    expect(annotate('deduct_vs_net', { value: 50, aux: -100 })).toBeNull();
  });

  it('A4 ROE：偏低/中等/较高 + 恒附负债率', () => {
    expect(annotate('roe', { value: 3 })?.note).toContain('效率偏低');
    expect(annotate('roe', { value: 10 })?.note).toContain('中等水平');
    const high = annotate('roe', { value: 20 })?.note ?? '';
    expect(high).toContain('赚钱效率较高');
    expect(high).toContain('结合资产负债率一起看'); // 恒附
  });

  it('B1 营收同比：缩/增/快增', () => {
    expect(annotate('revenue_yoy', { value: -5 })?.note).toContain('营收比去年同期缩了');
    expect(annotate('revenue_yoy', { value: 8 })?.note).toContain('营收在增长');
    expect(annotate('revenue_yoy', { value: 30 })?.note).toContain('营收增长较快');
  });

  it('B2 净利同比：缩/增/快增 + 背离恒附（与营收反向才触发）', () => {
    expect(annotate('net_profit_yoy', { value: -5 })?.note).toContain('净利比去年同期缩了');
    // 营收增、利润缩 → 背离恒附
    expect(annotate('net_profit_yoy', { value: -5, aux: 10 })?.note).toContain('利润没跟上');
    // 同向（都增）→ 不触发背离
    expect(annotate('net_profit_yoy', { value: 20, aux: 10 })?.note).not.toContain('利润没跟上');
  });

  it('C2 负债率：稳健/中等/较高', () => {
    expect(annotate('debt_ratio', { value: 30 })?.note).toContain('财务比较稳健');
    expect(annotate('debt_ratio', { value: 50 })?.note).toContain('借债比例中等');
    expect(annotate('debt_ratio', { value: 80 })?.note).toContain('还债和利息压力');
  });

  it('C3 每股经营现金流：仅释义、无档位判断', () => {
    const a = annotate('ocf_per_share', { value: 0.5 });
    expect(a?.measure).toContain('每股经营现金流');
    expect(a?.note).toBe('');
  });

  it('A3 毛利率同比（P2）：提升/持平/下滑；缺同比或缺值 → null', () => {
    expect(annotate('gross_margin', { value: 40, yoy: 5 })?.note).toContain('明显提升');
    expect(annotate('gross_margin', { value: 40, yoy: 1 })?.note).toContain('基本持平');
    expect(annotate('gross_margin', { value: 40, yoy: -5 })?.note).toContain('明显下滑');
    expect(annotate('gross_margin', { value: 40 })).toBeNull(); // 无同比 = A3 不出
    expect(annotate('gross_margin', { yoy: 5 })).toBeNull(); // 无当期值
  });

  it('C1 现金含量（★, P2）：≥1健康/0~1应收回款/<0净流出；EPS≤0 兜底 → null', () => {
    expect(annotate('cash_content', { value: 2, aux: 1 })?.note).toContain('比较健康'); // ratio 2
    expect(annotate('cash_content', { value: 0.5, aux: 1 })?.note).toContain('应收账款'); // 0.5
    expect(annotate('cash_content', { value: -0.3, aux: 1 })?.note).toContain('净流出现金'); // <0
    expect(annotate('cash_content', { value: 2, aux: 0 })).toBeNull(); // EPS=0 兜底
    expect(annotate('cash_content', { value: 2, aux: -1 })).toBeNull(); // EPS<0（亏损）兜底
    expect(annotate('cash_content', { value: 2 })).toBeNull(); // 缺 EPS
  });

  it('D1 PE 分位：低位/中间/高位', () => {
    expect(annotate('pe_pctile', { pctile: 10 })?.note).toContain('历史低位');
    expect(annotate('pe_pctile', { pctile: 50 })?.note).toContain('中间位置');
    expect(annotate('pe_pctile', { pctile: 90 })?.note).toContain('历史高位');
  });

  it('D2 PB 分位：高位 + PB<1 恒附', () => {
    expect(annotate('pb_pctile', { pctile: 90, aux: 3 })?.note).toContain('历史高位');
    expect(annotate('pb_pctile', { pctile: 10, aux: 0.8 })?.note).toContain('PB 不到 1 倍');
    expect(annotate('pb_pctile', { pctile: 10, aux: 2 })?.note).not.toContain('PB 不到 1 倍');
  });

  it('D3 行业 PE：高于/低于行业中位', () => {
    expect(annotate('industry_pe', { value: 30, industryMedian: 20 })?.note).toContain(
      '高于同行业中位',
    );
    expect(annotate('industry_pe', { value: 10, industryMedian: 20 })?.note).toContain(
      '低于同行业中位',
    );
  });

  it('E1 解禁：释义 + 一般提示；股数≤0→null', () => {
    expect(annotate('unlock', { value: 3e8 })?.measure).toContain('限售解禁');
    expect(annotate('unlock', { value: 0 })).toBeNull();
  });
});

describe('合规哨兵 · 注解绝不含 买/卖/涨/跌/好/差/建议/目标价（勿删）', () => {
  // 每个指标覆盖全档位 + 边界 + 恒附触发的输入。
  const CASES: Record<SeethroughKey, AnnotateInputLike[]> = {
    net_margin: [{ value: -5 }, { value: 3 }, { value: 10 }, { value: 20 }],
    deduct_vs_net: [
      { value: -100, aux: 200 },
      { value: 180, aux: 200 },
      { value: 100, aux: 200 },
    ],
    gross_margin: [
      { value: 40, yoy: 5 },
      { value: 40, yoy: 1 },
      { value: 40, yoy: -5 },
    ],
    roe: [{ value: 3 }, { value: 10 }, { value: 20 }],
    revenue_yoy: [{ value: -5 }, { value: 8 }, { value: 30 }],
    net_profit_yoy: [{ value: -5, aux: 10 }, { value: 8 }, { value: 30, aux: -5 }],
    cash_content: [
      { value: 2, aux: 1 },
      { value: 0.5, aux: 1 },
      { value: -0.3, aux: 1 },
    ],
    debt_ratio: [{ value: 30 }, { value: 50 }, { value: 80 }],
    ocf_per_share: [{ value: 0.5 }, { value: -0.3 }],
    pe_pctile: [{ pctile: 10 }, { pctile: 50 }, { pctile: 90 }],
    pb_pctile: [
      { pctile: 10, aux: 0.8 },
      { pctile: 50, aux: 2 },
      { pctile: 90, aux: 5 },
    ],
    industry_pe: [
      { value: 30, industryMedian: 20 },
      { value: 10, industryMedian: 20 },
    ],
    unlock: [{ value: 3e8 }],
  };
  const FORBIDDEN = /[买卖涨跌好差]|建议|目标价/;

  it('遍历全部指标 × 全档位：零禁字泄漏', () => {
    const leaks: string[] = [];
    for (const key of ALL_SEETHROUGH_KEYS) {
      for (const input of CASES[key]) {
        const a = annotate(key, input);
        if (!a) continue;
        const text = `${a.measure} ${a.note}`;
        const m = text.match(FORBIDDEN);
        if (m) leaks.push(`${key}: 命中「${m[0]}」→ ${text}`);
        // seethroughLine 渲染串同样不得泄漏
        expect(seethroughLine(a)).not.toMatch(FORBIDDEN);
      }
    }
    expect(leaks).toEqual([]);
  });
});

interface AnnotateInputLike {
  value?: number | null;
  pctile?: number | null;
  industryMedian?: number | null;
  yoy?: number | null;
  aux?: number | null;
}
