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
  buildPanoramaContext,
  fetchFactData,
  fetchPanoramaData,
  renderFactCard,
  renderPanoramaBody,
} from './ashare-fact-card.js';
import type { BriefingMode } from './ashare-format.js';
import { judgeIntent } from './ashare-intent-judge.js';
import { type GateReason, complianceGate, isSoftGateReason } from './ashare-qa-gate.js';
import type { AshareQaMatch } from './ashare-qa-types.js';

interface QaLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface AshareQaRunnerDeps {
  client: AkshareClient;
  /** 单次 LLM 调用 system+user → text。注入便于 mock。 */
  interpret: (input: { system: string; user: string }) => Promise<string>;
  /**
   * Phase2 ⑦ 意图判官（温度0 的单次 LLM 调用，注入即启用第二层；缺省=regex-only 原行为）。
   * 由 tasks.ts 按 `ASHARE_INTENT_JUDGE_ENABLED` 决定是否注入。仅作用于全景⑦，不动轻量③。
   */
  judge?: (input: { system: string; user: string }) => Promise<string>;
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

/**
 * P0 兜底（BOSS 要求①）：选了 a-share 技能但没解析出个股（或非个股问句）→ 静态引导
 * 话术，**绝不落通用 LLM**。确保「选了 A股技能的所有问句都在合规框架内，无一例外」。
 * 纯静态、无 LLM → 零合规风险。
 */
export const ASHARE_QA_GUIDANCE = [
  '请告诉我具体的**股票名称或代码**（例如「贵州茅台」或「600519」），我才能为你聚合该股的盘面行情、公告、龙虎榜、解禁等公开信息。',
  '',
  '> 本助手仅做客观信息聚合，**不提供买卖建议、不预测涨跌、不做投资判断**。',
  '',
  QA_DISCLAIMER_BLOCK,
].join('\n');

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
    '   **不要用「后市/后续走势/未来表现/有望/看好」等前瞻措辞**——只做过去异动的因素归纳，不对将来下判断；',
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
  // 剥掉 LLM 偶尔自带的「③ 可能相关因素」标题行（与本段标题重复 → 看着像格式坏）。
  const core = interpretation
    .trim()
    .replace(/^#{0,4}\s*③?\s*可能相关因素[^\n]*\n+/, '')
    .trim();
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
    // LLM 返回空（非异常）→ 无③，记日志便于排查「为什么没出③」。
    deps.logger.warn({ ...deps.context }, 'ashare-qa: LLM 返回空解读，回退纯数据（无③）');
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

// ===== Phase 2 全景速览：⑦ 分析师视角（状态画像）=================================
// system prompt 由 workflow 设计评审定稿（股民白话派骨架 + 分层中性数字纪律 + 状态画像张力收尾）。
// 与③不同：⑦ 不依赖技能 markdown（prompt 自含人设/红线），固定生成；产出过同一合规闸门
// （advice/predict/ungrounded，含 Phase2 估值数字接地 + 张力延展拦截补盲）→ 越线丢⑦留①-⑤。
export const SECTION7_SYSTEM = `# 角色
你是 HOLA DAY「A股全景速览」第 ⑦ 段【分析师视角 · 状态画像】的撰写者，走【股民白话派】路线。读者是一个没时间、不懂术语、用手机看盘的普通股民。你的唯一任务：把上文 ①盘面 / ②资金 / ③消息 / ④基本面 / ⑤估值，**综合**成 3-5 句普通人能秒懂的大白话，给出"这家公司现在是个什么状态"的直觉画像。你不是在复述数据，你是在"翻译"——把冷数字说成人话，但每个状态判断都必须挂在上文给过的具体数字上。

# 合规硬约束（最高优先级 · 违反即被合规闸门拦截并整段丢弃降级）
## 红线1 · 只做"状态判断"，零"买卖动作"
- 只能用客观状态形容词描述公司当下已发生的画像（状态词从下方白名单选，可白话同义化）。
- 绝对禁止任何买卖/操作/择时动作词：买/卖/买入/卖出/加仓/减仓/持有/建仓/补仓/减持/割肉/抄底/逢低/逢高/上车/梭哈/满仓/清仓/止损/止盈/目标价/值得买入/可以入手/该买/要不要买/强烈推荐/高抛低吸/越跌越买/捂股。
- 白话派高危禁词（最易踩）：回本/解套/套现/摊薄/套牢就…/补仓/抄底/逢低。想说"亏损"就说"还在亏/亏得少了点"，绝不说"等回本/能不能解套"。
- 连"值得关注/可以留意/不妨观察/建议关注"这类软性引导也禁止——只描述状态，不引导动作。
## 红线2 · 禁未来预测、禁技术信号
- 禁止任何对将来的判断：会涨/会跌/将上涨/将下跌/后市看好/后市有望/有望突破/预计涨(跌)/看涨/看空/趋势向上(向下)/涨到X元/还有X%空间/未来目标。一律用现在时态。
- **描述过去的数字变化，用"降至/下滑到/减少到/收窄到/升至"，不要用"跌到/涨到"**（后者易被合规系统判为价格预测而误降级）。
- "张力/背离"只许并列陈述客观矛盾，不许延展成预测：可写"今天涨停活跃，但基本面还在亏、估值在高位"；禁止写"这种背离迟早修复/高估值早晚回落/张力会化解"。
- 禁止把技术指标翻译成方向（MACD金叉/均线多头 → 任何涨跌或买卖含义一律不写）。
- 涉及关联用"或与…有关""可能受…影响""与…并存"这类不下因果定论的措辞。
## 红线3 · 数字只能照抄上文，一个都不许新造
- ⑦ 里每一个金额/价格/市值/财务数字/估值倍数(PE/PB)/历史分位/行业中位/百分比/同比，必须在上文 ①-⑤ 原样出现过。
- 严禁自己计算/推算/换算/估算/排序后产出新数（不写"约""大概""折合每股X""较去年多X元"）。
- **严禁给出任何"倍数/比值"**（如"是行业的X倍""PE是PB的X倍""估值高出N倍"）——那是换算出的新数；只说"高于/低于行业中位"，不带倍数。
- **数字务必逐位照抄、不许漏位错位**（1981.72 不能写成 981、4848 不能写成 484）；拿不准就不写数字，改用纯状态词（"估值站在历史高位""比行业中位明显贵"）。
- ⚠️ PE/PB/分位/倍数这类无单位小数（如 67.2/12.21/85%/35）一旦写错就是用户看不出的硬幻觉——同样：拿不准就只用状态词。
## 红线4 · 必须标数据时效
- 收尾按口径分别标，如：（盘面截至收盘、财务基于2026Q1财报、估值截至06-14）。具体期次以上文为准；某维度缺时效就不引用其数字。
## 红线5 · 固定收尾（原样照抄）
- 最后一句必须原样写：以上为客观信息聚合，未经证实，不构成任何投资建议。

# 状态词白名单（只能从同类选客观中性词，可白话同义替换）
- 盘面：活跃/放量/缩量/涨停/跌停/平淡/震荡/小盘/中小盘/大盘/换手有限/流动性偏低
- 资金：龙虎榜当日无数据/北向口径已停披露/（有数据时）净流入/净流出
- 消息：近期无新公告/有限售解禁/有股权激励/有重大事项（只照搬上文事件，不评好坏）
- 基本面：承压/盈利不稳/亏损/亏损收窄/扭亏/微利/增收/减收/毛利偏低/净利率为负/ROE为负/负债偏高
- 估值：偏高/偏低/中性/处历史高位/处历史低位/高于行业中位/低于行业中位

# 输出（综合不罗列）：固定四层骨架 + 张力收尾
按"盘面→基本面→估值→张力一句话画像"组织，每层一句、极克制、不逐段念数据：
1. 盘面层：市值规模 + 当日盘面定调。 2. 基本面层：盈利状态 + 趋势，白话化，关键词后紧跟数据出处。
3. 估值层：PE/PB/历史分位/行业对比的客观状态。 4. 张力收尾：把前三层拧成一个有张力的整体画像，点最突出的客观矛盾/背离，只陈述不解读。
资金/消息（②③）有则半句并入相邻层带过，无则如实说"无数据/已停披露"，不脑补。
- **②资金面铁律**：龙虎榜若上文标"无榜单数据/暂不可用"，**绝不编造**"主买/主力介入/资金流入/资金净买"等任何资金动向；北向停披露同理。只字不提或如实说"龙虎榜当日无数据"，**严禁脑补不存在的资金信号**。

# 真"解读"不是"罗列"（这是和同花顺机器诊股的差异点，务必做到）
- **把关键数字翻成人话判断**（仍是状态判断、非买卖）：ROE 偏低/为负=自有资本赚钱能力弱、PE 历史高分位=比自己过去多数时候贵、扣非净利≈归母=利润实在(非靠一次性收益)/差距大=利润含金量需打折、每股经营现金流 vs 每股收益=利润是否收到真金白银、季度环比=在加速还是减速。别只念"ROE 6%"，要说"6% 的 ROE 说明自有资本赚钱能力偏弱"。
- **重大潜在影响必须点出含义、不能只罗列**：若 ③ 有**大额限售解禁**（如合计数亿股），要点出"是客观的潜在抛压/流通盘增加"这一**结构性事实**；控股股东质押、重大收购等同理。**只陈述客观影响（"X亿股解禁=潜在卖压"），绝不预测股价会因此涨跌、绝不给操作建议。**

# 风格
大白话、口语、移动端友好；禁术语裸奔（ROE/负债率/分位要白话化或紧跟解释）；总长 3-5 句、约 150 字内；纯文字，无小标题/bullet/表格/感叹号/情绪词。某维度"数据暂不可用"就跳过，不补数字。`;

function assemblePanoramaPlain(body: string): string {
  return `${body}\n\n${QA_DISCLAIMER_BLOCK}`;
}

function assemblePanoramaPassed(body: string, interpretation: string): string {
  const core = interpretation
    .trim()
    .replace(/^#{0,4}\s*⑦?\s*分析师视角[^\n]*\n+/, '')
    .trim();
  return [
    body,
    '',
    '## ⑦ 分析师视角（状态画像 · 分析师判断 · 非定论）',
    core,
    '',
    QA_DISCLAIMER_BLOCK,
  ].join('\n');
}

function assemblePanoramaDegraded(body: string): string {
  return [
    body,
    '',
    '> 注：本次「分析师视角」综合未通过合规校验，已按要求仅呈现 ①-⑤ 客观数据，未提供综合画像。以上仅为客观信息聚合，不构成任何投资建议。',
    '',
    QA_DISCLAIMER_BLOCK,
  ].join('\n');
}

/**
 * 全景版执行器（Phase2 deep）：取 ①-⑤ 确定性数据 → 渲染 → ⑦ LLM 状态画像 → 合规闸门 →
 * 组装。⑦ 越线/失败/空 → 降级为纯 ①-⑤ 数据（数据围栏隔离，确定性层不受影响）。
 */
export async function runAsharePanorama(
  deps: AshareQaRunnerDeps,
  match: AshareQaMatch,
): Promise<AshareQaResult> {
  const now = deps.now ?? new Date();
  const mode = deps.mode ?? 'prod';
  const data = await fetchPanoramaData(deps.client, match);
  const body = renderPanoramaBody(data, match, now, mode);
  const context = buildPanoramaContext(data, match);

  let interpretation = '';
  try {
    interpretation = (
      await deps.interpret({
        system: SECTION7_SYSTEM,
        user: `【①-⑤ 事实卡上下文（只准用这里出现过的数字）】\n${context}`,
      })
    ).trim();
  } catch (e) {
    deps.logger.warn(
      { ...deps.context, err: e instanceof Error ? e.message : String(e) },
      'ashare-panorama: ⑦ LLM 调用失败，回退纯数据',
    );
    return { answer: assemblePanoramaPlain(body), degraded: false, interpreted: false };
  }
  if (!interpretation) {
    deps.logger.warn({ ...deps.context }, 'ashare-panorama: ⑦ 返回空，回退纯数据');
    return { answer: assemblePanoramaPlain(body), degraded: false, interpreted: false };
  }

  const gate = complianceGate(interpretation, context);
  const stocks = match.stocks.map((s) => s.symbol);
  const mkPass = (): AshareQaResult => ({
    answer: assemblePanoramaPassed(body, interpretation),
    degraded: false,
    interpreted: true,
  });
  const mkDegrade = (reason?: GateReason): AshareQaResult => ({
    answer: assemblePanoramaDegraded(body),
    degraded: true,
    reason,
    interpreted: false,
  });

  // ── 第二层：LLM 意图判官（deps.judge 注入即启用，tasks.ts 按 ASHARE_INTENT_JUDGE_ENABLED 控制）──
  //   regex PASS                          → judge 仅"明确 block"才否决（补 regex 漏网的语义暗示）
  //   regex SOFT(predict/tension/semantic) → judge 仅"明确 pass"才救回（过去式/状态被误杀）
  //   regex HARD(advice/technical/ungrounded) → regex 终判，judge 不介入（红线不松动）
  //   judge unclear/失败                    → 回落 regex（PASS 仍出 / SOFT 仍降级），不制造新降级
  if (deps.judge) {
    if (gate.passed) {
      const j = await judgeIntent(deps.judge, interpretation);
      if (j.verdict === 'block') {
        deps.logger.warn(
          {
            ...deps.context,
            event: 'ashare_qa_degrade',
            reason: 'judge',
            lane: 'panorama',
            layer: 'intent-judge',
            judgeRedline: j.redline,
            judgeQuote: j.quote,
            stocks,
          },
          'ashare-qa:intent-judge-block（regex 已过，judge 补抓漏网）',
        );
        // 红线A(买卖)→advice，否则→predict（仅影响降级 reason 标注）。
        return mkDegrade(j.redline === 'A' || j.redline === 'both' ? 'advice' : 'predict');
      }
      deps.logger.info(
        {
          ...deps.context,
          event: 'ashare_qa_judge',
          lane: 'panorama',
          regexPassed: true,
          judge: j.verdict,
          stocks,
        },
        'ashare-qa:intent-judge-pass',
      );
      return mkPass();
    }
    if (isSoftGateReason(gate.subReason)) {
      const j = await judgeIntent(deps.judge, interpretation);
      if (j.verdict === 'pass') {
        deps.logger.info(
          {
            ...deps.context,
            event: 'ashare_qa_judge_rescue',
            lane: 'panorama',
            regexReason: gate.subReason,
            regexHits: gate.hits,
            stocks,
          },
          'ashare-qa:intent-judge-rescue（救回 regex 误杀的合规⑦）',
        );
        return mkPass();
      }
      deps.logger.warn(
        {
          ...deps.context,
          event: 'ashare_qa_degrade',
          reason: gate.reason,
          subReason: gate.subReason,
          hits: gate.hits,
          lane: 'panorama',
          judge: j.verdict,
          stocks,
        },
        'ashare-qa:compliance-gate-degradation（SOFT + judge 确认/unclear）',
      );
      return mkDegrade(gate.reason);
    }
    // HARD：advice/technical/ungrounded —— regex 终判。
    deps.logger.warn(
      {
        ...deps.context,
        event: 'ashare_qa_degrade',
        reason: gate.reason,
        subReason: gate.subReason,
        hits: gate.hits,
        lane: 'panorama',
        judge: 'skipped-hard',
        stocks,
      },
      'ashare-qa:compliance-gate-degradation（HARD 红线，judge 不介入）',
    );
    return mkDegrade(gate.reason);
  }

  // ── judge 未注入：regex-only（原行为，零变化）──
  if (!gate.passed) {
    deps.logger.warn(
      {
        ...deps.context,
        event: 'ashare_qa_degrade',
        reason: gate.reason,
        hits: gate.hits,
        lane: 'panorama',
        stocks,
      },
      'ashare-qa:compliance-gate-degradation',
    );
    return mkDegrade(gate.reason);
  }
  return mkPass();
}
