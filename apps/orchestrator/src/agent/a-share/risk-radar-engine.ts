/**
 * ④ 风险信号雷达 P1 — 腿A 确定性检测 + 风险注解引擎（零 LLM、零漂移、零新增 LLM）.
 *
 * 内容源 = BOSS 定的「风险注解句式合同」（逐字照抄；句式 = 检测到什么 + 该留意什么）。
 * 检测 = 纯阈值判档：R1 质押率(30/50) / R2 商誉占净资产(10/30)+同比新增 / R3 业绩预告类型 /
 * R4 董监高减持 + 大股东减持计划(公告 keyword) / R5 问询函(公告 keyword)。命中才出，无风险=空。
 *
 * ⚠️ 合规哨兵（risk-radar-engine.test.ts 全档位断言）：每条风险注解 measure+finding **绝不含**
 *    买/卖/涨/跌/好/差/建议/目标价（P1 同款）+ 赶紧/务必/规避/清仓/卖出（行动指令红线）。
 * BOSS 句式里「同比向好」撞禁字「好」→ **保义改写「同比改善」**（语义等价，逐条登记待 BOSS 审字面）。
 * 「客观风险提示，不构成投资建议」恒附（含禁字「建议」=免责非注解）由渲染层一次性附在风险组末，
 * 不进 measure/finding，哨兵不计。
 */

import type {
  AnnouncementRow,
  ForecastRow,
  GoodwillRow,
  InsiderChangeRow,
  PledgeRow,
} from './briefing-types.js';

export type RiskKey =
  | 'pledge' // R1 股权质押
  | 'goodwill' // R2 商誉
  | 'forecast' // R3 业绩预告
  | 'insider' // R4 董监高减持
  | 'reduction_plan' // R4 大股东减持计划（公告 keyword 兜底）
  | 'inquiry'; // R5 问询函/监管函

export interface RiskSignal {
  key: RiskKey;
  /** 短标签（质押/商誉/业绩预告/减持/减持计划/问询函）。 */
  label: string;
  /** 衡量（这风险是什么）。 */
  measure: string;
  /** 检测到什么 + 该留意什么（BOSS 档位句）。 */
  finding: string;
  /** ★ 核心子集（轻量速览带）：R1 高质押 / R2 高商誉 / R3 走弱 / R5 问询函。 */
  star: boolean;
}

/** 风险组末固定免责（含「建议」=免责非注解，哨兵不计；渲染层一次性附）。 */
export const RISK_DISCLAIMER = '以上为客观风险提示，不构成投资建议。';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

function fmtSharesCn(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿股`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}万股`;
  return `${Math.round(n)}股`;
}

// ── R1 股权质押（阈值 30/50；>50=★高质押）────────────────────────────────
const PLEDGE_MEASURE = '质押比例 = 公司股份被质押融资的比例，过高在股价下行时有平仓风险';
export function detectPledge(row: PledgeRow | undefined): RiskSignal | null {
  const r = num(row?.质押比例);
  if (r === null || r < 30) return null; // <30% 不标记
  if (r > 50) {
    return {
      key: 'pledge',
      label: '质押',
      measure: PLEDGE_MEASURE,
      finding: '整体质押比例较高，要留意股价下行时可能触发的平仓压力。',
      star: true,
    };
  }
  return {
    key: 'pledge',
    label: '质押',
    measure: PLEDGE_MEASURE,
    finding: '整体质押比例处于中等偏上，要留意质押相关的潜在波动。',
    star: false,
  };
}

// ── R2 商誉（占净资产 阈值 10/30；>30=★高商誉；+同比新增大额 附句）──────────
const GOODWILL_MEASURE = '商誉 = 并购时多付的钱，占净资产比例高则减值会冲击利润';
/** 同比新增大额（BOSS #3 末审）：本期商誉/上年商誉 ≥ 此倍数(同比+50%) **且 商誉占净资产≥下限%**。 */
const GOODWILL_SURGE_RATIO = 1.5;
const GOODWILL_SURGE_MIN_PCT = 10; // 占比下限：防小商誉基数下 1.5× 跳动的噪音（BOSS #3）。
export function detectGoodwill(row: GoodwillRow | undefined): RiskSignal | null {
  const pct = num(row?.商誉占净资产比例);
  if (pct === null || pct < 10) return null; // <10% 不标记
  const high = pct > 30;
  let finding = high
    ? '商誉占净资产比例较高，要留意大额商誉减值对业绩的潜在冲击。'
    : '商誉占净资产比例中等，要留意未来若计提减值对利润的影响。';
  // 同比新增大额（BOSS #3）：本期/上年 ≥1.5倍 **且 占比≥10%**（防小基数噪音）→ 附「新增」句。
  // 占比≥10% 已由上方早返保证（<10% 整条不出），此处显式再写=自文档 + 防早返被改。
  const cur = num(row?.商誉);
  const prev = num(row?.上年商誉);
  if (
    pct >= GOODWILL_SURGE_MIN_PCT &&
    cur !== null &&
    prev !== null &&
    prev > 0 &&
    cur / prev >= GOODWILL_SURGE_RATIO
  ) {
    finding += '本期商誉较上年明显增加（多来自并购），要留意后续整合与减值风险。';
  }
  return { key: 'goodwill', label: '商誉', measure: GOODWILL_MEASURE, finding, star: high };
}

// ── R3 业绩预告（向好/走弱；走弱=★预减）+ R3 恒附 ──────────────────────────
const FORECAST_MEASURE = '业绩预告 = 公司对本期业绩的初步预计';
const FORECAST_TAIL = '业绩预告为初步预计，以正式财报为准。';
const FCST_UP = /预增|略增|续盈|扭亏|减亏/;
const FCST_DOWN = /预减|略减|首亏|续亏|增亏/;
export function detectForecast(row: ForecastRow | undefined): RiskSignal | null {
  const t = typeof row?.预告类型 === 'string' ? row.预告类型.trim() : '';
  if (!t) return null;
  if (FCST_DOWN.test(t)) {
    const amp = num(row?.业绩变动幅度);
    const ampClause = amp !== null ? `，变动幅度约 ${Math.round(amp)}%` : ''; // 首亏/续亏 等无幅度则略
    return {
      key: 'forecast',
      label: '业绩预告',
      measure: FORECAST_MEASURE,
      // BOSS 句「同比走弱」原样。
      finding: `预告业绩同比走弱（类型：${t}）${ampClause}，要留意主业经营情况。${FORECAST_TAIL}`,
      star: true,
    };
  }
  if (FCST_UP.test(t)) {
    return {
      key: 'forecast',
      label: '业绩预告',
      measure: FORECAST_MEASURE,
      // BOSS 句「同比向好」撞禁字「好」→ 保义改写「同比改善」。
      finding: `预告业绩同比改善（类型：${t}），可结合是否含一次性因素一并看。${FORECAST_TAIL}`,
      star: false,
    };
  }
  return null; // 不确定/中性 不标记
}

// ── R4 董监高减持（变动数<0 求和）+ R4 大股东减持计划（公告 keyword 兜底）──────
const INSIDER_MEASURE = '内部人/大股东减持是一种值得关注的信号';
export function detectInsider(rows: InsiderChangeRow[] | undefined): RiskSignal | null {
  if (!rows || rows.length === 0) return null;
  let total = 0;
  for (const r of rows) {
    const d = num(r.变动数);
    if (d !== null && d < 0) total += Math.abs(d);
  }
  if (total <= 0) return null;
  // BOSS 句含「占比 Y%」，占比需总股本(数据缺口)→ P1 仅给「合计 X 股」，占比留补；登记待审。
  return {
    key: 'insider',
    label: '减持',
    measure: INSIDER_MEASURE,
    finding: `近期有董监高减持（合计约 ${fmtSharesCn(total)}），要留意内部人减持释放的信号。`,
    star: false,
  };
}

export function detectReductionPlan(
  announcements: AnnouncementRow[] | undefined,
): RiskSignal | null {
  const hit = (announcements ?? []).some((a) => String(a.公告标题 ?? '').includes('减持'));
  if (!hit) return null;
  return {
    key: 'reduction_plan',
    label: '减持计划',
    measure: INSIDER_MEASURE,
    finding: '检测到涉及减持的公告，要留意后续实施进度（详情见公告）。',
    star: false,
  };
}

// ── R5 问询函/监管函（公告标题 keyword；命中=★）──────────────────────────
const INQUIRY_RE = /问询函|关注函|监管函/;
export function detectInquiry(announcements: AnnouncementRow[] | undefined): RiskSignal | null {
  const n = (announcements ?? []).filter((a) => INQUIRY_RE.test(String(a.公告标题 ?? ''))).length;
  if (n === 0) return null;
  return {
    key: 'inquiry',
    label: '问询函',
    measure: '交易所就公司事项发函问询',
    finding: `近期收到交易所问询函/关注函/监管函（${n} 件），通常涉及对公司事项的问询，要留意公司回复及相关事项进展（详情见公告）。`,
    star: true,
  };
}

export interface RiskInputs {
  pledge?: PledgeRow;
  goodwill?: GoodwillRow;
  forecast?: ForecastRow;
  insider?: InsiderChangeRow[];
  announcements?: AnnouncementRow[];
}

/** 全检测：固定顺序 R1→R5，命中才入；无命中返空数组。纯函数零 LLM。 */
export function detectAllRisks(input: RiskInputs): RiskSignal[] {
  return [
    detectPledge(input.pledge),
    detectGoodwill(input.goodwill),
    detectForecast(input.forecast),
    detectInsider(input.insider),
    detectReductionPlan(input.announcements),
    detectInquiry(input.announcements),
  ].filter((s): s is RiskSignal => s !== null);
}

/** 展示用风险子行（finding 主句 + measure 释义括注）。 */
export function riskLine(s: RiskSignal): string {
  return `- 〔风险·${s.label}〕${s.finding}（${s.measure}）`;
}
