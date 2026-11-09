/**
 * FIX-60 P1: a price read from a product page belongs to the variant it sits under.
 *
 * DEPLOY-59 reg-new-amazon-sg (线上): the third search result, Belkin's braided USB-A cable (white,
 * 200 cm, 「2 options from S$8.21」 on its card), was opened for its price, and the answer took
 * S$6.86 — the black variant's price, shown on that page's colour swatch. A detail page lists a
 * price per variant under its variant selector (「Colour Name: White」 then each swatch's price);
 * the page's default or another swatch is not the searched item.
 *
 * So a price the answer gives that a page shows only inside a variant selector holding more than
 * one price is the answer's only if
 *  - some page the run read shows it outside every selector too (the search result's card, the
 *    page's main price), or
 *  - the answer names the variant right beside the price (「黑色款 S$6.86」「S$6.86 (Black)」), or
 *  - it is the selector's 「N options from」 price and the answer says so (起 / from / 报价 / offers).
 * Otherwise it is sent back: take the searched card's price, or name the variant.
 */

/** A variant selector's label line: 「Colour Name: White」「Size: 2 m」「颜色：白色」「规格：128GB」. */
const VARIANT_LABEL_RE =
  /^(?:colou?r|size|style|pattern|capacity|length|configuration|edition|material|颜色|顏色|尺寸|尺码|規格|规格|容量|长度|款式|版本|型号|套餐|材质)(?:\s*name)?\s*[:：]\s*\S.{0,60}$/i;
const PRICE_RE = /(?:s\$|us\$|a\$|hk\$|\$|¥|￥|€|£|sgd|usd|rmb|cny)\s*\d[\d,]*(?:\.\d+)?/gi;
/** A selector line is short: a swatch's price, its option count, an option name. */
const SELECTOR_LINE_MAX = 60;
const SELECTOR_LINES_MAX = 30;
/** 「2 options from S$8.21」「3 个选项 ¥99 起」 */
const FROM_LINE_RE = /\boptions?\s+from\b|\boffers?\b|起|个选项|卖家报价/i;
const FROM_ANSWER_RE = /\bfrom\b|\boptions?\b|\boffers?\b|起|报价|选项|卖家/i;
/** The variant named beside a price: a colour, a size or length, a capacity, 「…款」. */
const VARIANT_WORD_RE =
  /黑|白|红|蓝|绿|灰|银|金|粉|紫|黄|橙|棕|米色|black|white|red|blue|green|gr[ae]y|silver|gold|pink|purple|yellow|orange|brown|beige|\d+(?:\.\d+)?\s*(?:cm|mm|m|ft|in|inch|英寸|厘米|毫米|米|gb|tb|ml|l|w)\b|\d+(?:\.\d+)?\s*(?:厘米|毫米|米|英寸)|[\p{Script=Han}A-Za-z\d]{1,6}款|规格|颜色|尺寸|variant|colou?r|size/iu;

const normalizePrice = (price: string) =>
  price
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '')
    .replace(/^sgd/, 's$')
    .replace(/^usd/, '$');

/** An accessibility-snapshot line (「- generic [ref=e3]: S$6.86」) or a text line, as its text. */
function lineText(line: string): string {
  if (!/^\s*-\s/.test(line)) return line.trim();
  const m = /^\s*-\s+(?:[a-z]+\b)?(?:\s+"([^"]*)")?(?:\s*\[[^\]]*\])*\s*(?::\s*(.*))?$/i.exec(line);
  return (m?.[2] ?? m?.[1] ?? line.replace(/^\s*-\s+/, '')).trim();
}

interface Selector {
  /** The selector's lines, label first. */
  lines: string[];
  prices: Set<string>;
}

/** The page's variant selectors and its text outside them. */
function selectorsOf(pageText: string): { selectors: Selector[]; outside: string[] } {
  const lines = pageText.split('\n').map(lineText).filter(Boolean);
  const selectors: Selector[] = [];
  const outside: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!VARIANT_LABEL_RE.test(lines[i]!)) {
      outside.push(lines[i]!);
      continue;
    }
    const block = [lines[i]!];
    let k = i + 1;
    while (
      k < lines.length &&
      block.length < SELECTOR_LINES_MAX &&
      lines[k]!.length <= SELECTOR_LINE_MAX &&
      !VARIANT_LABEL_RE.test(lines[k]!)
    ) {
      block.push(lines[k]!);
      k += 1;
    }
    selectors.push({
      lines: block,
      prices: new Set(block.flatMap((line) => (line.match(PRICE_RE) ?? []).map(normalizePrice))),
    });
    i = k - 1;
  }
  return { selectors, outside };
}

/** The part of the answer line after the item's name, where a variant beside the price is named. */
function besidePrice(line: string, at: number): string {
  const head = line.slice(0, at);
  const cut = Math.max(
    ...[' — ', ' – ', ' - ', '：', ': ', '，', ','].map((sep) => head.lastIndexOf(sep)),
  );
  return `${line.slice(cut < 0 ? 0 : cut, at)}${line.slice(at).split(/[；;。\n]/)[0]}`;
}

/**
 * Prices the answer takes from a product page's variant selector without saying which variant:
 * one contradiction per price.
 */
export function unmatchedVariantPrices(summary: string, pageTexts: readonly string[]): string[] {
  const pages = pageTexts.map(selectorsOf);
  const ambiguous = pages.flatMap((page) => page.selectors.filter((s) => s.prices.size > 1));
  if (!ambiguous.length) return [];
  const shownElsewhere = new Set(
    pages.flatMap((page) =>
      page.outside.flatMap((line) => (line.match(PRICE_RE) ?? []).map(normalizePrice)),
    ),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of summary.split('\n')) {
    for (const m of line.matchAll(PRICE_RE)) {
      const price = normalizePrice(m[0]);
      if (seen.has(price) || shownElsewhere.has(price)) continue;
      const selector = ambiguous.find((s) => s.prices.has(price));
      if (!selector) continue;
      const beside = besidePrice(line, m.index ?? 0);
      if (VARIANT_WORD_RE.test(beside)) continue;
      const fromLine = selector.lines.some(
        (l) =>
          FROM_LINE_RE.test(l) && (l.match(PRICE_RE) ?? []).map(normalizePrice).includes(price),
      );
      if (fromLine && FROM_ANSWER_RE.test(beside)) continue;
      seen.add(price);
      out.push(
        `答案里的「${m[0]}」在商品页上只出现在规格选择区（「${selector.lines[0]}」）里，那一区有好几个规格的价格（${[
          ...selector.prices,
        ]
          .slice(0, 4)
          .join(
            '、',
          )}），答案没写是哪个规格：请用搜索结果里那一款卡片上的价格（如「N options from …」），或者写明规格；不能拿商品页上默认或别的规格的价格顶替`,
      );
    }
  }
  return out;
}

/**
 * FIX-60 复审 #1 #3: the detail page's main price can be its default variant's and sit outside
 * every selector (线上 reg-new-amazon-sg): then `unmatchedVariantPrices` sees it 「shown
 * elsewhere」 and lets it through. So the search result's card comes along to the detail page:
 * the card an answer line names (its title, on the search page and again on the detail page) and
 * that card's 「from」 price (「2 options from S$8.21」「S$8.21 (2 new offers)」) and variant
 * (colour, length, capacity in its title).
 *  - A price lower than the card's 「from」 price, with no variant named, is not the searched
 *    item's: sent back.
 *  - A variant the answer names that differs from the card's (黑色 for a white card, 1 m for a
 *    2 m one) is another item's: sent back.
 */
const CARD_FROM_RE =
  /\boptions?\s+from\b|\bnew offers?\b|\boffers?\s+from\b|\bfrom\s+(?:s\$|us\$|\$)|起|个选项|卖家报价/i;
const CARD_WINDOW = 10;
const CARD_TITLE_MIN = 15;
/** Words every cable or phone title shares: they tell no card apart. */
const GENERIC_TOKENS = new Set([
  'the',
  'and',
  'for',
  'with',
  'pack',
  'cable',
  'charger',
  'charging',
  'fast',
  'cord',
  'type',
  'new',
  'usb',
]);
/** A colour: 「黑色 / 黑款」 (not 红米、金士顿) or the English word. */
const COLOURS: ReadonlyArray<[RegExp, string]> = [
  [/黑(?:色|款)|\bblack\b/i, 'black'],
  [/白(?:色|款)|\bwhite\b/i, 'white'],
  [/红(?:色|款)|\bred\b/i, 'red'],
  [/蓝(?:色|款)|\bblue\b/i, 'blue'],
  [/绿(?:色|款)|\bgreen\b/i, 'green'],
  [/灰(?:色|款)|\bgr[ae]y\b/i, 'grey'],
  [/银(?:色|款)|\bsilver\b/i, 'silver'],
  [/金(?:色|款)|\bgold\b/i, 'gold'],
  [/粉(?:色|款)|\bpink\b/i, 'pink'],
  [/紫(?:色|款)|\bpurple\b/i, 'purple'],
];
const LENGTH_RE =
  /(\d+(?:\.\d+)?)\s*(ft|feet|foot|cm|mm|m|meters?|metres?|centimeters?|centimetres?|inch(?:es)?|in|厘米|毫米|米|英尺|英寸)(?![a-z])/gi;
const CAPACITY_RE = /(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi;

const priceValue = (price: string) => Number(price.replace(/[^\d.]/g, ''));
const priceCurrency = (price: string) => normalizePrice(price).replace(/[\d.]+$/, '');

function tokensOf(text: string): string[] {
  return [
    ...new Set(
      (
        text.toLowerCase().match(/[a-z][a-z0-9.+-]{2,}|\d+(?:\.\d+)?(?:ft|m|cm|w|gb|tb|mm)\b/g) ??
        []
      )
        .map((t) => t.replace(/[.,+-]+$/, ''))
        .filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t)),
    ),
  ];
}

function colours(text: string): Set<string> {
  return new Set(COLOURS.filter(([re]) => re.test(text)).map(([, c]) => c));
}

function lengthsCm(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(LENGTH_RE)) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    const cm = /^(?:ft|feet|foot|英尺)$/.test(unit)
      ? n * 30.48
      : /^(?:mm|毫米)$/.test(unit)
        ? n / 10
        : /^(?:m|meters?|metres?|米)$/.test(unit)
          ? n * 100
          : /^(?:inch(?:es)?|in|英寸)$/.test(unit)
            ? n * 2.54
            : n;
    out.push(cm);
  }
  return out;
}

function capacities(text: string): Set<string> {
  return new Set(
    [...text.matchAll(CAPACITY_RE)].map((m) => `${Number(m[1])}${m[2]!.toLowerCase()}`),
  );
}

interface Card {
  title: string;
  /** The card's 「from」 prices, as written (lowest first). */
  fromPrices: string[];
  /** Every price shown under the title on a page that is not a product detail page. */
  shownPrices: string[];
  /**
   * The title shows up only on product detail pages (pages with a variant selector): it is the
   * page's own heading, not a search result's card (DEPLOY-60 协调方核对 必须修 2).
   */
  detailOnly: boolean;
  /** The card's own text, for its variant: its title (the lines under it may be the next card's). */
  text: string;
}

/**
 * The cards an answer line names: the page title lines its words match best. Several when titles
 * tie (DEPLOY-60 第 0 步 #2: a tie no longer skips the check — the line is held against every
 * tied card); none when no title matches well enough.
 */
function cardsFor(name: string, pages: readonly string[][]): Card[] {
  const wanted = tokensOf(name);
  if (wanted.length < 2) return [];
  let bestScore = 0;
  let titles: string[] = [];
  for (const lines of pages)
    for (const line of lines) {
      if (line.length < CARD_TITLE_MIN || PRICE_RE.test(line)) {
        PRICE_RE.lastIndex = 0;
        continue;
      }
      PRICE_RE.lastIndex = 0;
      const have = new Set(tokensOf(line));
      const hits = wanted.filter((t) => have.has(t)).length;
      const score = hits / wanted.length;
      if (hits < 2 || score < 0.6) continue;
      if (score > bestScore) {
        bestScore = score;
        titles = [line];
      } else if (score === bestScore && !titles.includes(line)) titles.push(line);
    }
  const detailPage = pages.map((lines) => lines.some((line) => VARIANT_LABEL_RE.test(line)));
  return titles.map((title) => {
    const fromPrices: string[] = [];
    const shownPrices: string[] = [];
    let onListing = false;
    pages.forEach((lines, p) =>
      lines.forEach((line, i) => {
        if (line !== title) return;
        if (!detailPage[p]) onListing = true;
        for (const next of lines.slice(i + 1, i + 1 + CARD_WINDOW)) {
          if (next.length >= 40 && !(next.match(PRICE_RE) ?? []).length) break;
          if (CARD_FROM_RE.test(next)) fromPrices.push(...(next.match(PRICE_RE) ?? []));
          if (!detailPage[p]) shownPrices.push(...(next.match(PRICE_RE) ?? []));
        }
      }),
    );
    fromPrices.sort((a, b) => priceValue(a) - priceValue(b));
    return { title, fromPrices, shownPrices, detailOnly: !onListing, text: title };
  });
}

/** Whether the answer's variant is not this card's (colour, length or capacity). */
function otherVariantThan(card: Card, answerVariant: string, beside: string): boolean {
  const cardColours = colours(card.text);
  const saidColours = colours(answerVariant.replace(card.title, ''));
  const cardLengths = lengthsCm(card.text);
  const saidLengths = lengthsCm(beside);
  const cardCaps = capacities(card.text);
  const saidCaps = capacities(beside);
  return (
    (cardColours.size > 0 &&
      saidColours.size > 0 &&
      ![...saidColours].some((c) => cardColours.has(c))) ||
    (cardLengths.length > 0 &&
      saidLengths.length > 0 &&
      !saidLengths.some((l) => cardLengths.some((c) => Math.abs(l - c) <= c * 0.07))) ||
    (cardCaps.size > 0 && saidCaps.size > 0 && ![...saidCaps].some((c) => cardCaps.has(c)))
  );
}

/**
 * Answer prices that are not the searched card's: lower than its 「from」 price with no variant
 * named, or under a variant other than the card's. One contradiction per answer line.
 */
export function searchCardPriceMismatches(summary: string, pageTexts: readonly string[]): string[] {
  const pages = pageTexts.map((page) => page.split('\n').map(lineText).filter(Boolean));
  if (!pages.length) return [];
  const out: string[] = [];
  for (const line of summary.split('\n')) {
    const prices = [...line.matchAll(PRICE_RE)];
    if (!prices.length) continue;
    const at = prices[0]!.index ?? 0;
    const name = line
      .slice(0, at)
      .replace(/^\s*(?:[-*+]|\d+[.)、])\s*/, '')
      .replace(/\*\*/g, '');
    const named = cardsFor(name, pages);
    if (!named.length) continue;
    // A detail page's own heading is not a search card: with a search card among the tied
    // titles, only the search cards count (DEPLOY-60 协调方核对 必须修 2).
    const listed = named.filter((c) => !c.detailOnly);
    const cards = listed.length ? listed : named;
    const card = cards[0]!;
    const beside = besidePrice(line, at);
    const answerVariant = `${name} ${beside}`;
    const shown = prices[0]![0];
    // A variant other than the card's (with tied cards: other than every one of them).
    if (cards.every((c) => otherVariantThan(c, answerVariant, beside))) {
      out.push(
        `答案里「${name.trim().slice(0, 40)}」写的规格和搜索结果那张卡片（「${card.title.slice(0, 60)}」）不是同一款：请用搜索结果里那一款的规格和价格，不能拿商品页上别的规格顶替`,
      );
      continue;
    }
    // Lower than the card's 「from」 price, with no variant named. With tied cards: as soon as one
    // of them shows a 「from」 price, the lowest of those is checked (必须修 2) — unless the price
    // is the one another tied search card shows itself.
    const from = cards
      .map((c) => c.fromPrices.find((p) => priceCurrency(p) === priceCurrency(shown)))
      .filter((p): p is string => Boolean(p))
      .sort((a, b) => priceValue(a) - priceValue(b))[0];
    const ownCardPrice = cards.some((c) =>
      c.shownPrices.some((p) => normalizePrice(p) === normalizePrice(shown)),
    );
    if (
      from &&
      !ownCardPrice &&
      priceValue(shown) < priceValue(from) &&
      !VARIANT_WORD_RE.test(beside.replace(/\boptions?\b|\bfrom\b/gi, ''))
    ) {
      out.push(
        `答案里「${name.trim().slice(0, 40)}」的价格「${shown}」比搜索结果那张卡片上的起价「${from}」还低，又没写是哪个规格：商品页默认选中的规格不一定是搜索到的那一款，请用卡片上的价格，或者写明规格`,
      );
    }
  }
  return out;
}
