/**
 * DegradationChain — tiered response when the anti-bot detector fires.
 * Runs strategies in escalating order so we spend user-visible
 * disruption budget minimally. Cheapest tries go first: search-engine swap
 * changes the URL; search-API fallback paid data; punting to the
 * user's extension is last because it breaks the "headless server
 * does the work" promise.
 *
 * FIX-31 (coordinator review, red line 「不要绕过」): the former profile rotation
 * (clear cookies + random navigator.userAgent) and proxy swap (another egress IP)
 * are removed — no tier changes who we appear to be or where we come from. A wall
 * goes to the user or is reported, never disguised.
 *
 * Each strategy is gated by `canTry(ctx)` so skip-when-unconfigured
 * is first-class — a deployment without a search-API key silently skips
 * that tier instead of failing. The chain never retries a tier
 * it already attempted this task (tracked via `lastLevelTried`).
 *
 * Orchestration lives in task-runner: on an anti-bot strike it calls
 * `chain.tryNext(ctx, lastLevelTried)`, executes the returned result,
 * and either continues the loop (ok) or escalates by calling again
 * with the new level.
 */
import { logger } from '../../config/logger.js';
import type { AntiBotSignal } from './anti-bot-detector.js';
import type { PlaywrightExecutor } from './playwright-executor.js';

export interface DegradationContext {
  readonly taskId: string;
  readonly userId: string;
  readonly intent: string;
  readonly signal: AntiBotSignal;
  readonly executor: PlaywrightExecutor | null;
  /** Strike count this task has accrued so far (for policy decisions). */
  readonly strikes: number;
}

export interface DegradationResult {
  readonly ok: boolean;
  readonly strategy: string;
  readonly level: number;
  /** Human-readable for the task event log + pino message. */
  readonly message: string;
  /** If strategy rewrites the URL (search engine swap), where to go next. */
  readonly nextUrl?: string;
  /** True when this tier hands off to the Chrome extension path. */
  readonly handoffToExtension?: boolean;
}

export interface DegradationStrategy {
  readonly id: string;
  /** Lower = tried earlier. Contract: unique per chain, 1..N. */
  readonly level: number;
  canTry(ctx: DegradationContext): Promise<boolean> | boolean;
  execute(ctx: DegradationContext): Promise<DegradationResult>;
}

// ---------------------------------------------------------------------------
// Concrete strategies
// ---------------------------------------------------------------------------

/**
 * Level 3 — search-engine swap. Only meaningful when the task is
 * search-flavoured. Heuristic: intent mentions a search engine or a
 * navigate-to-search has just been attempted. We pick whichever engine
 * *isn't* in the current URL, prefer duckduckgo → bing → google in
 * that order (duckduckgo has the weakest anti-bot).
 */
export class SearchEngineSwapStrategy implements DegradationStrategy {
  readonly id = 'search_engine_swap';
  readonly level = 3;
  private static readonly ENGINES = [
    { host: 'duckduckgo.com', url: 'https://duckduckgo.com/?q=' },
    { host: 'bing.com', url: 'https://www.bing.com/search?q=' },
    { host: 'google.com', url: 'https://www.google.com/search?q=' },
  ];

  canTry(ctx: DegradationContext): boolean {
    const intent = ctx.intent.toLowerCase();
    return /搜索|search|google|bing|baidu|duckduckgo/.test(intent);
  }

  async execute(ctx: DegradationContext): Promise<DegradationResult> {
    const executor = ctx.executor;
    const currentUrl = await currentPageUrl(executor);
    const next = SearchEngineSwapStrategy.ENGINES.find((e) => !currentUrl.includes(e.host));
    if (!next) {
      return {
        ok: false,
        strategy: this.id,
        level: this.level,
        message: 'no alternative engine available',
      };
    }
    // Extract a plausible query from intent; fall back to the whole
    // intent truncated to 200 chars so goto doesn't reject.
    const query = extractSearchQuery(ctx.intent).slice(0, 200);
    const nextUrl = `${next.url}${encodeURIComponent(query)}`;
    logger.info(
      { action: 'degrade', level: this.level, strategy: this.id, nextUrl },
      'degrade: swapped search engine',
    );
    return {
      ok: true,
      strategy: this.id,
      level: this.level,
      message: `retry via ${next.host}`,
      nextUrl,
    };
  }
}

/**
 * Level 4 — paid search API. Needs `SERPAPI_KEY` or `GOOGLE_SEARCH_API_KEY`
 * at deploy time. When set, task-runner can bypass the browser entirely
 * for results-lookup tasks — commander synthesises an answer from the
 * API payload instead of scraping. This strategy only reports the
 * intent + key availability; actual HTTP call lives in a search-api
 * module outside this file.
 */
export class SearchApiFallbackStrategy implements DegradationStrategy {
  readonly id = 'search_api_fallback';
  readonly level = 4;

  canTry(): boolean {
    return Boolean(process.env.SERPAPI_KEY || process.env.GOOGLE_SEARCH_API_KEY);
  }

  async execute(): Promise<DegradationResult> {
    const provider = process.env.SERPAPI_KEY ? 'serpapi' : 'google-cse';
    logger.info(
      { action: 'degrade', level: this.level, strategy: this.id, provider },
      'degrade: search API fallback available',
    );
    return {
      ok: true,
      strategy: this.id,
      level: this.level,
      message: `search API (${provider}) fallback armed — runner should bypass browser`,
    };
  }
}

/**
 * Level 5 — hand off to the user's Chrome extension. Last resort: the
 * page is scraping-hostile even with alternate engines, so we let the user's authenticated browser drive. Returns
 * `handoffToExtension:true` — task-runner flips `onExecutorFallback`
 * and Layer 5's existing plumbing does the rest.
 */
export class ExtensionFallbackStrategy implements DegradationStrategy {
  readonly id = 'extension_fallback';
  readonly level = 5;

  canTry(): boolean {
    return true;
  }

  async execute(): Promise<DegradationResult> {
    logger.info(
      { action: 'degrade', level: this.level, strategy: this.id },
      'degrade: handing off to Chrome extension (Layer 5)',
    );
    return {
      ok: true,
      strategy: this.id,
      level: this.level,
      message: 'handoff to Chrome extension',
      handoffToExtension: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export class DegradationChain {
  private readonly strategies: DegradationStrategy[];

  constructor(strategies?: DegradationStrategy[]) {
    // Sort ascending so `tryNext` can iterate linearly. Copy first so
    // we don't mutate the caller's array.
    this.strategies = (strategies ?? defaultStrategies()).slice().sort((a, b) => a.level - b.level);
  }

  /** Ordered list of strategies (post-sort). Exposed for tests. */
  getStrategies(): readonly DegradationStrategy[] {
    return this.strategies;
  }

  /**
   * Walk strategies in ascending level order, skipping any with
   * `lastLevelTried >= s.level` or `canTry() === false`. Returns the
   * first one whose execute() resolved (ok or not — caller decides
   * how to escalate from `ok:false`). Returns null when every
   * remaining strategy was skipped.
   */
  async tryNext(
    ctx: DegradationContext,
    lastLevelTried: number,
  ): Promise<DegradationResult | null> {
    for (const s of this.strategies) {
      if (s.level <= lastLevelTried) continue;
      let ok: boolean;
      try {
        ok = await s.canTry(ctx);
      } catch (err) {
        logger.warn(
          {
            strategy: s.id,
            level: s.level,
            err: err instanceof Error ? err.message : String(err),
          },
          'degrade: canTry threw — skipping',
        );
        continue;
      }
      if (!ok) {
        logger.debug(
          { action: 'degrade', level: s.level, strategy: s.id },
          'degrade: skipped (canTry=false)',
        );
        continue;
      }
      logger.info(
        {
          action: 'degrade',
          level: s.level,
          strategy: s.id,
          taskId: ctx.taskId,
          signal: ctx.signal.type,
        },
        'degrade: executing',
      );
      try {
        return await s.execute(ctx);
      } catch (err) {
        logger.error(
          {
            strategy: s.id,
            level: s.level,
            err: err instanceof Error ? err.message : String(err),
          },
          'degrade: execute threw — treating as failed',
        );
        return {
          ok: false,
          strategy: s.id,
          level: s.level,
          message: `execute threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return null;
  }
}

export function defaultStrategies(): DegradationStrategy[] {
  return [
    new SearchEngineSwapStrategy(),
    new SearchApiFallbackStrategy(),
    new ExtensionFallbackStrategy(),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function currentPageUrl(executor: PlaywrightExecutor | null): Promise<string> {
  if (!executor) return '';
  try {
    const page = (await executor.getPage()) as unknown as { url: () => string };
    return page.url();
  } catch {
    return '';
  }
}

/**
 * Heuristic to turn "搜索 X 的股价" into just "X 的股价" for the
 * search URL. Keep it simple — drop leading verbs in CN + EN. Callers
 * truncate anyway so over-inclusion isn't fatal.
 */
function extractSearchQuery(intent: string): string {
  return intent
    .replace(/^\s*(搜索|查找|查一下|search for|search|google|bing)\s*[:：]?\s*/i, '')
    .trim();
}
