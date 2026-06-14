/**
 * Phase 1 #2 ④ M2 — A股问答合规闸门（生成后）.
 *
 * LLM 生成的「③ 可能相关因素」解读必过本闸门，越线 → **降级为纯数据呈现**
 * （丢弃③，只留①②确定性事实卡）。三道红线（见 docs/PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md §3.4）：
 *   - advice  ：荐股/买卖/目标价/割肉…（ADVICE_PATTERN）
 *   - predict ：会涨/会跌/涨到 X 元/预计…（PREDICT_PATTERN）
 *   - ungrounded：③ 引入了事实卡里没有的数字（凭空数据 = 未接地）
 * 降级**必打日志 + 计数**——降级率是 LLM 解读可靠性核心指标，也是后 11 技能放不放
 * 开解读的依据（BOSS 微调①）。纯函数，便于对抗性单测长期保留。
 */

/** 荐股/买卖建议措辞（含诱导问常见词：该买/割肉/止损止盈/要不要买卖 + 持仓操作 Q3 修）。 */
export const ADVICE_PATTERN =
  /建议(买入|卖出|买|卖|加仓|减仓|持有|配置|关注|补仓|减持)|目标价|必涨|必跌|强烈推荐|涨停可期|抄底|梭哈|满仓|清仓|值得(买入|入手|拥有|配置)|可以(买入|入手|建仓|加仓|考虑|补仓|继续持有)|该(买|卖|不该买)|要不要(买|卖|割|加|减|补)|割肉|止损|止盈|加仓|减仓|补仓|解套|摊薄|回本|套现|逢低|逢高|上车|建仓|减持(?!.*公告)|高抛低吸|越跌越买|捂股/;

/**
 * 预测/择时措辞（把**未来**涨跌、目标价钉死为违规）。
 *
 * ⚠️ 只抓**前瞻性预测**，不误伤「因素归纳」（E03 修，BOSS）：「X 为什么涨」的 ③
 * 解释过去异动属合规（带「未经证实·不构成投资建议」标注），不应整段降级。故：
 *   - 「后市」由**裸词**改为**须紧跟方向词**（后市看好/后市上涨/后市有望…才算预测；
 *     「后市表现待观察」「后市走势」等中性陈述放行）——E03 实测 hits=["后市"] 即此。
 *   - 其余 token 本就是显式前瞻（会涨/将跌/涨到 X 元/预计…/目标价），保留。
 */
export const PREDICT_PATTERN =
  /会(涨|跌|大涨|大跌|涨到|跌到|继续)|将(涨|跌|上涨|下跌|突破|回调)|预计.*(涨|跌|元|%)|看(涨|跌|高|多|空)|涨到|跌到|能到|有望(涨|突破|达到)|后市.{0,3}(涨|跌|看[涨跌好高多空]|有望|预计|将|目标|空间|可期|向[上下好]|乐观|布局)|空间.{0,6}[0-9]|至少.{0,6}[0-9].{0,4}(元|%)|未来.{0,6}(涨|跌|目标)|趋势(向上|向下|看好|看空)/;

export type GateReason = 'advice' | 'predict' | 'ungrounded';

export interface GateResult {
  passed: boolean;
  /** 命中的降级原因（首个）。 */
  reason?: GateReason;
  /** 命中的具体片段（脱敏排查用）。 */
  hits: string[];
}

/**
 * 抽取「显著金额/价格」token（带 元/亿/万 单位，或 ≥100 的数，如收盘价/成交额）+ 是否带 money 单位。
 * **放过百分比与小数**（涨跌幅 1.01% 等）——LLM 常四舍五入复述，纳入会误判。`unit` 用于剔除
 * 「年份」（无单位 4 位整数，如 2025年度）作接地锚——否则假目标价 2000 会被年份 2025 误接地。
 */
interface AmountTok {
  raw: string;
  v: number;
  unit: boolean;
}
function amountTokens(text: string): AmountTok[] {
  const out: AmountTok[] = [];
  for (const m of text.matchAll(/(\d[\d,]*\.?\d*)\s*(元|亿|万)?/g)) {
    const raw = (m[1] ?? '').replace(/,/g, '');
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    if (m[2] || v >= 100) out.push({ raw, v, unit: !!m[2] });
  }
  return out;
}

/** 年份样（无单位 4 位整数 1990-2099）——不作金额接地锚/声明，避免污染（2025年度 ≠ 目标价）。 */
function isYearLike(n: number): boolean {
  return Number.isInteger(n) && n >= 1990 && n <= 2099;
}

/**
 * 估值数字（PE/PB/历史分位/行业中位/倍数）—— Phase2 ⑦ 全景视角补盲（设计评审发现）.
 *
 * `significantNumbers` 只盯带 元/亿/万 或 ≥100 的数；而 PE-TTM 67.2 / PB 12.21 / 分位 85% /
 * 行业中位 35 这类**无单位小数**全在其接地盲区——恰是 ⑦ 决策权重最高的数字、幻觉敞口 100%。
 * 本函数专抓"估值语境里的数"，与 significantNumbers 并集做接地校验（**不动旧逻辑**，旧对抗测不破）。
 */
const VALUATION_NUM_RES: RegExp[] = [
  /PE-?\s*T?T?M?\s*[:：约]?\s*(\d+\.?\d*)/gi,
  /市盈率\s*[（(]?\s*T?T?M?\s*[)）]?\s*[:：约]?\s*(\d+\.?\d*)/g,
  /PB\s*[:：约]?\s*(\d+\.?\d*)/gi,
  /市净率\s*[:：约]?\s*(\d+\.?\d*)/g,
  /分位\s*[约为]?\s*(\d+\.?\d*)\s*%/g,
  /(?:行业)?中位\s*(?:PE)?\s*[约]?\s*(\d+\.?\d*)/g,
  /(\d+\.?\d*)\s*倍/g,
];
function valuationNumbers(text: string): string[] {
  const out: string[] = [];
  for (const re of VALUATION_NUM_RES) {
    for (const m of text.matchAll(re)) {
      const raw = (m[1] ?? '').replace(/,/g, '');
      if (raw && Number.isFinite(Number(raw))) out.push(raw);
    }
  }
  return out;
}

/**
 * 张力/背离延展成"预测" —— Phase2 ⑦ 补盲（设计评审）.
 * 「背离/张力/高位/偏高/估值 + 方向修复词」= 把客观矛盾延展成未来判断 → predict。
 * **绑定式**：仅当并存词后紧跟"会/将/迟早…修复/回落/收敛…"才拦，避免误杀合规的"…的背离"陈述。
 */
const TENSION_PREDICT_PATTERN =
  /(背离|张力|高位|偏高|估值|溢价).{0,8}(会|将|迟早|早晚|终将|终会|势必).{0,4}(修复|回落|回归|收敛|消化|化解|向下|下行|抹平)/;

/**
 * 合规闸门。`interpretation`=LLM 生成的③解读；`factContext`=喂给 LLM 的事实卡上下文。
 * 返回是否通过 + 降级原因 + 命中片段。
 */
export function complianceGate(interpretation: string, factContext: string): GateResult {
  const adviceHit = interpretation.match(ADVICE_PATTERN);
  if (adviceHit) return { passed: false, reason: 'advice', hits: [adviceHit[0]] };

  const predictHit = interpretation.match(PREDICT_PATTERN);
  if (predictHit) return { passed: false, reason: 'predict', hits: [predictHit[0]] };

  // ⑦ 补盲：张力/背离延展成未来修复判断 = 预测（绑定式，不误杀客观"背离"陈述）。
  const tensionHit = interpretation.match(TENSION_PREDICT_PATTERN);
  if (tensionHit) return { passed: false, reason: 'predict', hits: [tensionHit[0]] };

  // 接地校验（**数值容差 + 排年份**，容忍 LLM 口语化约数：1981→1981.72、4848→「4800多」、
  // 34→34.47、67.2→67.20）：③/⑦ 的「金额/价格 + 估值数(PE/PB/分位/中位/倍数)」都必须数值接近
  // 上下文某个**非年份**锚，否则=凭空捏造。容差 2%(相对)/0.05(绝对)。无单位年份(2025年度)既不作锚、
  // 也不作声明检查（避免假目标价 2000 被年份 2025 误接地、又不误杀「2026Q1财报」这类年份引用）。
  const ctxAnchors = [
    ...valuationNumbers(factContext).map(Number),
    ...amountTokens(factContext)
      .filter((t) => t.unit || !isYearLike(t.v))
      .map((t) => t.v),
  ].filter(Number.isFinite);
  const isGrounded = (x: number): boolean =>
    ctxAnchors.some((c) => Math.abs(c - x) < 0.05 || (c !== 0 && Math.abs((c - x) / c) <= 0.02));
  const claims: string[] = [
    ...valuationNumbers(interpretation),
    ...amountTokens(interpretation)
      .filter((t) => t.unit || !isYearLike(t.v))
      .map((t) => t.raw),
  ];
  const ungrounded = claims.filter((s) => {
    const x = Number(s);
    return Number.isFinite(x) && !isGrounded(x);
  });
  if (ungrounded.length > 0) return { passed: false, reason: 'ungrounded', hits: ungrounded };

  return { passed: true, hits: [] };
}
