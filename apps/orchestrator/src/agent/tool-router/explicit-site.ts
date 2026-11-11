/**
 * REBUILD-2 part 2 hard rule (2): the user names a site to open or to work on —
 * 「打开 google.com 搜索 Claude」「在亚马逊新加坡站搜 usb c cable」「在京东上看 iPhone 价格」
 * 「open bestbuy.com」「usb c cable price on Amazon Singapore」 — so the browser does it.
 *
 * Deliberately small. A site is a domain / URL, a known site name (the brand list in
 * `named-site-search.ts`) or a word ending in 网站/官网/网页/站/商城/App. Only these forms count:
 *   - an open verb right before the site: 打开/访问/前往/进入/登录/浏览 · open/visit/go to/navigate to/browse/log in to
 *   - 在 + site + (上/里/内/中 | a site verb right after: 搜/查/看/找/买/浏览/下单/登录/点/读)
 *   - 去/到/上 + domain or known site name + (上/里)? + site verb
 *   - English on/at + domain, on + known site name, on/at + "… website/site/store"
 * A negated clause (「不要打开淘宝」「don't open google.com」) does not count. Everything else is
 * the router model's choice.
 */
import { namedSite } from '../named-site-search.js';

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
  if (!site) return null;
  return rest.toLowerCase().startsWith(site.toLowerCase()) ? site : null;
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
