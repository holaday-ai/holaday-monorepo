import type { ExecutionMode } from '../intent-classifier.js';

export type ExpertWorkflowId = 'douyin-livestream-review';

export interface ExpertWorkflowMatch {
  id: ExpertWorkflowId;
  name: string;
  roleIds: readonly string[];
  missingInputs: readonly MissingInput[];
  routeOverride: ExecutionMode | null;
  promptPreamble: string;
}

type MissingInput = 'liveSession' | 'dataSource';

interface MatchOpts {
  hasAttachments?: boolean;
}

const DOUYIN_TERMS = ['抖音', 'douyin', 'tiktok', '千川', '巨量百应', '电商罗盘'];
const LIVE_TERMS = ['直播', '直播间', '带货', '主播', 'gmv', 'gpm', 'uv价值', '场次'];
const REVIEW_TERMS = ['复盘', '分析', '总结', '优化', '诊断', '报告', '策略', '改进'];

const SESSION_PATTERNS = [
  /昨天|今日|今天|前天|本周|上周|本月|上月|今晚|上午|下午|晚上/u,
  /近\s*\d+\s*[天日周月]/u,
  /最近\s*\d+\s*[天日周月]?/u,
  /上一场|最近一场|这场直播|该场直播/u,
  /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?/u,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/u,
  /\d{1,2}:\d{2}/u,
];

const PLATFORM_SOURCE_PATTERNS = [
  /抖音电商罗盘|电商罗盘|罗盘/u,
  /巨量百应|巨量千川|千川|巨量引擎/u,
  /蝉妈妈|飞瓜|新抖|抖查查/u,
  /商家后台|店铺后台|后台|创作者中心/u,
  /https?:\/\/|www\./iu,
];

// F3 — UPLOAD_SOURCE_PATTERNS was previously used to infer
// `hasUploadedDataSource` from intent text alone. That treated "我会
// 上传表格" / "稍后发截图" as already-satisfied data sources, sending
// the task straight to generate with nothing to analyse. The data-
// source check now requires `hasAttachments === true`; the text
// pattern was redundant and was removed.

export function matchExpertWorkflow(
  intent: string,
  opts: MatchOpts = {},
): ExpertWorkflowMatch | null {
  if (!matchesDouyinLivestreamReview(intent)) return null;

  const hasAttachments = Boolean(opts.hasAttachments);
  const hasLiveSession = SESSION_PATTERNS.some((pattern) => pattern.test(intent));
  const hasPlatformDataSource = PLATFORM_SOURCE_PATTERNS.some((pattern) => pattern.test(intent));
  // F3 — `hasUploadedDataSource` only counts when an attachment is
  // ACTUALLY present. Earlier text-pattern path ("上传/附件/表格/截图")
  // matched on intent text alone, which mistakenly treated "我会上传
  // 表格" / "稍后发截图" (intent-to-upload) as a satisfied data
  // source — task then went straight to generate and the model had
  // no data to analyse. Now those phrases fall through to
  // missingInputs=[dataSource], parking the task on awaiting_user
  // until the user actually attaches a file or pastes data.
  // UPLOAD_SOURCE_PATTERNS retained as documentation; not load-
  // bearing for routing.
  const hasUploadedDataSource = hasAttachments;
  const hasDataSource = hasPlatformDataSource || hasUploadedDataSource;

  const missingInputs: MissingInput[] = [];
  if (!hasLiveSession) missingInputs.push('liveSession');
  if (!hasDataSource) missingInputs.push('dataSource');

  // Route decision. Critical: when the workflow needs more info from
  // the user (`missingInputs.length > 0`), DO NOT allocate a Brave —
  // route to `generate` so the intake question round trips through
  // the cheap one-shot runner. Earlier code routed to `browser` here,
  // which spun up a per-task Brave just for the model to immediately
  // park on `awaiting_user` asking the same question. The pool slot
  // sat unused for the entire user-reply window.
  // Once the user has supplied data, the reply path (tasks.reply)
  // re-evaluates and either continues in generate (manual data /
  // attachment) or hands off to browser (platform-source reply).
  const routeOverride: ExecutionMode | null =
    missingInputs.length > 0
      ? 'generate'
      : hasPlatformDataSource && !hasUploadedDataSource
        ? 'browser'
        : hasUploadedDataSource
          ? 'generate'
          : null;

  return {
    id: 'douyin-livestream-review',
    name: '抖音直播复盘',
    roleIds: ['douyin-strategist', 'livestream-coach', 'china-ecommerce', 'data-analyst'],
    missingInputs,
    routeOverride,
    promptPreamble: buildDouyinLivestreamPreamble({
      missingInputs,
      hasPlatformDataSource,
      hasUploadedDataSource,
    }),
  };
}

function matchesDouyinLivestreamReview(intent: string): boolean {
  const lower = intent.toLowerCase();
  const hasDouyin = DOUYIN_TERMS.some((term) => lower.includes(term.toLowerCase()));
  const hasLive = LIVE_TERMS.some((term) => lower.includes(term.toLowerCase()));
  const hasReview = REVIEW_TERMS.some((term) => lower.includes(term.toLowerCase()));
  return hasDouyin && hasLive && hasReview;
}

function buildDouyinLivestreamPreamble(opts: {
  missingInputs: readonly MissingInput[];
  hasPlatformDataSource: boolean;
  hasUploadedDataSource: boolean;
}): string {
  const missingLabels = opts.missingInputs.map(labelForMissingInput);
  const sourceHint = opts.hasUploadedDataSource
    ? '用户倾向使用上传的数据/截图/表格。优先分析附件内容；不要为了补全可由附件回答的信息而浏览网页。'
    : opts.hasPlatformDataSource
      ? '用户倾向使用抖音/巨量/第三方后台数据。需要通过已登录浏览器读取；遇到登录页先请用户登录后继续。'
      : '用户尚未说明数据在哪里。';

  const intakeGuard =
    opts.missingInputs.length > 0
      ? [
          `当前缺少：${missingLabels.join('、')}。`,
          '在缺少上述关键信息时，先不要调用任何工具，不要 navigate，不要 web_search，也不要凭经验生成复盘。',
          '请先向用户提出 1-3 个最小必要问题，并给出快捷选项。问题应覆盖：复盘哪一场直播、数据在后台还是上传附件、希望产出简版结论还是详细运营报告。',
          // P1-A — explicit park marker. The agent-loop's question
          // detector previously only flagged outputs ending in '?' /
          // '？', so a structured intake list (numbered, no trailing
          // question mark) was treated as a completed turn and the
          // task hit a terminal completed state with the user's
          // intake question never reaching them. The marker below is
          // detected upstream as a strong signal to park to
          // awaiting_user; the trailing-? heuristic is kept as a
          // belt-and-suspenders fallback.
          '在你输出问题列表的同一回合末尾，必须独占一行写入 [AWAITING_USER_INPUT]。这是机器读取的暂停标记，对用户不可见，但会让本任务保持 awaiting_user 状态等待补充。',
          '用户回答后，将原始需求和补充信息合并成执行上下文，再继续执行。这次不要再写 [AWAITING_USER_INPUT]。',
        ].join('\n')
      : [
          '最低启动信息已基本具备。可以开始执行，但所有经营结论必须来自用户提供的数据、后台读取结果或明确标注的公开来源。',
        ].join('\n');

  return [
    '【专家技能工作流：抖音直播复盘】',
    '你正在执行一个专业运营复盘任务，不是普通闲聊。目标是帮助用户复盘抖音直播数据，并给出可执行的下场优化策略。',
    sourceHint,
    intakeGuard,
    '',
    '执行时必须尽量收集或要求用户补充这些指标：GMV、订单数、UV、GPM、UV价值、平均在线、停留时长、商品点击率、加购率、成交转化率、流量来源、投放消耗/ROI、TOP SKU、关键话术或节奏节点。',
    '最终报告结构固定为：1. 关键结论；2. 核心指标表；3. 主要问题诊断；4. 归因分析；5. 下一场直播优化动作；6. 话术/商品/投放实验清单；7. 缺失数据与风险说明。',
    '不得编造后台数字。任何未取得的数据都要写成“缺失/未提供”，并说明它会影响哪一类判断。',
    '',
    '数据一致性校验（必须在生成报告前执行，结果在报告最前面输出）：',
    '1. 计算 GMV ÷ 订单数 = 实际客单价，与用户给的客单价比对。',
    '2. 计算 订单数 ÷ UV = 实际整体转化率，与用户给的转化率比对。',
    '3. 计算 GMV ÷ 千川消耗 = 实际 ROI，与用户给的 ROI 比对。',
    '4. 任何一项实算与用户给值差异 > 10%，必须在报告最前面插入 ⚠️ 数据矛盾预警块：',
    '   - 列出冲突的两个指标和两个具体数值（实算值 vs 用户值）。',
    '   - 给出最可能的解释（举例：用户给的"转化率"可能指商品点击成交率而非 UV 整体成交率；GMV 是否含退款等）。',
    '   - 明确标注"以下分析按 [X] 口径暂算，结论需以用户修正后的数据重新验证"。',
    '5. 不得用矛盾数据继续推导其他指标（如：用错误的整体转化率反推加购率、UV 价值）。',
    '6. 如果几组数据无法自洽（例如 GMV、订单数、客单价三者对不上），不要选一组继续推，而是先在预警块里明确请用户确认数据口径。',
    '7. 校验通过（差异 ≤ 10%）才能进入正常 7 段报告结构。',
    '',
    '数据来源标注规则（必须遵守）：',
    '- 用户提供的数据：直接引用，标注"用户提供"。',
    '- 系统计算的指标（如 UV 成本 = 千川消耗/UV）：标注"系统计算"。',
    '- 行业基准/经验数据：标注"经验参考，需以实际类目数据校验"。',
    '- 如果用户没有明确类目，不要假设类目。写"按综合电商参考"而不是"美妆黄金档"等具体类目档位。',
    '- 不要编造具体的行业基准数字。如果没有把握，写"—"并注明"缺少类目基准数据"。',
    '',
  ].join('\n');
}

function labelForMissingInput(input: MissingInput): string {
  switch (input) {
    case 'liveSession':
      return '直播场次或时间窗';
    case 'dataSource':
      return '数据来源';
  }
}
