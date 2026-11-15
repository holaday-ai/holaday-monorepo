import type { ObservedEvidence } from './completion-fields.js';

/**
 * G2g (BestBuy 「在 BestBuy 搜 usb c cable 告诉我第一个结果」, local A r5sAr1 / abA, screenshot-checked):
 * the answer said the first result 「带有 … Sponsored 标识」 / 「是广告位（Sponsored）商品」 while the
 * 「Sponsored」 on the page belonged to the DJI ad slot above the list, not to that result's card.
 * Not a price rule: a label is the result's only when it is read inside that result's own card.
 *
 * A card is a `listitem` / `article` of the read accessibility tree. The check only speaks when
 * the answer names a card's title, says that result carries an ad label, no card it names has
 * one, and the label is on the page elsewhere — anything it cannot tell is left alone.
 */
const AD_CLAIM_RE = /sponsored|promoted|赞助|广告/i;
/** Anything a card may show as its ad label (wider than the claim, so it judges less). */
const CARD_AD_RE =
  /\bsponsored\b|\bpromoted\b|\badvertisement\b|(?<![a-z])ad(?![a-z])|赞助|广告|推广/i;
/** The clause speaks of the result itself (or names it). */
const RESULT_REF_RE =
  /(?:该|这个|此|本|首个|第一个|第一条|第\s*1\s*个|第\s*1\s*条)(?:搜索)?(?:结果|条目|商品|产品|项)|\bit\b|它/i;
const NEGATED_RE = /(?:不是|并非|没有|没|未|无|非|不带|不含)[^，,。；;]{0,6}$/;
const CARD_RE = /^(\s*)- (?:listitem|article)\b/;
const NAME_RE = /^\s*- (?:link|heading) "((?:[^"\\]|\\.){12,})"/;

interface Card {
  titles: string[];
  text: string;
}

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

function cardsOf(text: string): { cards: Card[]; outside: string } {
  const lines = text.split('\n');
  const cards: Card[] = [];
  const inCard = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const open = CARD_RE.exec(lines[i]!);
    if (!open) continue;
    const indent = open[1]!.length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() && line.length - line.trimStart().length <= indent) break;
      body.push(line);
      inCard.add(j);
    }
    // The innermost card holds a title: an outer list item wrapping cards is not one.
    if (body.some((line) => CARD_RE.test(line))) continue;
    const titles = body.flatMap((line) => {
      const name = NAME_RE.exec(line)?.[1];
      return name ? [norm(name.replace(/\\(.)/g, '$1'))] : [];
    });
    if (titles.length) cards.push({ titles, text: body.join('\n') });
  }
  return { cards, outside: lines.filter((_, i) => !inCard.has(i)).join('\n') };
}

/** Why the answer's ad label is not the result's own, or null when it is (or cannot be told). */
export function misplacedAdLabel(
  summary: string,
  pages: readonly ObservedEvidence[],
): string | null {
  const answer = norm(summary.replace(/\*\*|__/g, ''));
  const clauses = answer.split(/[。！？!?\n；;，,]/);
  const read = pages.map((page) => cardsOf(page.text));
  const named = read.flatMap(({ cards }) =>
    cards.filter((card) => card.titles.some((title) => answer.includes(title))),
  );
  if (!named.length) return null;
  const claim = clauses.find((clause) => {
    const label = AD_CLAIM_RE.exec(clause);
    if (!label || NEGATED_RE.test(clause.slice(0, label.index))) return false;
    return (
      RESULT_REF_RE.test(clause) ||
      named.some((card) => card.titles.some((title) => clause.includes(title)))
    );
  });
  if (!claim) return null;
  if (named.some((card) => CARD_AD_RE.test(card.text))) return null;
  // The label is on the page, outside the cards the answer names (an ad slot, another card).
  const elsewhere = read.some(
    ({ cards, outside }) =>
      CARD_AD_RE.test(outside) ||
      cards.some((card) => !named.includes(card) && CARD_AD_RE.test(card.text)),
  );
  if (!elsewhere) return null;
  const word = /\b(?:sponsored|promoted)\b/i.test(claim)
    ? (/\b(?:Sponsored|Promoted)\b/i.exec(summary)?.[0] ?? 'Sponsored')
    : AD_CLAIM_RE.exec(claim)![0];
  return `答案说该结果带有「${word}」标识，但读到的该结果自己的条目里没有这个标识（页面上它在别的位置，比如上方的广告位或别的条目）`;
}
