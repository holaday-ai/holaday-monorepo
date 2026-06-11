/**
 * Source-domain consistency (Web-Agent roadmap Step 2, 2026-06-11).
 *
 * Diagnosis T5: the user asked "用百度地图查…路线", the scrape lane answered
 * from a third-party SEO page (kan3721.com) and completed CLEAN — a silent
 * source substitution. This module is the deterministic guard: when the
 * intent EXPLICITLY names a site, the final answer's cited sources (or the
 * browser finalUrl) must include that site's domain, otherwise the verifier
 * flags a fixable inconsistency → partial_success.
 *
 * Deliberately small + conservative:
 *   - brand table is a short curated list (NOT exhaustive);
 *   - the check only FAILS when foreign sources exist AND none match —
 *     an answer with no extractable sources passes (can't prove
 *     substitution, avoid false positives);
 *   - "可以用其他来源" style permission in the intent disables the check.
 */

export interface SiteDomainRule {
  /** Matches the brand mention in the user's intent. */
  readonly brand: RegExp;
  /** Acceptable source base-domains (subdomains match). */
  readonly domains: readonly string[];
  /** Human label for the detail message. */
  readonly label: string;
}

// Word-boundary on the EN names so "linear regression" doesn't trip the
// Linear rule when no nav context exists — the check still only fires on
// source mismatch, but keep detection tight anyway.
export const SITE_DOMAIN_RULES: readonly SiteDomainRule[] = [
  { brand: /百度地图/, domains: ['baidu.com'], label: '百度地图' },
  { brand: /高德地图|高德导航/, domains: ['amap.com', 'gaode.com'], label: '高德地图' },
  { brand: /腾讯地图/, domains: ['map.qq.com', 'qq.com'], label: '腾讯地图' },
  { brand: /京东/, domains: ['jd.com'], label: '京东' },
  { brand: /淘宝/, domains: ['taobao.com'], label: '淘宝' },
  { brand: /天猫/, domains: ['tmall.com'], label: '天猫' },
  { brand: /拼多多/, domains: ['pinduoduo.com', 'yangkeduo.com'], label: '拼多多' },
  { brand: /豆瓣/, domains: ['douban.com'], label: '豆瓣' },
  { brand: /大众点评/, domains: ['dianping.com'], label: '大众点评' },
  { brand: /美团/, domains: ['meituan.com'], label: '美团' },
  { brand: /携程|\bctrip\b/i, domains: ['ctrip.com', 'trip.com'], label: '携程' },
  { brand: /去哪儿|去哪网/, domains: ['qunar.com'], label: '去哪儿' },
  { brand: /飞猪/, domains: ['fliggy.com', 'alitrip.com'], label: '飞猪' },
  { brand: /同程/, domains: ['ly.com'], label: '同程' },
  { brand: /\bnotion\b/i, domains: ['notion.com', 'notion.so'], label: 'Notion' },
  { brand: /\blinear\b/i, domains: ['linear.app'], label: 'Linear' },
  { brand: /\bgithub\b/i, domains: ['github.com'], label: 'GitHub' },
  { brand: /\blinkedin\b|领英/i, domains: ['linkedin.com'], label: 'LinkedIn' },
  { brand: /\bamazon\b|亚马逊/i, domains: ['amazon.com', 'amazon.cn'], label: 'Amazon' },
];

/** The user explicitly allows non-named sources → check disabled. */
const ALLOW_OTHER_SOURCES_RE =
  /可以?(?:使用|用)?(?:其他|其它|别的|任意|任何)(?:来源|网站|平台|渠道)|其他来源也(?:行|可以|没问题)|不限(?:来源|网站|平台)|允许(?:使用)?第三方|第三方来源也(?:行|可以)|any\s+source|other\s+sources?\s+(?:are\s+)?(?:ok|fine|allowed)/i;

/** Our own product domains — never count as a "source" the model cited. */
const OWN_DOMAINS = ['holaday.ai', 'orangebench.tech'];

// Bare-domain tokens ("kan3721.com" with no scheme). TLD whitelist keeps
// filenames out — `.md`/`.json`/`.txt` are real ccTLD/file suffixes that
// would otherwise turn "pomodoro-tips.md" into a phantom source.
const BARE_DOMAIN_RE =
  /\b[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.(?:com|cn|net|org|app|io|so|ai|co|tech|tv|cc|jp|hk|tw|site|xyz|top|vip|info|biz|online|travel|store|shop)\b/gi;

const FULL_URL_RE = /https?:\/\/([^\s/,;'"()<>\]]+)/gi;

function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/^www\./, '').replace(/[.,;:!?）)】」]+$/, '');
  if (!host || !host.includes('.')) return null;
  if (/[^a-z0-9.-]/.test(host)) return null;
  if (OWN_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  return host;
}

/**
 * Domains the answer actually leans on: every full URL host plus bare
 * domain tokens in the text, plus the browser finalUrl host.
 */
export function extractAnswerDomains(
  answerText: string | null | undefined,
  finalUrl?: string | null,
): Set<string> {
  const out = new Set<string>();
  const text = answerText ?? '';
  for (const m of text.matchAll(FULL_URL_RE)) {
    const host = normalizeHost((m[1] ?? '').split(':')[0] ?? '');
    if (host) out.add(host);
  }
  for (const m of text.matchAll(BARE_DOMAIN_RE)) {
    const host = normalizeHost(m[0] ?? '');
    if (host) out.add(host);
  }
  if (finalUrl) {
    try {
      const host = normalizeHost(new URL(finalUrl).hostname);
      if (host) out.add(host);
    } catch {
      /* unparseable finalUrl — ignore */
    }
  }
  return out;
}

/** Rules whose brand the intent explicitly names. */
export function detectRequiredSites(intent: string | null | undefined): SiteDomainRule[] {
  const t = intent ?? '';
  if (!t) return [];
  return SITE_DOMAIN_RULES.filter((r) => r.brand.test(t));
}

export interface SourceDomainVerdict {
  /** Labels of the sites the intent named (empty → no check ran). */
  readonly requiredLabels: readonly string[];
  /** Actual source domains found in the answer / finalUrl. */
  readonly actualDomains: readonly string[];
  /** True when sources exist but none belong to a named site. */
  readonly inconsistent: boolean;
}

function domainMatches(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Decide whether the answer silently substituted the named site.
 * Fails ONLY when: a site is named, substitution is not allowed, the
 * answer cites ≥1 real source domain, and none of them belong to ANY
 * named site. No extractable sources → pass (conservative).
 */
export function evaluateSourceDomain(opts: {
  intent: string | null | undefined;
  answerText: string | null | undefined;
  finalUrl?: string | null;
}): SourceDomainVerdict {
  const required = detectRequiredSites(opts.intent);
  if (required.length === 0 || ALLOW_OTHER_SOURCES_RE.test(opts.intent ?? '')) {
    return { requiredLabels: [], actualDomains: [], inconsistent: false };
  }
  const actual = extractAnswerDomains(opts.answerText, opts.finalUrl);
  const requiredLabels = required.map((r) => r.label);
  const actualDomains = [...actual];
  if (actual.size === 0) {
    return { requiredLabels, actualDomains, inconsistent: false };
  }
  const anyMatch = actualDomains.some((host) =>
    required.some((rule) => rule.domains.some((base) => domainMatches(host, base))),
  );
  return { requiredLabels, actualDomains, inconsistent: !anyMatch };
}
