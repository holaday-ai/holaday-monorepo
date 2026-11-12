/**
 * FIX-62 P0-2 (DEPLOY-61 第三次 专项 4, sp-iphone-zh): the answer said 「RMB 9,999……这是 128GB 入门版
 * 的起售价格，256GB 版本的价格通常会更高」. iPhone 16 Pro Max has no 128GB model: RMB 9,999 is the
 * 256GB price. The sentence carried no quotes, so no quote check ever looked at it.
 *
 * Checks that page layouts cannot fool into sending a right answer back (复审 #3: tables, prices
 * above titles, configurators):
 *  1. a guess about how a configuration is priced (通常 / 可能 / likely … 更贵 / 更便宜 / cheaper);
 *  2. a capacity in a price clause that no read page shows at all;
 *  3. a clause pointing a price at a capacity (「这是 128GB 版的起售价」「对应 128GB 版本」), and
 *  4. a capacity written with its own price in a clause: the capacity within PAIR_LINES lines of
 *     that price, in either direction, in a piece of the page that names no other model (Pro vs
 *     Pro Max: 复审 #4 — the incident's 128GB was the Pro's); 「分别 / respectively」 taken whole.
 * Prices are compared by value (¥7,999 is ¥7999.00). A clause that says the price was not read
 * claims nothing. Known limits: swapped pairs both within reach, a page that names no model; the
 * structural fix is REBUILD-3's price contract (one block per variant).
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

/**
 * 复审 #4/#5: the models a text names. A suffix counts only right after a model number or a series
 * name (「16 Pro」「S24 Ultra」「MacBook Air」「iPad mini」) — never a lone word (「PLUS 会员价」「plus
 * shipping」「Case Plus」). A number with no suffix after a series (「iPhone 16」) and 「标准版」 are the
 * base model. A text may name several (「iPhone 16 Pro 和 iPhone 16 Pro Max 提供…」): it is evidence
 * for each. A capacity the page gives only another model (the incident: the Pro's 128GB beside the
 * Pro Max's price) is no evidence for this one.
 */
const SUFFIX = 'pro\\s*max|pro\\s*xl|pro|plus|mini|ultra|air|lite|se|fe|neo|xl';
const NUMBERED_RE = new RegExp(
  `(?<![\\d.,$¥￥])\\b[a-z]{0,2}\\d{1,3}[a-z]?\\s*(${SUFFIX})\\b(?!\\+(?![\\p{L}\\d]))`,
  'giu',
);
/** 复审 #6: 「S24+」 is the Plus, 「Mate 60 Pro+」 its own model (not the Pro). */
// 复审 #7: only a 「+」 right on the model (no space) and not followed by a word: 「16 Pro + AppleCare+」
// 「15 Pro +保护壳」 are bundles of the Pro.
const PLUS_SIGN_RE =
  /(?<![\d.,$¥￥])\b(?:[a-z]{1,2}\d{1,3}[a-z]?|\d{1,3}\s*(pro))\+(?![\p{L}\d])/giu;
const SERIES_RE = new RegExp(
  `\\b(?:macbook|ipad|iphone|galaxy|pixel|surface)\\s+(${SUFFIX})\\b(?!\\s*\\+)`,
  'giu',
);
const BASE_RE = new RegExp(
  `\\b(?:iphone|ipad|galaxy\\s*s|pixel|mate|redmi|xiaomi)\\s*\\d{1,3}(?![\\d.+]|\\s*(?:${SUFFIX}|max|e|\\+)\\b)|小米\\s*\\d{1,3}(?![\\d.+]|\\s*(?:${SUFFIX}|\\+))|标准版|标准款|base model`,
  'giu',
);
/** Operating systems carry edition words that are no device models (「Windows 11 Pro」). */
const OS_RE =
  /\b(?:windows|win)\s*\d{1,2}\s*(?:pro|home|plus|se|enterprise)\b|\bmacos\b|\bios\s*\d+/giu;
function modelsOf(raw: string): Set<string> {
  const text = raw.replace(OS_RE, ' ');
  const out = new Set<string>();
  for (const re of [NUMBERED_RE, SERIES_RE]) {
    for (const m of text.matchAll(re)) {
      const k = m[1]!.toLowerCase().replace(/\s+/g, '');
      out.add(k === 'plus' ? 'plus' : k);
    }
  }
  for (const m of text.matchAll(PLUS_SIGN_RE)) out.add(m[1] ? 'proplus' : 'plus');
  if (BASE_RE.test(text)) out.add('base');
  BASE_RE.lastIndex = 0;
  return out;
}

/** A line's pieces (「，；。」) — each with its own capacities and the models it names. */
function piecesOf(line: string): Array<{ caps: string[]; models: Set<string> }> {
  return line
    .split(/[，；。;]|,\s/u)
    .map((piece) => ({ caps: capacitiesOf(piece), models: modelsOf(piece) }))
    .filter((piece) => piece.caps.length > 0);
}

const sharesModel = (a: Set<string>, b: Set<string>) =>
  a.size === 0 || b.size === 0 || [...a].some((m) => b.has(m));

/**
 * A read page shows `capacity` within `reach` lines of a price equal to `price` (any when null),
 * in a piece that names no other model than `model`.
 */
function near(
  pages: readonly string[][],
  capacity: string,
  price: number | null,
  reach: number,
  models: Set<string>,
): boolean {
  for (const lines of pages) {
    for (let i = 0; i < lines.length; i += 1) {
      const prices = pricesOf(lines[i]!);
      if (!prices.length) continue;
      if (price !== null && !prices.includes(price)) continue;
      const from = Math.max(0, i - reach);
      const to = Math.min(lines.length - 1, i + reach);
      for (let k = from; k <= to; k += 1)
        for (const piece of piecesOf(lines[k]!))
          if (piece.caps.includes(capacity) && sharesModel(models, piece.models)) return true;
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
  // A task naming a series (「iPhone 16 价格」) asks about the whole line: only an explicit 标准版
  // makes it the base model.
  const taskModels = modelsOf(intent);
  if (!/标准版|标准款|base model/iu.test(intent)) taskModels.delete('base');
  let previousModels = new Set<string>();
  for (const sentence of sentencesOf(summary)) {
    // The models a clause is about: its own, its sentence's, else the task's. Only a pointing clause
    // (「这是…」 is the sentence before's) takes the sentence before's; another never does
    // (复审 #5: 「而 128GB 起步的那款」 is not the previous sentence's model).
    const ownModels = modelsOf(sentence);
    const beforeModels = previousModels;
    previousModels = ownModels;
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
      const pick = (...sets: Set<string>[]) =>
        sets.find((set) => set.size > 0) ?? new Set<string>();
      const model = pointing
        ? pick(
            modelsOf(clause),
            ownModels,
            sentencePrices.length ? new Set() : beforeModels,
            taskModels,
          )
        : pick(modelsOf(clause), ownModels, taskModels);
      // 3. Pointing a price at a capacity (「这是 / 对应 128GB」): that price — the sentence's or the
      // sentence before's when it has one — must show it for this model (复审 #4: within reach).
      if (pointing) {
        const target: Array<number | null> = nearby.length === 1 ? nearby : [null];
        const off = capacities.filter(
          (c) => !target.some((p) => near(read, c, p, PAIR_LINES, model)),
        );
        if (off.length) unsupported(clause, off);
        continue;
      }
      // 4. Written with its own price: within PAIR_LINES of it, for this model.
      if (prices.length) {
        const off = capacities.filter(
          (c) => !prices.some((p) => near(read, c, p, PAIR_LINES, model)),
        );
        if (off.length) unsupported(clause, off);
      }
    }
  }
  return out.slice(0, 4);
}
