/**
 * Phase 24 RC follow-up — three-route task execution classifier.
 *
 * Routes a user's task to one of three backends:
 *   - 'generate' — pure text generation, single Anthropic call. No
 *     web access. (Translation / SOPs / 方案 / pure analysis.)
 *   - 'scrape'   — needs page content but NOT live interaction.
 *     Firecrawl /scrape or /search returns markdown in 2-3s; the
 *     LLM then synthesises an answer from those bytes. (查询 /
 *     研究 / 对比 / "搜索 X 上的Y" / "分析 https://X".)
 *   - 'browser'  — needs to drive a live page (login, fill form,
 *     submit, click, multi-step flow). The expensive per-task
 *     BrowserPool path.
 *
 * Decision rules (priority order — first match wins):
 *
 *   1. Skill hint — unambiguous skill ids force a route.
 *   2. INTERACTION verb (登录/打开/下单/操作/提交/点击/填写/比价/...)
 *      → 'browser'. The agent is being asked to drive a live page.
 *   3. URL OR site name OR search/info verb → 'scrape'. The user
 *      wants info that lives on the web; Firecrawl is the cheap path.
 *   4. Otherwise → 'generate'.
 *
 * Keyword-only (no Anthropic call) — same cost-saving rationale as
 * the pre-Firecrawl two-route classifier.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

export type ExecutionMode = 'browser' | 'generate' | 'scrape';

interface CacheEntry {
  mode: ExecutionMode;
  source: string;
  at: number;
}

const CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 500;
const CACHE_TTL_MS = 60 * 60 * 1_000;

function cacheKey(intent: string): string {
  return intent.trim().toLowerCase().slice(0, 280);
}

function cacheGet(key: string): CacheEntry | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry;
}

function cacheSet(key: string, mode: ExecutionMode, source: string): void {
  CACHE.set(key, { mode, source, at: Date.now() });
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
    else break;
  }
}

export interface ClassifyOpts {
  intent: string;
  /**
   * Optional explicit skill id. Unambiguous skills short-circuit
   * the keyword pass. Ambiguous skills fall through.
   */
  skillId?: string;
  logger: Logger;
  /** Accepted for backwards-compat with the pre-RC Haiku-call signature. NOT invoked. */
  client?: Anthropic | null;
  model?: string;
  timeoutMs?: number;
}

/**
 * INTERACTION verbs — explicit asks to drive a live page. Substring
 * match (case-insensitive). Any one of these forces 'browser', even
 * when the intent ALSO matches a scrape signal (URL / site / search
 * verb). The user wants the agent to ACT on a page, not just read.
 */
const INTERACTION_VERBS: readonly string[] = [
  '登录', '打开', '访问', '下单', '操作', '提交', '点击', '填写', '填表',
  '比价', '抓取', '截图', '下载',
  '预订', '预定', '预约', '订票', '订机票', '订酒店', '订餐', '挂号',
  '报名', '投递', '发帖', '评论', '点赞', '关注', '加购',
  '加入购物车', '结账', '取消订阅', '发送邮件', '发邮件',
  // English
  'open ', 'visit ', 'log in', 'log into', 'sign in', 'sign into',
  'submit ', 'click ', 'navigate to', 'fill in', 'fill out', 'download',
  'make a reservation',
  'sign up', 'send email', 'send an email',
  'add to cart', 'checkout', 'check out', 'place order',
];

const INTERACTION_PATTERNS: readonly [RegExp, string][] = [
  [/\bbook\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:flight|ticket|hotel|room|table|restaurant|appointment|ride|car|train|bus)\b/i, 'book service'],
  [/\breserve\s+(?:a\s+|an\s+|the\s+)?(?:table|room|seat|ticket|hotel|restaurant|car)\b/i, 'reserve service'],
  [/\bschedule\s+(?:a\s+|an\s+|the\s+)?(?:appointment|meeting|call|visit|consultation|interview)\b/i, 'schedule appointment'],
  [/\bschedule\s+.{1,60}\s+(?:appointment|meeting|call|visit|consultation|interview)\b/i, 'schedule appointment'],
  [/\b(?:make|set\s+up)\s+(?:a\s+|an\s+)?(?:appointment|reservation|meeting|call)\b/i, 'make appointment'],
  [/\bregister\s+for\s+(?:this\s+)?(?:event|webinar|class|course|workshop|conference)\b/i, 'register for event'],
  [/\bapply\s+(?:for|to)\s+(?:this\s+)?(?:job|role|position|opening|listing)\b/i, 'apply for job'],
  [/\bapply\s+(?:on|in)\s+(?:linkedin|indeed|greenhouse|lever)\b/i, 'apply on job site'],
  [/\badd\s+.{1,80}\s+to\s+(?:the\s+)?cart\b/i, 'add item to cart'],
  [/\bpost\s+(?:on|to)\s+(?:twitter|x\.com|linkedin|reddit|instagram|tiktok|facebook|threads)\b/i, 'post on site'],
  [/\b(?:publish|share)\s+(?:this\s+)?(?:post|update|article|comment)\s+(?:on|to)\b/i, 'publish to site'],
  [/发布(?:到|在)(?:小红书|微博|知乎|抖音|b站|bilibili|twitter|x\.com|linkedin|reddit)/i, '发布到平台'],
];

/**
 * SEARCH verbs — the user wants to find information that lives on
 * the web. These route to 'scrape' (Firecrawl's /search), NOT to
 * 'browser' (which is for interaction). Cheap path: a few seconds
 * + a single LLM synthesis call.
 */
const SEARCH_VERBS: readonly string[] = [
  '搜索', '查找', '查询', '研究', '对比', '调研',
  // English
  'search ', 'find ', 'research ', 'compare ', 'look up',
];

/**
 * INFO-only verbs — same scrape route as SEARCH_VERBS but the user
 * has already pointed at a specific URL or site. "总结 https://X" /
 * "分析 jd.com 的促销" — Firecrawl /scrape on the URL/site is the
 * right tool, even though the verb is "总结" (which would be
 * generate-only without the URL).
 */
const INFO_VERBS: readonly string[] = [
  '查看', '分析', '提取', '抓取', '总结', '看一下', '看看',
  // English
  'summarize ', 'summarise ', 'analyze ', 'analyse ', 'extract ',
];

/**
 * Named sites. Mentioning one of these by name is a strong signal
 * the user wants info from that platform — route to 'scrape'
 * unless an INTERACTION verb is also present.
 */
const SITE_NAMES: readonly string[] = [
  '小红书', '淘宝', '天猫', '京东', '拼多多', '抖音', 'bilibili', 'b站',
  '携程', '飞猪', '美团', '大众点评', '高德', '百度地图',
  '微博', '知乎', '豆瓣', '虎扑', 'boss直聘', '拉勾',
  'github', 'linkedin', 'amazon', 'shopify', 'twitter', 'reddit',
  'youtube', 'instagram', 'tiktok', 'gmail', 'producthunt',
];

const ECOMMERCE_SITE_HINTS: readonly string[] = [
  '电商站', '电商平台', '购物平台', '商品', '商品页', '商品链接',
  '京东', '淘宝', '天猫', '拼多多', '抖音商城', '小红书商城',
  'jd', 'taobao', 'tmall', 'pdd', 'amazon',
];

const ECOMMERCE_LIST_HINTS: readonly string[] = [
  '前', 'top', '结果', '列表', '名称', '价格', '链接', '按价格', '排序',
  '从低到高', '从高到低', 'price', 'link', 'url', 'sort',
];

const SKILL_HINTS: ReadonlyMap<string, ExecutionMode> = new Map([
  ['content-creator', 'generate'],
  ['brand-guardian', 'generate'],
  ['visual-storyteller', 'generate'],
  ['image-prompt-engineer', 'generate'],
  ['contract-reviewer', 'generate'],
  ['policy-writer', 'generate'],
  ['exec-summarizer', 'generate'],
  ['exec-briefing', 'generate'],
  ['customer-service', 'generate'],
  ['finance-tracker', 'generate'],
  ['tech-translator', 'generate'],
  ['email_writer', 'generate'],
  ['xiaohongshu', 'browser'],
  ['douyin', 'browser'],
  ['wechat_gongzhong', 'browser'],
  ['ecommerce_cn', 'browser'],
  ['cross-border-ecom', 'browser'],
  ['livestream-coach', 'browser'],
  ['social-media-strategist', 'browser'],
]);

const URL_REGEX = /\b(?:https?:\/\/|www\.)\S+/i;

function hasAny(haystack: string, needles: readonly string[]): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n)) return n.trim();
  }
  return null;
}

function matchInteractionPattern(intent: string): string | null {
  for (const [pattern, label] of INTERACTION_PATTERNS) {
    if (pattern.test(intent)) return label;
  }
  return null;
}

function isEcommerceListingIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  const hasEcommerce = ECOMMERCE_SITE_HINTS.some((hint) => lower.includes(hint));
  if (!hasEcommerce) return false;
  const hasPrice = /价格|多少钱|最低价|最便宜|price/.test(lower);
  const asksForLinks = /链接|url|link/.test(lower);
  const asksForRows =
    /前\s*\d+|top\s*\d+|\d+\s*(?:个|条|款)?(?:结果|商品|products?)/i.test(intent) ||
    ECOMMERCE_LIST_HINTS.filter((hint) => lower.includes(hint)).length >= 3;
  return hasPrice && asksForLinks && asksForRows;
}

interface RouteDecision {
  mode: ExecutionMode;
  source: string;
  match?: string;
}

function decide(intent: string): RouteDecision {
  // 0. Product-listing / comparison shopping tasks need the supercar
  // loop so it can use search_ecommerce and preserve source URLs.
  // Firecrawl/generate lanes repeatedly produced price rows with
  // empty URLs for "前5结果（名称/价格/链接）" style prompts.
  if (isEcommerceListingIntent(intent)) {
    return { mode: 'browser', source: 'kw:ecommerce-listing' };
  }

  // 1. Interaction verb wins outright — agent must drive a live page.
  const interaction = hasAny(intent, INTERACTION_VERBS);
  if (interaction) {
    return { mode: 'browser', source: 'kw:interaction', match: interaction };
  }
  const interactionPattern = matchInteractionPattern(intent);
  if (interactionPattern) {
    return { mode: 'browser', source: 'kw:interaction', match: interactionPattern };
  }

  // 2. URL / site / search-verb / info-verb → scrape.
  const urlMatch = URL_REGEX.exec(intent);
  if (urlMatch) {
    return { mode: 'scrape', source: 'kw:url', match: urlMatch[0].slice(0, 64) };
  }
  const search = hasAny(intent, SEARCH_VERBS);
  if (search) {
    return { mode: 'scrape', source: 'kw:search-verb', match: search };
  }
  const site = hasAny(intent, SITE_NAMES);
  if (site) {
    return { mode: 'scrape', source: 'kw:site', match: site };
  }
  const info = hasAny(intent, INFO_VERBS);
  if (info) {
    // Info verbs without a URL/site are usually pure text-on-already-
    // provided-content (e.g. "分析这段商业模式"). Only route to scrape
    // when the user gave us SOMETHING to scrape (URL/site checked
    // above). Falling through to generate matches that intent.
    return { mode: 'generate', source: 'default' };
  }

  // 3. Default — pure text generation.
  return { mode: 'generate', source: 'default' };
}

export async function classifyExecutionMode(opts: ClassifyOpts): Promise<ExecutionMode> {
  const intent = opts.intent.trim();
  if (!intent) {
    opts.logger.info(
      { mode: 'generate', source: 'empty-intent' },
      'intent-classifier: decided',
    );
    return 'generate';
  }

  const key = cacheKey(intent);
  const cached = cacheGet(key);
  if (cached) {
    opts.logger.info(
      { mode: cached.mode, source: cached.source, cache: 'hit' },
      'intent-classifier: decided',
    );
    return cached.mode;
  }

  // Phase 1 follow-up — strong keyword signals override skill-hint
  // defaults. Without this swap, a user with the xiaohongshu skill
  // enabled who typed "搜索小红书上露营笔记" routed to browser (skill
  // hint won) instead of scrape (search-verb keyword), hit a login
  // wall, and burned a Brave slot. Three signals are STRONG enough
  // to override an installed skill hint:
  //
  //   kw:interaction — verb explicitly says "drive a live page"
  //                    (login / click / fill / 登录 / 点击 / ...)
  //   kw:url         — user pasted a specific URL → scrape that URL
  //   kw:search-verb — verb explicitly says "search the web"
  //                    (搜索 / 查找 / 查询 / search / find / ...)
  //
  // Weaker signals (kw:site alone, or no decide() match → default
  // generate) still defer to the skill hint when one is installed.
  // This preserves the user's explicit "use this skill" intent for
  // ambiguous prompts while preventing the search-verb foot-gun.
  const d = decide(intent);
  const STRONG_SIGNAL_SOURCES = new Set([
    'kw:interaction',
    'kw:url',
    'kw:search-verb',
    'kw:ecommerce-listing',
  ]);
  if (STRONG_SIGNAL_SOURCES.has(d.source)) {
    cacheSet(key, d.mode, d.source);
    opts.logger.info(
      {
        mode: d.mode,
        source: d.source,
        ...(d.match ? { match: d.match } : {}),
        ...(opts.skillId ? { skillIdIgnored: opts.skillId } : {}),
      },
      'intent-classifier: decided',
    );
    return d.mode;
  }

  if (opts.skillId) {
    const hinted = SKILL_HINTS.get(opts.skillId);
    if (hinted) {
      cacheSet(key, hinted, `skill:${opts.skillId}`);
      opts.logger.info(
        { mode: hinted, source: 'skill-hint', skillId: opts.skillId },
        'intent-classifier: decided',
      );
      return hinted;
    }
  }

  cacheSet(key, d.mode, d.source);
  opts.logger.info(
    {
      mode: d.mode,
      source: d.source,
      ...(d.match ? { match: d.match } : {}),
    },
    'intent-classifier: decided',
  );
  return d.mode;
}
