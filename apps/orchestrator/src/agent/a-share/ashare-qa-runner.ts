/**
 * Phase 1 #2 ④ M2 — A股即时问答执行器（fetch → 事实卡 → LLM③ → 合规闸门 → 组装）.
 *
 * 流程（见 docs/SKILL_ROUTER_PATTERN.md fetch-then-interpret）：
 *   1. fetchFactData → renderFactCard（①②确定性事实卡，展示用）+ buildFactContext（喂 LLM，token 上限保护）。
 *   2. 注入技能 markdown（人设/红线/版式）+ 事实卡上下文 → 单次 LLM 出「③ 可能相关因素」。
 *   3. complianceGate(③, 上下文)：advice/predict/ungrounded 任一越线 → **降级为纯数据呈现**
 *      （丢③）+ **打日志 + 计数**（降级率指标，BOSS 微调①）。
 *   4. 组装：①② + ③（过闸）/降级注记 + 固定免责（③段尾已钉「以上因素与股价变动的关联未经证实」）。
 *
 * LLM 调用经注入（`interpret`）→ 可 mock 做对抗性单测；技能 markdown 经注入（运行时由
 * skills 表 manifest.body 取）。
 */

import type { AkshareClient } from './akshare-client.js';
import {
  QA_DISCLAIMER_BLOCK,
  buildFactContext,
  fetchFactData,
  renderFactCard,
} from './ashare-fact-card.js';
import type { BriefingMode } from './ashare-format.js';
import { type GateReason, complianceGate } from './ashare-qa-gate.js';
import type { AshareQaMatch } from './ashare-qa-types.js';

interface QaLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface AshareQaRunnerDeps {
  client: AkshareClient;
  /** 单次 LLM 调用 system+user → text。注入便于 mock。 */
  interpret: (input: { system: string; user: string }) => Promise<string>;
  /** 技能 markdown（人设/红线/版式）；空 → 跳过解读，纯事实卡。 */
  skillMarkdown?: string | null;
  logger: QaLogger;
  now?: Date;
  mode?: BriefingMode;
  /** 关联上下文（日志用）。 */
  context?: { userId?: string; taskId?: string };
}

export interface AshareQaResult {
  answer: string;
  /** 是否触发合规降级（丢弃③）。 */
  degraded: boolean;
  reason?: GateReason;
  /** 是否含 LLM 解读（false=纯事实卡）。 */
  interpreted: boolean;
}

const FIXED_TAIL = '以上因素与股价变动的关联未经证实';

function buildSystem(skillMarkdown: string, kind: AshareQaMatch['kind']): string {
  return [
    skillMarkdown.trim(),
    '',
    '---',
    '# 本次任务（强约束，违反将被合规闸门拦截并降级）',
    kind === 'anomaly'
      ? '用户在问个股的「异动归因」（为什么涨/跌）。'
      : '用户在问个股的「资讯解读」。',
    '你只能输出「③ 可能相关因素」一段，2-4 条 bullet，且必须：',
    '1. **只依据下方「事实卡上下文」**里出现的事实推断，不得引入上下文之外的任何数字/事件；',
    '2. **严禁**任何买卖建议、持仓建议、目标价、择时（会涨/会跌/涨到X元/抄底/割肉/止损止盈等）；',
    '3. **严禁**预测未来涨跌；只陈述「已发生的事实」与「可能的关联」，且关联用「或与…有关」「可能受…影响」这类措辞；',
    '4. 若上下文不足以归因，直接写「暂无足够公开信息支持本次异动归因」；',
    `5. **段落最后一行必须原样写**：「${FIXED_TAIL}」。`,
    '不要复述①②的数据，不要写标题，直接输出 bullet + 最后那行固定话术。',
  ].join('\n');
}

function buildUser(match: AshareQaMatch, factContext: string): string {
  const names = match.stocks.map((s) => s.displayName ?? s.symbol).join('、');
  return [`问题涉及个股：${names}`, '', '【事实卡上下文】', factContext].join('\n');
}

/** ③ 通过：插在①②与免责之间。强制钉「相关≠因果」固定话术（BOSS 微调④）。 */
function assemblePassed(body: string, interpretation: string): string {
  const core = interpretation.trim();
  const withTail = core.includes(FIXED_TAIL) ? core : `${core}\n\n${FIXED_TAIL}`;
  return [
    body,
    '',
    '## ③ 可能相关因素（分析师判断 · 非定论）',
    withTail,
    '',
    QA_DISCLAIMER_BLOCK,
  ].join('\n');
}

/** 合规降级：丢③，给中性注记。 */
function assembleDegraded(body: string): string {
  return [
    body,
    '',
    '> 注：本次提问涉及买卖判断或价格预测，已按合规要求降级为**纯数据呈现**，未提供归因解读。以上仅为客观信息聚合，不构成任何投资建议。',
    '',
    QA_DISCLAIMER_BLOCK,
  ].join('\n');
}

/** 无解读（无技能上下文/LLM 失败）：纯事实卡 + 免责。 */
function assemblePlain(body: string): string {
  return `${body}\n\n${QA_DISCLAIMER_BLOCK}`;
}

export async function runAshareQa(
  deps: AshareQaRunnerDeps,
  match: AshareQaMatch,
): Promise<AshareQaResult> {
  const now = deps.now ?? new Date();
  const mode = deps.mode ?? 'prod';
  const data = await fetchFactData(deps.client, match);
  const body = renderFactCard(data, match, now, mode);

  // 无技能上下文 → 纯事实卡（不解读）。
  if (!deps.skillMarkdown) {
    return { answer: assemblePlain(body), degraded: false, interpreted: false };
  }

  const factContext = buildFactContext(data, match);
  let interpretation = '';
  try {
    interpretation = (
      await deps.interpret({
        system: buildSystem(deps.skillMarkdown, match.kind),
        user: buildUser(match, factContext),
      })
    ).trim();
  } catch (e) {
    // LLM 失败 ≠ 合规降级：仍返回纯事实卡（不记降级计数）。
    deps.logger.warn(
      { ...deps.context, err: e instanceof Error ? e.message : String(e) },
      'ashare-qa: LLM 解读调用失败，回退纯数据',
    );
    return { answer: assemblePlain(body), degraded: false, interpreted: false };
  }

  if (!interpretation) {
    return { answer: assemblePlain(body), degraded: false, interpreted: false };
  }

  const gate = complianceGate(interpretation, factContext);
  if (!gate.passed) {
    // ⚠️ 合规降级：丢③ + 打日志 + 计数（降级率核心指标，BOSS 微调①）。
    deps.logger.warn(
      {
        ...deps.context,
        event: 'ashare_qa_degrade',
        reason: gate.reason,
        hits: gate.hits,
        kind: match.kind,
        stocks: match.stocks.map((s) => s.symbol),
      },
      'ashare-qa:compliance-gate-degradation',
    );
    return {
      answer: assembleDegraded(body),
      degraded: true,
      reason: gate.reason,
      interpreted: false,
    };
  }

  return { answer: assemblePassed(body, interpretation), degraded: false, interpreted: true };
}
