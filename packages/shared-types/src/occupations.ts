/**
 * Canonical occupation list — Phase 0.
 *
 * Users type free text in onboarding ("我是做天猫运营的"), and we soft-match
 * it to one of these tags so commander routing and Skill targeting can use
 * a stable key. The raw text is still stored in `user_profiles.occupation_raw`.
 *
 * Tags are lowercase, dash-separated; label_zh drives UI presentation; aliases
 * feed the matcher.
 */
export interface CanonicalOccupation {
  tag: string;
  labelZh: string;
  labelEn: string;
  aliases: readonly string[];
  group: 'ecommerce' | 'finance' | 'service' | 'research' | 'marketing' | 'ops' | 'other';
}

export const CANONICAL_OCCUPATIONS: readonly CanonicalOccupation[] = [
  {
    tag: 'ecommerce-ops',
    labelZh: '电商运营',
    labelEn: 'E-commerce Operations',
    aliases: ['电商', '天猫运营', '淘宝运营', '京东运营', '拼多多运营', '抖音电商', '店铺运营'],
    group: 'ecommerce',
  },
  {
    tag: 'ecommerce-customer-service',
    labelZh: '电商客服',
    labelEn: 'E-commerce Customer Service',
    aliases: ['客服', '千牛客服', '旺旺客服', '店铺客服', '售前客服', '售后客服'],
    group: 'service',
  },
  {
    tag: 'ecommerce-analyst',
    labelZh: '电商数据分析',
    labelEn: 'E-commerce Data Analyst',
    aliases: ['生意参谋', '数据分析', '店铺数据', '电商数据'],
    group: 'ecommerce',
  },
  {
    tag: 'finance-research',
    labelZh: '金融研究员',
    labelEn: 'Financial Research Analyst',
    aliases: ['研究员', '金融分析师', '行业研究员', '投研', '券商研究员'],
    group: 'finance',
  },
  {
    tag: 'equity-trader',
    labelZh: '股票交易员',
    labelEn: 'Equity Trader',
    aliases: ['炒股', '股民', '股票交易', 'trader'],
    group: 'finance',
  },
  {
    tag: 'marketing-ops',
    labelZh: '市场运营',
    labelEn: 'Marketing Operations',
    aliases: ['市场', '运营', '品牌运营', '活动运营', '内容运营'],
    group: 'marketing',
  },
  {
    tag: 'social-media-manager',
    labelZh: '新媒体运营',
    labelEn: 'Social Media Manager',
    aliases: ['新媒体', '公众号运营', '小红书运营', '抖音运营', '社媒运营'],
    group: 'marketing',
  },
  {
    tag: 'hr-recruiter',
    labelZh: '人力资源 / 招聘',
    labelEn: 'HR / Recruiter',
    aliases: ['HR', '人事', '招聘', 'hr', 'recruiter'],
    group: 'ops',
  },
  {
    tag: 'sales-bd',
    labelZh: '销售 / 商务',
    labelEn: 'Sales / BD',
    aliases: ['销售', '商务', 'bd', 'sales', '业务员'],
    group: 'ops',
  },
  {
    tag: 'admin-assistant',
    labelZh: '行政助理',
    labelEn: 'Admin / Assistant',
    aliases: ['行政', '助理', '文员', 'secretary'],
    group: 'ops',
  },
  {
    tag: 'researcher',
    labelZh: '研究员 / 学术',
    labelEn: 'Researcher / Academic',
    aliases: ['研究员', '学者', '博士', '硕士', 'phd', 'researcher'],
    group: 'research',
  },
  {
    tag: 'product-manager',
    labelZh: '产品经理',
    labelEn: 'Product Manager',
    aliases: ['产品', '产品经理', 'pm', 'product manager'],
    group: 'ops',
  },
  {
    tag: 'other',
    labelZh: '其他',
    labelEn: 'Other',
    aliases: [],
    group: 'other',
  },
];

export type OccupationTag = (typeof CANONICAL_OCCUPATIONS)[number]['tag'];

const OCCUPATION_INDEX: ReadonlyMap<string, CanonicalOccupation> = (() => {
  const map = new Map<string, CanonicalOccupation>();
  for (const o of CANONICAL_OCCUPATIONS) {
    map.set(o.tag.toLowerCase(), o);
    map.set(o.labelZh.toLowerCase(), o);
    map.set(o.labelEn.toLowerCase(), o);
    for (const alias of o.aliases) {
      map.set(alias.toLowerCase(), o);
    }
  }
  return map;
})();

/**
 * Soft-match user-typed occupation text to a canonical tag.
 * Returns `null` if no signal found (caller can default to 'other').
 *
 * Matching is substring-based on the lowercased input: the alias or label
 * must appear somewhere in the user text. Multiple matches → first by
 * declaration order (curated priority).
 */
export function matchOccupation(raw: string): CanonicalOccupation | null {
  if (!raw) return null;
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;

  // Direct hit (exact tag / label / alias).
  const direct = OCCUPATION_INDEX.get(needle);
  if (direct) return direct;

  // Substring: alias appears inside raw.
  for (const o of CANONICAL_OCCUPATIONS) {
    if (o.tag === 'other') continue;
    if (needle.includes(o.labelZh.toLowerCase())) return o;
    if (needle.includes(o.labelEn.toLowerCase())) return o;
    for (const alias of o.aliases) {
      if (alias && needle.includes(alias.toLowerCase())) return o;
    }
  }
  return null;
}
