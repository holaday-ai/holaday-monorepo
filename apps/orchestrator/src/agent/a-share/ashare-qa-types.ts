/**
 * Phase 1 #2 ④ — A股即时问答：类型契约（M1）.
 *
 * 见 docs/PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md。M1 只做无 LLM 的确定性
 * 「接地事实卡」——matcher 解析「个股×日期×问句类型」→ fact-card 取数组装。
 * LLM 解读（③ 可能相关因素）属 M2，不在 M1。
 */

/** 问句类型：anomaly=异动归因（为什么涨/跌）；info=个股资讯（公告/龙虎榜/解禁）。 */
export type QaKind = 'anomaly' | 'info';

/** 解析出的个股（代码 + 可选显示名）。 */
export interface ResolvedStock {
  symbol: string;
  displayName: string | null;
}

/** matcher 命中结果。null = 非 A股问答。 */
export interface AshareQaMatch {
  kind: QaKind;
  /** 目标个股（M1 上限 5 只）。 */
  stocks: ResolvedStock[];
  /** 北京日历日 'YYYY-MM-DD'（默认今日）。 */
  dateIso: string;
  /** 北京 compact 'YYYYMMDD'（龙虎榜接口用）。 */
  dateCompact: string;
}
