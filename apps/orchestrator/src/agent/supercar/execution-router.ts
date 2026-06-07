/**
 * ExecutionRouter — 4-lane priority router for supercar tasks.
 *
 * Decides which execution path a given set of TaskSignals should use.
 * Pure function: `route()` takes signals in, returns a lane id out. No
 * state kept inside the router — stuckCount / antiBotHigh / etc. are
 * computed by agent-loop and passed every call, so routing decisions
 * are trivially re-runnable and diff-able across a task's lifetime.
 *
 * Lane priority (first match wins):
 *   1. zapier   — cross-platform automation intent AND zapier adapter ready
 *   2. headed   — high-confidence anti-bot signal AND headed executor ready
 *   3. apify    — stuckCount ≥ 3 AND the task has a registered actor
 *                 AND apify adapter ready
 *   4. headed   — stuckCount ≥ 6 AND headed executor ready
 *                 (last-gasp swap if the headless primary keeps stalling
 *                 even without an explicit anti-bot marker)
 *   5. headless — default: the fast, cheap primary browser
 *
 * When the preferred lane is 'unavailable' the router falls through to
 * the next candidate — never returns an unavailable lane — so callers
 * don't need to double-check status() after route().
 *
 * Unavailable-lane handling: an adapter with no API key, or an executor
 * that failed connect() at boot, resolves to `'unavailable'`. The
 * router's fallback chain guarantees `route()` always returns a lane
 * the caller can actually use (at minimum headless, assuming the
 * default Chromium process is up).
 *
 * Lane 3 (Brave Search API) was retired — simple-search intents now
 * stay in the model loop and use Anthropic's built-in web_search tool.
 */

import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import type { ZapierAdapter } from './adapters/zapier.js';
import type { ApifyAdapter } from './adapters/apify.js';

export type LaneId = 'headless' | 'headed' | 'zapier' | 'apify';
export type LaneStatus = 'ready' | 'unavailable';

export interface TaskSignals {
  /** Free-form user intent. */
  readonly intent: string;
  /** Consecutive no-change-screenshot turns so far. Zero on first route(). */
  readonly stuckCount: number;
  /** True when this turn's anti-bot detector fired with confidence='high'. */
  readonly antiBotHigh: boolean;
  /** True when classifyAsSimpleSearch(intent) matched (pure info query). */
  readonly isSimpleSearch: boolean;
  /** True when the intent mentions Zapier / webhook / cross-platform automation verbs. */
  readonly isCrossPlatformAutomation: boolean;
  /** True when the apify adapter's findActorForIntent returned a match. */
  readonly hasApifyActor: boolean;
}

export interface ExecutionRouter {
  /** Has the given lane been wired at boot? */
  status(lane: LaneId): LaneStatus;
  /** Pick a lane for this turn. Always returns a `ready` lane. */
  route(signals: TaskSignals): LaneId;
  /** Return the executor for a browser lane, or null for the non-browser lanes. */
  getExecutor(lane: LaneId): PlaywrightExecutor | null;
  /** Access adapters directly when short-circuiting past the loop. */
  readonly zapier: ZapierAdapter | null;
  readonly apify: ApifyAdapter | null;
}

export interface ExecutionRouterDeps {
  readonly headless: PlaywrightExecutor | null;
  readonly headed: PlaywrightExecutor | null;
  readonly zapier: ZapierAdapter | null;
  readonly apify: ApifyAdapter | null;
}

export function createExecutionRouter(deps: ExecutionRouterDeps): ExecutionRouter {
  function status(lane: LaneId): LaneStatus {
    switch (lane) {
      case 'headless':
        return deps.headless ? 'ready' : 'unavailable';
      case 'headed':
        return deps.headed ? 'ready' : 'unavailable';
      case 'zapier':
        return deps.zapier ? 'ready' : 'unavailable';
      case 'apify':
        return deps.apify ? 'ready' : 'unavailable';
    }
  }

  function fallbackBrowser(): LaneId {
    // The ultimate fallback — whichever browser executor actually
    // booted. In practice at least one of these is always ready; if
    // both are down the orchestrator shouldn't be accepting tasks at
    // all, but we still return 'headless' so the caller fails fast with
    // a clear "no executor" error instead of a silent misroute.
    if (status('headless') === 'ready') return 'headless';
    if (status('headed') === 'ready') return 'headed';
    return 'headless';
  }

  function route(signals: TaskSignals): LaneId {
    // 1. Zapier for "trigger a workflow on another platform" intents.
    if (signals.isCrossPlatformAutomation && status('zapier') === 'ready') return 'zapier';

    // 2. Explicit anti-bot signal — jump straight to headed browser if
    //    we have one; headed has real fingerprint + GPU context that
    //    bypasses most of the cheap "no DOM text" server-side walls.
    if (signals.antiBotHigh && status('headed') === 'ready') return 'headed';

    // 3. Stuck + there's a pre-built Apify actor for this domain.
    //    This is the pragmatic "let a maintained scraper do it" path —
    //    for sites like Xiaohongshu / Douyin / Boss直聘 where even the
    //    headed browser gets served blank.
    if (signals.stuckCount >= 3 && signals.hasApifyActor && status('apify') === 'ready') {
      return 'apify';
    }

    // 4. Last-gasp headed swap when the primary has stalled enough that
    //    it's probably not coming back. Threshold kept above
    //    STUCK_WARN_THRESHOLD (6) in agent-loop so we try retries first.
    if (signals.stuckCount >= 6 && status('headed') === 'ready') return 'headed';

    // 5. Default lane — the headless primary.
    return fallbackBrowser();
  }

  function getExecutor(lane: LaneId): PlaywrightExecutor | null {
    if (lane === 'headless') return deps.headless;
    if (lane === 'headed') return deps.headed;
    return null;
  }

  return {
    status,
    route,
    getExecutor,
    zapier: deps.zapier,
    apify: deps.apify,
  };
}

/**
 * Pure intent classifier: true when the task is asking for information
 * only, not an action. "查一下今天天气" → true; "帮我订一张票" → false.
 *
 * Strictly conservative: any action verb → false. Only marks true when
 * the intent STARTS with or clearly is a query verb. Ambiguity defaults
 * to false so the browser path still runs — web_search on a real task
 * that needs a browser action would be worse than a slow success.
 */
export function classifyAsSimpleSearch(intent: string): boolean {
  const t = intent.trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  // Ecommerce listing tasks are not "just one fact". They need row-
  // level source preservation (name / price / link per item). Let the
  // supercar loop plan and use search_ecommerce instead of collapsing
  // them into the generic web_search shortcut, which has historically
  // returned price rows with empty URLs.
  const ecommerceHints = [
    '电商站', '电商平台', '购物平台', '商品', '商品页', '商品链接',
    '京东', '淘宝', '天猫', '拼多多', '抖音商城', '小红书商城',
    'jd', 'taobao', 'tmall', 'pdd', 'amazon',
  ];
  const hasEcommerceHint = ecommerceHints.some((hint) => lower.includes(hint));
  const hasPrice = /价格|多少钱|最低价|最便宜|price/.test(lower);
  const asksForLinks = /链接|url|link/.test(lower);
  const asksForRows =
    /前\s*\d+|top\s*\d+|\d+\s*(?:个|条|款)?(?:结果|商品|products?)/i.test(t) ||
    ['结果', '列表', '名称', '价格', '链接', '按价格', '排序'].filter((hint) =>
      lower.includes(hint),
    ).length >= 3;
  if (hasEcommerceHint && hasPrice && asksForLinks && asksForRows) {
    return false;
  }

  // Travel workflows often start with query verbs ("查航班"),
  // but if the user also asks to filter / choose / stop before
  // payment, this is no longer a plain fact lookup. Keep these in
  // the browser lane even when no site name (Google Flights / 携程)
  // is present in the prompt.
  const TRAVEL_WORKFLOW_HINTS = [
    '机票', '航班', '酒店', '民宿', '餐厅', '火车票', '高铁票', '车票',
    'flight', 'flights', 'hotel', 'hotels', 'restaurant', 'restaurants',
    'train ticket', 'tickets',
  ];
  const TRAVEL_WORKFLOW_ACTIONS = [
    '筛选', '选择', '选出', '直飞', '经停', '转机', '排序',
    '停在', '付款前', '支付前', '确认前', '预订', '预定', '预约', '收藏',
    'filter', 'select', 'choose', 'nonstop', 'direct flight', 'layover',
    'sort', 'before payment', 'before checkout', 'before booking',
    'reserve', 'reservation', 'book',
  ];
  if (
    TRAVEL_WORKFLOW_HINTS.some((hint) => lower.includes(hint)) &&
    TRAVEL_WORKFLOW_ACTIONS.some((hint) => lower.includes(hint))
  ) {
    return false;
  }

  // Phase 22a follow-up — explicit-navigation disqualifier MUST run
  // before the PRICE_HINTS / FACT_NOUNS positive checks below. The
  // 22a regression: "打开 amazon.com 搜键盘 找销量最高的 3 个产品
  // 告诉我名称、价格和评分" used to return true because "价格"
  // (a PRICE_HINT) matched somewhere later in the intent — even
  // though "打开 amazon.com" at the start clearly means "use the
  // browser". The user asks for a fact (price) but DEMANDS the
  // browser fetches it from a specific site, which web_search
  // can't satisfy without losing the source-site requirement.
  // Same shape for "打开 weather.com 查询天气" — FACT_NOUNS hit
  // on "天气", but the user wants the browser to render that
  // specific site, not a third-party search summary.
  //
  // Pattern: open / visit / navigate verb at the START of the
  // intent (with optional leading "帮我" / "请"). Word-boundary
  // anchored for English so "open" doesn't match inside other
  // words. CJK substrings at offset 0..2 (allowing one optional
  // leading honorific particle).
  const NAV_PREFIXES_CN = ['打开', '访问', '前往', '进入', '跳转到', '跳到'];
  const NAV_PREFIXES_LEAD = ['', '帮我', '请帮我', '请', '麻烦'];
  for (const lead of NAV_PREFIXES_LEAD) {
    for (const verb of NAV_PREFIXES_CN) {
      if (lower.startsWith(`${lead}${verb}`)) return false;
    }
  }
  const NAV_PATTERNS_EN: RegExp[] = [
    /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?open\b/i,
    /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?visit\b/i,
    /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?go\s+to\b/i,
    /^\s*(?:please\s+|can\s+you\s+|could\s+you\s+)?navigate\s+to\b/i,
  ];
  for (const p of NAV_PATTERNS_EN) {
    if (p.test(lower)) return false;
  }

  // Live app workflows may contain query verbs ("查找航班", "search jobs")
  // but still require browser state because the user asks to filter, save,
  // draft, fill, or stop at a confirmation boundary inside that app.
  const LIVE_APP_HINTS = [
    'google flights', '携程', '去哪儿', '飞猪', 'airbnb', 'booking',
    'google forms', 'google docs', 'google sheets', 'google slides',
    'google calendar', 'gmail', 'slack', 'notion', '飞书', 'github',
    'hubspot', 'salesforce', 'stripe', 'calendly', 'trello', 'asana', 'jira',
    'shopify', 'zendesk', 'intercom', 'linear', 'monday',
    'linkedin',
  ];
  const LIVE_APP_ACTION_HINTS = [
    '筛选', '排序', '选择', '勾选', '切换', '设置',
    '收藏', '保存筛选', '保存条件', '直飞',
    '草稿', '创建', '新建', '填写', '写一封', '撰写', '更新',
    '查找', '搜索', '下载', '添加', '安排', '预约', '回复', '停在',
    '付款前', '支付前', '提交前', '确认前',
    'filter', 'sort', 'favorite', 'bookmark', 'save filter',
    'draft', 'compose', 'create', 'update', 'find', 'download',
    'schedule', 'add', 'reply', 'fill out', 'before payment',
    'before checkout', 'before submit',
  ];
  if (
    LIVE_APP_HINTS.some((hint) => lower.includes(hint)) &&
    LIVE_APP_ACTION_HINTS.some((hint) => lower.includes(hint))
  ) {
    return false;
  }

  // Disqualifiers: any action verb forces browser/zapier lane.
  //
  // Chinese verbs are straight substring matches — CJK characters
  // have no word boundaries and our list is action-specific
  // enough that substrings don't overlap with innocent content.
  //
  // English verbs MUST use word-boundary anchors. The earlier
  // substring approach matched 'book' inside 'MacBook', silently
  // flipping every "compare MacBook prices" prompt into the
  // browser lane. `\b` is the JS regex boundary — no match
  // between two letters, so `\bbook\b` no longer matches
  // "macbook", and `\bbuy\b` doesn't fire on "buyer".
  const CN_ACTION_VERBS = [
    '订', '预订', '预定', '买', '购买', '下单', '付款', '支付', '转账',
    '注册', '登录', '登陆', '登入', '退订', '退款', '取消',
    '发送', '发帖', '发布', '评论', '点赞', '关注', '加关注', '转发',
    '投递', '申请', '报名', '提交', '填写', '填表',
    '删除', '修改', '编辑', '更新',
  ];
  for (const v of CN_ACTION_VERBS) {
    if (lower.includes(v)) return false;
  }
  const EN_ACTION_PATTERNS: RegExp[] = [
    /\bbook\b/, /\bbuy\b/, /\border\b/, /\bregister\b/,
    /\bsign\s+up\b/, /\bsign\s+in\b/, /\blog\s+in\b/, /\blogin\b/,
    /\bsend\b/, /\bpost\b/, /\bsubmit\b/, /\bapply\b/,
    /\breserve\b/, /\bmake\s+(?:a\s+)?reservation\b/,
    /\bmake\s+(?:an?\s+)?appointment\b/, /\bbook\s+(?:an?\s+)?appointment\b/,
    /\brsvp\b/,
    /\bsubscribe\b/, /\bunsubscribe\b/, /\bcancel\b/,
    /\bdelete\b/, /\bupdate\b/, /\bpay\b/, /\btransfer\b/,
    /\bcomment\b/, /\blike\b/, /\bfollow\b/,
    /\bhelp me (?:book|buy|order|register|send|post|submit|apply)\b/,
  ];
  for (const p of EN_ACTION_PATTERNS) {
    if (p.test(lower)) return false;
  }

  // Round-1 signal: price / salary / comparison intents are almost
  // always information queries that burn 30+ iterations bouncing
  // between product pages when routed through the browser. These
  // short-circuit to web_search even without a leading query verb.
  const PRICE_HINTS = [
    '价格', '多少钱', '最低价', '最便宜', '比价', '比较价格',
    '性价比', '哪个便宜', '哪款便宜', '对比一下', '对比',
    'price', 'cheapest', 'compare price',
  ];
  const SALARY_HINTS = [
    '薪资', '薪水', '工资', '待遇', '薪酬', '年薪', '月薪', '时薪',
    'salary', 'wage', 'compensation',
  ];
  for (const hint of PRICE_HINTS) {
    if (lower.includes(hint)) return true;
  }
  for (const hint of SALARY_HINTS) {
    if (lower.includes(hint)) return true;
  }
  // Single-fact queries that often arrive verbless — "今天上海天气"
  // / "明天汇率" / "比特币现在多少". These are classic
  // web-search-route cases; adding them avoids another 30-iteration
  // browser run over the forecast page.
  const FACT_NOUNS = [
    '天气', '气温', '温度', '下雨',
    '汇率', '股价', '市值',
    '新闻', '头条',
    '航班', '航班号',
  ];
  for (const n of FACT_NOUNS) {
    if (lower.includes(n)) return true;
  }

  // Multi-platform retail compare — "京东 淘宝 airpods" style. Two
  // or more of the big marketplaces named in the same intent is a
  // strong signal the user wants a compare, not a single-site
  // action. Word-boundary-ish check so 'jd.com' and 'tb' don't
  // false-positive on unrelated strings.
  const RETAIL_HOSTS = [
    '京东', '淘宝', '天猫', '拼多多', '抖音商城', '小红书商城',
    'jd', 'taobao', 'tmall', 'pdd',
  ];
  const matched = new Set<string>();
  for (const host of RETAIL_HOSTS) {
    if (lower.includes(host)) matched.add(host);
  }
  if (matched.size >= 2) return true;

  // Positive: starts with an info-query verb.
  const QUERY_STARTS = [
    '查', '看', '搜', '搜索', '找', '列', '整理',
    '告诉我', '帮我查', '帮我看', '帮我搜',
    '什么', '谁', '为什么', '怎么', '哪', '多少',
    'what', 'who', 'why', 'how', 'when', 'where',
    'list', 'show', 'find', 'search', 'tell me', 'look up',
  ];
  for (const q of QUERY_STARTS) {
    if (lower.startsWith(q) || lower.startsWith(`帮我${q}`)) return true;
  }
  return false;
}

/**
 * Rough classifier for "this task wants a Zap-shaped workflow". Tight
 * by design — false positives here would kick us into an unused lane.
 */
export function classifyAsCrossPlatformAutomation(intent: string): boolean {
  const lower = intent.toLowerCase();
  return (
    lower.includes('zapier') ||
    lower.includes('zap') ||
    lower.includes('webhook') ||
    lower.includes('自动化触发') ||
    lower.includes('跨平台自动')
  );
}
