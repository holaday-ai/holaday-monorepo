export type SkillCategory = '内容运营' | '分析决策' | '管理协作';

export type SkillMaturity = 'template' | 'workflow' | 'connected';

export type SkillConnectorId =
  | 'browser'
  | 'douyin'
  | 'xiaohongshu'
  | 'wechat-official-account'
  | 'image-understanding'
  | 'image-generation'
  | 'a-share-market-data'
  | 'document-parser'
  | 'web-search'
  | 'spreadsheet'
  | 'database'
  | 'recruiting-sites';

export type SkillLogoId =
  | 'douyin-live-ops'
  | 'xiaohongshu-seeding-ops'
  | 'wechat-article-ops'
  | 'social-media-strategy'
  | 'image-prompt-reverse'
  | 'a-share-market-briefing'
  | 'contract-risk-review'
  | 'market-competitor-insight'
  | 'data-report-insight'
  | 'product-plan-drafting'
  | 'project-delivery-management'
  | 'resume-search-screening'
  | 'performance-review-design';

export interface SkillExperience {
  starterPrompts: readonly [string, string, string];
  requiredInputs: readonly string[];
  deliverables: readonly string[];
  boundary: string;
  exampleSummary: string;
}

export interface HoladaySkill {
  id: SkillLogoId;
  name: string;
  category: SkillCategory;
  description: string;
  aliases: readonly string[];
  logoId: SkillLogoId;
  maturity: SkillMaturity;
  connectors: readonly SkillConnectorId[];
  experience: SkillExperience;
}

export const HOLADAY_SKILLS = [
  {
    id: 'douyin-live-ops',
    name: '抖音直播与运营',
    category: '内容运营',
    description: '直播复盘、短视频选题、脚本与账号运营',
    aliases: ['抖音', '直播', '短视频', '带货', 'douyin', 'tiktok', '千川', '巨量百应'],
    logoId: 'douyin-live-ops',
    maturity: 'workflow',
    connectors: ['browser', 'douyin'],
    experience: {
      starterPrompts: [
        '复盘这场直播，找出流失点和下一场优化动作',
        '为这个产品写一份 60 秒直播讲解脚本',
        '规划未来 7 天的直播与短视频选题',
      ],
      requiredInputs: ['直播回放或数据截图', '产品与目标受众信息'],
      deliverables: ['复盘结论与问题清单', '下一轮脚本或运营计划'],
      boundary: '不会代替平台发布、投流或承诺销量；关键数据缺失时会标注待确认。',
      exampleSummary: '从直播数据和内容中提炼流失原因、有效话术与下一场行动。',
    },
  },
  {
    id: 'xiaohongshu-seeding-ops',
    name: '小红书种草运营',
    category: '内容运营',
    description: '笔记选题、标题正文、种草转化优化',
    aliases: ['小红书', '种草', '笔记', '薯条', 'xiaohongshu', 'rednote'],
    logoId: 'xiaohongshu-seeding-ops',
    maturity: 'workflow',
    connectors: ['browser', 'xiaohongshu'],
    experience: {
      starterPrompts: [
        '分析这些竞品笔记，找出值得借鉴的选题和表达',
        '围绕这个产品写一篇小红书种草笔记',
        '规划未来 7 天的小红书选题和发布节奏',
      ],
      requiredInputs: ['产品卖点与目标受众', '参考笔记或账号数据（可选）'],
      deliverables: ['选题、标题与正文草稿', '转化优化与风险提醒'],
      boundary: '不会代替账号发布或承诺流量；无法读取的平台数据会明确标注。',
      exampleSummary: '把产品卖点转成适合小红书语境的选题、笔记和转化路径。',
    },
  },
  {
    id: 'wechat-article-ops',
    name: '公众号推文运营',
    category: '内容运营',
    description: '长文选题、推文结构、标题与排版建议',
    aliases: ['公众号', '微信', '推文', '长文', '订阅号', '服务号'],
    logoId: 'wechat-article-ops',
    maturity: 'workflow',
    connectors: ['browser', 'wechat-official-account'],
    experience: {
      starterPrompts: [
        '根据这些资料整理一篇公众号文章大纲',
        '把这篇初稿改成更适合公众号阅读的版本',
        '规划未来 4 周的公众号选题',
      ],
      requiredInputs: ['主题、品牌资料或参考内容', '目标读者与期望语气'],
      deliverables: ['标题、结构与正文草稿', '排版和发布检查清单'],
      boundary: '不会代替公众号发布；引用、数据和品牌表述需要用户最终确认。',
      exampleSummary: '把零散资料组织成长文结构，并补齐标题、正文和发布检查。',
    },
  },
  {
    id: 'social-media-strategy',
    name: '社交媒体策略',
    category: '内容运营',
    description: '多平台内容矩阵、发布节奏、账号定位',
    aliases: ['社媒', '社交媒体', '全平台', '内容矩阵', '账号定位', '发布节奏'],
    logoId: 'social-media-strategy',
    maturity: 'workflow',
    connectors: ['browser', 'web-search'],
    experience: {
      starterPrompts: [
        '为这个品牌设计一套多平台内容矩阵',
        '规划新品发布期的社交媒体内容节奏',
        '复盘这组社媒数据并提出下周动作',
      ],
      requiredInputs: ['品牌目标、受众与使用平台', '现有内容或运营数据（可选）'],
      deliverables: ['平台定位与内容矩阵', '发布节奏和复盘建议'],
      boundary: '不会自动发布或投放广告；缺少平台数据时只基于已提供信息判断。',
      exampleSummary: '把品牌目标拆成跨平台定位、内容主题和可执行的发布节奏。',
    },
  },
  {
    id: 'image-prompt-reverse',
    name: '图片反推提示词',
    category: '内容运营',
    description: '上传图片，反推风格、构图、生成提示词',
    aliases: ['图片', '提示词', '反推', 'prompt', 'midjourney', 'dalle', 'sora'],
    logoId: 'image-prompt-reverse',
    maturity: 'connected',
    connectors: ['image-understanding', 'image-generation'],
    experience: {
      starterPrompts: [
        '分析这张图的风格、构图和生成提示词',
        '保留主体特征，把画面改成另一种视觉风格',
        '为这张参考图生成三套不同方向的提示词',
      ],
      requiredInputs: ['清晰的参考图片', '目标工具、比例或风格（可选）'],
      deliverables: ['视觉拆解与生成提示词', '负面提示词和参数建议'],
      boundary: '不保证不同模型完全复现；使用前需确认图片授权、肖像权和商用范围。',
      exampleSummary: '识别画面的主体、光线、材质和构图，整理成可继续生成的提示词。',
    },
  },
  {
    id: 'a-share-market-briefing',
    name: 'A股行情解读',
    category: '分析决策',
    description: '行情事实、异动原因、风险提示，不荐股',
    aliases: ['A股', '股票', '行情', '股市', '大盘', '个股', '涨跌', '异动'],
    logoId: 'a-share-market-briefing',
    maturity: 'connected',
    connectors: ['a-share-market-data'],
    experience: {
      starterPrompts: [
        '总结今天 A 股市场表现并标出主要风险',
        '解释这只股票最近的异动和需要警惕的信号',
        '比较这两个行业近期的强弱与驱动因素',
      ],
      requiredInputs: ['市场、行业或股票范围', '关注周期与风险偏好（可选）'],
      deliverables: ['带日期和来源的行情事实', '驱动因素、反证与风险提示'],
      boundary: '不构成投资建议，不代替下单；行情延迟或降级时会明确标注。',
      exampleSummary: '用带日期的数据解释市场变化，并把事实、推断和风险分开呈现。',
    },
  },
  {
    id: 'contract-risk-review',
    name: '合同风险审查',
    category: '分析决策',
    description: '条款风险、修改建议、谈判关注点',
    aliases: ['合同', '法务', '条款', '风险审查', '协议', '谈判'],
    logoId: 'contract-risk-review',
    maturity: 'workflow',
    connectors: ['document-parser'],
    experience: {
      starterPrompts: [
        '从甲方立场审查这份合同并标出高风险条款',
        '比较这两个合同版本，说明关键变化',
        '整理一份合同谈判关注点和修改建议',
      ],
      requiredInputs: ['完整合同或协议文件', '你的签约角色与业务目标'],
      deliverables: ['风险分级与条款定位', '修改建议和谈判问题清单'],
      boundary: '仅提供合同阅读辅助，不构成正式法律意见；重大事项应由执业律师复核。',
      exampleSummary: '按条款定位风险、影响和修改建议，帮助你更有准备地复核和谈判。',
    },
  },
  {
    id: 'market-competitor-insight',
    name: '市场竞品洞察',
    category: '分析决策',
    description: '竞品调研、市场定位、机会点分析',
    aliases: ['竞品', '市场', '洞察', '调研', 'SWOT', '机会点'],
    logoId: 'market-competitor-insight',
    maturity: 'workflow',
    connectors: ['browser', 'web-search'],
    experience: {
      starterPrompts: [
        '研究这个市场的规模、趋势和进入机会',
        '比较这三家竞品的定位、产品和增长方式',
        '根据公开信息找出一个差异化定位',
      ],
      requiredInputs: ['品类、地区与目标用户', '已知竞品或内部材料（可选）'],
      deliverables: ['市场与竞品对照', '机会、风险和待验证假设'],
      boundary: '只基于可访问资料和用户提供信息；无法核实的数据会标记为推断或待确认。',
      exampleSummary: '把分散的公开信息整理成市场地图、竞品差异和下一步验证方向。',
    },
  },
  {
    id: 'data-report-insight',
    name: '数据报表解读',
    category: '分析决策',
    description: '表格分析、指标归因、异常发现',
    aliases: ['数据', '报表', '表格', 'Excel', 'KPI', '归因', '异常'],
    logoId: 'data-report-insight',
    maturity: 'connected',
    connectors: ['spreadsheet', 'database'],
    experience: {
      starterPrompts: [
        '分析这份周报，找出异常和最值得关注的变化',
        '解释这些 KPI 为什么变化，并列出需要补充的数据',
        '把这份表格整理成一页管理层摘要',
      ],
      requiredInputs: ['表格、报表或数据文件', '指标口径与业务背景（可选）'],
      deliverables: ['关键发现与异常清单', '图表摘要和决策建议'],
      boundary: '结果取决于数据质量和口径；相关性不会被直接表述为因果关系。',
      exampleSummary: '从表格中提炼变化、异常和关键指标，生成可继续讨论的报告摘要。',
    },
  },
  {
    id: 'product-plan-drafting',
    name: '产品方案策划',
    category: '管理协作',
    description: '需求拆解、方案设计、PRD 初稿',
    aliases: ['产品', '需求', 'PRD', '方案', '原型', '功能设计'],
    logoId: 'product-plan-drafting',
    maturity: 'workflow',
    connectors: ['document-parser'],
    experience: {
      starterPrompts: [
        '把这些需求整理成一份清晰的 PRD 初稿',
        '拆解这个产品想法的用户问题和功能范围',
        '为这个功能定义 MVP、验收标准和后续版本',
      ],
      requiredInputs: ['目标用户、问题和业务目标', '已有资料、限制或反馈（可选）'],
      deliverables: ['需求范围与优先级', 'PRD 初稿和验收标准'],
      boundary: '不会自动批准需求或代替研发评估；成本、排期和技术可行性需团队确认。',
      exampleSummary: '把模糊想法拆成目标、范围、用户流程和可验收的产品方案。',
    },
  },
  {
    id: 'project-delivery-management',
    name: '项目推进管理',
    category: '管理协作',
    description: '里程碑、风险、任务拆解、推进节奏',
    aliases: ['项目', '推进', '里程碑', '排期', '风险', '任务拆解'],
    logoId: 'project-delivery-management',
    maturity: 'workflow',
    connectors: ['document-parser'],
    experience: {
      starterPrompts: [
        '把这个项目目标拆成里程碑、任务和负责人建议',
        '根据当前进度找出延期风险和下一步动作',
        '把这些项目记录整理成一份周报',
      ],
      requiredInputs: ['目标、截止时间与资源约束', '当前任务、负责人和依赖（可选）'],
      deliverables: ['任务拆解与里程碑', '风险清单和进度摘要'],
      boundary: '不会未经授权自动指派或修改项目；负责人、承诺和最终排期由团队确认。',
      exampleSummary: '把目标、任务、依赖和风险整理成可跟进的推进结构。',
    },
  },
  {
    id: 'resume-search-screening',
    name: '简历搜索筛选',
    category: '管理协作',
    description: '招聘网站找人、简历筛选、面试问题',
    aliases: ['简历', '招聘', '候选人', '人才', '面试', 'JD', 'Boss直聘', '猎聘'],
    logoId: 'resume-search-screening',
    maturity: 'connected',
    connectors: ['browser', 'recruiting-sites', 'document-parser'],
    experience: {
      starterPrompts: [
        '根据这份 JD 筛选候选人并说明匹配依据',
        '比较这些简历的优势、风险和需要追问的点',
        '为这个岗位生成结构化面试问题',
      ],
      requiredInputs: ['职位说明与筛选标准', '候选人资料或招聘页面授权'],
      deliverables: ['带依据的候选人对照', '风险提示和面试问题'],
      boundary: '只提供招聘辅助，不代替录用决定；不得基于敏感身份特征进行歧视性筛选。',
      exampleSummary: '把岗位要求和候选人证据逐项对照，形成可复核的筛选与面试材料。',
    },
  },
  {
    id: 'performance-review-design',
    name: '绩效考核设计',
    category: '管理协作',
    description: 'KPI/OKR、考核制度、绩效评估表',
    aliases: ['绩效', '考核', 'KPI', 'OKR', '评估', '制度'],
    logoId: 'performance-review-design',
    maturity: 'workflow',
    connectors: ['document-parser'],
    experience: {
      starterPrompts: [
        '为这个岗位设计一套可衡量的 KPI',
        '把部门目标拆成季度 OKR 和评分规则',
        '审查这份绩效方案是否清晰、公平且可执行',
      ],
      requiredInputs: ['岗位职责、业务目标与周期', '现有制度或评价样表（可选）'],
      deliverables: ['指标、权重与评分规则', '评估表和执行注意事项'],
      boundary: '不会替代 HR 或管理决策；涉及薪酬、劳动关系和合规时需专业复核。',
      exampleSummary: '把岗位目标转成可衡量指标、评分规则和可落地的评估表。',
    },
  },
] as const satisfies readonly HoladaySkill[];

export type SkillId = (typeof HOLADAY_SKILLS)[number]['id'];

const SKILL_BY_ID = new Map<string, HoladaySkill>(
  HOLADAY_SKILLS.map((skill) => [skill.id, skill]),
);

export const LEGACY_SKILL_ID_ALIASES = {
  douyin: 'douyin-live-ops',
  xiaohongshu: 'xiaohongshu-seeding-ops',
  wechat_gongzhong: 'wechat-article-ops',
  'social-media-strategist': 'social-media-strategy',
  'image-prompt-engineer': 'image-prompt-reverse',
  'a-share-analyst': 'a-share-market-briefing',
  chinese_legal: 'contract-risk-review',
  'contract-reviewer': 'contract-risk-review',
  competitive_analyst: 'market-competitor-insight',
  'data-analyst': 'data-report-insight',
  product_manager: 'product-plan-drafting',
  'project-manager-sr': 'project-delivery-management',
  recruiter: 'resume-search-screening',
  'recruiting-ops': 'resume-search-screening',
  'performance-mgr': 'performance-review-design',
} as const satisfies Readonly<Record<string, SkillId>>;

export function canonicalSkillId(id: string): SkillId | undefined {
  const trimmed = id.trim();
  if (SKILL_BY_ID.has(trimmed)) return trimmed as SkillId;
  return LEGACY_SKILL_ID_ALIASES[trimmed as keyof typeof LEGACY_SKILL_ID_ALIASES];
}

export function skillById(id: string): HoladaySkill | undefined {
  const canonical = canonicalSkillId(id);
  return canonical ? SKILL_BY_ID.get(canonical) : undefined;
}

export function skillMatchesQuery(skill: HoladaySkill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [skill.name, skill.id, ...skill.aliases].some((value) =>
    value.toLowerCase().includes(q),
  );
}

export function normalizeSkillIds(value: unknown): SkillId[] {
  if (!Array.isArray(value)) return [];
  const out: SkillId[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const skillId = canonicalSkillId(item);
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    out.push(skillId);
  }
  return out;
}
