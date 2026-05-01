/**
 * Phase 16 — public-facing metadata for the supercar role library.
 *
 * The roles in `agent/supercar/roles/index.ts` are the source of
 * truth for system-prompt addons (name + keywords + weight +
 * systemAddon). The 专家技能 settings page needs three additional
 * fields per entry that aren't useful to the agent itself:
 *
 *   - id: stable string id used in users.selected_roles JSON + URL
 *   - icon: lucide-react component name for the SkillCard render
 *   - category: top-level grouping shown above the card row
 *   - description: one-line tagline shown beneath the name
 *
 * Side-car instead of editing AgentRole because:
 *   - Existing role file is heavy (450 LoC) and shipped — minimising
 *     diff keeps reviews easy
 *   - The role-matcher is on the hot path; AgentRole stays lean
 *   - This file can be regenerated independently when the role
 *     library grows
 *
 * Keys MUST match the role's `name` field exactly. The list order
 * here defines the display order on the SkillsPage.
 */

export type SkillCategory =
  | '运营'
  | '内容'
  | '商业分析'
  | '产品'
  | '法律'
  | '人力'
  | '行政'
  | '财务'
  | '翻译'
  | '其他';

export interface SkillMeta {
  /** Stable id, persisted in users.selected_roles. */
  id: string;
  /** Display name (from the role; duplicated here for the SPA bundle). */
  name: string;
  /** lucide-react export name. The SPA looks this up dynamically. */
  icon: string;
  category: SkillCategory;
  description: string;
}

/**
 * Ordered list. Each entry's `name` matches a role.name in
 * `agent/supercar/roles/index.ts`. Adding a new role means adding
 * BOTH to that file (for the system prompt) AND here (for the
 * settings page surface) — there's no fallback so a missing entry
 * silently hides the role from the user.
 */
export const SKILL_META: readonly SkillMeta[] = [
  {
    id: 'xiaohongshu',
    name: '小红书内容运营',
    icon: 'Heart',
    category: '运营',
    description: '爆款笔记、KOC 种草、平台算法解读',
  },
  {
    id: 'douyin',
    name: '抖音运营专家',
    icon: 'Video',
    category: '运营',
    description: '短视频复盘、流量分析、直播策略',
  },
  {
    id: 'wechat_gongzhong',
    name: '微信公众号运营',
    icon: 'MessageSquare',
    category: '运营',
    description: '推文选题、爆文复盘、私域运营',
  },
  {
    id: 'ecommerce_cn',
    name: '电商运营',
    icon: 'ShoppingBag',
    category: '运营',
    description: '淘宝/京东/拼多多店铺运营、爆款打造',
  },
  {
    id: 'chinese_legal',
    name: '中国法律检索助手',
    icon: 'Scale',
    category: '法律',
    description: '法条查询、案例分析、合规建议',
  },
  {
    id: 'financial_analyst',
    name: '金融分析师',
    icon: 'TrendingUp',
    category: '商业分析',
    description: '财报解读、估值模型、投资建议',
  },
  {
    id: 'competitive_analyst',
    name: '竞品分析师',
    icon: 'BarChart3',
    category: '商业分析',
    description: '竞品调研、市场定位、SWOT 分析',
  },
  {
    id: 'product_manager',
    name: '产品经理',
    icon: 'Layers',
    category: '产品',
    description: '需求分析、PRD 撰写、用户研究',
  },
  // ----- Phase 20b — channel + growth specialists -----
  {
    id: 'private-traffic',
    name: '私域流量运营师',
    icon: 'Users',
    category: '运营',
    description: '社群运营、会员管理、裂变增长',
  },
  {
    id: 'livestream-coach',
    name: '直播电商主播教练',
    icon: 'Video',
    category: '运营',
    description: '直播话术、带货复盘、流量分析',
  },
  {
    id: 'cross-border-ecom',
    name: '跨境电商运营专家',
    icon: 'Globe',
    category: '运营',
    description: 'Amazon/Shopify/独立站运营',
  },
  {
    id: 'social-media-strategist',
    name: '社交媒体策略师',
    icon: 'Share2',
    category: '运营',
    description: '多平台策略、KOL合作、舆情监控',
  },
  {
    id: 'growth-hacker',
    name: '增长黑客',
    icon: 'TrendingUp',
    category: '运营',
    description: 'AARRR增长模型、获客策略、A/B测试',
  },
  // ----- Phase 20b — content + brand -----
  {
    id: 'content-creator',
    name: '内容创作者',
    icon: 'PenTool',
    category: '内容',
    description: '文案撰写、爆款标题、多平台适配',
  },
  {
    id: 'brand-guardian',
    name: '品牌守护者',
    icon: 'Shield',
    category: '内容',
    description: '品牌调性审查、VI一致性、品牌故事',
  },
  {
    id: 'visual-storyteller',
    name: '视觉叙事师',
    icon: 'Palette',
    category: '内容',
    description: '视觉设计、信息图、PPT美化',
  },
  {
    id: 'image-prompt-engineer',
    name: '图像提示词工程师',
    icon: 'Image',
    category: '内容',
    description: 'AI绘画提示词、Midjourney/DALL-E优化',
  },
  // ----- Phase 20b — business analysis -----
  {
    id: 'trend-researcher',
    name: '趋势研究员',
    icon: 'Compass',
    category: '商业分析',
    description: '行业趋势、市场洞察、研报分析',
  },
  {
    id: 'feedback-analyst',
    name: '反馈分析师',
    icon: 'MessageCircle',
    category: '商业分析',
    description: '用户反馈分析、NPS、口碑监控',
  },
  {
    id: 'data-analyst',
    name: '数据分析师',
    icon: 'BarChart3',
    category: '商业分析',
    description: '数据分析、报表制作、KPI监控',
  },
  {
    id: 'pricing-strategist',
    name: '动态定价策略师',
    icon: 'DollarSign',
    category: '商业分析',
    description: '定价策略、促销方案、利润分析',
  },
  {
    id: 'supply-chain',
    name: '供应链采购策略师',
    icon: 'Truck',
    category: '商业分析',
    description: '供应商管理、成本控制、库存优化',
  },
  // ----- Phase 20b — product + project -----
  {
    id: 'project-manager-sr',
    name: '高级项目经理',
    icon: 'Kanban',
    category: '产品',
    description: '项目排期、风险管理、敏捷/瀑布',
  },
  // ----- Phase 20b — legal -----
  {
    id: 'contract-reviewer',
    name: '合同审查专家',
    icon: 'FileCheck',
    category: '法律',
    description: '合同条款审查、风险标注、修改建议',
  },
  // ----- Phase 20b — HR -----
  {
    id: 'recruiter',
    name: '招聘专家',
    icon: 'UserPlus',
    category: '人力',
    description: 'JD撰写、简历筛选、面试设计',
  },
  {
    id: 'recruiting-ops',
    name: '招聘运营专家',
    icon: 'UserCheck',
    category: '人力',
    description: '招聘漏斗优化、雇主品牌、数据分析',
  },
  {
    id: 'performance-mgr',
    name: '绩效管理专家',
    icon: 'Target',
    category: '人力',
    description: 'KPI/OKR设计、绩效评估、激励方案',
  },
  // ----- Phase 20b — admin / exec -----
  {
    id: 'policy-writer',
    name: '制度文件撰写专家',
    icon: 'ClipboardList',
    category: '行政',
    description: '规章制度、SOP、管理办法撰写',
  },
  {
    id: 'exec-summarizer',
    name: '高管摘要师',
    icon: 'FileText',
    category: '行政',
    description: '长文摘要、高管简报、要点提炼',
  },
  {
    id: 'exec-briefing',
    name: '高管简报',
    icon: 'Presentation',
    category: '行政',
    description: '管理层简报、决策支持、战略汇报',
  },
  {
    id: 'customer-service',
    name: '客服响应者',
    icon: 'Headphones',
    category: '行政',
    description: '客服话术、投诉处理、工单管理',
  },
  // ----- Phase 20b — finance -----
  {
    id: 'finance-tracker',
    name: '财务追踪员',
    icon: 'Calculator',
    category: '财务',
    description: '预算追踪、报销整理、现金流分析',
  },
  // ----- Phase 20b — translation -----
  {
    id: 'tech-translator',
    name: '技术翻译专家',
    icon: 'Languages',
    category: '翻译',
    description: '中英翻译、技术文档、本地化',
  },
  // ----- Generic helpers (kept) -----
  {
    id: 'email_writer',
    name: '邮件写作助手',
    icon: 'Mail',
    category: '其他',
    description: '商务邮件、跟进、谈判语气优化',
  },
  {
    id: 'tech_doc_researcher',
    name: '技术文档研究员',
    icon: 'BookOpen',
    category: '其他',
    description: '官方文档解读、API 调研、技术对比',
  },
];

/** Lookup by role name (matches AgentRole.name from the role library). */
export function skillMetaByName(name: string): SkillMeta | undefined {
  return SKILL_META.find((s) => s.name === name);
}

/** Lookup by stable id (matches users.selected_roles entry). */
export function skillMetaById(id: string): SkillMeta | undefined {
  return SKILL_META.find((s) => s.id === id);
}
