/**
 * REBUILD-2 复审 #2 / 协调方判定 (2026-11-13 01:40 北京): the public-source answer after a wall is
 * checked by code, not only by the prompt.
 *
 * - Every price it states must occur in this search's rows; a price no row shows is removed.
 * - A price said to be the walled site's (「京东价 ¥X」「京东上显示 ¥X」) whose row is another
 *   site is rewritten as that site's finding (「据什么值得买查到 ¥X」); a row that is the walled
 *   site's own page is a search snippet and says so.
 * - Every price line carries a date and a link: the row's link is added, and 「日期不明」 when
 *   the line states no date.
 *
 * Pure: the rows are what the interface lane returned on this call.
 */
import { rescueSiteName } from '../browser-tools/unified-browser-loop.js';

export interface FallbackRow {
  url: string;
  title: string;
  snippet: string;
}

export interface PriceCheckResult {
  answer: string;
  /** Price lines removed because no row shows the price. */
  removed: number;
  /** Lines whose site attribution was rewritten. */
  rewritten: number;
}

/** A currency-marked amount: ¥7999, ￥ 6,899, 7999 元, S$9.43, $12.99, 12.90 SGD. */
const AMOUNT_RE =
  /(?:(?:[A-Z]{1,3})?\$|RM|¥|￥|€|£)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:元|SGD|USD|CNY|RMB|HKD)(?![A-Za-z])/gu;

/** A date the line states, or that it says it has none. */
const DATED_RE =
  /20\d{2}\s?[年\-/.]|\d{1,2}\s?月|\d{1,2}\/\d{1,2}|日期不明|今天|今日|昨天|\b(?:today|yesterday|date unknown)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/iu;
const LINKED_RE = /https?:\/\//iu;

const flat = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** A whole number inside flat text: 799 is not said by 7999, 12.9 not by 12.99. */
function hasNumber(text: string, number: string): boolean {
  const escaped = number.replace(/\./g, '\\.');
  return new RegExp(`(?<![\\d.])${escaped}(?:\\.0+)?(?![\\d]|\\.\\d)`).test(text);
}

function amountsIn(line: string): string[] {
  return [...line.matchAll(AMOUNT_RE)].map((m) => (m[1] ?? m[2] ?? '').replace(/,/g, ''));
}

/** Short name of a row's site (「什么值得买」「京东」, else the host). */
export function rowSiteName(url: string): string {
  const name = rescueSiteName(url);
  return name === '别的公开页面' ? url : name.replace(/^www\./u, '').replace(/手机版$/u, '');
}

/** Whether a row is the walled site's own page. */
function sameSite(url: string, site: string): boolean {
  const name = rowSiteName(url);
  return name === site || name === site.replace(/手机版$/u, '') || url.includes(site);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 「京东价」「京东售价」「京东上显示」「京东页面显示」「京东自营」 … before a price: the sentence says
 * the price is the walled site's.
 */
function siteClaimRe(site: string): RegExp {
  const s = escapeRe(site.replace(/手机版$/u, ''));
  return new RegExp(
    `${s}(?:手机版)?(?:自营|官方旗舰店|旗舰店)?(?:页面|网页|商品页|上|里|中)?(?:显示的?(?:价格)?|标价|售价|价格|报价|卖|在售|价)(?:为|是|约|：|:)?\\s?`,
    'u',
  );
}

/**
 * Checks and completes the price lines of a public-source answer. `site` is the walled site's
 * short name; `rows` the search rows this answer was written from.
 */
export function checkFallbackPrices(input: {
  answer: string;
  rows: readonly FallbackRow[];
  site: string;
  english?: boolean;
}): PriceCheckResult {
  const rows = input.rows.map((row) => ({ ...row, text: flat(`${row.title} ${row.snippet}`) }));
  let removed = 0;
  let rewritten = 0;
  const out: string[] = [];
  for (const line of input.answer.split('\n')) {
    const amounts = amountsIn(line);
    if (!amounts.length) {
      out.push(line);
      continue;
    }
    // Which row says each amount; a line whose amounts no row shows is dropped.
    const holders = amounts.map((n) => rows.filter((row) => hasNumber(row.text, n)));
    if (holders.some((h) => !h.length)) {
      removed += 1;
      continue;
    }
    // The row that shows all the line's amounts, else the first amount's row.
    const all = rows.find((row) => amounts.every((n) => hasNumber(row.text, n)));
    const row = all ?? holders[0]![0]!;
    let text = line;
    const claim = siteClaimRe(input.site);
    const ownPage = sameSite(row.url, input.site);
    const by = rowSiteName(row.url);
    // Already said whose finding it is (「据什么值得买…京东页面价」 reports that site's words).
    if (!ownPage && claim.test(text) && !text.includes(by)) {
      text = text.replace(claim, input.english ? `${by} shows ` : `${by}查到 `);
      rewritten += 1;
    } else if (ownPage && !/摘要|snippet/iu.test(text)) {
      text = `${text.trimEnd()}${input.english ? ' (search snippet of the page)' : '（搜索结果里的页面摘要）'}`;
    }
    const tail: string[] = [];
    if (!DATED_RE.test(text)) tail.push(input.english ? 'date unknown' : '日期不明');
    if (!LINKED_RE.test(text)) tail.push(row.url);
    if (tail.length) text = `${text.trimEnd()}（${tail.join(input.english ? ', ' : '，')}）`;
    out.push(text);
  }
  let answer = out.join('\n').replace(/\n{3,}/g, '\n\n');
  if (removed)
    answer = `${answer.trimEnd()}\n\n${
      input.english
        ? `(${removed} price line(s) not found in the search results were left out.)`
        : `（另有 ${removed} 处价格在搜索结果原文里找不到，已删去。）`
    }`;
  return { answer, removed, rewritten };
}
