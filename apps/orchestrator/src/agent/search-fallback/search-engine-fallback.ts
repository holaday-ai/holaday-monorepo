import { TEXT_URL_RE, trimTextUrl } from '../../execution/text-urls.js';
import type { RunSupercarOptions, SupercarOutcome, SupercarTickEvent } from '../supercar/index.js';
import type { SearchProvider } from './search-provider.js';
import { serveSearchResults } from './search-results-page.js';

type Engine = 'Google' | 'Bing' | 'DuckDuckGo' | '百度';
export interface SearchWall {
  url: string;
  captcha: boolean;
  visible?: boolean;
}
export interface SearchFallbackPlan {
  from: Engine;
  /** An alternate engine, or a search API's label (CAPTCHA-REDUCE-1). */
  to: Engine | string;
  query: string;
  url: string;
  notice: string;
  requiresWeather: boolean;
  intent: string;
}
export interface SearchFallbackEvent {
  from: Engine | string;
  to: Engine | string;
  reason: 'search_verification_wall' | 'search_endpoint_unavailable' | 'search_api_first';
  endpoint?: 'lite' | 'api';
  phase: 'started' | 'completed' | 'blocked' | 'failed';
  attempt: 1;
}

function engineAt(url: URL): Engine | null {
  const host = url.hostname.toLowerCase();
  if (
    /^(?:www\.)?google\.(?:com|co\.uk|com\.sg|com\.hk|co\.jp|de|fr|ca|com\.au|co\.in|com\.tw)$/.test(
      host,
    )
  )
    return 'Google';
  if (/^(?:www\.)?bing\.com$/.test(host)) return 'Bing';
  if (/^(?:(?:www|html|lite)\.)?duckduckgo\.com$/.test(host)) return 'DuckDuckGo';
  if (/^(?:www|wappass)\.baidu\.com$/.test(host)) return '百度';
  return null;
}
function parsed(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
function queryAt(url: URL, depth = 0): string | null {
  const q = url.searchParams.get('q') ?? url.searchParams.get('wd');
  if (q?.trim()) return q.trim();
  if (depth < 2) {
    const next = parsed(url.searchParams.get('continue') ?? '');
    if (next && engineAt(next)) return queryAt(next, depth + 1);
  }
  return null;
}
/** The URL is supplied by the owned browser's wall event, never by page instructions. */
export function planSearchFallback(intent: string, wall: SearchWall): SearchFallbackPlan | null {
  if (!wall.captcha || wall.visible === false) return null;
  const url = parsed(wall.url);
  const from = url && engineAt(url);
  if (
    !url ||
    !from ||
    !/^\/(?:$|search|sorry|turing|captcha|challenge|s(?:\/|$)|html|lite|anomaly|static\/captcha)/i.test(
      url.pathname,
    )
  )
    return null;
  if (!/搜索|检索|查询|search|天气卡片|weather card/i.test(intent)) return null;
  const positive = intent.replace(
    /(?:不要|无需|禁止|勿|不)(?:提交表单|提交|购买|下单|发送|删除|编辑|支付|登录)/g,
    '',
  );
  if (
    /购买|下单|发送|删除|编辑文档|提交表单|\b(?:purchase|buy|delete|send|submit)\b/i.test(positive)
  )
    return null;
  // The query comes from the user's own task, never from the wall: Google's
  // /sorry page carries an opaque `q` token (Deploy-22 D16 / core-02 searched
  // for it on Bing).
  let query: string | null = null;
  for (const raw of intent.match(TEXT_URL_RE) ?? []) {
    const candidate = parsed(trimTextUrl(raw));
    if (!query && candidate && engineAt(candidate)) query = queryAt(candidate);
  }
  query ??= intent.match(/[「“"]([^」”"\n]{1,500})[」”"]/)?.[1]?.trim() ?? null;
  query ??=
    intent
      .match(/(?:搜索|检索|查询|搜一下|\bsearch(?:\s+for)?\b)\s*[:：]?\s+([^\n，,。；;]+)/i)?.[1]
      ?.split(/返回|读出|列出|前\s*\d+|\b(?:return|give|top)\b/i)[0]
      ?.trim() ?? null;
  if (!query || query.length > 500 || /[\r\n]/.test(query)) return null;
  const to: Engine = from === 'Bing' ? 'DuckDuckGo' : 'Bing';
  const next = new URL(
    to === 'Bing' ? 'https://www.bing.com/search' : 'https://html.duckduckgo.com/html/',
  );
  next.searchParams.set('q', query);
  const specific = /必须|只能|仅用|一定要|天气卡片|weather card|\bmust\b|\bonly\b/i.test(intent);
  const requiresWeather = /天气卡片|weather\s+card/i.test(intent);
  return withAlternate({ from, query, requiresWeather, specific, original: intent }, to, next.href);
}

/** The plan for one alternate source: an engine page, or a search API's results page. */
function withAlternate(
  base: {
    from: Engine;
    query: string;
    requiresWeather: boolean;
    specific: boolean;
    original: string;
  },
  to: string,
  url: string,
  /** CAPTCHA-REDUCE-1: the search API was used first, before any wall. */
  preferred = false,
): SearchFallbackPlan {
  const { from, query, requiresWeather, specific, original } = base;
  const notice = preferred
    ? `本次搜索使用 ${to}（不是 ${from} 结果页）。`
    : `${from} 要求人机验证，已改用 ${to} 搜索。${specific ? `以下是 ${to} 的同类结果，不是 ${from} 专属卡片或原站结果。` : ''}`;
  const header = preferred
    ? `【搜索接口】本次按配置直接使用 ${to} 获取搜索结果，不打开 ${from} 结果页。`
    : `【搜索引擎回退】${from} 已出现真实验证墙，不尝试解验证码。`;
  return {
    from,
    to,
    query,
    url,
    notice,
    requiresWeather,
    // INTEGRATE-281: #282's plan shape (search API pages too) with #281's
    // read-only wording: "不提交…" made the real model refuse to submit the
    // alternate's own search box (core-02); business writes stay barred by the
    // task's own wording and the write guard.
    intent: `${original}\n\n${header}原查询为「${query}」。本次获准使用 ${to} 交付同类公开搜索结果；从 ${url} 开始，保持原有数量与字段要求。只读：不登录、不下单、不发送（在 ${to} 搜索框里输入并搜索属于查询，可以做）；不得把替代来源冒充 ${from}，不能编造未读取的内容。${requiresWeather ? '若备用引擎没有天气卡片，可在同一引擎使用等价关键词并打开其真实天气来源，交付实际读到的天气概况、温度或天气网站链接；读不到温度时明确说明，仍可交付其他天气信息，不得编造温度。完全没有天气信息才算未完成。' : ''}`,
  };
}

/**
 * CAPTCHA-REDUCE-1: the same plan through a search API — its results page is
 * served inside the task's browser. Null when the API fails or finds nothing,
 * so the alternate engine is used instead.
 */
async function viaSearchApi(
  plan: SearchFallbackPlan,
  provider: SearchProvider,
  args: RunSupercarOptions,
  original: string,
  preferred = false,
): Promise<{ plan: SearchFallbackPlan; dispose: () => Promise<void> } | null> {
  try {
    const results = await provider.search(plan.query, {
      count: 10,
      signal: AbortSignal.timeout(15_000),
    });
    const page = await args.executor?.getPage();
    if (!results.length || !page) return null;
    const served = await serveSearchResults(page.context(), {
      query: plan.query,
      label: provider.label,
      results,
    });
    return {
      plan: withAlternate(
        {
          from: plan.from as Engine,
          query: plan.query,
          requiresWeather: plan.requiresWeather,
          specific: /必须|只能|仅用|一定要|天气卡片|weather card|\bmust\b|\bonly\b/i.test(original),
          original,
        },
        provider.label,
        served.url,
        preferred,
      ),
      dispose: served.dispose,
    };
  } catch {
    return null;
  }
}

/** Partial weather information is useful; missing temperature alone is not failure. */
function hasWeatherInformation(summary: string): boolean {
  if (/\d+(?:\.\d+)?\s*(?:°\s*[CF]?|摄氏度|华氏度|degrees)/i.test(summary)) return true;
  if (
    /(?:天气|weather|forecast)[^\n]{0,100}(?:多云|晴|雨|雪|cloudy|sunny|rain|snow|overcast)/i.test(
      summary,
    )
  )
    return true;
  // Require an actual weather-labelled link, not an unrelated city/encyclopedia URL.
  return /\[[^\]\n]*(?:天气|气象|预报|weather|forecast|meteorological)[^\]\n]*\]\(https?:\/\/[^)]+\)/i.test(
    summary,
  );
}
async function isUnavailableSearchPage(
  args: RunSupercarOptions,
  engine: Engine | string,
): Promise<boolean> {
  try {
    const page = await args.executor?.getPage();
    const current = page && parsed(page.url());
    if (!page || !current || engineAt(current) !== engine) return false;
    const text = (await page.locator('body').innerText({ timeout: 1500 })).trim();
    return (
      text.length < 1500 &&
      /unexpected error[\s\S]{0,160}(?:try again|if this persists)|our support email address includes an anonymized error code|^(?:access denied|forbidden|service unavailable)$/i.test(
        text,
      )
    );
  } catch {
    return false;
  }
}

export interface SearchFallbackDeps {
  /** CAPTCHA-REDUCE-1: tried before the alternate engine when configured. */
  searchProvider?: SearchProvider | null;
  /**
   * CAPTCHA-REDUCE-1: with a provider, a Google search task skips google.com
   * altogether (a datacenter browser is walled there almost every time).
   */
  searchApiFirst?: boolean;
  run: (args: RunSupercarOptions) => Promise<SupercarOutcome>;
  stop: (taskId: string) => boolean;
  onFallback?: (event: SearchFallbackEvent) => Promise<void>;
  originalIntent?: string;
}
const READ_ONLY = new Set([
  'navigate',
  'snapshot',
  'read_page',
  'get_page_text',
  'links',
  'tables',
  'extract',
  'wait_for',
  'scroll',
  'scroll_until',
  'list_tabs',
  'switch_tab',
  'screenshot',
  'browser_blocker',
  'browser_local_wall',
  'browser_finish_rejected',
]);
/** One runner retry, same task and accounting scope; a second wall retains normal human handoff. */
export async function runSearchWithFallback(
  args: RunSupercarOptions,
  deps: SearchFallbackDeps,
): Promise<SupercarOutcome> {
  // A served results page is a context route; it must not outlive the search.
  const cleanup: Array<() => Promise<void>> = [];
  try {
    return await searchWithFallback(args, deps, cleanup);
  } finally {
    await Promise.allSettled(cleanup.map((dispose) => dispose()));
  }
}

async function searchWithFallback(
  args: RunSupercarOptions,
  deps: SearchFallbackDeps,
  cleanup: Array<() => Promise<void>>,
): Promise<SupercarOutcome> {
  let plan: SearchFallbackPlan | null = null;
  let firstQuestion = '';
  let wallObserved = false;
  let unsafe = false;
  let maxStep = 0;
  let retry = false;
  let blockedRetry = false;
  let retryWallObserved = false;
  let endpointRetry = false;
  let apiUsed = false;
  let apiFirst = false;
  let offset = 0;
  const startedAt = Date.now();
  const emit = async (phase: SearchFallbackEvent['phase']) => {
    if (plan)
      await deps.onFallback?.({
        from: endpointRetry ? plan.to : plan.from,
        to: apiUsed && deps.searchProvider ? deps.searchProvider.id : plan.to,
        reason: endpointRetry
          ? 'search_endpoint_unavailable'
          : apiFirst
            ? 'search_api_first'
            : 'search_verification_wall',
        ...(endpointRetry
          ? { endpoint: 'lite' as const }
          : apiUsed
            ? { endpoint: 'api' as const }
            : {}),
        phase,
        attempt: 1,
      });
  };
  const tracked = (intent: string): RunSupercarOptions => ({
    ...args,
    intent,
    // CAPTCHA-REDUCE-1: a search wall this fallback can answer is not handed to
    // the user; only the first attempt, before any write, qualifies.
    searchWallReplaceable: (url: string) =>
      !retry &&
      !unsafe &&
      !!planSearchFallback(deps.originalIntent ?? args.intent, {
        url,
        captcha: true,
        visible: true,
      }),
    onTick: async (ev: SupercarTickEvent) => {
      const execution = ev.execution;
      if (!retry) {
        if (
          execution?.actionKind === 'browser_blocker' &&
          execution.errorCode === 'browser_captcha_wall' &&
          execution.blockerEvidence?.visible
        )
          wallObserved = true;
      } else if (execution?.errorCode === 'browser_captcha_wall') {
        retryWallObserved = true;
      }
      if (execution && !READ_ONLY.has(execution.actionKind)) unsafe = true;
      if (ev.toolsInTurn.some((tool) => !READ_ONLY.has(tool) && tool !== 'finish')) unsafe = true;
      if (execution?.effect?.unexpected || execution?.effect?.triggers?.length) unsafe = true;
      const iteration = ev.iteration + offset;
      maxStep = Math.max(maxStep, iteration);
      await args.onTick?.({ ...ev, iteration });
    },
    onWebSearch: async (ev) => {
      await args.onWebSearch?.({ ...ev, iteration: ev.iteration + offset });
    },
    onAwaitingUser: async (ev) => {
      if (ev.captchaHandoff) {
        await args.onAwaitingUser?.(ev);
        return;
      }
      const captcha = ev.awaitingKind === 'captcha';
      if (!retry && !unsafe && !(await args.isTaskCancelled?.()) && captcha && ev.currentUrl) {
        const candidate = planSearchFallback(deps.originalIntent ?? args.intent, {
          url: ev.currentUrl,
          captcha: wallObserved || /\/sorry(?:\/|\?|$)/i.test(ev.currentUrl),
          visible: true,
        });
        if (candidate && deps.stop(args.taskId)) {
          plan = candidate;
          firstQuestion = ev.question;
          return;
        }
      }
      if (retry && captcha) {
        blockedRetry = true;
        await emit('blocked');
      }
      await args.onAwaitingUser?.({
        ...ev,
        ...(retry && plan ? { question: `${plan.notice}\n\n${ev.question}` } : {}),
      });
    },
  });
  const original = deps.originalIntent ?? args.intent;
  if (
    deps.searchProvider &&
    deps.searchApiFirst &&
    /google|谷歌/i.test(original) &&
    !(await args.isTaskCancelled?.())
  ) {
    const preferred = planSearchFallback(original, {
      url: 'https://www.google.com/search',
      captcha: true,
      visible: true,
    });
    const api =
      preferred && (await viaSearchApi(preferred, deps.searchProvider, args, original, true));
    if (api) {
      plan = api.plan;
      apiUsed = true;
      apiFirst = true;
      // Not a fallback attempt: a wall met on this run is handled as usual.
      retry = true;
      await emit('started');
      cleanup.push(api.dispose);
      const outcome = await deps.run(tracked(api.plan.intent));
      await emit(
        outcome.status === 'completed'
          ? 'completed'
          : outcome.status === 'awaiting_user'
            ? 'blocked'
            : 'failed',
      );
      return {
        ...outcome,
        ...(outcome.summary ? { summary: `${api.plan.notice}\n\n${outcome.summary}` } : {}),
      };
    }
  }
  const first = await deps.run(tracked(args.intent));
  // The unified runner returns detected walls directly; legacy/human gates may
  // instead invoke onAwaitingUser. Both require the same host-observed signal.
  if (
    !plan &&
    first.status === 'awaiting_user' &&
    wallObserved &&
    !unsafe &&
    !(await args.isTaskCancelled?.())
  ) {
    try {
      const page = await args.executor?.getPage();
      if (page)
        plan = planSearchFallback(deps.originalIntent ?? args.intent, {
          url: page.url(),
          captcha: true,
          visible: true,
        });
      firstQuestion = first.question ?? '';
    } catch {
      /* An unavailable or revoked browser cannot be retried. */
    }
  }
  let selected = plan as SearchFallbackPlan | null;
  if (!selected || first.status === 'completed') return first;
  // CAPTCHA-REDUCE-1: a configured search API answers before any other engine
  // page (no wall, no user). Its results page lives in this task's own browser
  // context and goes away with it.
  if (deps.searchProvider && !(await args.isTaskCancelled?.())) {
    const api = await viaSearchApi(
      selected,
      deps.searchProvider,
      args,
      deps.originalIntent ?? args.intent,
    );
    if (api) {
      cleanup.push(api.dispose);
      selected = api.plan;
      plan = api.plan;
      apiUsed = true;
    }
  }
  if (await args.isTaskCancelled?.()) return { ...first, status: 'cancelled' };
  const remaining = args.timeoutMs ? args.timeoutMs - (Date.now() - startedAt) : undefined;
  if (remaining !== undefined && remaining <= 0)
    return { ...first, status: 'awaiting_user', question: firstQuestion };
  retry = true;
  offset = Math.max(maxStep, first.iterations);
  await emit('started');
  const next = tracked(selected.intent);
  if (remaining !== undefined) next.timeoutMs = remaining;
  let second = await deps.run(next);
  const allTools = new Set([...first.toolsUsed, ...second.toolsUsed]);
  let unavailable = !retryWallObserved && (await isUnavailableSearchPage(args, selected.to));
  const endpointBudget = args.timeoutMs ? args.timeoutMs - (Date.now() - startedAt) : undefined;
  if (
    unavailable &&
    selected.to === 'DuckDuckGo' &&
    !unsafe &&
    !blockedRetry &&
    second.status !== 'cancelled' &&
    !(await args.isTaskCancelled?.()) &&
    (endpointBudget === undefined || endpointBudget > 0)
  ) {
    await emit('failed');
    endpointRetry = true;
    const lite = new URL('https://lite.duckduckgo.com/lite/');
    lite.searchParams.set('q', selected.query);
    offset = Math.max(maxStep, offset + second.iterations);
    selected.notice += ' DuckDuckGo HTML 入口返回站点错误，已尝试一次 Lite 入口。';
    await emit('started');
    // Replace the entry URL rather than leaving competing start instructions.
    const liteArgs = tracked(selected.intent.replace(selected.url, lite.href));
    if (endpointBudget !== undefined) liteArgs.timeoutMs = endpointBudget;
    second = await deps.run(liteArgs);
    for (const tool of second.toolsUsed) allTools.add(tool);
    unavailable = !retryWallObserved && (await isUnavailableSearchPage(args, selected.to));
  }
  if (second.status === 'cancelled' || (await args.isTaskCancelled?.())) {
    return {
      ...second,
      status: 'cancelled',
      iterations: offset + second.iterations,
      toolsUsed: [...allTools],
    };
  }
  if (unavailable) {
    if (!blockedRetry) await emit('blocked');
    return {
      ...second,
      status: 'awaiting_user',
      reason: undefined,
      summary: undefined,
      question: `${selected.notice}\n\n${selected.to} 当前也无法返回搜索结果，已暂停，未切换第三个引擎。请稍后重试或指定其他可访问来源。`,
      iterations: offset + second.iterations,
      toolsUsed: [...allTools],
    };
  }
  if (
    selected.requiresWeather &&
    second.status === 'completed' &&
    !hasWeatherInformation(second.summary ?? '')
  ) {
    await emit('failed');
    return {
      ...second,
      status: 'awaiting_user',
      summary: undefined,
      question: `${selected.notice}\n\n备用来源尚未提供任何天气信息，未完成天气查询。请指定可访问的天气来源。`,
      iterations: offset + second.iterations,
      toolsUsed: [...allTools],
    };
  }
  if (!blockedRetry)
    await emit(
      second.status === 'completed'
        ? 'completed'
        : second.status === 'awaiting_user'
          ? 'blocked'
          : 'failed',
    );
  return {
    ...second,
    iterations: offset + second.iterations,
    toolsUsed: [...allTools],
    ...(second.summary ? { summary: `${selected.notice}\n\n${second.summary}` } : {}),
    ...(second.question ? { question: `${selected.notice}\n\n${second.question}` } : {}),
  };
}
