/**
 * REBUILD-3: the price answer, written by code from the checked result.
 *
 * Replaces the price post-processing of the free-text answer (name trimming, 原样/原文 notes,
 * repeated price / note / list lines, 「部分完成」 lead stitching, the 未核实 line): each value
 * appears once, in a fixed template per language, with its source link.
 */
import type { PriceLanguage, PriceMissing } from './price-result.js';
import type { VerifiedPriceItem } from './price-verify.js';

export interface PriceRenderInput {
  language: PriceLanguage;
  items: readonly VerifiedPriceItem[];
  missing: readonly PriceMissing[];
  note: string | null;
}

const NAME_HEAD = 56;
const CJK_HEAD = 40;

/** A long product name is cut (never reworded) and marked with 「…」. */
export function shortName(name: string): string {
  const value = name.trim();
  const latin = (value.match(/[A-Za-z0-9]/g) ?? []).length >= value.length / 2;
  const head = latin ? NAME_HEAD : CJK_HEAD;
  if (value.length <= head + 12) return value;
  let cut = value.slice(0, head);
  if (latin) {
    const space = cut.lastIndexOf(' ');
    if (space > head * 0.6) cut = cut.slice(0, space);
  }
  return `${cut.replace(/[\s,，、;；:：\-–—|(（]+$/u, '')}…`;
}

/** A currency amount: a note or reason that names one has not been checked. */
const AMOUNT_RE =
  /(?:S\$|US\$|HK\$|A\$|C\$|NT\$|RM|\$|¥|￥|€|£|(?:SGD|USD|RMB|CNY|HKD|EUR|GBP|JPY|MYR|AUD|CAD)\s?)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:元|块钱|块)/giu;

const HAS_CURRENCY_RE = /[$¥￥€£]|[A-Za-z]{2,}|元/u;

function priceText(item: VerifiedPriceItem['item']): string {
  const price = item.price.trim();
  if (HAS_CURRENCY_RE.test(price) || !item.currency) return price;
  return `${item.currency.trim()} ${price}`;
}

const FIELD_ZH: Record<string, string> = {
  price: '价格',
  variant: '规格',
  name: '名称',
  item: '商品',
  source_url: '链接',
  link: '链接',
  quote: '原文',
};
const FIELD_EN: Record<string, string> = {
  price: 'price',
  variant: 'variant',
  name: 'name',
  item: 'item',
  source_url: 'link',
  link: 'link',
  quote: 'page text',
};

function fieldName(field: string, language: PriceLanguage): string {
  const key = field.trim().toLowerCase();
  return (language === 'en' ? FIELD_EN : FIELD_ZH)[key] ?? field.trim();
}

function withoutAmounts(text: string, language: PriceLanguage): string {
  return text.replace(
    AMOUNT_RE,
    language === 'en' ? '(amount not verified, left out)' : '（金额未核对，已省略）',
  );
}

function lead(missing: readonly PriceMissing[], language: PriceLanguage): string {
  const named = missing
    .slice(0, 3)
    .map((m) =>
      language === 'en'
        ? `the ${fieldName(m.field, language)} of “${shortName(m.item)}”`
        : `「${shortName(m.item)}」的${fieldName(m.field, language)}`,
    );
  const more = missing.length > 3 ? missing.length - 3 : 0;
  if (language === 'en')
    return `Partially completed: not obtained — ${named.join(', ')}${more ? ` and ${more} more` : ''}.`;
  return `部分完成：${named.join('、')}${more ? `等 ${missing.length} 项` : ''}没有拿到。`;
}

/** The delivered answer. `partial` is true when anything asked for is missing. */
export function renderPriceAnswer(input: PriceRenderInput): { summary: string; partial: boolean } {
  const en = input.language === 'en';
  const blocks: string[] = [];
  if (input.missing.length) blocks.push(lead(input.missing, input.language));
  blocks.push(
    input.items
      .map(({ item, sourceUrl }, i) => {
        const variant = item.variant?.trim();
        const head = `${i + 1}. ${shortName(item.name)}${
          variant ? (en ? ` (${variant})` : `（${variant}）`) : ''
        }${en ? ': ' : '：'}${priceText(item)}`;
        return sourceUrl ? `${head}\n   ${en ? 'Source: ' : '来源：'}${sourceUrl}` : head;
      })
      .join('\n'),
  );
  if (input.missing.length)
    blocks.push(
      [
        en ? 'Not obtained:' : '没有拿到：',
        ...input.missing.map(
          (m) =>
            `- ${shortName(m.item)}${en ? ': ' : '：'}${fieldName(m.field, input.language)}${
              m.reason
                ? en
                  ? ` (${withoutAmounts(m.reason, 'en')})`
                  : `（${withoutAmounts(m.reason, 'zh')}）`
                : ''
            }`,
        ),
      ].join('\n'),
    );
  const snippets = input.items.filter((v) => v.unverified === 'search_snippet');
  if (snippets.length)
    blocks.push(
      en
        ? `Unverified: these prices were read only in search result snippets, not on the product page — ${snippets
            .map((v) => `“${shortName(v.item.name)}”`)
            .join('; ')}`
        : `未核实：以下价格只在搜索结果摘要里读到，没有在商品页上核对——${snippets
            .map((v) => `「${shortName(v.item.name)}」`)
            .join('；')}`,
    );
  // The model's note is prose; one that names an amount is not repeated (nothing checked it).
  const note = input.note?.trim();
  if (note && !new RegExp(AMOUNT_RE.source, 'iu').test(note)) blocks.push(note);
  return {
    summary: blocks.filter(Boolean).join('\n\n'),
    partial: input.missing.length > 0,
  };
}

/** No item survived: the failure text, from the missing list. */
export function renderPriceFailure(
  missing: readonly PriceMissing[],
  language: PriceLanguage,
): string {
  const en = language === 'en';
  const lines = missing.map(
    (m) =>
      `- ${shortName(m.item)}${en ? ': ' : '：'}${fieldName(m.field, language)}${
        m.reason
          ? en
            ? ` (${withoutAmounts(m.reason, 'en')})`
            : `（${withoutAmounts(m.reason, 'zh')}）`
          : ''
      }`,
  );
  return [
    en ? 'No price could be obtained from the pages read.' : '没能从读到的页面上拿到价格。',
    ...lines,
  ]
    .join('\n')
    .trim();
}
