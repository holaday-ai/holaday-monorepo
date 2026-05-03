/**
 * Phase 24 RC follow-up — task execution-mode classifier.
 *
 * Routes a user's task to one of two backends:
 *   - 'generate' — single Anthropic call, no browser slot, no Brave.
 *     Pure text generation / analysis / translation work.
 *   - 'browser'  — full per-task BrowserPool dispatch, agent loop,
 *     screencast surface. The expensive path.
 *
 * RC data showed 72/165 timeouts were generate tasks routed to the
 * 10-slot pool. Default flipped from 'browser' → 'generate'. The
 * browser path is now opt-in: only intents that *plausibly need a
 * live page* trigger it.
 *
 * Browser triggers (any single match wins):
 *   1. Explicit URL — http://, https://, or www-prefixed bare host.
 *   2. Browser-action verb — 搜索/查找/打开/登录/操作/下单/比价/
 *      抓取/截图/填表/访问/下载, plus English equivalents.
 *   3. Named site — 京东/淘宝/小红书/知乎/微博/B站/GitHub/LinkedIn
 *      etc. (the live-page-only platforms users typically reference
 *      by name).
 *
 * No Anthropic call. RC-era classifier called Haiku as a tiebreaker
 * which (a) cost ~$0.0001 × 165 = trivial but non-zero per RC run
 * and (b) added 200-500ms of admit latency to every task. Pure
 * keyword routing is deterministic, free, and reflects intent
 * accurately enough — borderline cases land on `generate`, which is
 * cheap to fix in-context.
 *
 * Skill hints still short-circuit when the skill is unambiguous —
 * a content-creator role is generate even if the user's prompt
 * mentions 知乎; a xiaohongshu skill is browser even on a
 * generate-leaning prompt.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

export type ExecutionMode = 'browser' | 'generate';

interface CacheEntry {
  mode: ExecutionMode;
  source: string;
  at: number;
}

/**
 * Process-lifetime cache. Keyword pass is already <1ms — the cache
 * is mostly here so the structured log line for each task captures
 * a stable `source` value across re-classifications of the same
 * intent (e.g. retries).
 */
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
   * Optional explicit skill id chosen by the user. When the skill id
   * is in our hardcoded "obviously generate-leaning" or "obviously
   * browser-leaning" set, we short-circuit before keyword scanning.
   * Ambiguous skills (financial-analyst, product-manager, etc.) fall
   * through.
   */
  skillId?: string;
  /** Per-task logger (already child-tagged). */
  logger: Logger;
  /**
   * Accepted for backwards compatibility with the pre-RC Haiku-call
   * signature. NOT invoked — the classifier is now keyword-only and
   * never makes an API call. Kept so existing call sites compile
   * without churn.
   */
  client?: Anthropic | null;
  /** Accepted for backwards compatibility — unused. */
  model?: string;
  /** Accepted for backwards compatibility — unused. */
  timeoutMs?: number;
}

/**
 * Browser-action verbs. Substring match (case-insensitive) on the
 * intent text. Conservative list: a verb here means "the agent is
 * being asked to do something on a live web page". Words that LOOK
 * action-y but commonly appear in generate-only prompts (e.g.
 * "分析" / "总结" / "整理") are NOT in this list — they don't imply
 * live web interaction.
 */
const BROWSER_VERBS: readonly string[] = [
  '搜索', '查找', '打开', '访问', '登录', '操作', '下单', '比价',
  '抓取', '截图', '填表', '下载', '点击', '滑动',
  // English
  'open ', 'visit ', 'log in', 'log into', 'sign in', 'sign into',
  'download', 'click ', 'navigate to',
];

/**
 * Named sites. Substring match (case-insensitive). Mentioning one
 * of these by name is a strong signal the user wants the agent to
 * visit that platform — e.g. "京东最近什么手机促销" implies looking
 * at jd.com, not summarising from training data.
 */
const BROWSER_SITES: readonly string[] = [
  // Chinese-market platforms
  '小红书', '淘宝', '天猫', '京东', '拼多多', '抖音', 'bilibili', 'b站',
  '携程', '飞猪', '美团', '大众点评', '高德', '百度地图',
  '微博', '知乎', '豆瓣', '虎扑', 'boss直聘', '拉勾',
  // International
  'github', 'linkedin', 'amazon', 'shopify', 'twitter', 'reddit',
  'youtube', 'instagram', 'tiktok', 'gmail', 'producthunt',
];

/**
 * Skill-id → mode hints. Only listed when the skill is unambiguous.
 * Skills that could go either way (data-analyst, financial-analyst,
 * etc.) are absent and fall through to the keyword pass.
 */
const SKILL_HINTS: ReadonlyMap<string, ExecutionMode> = new Map([
  // Generate-leaning (text/analysis/translation work)
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
  // Browser-leaning (need to interact with platforms)
  ['xiaohongshu', 'browser'],
  ['douyin', 'browser'],
  ['wechat_gongzhong', 'browser'],
  ['ecommerce_cn', 'browser'],
  ['cross-border-ecom', 'browser'],
  ['livestream-coach', 'browser'],
  ['social-media-strategist', 'browser'],
]);

/**
 * Loose URL match. Triggers on http://, https://, or a www-prefixed
 * bare host. Bare hosts WITHOUT www (e.g. "看一下 zhihu.com") are
 * NOT matched here — those land on the named-site list if they're
 * common platforms, or on a verb match if the user said "打开 X.com",
 * or fall to generate (model often answers them from training data
 * better than the agent stack does).
 */
const URL_REGEX = /\b(?:https?:\/\/|www\.)\S+/i;

interface KeywordHit {
  source: 'url' | 'verb' | 'site';
  match: string;
}

function scanForBrowserSignal(intent: string): KeywordHit | null {
  if (URL_REGEX.test(intent)) {
    const m = intent.match(URL_REGEX);
    return { source: 'url', match: m ? m[0].slice(0, 64) : 'url' };
  }
  const lower = intent.toLowerCase();
  for (const verb of BROWSER_VERBS) {
    if (lower.includes(verb)) return { source: 'verb', match: verb.trim() };
  }
  for (const site of BROWSER_SITES) {
    if (lower.includes(site)) return { source: 'site', match: site };
  }
  return null;
}

/**
 * Classify a task intent into 'browser' or 'generate'. Synchronous
 * in spirit (no I/O), but kept async for signature compatibility
 * with the previous Haiku-backed implementation — call sites that
 * `await` it remain unchanged.
 *
 * Decision order:
 *   1. Empty intent → 'generate' (default).
 *   2. Cache hit → previous decision for this intent.
 *   3. Skill hint → unambiguous skill ids return their mapped mode.
 *   4. Keyword pass — URL / verb / site hit → 'browser'.
 *   5. Otherwise → 'generate'.
 */
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

  const hit = scanForBrowserSignal(intent);
  if (hit) {
    cacheSet(key, 'browser', `kw:${hit.source}`);
    opts.logger.info(
      { mode: 'browser', source: `kw:${hit.source}`, match: hit.match },
      'intent-classifier: decided',
    );
    return 'browser';
  }

  // Default — no browser signal found.
  cacheSet(key, 'generate', 'default');
  opts.logger.info(
    { mode: 'generate', source: 'default' },
    'intent-classifier: decided',
  );
  return 'generate';
}
