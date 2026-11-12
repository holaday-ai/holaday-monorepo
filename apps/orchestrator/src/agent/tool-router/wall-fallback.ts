/**
 * REBUILD-2 协调方决定 (2026-11-12 10:00 UTC): a read-only task whose browser run ended on a wall
 * (login, verification, the site blocking the visit) does not stop there. It says so plainly
 * (「京东要登录才能看」) and takes the asked fields from public sources through the enabled
 * search interface. The answer says where every fact came from and never passes another site's
 * data off as the walled site's. Writes and data only the signed-in user has (orders, cart, …)
 * are not routed around: they still go to the user. Nothing here solves a verification,
 * changes IP or disguises the browser — the browser is not used again at all.
 *
 * Behind TOOL_ROUTER_V2 (the caller checks the flag); pure helpers here, the wiring is in
 * `tasks.create`'s browser lane.
 */
import {
  RESCUE_PARTIAL_RE,
  giveUpKind,
  isEnglishIntent,
  isReadOnlyIntent,
  rescueSiteName,
} from '../browser-tools/unified-browser-loop.js';

export type WallKind = 'login' | 'blocked';

export interface WallEnd {
  kind: WallKind;
  /** Short name of the walled site (「京东」, 「知乎」, a host, or 「原网站」). */
  site: string;
  /** The address the task named, if any. */
  url: string | null;
  /** How the browser run ended: paused at the wall, failed on it, or a partial answer. */
  from: 'awaiting' | 'failed' | 'partial';
}

/** The browser outcome fields this looks at (a `SupercarOutcome` fits). */
export interface BrowserEnd {
  status: string;
  question?: string;
  reason?: string;
  summary?: string;
  partial?: unknown;
}

/** Data only the signed-in user has: never fetched from elsewhere. */
const PERSONAL_RE =
  /我的|订单|购物车|账户|帐户|账号|帐号|余额|私信|站内信|收货地址|积分|优惠券|关注列表|浏览记录|my\s+(?:orders?|cart|account|messages?|profile)|order\s+history/iu;
/** A payment / checkout page is not a wall to route around. */
const PAYMENT_RE = /支付|付款|结算|收银|payment|checkout/iu;
/** The ending says something stood in the way: login, verification, a block or masked data. */
const WALL_RE =
  /登录|登陆|验证|人机|拦截|拦下|风控|访问受限|打码|打了码|脱敏|sign\s*in|log\s*in|captcha|verif|blocked|denied|forbidden|access\s+restricted/iu;

const URL_RE = /https?:\/\/[^\s，。；、）)」]+/iu;
const DOMAIN_RE =
  /(?<![\w.@/-])(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|ai|co|sg|hk|tw|jp|uk)(?:\/[^\s，。；、）)」]*)?/giu;

/** English reads the shared check splits at 「and」 (「tell me the rating and number of reviews」). */
const EN_READ_RE =
  /\b(?:tell\s+me|what(?:'s|\s+is|\s+are)?|how\s+(?:many|much)|show\s+me|read|summari[sz]e|list|find)\b/iu;
const EN_ACTION_RE =
  /\b(?:buy|order|purchase|pay|add|like|follow|subscribe|comment|reply|post|share|book|reserve|delete|remove|claim|redeem|download|upload|save|send|submit|checkout|sign\s*(?:in|up)|log\s*in|register|fill|type|click)\b/iu;
function englishRead(intent: string): boolean {
  return isEnglishIntent(intent) && EN_READ_RE.test(intent) && !EN_ACTION_RE.test(intent);
}

/** Sites a task may name without an address. */
const NAMED: ReadonlyArray<[RegExp, string]> = [
  [/京东/u, '京东'],
  [/天猫/u, '天猫'],
  [/淘宝/u, '淘宝'],
  [/知乎/u, '知乎'],
  [/小红书/u, '小红书'],
  [/抖音/u, '抖音'],
  [/拼多多/u, '拼多多'],
  [/微博/u, '微博'],
  [/大众点评/u, '大众点评'],
  [/携程/u, '携程'],
  [/\bG2\b/u, 'G2'],
];

/** Hosts the rescue names do not cover. */
const HOSTS: ReadonlyArray<[RegExp, string]> = [
  [/(?:^|\.)g2\.com$/u, 'G2'],
  [/(?:^|\.)douyin\.com$/u, '抖音'],
  [/(?:^|\.)weibo\.com$/u, '微博'],
  [/(?:^|\.)dianping\.com$/u, '大众点评'],
];

function siteOf(intent: string, url: string | null): string {
  if (url) {
    const host =
      url
        .replace(/^https?:\/\//iu, '')
        .split(/[/?#]/u)[0]
        ?.toLowerCase() ?? '';
    const known = HOSTS.find(([re]) => re.test(host))?.[1];
    if (known) return known;
    const name = rescueSiteName(url);
    return name === '别的公开页面' ? '原网站' : name.replace(/^www\./u, '');
  }
  return NAMED.find(([re]) => re.test(intent))?.[1] ?? '原网站';
}

/**
 * The wall a read-only browser run ended on, or null when it did not end on one (completed,
 * cancelled, a question for the user, a payment page, a write or personal-data task).
 */
export function wallEnd(outcome: BrowserEnd, intent: string): WallEnd | null {
  // 「Open <address> and tell me …」: opening the page the task names is part of reading it.
  const reading = intent.replace(/^\s*(?:open|visit|go\s+to)\s+\S+\s+(?:and\s+)?/iu, '');
  if (!(isReadOnlyIntent(reading) || englishRead(reading)) || PERSONAL_RE.test(intent)) return null;
  let said: string;
  let from: WallEnd['from'];
  if (outcome.status === 'awaiting_user') {
    said = outcome.question ?? '';
    from = 'awaiting';
  } else if (outcome.status === 'failed' || outcome.status === 'timeout') {
    said = outcome.reason ?? '';
    from = 'failed';
  } else if (outcome.status === 'completed' && outcome.partial) {
    said = outcome.summary ?? '';
    // Only a partial answer that says what is masked or login-only (「¥7??9」, 「登录后可查看」).
    if (!RESCUE_PARTIAL_RE.test(said)) return null;
    from = 'partial';
  } else return null;
  if (!said || PAYMENT_RE.test(said) || !WALL_RE.test(said)) return null;
  const kind = giveUpKind(said);
  const url = intent.match(URL_RE)?.[0] ?? null;
  return {
    kind: kind === 'login' ? 'login' : 'blocked',
    site: siteOf(intent, url),
    url,
    from,
  };
}

/** The request without addresses or domains (the scrape lane would try to fetch them). */
function withoutAddresses(intent: string, site: string): string {
  return intent
    .replace(/^\s*请(?:使用|用)云端浏览器[，,：:\s]*/u, '')
    .replace(new RegExp(URL_RE.source, 'giu'), site)
    .replace(DOMAIN_RE, site)
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A product or page name the browser did read (a partial answer's title), if any. */
function readName(summary: string | undefined): string | null {
  if (!summary) return null;
  const titled = summary.match(/(?:商品标题|标题|title)[：:]\s*「?([^\n」]{4,80})/iu)?.[1];
  const quoted = summary.match(/「([^」\n]{6,80})」/u)?.[1];
  const listed = summary.match(/^\s*\d+\.\s*([^：:\n]{6,80})[：:]/mu)?.[1];
  const name = (titled ?? quoted ?? listed)?.replace(/[.…]+\s*$/u, '').trim();
  return name || null;
}

/** What the search interface is asked: what was read of the page, else the request itself. */
export function fallbackQuery(intent: string, wall: WallEnd, browserSummary?: string): string {
  const name = readName(browserSummary);
  const ask = withoutAddresses(intent, wall.site)
    .replace(/^(?:打开|访问|进入|open|visit|go\s+to)\s*/iu, '')
    .replace(/(?:读|看看?|告诉我)(?=[^，。]*(?:标题|价格|作者|点赞|回答数|评分))/gu, '');
  const parts = [name, name ? null : wall.url, ask].filter(Boolean) as string[];
  return parts.join(' ').slice(0, 160).trim();
}

/** The request the scrape lane answers from the search rows. */
export function fallbackIntent(intent: string, wall: WallEnd): string {
  const ask = withoutAddresses(intent, wall.site);
  if (isEnglishIntent(intent)) {
    return `${ask}\n\n(${wall.site} ${wall.kind === 'login' ? 'requires sign-in' : 'blocked the visit with a verification check'}, so its page could not be read. Answer only from the search results below. Say which site each figure or fact comes from; data in the search results is not what ${wall.site}'s page shows unless the result is that page itself, and then say it is a search snippet. If the results do not have it, say so — do not guess.)`;
  }
  return `${ask}\n\n（${wall.site}${wall.kind === 'login' ? '要登录才能看' : '要做验证、把访问拦下了'}，没能直接读到页面。只用下面的搜索结果回答题目要的内容，每个数字或信息都写明来自哪个网站（如「据什么值得买…」）。搜索结果里别的网站的数据不是${wall.site}页面上显示的，不要说成是${wall.site}上的；结果本身就是${wall.site}的页面时，写明是搜索结果里的摘要。搜索结果里没有的就如实说没查到，不要猜。）`;
}

/** The plain line said first: what stood in the way, and that what follows is from elsewhere. */
export function wallLine(wall: WallEnd, english: boolean): string {
  if (english)
    return wall.kind === 'login'
      ? `${wall.site} requires sign-in, so its page could not be read. Here is what public sources show (not ${wall.site}'s page):`
      : `${wall.site} blocked the visit with a verification check, so its page could not be read. Here is what public sources show (not ${wall.site}'s page):`;
  return wall.kind === 'login'
    ? `${wall.site}要登录才能看，没能直接读到页面。以下是从公开来源查到的（不是${wall.site}页面上的数据）：`
    : `${wall.site}要做验证、把访问拦下了，没能直接读到页面。以下是从公开来源查到的（不是${wall.site}页面上的数据）：`;
}

/**
 * The delivered answer. A partial browser answer keeps what it did read and adds the public
 * sources below it; a pause or failure is replaced by the wall line and the public answer.
 */
export function fallbackAnswer(opts: {
  wall: WallEnd;
  intent: string;
  answer: string;
  browserSummary?: string;
}): string {
  const english = isEnglishIntent(opts.intent);
  const head =
    opts.wall.from === 'partial' && opts.browserSummary
      ? `${opts.browserSummary.trimEnd()}\n\n${
          english
            ? `Also checked public sources (not ${opts.wall.site}'s page):`
            : `另外从公开来源补查（不是${opts.wall.site}页面上的数据）：`
        }`
      : wallLine(opts.wall, english);
  return `${head}\n\n${opts.answer.trim()}`;
}
