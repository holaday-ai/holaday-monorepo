/**
 * REBUILD-3: the price contract's only check.
 *
 * 1. `quote` occurs in text this run actually read.
 * 2. `name`, `variant`, `price` (and the quote) come from the one block `block_ref` names.
 *
 * Nothing else is inferred from the answer. Missing items are never checked or sent back.
 */
import { nearestPassage } from '../browser-tools/completion-fields.js';
import { SEARCH_RESULTS_ORIGIN } from '../search-fallback/search-results-page.js';
import type { PriceItem } from './price-result.js';
import {
  type ReadBlock,
  type ReadPage,
  blocksFor,
  flatText,
  pagesQuoting,
  parseBlockRef,
  plainPageText,
} from './read-blocks.js';

export interface VerifiedPriceItem {
  item: PriceItem;
  /** The address the answer links: the model's when the run saw it, else the block's own. */
  sourceUrl: string | null;
  /** Read only on a search-results page: delivered, and named on the 未核实 line. */
  unverified?: 'search_snippet';
}

export interface RejectedPriceItem {
  index: number;
  item: PriceItem;
  problems: string[];
  /** What the run actually read for that block (sent back with the problems). */
  readText: string;
}

export interface PriceVerification {
  passed: VerifiedPriceItem[];
  rejected: RejectedPriceItem[];
}

const PRICE_NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/** The numbers of a price as written (「S$1,299.00」 → 1299.00). */
export function priceNumbers(price: string): string[] {
  return (price.normalize('NFKC').match(PRICE_NUMBER_RE) ?? []).map((n) => n.replace(/,/g, ''));
}

/** A whole number inside flat text: 12.9 is not said by 12.99, 9 not by 19. */
function hasNumber(flat: string, number: string): boolean {
  const escaped = number.replace(/\./g, '\\.');
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d]|\\.\\d)`).test(flat);
}

/** A name may end in an ellipsis where the model cut it; the rest must be the page's. */
const withoutEllipsis = (value: string) => value.replace(/\s*(?:…|\.\.\.)+\s*$/u, '').trim();

const VARIANT_SPLIT_RE = /\s*[,，、/;；|]\s*/u;

const SEARCH_ENGINE_RE =
  /^https?:\/\/(?:www\.|cn\.)?(?:bing\.com\/search|google\.[a-z.]+\/search|baidu\.com\/s\b|sogou\.com\/web|so\.com\/s\b|duckduckgo\.com\/)/i;

function onSearchResults(url: string | undefined): boolean {
  return !!url && (url.startsWith(SEARCH_RESULTS_ORIGIN) || SEARCH_ENGINE_RE.test(url));
}

function blockProblems(item: PriceItem, flat: string, flatRaw: string): string[] {
  const problems: string[] = [];
  const quote = flatText(item.quote);
  if (quote && !flat.includes(quote) && !flatRaw.includes(quote))
    problems.push(`quote「${item.quote.slice(0, 80)}」不在这个区块里`);
  const name = flatText(withoutEllipsis(item.name));
  if (!name || (!flat.includes(name) && !flatRaw.includes(name)))
    problems.push(`名称「${item.name.slice(0, 80)}」不在这个区块里`);
  const variant = item.variant?.trim();
  if (variant) {
    const parts = variant.split(VARIANT_SPLIT_RE).map(flatText).filter(Boolean);
    const absent = parts.filter((part) => !flat.includes(part) && !flatRaw.includes(part));
    if (absent.length) problems.push(`规格「${variant.slice(0, 60)}」不在这个区块里`);
  }
  const numbers = priceNumbers(item.price);
  if (!numbers.length) problems.push(`价格「${item.price}」里没有数字（拿不到就写进 missing）`);
  else if (!numbers.every((n) => hasNumber(flat, n) || hasNumber(flatRaw, n)))
    problems.push(`价格「${item.price}」不在这个区块里`);
  return problems;
}

function linkFor(item: PriceItem, block: ReadBlock | null, pages: readonly ReadPage[]) {
  const said = item.source_url?.trim();
  if (said && /^https?:\/\//i.test(said)) {
    const seen =
      block?.links.includes(said) ||
      pages.some((page) => page.sourceURL === said || page.text.includes(said));
    if (seen) return said;
  }
  return block?.links[0] ?? block?.page.sourceURL ?? null;
}

/** The read text around a quote, for a text-mode item that failed. */
function around(quote: string, pages: readonly ReadPage[]): string {
  const page = pagesQuoting(quote, pages)[0];
  if (!page) return '';
  const plain = plainPageText(page.text);
  const at = flatText(plain).indexOf(flatText(quote));
  // flatText collapses whitespace, so positions shift a little; a window absorbs that.
  const start = Math.max(0, at - 240);
  return plain
    .replace(/\s+/g, ' ')
    .slice(start, start + 600)
    .trim();
}

function verifyItem(
  item: PriceItem,
  index: number,
  pages: readonly ReadPage[],
): VerifiedPriceItem | RejectedPriceItem {
  const quoting = pagesQuoting(item.quote, pages);
  const quoteProblem = quoting.length
    ? []
    : [`quote「${item.quote.slice(0, 80)}」不在本次读到的页面文字里`];
  const nearest = () =>
    quoteProblem.length
      ? (nearestPassage(item.quote, [...pages]) ?? '')
      : around(item.quote, pages);
  const ref = parseBlockRef(item.block_ref);
  if (!ref) {
    // Text mode: the quote is the block.
    const problems = [
      ...quoteProblem,
      ...(quoteProblem.length ? [] : blockProblems(item, flatText(item.quote), '')).map((p) =>
        p.replace('这个区块', 'quote'),
      ),
    ];
    const page = quoting[0];
    if (!problems.length)
      return {
        item,
        sourceUrl: linkFor(item, null, pages) ?? page?.sourceURL ?? null,
        ...(onSearchResults(page?.sourceURL) ? { unverified: 'search_snippet' as const } : {}),
      };
    return { index, item, problems, readText: nearest() };
  }
  const blocks = blocksFor(item.block_ref, pages);
  if (!blocks.length)
    return {
      index,
      item,
      problems: [
        ...quoteProblem,
        `block_ref「${item.block_ref}」不在本次读到的快照里（用最新 snapshot / read_page 里包住名称和价格的那个节点的 ref）`,
      ],
      readText: nearest(),
    };
  let first: string[] | null = null;
  for (const block of blocks) {
    const problems = blockProblems(item, flatText(block.text), flatText(block.raw));
    if (!problems.length && !quoteProblem.length)
      return {
        item,
        sourceUrl: linkFor(item, block, pages),
        ...(onSearchResults(block.page.sourceURL) ? { unverified: 'search_snippet' as const } : {}),
      };
    first ??= problems;
  }
  return {
    index,
    item,
    problems: [...quoteProblem, ...(first ?? [])],
    readText: blocks[0]!.text.slice(0, 800),
  };
}

/** Checks every item; the caller decides what a rejection means (send back once, then missing). */
export function verifyPriceItems(
  items: readonly PriceItem[],
  pages: readonly ReadPage[],
): PriceVerification {
  const passed: VerifiedPriceItem[] = [];
  const rejected: RejectedPriceItem[] = [];
  items.forEach((item, index) => {
    const out = verifyItem(item, index, pages);
    if ('problems' in out) rejected.push(out);
    else passed.push(out);
  });
  return { passed, rejected };
}
