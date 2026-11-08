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
