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

export type SkillCategory = '运营' | '商业分析' | '法律' | '产品' | '其他';

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
