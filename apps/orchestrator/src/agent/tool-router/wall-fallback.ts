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
import { matchLiveFact } from '../live-fact.js';
import { freshnessProblem, isTimeSensitive } from './freshness.js';
import { type FallbackRow, checkFallbackPrices } from './wall-checks.js';

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
  /我的|订单|购物车|账户|帐户|账号|帐号|余额|私信|站内信|收货地址|积分|优惠券|关注列表|浏览记录|物流|快递|白条|发票|会员|收藏(?!数|量|人数)|心愿单|内网|内部系统|私有|my\s+(?:orders?|cart|account|messages?|profile)|order\s+history|wish\s*list|intranet|private/iu;
/**
 * 复审 #2-1: the request is about the user's own things (「我在京东买的」「我京东的物流」「check my
 * amazon wishlist」「what I bought」). 「告诉我」「帮我」「给我」 only address the assistant.
 */
const FIRST_PERSON_RE =
  /(?<!告诉|帮|给|让|替|为|教|跟|问)我(?:在|们的|自己|家|京东|淘宝|天猫|拼多多|亚马逊|买|下的?单|上周|上个?月|昨天|前天|最近|刚|之前|账|帐|收藏|关注|购|订|发的|收到|付)|\bmy\b|\bmine\b|\bI\s+(?:bought|ordered|purchased|paid|saved|follow(?:ed)?)\b|\bI've\s+(?:bought|ordered)\b/iu;

/** 复审 #2-1: whether a request may ever be answered from public sources after a wall. */
export function wallFallbackAllowed(intent: string): boolean {
  const reading = intent.replace(/^\s*(?:open|visit|go\s+to)\s+\S+\s+(?:and\s+)?/iu, '');
  return (
    (isReadOnlyIntent(reading) || englishRead(reading)) &&
    !PERSONAL_RE.test(intent) &&
    !FIRST_PERSON_RE.test(intent) &&
    !PAYMENT_RE.test(intent)
  );
}
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
  if (!wallFallbackAllowed(intent)) return null;
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
  const kind = giveUpKind(said) === 'login' ? 'login' : 'blocked';
  const url = intent.match(URL_RE)?.[0] ?? null;
  const site = siteOf(intent, url);
  // 复审 #2-1: a login wall on a site that is neither a known public site nor an address the
  // request gave (「公司内网 wiki」) is the user's to sign in to.
  if (kind === 'login' && site === '原网站') return null;
  return { kind, site, url, from };
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

/** What the request asked for, for the wall line: 「价格」 for a price question, else the page. */
function asked(intent: string, english: boolean): string {
  const price = /价格|多少钱|售价|报价|卖多少|价位|\bprices?\b|\bcosts?\b|how\s+much/iu.test(
    intent,
  );
  if (english) return price ? 'the price' : 'the page';
  return price ? '价格' : '页面内容';
}

/** The request the scrape lane answers from the search rows. */
export function fallbackIntent(intent: string, wall: WallEnd): string {
  const ask = withoutAddresses(intent, wall.site);
  if (isEnglishIntent(intent)) {
    return `${ask}\n\n(${wall.site} ${wall.kind === 'login' ? 'requires sign-in' : 'blocked the visit with a verification check'}, so its page could not be read. Answer only from the search results below. Write each figure as 「I found X at <site> (<date>, <link>)」: the site and link of the search result it is in, and the date that result states — write 「date unknown」 when it states none. Data in the search results is not what ${wall.site}'s page shows unless the result is that page itself, and then say it is a search snippet. If the results do not have it, say so — do not guess.)`;
  }
  return `${ask}\n\n（${wall.site}${wall.kind === 'login' ? '要登录才能看' : '要做验证、把访问拦下了'}，没能直接读到页面。只用下面的搜索结果回答题目要的内容。每个数字或信息按「我在 XX 查到的是 ¥X（日期、链接）」写：XX 是那条搜索结果所在的网站，链接是那条结果的链接，日期是那条结果里写的日期，没写日期就写「日期不明」。搜索结果里别的网站的数据不是${wall.site}页面上显示的，不要说成「${wall.site}价」「${wall.site}上显示」；结果本身就是${wall.site}的页面时，写明是搜索结果里的页面摘要。搜索结果里没有的就如实说没查到，不要猜。）`;
}

/** The plain line said first: what stood in the way, and that what follows is from elsewhere. */
export function wallLine(wall: WallEnd, english: boolean, intent = ''): string {
  const what = asked(intent, english);
  if (english)
    return wall.kind === 'login'
      ? `${wall.site} requires sign-in to see ${what}, so its page could not be read. Here is what I found in public sources (not ${wall.site}'s page):`
      : `${wall.site} blocked the visit with a verification check, so its page could not be read. Here is what I found in public sources (not ${wall.site}'s page):`;
  return wall.kind === 'login'
    ? `${wall.site}要登录才能看${what}，没能直接读到页面；以下是我在公开来源查到的（不是${wall.site}页面上的数据）：`
    : `${wall.site}要做验证、把访问拦下了，没能直接读到页面；以下是我在公开来源查到的（不是${wall.site}页面上的数据）：`;
}

/** 复审 #2 建议: the user keeps the way back to the site itself. */
export function takeoverLine(wall: WallEnd, english: boolean, intent = ''): string {
  const what = asked(intent, english);
  if (english)
    return `If you need ${what} exactly as ${wall.site} shows it, ${wall.kind === 'login' ? 'sign in' : 'complete the verification'} and ask me to read it again.`;
  return `需要${wall.site}页面上的准确${what}，可以${wall.kind === 'login' ? '登录' : '完成验证'}后让我再读一次。`;
}

/**
 * 协调方判定: the closing line is the retrieval time, said as such (not the data's time).
 * `line` is the interface's 「来源：<name> · <time>」 / 「Source: … · …」 line.
 */
export function retrievalLine(line: string, english: boolean): string {
  return english
    ? `${line.replace(/^Source:\s*/u, 'Retrieved via ')} (retrieval time, not the data's time)`
    : `${line.replace(/^来源：\s*/u, '检索于：')}（检索时间，不是数据时间）`;
}

/**
 * The delivered answer. A partial browser answer keeps what it did read and adds the public
 * sources below it; a pause or failure is replaced by the wall line and the public answer. The
 * takeover line ends it.
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
      : wallLine(opts.wall, english, opts.intent);
  return `${head}\n\n${opts.answer.trim()}\n\n${takeoverLine(opts.wall, english, opts.intent)}`;
}

export interface ComposedFallback {
  /** False: nothing to deliver (an answer stating a time no result has); keep the browser end. */
  deliver: boolean;
  summary: string;
  /** What the checks did, for the task record. */
  checks: { removedPrices: number; rewrittenSites: number; freshness: string | null };
}

/**
 * 复审 #2 必须修 2 + 3, 协调方判定: the public-source answer as delivered.
 *  - Prices: each must occur in this call's rows; another site's price is not said to be the
 *    walled site's; each price line has a date (or 「日期不明」) and a link.
 *  - Time: a time-sensitive or live-fact question runs the freshness check. Results without
 *    today's date are delivered only as 「仅供参考，不是实时数据」; an answer stating a time the
 *    results do not have is not delivered.
 *  - The closing line is the retrieval time, named as such.
 */
export function composeFallback(opts: {
  wall: WallEnd;
  intent: string;
  answer: string;
  browserSummary?: string;
  rows: readonly FallbackRow[];
  /** The rows' text as the answer step saw it. */
  resultsText: string;
  /** The interface's 「来源：… · …」 line, if it gave one. */
  sourceLine: string | null;
  now?: Date;
}): ComposedFallback {
  const english = isEnglishIntent(opts.intent);
  const priced = checkFallbackPrices({
    answer: opts.answer,
    rows: opts.rows,
    site: opts.wall.site,
    english,
  });
  let body = priced.answer;
  const timed = isTimeSensitive(opts.intent) || !!matchLiveFact(opts.intent);
  const problem = timed
    ? freshnessProblem({
        intent: opts.intent,
        answer: body,
        results: opts.resultsText,
        force: true,
        ...(opts.now ? { now: opts.now } : {}),
      })
    : null;
  const checks = {
    removedPrices: priced.removed,
    rewrittenSites: priced.rewritten,
    freshness: problem?.kind ?? null,
  };
  if (problem?.kind === 'unsupported_time') return { deliver: false, summary: '', checks };
  if (problem?.kind === 'stale') {
    const latest = problem.latest;
    const note = english
      ? latest
        ? `(The newest date in these public sources is ${latest}; for reference only, not live data.)`
        : '(These public sources carry no date for today; for reference only, date unknown, not live data.)'
      : latest
        ? `（公开来源里最新的日期是 ${Number(latest.slice(5, 7))} 月 ${Number(latest.slice(8, 10))} 日，以下仅供参考，不是实时数据。）`
        : '（公开来源没有当天的时间戳，以下仅供参考（日期不明），不是实时数据。）';
    body = `${note}\n\n${body.trim()}`;
  }
  const composed = fallbackAnswer({
    wall: opts.wall,
    intent: opts.intent,
    answer: body,
    ...(opts.browserSummary ? { browserSummary: opts.browserSummary } : {}),
  });
  const summary = opts.sourceLine
    ? `${composed.trimEnd()}\n\n${retrievalLine(opts.sourceLine, english)}`
    : composed;
  return { deliver: true, summary, checks };
}
