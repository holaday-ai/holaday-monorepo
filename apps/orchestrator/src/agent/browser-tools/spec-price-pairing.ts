/**
 * FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh): the answer said 「RMB 9,999……这是 128GB 入门版
 * 的起售价格，256GB 版本的价格通常会更高」. iPhone 16 Pro Max has no 128GB model: RMB 9,999 is the
 * 256GB price. The sentence carried no quotes, so no quote check ever looked at it.
 *
 * Checks that page layouts cannot fool into sending a right answer back (复审 #3: tables, prices
 * above titles, configurators):
 *  1. a guess about how a configuration is priced (通常 / 可能 / likely … 更贵 / 更便宜 / cheaper);
 *  2. a capacity in a price clause that no read page shows at all;
 *  3. a clause pointing a price at a capacity (「这是 128GB 版的起售价」「对应 128GB 版本」): the
 *     capacity must be on the line of that price or right beside it (one line);
 *  4. a capacity written with its own price in a clause: within PAIR_LINES lines of that price, in
 *     either direction; 「分别 / respectively」 sentences are taken whole.
 * Prices are compared by value (¥7,999 is ¥7999.00). A clause that says the price was not read
 * claims nothing. Which model a capacity belongs to on a page listing several is beyond a text
 * check: REBUILD-3's price contract (one block per variant) is the structural fix.
 */

/** A price as written: currency + number, or number + 元 / 円. */
const PRICE_RE =
  /(?:s\$|us\$|a\$|c\$|hk\$|nt\$|\$|¥|￥|€|£|₹|₩|rm|sgd|usd|rmb|cny|hkd|eur|gbp|myr)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|円)/giu;
/** Words that make a clause about price even without a number. */
const PRICE_WORD_RE = /起售|售价|价格|定价|标价|起价|\bprices?\b|\bpriced\b|\bcosts?\b/iu;
/** A clause pointing a price elsewhere at a capacity. */
const POINTS_AT_RE =
  /这是|即为|就是|对应|指的是|属于|是.{0,12}(?:的)?(?:起售价|售价|价格)|\bis the\b|\bfor the\b/iu;
/**
 * A capacity: 128GB, 1TB, 2 TB; bare 256G / 1T (2+ digits for G: 5G / 4G are networks; upper case
 * only: 500g is grams); RAM + storage 8+128.
 */
const CAPACITY_RE =
  /(?<![\d.])(\d{1,4})\s*([GgTt][Bb])\b|(?<![\d.])(\d{2,4})G(?![a-zA-Z])|(?<![\d.])(\d{1,2})T(?![a-zA-Z])|(?<!\d)\d{1,2}\s*\+\s*(\d{2,4})(?!\d)/gu;
/** Words that name a configuration in a guess. */
const CONFIG_WORD_RE =
  /入门版|入门款|基础版|基础款|标准版|起步版|低配|高配|顶配|满配|版本|配置|容量|\b(?:base|entry|top)\b|\bversions?\b|\bconfigurations?\b|\bstorage\b|\bmodels?\b/iu;
/** A guess about a price, not a reading. */
const GUESS_RE =
  /(?:通常|一般|往往|可能|应该|估计|大概|预计|想必|likely|usually|typically|probably|presumably|generally)[^。！？\n]{0,30}(?:更高|更贵|更便宜|更低|贵一些|便宜一些|贵|便宜|higher|more expensive|cheaper|lower|pricier)/iu;
/** The clause says the price was not read. */
const NOT_READ_RE =
  /没读到|未读到|没有读到|未获取|没获取|没有显示|未显示|没显示|没有列出|未列出|没列出|没找到|未找到|找不到|看不到|还缺|not (?:shown|found|listed|displayed)|no price/iu;
/** Lines on either side of a price within which a capacity written beside it must appear. */
const PAIR_LINES = 8;

const amount = (raw: string): number | null => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Capacities in a text, as 「128g」「1t」 (number + unit initial). */
function capacitiesOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CAPACITY_RE)) {
    if (m[1]) out.add(`${Number(m[1])}${m[2]!.toLowerCase()[0]}`);
    else if (m[3]) out.add(`${Number(m[3])}g`);
    else if (m[4]) out.add(`${Number(m[4])}t`);
    else if (m[5]) out.add(`${Number(m[5])}g`);
  }
  return [...out];
}

function pricesOf(text: string): number[] {
  return [...text.matchAll(PRICE_RE)]
    .map((m) => amount(m[0]))
    .filter((n): n is number => n !== null);
}

function sentencesOf(summary: string): string[] {
  return summary
    .split(/(?<=[。！？!?；;])|(?<=\.)\s+(?=[A-Z一-鿿])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Clauses of a sentence (「，」「、」, an English comma + space); 「分别 / respectively」 keeps it whole. */
function clausesOf(sentence: string): string[] {
  if (/分别|respectively/iu.test(sentence)) return [sentence];
  return sentence
    .split(/[，、]|,\s+(?=\D)/u)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** A read page shows `capacity` within `reach` lines of a price equal to `price` (any when null). */
function near(
  pages: readonly string[][],
  capacity: string,
  price: number | null,
  reach: number,
): boolean {
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i += 1) {
      const prices = pricesOf(lines[i]!);
      if (!prices.length) continue;
      if (price !== null && !prices.includes(price)) continue;
      const from = Math.max(0, i - reach);
      const to = Math.min(lines.length - 1, i + reach);
      for (let k = from; k <= to; k += 1)
        if (capacitiesOf(lines[k]!).includes(capacity)) return true;
    }
  }
  return false;
}

const shownCapacity = (c: string) => `${c.slice(0, -1)}${c.endsWith('t') ? 'TB' : 'GB'}`;

/**
 * The answer's unsupported capacity ↔ price pairings and its guesses about configuration prices,
 * as contradiction lines. Only for price answers.
 */
export function unsupportedSpecPricePairings(
  summary: string,
  pages: readonly string[],
  intent = '',
): string[] {
  const priceTask =
    PRICE_WORD_RE.test(intent) ||
    /多少钱|价钱|how much/iu.test(intent) ||
    new RegExp(PRICE_RE.source, 'iu').test(summary);
  if (!priceTask) return [];
  const read = pages.map((text) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const pagePrices = new Set(read.flatMap((lines) => lines.flatMap(pricesOf)));
  const pageCapacities = new Set(read.flatMap((lines) => lines.flatMap(capacitiesOf)));
  const out: string[] = [];
  const unsupported = (clause: string, caps: string[]) =>
    out.push(
      `「${clause.slice(0, 60)}」把 ${caps.map(shownCapacity).join('、')} 和价格对应起来，已读页面上这个价格旁边没有它：删掉这句，或写「没读到」`,
    );
  let previousPrices: number[] = [];
  for (const sentence of sentencesOf(summary)) {
    const sentencePrices = pricesOf(sentence);
    // 「…起售价为 RMB 9,999。这是 128GB 版的起售价格」: 「这」 is the sentence before's price.
    const nearby = sentencePrices.length ? sentencePrices : previousPrices;
    previousPrices = sentencePrices;
    for (const clause of clausesOf(sentence)) {
      if (NOT_READ_RE.test(clause)) continue;
      const prices = pricesOf(clause);
      const capacities = capacitiesOf(clause);
      // 1. A guess — unless it compares prices that are all on read pages.
      if (
        GUESS_RE.test(clause) &&
        (capacities.length || CONFIG_WORD_RE.test(clause)) &&
        !(prices.length >= 2 && prices.every((p) => pagePrices.has(p)))
      ) {
        out.push(
          `「${clause.slice(0, 60)}」是对规格价格的推测，已读页面上没有这个说法：删掉这句，或写「没读到」`,
        );
        continue;
      }
      if (!capacities.length) continue;
      const pointing = !prices.length && POINTS_AT_RE.test(clause);
      if (!prices.length && !pointing && !PRICE_WORD_RE.test(clause)) continue;
      // 2. A capacity no read page shows at all.
      const absent = capacities.filter((c) => !pageCapacities.has(c));
      if (absent.length) {
        unsupported(clause, absent);
        continue;
      }
      // 3. Pointing a price at a capacity: on that price's line or right beside it.
      if (pointing) {
        const target: Array<number | null> = nearby.length === 1 ? nearby : [null];
        const off = capacities.filter((c) => !target.some((p) => near(read, c, p, 1)));
        if (off.length) unsupported(clause, off);
        continue;
      }
      // 4. Written with its own price: within PAIR_LINES of it.
      if (prices.length) {
        const off = capacities.filter((c) => !prices.some((p) => near(read, c, p, PAIR_LINES)));
        if (off.length) unsupported(clause, off);
      }
    }
  }
  return out.slice(0, 4);
}
