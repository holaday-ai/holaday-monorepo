/**
 * P3 · F 走势组 — 腿A 确定性 K线波动「人话总结」引擎（零 LLM、零漂移、零新数据源）.
 *
 * 内容源 = BOSS 定的「走势注解句式合同」（逐字照抄；只描述【过去发生了什么 + 现在是什么状态】）。
 * F1 区间涨跌幅 / F2 最大回撤 / F3 当前价历史区间位置(★) / F4 量能 —— 全部用现成 daily 序列
 * （stock_zh_a_daily，get_kline?days= 放宽取近1年）**本地纯算**，零新增取数接口。F5 阶段状态小结走腿B（另接）。
 *
 * ⚠️ 合规哨兵（perf-trend-engine.test.ts 全档位断言）：每条走势注解 measure+finding **绝不含**
 *    买/卖/涨/跌/好/差/建议/目标价（P1 同款）+ **金叉/死叉/支撑/压力位/突破/反弹/抄底/逃顶/看多/看空**
 *    （F 组红线：禁预测/择时/技术信号/支撑反弹）+ 赶紧/务必/规避/清仓/卖出（行动指令）。
 * BOSS 句式撞禁字 → **保义改写**（登记待 BOSS 审字面）：F2「最大跌幅」→「最大回撤幅度」(避「跌」)；
 * F4「买卖意愿」→「交投意愿」、「买卖双方」→「市场」(避「买/卖」)。其余逐字照抄。
 */

import type { KlineRow } from './briefing-types.js';

export type PerfKey = 'range' | 'drawdown' | 'position' | 'volume';

export interface PerfSignal {
  key: PerfKey;
  /** 短标签（区间变动/回撤/区间位置/量能）。 */
  label: string;
  /** 衡量（这指标看什么）。 */
  measure: string;
  /** 客观描述（过去发生+现在状态；BOSS 档位句）。 */
  finding: string;
  /** ★ 核心子集（轻量速览带）：F1 区间涨跌幅 + F3 历史区间位置。 */
  star: boolean;
}

/** 周期 → 交易日数（近1月≈21 / 近3月≈63 / 近1年≈244）。F1/F2 默认近3月，F3 用近1年。 */
export const PERIOD_DAYS: Record<string, number> = { 近1月: 21, 近3月: 63, 近1年: 244 };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const fmtSigned = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** 从 daily 序列（时间升序）抽收盘/成交量数组（去缺值）。 */
function closes(series: KlineRow[]): number[] {
  return series.map((r) => num(r.收盘)).filter((x): x is number => x !== null);
}
function volumes(series: KlineRow[]): number[] {
  return series.map((r) => num(r.成交量)).filter((x): x is number => x !== null);
}

// ── F1 区间涨跌幅（★；默认近3月）──────────────────────────────────────────
export function detectF1(series: KlineRow[], periodLabel = '近3月'): PerfSignal | null {
  const c = closes(series);
  const n = PERIOD_DAYS[periodLabel] ?? 63;
  const win = c.slice(-n);
  if (win.length < 2) return null; // 不足数据（新股/停牌）→ 不出
  const first = win[0];
  const last = win[win.length - 1];
  if (first === undefined || last === undefined || first === 0) return null;
  const pct = ((last - first) / first) * 100;
  return {
    key: 'range',
    label: '区间变动',
    measure: '选定周期内股价整体变动幅度',
    // periodLabel 已含「近」（近1月/近3月/近1年），不重复加。
    finding: `${periodLabel}累计变动 ${fmtSigned(pct)}。`,
    star: true,
  };
}

// ── F2 最大回撤（默认近3月；<15较小 / 15~30中等 / >30较大）──────────────────
export function detectF2(series: KlineRow[], periodLabel = '近3月'): PerfSignal | null {
  const c = closes(series);
  const n = PERIOD_DAYS[periodLabel] ?? 63;
  const win = c.slice(-n);
  if (win.length < 2) return null;
  let peak = win[0] as number;
  let maxDd = 0;
  for (const x of win) {
    if (x > peak) peak = x;
    if (peak > 0) {
      const dd = (peak - x) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  const ddPct = maxDd * 100;
  const level = ddPct < 15 ? '较小' : ddPct <= 30 ? '中等' : '较大';
  return {
    key: 'drawdown',
    label: '回撤',
    // BOSS「最大跌幅」→ 保义改写「最大回撤幅度」(避禁字「跌」)。
    measure: '这段时间从最高点到最低点的最大回撤幅度，反映波动剧烈程度',
    finding: `期间最大回撤 ${ddPct.toFixed(2)}%，波动${level}。`,
    star: false,
  };
}

// ── F3 当前价历史区间位置（★；近1年；>80高位 / 20~80中部 / <20低位）──────────
export function detectF3(series: KlineRow[]): PerfSignal | null {
  const c = closes(series).slice(-(PERIOD_DAYS.近1年 ?? 244));
  if (c.length < 20) return null; // 不足近1年样本（新股）→ 不出
  const cur = c[c.length - 1] as number;
  const hi = Math.max(...c);
  const lo = Math.min(...c);
  if (hi === lo) return null;
  const pos = ((cur - lo) / (hi - lo)) * 100;
  let finding: string;
  if (pos > 80) finding = '当前价格接近近一年高位区间，处于相对高位。';
  else if (pos < 20) finding = '当前价格接近近一年低位区间，处于相对低位。';
  else finding = '当前价格处在近一年区间的中部。';
  return {
    key: 'position',
    label: '区间位置',
    measure: '现价处在近一年最高最低之间的位置',
    finding,
    star: true,
  };
}

// ── F4 量能（近5日均量 / 前5日均量；>1.5放量 / <0.67缩量 / 其间平稳）──────────
export function detectF4(series: KlineRow[]): PerfSignal | null {
  const v = volumes(series);
  if (v.length < 10) return null; // 不足两段窗口 → 不出
  const recent = v.slice(-5);
  const prior = v.slice(-10, -5);
  const ra = avg(recent);
  const pa = avg(prior);
  if (pa <= 0) return null;
  const ratio = ra / pa;
  let finding: string;
  // BOSS「买卖双方」→ 保义改写「市场」(避禁字「买/卖」)。
  if (ratio > 1.5) finding = '近期成交较前期明显放大，市场分歧或参与度上升。';
  else if (ratio < 0.67) finding = '近期成交较前期萎缩，市场参与意愿偏低、观望情绪较浓。';
  else finding = '近期成交与前期大致相当。';
  return {
    key: 'volume',
    label: '量能',
    // BOSS「买卖意愿」→ 保义改写「交投意愿」(避禁字「买/卖」)。
    measure: '最近成交活跃度比前期放大还是萎缩，反映交投意愿',
    finding,
    star: false,
  };
}

export interface PerfInputs {
  series: KlineRow[];
  /** F1/F2 周期（默认近3月）。 */
  periodLabel?: string;
}

/** 全检测：F1→F4 固定顺序，能算才入；数据不足返空。纯函数零 LLM。 */
export function detectAllPerf(input: PerfInputs): PerfSignal[] {
  const p = input.periodLabel ?? '近3月';
  return [
    detectF1(input.series, p),
    detectF2(input.series, p),
    detectF3(input.series),
    detectF4(input.series),
  ].filter((s): s is PerfSignal => s !== null);
}

/** 展示用走势子行（finding 主句 + measure 释义括注）。 */
export function perfLine(s: PerfSignal): string {
  return `- 〔走势·${s.label}〕${s.finding}（${s.measure}）`;
}
