/**
 * Phase 2b — Expert Workflow: 内容选题 (content-topic).
 *
 * Second fully-typed expert workflow. Reuses the same framework
 * pieces as `douyin-review` (parser / intake / prompt builder /
 * verifier section_presence + source_annotation) — this file is
 * just the workflow DEFINITION, no new runtime logic.
 *
 * Domain: 小红书 / 抖音 / 视频号 / B 站 / 公众号 等平台的内容选题
 * 与标题策划。和 douyin-review（事后复盘）的对偶 — content-topic
 * 是事前生成。
 *
 * Schema:
 *   - 2 required inputs:
 *       category   — 品类 / 行业 (text，e.g. 美妆护肤、母婴、3C)
 *       platform   — 平台 (enum，限定值 — 不同平台的爆款逻辑差很大)
 *   - 6 optional inputs:
 *       target_audience  — 目标人群
 *       competitors      — 竞品账号
 *       keywords         — 关键词 / 长尾词
 *       content_format   — 内容形式 (enum: 图文/短视频/直播/长图文)
 *       topic_count      — 期望选题数 (default 5)
 *       season_event     — 季节 / 节点 (双 11 / 春节 / 开学季 等)
 *   - 0 data validators (内容选题没有算术约束 — 用 verifier 的 section
 *     presence + source annotation 把住质量)
 *   - 7 report sections (5 required + 2 optional):
 *       data_validation     — 数据校验（即便 0 validator 也保留，让用户
 *                              看到「无可校验项」的明确反馈）
 *       topic_directions    — 选题方向（5-7 个不同维度，必填，要标注来源）
 *       title_candidates    — 标题候选（每个方向 3-5 个标题，必填）
 *       content_outline     — Top 1-2 选题的详细大纲（必填）
 *       publishing_strategy — 发布策略（时间 / 频率 / 互动玩法，必填）
 *       execution_checklist — 执行 Checklist（Markdown checkbox，必填）
 *       competitor_reference — 竞品参考（可选，仅当用户提供 competitors 时输出）
 *   - 3 follow-up actions (扩展某个选题的脚本 / 生成发布日历 / 列竞品差异化)
 *
 * Matcher buckets (in registry):
 *   TASK terms:    选题 / 内容策划 / 爆款 / 标题
 *   PLATFORM terms: 小红书 / 抖音 / B站 / 视频号 / 公众号 / 知乎 / 微博 / xiaohongshu / bilibili
 * Need ALL of [TASK term] AND [PLATFORM term].
 */
import type {
  DataValidator,
  ExpertWorkflowContract,
  FollowUpAction,
  ReportSection,
  WorkflowInput,
} from './expert-workflow-contract.js';

const REQUIRED_INPUTS: readonly WorkflowInput[] = [
  {
    name: 'category',
    label: '品类 / 行业',
    type: 'text',
    // Anchor on "品类"/"行业"/"做的是" so a stray noun in the intent
    // doesn't get mis-attributed. Capture group is permissive — accepts
    // 1-30 Chinese / Latin chars, stops at punctuation.
    extractPattern:
      /(?:品类|行业|赛道|做的是|做的)[\s:：是]*(?:为|是)?\s*([\w一-鿿]{1,30})/i,
  },
  {
    name: 'platform',
    label: '目标平台',
    type: 'text',
    // Regex acts as the "enum gate": only known platform names match.
    // Stored as text (not enum) because the parser's enum coercion does
    // direct lowercase string compare and would reject "bilibili" /
    // "xiaohongshu" against CJK enum values. The downstream model + UI
    // are happy with either form.
    extractPattern:
      /(小红书|抖音|视频号|B\s*站|bilibili|公众号|知乎|微博|xiaohongshu)/i,
  },
] as const;

const OPTIONAL_INPUTS: readonly WorkflowInput[] = [
  {
    name: 'target_audience',
    label: '目标人群',
    type: 'text',
    // "目标人群: 25-35 岁宝妈" / "受众是Z世代男性" / "面向新手妈妈"
    extractPattern:
      /(?:目标人群|受众|面向|目标用户|TA)[\s:：是]*(?:是|为)?\s*([\w一-鿿\s\d\-,，、]+?)(?=[，。；,;\n]|$)/i,
  },
  {
    name: 'competitors',
    label: '竞品账号',
    type: 'text',
    // "竞品: A / B / C" — capture everything until line end or 句号
    extractPattern:
      /(?:竞品账号?|对标账号|参考账号|对标|参考)[\s:：]*([\w一-鿿\s\/、,，\-]+?)(?=[。；\n]|$)/i,
  },
  {
    name: 'keywords',
    label: '关键词 / 长尾词',
    type: 'text',
    extractPattern:
      /(?:关键词|长尾词|搜索词|seo|SEO)[\s:：]*([\w一-鿿\s\/、,，\-]+?)(?=[。；\n]|$)/i,
  },
  {
    name: 'content_format',
    label: '内容形式',
    type: 'text',
    // Regex-as-gate, same reason as `platform` — keeps the parser's
    // enum coercion off and lets us add aliases (短视频 / 视频 / video)
    // later without touching the parser.
    extractPattern: /(图文笔记|短视频|直播|长图文|播客)/i,
  },
  {
    name: 'topic_count',
    label: '选题数量',
    type: 'number',
    unit: '个',
    // Anchor on "选题数量"/"生成"/"出"/"要" then capture the number, then
    // require "个" (with or without "选题"). Examples that match:
    //   "选题数量 5" / "生成 8 个选题" / "出 10 个" / "要 6 个选题"
    extractPattern:
      /(?:选题数量|生成|出|要)\s*[:：]?\s*([\d.,]+)\s*个(?:选题)?/i,
    fallback: 5,
  },
  {
    name: 'season_event',
    label: '季节 / 节点',
    type: 'text',
    extractPattern:
      /(?:节点|节日|季节|档期|大促)[\s:：]*([\w一-鿿\s\/、,，\d]+?)(?=[。；,，\n]|$)/i,
  },
] as const;

// content-topic has no arithmetic to check — it's pre-creation, not
// post-data-analysis. Empty validator array: intake will skip the
// validators and proceed straight to 'ready' once required fields
// are present.
const DATA_VALIDATORS: readonly DataValidator[] = [];

const REPORT_SECTIONS: readonly ReportSection[] = [
  {
    id: 'data_validation',
    title: '数据校验',
    required: true,
    sourceAnnotation: false,
    guidance:
      '本工作流没有算术校验项。写"已通过（内容选题无算术约束）"+ 列出本次输入的关键参数（品类、平台、内容形式 / 期望数量等），让用户确认输入正确。',
  },
  {
    id: 'topic_directions',
    title: '选题方向',
    required: true,
    sourceAnnotation: true,
    guidance:
      '从 5-7 个不同维度产出选题方向。每个方向 1-2 句话说明角度 + 适用场景。每个方向后必须标注 [用户提供]/ [系统计算]/ [模型假设]/ [外部来源]：[用户提供] 用户关键词命中 / [系统计算] 平台机制推导 / [模型假设] 模型经验 / [外部来源] 外部基准引用。禁止只列 3 个或更少（输出深度不够）。',
  },
  {
    id: 'title_candidates',
    title: '标题候选',
    required: true,
    sourceAnnotation: true,
    guidance:
      '为上面每个选题方向生成 3-5 个标题候选。标题之间风格要差异化（数字党 / 反问 / 痛点 / 情绪 / 场景），不要堆同一个套路。每组标题前注明方向 id；每个标题后用括号标注主打钩子（数字 / 反问 / 痛点 / 情绪 / 场景）+ 来源 [用户提供]/ [系统计算]/ [模型假设]/ [外部来源]。',
  },
  {
    id: 'content_outline',
    title: '内容大纲',
    required: true,
    sourceAnnotation: false,
    guidance:
      '从上面挑出 1-2 个最有潜力的选题，写详细大纲：开头钩子（前 3 秒 / 前 1 行）→ 核心论点 3-5 条 → CTA。要落到具体话术 / 镜头描述 / 配图建议 — 不能只写"开头要吸引人"这种废话。',
  },
  {
    id: 'publishing_strategy',
    title: '发布策略',
    required: true,
    sourceAnnotation: true,
    guidance:
      '基于平台 + 品类给出最佳发布时段（具体到时间窗如 19:30-21:00）、发布频率（每周 X 条）、互动玩法（评论引导 / 私信钩子 / 置顶回复）。时段判断必须标注 [模型假设]（经验估计）或 [外部来源]（公开行业数据来源）。禁止给"高峰时段发布"这种抽象建议。',
  },
  {
    id: 'execution_checklist',
    title: '执行 Checklist',
    required: true,
    sourceAnnotation: false,
    guidance:
      'Markdown checkbox 格式（- [ ] 项）。覆盖：素材准备（图片 / 脚本 / 道具）、发布前 SEO / 关键词埋设、发布后前 30 分钟运营动作、48 小时数据复盘节点。',
  },
  {
    id: 'competitor_reference',
    title: '竞品参考',
    required: false,
    sourceAnnotation: true,
    guidance:
      '可选 — 仅当用户提供了 competitors 时输出。基于用户给的竞品名称：列每个账号的内容母题 + 标题套路 + 我们的差异化空白（写"我们做 X，他们没做"）。来源标注：[用户提供] 用户提供账号名 / [外部来源] 公开内容观察。没提供竞品就完全跳过整个 section（不写空标题）。',
  },
] as const;

const FOLLOW_UP_ACTIONS: readonly FollowUpAction[] = [
  {
    label: '展开 Top 选题脚本',
    prompt:
      '基于上面 Top 1 选题方向，帮我把内容大纲扩展成完整的脚本（开头钩子逐字稿 + 主体分镜 / 段落 + 结尾 CTA），可以直接拿去拍摄或写稿。',
  },
  {
    label: '生成 30 天发布日历',
    prompt:
      '基于这次选题方向，帮我排一份 30 天的发布日历：每条内容的选题、发布时段、所属系列、复用素材标记。',
  },
  {
    label: '列竞品差异化清单',
    prompt:
      '帮我列出在这个品类 / 平台上，本次选题方向相对于头部竞品的差异化清单：哪些角度他们已经做透了（避开），哪些是空白机会。',
  },
] as const;

const SYSTEM_PROMPT_PREAMBLE = [
  '【专家技能工作流：内容选题 (content-topic v1)】',
  '你是内容选题策划专家。用户已经提供了品类 + 平台（必填）和可选的人群 / 竞品 / 关键词 / 内容形式 / 选题数量 / 节点。请按下方 7 个 section 结构生成选题报告。',
  '',
  '## 来源标注规则（每个选题方向、标题、发布时段建议都必须标注一种）',
  '- [用户提供]：直接用了用户给的关键词 / 竞品 / 人群信息推导。',
  '- [系统计算]：基于平台已知机制（小红书 SEO 长尾、抖音前 3 秒钩子、B 站标题党约束等）推导。',
  '- [模型假设]：基于行业经验的推断，必须显式写"假设"或"经验估计"。',
  '- [外部来源]：引用公开数据 / 行业报告，必须标注来源名称（不可编造来源）。',
  '',
  '## 硬性约束',
  '- "选题方向" section 至少 5 个，最多 7 个。少于 5 个直接判失败 — 内容策划深度不够。',
  '- "标题候选" 每个方向 3-5 个，且套路必须差异化（不要 5 个全是数字党）。每个标题用括号标注钩子类型。',
  '- "内容大纲" 不接受抽象描述，必须落到具体话术 / 镜头 / 配图建议。',
  '- "发布策略" 时段必须给具体时间窗（如 19:30-21:00），不接受"晚上"这种粒度。',
  '- "执行 Checklist" 用 Markdown checkbox 格式（`- [ ] 项`）。',
  '- 竞品参考 section：用户没提供竞品就完全跳过（不写空 section、不放 placeholder）。',
  '- 没把握的行业基准数字写"—"+"缺少类目基准数据"，绝不编造。',
  '- 每个 section 的 title 必须严格按下方列出的写（用于 verifier 识别）。',
].join('\n');

export const CONTENT_TOPIC_WORKFLOW: ExpertWorkflowContract = {
  workflowId: 'content-topic',
  name: '内容选题策划',
  roleIds: [
    'content-strategist',
    'xiaohongshu-strategist',
    'douyin-content',
    'wechat-editor',
    'social-content',
  ],
  requiredInputs: REQUIRED_INPUTS,
  optionalInputs: OPTIONAL_INPUTS,
  dataValidators: DATA_VALIDATORS,
  reportSections: REPORT_SECTIONS,
  followUpActions: FOLLOW_UP_ACTIONS,
  systemPromptPreamble: SYSTEM_PROMPT_PREAMBLE,
};
