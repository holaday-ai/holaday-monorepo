/**
 * FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh): the answer said 「RMB 9,999……这是 128GB 入门版
 * 的起售价格，256GB 版本的价格通常会更高」. iPhone 16 Pro Max has no 128GB model: RMB 9,999 is the
 * 256GB price. The sentence carried no quotes, so no quote check ever looked at it.
 *
 * In a price answer every capacity paired with a price must be paired so on a read page, and a
 * guess about how another configuration is priced is never the page's. Checked per clause
 * (复审 #2: pairs in one sentence cannot be swapped):
 *  - a clause with a capacity and its own price: on some read page that price (by value: ¥7,999 is
 *    ¥7999.00) is given that capacity — the nearest capacity line, above it first;
 *  - a clause with a capacity and a price word but no number (「这是 128GB 版的起售价」): the
 *    sentence's price when it has exactly one, else any price, the same way;
 *  - a guess (通常 / 可能 / likely … 更高 / 更便宜 / cheaper) about a capacity, an edition or 「版本 /
 *    配置」 — unless the clause compares prices that are all on read pages.
 * A clause that says the price was not read claims nothing. The structural fix is REBUILD-3's
 * price contract; this covers the production path meanwhile.
 */

/** A price as written: currency + number, or number + 元 / 円. */
const PRICE_RE =
  /(?:s\$|us\$|a\$|c\$|hk\$|nt\$|\$|¥|￥|€|£|₹|₩|rm|sgd|usd|rmb|cny|hkd|eur|gbp|myr)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|円)/giu;
/** Words that make a clause about price even without a number. */
const PRICE_WORD_RE = /起售|售价|价格|定价|标价|起价|\bprices?\b|\bpriced\b|\bcosts?\b/iu;
/**
 * A capacity: 128GB, 1TB, 2 TB, 256G (upper-case G only: 500g is grams), 8+128. Captures the
 * number and unit, or the storage after 「+」.
 */
const CAPACITY_RE =
  /(?<![\d.])(\d{1,4})\s*(?:([GgTt][Bb])\b|([GT])(?![a-zA-Z]))|(?<!\d)\d{1,2}\s*\+\s*(\d{2,4})(?!\d)/gu;
/** Words that name a configuration in a guess. */
const CONFIG_WORD_RE =
  /入门版|入门款|基础版|基础款|标准版|起步版|低配|高配|顶配|满配|版本|配置|容量|\b(?:base|entry|top)\b|\bversions?\b|\bconfigurations?\b|\bstorage\b|\bmodels?\b/iu;
/** A guess about a price, not a reading. */
const GUESS_RE =
  /(?:通常|一般|往往|可能|应该|估计|大概|预计|想必|likely|usually|typically|probably|presumably|generally)[^。！？\n]{0,30}(?:更高|更贵|更便宜|更低|贵一些|便宜一些|贵|便宜|higher|more expensive|cheaper|lower|pricier)/iu;
/** The clause says the price was not read. */
const NOT_READ_RE =
  /没读到|未读到|没有读到|未获取|没获取|没有显示|未显示|没显示|没有列出|未列出|没列出|没找到|未找到|找不到|看不到|还缺|not (?:shown|found|listed|displayed)|no price/iu;
/** Lines on either side of a price within which its capacity must appear. */
const PAIR_LINES = 4;

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
    if (m[4]) out.add(`${Number(m[4])}g`);
    else if (m[1]) out.add(`${Number(m[1])}${(m[2] ?? m[3] ?? '').toLowerCase()[0]}`);
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

/** Clauses of a sentence: 「，」「、」 and an English comma followed by a space. */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/[，、]|,\s+(?=\D)/u)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * The capacities a page gives a price: those on the nearest line holding any capacity — the price's
 * own line first, then the lines above it (a card's title sits above its price), then below, at
 * most PAIR_LINES away. A neighbouring card's capacity is not this price's (复审 #2 漏网 2).
 */
function capacitiesForPrice(lines: string[], i: number): string[] {
  const own = capacitiesOf(lines[i]!);
  if (own.length) return own;
  for (let d = 1; d <= PAIR_LINES && i - d >= 0; d += 1) {
    const above = capacitiesOf(lines[i - d]!);
    if (above.length) return above;
    if (pricesOf(lines[i - d]!).length) break; // another price's block
  }
  for (let d = 1; d <= PAIR_LINES && i + d < lines.length; d += 1) {
    if (pricesOf(lines[i + d]!).length) break;
    const below = capacitiesOf(lines[i + d]!);
    if (below.length) return below;
  }
  return [];
}

/** Some read page gives `capacity` to a price equal to `price` (to any price when null). */
function paired(pages: readonly string[][], capacity: string, price: number | null): boolean {
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i += 1) {
      const prices = pricesOf(lines[i]!);
      if (!prices.length) continue;
      if (price !== null && !prices.includes(price)) continue;
      if (capacitiesForPrice(lines, i).includes(capacity)) return true;
    }
  }
  return false;
}

const shownCapacity = (c: string) => `${c.slice(0, -1)}${c.endsWith('t') ? 'TB' : 'GB'}`;

/**
 * The answer's capacity ↔ price pairings no read page supports and its guesses about configuration
 * prices, as contradiction lines. Only for price answers.
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
  const out: string[] = [];
  let previousPrices: number[] = [];
  for (const sentence of sentencesOf(summary)) {
    const sentencePrices = pricesOf(sentence);
    // 「…起售价为 RMB 9,999。这是 128GB 版的起售价格」: 「这」 is the sentence before's price.
    const nearby = sentencePrices.length ? sentencePrices : previousPrices;
    previousPrices = sentencePrices;
    for (const clause of clausesOf(sentence)) {
      if (NOT_READ_RE.test(clause)) continue;
      const shown = clause.slice(0, 60);
      const prices = pricesOf(clause);
      const capacities = capacitiesOf(clause);
      if (
        GUESS_RE.test(clause) &&
        (capacities.length || CONFIG_WORD_RE.test(clause)) &&
        !(prices.length >= 2 && prices.every((p) => pagePrices.has(p)))
      ) {
        out.push(
          `「${shown}」是对规格价格的推测，已读页面上没有这个说法：删掉这句，或写「没读到」`,
        );
        continue;
      }
      if (!capacities.length) continue;
      if (!prices.length && !PRICE_WORD_RE.test(clause)) continue;
      const against: Array<number | null> = prices.length
        ? prices
        : nearby.length === 1
          ? nearby
          : [null];
      const unsupported = capacities.filter(
        (cap) => !against.some((price) => paired(read, cap, price)),
      );
      if (unsupported.length)
        out.push(
          `「${shown}」把 ${unsupported.map(shownCapacity).join('、')} 和价格对应起来，已读页面上这个价格旁边没有它：删掉这句，或写「没读到」`,
        );
    }
  }
  return out.slice(0, 4);
}
