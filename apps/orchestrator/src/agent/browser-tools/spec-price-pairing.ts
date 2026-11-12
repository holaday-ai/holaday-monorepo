/**
 * FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh): the answer said 「RMB 9,999……这是 128GB 入门版
 * 的起售价格，256GB 版本的价格通常会更高」. iPhone 16 Pro Max has no 128GB model: RMB 9,999 is the
 * 256GB price. The sentence carried no quotes, so no quote check ever looked at it.
 *
 * In a price answer, every pairing of a capacity / edition with a price must be one a read page
 * shows: the capacity or edition within a few lines of that price (or of any price, when the
 * sentence points at a price without repeating it — 「这是 128GB 版的起售价」). A guess about how
 * another configuration is priced (「通常更高」「应该更便宜」) is never the page's: it is sent back
 * to be removed or written as not read.
 */

/** A price as written: currency + number, or number + 元. */
const PRICE_RE =
  /(?:s\$|us\$|a\$|hk\$|\$|¥|￥|€|£|sgd|usd|rmb|cny)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*元/giu;
/** Words that make a sentence about price even without a number: 起售价、售价、price… */
const PRICE_WORD_RE = /起售|售价|价格|定价|标价|起价|price[sd]?\b|priced|costs?\b/iu;
/** A capacity: 128GB, 1TB, 256 G. */
const CAPACITY_RE = /\b\d{2,4}\s*(?:gb|tb|g|t)\b|\d{2,4}\s*(?:gb|tb)/giu;
/** An edition named as such: 入门版、基础款、顶配… */
const EDITION_RE =
  /入门版|入门款|基础版|基础款|标准版|标准款|起步版|起步款|低配|最低配|高配|顶配|满配|旗舰版|base (?:model|version)|entry(?:-level)? (?:model|version)|top (?:model|configuration)/giu;
/** A guess about a price, not a reading: 通常更高、应该更便宜、likely more expensive. */
const GUESS_RE =
  /(?:通常|一般|往往|可能|应该|估计|大概|预计|想必|likely|usually|typically|probably|presumably)[^。！？\n]{0,24}(?:更高|更贵|更便宜|更低|贵一些|便宜一些|higher|more expensive|cheaper|lower)/iu;
/** The sentence says the price was not read: 没读到、没有列出、还缺、not listed… */
const NOT_READ_RE =
  /没读到|未读到|没有读到|未获取|没获取|没有显示|未显示|没显示|没有列出|未列出|没列出|没有标|未标注|没找到|未找到|找不到|看不到|还缺|缺少|无法确认|不确定|not (?:shown|found|listed|available)|no price|unavailable/iu;
/** Lines on either side of a price within which its capacity / edition must appear. */
const WINDOW = 6;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
const normPrice = (p: string) =>
  norm(p)
    .replace(/^sgd/, 's$')
    .replace(/^usd/, '$')
    .replace(/^(?:rmb|cny|￥)/, '¥');

/** The number in a normalised price: 「¥9999」「9999元」 → 9999. */
const amount = (p: string) => p.replace(/[^\d.]/g, '');

function sentencesOf(summary: string): string[] {
  return summary
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function specsOf(sentence: string): string[] {
  const found = new Set<string>();
  for (const m of sentence.matchAll(CAPACITY_RE))
    found.add(norm(m[0]).replace(/(\d)(g|t)$/, '$1$2b'));
  for (const m of sentence.matchAll(EDITION_RE)) found.add(norm(m[0]));
  return [...found];
}

interface PageLines {
  lines: string[];
}

function pageHasNear(page: PageLines, spec: string, price: string | null): boolean {
  const cap = /^(\d+)(gb|tb)$/.exec(spec);
  // 「256 GB」「256GB」「256G」 — and not the 256GB inside 1256GB.
  const capRe = cap ? new RegExp(`(?<!\\d)${cap[1]}${cap[2]![0]}b?(?![a-z])`) : null;
  const has = (line: string) => (capRe ? capRe.test(norm(line)) : norm(line).includes(spec));
  for (let i = 0; i < page.lines.length; i += 1) {
    const line = page.lines[i]!;
    const prices = [...line.matchAll(PRICE_RE)].map((m) => normPrice(m[0]));
    if (!prices.length) continue;
    if (price !== null && !prices.some((p) => amount(p) === amount(price))) continue;
    for (let k = Math.max(0, i - WINDOW); k <= Math.min(page.lines.length - 1, i + WINDOW); k += 1)
      if (has(page.lines[k]!)) return true;
  }
  return false;
}

/**
 * The answer's capacity / edition ↔ price pairings no read page supports, as contradiction lines.
 * Only for price answers (the intent or the answer is about a price).
 */
export function unsupportedSpecPricePairings(
  summary: string,
  pages: readonly string[],
  intent = '',
): string[] {
  const anyPrice = new RegExp(PRICE_RE.source, 'iu');
  if (!PRICE_WORD_RE.test(intent) && !/多少钱|how much/iu.test(intent) && !anyPrice.test(summary))
    return [];
  const read: PageLines[] = pages.map((text) => ({
    lines: text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  }));
  const out: string[] = [];
  for (const sentence of sentencesOf(summary)) {
    // A sentence that says it did not read something claims nothing.
    if (NOT_READ_RE.test(sentence)) continue;
    const specs = specsOf(sentence);
    if (!specs.length) continue;
    const prices = [...sentence.matchAll(PRICE_RE)].map((m) => normPrice(m[0]));
    const aboutPrice = prices.length > 0 || PRICE_WORD_RE.test(sentence);
    if (!aboutPrice) continue;
    const shown = sentence.slice(0, 60);
    if (GUESS_RE.test(sentence))
      out.push(`「${shown}」是对规格价格的推测，已读页面上没有这个说法：删掉这句，或写「没读到」`);
    const unsupported = specs.filter((spec) =>
      prices.length
        ? !prices.some((price) => read.some((page) => pageHasNear(page, spec, price)))
        : !read.some((page) => pageHasNear(page, spec, null)),
    );
    if (unsupported.length)
      out.push(
        `「${shown}」把 ${unsupported.join('、')} 和价格对应起来，已读页面上这个价格旁边没有它：删掉这句，或写「没读到」`,
      );
  }
  return out.slice(0, 4);
}
