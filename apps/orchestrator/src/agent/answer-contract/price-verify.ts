/**
 * REBUILD-3: the price contract's only check.
 *
 * 1. `quote` occurs in text this run actually read.
 * 2. `variant`, `price` (and the quote) come from the one block `block_ref` names; `name` from that
 *    block or from the page's own title (a detail page's variant item does not repeat the name).
 * 3. Review #1: the block is the smallest variant item or product card. A block (or a text-mode
 *    quote) holding 2+ different prices, or 2+ variant options, is not accepted: a whole page
 *    (`e1` = main) or a long quote wrapping the whole variant area could otherwise pair one
 *    variant with another's price.
 *
 * Nothing else is inferred from the answer. Missing items are never checked or sent back.
 */
import { nearestPassage } from '../browser-tools/completion-fields.js';
import { SEARCH_RESULTS_ORIGIN } from '../search-fallback/search-results-page.js';
import type { PriceItem } from './price-result.js';
import {
  type BlockNode,
  type ReadBlock,
  type ReadPage,
  blocksFor,
  flatText,
  pageTitles,
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

/** A currency-marked amount: S$9.43, US$ 12, ¥7999.00, ￥ 6,899, 7999 元, 12.90 SGD. */
const AMOUNT_RE =
  /(?:(?:[A-Z]{1,3})?\$|RM|¥|￥|€|£|₹|₩|฿)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:元|円|SGD|USD|CNY|RMB|HKD|MYR|EUR|GBP|JPY)(?![A-Za-z])/gu;
/**
 * Amounts that are not the item's own price: unit, list / was / lowest, member, savings, coupons,
 * delivery, other sellers. A card showing its price next to these is still one price.
 */
const SECONDARY_PRICE_LINE =
  /\/\s?(?:count|unit|item|piece|each|ea|片|个|件|只|条|100\s?(?:g|ml)|kg|g|ml|l|oz|lb|ct)\b|\bper\b|每|单价|list(?:\s*price)?\s*:|\bwas\b|\brrp\b|m\.r\.p|typical|lowest|最低价|历史价|原价|划线|参考价|市场价|\bplus\b|会员|\bvip\b|\bprime\b|学生价|\bsave\b|节省|立省|立减|省\s?\d|\boff\b|coupon|优惠券|券|deliver|shipping|运费|配送|包邮|cashback|返现|积分|other\s+sellers|new\s*&\s*used|used\s+from|refurbished|二手|其他卖家/i;
const RANGE_RE = /\d\s*(?:-|–|—|~|～|至|到|to)\s*(?:(?:[A-Z]{1,3})?\$|RM|¥|￥|€|£)?\s?\d/i;
const SECONDARY_ROLES = new Set(['deletion']);

/**
 * The different prices a block shows, as entries: one per amount, a 「from – to」 range on one
 * line counts once; unit / list / was / savings / delivery amounts and struck-through prices are
 * left out. A currency mark on its own line belongs to the next line (「¥」「7999」).
 */
export function blockPriceEntries(lines: ReadonlyArray<{ text: string; role?: string }>): string[] {
  const entries = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.role && SECONDARY_ROLES.has(line.role)) continue;
    let text = line.text.normalize('NFKC');
    if (/^\s*(?:(?:[A-Z]{1,3})?\$|RM|¥|€|£)\s*$/u.test(text) && lines[i + 1]) {
      text = `${text}${lines[i + 1]!.text}`;
      i += 1;
    }
    if (SECONDARY_PRICE_LINE.test(text)) continue;
    const amounts = [...text.matchAll(AMOUNT_RE)].map((m) =>
      Number((m[1] ?? m[2] ?? '').replace(/,/g, '')),
    );
    if (!amounts.length) continue;
    if (amounts.length >= 2 && RANGE_RE.test(text)) {
      entries.add(`range:${amounts.join('-')}`);
      continue;
    }
    for (const amount of amounts) if (Number.isFinite(amount)) entries.add(String(amount));
  }
  return [...entries];
}

const OPTION_ROLES = new Set([
  'button',
  'radio',
  'option',
  'menuitemradio',
  'tab',
  'checkbox',
  'switch',
  'listitem',
  'link',
]);
const MAX_OPTION_CHARS = 40;
/** Card furniture that sits beside a variant link or button but is not a variant. */
const NOT_A_VARIANT =
  /star|rating|review|评价|评论|晒单|cart|购物车|\bbuy\b|购买|options?\b|选项|compare|对比|收藏|wish\s?list|share|分享|more\b|更多|\bsee\b|查看|详情|details|sponsored|广告|客服|店铺|store|shop\b|delivery|配送|^\d[\d,.]*$/i;

/**
 * Variant options in a block: the node that names the item's variant, and the nodes of the same
 * role at the same depth beside it (「Black」「White」 buttons of one colour list). Only short
 * nodes count, so a product title link that happens to contain the variant is not an option.
 */
function variantOptions(
  nodes: readonly BlockNode[],
  variant: string | null,
): {
  claimed: BlockNode;
  others: string[];
} | null {
  const parts = (variant ?? '').split(VARIANT_SPLIT_RE).map(flatText).filter(Boolean);
  if (!parts.length) return null;
  const isOption = (node: BlockNode) =>
    OPTION_ROLES.has(node.role) && node.text.length > 0 && node.text.length <= MAX_OPTION_CHARS;
  const claimed = nodes.find(
    (node) => isOption(node) && parts.some((part) => flatText(node.text).includes(part)),
  );
  if (!claimed) return null;
  const others = new Set<string>();
  for (const node of nodes) {
    if (node === claimed || !isOption(node)) continue;
    if (node.role !== claimed.role || node.indent !== claimed.indent) continue;
    if (flatText(node.text) === flatText(claimed.text) || NOT_A_VARIANT.test(node.text)) continue;
    others.add(node.text);
  }
  return { claimed, others: [...others] };
}

const SMALLEST_HINT = '用只包住这一款（这一个规格项或这一张商品卡片）的最小节点的 ref';

/** Review #1: a block or quote is the item's own only when it shows one price and one option. */
function sizeProblems(
  item: PriceItem,
  where: string,
  lines: ReadonlyArray<{ text: string; role?: string }>,
  nodes: readonly BlockNode[] | null,
): string[] {
  const problems: string[] = [];
  const prices = blockPriceEntries(lines);
  if (prices.length >= 2)
    problems.push(
      `${where}太大：里面有 ${prices.length} 个不同价格（${prices
        .slice(0, 4)
        .map((p) => p.replace(/^range:/, ''))
        .join('、')}），分不清哪个价格属于这一款；${SMALLEST_HINT}`,
    );
  const options = nodes ? variantOptions(nodes, item.variant) : null;
  // One price for several options is fine only when the page marks the claimed one selected.
  if (options?.others.length && !(options.claimed.selected && prices.length <= 1))
    problems.push(
      `${where}包住了多个规格（${[options.claimed.text, ...options.others]
        .slice(0, 4)
        .join('、')}），分不清价格属于哪一个；${SMALLEST_HINT}`,
    );
  return problems;
}

/** Text-mode quotes are kept to a short run of page text (review #1). */
export const MAX_TEXT_QUOTE_CHARS = 300;

function nameInTitle(name: string, page: ReadPage | undefined): boolean {
  if (!name || !page) return false;
  return pageTitles(page).some((title) => flatText(title).includes(name));
}

function blockProblems(item: PriceItem, flat: string, flatRaw: string, page?: ReadPage): string[] {
  const problems: string[] = [];
  const quote = flatText(item.quote);
  if (quote && !flat.includes(quote) && !flatRaw.includes(quote))
    problems.push(`quote「${item.quote.slice(0, 80)}」不在这个区块里`);
  const name = flatText(withoutEllipsis(item.name));
  // The name may come from the page's own title: a variant item does not repeat it.
  if (!name || (!flat.includes(name) && !flatRaw.includes(name) && !nameInTitle(name, page)))
    problems.push(`名称「${item.name.slice(0, 80)}」不在这个区块里，也不是本页标题`);
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
    // Text mode: the quote is the block — kept short, one price (review #1).
    const page = quoting[0];
    const quoteLines = item.quote.split(/\n+/).map((text) => ({ text }));
    const problems = [
      ...quoteProblem,
      ...(quoteProblem.length
        ? []
        : [
            ...(item.quote.length > MAX_TEXT_QUOTE_CHARS
              ? [
                  `quote 太长（${item.quote.length} 字）：text 模式只摘包住这一款名称、规格和价格的一小段（${MAX_TEXT_QUOTE_CHARS} 字以内）`,
                ]
              : []),
            ...sizeProblems(item, 'quote ', quoteLines, null),
            ...blockProblems(item, flatText(item.quote), '', page),
          ]
      ).map((p) => p.replace('这个区块', 'quote').replace('quote 太大', 'quote 太宽')),
    ];
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
    const problems = [
      ...blockProblems(item, flatText(block.text), flatText(block.raw), block.page),
      ...sizeProblems(item, `block_ref「${item.block_ref}」`, block.nodes, block.nodes),
    ];
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
