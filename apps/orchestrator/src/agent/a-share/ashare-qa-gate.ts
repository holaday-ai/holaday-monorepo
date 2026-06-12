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

/** 预测/择时措辞（把未来涨跌、目标价钉死为违规）。 */
export const PREDICT_PATTERN =
  /会(涨|跌|大涨|大跌|涨到|跌到|继续)|将(涨|跌|上涨|下跌|突破|回调)|预计.*(涨|跌|元|%)|看(涨|跌|高|多|空)|涨到|跌到|能到|有望(涨|突破|达到)|后市|空间.{0,6}[0-9]|至少.{0,6}[0-9].{0,4}(元|%)|未来.{0,6}(涨|跌|目标)|趋势(向上|向下|看好|看空)/;

export type GateReason = 'advice' | 'predict' | 'ungrounded';

export interface GateResult {
  passed: boolean;
  /** 命中的降级原因（首个）。 */
  reason?: GateReason;
  /** 命中的具体片段（脱敏排查用）。 */
  hits: string[];
}

/**
 * 抽取「显著数字」token 做接地校验：只盯**金额/价格类**（带 元/亿/万 单位，或 ≥100 的数，
 * 如收盘价/成交额/代码）。**放过百分比与小数**（涨跌幅 1.01% 等）——LLM 常对其四舍五入
 * 复述，纳入会误判降级。目标是抓「凭空捏造的价格/目标位」，不是抓改写。
 */
function significantNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d[\d,]*\.?\d*)\s*(元|亿|万)?/g)) {
    const raw = (m[1] ?? '').replace(/,/g, '');
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (m[2] || n >= 100) out.push(raw);
  }
  return out;
}

/**
 * 合规闸门。`interpretation`=LLM 生成的③解读；`factContext`=喂给 LLM 的事实卡上下文。
 * 返回是否通过 + 降级原因 + 命中片段。
 */
export function complianceGate(interpretation: string, factContext: string): GateResult {
  const adviceHit = interpretation.match(ADVICE_PATTERN);
  if (adviceHit) return { passed: false, reason: 'advice', hits: [adviceHit[0]] };

  const predictHit = interpretation.match(PREDICT_PATTERN);
  if (predictHit) return { passed: false, reason: 'predict', hits: [predictHit[0]] };

  // 接地校验：③ 出现的显著数字必须在事实卡上下文里出现过，否则=凭空数据。
  const ctxNums = new Set(significantNumbers(factContext));
  const ungrounded = significantNumbers(interpretation).filter((n) => !ctxNums.has(n));
  if (ungrounded.length > 0) return { passed: false, reason: 'ungrounded', hits: ungrounded };

  return { passed: true, hits: [] };
}
