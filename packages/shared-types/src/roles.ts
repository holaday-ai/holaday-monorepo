/**
 * Role catalogue — shared metadata for the 33 specialist personas the
 * agent can adopt. The full prompt text lives in the orchestrator
 * (`apps/orchestrator/src/agent/supercar/prompt-layers.ts`); this
 * file holds only what both server (permission gate) and frontend
 * (selection UI) need.
 *
 * Tier split:
 *   - `pro`  — 10 personas locked behind the Pro plan. These are the
 *              long-horizon research / synthesis roles where Opus 4.7
 *              earns its keep (PM, contracts, financial modelling…).
 *   - `open` — 23 personas in the open pool. Basic plan picks 5 of
 *              these as their active set; Pro plan gets all of them
 *              automatically.
 *
 * Role ids are stable identifiers used by the classifier in
 * prompt-layers.ts, the `tasks.role_id` column, and the
 * `users.selected_roles` JSON list. Renaming an id requires a data
 * migration — extend with new ids instead.
 */

export type RoleTier = 'open' | 'pro';

export type RoleCategory =
  | 'marketing'
  | 'ecommerce'
  | 'product'
  | 'data'
  | 'support'
  | 'hr'
  | 'specialty';

export interface RoleDefinition {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly tier: RoleTier;
  readonly category: RoleCategory;
}

/**
 * Pro-exclusive personas (10). Long-horizon analysis / synthesis
 * tasks where the Opus-tier model materially changes output quality.
 * Hidden from Basic plan (and free) regardless of selected_roles.
 */
export const PRO_EXCLUSIVE_ROLE_IDS = [
  'executive-briefing',
  'executive-summary',
  'product-manager',
  'senior-pm',
  'financial-forecaster',
  'dynamic-pricing',
  'trend-researcher',
  'brand-guardian',
  'contract-reviewer',
  'xiaohongshu-expert',
] as const;

export type ProExclusiveRoleId = (typeof PRO_EXCLUSIVE_ROLE_IDS)[number];

const PRO_EXCLUSIVE_SET: ReadonlySet<string> = new Set(PRO_EXCLUSIVE_ROLE_IDS);

/**
 * Open-pool personas (23). Basic plan can pick up to 5; Pro plan
 * gets the whole pool by default.
 */
export const OPEN_POOL_ROLE_IDS = [
  'xiaohongshu-operator',
  'douyin-strategist',
  'wechat-operator',
  'content-creator',
  'social-media-strategist',
  'growth-hacker',
  'image-prompt-engineer',
  'visual-storyteller',
  'china-ecommerce',
  'private-traffic',
  'livestream-coach',
  'cross-border-ecommerce',
  'feedback-analyst',
  'data-analyst',
  'finance-tracker',
  'customer-service',
  'legal-compliance',
  'policy-writer',
  'recruiter',
  'recruiting-ops',
  'performance-mgmt',
  'supply-chain',
  'tech-translator',
] as const;

export type OpenPoolRoleId = (typeof OPEN_POOL_ROLE_IDS)[number];

export type RoleId = ProExclusiveRoleId | OpenPoolRoleId | 'none';

export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  // 营销 & 内容 (open + pro)
  {
    id: 'xiaohongshu-operator',
    nameZh: '小红书运营',
    nameEn: 'Xiaohongshu Operator',
    descriptionZh: '种草笔记结构、爆款公式、达人合作基础策略',
    descriptionEn: 'RED platform basics: post structure, viral formulas, KOL pairing',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'xiaohongshu-expert',
    nameZh: '小红书专家',
    nameEn: 'Xiaohongshu Expert',
    descriptionZh: '全域增长策略、矩阵搭建、爆款冷启动、商业化路径设计',
    descriptionEn: 'Full-funnel RED growth strategy, matrix design, cold-start playbooks',
    tier: 'pro',
    category: 'marketing',
  },
  {
    id: 'douyin-strategist',
    nameZh: '抖音策略师',
    nameEn: 'Douyin Strategist',
    descriptionZh: '抖音算法、短视频结构、直播话术、DOU+ 投放',
    descriptionEn: 'Douyin algorithm, short-video structure, livestream pacing, DOU+ buys',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'wechat-operator',
    nameZh: '微信公众号运营',
    nameEn: 'WeChat Operator',
    descriptionZh: '公众号策略、社群 SOP、私域裂变机制',
    descriptionEn: 'Official-account strategy, community SOP, private-traffic loops',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'content-creator',
    nameZh: '内容创作专家',
    nameEn: 'Content Creator',
    descriptionZh: '多平台内容适配、标题优化、SEO、内容日历',
    descriptionEn: 'Multi-platform content, headline optimisation, SEO, content calendars',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'social-media-strategist',
    nameZh: '社交媒体策略师',
    nameEn: 'Social Media Strategist',
    descriptionZh: '跨平台整合、KOL/KOC 评估、危机公关',
    descriptionEn: 'Multi-platform integration, KOL/KOC sourcing, crisis comms',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'growth-hacker',
    nameZh: '增长黑客',
    nameEn: 'Growth Hacker',
    descriptionZh: 'AARRR、病毒循环、A/B 测试、增长实验',
    descriptionEn: 'AARRR, viral loops, A/B testing, growth experiments',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'brand-guardian',
    nameZh: '品牌守护者',
    nameEn: 'Brand Guardian',
    descriptionZh: '品牌一致性、调性审查、竞品定位',
    descriptionEn: 'Brand consistency, voice audits, competitive positioning',
    tier: 'pro',
    category: 'marketing',
  },
  {
    id: 'image-prompt-engineer',
    nameZh: 'AI 出图提示词工程师',
    nameEn: 'Image Prompt Engineer',
    descriptionZh: 'Midjourney / SD 提示词结构与迭代策略',
    descriptionEn: 'Midjourney / SD prompt design and iteration playbooks',
    tier: 'open',
    category: 'marketing',
  },
  {
    id: 'visual-storyteller',
    nameZh: '视觉叙事师',
    nameEn: 'Visual Storyteller',
    descriptionZh: '数据可视化、信息图表、PPT 节奏',
    descriptionEn: 'Data viz, infographics, deck pacing',
    tier: 'open',
    category: 'marketing',
  },

  // 电商 & 运营 (open)
  {
    id: 'china-ecommerce',
    nameZh: '中国电商运营',
    nameEn: 'China E-commerce',
    descriptionZh: '天猫 / 京东 / 拼多多店铺运营、大促节奏',
    descriptionEn: 'Tmall / JD / PDD store ops, big-promo pacing',
    tier: 'open',
    category: 'ecommerce',
  },
  {
    id: 'private-traffic',
    nameZh: '私域流量运营',
    nameEn: 'Private Traffic',
    descriptionZh: '企业微信 SCRM、社群分层、生命周期触达',
    descriptionEn: 'WeCom SCRM, community tiers, lifecycle touch',
    tier: 'open',
    category: 'ecommerce',
  },
  {
    id: 'livestream-coach',
    nameZh: '直播电商主播教练',
    nameEn: 'Livestream Coach',
    descriptionZh: '话术结构、场控节奏、投流配合',
    descriptionEn: 'Script structure, room pacing, ad-buy coordination',
    tier: 'open',
    category: 'ecommerce',
  },
  {
    id: 'cross-border-ecommerce',
    nameZh: '跨境电商运营',
    nameEn: 'Cross-border E-commerce',
    descriptionZh: '亚马逊 / Shopify / TikTok Shop 运营与本地化',
    descriptionEn: 'Amazon / Shopify / TikTok Shop ops + localisation',
    tier: 'open',
    category: 'ecommerce',
  },

  // 产品 & 项目 (mixed)
  {
    id: 'trend-researcher',
    nameZh: '趋势研究员',
    nameEn: 'Trend Researcher',
    descriptionZh: '市场情报、竞品对标、趋势判断、机会评估',
    descriptionEn: 'Market intel, competitive benchmarks, trend reads, opportunity sizing',
    tier: 'pro',
    category: 'product',
  },
  {
    id: 'feedback-analyst',
    nameZh: '反馈分析师',
    nameEn: 'Feedback Analyst',
    descriptionZh: 'NPS、情感分析、反馈分类与优先级',
    descriptionEn: 'NPS, sentiment, feedback triage and prioritisation',
    tier: 'open',
    category: 'product',
  },
  {
    id: 'product-manager',
    nameZh: '产品经理',
    nameEn: 'Product Manager',
    descriptionZh: 'PRD 撰写、需求拆解、RICE/ICE 优先级',
    descriptionEn: 'PRDs, story breakdown, RICE/ICE prioritisation',
    tier: 'pro',
    category: 'product',
  },
  {
    id: 'senior-pm',
    nameZh: '高级项目经理',
    nameEn: 'Senior PM',
    descriptionZh: '大型项目排期、风险缓解、跨团队协调',
    descriptionEn: 'Large-program scheduling, risk burn-down, cross-team coordination',
    tier: 'pro',
    category: 'product',
  },

  // 数据 & 分析 (mixed)
  {
    id: 'data-analyst',
    nameZh: '数据分析师',
    nameEn: 'Data Analyst',
    descriptionZh: '数据清洗、SQL、可视化图表、商业指标',
    descriptionEn: 'Data cleaning, SQL, chart selection, business KPIs',
    tier: 'open',
    category: 'data',
  },
  {
    id: 'financial-forecaster',
    nameZh: '财务预测分析师',
    nameEn: 'Financial Forecaster',
    descriptionZh: 'DCF、收入预测、三表联动',
    descriptionEn: 'DCF, revenue forecasting, three-statement modelling',
    tier: 'pro',
    category: 'data',
  },
  {
    id: 'finance-tracker',
    nameZh: '财务追踪员',
    nameEn: 'Finance Tracker',
    descriptionZh: '预算跟踪、费用分析、现金流监控',
    descriptionEn: 'Budget tracking, expense analysis, cashflow watch',
    tier: 'open',
    category: 'data',
  },
  {
    id: 'dynamic-pricing',
    nameZh: '动态定价策略师',
    nameEn: 'Dynamic Pricing',
    descriptionZh: '价格弹性、促销定价、阶梯设计、A/B 价格测试',
    descriptionEn: 'Elasticity, promo pricing, tiering, A/B price tests',
    tier: 'pro',
    category: 'data',
  },

  // 支持 & 合规 (mixed)
  {
    id: 'customer-service',
    nameZh: '客服响应专家',
    nameEn: 'Customer Service',
    descriptionZh: '问题分类、话术模板、升级流程',
    descriptionEn: 'Ticket triage, response templates, escalation paths',
    tier: 'open',
    category: 'support',
  },
  {
    id: 'legal-compliance',
    nameZh: '法务合规员',
    nameEn: 'Legal Compliance',
    descriptionZh: 'GDPR / 个保法 / 平台规则、广告法禁用词',
    descriptionEn: 'GDPR / PIPL / platform policy, ad-law forbidden terms',
    tier: 'open',
    category: 'support',
  },
  {
    id: 'contract-reviewer',
    nameZh: '合同审查专家',
    nameEn: 'Contract Reviewer',
    descriptionZh: '风险条款识别、对手方修改、法律陷阱预警',
    descriptionEn: 'Risk clause spotting, counterparty redlines, trap detection',
    tier: 'pro',
    category: 'support',
  },
  {
    id: 'policy-writer',
    nameZh: '制度文件撰写',
    nameEn: 'Policy Writer',
    descriptionZh: '企业制度 / SOP 文档、流程标准化',
    descriptionEn: 'Corporate policy, SOP docs, process standardisation',
    tier: 'open',
    category: 'support',
  },
  {
    id: 'executive-summary',
    nameZh: '高管摘要师',
    nameEn: 'Executive Summary',
    descriptionZh: '复杂信息压缩、结论前置、1 页篇幅',
    descriptionEn: 'Information compression, conclusion-first, 1-page max',
    tier: 'pro',
    category: 'support',
  },

  // HR & 供应链 (open)
  {
    id: 'recruiter',
    nameZh: '招聘专家',
    nameEn: 'Recruiter',
    descriptionZh: 'JD 优化、简历筛选、面试问题设计',
    descriptionEn: 'JD optimisation, résumé screening, interview questions',
    tier: 'open',
    category: 'hr',
  },
  {
    id: 'recruiting-ops',
    nameZh: '招聘运营',
    nameEn: 'Recruiting Ops',
    descriptionZh: 'ATS 优化、漏斗分析、雇主品牌',
    descriptionEn: 'ATS optimisation, funnel analytics, employer brand',
    tier: 'open',
    category: 'hr',
  },
  {
    id: 'performance-mgmt',
    nameZh: '绩效管理',
    nameEn: 'Performance Mgmt',
    descriptionZh: 'OKR / KPI 设计、360 反馈、PIP 流程',
    descriptionEn: 'OKR / KPI design, 360 feedback, PIP processes',
    tier: 'open',
    category: 'hr',
  },
  {
    id: 'supply-chain',
    nameZh: '供应链采购',
    nameEn: 'Supply Chain',
    descriptionZh: '供应商评估、库存管理、采购成本优化',
    descriptionEn: 'Vendor evaluation, inventory, procurement cost optimisation',
    tier: 'open',
    category: 'hr',
  },

  // 专项 (mixed)
  {
    id: 'tech-translator',
    nameZh: '技术翻译专家',
    nameEn: 'Tech Translator',
    descriptionZh: '中英技术文档、API 文档本地化',
    descriptionEn: 'EN/CN technical docs, API doc localisation',
    tier: 'open',
    category: 'specialty',
  },
  {
    id: 'executive-briefing',
    nameZh: '高管简报',
    nameEn: 'Executive Briefing',
    descriptionZh: '战略级信息提炼、金字塔原理、行动建议',
    descriptionEn: 'Strategic distillation, pyramid principle, action items',
    tier: 'pro',
    category: 'specialty',
  },
];

const ROLE_BY_ID: ReadonlyMap<string, RoleDefinition> = new Map(
  ROLE_CATALOGUE.map((r) => [r.id, r]),
);

export function getRoleDefinition(id: string): RoleDefinition | undefined {
  return ROLE_BY_ID.get(id);
}

export function isProExclusiveRole(id: string): boolean {
  return PRO_EXCLUSIVE_SET.has(id);
}

/**
 * Permission gate: given a detected role + the user's plan +
 * selected role ids, return the role to actually inject (or `'none'`
 * to skip the role layer).
 *
 * Free plan: never gets a role. Basic: only roles that are open-pool
 * AND in the user's selected list. Pro: every role in the catalogue.
 */
export function gateRoleForUser(
  detectedRoleId: string,
  userPlan: string,
  selectedRoleIds: readonly string[],
): string {
  if (!detectedRoleId || detectedRoleId === 'none') return 'none';
  if (userPlan === 'free') return 'none';
  if (userPlan === 'pro') return detectedRoleId;
  // basic
  if (PRO_EXCLUSIVE_SET.has(detectedRoleId)) return 'none';
  if (!selectedRoleIds.includes(detectedRoleId)) return 'none';
  return detectedRoleId;
}

/** Maximum number of roles a Basic-plan user can select. */
export const BASIC_ROLE_PICK_LIMIT = 5;

/** Hard cap on role-set changes per calendar month (anti-thrash). */
export const ROLE_CHANGES_PER_MONTH = 3;
