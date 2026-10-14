import { TEXT_URL_RE, trimTextUrl } from '../../execution/text-urls.js';
import type { RunSupercarOptions, SupercarOutcome, SupercarTickEvent } from '../supercar/index.js';

type Engine = 'Google' | 'Bing' | 'DuckDuckGo' | '百度';
export interface SearchWall {
  url: string;
  captcha: boolean;
  visible?: boolean;
}
export interface SearchFallbackPlan {
  from: Engine;
  to: Engine;
  query: string;
  url: string;
  notice: string;
  requiresWeather: boolean;
  intent: string;
}
export interface SearchFallbackEvent {
  from: Engine;
  to: Engine;
  reason: 'search_verification_wall';
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
  if (/^(?:(?:www|html)\.)?duckduckgo\.com$/.test(host)) return 'DuckDuckGo';
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
    !/^\/(?:$|search|sorry|turing|captcha|challenge|s(?:\/|$)|html|anomaly|static\/captcha)/i.test(
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
  let query = queryAt(url);
  for (const raw of intent.match(TEXT_URL_RE) ?? []) {
    const candidate = parsed(trimTextUrl(raw));
    if (!query && candidate && engineAt(candidate) === from) query = queryAt(candidate);
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
  const notice = `${from} 要求人机验证，已改用 ${to} 搜索。${specific ? `以下是 ${to} 的同类结果，不是 ${from} 专属卡片或原站结果。` : ''}`;
  return {
    from,
    to,
    query,
    url: next.href,
    notice,
    requiresWeather,
    intent: `${intent}\n\n【搜索引擎回退】${from} 已出现真实验证墙，不尝试解验证码。原查询为「${query}」。本次获准使用 ${to} 交付同类公开搜索结果；从 ${next.href} 开始，保持原有数量与字段要求。只读，不登录、不提交业务表单；不得把替代来源冒充 ${from}，不能编造未读取的内容。${requiresWeather ? '若备用引擎没有天气卡片，可在同一引擎使用等价关键词并打开其真实天气来源，读取温度、状况与时间；仅有百科或普通链接不算完成天气卡片请求。' : ''}`,
  };
}

export interface SearchFallbackDeps {
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
  let plan: SearchFallbackPlan | null = null;
  let firstQuestion = '';
  let wallObserved = false;
  let unsafe = false;
  let maxStep = 0;
  let retry = false;
  let blockedRetry = false;
  let offset = 0;
  const startedAt = Date.now();
  const emit = async (phase: SearchFallbackEvent['phase']) => {
    if (plan)
      await deps.onFallback?.({
        from: plan.from,
        to: plan.to,
        reason: 'search_verification_wall',
        phase,
        attempt: 1,
      });
  };
  const tracked = (intent: string): RunSupercarOptions => ({
    ...args,
    intent,
    onTick: async (ev: SupercarTickEvent) => {
      const execution = ev.execution;
      if (!retry) {
        if (
          execution?.actionKind === 'browser_blocker' &&
          execution.errorCode === 'browser_captcha_wall' &&
          execution.blockerEvidence?.visible
        )
          wallObserved = true;
        if (execution && !READ_ONLY.has(execution.actionKind)) unsafe = true;
        if (ev.toolsInTurn.some((tool) => !READ_ONLY.has(tool) && tool !== 'finish')) unsafe = true;
        if (execution?.effect?.unexpected || execution?.effect?.triggers?.length) unsafe = true;
      }
      const iteration = ev.iteration + offset;
      maxStep = Math.max(maxStep, iteration);
      await args.onTick?.({ ...ev, iteration });
    },
    onWebSearch: async (ev) => {
      await args.onWebSearch?.({ ...ev, iteration: ev.iteration + offset });
    },
    onAwaitingUser: async (ev) => {
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
  const selected = plan as SearchFallbackPlan | null;
  if (!selected || first.status === 'completed') return first;
  if (await args.isTaskCancelled?.()) return { ...first, status: 'cancelled' };
  const remaining = args.timeoutMs ? args.timeoutMs - (Date.now() - startedAt) : undefined;
  if (remaining !== undefined && remaining <= 0)
    return { ...first, status: 'awaiting_user', question: firstQuestion };
  retry = true;
  offset = Math.max(maxStep, first.iterations);
  await emit('started');
  const next = tracked(selected.intent);
  if (remaining !== undefined) next.timeoutMs = remaining;
  const second = await deps.run(next);
  if (second.status === 'failed' || second.status === 'timeout') {
    let unavailable = false;
    try {
      const page = await args.executor?.getPage();
      const current = page && parsed(page.url());
      if (page && current && engineAt(current) === selected.to) {
        const text = (await page.locator('body').innerText({ timeout: 1500 })).trim();
        unavailable =
          text.length < 1500 &&
          /unexpected error[\s\S]{0,160}(?:try again|if this persists)|our support email address includes an anonymized error code|^(?:access denied|forbidden|service unavailable)$/i.test(
            text,
          );
      }
    } catch {
      /* Do not infer a site block from a missing/closed page. */
    }
    if (unavailable) {
      if (!blockedRetry) await emit('blocked');
      return {
        ...second,
        status: 'awaiting_user',
        reason: undefined,
        question: `${selected.notice}\n\n${selected.to} 当前也无法返回搜索结果，已暂停，未切换第三个引擎。请稍后重试或指定其他可访问来源。`,
        iterations: offset + second.iterations,
        toolsUsed: [...new Set([...first.toolsUsed, ...second.toolsUsed])],
      };
    }
  }
  if (
    selected.requiresWeather &&
    second.status === 'completed' &&
    !/\d+(?:\.\d+)?\s*(?:°\s*[CF]?|摄氏度|华氏度|degrees|度)/i.test(second.summary ?? '')
  ) {
    await emit('failed');
    return {
      ...second,
      status: 'awaiting_user',
      summary: undefined,
      question: `${selected.notice}\n\n备用来源尚未提供可核验的天气温度，未完成天气卡片请求。请指定可访问的天气来源，不能把普通链接当作天气结果。`,
      iterations: offset + second.iterations,
      toolsUsed: [...new Set([...first.toolsUsed, ...second.toolsUsed])],
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
    toolsUsed: [...new Set([...first.toolsUsed, ...second.toolsUsed])],
    ...(second.summary ? { summary: `${selected.notice}\n\n${second.summary}` } : {}),
    ...(second.question ? { question: `${selected.notice}\n\n${second.question}` } : {}),
  };
}
