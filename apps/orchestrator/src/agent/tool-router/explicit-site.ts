/**
 * REBUILD-2 part 2 hard rule (2): the user names a site to open or to work on —
 * 「打开 google.com 搜索 Claude」「在亚马逊新加坡站搜 usb c cable」「在京东上看 iPhone 价格」
 * 「open bestbuy.com」「usb c cable price on Amazon Singapore」 — so the browser does it.
 *
 * Deliberately small. A site is a domain / URL, a known site name (the brand list in
 * `named-site-search.ts`) or a word ending in 网站/官网/网页/站/商城/App. Only these forms count:
 *   - an open verb right before the site: 打开/访问/前往/进入/登录/浏览 · open/visit/go to/navigate to/browse/log in to
 *   - 在 + site + (上/里/内/中 | a site verb right after: 搜/查/看/找/买/浏览/下单/登录/点/读)
 *   - 去/到/上 + domain or known site name + (上/里)? + site verb — the known names here also
 *     include the general search engines (「上百度搜一下」「去 Bing 上查」, review #1 item 4)
 *   - 去/到/上 + any short name + 上/里 + site verb (「去什么值得买上查」), except 网/网上/家…
 *   - English on/at + domain, on + known site name, on/at + "… website/site/store"
 * A negated clause (「不要打开淘宝」「don't open google.com」) does not count. Everything else is
 * the router model's choice.
 *
 * Review #1 item 3: a site that has an enabled interface (today only 高德) is different. An info
 * query naming it (「在高德地图上查…路线」「用高德查路线」「上高德查一下」) goes to that interface;
 * only 「打开高德地图网页/网站」 (or amap.com) or operating on the page goes to the browser.
 * `explicitSiteRoute` returns which.
 */
import { namedSite } from '../named-site-search.js';

/**
 * General search engines: the legacy site-search rule leaves 「上百度搜一下」 a web search, but
 * for the router naming one is naming a site (review #1 item 4).
 */
const SEARCH_ENGINES = [
  '百度',
  'baidu',
  '必应',
  'bing',
  '搜狗',
  'sogou',
  '360搜索',
  '夸克',
  'duckduckgo',
  'yahoo',
  '雅虎',
  'yandex',
  'naver',
];

/** 「去网上查」「到家里看看」 are not sites. */
const NOT_A_SITE =
  /^(?:网|网络|互联网|线上|网页|浏览器|家|楼|书|群|手机|电脑|公司|学校|店|现场|地图)$/;
/** 去/到/上 + a short name + 上/里 + a site verb: 「去什么值得买上查」. */
const GENERIC_GO_SITE =
  /^((?:(?!的|[，,。！？\s])[一-龥A-Za-z0-9·]){1,12}?)\s*(?:上面|上|里面|里)\s*[，,]?\s*(?:搜|查|看|找|买|浏览|下单|读)/;

const TLD =
  '(?:com|cn|net|org|io|ai|dev|app|co|edu|gov|info|me|tv|xyz|site|tech|top|hk|tw|jp|kr|sg|uk|de|fr|us|ca|au|in|ru|br|it|es|nl|my)';
/** A URL or a bare domain with a web TLD (「report.pdf」「main.py」 are not sites). */
const DOMAIN_AT_START = new RegExp(
  String.raw`^(?:https?:\/\/\S+|(?:www\.)?(?:[a-z0-9-]+\.)+${TLD}(?![a-z0-9-])(?:\/\S*)?)`,
  'i',
);
const SITE_WORD_AT_START =
  /^(?:(?!的)[一-龥A-Za-z0-9]){1,12}?(?:网站|官网|网页|商城|旗舰店|小程序|站|\s?App|\s?APP|\s?app)/;
const EN_SITE_WORD_AT_START =
  /^(?:the\s+)?(?!(?:the|a|an|this|that|my|your|our|their)\s)[A-Za-z0-9][\w&.'-]*(?:\s+[A-Za-z0-9][\w&.'-]*){0,3}\s+(?:website|web\s?site|site|homepage|web\s?page|online\s+store|store|app)\b/i;

const CN_OPEN = /打开|访问(?!量)|前往|进入|登录|登陆|浏览(?!器|量)/g;
const CN_AT = /在/g;
const CN_GO = /去|到|上/g;
const EN_OPEN =
  /\b(?:open|visit|go\s+to|navigate\s+to|browse(?:\s+to)?|log\s?in\s+to|sign\s+in\s+to)\s+/gi;
const EN_ON = /\b(?:on|at)\s+/gi;

const CN_WHERE = /^\s*(?:上面|上|里面|里|内|中)/;
const CN_SITE_VERB =
  /^\s*(?:上面|上|里面|里|内)?\s*[，,]?\s*(?:搜|查|看|找|买|浏览|下单|登录|点|读|打开)/;
const CN_NEGATION = /(?:不要|不用|不需要|不必|无需|无须|别|勿|禁止|没有|不)\s*(?:再|去|直接)?\s*$/;
const EN_NEGATION = /\b(?:do\s+not|don't|dont|never|without|no\s+need\s+to)\s+$/i;

/** The known site name the text starts with, or null. */
function knownSiteAtStart(rest: string): string | null {
  const site = namedSite(rest);
  if (site && rest.toLowerCase().startsWith(site.toLowerCase())) return site;
  const lower = rest.toLowerCase();
  const engine = SEARCH_ENGINES.find((name) => lower.startsWith(name));
  if (!engine) return null;
  // 「百度百科」「Bingo」 are not the bare engine.
  const next = rest.charAt(engine.length);
  if (/^[a-z0-9]$/i.test(next) && /^[a-z]/i.test(engine)) return null;
  return rest.slice(0, engine.length);
}

function domainAtStart(rest: string): string | null {
  return DOMAIN_AT_START.exec(rest)?.[0] ?? null;
}

function negated(text: string, at: number, english: boolean): boolean {
  const before = text.slice(Math.max(0, at - 16), at);
  return english ? EN_NEGATION.test(before) : CN_NEGATION.test(before);
}

function* matchesOf(pattern: RegExp, text: string): Generator<{ at: number; rest: string }> {
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    yield { at, rest: text.slice(at + match[0].length).replace(/^\s+/, '') };
  }
}

/** The site the user explicitly asks to open or to work on, or null. */
export function explicitSiteRequest(intent: string): string | null {
  const text = intent.trim();
  if (!text) return null;

  for (const { at, rest } of matchesOf(CN_OPEN, text)) {
    if (negated(text, at, false)) continue;
    const site =
      domainAtStart(rest) ?? knownSiteAtStart(rest) ?? SITE_WORD_AT_START.exec(rest)?.[0];
    if (site) return site.slice(0, 64);
  }
  for (const { at, rest } of matchesOf(CN_AT, text)) {
    if (negated(text, at, false)) continue;
    const site =
      domainAtStart(rest) ?? knownSiteAtStart(rest) ?? SITE_WORD_AT_START.exec(rest)?.[0];
    if (!site) continue;
    const after = rest.slice(site.length);
    if (CN_WHERE.test(after) || CN_SITE_VERB.test(after)) return site.slice(0, 64);
  }
  for (const { at, rest } of matchesOf(CN_GO, text)) {
    if (negated(text, at, false)) continue;
    const site = domainAtStart(rest) ?? knownSiteAtStart(rest);
    if (site && CN_SITE_VERB.test(rest.slice(site.length))) return site.slice(0, 64);
    const named = GENERIC_GO_SITE.exec(rest)?.[1]?.trim();
    if (named && !NOT_A_SITE.test(named)) return named.slice(0, 64);
  }
  for (const { at, rest } of matchesOf(EN_OPEN, text)) {
    if (negated(text, at, true)) continue;
    const site =
      domainAtStart(rest) ?? knownSiteAtStart(rest) ?? EN_SITE_WORD_AT_START.exec(rest)?.[0];
    if (site) return site.slice(0, 64);
  }
  for (const { at, rest } of matchesOf(EN_ON, text)) {
    if (negated(text, at, true)) continue;
    const onWord = text.slice(at, at + 2).toLowerCase() === 'on';
    const site =
      domainAtStart(rest) ??
      (onWord ? knownSiteAtStart(rest) : null) ??
      EN_SITE_WORD_AT_START.exec(rest)?.[0];
    if (site) return site.slice(0, 64);
  }
  return null;
}

/** A site with an enabled interface: its tool id and the names users call it. */
export interface InterfaceSite {
  toolId: string;
  aliases: readonly string[];
}

export type ExplicitSiteRoute =
  | { kind: 'browser'; site: string }
  | { kind: 'interface'; site: string; toolId: string };

/** 「高德地图网页 / 网站 / 官网 / 网页版」「amap.com」「Amap website」: the page itself. */
const WEB_PAGE_AFTER =
  /^\s*(?:地图)?\s*(?:的)?\s*(?:网页版?|网站|官网|页面|web\s*版|website|web\s?site|web\s?page|homepage|\.com\b)/i;
/** Operating on the page: only the browser can do it. */
const PAGE_OPERATION =
  /登录|登陆|注册|点击|点开|点一下|收藏|截图|截屏|分享到|下载|上传|填写|评论|发布|下单|打卡|页面上|网页上|\b(?:log\s?in|sign\s?in|sign\s?up|click|screenshot|bookmark|upload|download)\b/i;
/** 「用/拿/通过/借助/在/上/去/到 高德」「on/with/using/via Amap」: naming the interface's site. */
const NAMING_VERB =
  /(?:用|拿|通过|借助|使用|在|上|去|到|打开)\s*$|\b(?:on|with|using|via|in|open)\s+$/i;
/** 「高德(地图)(上/里) 查/搜/看/找/导航/规划/怎么走」: an info query right after the name. */
const INFO_AFTER =
  /^\s*(?:地图)?\s*(?:app|APP|App)?\s*(?:上面|上|里面|里)?\s*[，,]?\s*(?:查|搜|看|找|导航|规划|算|问|怎么走|路线)|^\s*(?:maps?\s+)?(?:to\s+)?(?:find|check|look|search|get|plan|route|directions|navigate)/i;

function aliasAt(text: string, aliases: readonly string[]): { at: number; alias: string } | null {
  const lower = text.toLowerCase();
  const sorted = [...aliases].sort((a, b) => b.length - a.length);
  let best: { at: number; alias: string } | null = null;
  for (const alias of sorted) {
    const at = lower.indexOf(alias.toLowerCase());
    if (at >= 0 && (!best || at < best.at)) best = { at, alias: text.slice(at, at + alias.length) };
  }
  return best;
}

/**
 * Hard rule 2 with the interface exception. `browser`: the user named a site to open or to work
 * on. `interface`: the user named a site that has an enabled interface and only wants
 * information from it. null: no site named.
 */
export function explicitSiteRoute(
  intent: string,
  interfaceSites: readonly InterfaceSite[] = [],
): ExplicitSiteRoute | null {
  const text = intent.trim();
  for (const entry of interfaceSites) {
    const found = aliasAt(text, entry.aliases);
    if (!found) continue;
    const before = text.slice(0, found.at);
    const after = text.slice(found.at + found.alias.length);
    const domain = /^\.(?:com|cn)\b/i.test(after);
    // 「不要用高德」「don't use Amap」: not a request for it.
    const lead = before.replace(
      /(?:用|拿|通过|借助|使用|在|上|去|到|打开)\s*$|\b(?:use|on|with|using|via|in|open)\s+$/i,
      '',
    );
    if (CN_NEGATION.test(lead) || EN_NEGATION.test(lead)) continue;
    if (domain || WEB_PAGE_AFTER.test(after) || PAGE_OPERATION.test(text))
      return { kind: 'browser', site: found.alias + (domain ? after.slice(0, 4) : '') };
    if (NAMING_VERB.test(before) || INFO_AFTER.test(after))
      return { kind: 'interface', site: found.alias, toolId: entry.toolId };
  }
  const site = explicitSiteRequest(text);
  return site ? { kind: 'browser', site } : null;
}
