/**
 * ExecutionRouter — 5-lane priority router for supercar tasks.
 *
 * Decides which execution path a given set of TaskSignals should use.
 * Pure function: `route()` takes signals in, returns a lane id out. No
 * state kept inside the router — stuckCount / antiBotHigh / etc. are
 * computed by agent-loop and passed every call, so routing decisions
 * are trivially re-runnable and diff-able across a task's lifetime.
 *
 * Lane priority (first match wins):
 *   1. brave    — simple search intent AND brave adapter ready
 *   2. zapier   — cross-platform automation intent AND zapier adapter ready
 *   3. headed   — high-confidence anti-bot signal AND headed executor ready
 *   4. apify    — stuckCount ≥ 3 AND the task has a registered actor
 *                 AND apify adapter ready
 *   5. headed   — stuckCount ≥ 6 AND headed executor ready
 *                 (last-gasp swap if the headless primary keeps stalling
 *                 even without an explicit anti-bot marker)
 *   6. headless — default: the fast, cheap primary browser
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
 */

import type { PlaywrightExecutor } from '../vision-loop/playwright-executor.js';
import type { BraveSearchAdapter } from './adapters/brave-search.js';
import type { ZapierAdapter } from './adapters/zapier.js';
import type { ApifyAdapter } from './adapters/apify.js';

export type LaneId = 'headless' | 'headed' | 'brave' | 'zapier' | 'apify';
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
  readonly brave: BraveSearchAdapter | null;
  readonly zapier: ZapierAdapter | null;
  readonly apify: ApifyAdapter | null;
}

export interface ExecutionRouterDeps {
  readonly headless: PlaywrightExecutor | null;
  readonly headed: PlaywrightExecutor | null;
  readonly brave: BraveSearchAdapter | null;
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
      case 'brave':
        return deps.brave ? 'ready' : 'unavailable';
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
    // 1. Brave for pure info queries — fastest path, zero browser cost.
    if (signals.isSimpleSearch && status('brave') === 'ready') return 'brave';

    // 2. Zapier for "trigger a workflow on another platform" intents.
    if (signals.isCrossPlatformAutomation && status('zapier') === 'ready') return 'zapier';

    // 3. Explicit anti-bot signal — jump straight to headed browser if
    //    we have one; headed has real fingerprint + GPU context that
    //    bypasses most of the cheap "no DOM text" server-side walls.
    if (signals.antiBotHigh && status('headed') === 'ready') return 'headed';

    // 4. Stuck + there's a pre-built Apify actor for this domain.
    //    This is the pragmatic "let a maintained scraper do it" path —
    //    for sites like Xiaohongshu / Douyin / Boss直聘 where even the
    //    headed browser gets served blank.
    if (signals.stuckCount >= 3 && signals.hasApifyActor && status('apify') === 'ready') {
      return 'apify';
    }

    // 5. Last-gasp headed swap when the primary has stalled enough that
    //    it's probably not coming back. Threshold kept above
    //    STUCK_WARN_THRESHOLD (6) in agent-loop so we try retries first.
    if (signals.stuckCount >= 6 && status('headed') === 'ready') return 'headed';

    // 6. Default lane — the headless primary.
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
    brave: deps.brave,
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

  // Disqualifiers: any action verb forces browser/zapier lane.
  const ACTION_VERBS = [
    '订', '预订', '预定', '买', '购买', '下单', '付款', '支付', '转账',
    '注册', '登录', '登陆', '登入', '退订', '退款', '取消',
    '发送', '发帖', '发布', '评论', '点赞', '关注', '加关注', '转发',
    '投递', '申请', '报名', '提交', '填写', '填表',
    '删除', '修改', '编辑', '更新',
    'book', 'buy', 'order', 'register', 'sign up', 'sign in', 'log in', 'login',
    'send', 'post', 'submit', 'apply', 'subscribe', 'unsubscribe', 'cancel',
    'delete', 'update', 'pay', 'transfer', 'comment', 'like', 'follow',
    'help me ', // "help me book", "help me buy", ...
  ];
  for (const v of ACTION_VERBS) {
    if (lower.includes(v)) return false;
  }

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
