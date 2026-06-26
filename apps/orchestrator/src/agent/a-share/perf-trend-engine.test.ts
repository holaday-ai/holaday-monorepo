/**
 * P3 · F 走势组 — F1-F4 算法单测 + **合规哨兵** + 不足数据兜底（长期保留，勿删）.
 *
 * 哨兵 = BOSS 硬要求：每条走势注解(measure+finding+perfLine)**绝不含**
 *   买/卖/涨/跌/好/差/建议/目标价（P1）+ 金叉/死叉/支撑/压力位/突破/反弹/抄底/逃顶/看多/看空（F红线）
 *   + 赶紧/务必/规避/清仓/卖出（行动指令）。任何放松走势注解措辞的改动都先在此红。
 */

import { describe, expect, it } from 'vitest';
import type { KlineRow } from './briefing-types.js';
import {
  type PerfSignal,
  detectAllPerf,
  detectF1,
  detectF2,
  detectF3,
  detectF4,
  perfLine,
} from './perf-trend-engine.js';

/** 构造 daily 序列（时间升序）：收盘 cl[i]，成交量 vol[i]（缺省 1000）。 */
const mk = (cl: number[], vol?: number[]): KlineRow[] =>
  cl.map((c, i) => ({ 收盘: c, 成交量: vol ? vol[i] : 1000 }));

describe('F 走势算法（腿A 本地纯算）', () => {
  it('F1 区间涨跌幅：近3月首尾算累计变动（带符号）', () => {
    const s = mk([100, ...Array(61).fill(105), 110]); // 63 行：首100 尾110
    expect(detectF1(s)?.finding).toBe('近3月累计变动 +10.00%。');
    expect(detectF1(s)?.star).toBe(true);
    const down = mk([100, ...Array(61).fill(90), 80]);
    expect(detectF1(down)?.finding).toBe('近3月累计变动 -20.00%。');
    expect(detectF1(mk([100]))).toBeNull(); // 不足2行
  });

  it('F2 最大回撤：峰→谷最大回撤 + 档位（<15较小/15~30中等/>30较大）', () => {
    expect(detectF2(mk([100, 120, 90, 95]))?.finding).toBe('期间最大回撤 25.00%，波动中等。'); // 120→90
    expect(detectF2(mk([100, 105, 95, 100]))?.finding).toContain('波动较小'); // ~9.5%
    expect(detectF2(mk([100, 200, 100]))?.finding).toContain('波动较大'); // 50%
  });

  it('F3 区间位置：近1年高/中/低（★）', () => {
    const hi = mk([50, ...Array(242).fill(75), 100]); // cur=100=max → 100%
    expect(detectF3(hi)?.finding).toContain('相对高位');
    expect(detectF3(hi)?.star).toBe(true);
    const lo = mk([100, ...Array(242).fill(75), 50]); // cur=50=min → 0%
    expect(detectF3(lo)?.finding).toContain('相对低位');
    const mid = mk([50, ...Array(242).fill(60), 75]); // cur=75, max=75? → 需 max>cur. 调:
    expect(detectF3(mk([50, 100, ...Array(241).fill(70), 75]))?.finding).toContain('中部'); // 75 在 50~100 中部
    expect(detectF3(mk([100, 101]))).toBeNull(); // 不足20样本
    void mid;
  });

  it('F4 量能：近5/前5 均量比（>1.5放量/<0.67缩量/其间平稳）', () => {
    const cl = Array(12).fill(100);
    const up = mk(cl, [...Array(2).fill(1000), ...Array(5).fill(1000), ...Array(5).fill(3000)]); // 前5≈1000 近5=3000
    expect(detectF4(up)?.finding).toContain('明显放大');
    const dn = mk(cl, [...Array(2).fill(1000), ...Array(5).fill(1000), ...Array(5).fill(400)]);
    expect(detectF4(dn)?.finding).toContain('萎缩');
    const flat = mk(cl, Array(12).fill(1000));
    expect(detectF4(flat)?.finding).toContain('大致相当');
    expect(detectF4(mk([100, 100]))).toBeNull(); // 不足10行
  });

  it('detectAllPerf：能算才入 + 数据不足返空不崩', () => {
    expect(detectAllPerf({ series: [] })).toEqual([]);
    expect(detectAllPerf({ series: mk([100]) })).toEqual([]); // 全不足
    const full = mk(
      [50, 120, ...Array(240).fill(80), 100, 90], // 244 行
      Array(244).fill(1000),
    );
    const keys = detectAllPerf({ series: full }).map((s) => s.key);
    expect(keys).toContain('range');
    expect(keys).toContain('drawdown');
    expect(keys).toContain('position');
  });
});

describe('合规哨兵 · 走势注解绝不含禁字 + F红线词（金叉/死叉/支撑/压力位/突破/反弹/抄底/逃顶/看多/看空）（勿删）', () => {
  const FORBIDDEN =
    /[买卖涨跌好差]|建议|目标价|金叉|死叉|支撑|压力位|突破|反弹|抄底|逃顶|看多|看空|赶紧|务必|规避|清仓|卖出/;
  const cl12 = Array(12).fill(100);
  const yr = (last: number, hi: number, lo: number) =>
    mk([lo, hi, ...Array(241).fill((hi + lo) / 2), last]);
  const SIGNALS: (PerfSignal | null)[] = [
    detectF1(mk([100, ...Array(61).fill(105), 110])), // +
    detectF1(mk([100, ...Array(61).fill(95), 80])), // -
    detectF2(mk([100, 110, 105])), // 较小
    detectF2(mk([100, 120, 90])), // 中等
    detectF2(mk([100, 200, 100])), // 较大
    detectF3(yr(100, 100, 50)), // 高位
    detectF3(yr(75, 100, 50)), // 中部
    detectF3(yr(50, 100, 50)), // 低位
    detectF4(mk(cl12, [...Array(7).fill(1000), ...Array(5).fill(3000)])), // 放量
    detectF4(mk(cl12, [...Array(7).fill(1000), ...Array(5).fill(400)])), // 缩量
    detectF4(mk(cl12, Array(12).fill(1000))), // 平稳
  ];

  it('遍历全部走势项 × 全档位：零禁字 + 零 F红线词 + 零行动指令词泄漏', () => {
    const leaks: string[] = [];
    for (const s of SIGNALS) {
      if (!s) continue;
      const text = `${s.measure} ${s.finding}`;
      const m = text.match(FORBIDDEN);
      if (m) leaks.push(`${s.key}: 命中「${m[0]}」→ ${text}`);
      expect(perfLine(s)).not.toMatch(FORBIDDEN);
    }
    expect(leaks).toEqual([]);
  });
});
