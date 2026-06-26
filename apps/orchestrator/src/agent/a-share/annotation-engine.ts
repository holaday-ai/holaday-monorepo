/**
 * Phase 2「看懂层」P1 — 腿A 确定性逐指标注解引擎（零 LLM、零漂移、零新增数据）.
 *
 * 内容源 = docs/…/annotation_template_final_v1.md 的「句式合同」：
 *   每条注解 = [衡量什么] + [当前客观位置/档位] + [该警惕什么]。
 * 实现 = 纯查表 bucketize：给指标当期值(+历史分位/行业中位/同比/辅助值) → 选档 → 返模板句。
 * **运行时绝不调 LLM、绝不产新数字、绝不下「买卖/涨跌/好坏/建议/目标价」结论。**
 *
 * P1 覆盖数据已就绪指标（净利率/扣非vs归母/ROE/营收同比/净利同比/负债率/每股经营现金流/
 * PE历史分位/PB分位/行业PE中位/解禁）。**P2 补映射**（复验确认零新字段、纯既有 ths 列算）：
 * C1 现金含量 = 每股经营现金流÷基本每股收益（★，最防雷；总股本约掉，亏损股 EPS≤0 不算）；
 * A3 毛利率同比 = 销售毛利率当期−上年同期（ths 多期）。**仍缺口不做**：A3 行业毛利中位（需同行清单，
 * 成分股源 Vultr 不可达）→ 暂缓。F 走势组见 perf-trend-engine（P3）。
 *
 * ⚠️ 合规哨兵（annotation-engine.test.ts 全档位断言）：所有注解句**绝不含**
 *    买 / 卖 / 涨 / 跌 / 好 / 差 / 建议 / 目标价。
 * 为此，template 个别口语（卖房卖股·一次性买卖 / 变卖资产 / 卖得快 / 一起涨 / 营收在涨 /
 * 看法变差 / 不能卖的股份 / 资产没用好）已做**保义改写**规避禁字。
 * 另 **BOSS 末审软化 4 句**（估值线收紧，绝不出「低估/高估」）：A1 薄利去「由盈转亏」方向预测；
 * D1 低位去「被低估」、高位去「回落」；D2 PB 去「被低估」。BOSS 原议「市场定价偏差」因禁字「差」→
 * 用「偏离」（语义等价：中性错价无方向）。逐条见 PR 说明，BOSS 已逐句审字面定稿。
 */

/** P1 支持的指标键（数据已就绪）。 */
export type SeethroughKey =
  | 'net_margin' // A1 净利率
  | 'deduct_vs_net' // A2 扣非 vs 归母
  | 'gross_margin' // A3 毛利率同比（P2）
  | 'roe' // A4 ROE
  | 'revenue_yoy' // B1 营收同比
  | 'net_profit_yoy' // B2 净利同比
  | 'cash_content' // C1 现金含量（★，P2；OCF/净利 ≈ 每股经营现金流/基本每股收益）
  | 'debt_ratio' // C2 资产负债率
  | 'ocf_per_share' // C3 每股经营现金流（仅释义）
  | 'pe_pctile' // D1 PE 历史分位
  | 'pb_pctile' // D2 PB 历史分位
  | 'industry_pe' // D3 行业 PE 对比
  | 'unlock'; // E1 限售解禁（释义+一般提示，%档留 P2）

/**
 * ★ 核心子集（轻量速览带）。对照 template 的 ★ 标记：A1/A2/B1/D1/E1 + **C1 现金含量（P2 补回，「最防雷」）**。
 */
export const CORE_STAR_KEYS: readonly SeethroughKey[] = [
  'net_margin',
  'deduct_vs_net',
  'cash_content',
  'revenue_yoy',
  'pe_pctile',
  'unlock',
];

export interface AnnotateInput {
  /** 主值（净利率%/ROE%/同比%/负债率%/每股现金流元/PE/解禁股数 等，依指标而定）。 */
  value?: number | null;
  /** 历史分位 %（PE/PB 分位用）。 */
  pctile?: number | null;
  /** 行业中位（行业 PE 对比用）。 */
  industryMedian?: number | null;
  /** 同比 %（预留）。 */
  yoy?: number | null;
  /** 辅助值：扣非用归母净利；净利同比恒附用营收同比；PB 分位恒附用 PB 值。 */
  aux?: number | null;
}

export interface Annotation {
  /** 衡量什么（这指标干嘛的）。 */
  measure: string;
  /** 当前客观位置 + 该警惕什么（档位句；空＝仅释义无档）。 */
  note: string;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// ── A. 盈利能力 ───────────────────────────────────────────────

/** A1 净利率（★）：档 <0 / 0~5 / 5~15 / >15。 */
function netMargin(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  const measure = '净利率 = 每 100 元营收最后能落到公司手里的利润比例。';
  let note: string;
  if (v < 0) note = '目前是亏损的，每做一笔生意还要倒贴，要留意是暂时性还是持续亏损。';
  // #1 软化（BOSS 末审）：去掉「一有风吹草动就可能由盈转亏」方向结果预测，只留敏感性陈述。
  else if (v < 5) note = '赚得比较薄，盈利对成本、费用变化很敏感。';
  else if (v < 15) note = '盈利处在中等水平。';
  else note = '盈利比例较高，可留意这个高利润能不能持续、有没有靠一次性收入撑着。';
  return { measure, note };
}

/** A2 扣非 vs 归母（★）：扣非≈归母(差<20%) / 扣非<<归母(<80%) / 扣非负·归母正。 */
function deductVsNet(i: AnnotateInput): Annotation | null {
  const deduct = num(i.value);
  const net = num(i.aux);
  if (deduct === null || net === null) return null;
  // 「卖房卖股这类一次性买卖」→ 保义改写「处置房产或股权这类一次性收益」（避禁字 买/卖）。
  const measure = '扣非利润 = 剔掉政府补助、处置房产或股权这类「一次性收益」后，主业自己赚到的钱。';
  let note: string;
  if (net > 0 && deduct < 0) {
    note = '主业其实在亏，账面盈利全靠一次性收入撑着，要特别留意。';
  } else if (net > 0 && deduct / net >= 0.8) {
    note = '利润主要来自主营业务，赚得比较实在。';
  } else if (net > 0 && deduct / net >= 0) {
    // 「变卖资产」→ 保义改写「处置资产」（避禁字 卖）。
    note = '相当一部分利润来自一次性收入（补助、处置资产等），主业自己赚的没账面那么多，要留意。';
  } else {
    return null; // 归母≤0 等无对应档位 → 不臆造
  }
  return { measure, note };
}

/**
 * A3 毛利率同比（P2）：销售毛利率 当期 − 上年同期（yoy，pct 点）。趋势档 ↑≥3 / ±3 / ↓≤−3。
 * 仅同比口径（行业毛利中位需同行清单、数据缺口，暂缓）；无同比数据 → null（A3 本就是「同比」）。
 */
function grossMargin(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  const yoy = num(i.yoy);
  if (v === null || yoy === null) return null;
  const measure =
    '毛利率 = 每 100 元营收里，扣掉直接生产成本后还剩多少毛利，反映产品本身的赚钱能力。';
  let note: string;
  if (yoy >= 3)
    note = '毛利率较去年同期明显提升，可留意是产品提价、成本下降还是产品结构变化带来的。';
  else if (yoy <= -3)
    note = '毛利率较去年同期明显下滑，要留意是成本上升、降价竞争还是产品结构变化。';
  else note = '毛利率与去年同期基本持平。';
  return { measure, note };
}

/** A4 ROE：档 <5 / 5~15 / >15 + 恒附（高 ROE 靠借债则结合负债率看）。 */
function roe(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  const measure = 'ROE = 股东每投 100 元，公司一年帮你赚回多少，是「赚钱效率」的核心指标。';
  let note: string;
  // 「资产没用好」→ 保义改写「资产没用到位」（避禁字 好）。
  if (v < 5) note = '用股东的钱赚钱的效率偏低，要留意是赚得少还是资产没用到位。';
  else if (v < 15) note = '赚钱效率处在中等水平。';
  // 「卖得快」→ 保义改写「周转快」（避禁字 卖）。
  else note = '赚钱效率较高，可留意是靠高利润、周转快、还是靠借钱放大的（三种来源风险不同）。';
  note += '（如果高 ROE 主要靠大量借债撑起来，要结合资产负债率一起看。）';
  return { measure, note };
}

// ── B. 成长性 ────────────────────────────────────────────────

/** B1 营收同比（★）：档 <0 / 0~15 / >15。 */
function revenueYoy(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  const measure = '营收增速 = 公司生意盘子比去年同期大了还是小了。';
  let note: string;
  if (v < 0) note = '营收比去年同期缩了，要留意是行业不景气、需求变弱还是被对手抢了份额。';
  else if (v < 15) note = '营收在增长。';
  // 「利润有没有跟着一起涨」→ 保义改写「一起增长」（避禁字 涨）。
  else note = '营收增长较快，可留意这个速度能不能持续、利润有没有跟着一起增长。';
  return { measure, note };
}

/** B2 净利同比：同 B1 框架（缩/增/快增）+ 恒附（与营收背离时提示）。aux=营收同比。 */
function netProfitYoy(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  const rev = num(i.aux);
  const measure = '净利增速 = 赚的钱比去年同期多了还是少了。';
  let note: string;
  if (v < 0) note = '净利比去年同期缩了。';
  else if (v < 15) note = '净利在增长。';
  else note = '净利增长较快。';
  // 背离恒附（营收/利润反向）：「如果营收在涨…」→ 保义改写「营收在增」（避禁字 涨）。
  if (rev !== null && rev > 0 !== v > 0) {
    note += '如果营收在增、利润没跟上（或反过来），要留意成本费用变化或有一次性因素。';
  }
  return { measure, note };
}

// ── C. 财务健康 / 偿债 ─────────────────────────────────────────

/**
 * C1 现金含量（★「最防雷」，P2）：经营现金流/净利 ≈ 每股经营现金流(value) ÷ 基本每股收益(aux)。
 * 总股本约掉。档 ≥1 / 0~1 / <0。**兜底：EPS≤0（亏损）现金含量除法无意义 → null（不算不显）。**
 * 句式逐字照 BOSS 合同；「生意本身在变差」撞禁字「差」→ 保义改写「在转弱」（语义等价，登记待审）。
 */
function cashContent(i: AnnotateInput): Annotation | null {
  const ocfps = num(i.value);
  const eps = num(i.aux);
  if (ocfps === null || eps === null || eps <= 0) return null; // 亏损/缺值 → 不算（兜底）
  const ratio = ocfps / eps;
  const measure = '经营现金流与净利之比，反映账面利润有没有真收到现金。';
  let note: string;
  if (ratio >= 1) note = '赚的利润大都收到了现金，比较健康。';
  else if (ratio >= 0)
    note = '账面利润不少，但有一部分还没真收回来（多挂在应收账款上），要留意客户回款情况。';
  // 「生意本身在变差」→ 保义改写「在转弱」（避禁字「差」）。
  else note = '经营上其实是净流出现金的，要留意是在扩张投入，还是生意本身在转弱、收不回钱。';
  return { measure, note };
}

/** C2 资产负债率：档 <40 / 40~70 / >70（标注行业差异大）。 */
function debtRatio(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  const measure = '资产负债率 = 公司总资产里有多大比例是靠借债来的，反映还债压力大不大。';
  let note: string;
  if (v < 40) note = '借债比例较低，财务比较稳健。';
  else if (v < 70) note = '借债比例中等。';
  else
    note = '借债比例较高，要留意还债和利息压力（注：地产、金融等行业天生就偏高，不能一概而论）。';
  return { measure, note };
}

/** C3 每股经营现金流：仅释义（现金含量比 C1 因缺总经营现金流留 P2，不下档位）。 */
function ocfPerShare(i: AnnotateInput): Annotation | null {
  const v = num(i.value);
  if (v === null) return null;
  return {
    measure: '每股经营现金流 = 分摊到每一股，公司一年经营上真正创造了多少现金。',
    note: '',
  };
}

// ── D. 估值 ──────────────────────────────────────────────────

/** D1 PE 历史分位（★）：档 <20 / 20~80 / >80。 */
function pePctile(i: AnnotateInput): Annotation | null {
  const p = num(i.pctile);
  if (p === null) return null;
  const measure =
    'PE = 市场愿意为它每 1 元利润出多少价；历史分位 = 现在这个价位，在它自己过去五年里算高还是低。';
  let note: string;
  // #3 软化（BOSS 末审 · 估值线收紧）：去「被低估」价值结论 → 客观位置 + 让用户自判方向。
  // BOSS 原议「市场定价偏差」含禁字「差」→ 用「偏离」（语义等价：中性错价，无方向，避哨兵）。
  if (p < 20)
    note =
      '现在的估值，比它自己过去五年里大多数时候都低（历史低位），需判断是市场定价偏离还是基本面预期转弱。';
  else if (p < 80) note = '现在的估值处在它自己过去五年的中间位置。';
  // #4 软化（BOSS 末审）：去「回落」方向词 → 「预期兑现的不确定性」。
  else
    note =
      '现在的估值，比它自己过去五年里大多数时候都高（历史高位），市场预期不低，需留意预期兑现的不确定性。';
  return { measure, note };
}

/** D2 PB 历史分位：同 D1 框架（市净率口径）+ 恒附（PB<1）。aux=PB 值。 */
function pbPctile(i: AnnotateInput): Annotation | null {
  const p = num(i.pctile);
  if (p === null) return null;
  const pb = num(i.aux);
  const measure = 'PB = 股价相当于每股净资产的几倍，重资产、银行地产类常看；历史分位同 PE。';
  let note: string;
  if (p < 20) note = '现在的市净率，比它自己过去五年里大多数时候都低（历史低位）。';
  else if (p < 80) note = '现在的市净率处在它自己过去五年的中间位置。';
  else note = '现在的市净率，比它自己过去五年里大多数时候都高（历史高位）。';
  if (pb !== null && pb < 1) {
    // #5 软化（BOSS 末审 · 与 #3 同口径）：去「被低估」→「市场定价偏离」（同样用「偏离」避禁字「差」）。
    note += 'PB 不到 1 倍，意味股价比账面净资产还低，需判断是资产质量问题，还是市场定价偏离。';
  }
  return { measure, note };
}

/** D3 行业 PE 对比：当前 PE 高于/接近/低于 行业中位（"行业内排第几"待数据补齐升级）。 */
function industryPe(i: AnnotateInput): Annotation | null {
  const pe = num(i.value);
  const med = num(i.industryMedian);
  if (pe === null || med === null) return null;
  const rel = pe > med ? '高于' : pe < med ? '低于' : '接近';
  return {
    measure: '行业对比 = 把它的估值放到同行里比一比。',
    note: `当前 PE ${rel}同行业中位水平。`,
  };
}

// ── E. 风险信号 ──────────────────────────────────────────────

/** E1 限售解禁（★）：释义 + 一般提示（占流通盘 %档需流通股本，数据缺口留 P2）。value=合计解禁股数。 */
function unlock(i: AnnotateInput): Annotation | null {
  const shares = num(i.value);
  if (shares === null || shares <= 0) return null;
  // 「原来不能卖的股份」→ 保义改写「原先受限、不能流通的股份」（避禁字 卖）。
  return {
    measure: '限售解禁 = 原先受限、不能流通的股份到期解禁、可上市流通，可能多出阶段性抛压。',
    note: '可留意本次解禁的规模与时点。',
  };
}

const REGISTRY: Record<SeethroughKey, (i: AnnotateInput) => Annotation | null> = {
  net_margin: netMargin,
  deduct_vs_net: deductVsNet,
  gross_margin: grossMargin,
  roe,
  revenue_yoy: revenueYoy,
  net_profit_yoy: netProfitYoy,
  cash_content: cashContent,
  debt_ratio: debtRatio,
  ocf_per_share: ocfPerShare,
  pe_pctile: pePctile,
  pb_pctile: pbPctile,
  industry_pe: industryPe,
  unlock,
};

/**
 * 主入口：指标键 + 输入 → 注解（衡量什么 + 档位句）。
 * 缺值/无对应档位 → null（诚实不出，绝不臆造）。纯函数、零副作用、零 LLM。
 */
export function annotate(key: SeethroughKey, input: AnnotateInput): Annotation | null {
  return REGISTRY[key](input);
}

/** 展示用「看懂」子行（markdown 子 bullet；note 空则仅释义）。 */
export function seethroughLine(a: Annotation): string {
  return `  - 〔看懂〕${a.measure}${a.note ? ` ${a.note}` : ''}`;
}

/** 所有指标键（哨兵测遍历用）。 */
export const ALL_SEETHROUGH_KEYS = Object.keys(REGISTRY) as SeethroughKey[];
