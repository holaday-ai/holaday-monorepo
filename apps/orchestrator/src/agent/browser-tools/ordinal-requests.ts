/**
 * BROWSER-AUTOPILOT-3 — integrity for counted and ordinal requests.
 *
 * "前5个视频标题" asks for exactly five items: an answer listing four is not
 * complete (Deploy-21 core-04). "总结第3节" names one section of the article
 * body: an answer about another section is wrong (Deploy-21 core-06). Both are
 * read from the user's own words and checked deterministically.
 */

const DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const NUMBER = '\\d{1,3}|[一二两三四五六七八九十]{1,3}';

/** "5" / "五" / "十二" / "二十" → number. */
export function parseCount(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^[一二两三四五六七八九十]{1,3}$/.test(value)) return null;
  const at = value.indexOf('十');
  if (at < 0) return value.length === 1 ? (DIGITS[value] ?? null) : null;
  const tens = at === 0 ? 1 : (DIGITS[value[0]!] ?? null);
  const ones = at === value.length - 1 ? 0 : (DIGITS[value[at + 1]!] ?? null);
  return tens === null || ones === null ? null : tens * 10 + ones;
}

const UNIT = '个|条|项|篇|名|位|款|家|部|首|本|张|则|件|只|支|集|段视频';
const COUNT_PATTERNS = [
  new RegExp(`前\\s*(${NUMBER})\\s*(?:${UNIT})`, 'u'),
  new RegExp(
    `(?:返回|列出|给出|给我|找出|找|获取|提取|读取|列举|推荐|搜集|收集|整理|挑选|选出|抓取|汇总)\\s*(?:出)?\\s*(${NUMBER})\\s*(?:${UNIT})`,
    'u',
  ),
  /\b(?:top|first)\s+(\d{1,3})\b/i,
];

/** The number of items the user asked for, or null when none is stated. */
export function requestedCount(intent: string): number | null {
  for (const pattern of COUNT_PATTERNS) {
    const match = intent.match(pattern);
    const count = match ? parseCount(match[1]!) : null;
    if (count !== null && count >= 2 && count <= 100) return count;
  }
  return null;
}

/**
 * How many items the answer lists: the longest numbered run 1, 2, 3 … (one
 * per line, or "1) … 2) …" inline), else an explicit admission such as
 * "只找到4个". Null when the answer has no countable list.
 */
export function answerCount(summary: string): number | null {
  const numbers = [
    ...summary.matchAll(/(?:^|\n|\s)[(（]?(\d{1,3})\s*(?:[.、)）．:：](?!\d))\s*\S/gu),
  ].map((match) => Number(match[1]));
  let best = 0;
  let run = 0;
  for (const value of numbers) {
    if (value === 1) run = 1;
    else if (value === run + 1) run += 1;
    else continue;
    best = Math.max(best, run);
  }
  if (best >= 1) return best;
  const admitted = summary.match(
    new RegExp(
      `(?:只|仅)(?:找到|获取到?|列出|读取到|读到|有|返回|拿到)了?\\s*(${NUMBER})\\s*(?:${UNIT})`,
      'u',
    ),
  );
  return admitted ? parseCount(admitted[1]!) : null;
}

const SECTION_UNIT = '节|章|部分|小节';

/** "总结第3节" → 3. */
export function requestedSection(intent: string): number | null {
  const match =
    intent.match(new RegExp(`第\\s*(${NUMBER})\\s*(?:${SECTION_UNIT})`, 'u')) ??
    intent.match(/\bsection\s+(\d{1,3})\b/i) ??
    intent.match(/\b(\d{1,3})(?:st|nd|rd|th)\s+section\b/i);
  const value = match ? parseCount(match[1]!) : null;
  return value !== null && value >= 1 && value <= 120 ? value : null;
}

const norm = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

/**
 * Checks the answer's claim about section `n` against the body outline
 * (top-level titles in order, then any subsection titles).
 * - ok: the answer names the correct section title;
 * - mismatch: next to its "第N节" / "章节标题" claim it names another title;
 * - unknown: it names no section title, so there is nothing to compare.
 */
export function checkSectionClaim(
  summary: string,
  n: number,
  topTitles: string[],
  otherTitles: string[] = [],
): { verdict: 'ok' | 'unknown' } | { verdict: 'mismatch'; claimed: string; expected: string } {
  const expected = topTitles[n - 1];
  if (!expected) return { verdict: 'unknown' };
  const wanted = norm(expected);
  if (wanted && norm(summary).includes(wanted)) return { verdict: 'ok' };
  const others = [...topTitles, ...otherTitles].filter((title) => {
    const value = norm(title);
    return value.length >= 2 && value !== wanted;
  });
  const claims = new RegExp(
    `第\\s*(?:${NUMBER})\\s*(?:${SECTION_UNIT}|个\\s*(?:H2\\s*)?章节|个\\s*H2)|章节(?:标题|名称|名)?\\s*[:：为是]|\\bsection\\s+\\d+\\b|section\\s+(?:title|heading)`,
    'giu',
  );
  for (const match of summary.matchAll(claims)) {
    const window = norm(summary.slice(match.index!, match.index! + match[0].length + 60));
    // The title closest to the claim marker is the one being claimed.
    let claimed: { title: string; at: number } | null = null;
    for (const title of others) {
      const at = window.indexOf(norm(title));
      if (at >= 0 && (!claimed || at < claimed.at)) claimed = { title, at };
    }
    if (claimed) return { verdict: 'mismatch', claimed: claimed.title, expected };
  }
  return { verdict: 'unknown' };
}
