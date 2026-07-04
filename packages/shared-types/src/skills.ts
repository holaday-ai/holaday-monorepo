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

export interface HoladaySkill {
  id: SkillLogoId;
  name: string;
  category: SkillCategory;
  description: string;
  aliases: readonly string[];
  logoId: SkillLogoId;
  maturity: SkillMaturity;
  connectors: readonly SkillConnectorId[];
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
