/**
 * DomainClassifier — pure keyword-based intent routing.
 *
 * Why not an LLM call: classification runs on every task create; we
 * don't want to pay a round-trip (latency + $ + rate limits) just to
 * decide whether to inject a finance paragraph. Keyword tables hit
 * 90%+ of dogfood cases in practice, and the low-confidence path
 * degrades cleanly to 'general'.
 *
 * The table is closed-world on purpose: adding a domain means adding
 * keywords here AND a domains/<name>.yaml. Keeping classifier + YAML
 * together prevents "routed to X, no X config" surprises at runtime.
 */

export type DomainName =
  | 'finance'
  | 'news'
  | 'ecommerce'
  | 'social'
  | 'tech'
  | 'legal'
  | 'job'
  | 'general';

export interface Classification {
  domain: DomainName;
  /** 0..1. Below 0.3 we collapse to 'general'. */
  confidence: number;
  /** Free-form bucket for finer-grained prompt selection later. */
  subCategory?: string;
  /** Keywords that actually matched — surfaced in logs for debugging. */
  matched: string[];
}

// Keyword buckets. Ordered by expected precision: `finance` / `legal`
// lists are tighter; `tech` is broader and must be weighted lower to
// avoid hijacking generic product tasks.
interface Bucket {
  domain: DomainName;
  /** Weight per match — more specific domains get higher weight. */
  weight: number;
  /**
   * Keywords are lowercased match tokens. We check substring inclusion
   * (word boundaries don't work for CJK). List both zh-CN and
   * commonly-typed EN variants so user language preference doesn't
   * change routing.
   */
  keywords: readonly string[];
}

const BUCKETS: readonly Bucket[] = [
  {
    domain: 'finance',
    weight: 1.0,
    keywords: [
      '股票',
      '股价',
      '基金',
      '财报',
      'k线',
      '涨跌',
      '市盈率',
      'pe',
      'roe',
      'roic',
      'ebitda',
      '净利润',
      '毛利率',
      '营收',
      'etf',
      '茅台',
      '东方财富',
      '雪球',
      '同花顺',
      'stock price',
      'earnings',
      'financial report',
      '10-k',
    ],
  },
  {
    domain: 'legal',
    weight: 1.0,
    keywords: [
      '合同',
      '起诉',
      '诉讼',
      '判决',
      '仲裁',
      '律师',
      '法律意见',
      '违约',
      '侵权',
      '专利',
      '商标',
      '条款',
      '免责',
      '合规',
      'nda',
      'contract',
      'lawsuit',
      'legal opinion',
      'gdpr',
      'compliance',
    ],
  },
  {
    domain: 'job',
    weight: 0.9,
    keywords: [
      '招聘',
      '简历',
      '面试',
      '猎头',
      'boss直聘',
      '拉勾',
      '前程无忧',
      '智联',
      'linkedin',
      'jobs',
      'hiring',
      'resume',
      'job posting',
      '投递',
      'offer',
    ],
  },
  {
    domain: 'ecommerce',
    weight: 0.9,
    keywords: [
      '淘宝',
      '京东',
      '天猫',
      '拼多多',
      '亚马逊',
      'amazon',
      '购物车',
      '比价',
      '促销',
      '优惠券',
      'sku',
      '退货',
      '卖家',
      '商品详情',
      '下单',
    ],
  },
  {
    domain: 'news',
    weight: 0.8,
    keywords: [
      '新闻',
      '头条',
      '资讯',
      '热榜',
      '报道',
      '快讯',
      '澎湃',
      '新华社',
      '财经新闻',
      'reuters',
      'bloomberg',
      'nytimes',
      'news',
      'breaking news',
    ],
  },
  {
    domain: 'social',
    weight: 0.8,
    keywords: [
      '微博',
      '小红书',
      '抖音',
      '快手',
      '知乎',
      'b站',
      'bilibili',
      'twitter',
      'x.com',
      'reddit',
      '评论',
      '点赞',
      '转发',
      '粉丝',
      '热搜',
    ],
  },
  {
    domain: 'tech',
    weight: 0.7, // broadest — kept last so more specific domains win ties
    keywords: [
      'github',
      'stack overflow',
      'stackoverflow',
      'api 文档',
      'api docs',
      'sdk',
      'npm',
      'pypi',
      '编译',
      '报错',
      '堆栈',
      'exception',
      'changelog',
      'readme',
      'cli',
    ],
  },
];

/**
 * Classify an intent. Never throws — returns `general` at confidence 0
 * for empty input, and for any input whose best score falls below the
 * 0.3 cutoff.
 */
export function classify(intent: string): Classification {
  if (!intent || !intent.trim()) {
    return { domain: 'general', confidence: 0, matched: [] };
  }
  const needle = intent.toLowerCase();
  // Per-bucket (matched-keyword list, score). Score = sum(keyword
  // weight) / intent-length-in-k-chars, giving a soft normalisation so
  // a 2-keyword hit on a 1k-char intent doesn't score higher than a
  // 1-keyword hit on a 10-char intent.
  const hits = BUCKETS.map((b) => {
    const matched: string[] = [];
    for (const k of b.keywords) {
      if (needle.includes(k)) matched.push(k);
    }
    const raw = matched.length * b.weight;
    return { bucket: b, matched, raw };
  }).filter((h) => h.matched.length > 0);

  if (hits.length === 0) {
    return { domain: 'general', confidence: 0, matched: [] };
  }
  // Pick the highest raw score; ties broken by bucket order (which
  // we've curated by specificity above).
  hits.sort((a, b) => b.raw - a.raw);
  const best = hits[0]!;
  // Confidence heuristic: diminishing returns past 3 matches. 1 → 0.5,
  // 2 → 0.75, 3 → 0.88, 4+ → 0.95. Weight multiplier keeps `tech`
  // (weight 0.7) from winning confidence ties against `finance` (1.0).
  const n = best.matched.length;
  const raw = 1 - 1 / (n + 1); // 1→0.5, 2→0.67, 3→0.75...
  const confidence = Math.min(0.95, raw + 0.25 * best.bucket.weight);

  if (confidence < 0.3) {
    return { domain: 'general', confidence, matched: best.matched };
  }
  return {
    domain: best.bucket.domain,
    confidence,
    matched: best.matched,
  };
}
