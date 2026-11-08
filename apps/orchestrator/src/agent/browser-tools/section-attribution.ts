/**
 * FIX-59 P1-1: a number belongs to the tab or section it sits under on the page.
 *
 * 故宫's Visit.html has two tabs, 「大门票优惠政策」 and 「钟表馆、珍宝馆票价优惠政策」, over a
 * carousel of two numbered lists (学生票 20 元 / 老年人 30·20 元 for the main ticket, 5 元 for the
 * two halls). The carousel keeps a copy of the last list before the first, so the page's text runs:
 * the two tab names, then the 5 元 list, then the 20 元 list, then the 5 元 list again… Read top
 * down, the 5 元 list sits right under 「大门票优惠政策」 — and once an answer gave 「学生票 5 元/人」
 * as the main ticket's.
 *
 * A tab group is a line of 2–6 short tab names (or that many short lines) followed by numbered
 * lists that each restart at 「1.」. With exactly as many lists as names they pair in order; with a
 * carousel's copies around them (the first list repeating the last real one) the copies are dropped
 * first. A price the answer gives is checked against the lists it appears in: the answer has to name
 * that list's tab (its key words: 「钟表馆」「珍宝馆」「大门票」) around it, or — naming none — the
 * price must be the first tab's, the one a page shows as its main.
 */

export interface TabSection {
  title: string;
  /** What the tab is about: 「钟表馆」「珍宝馆」 from 「钟表馆、珍宝馆票价优惠政策」. */
  keys: string[];
  text: string;
}

const NUMBERED_RE = /^(\d{1,2})\s*[.、．]\s*\S/u;
const TAB_NAME_RE = /^[^\s\d。，,；;：:！？!?]{2,20}$/u;
const GENERIC_TAIL_RE =
  /(?:票价|价格|门票价格)?(?:优惠)?(?:政策|说明|须知|信息|介绍|规定|标准)$|(?:票价|价格)$/u;

/** A snapshot line (「- generic [ref=e3]: 大门票优惠政策」, 「- link "导览" [ref=e5]」) or a text line, as text. */
function lineText(line: string): string {
  if (!/^\s*-\s/.test(line)) return line.trim();
  const m = /^\s*-\s+(?:[a-z]+\b)?(?:\s+"([^"]*)")?(?:\s*\[[^\]]*\])*\s*(?::\s*(.*))?$/i.exec(line);
  return (m?.[2] ?? m?.[1] ?? line.replace(/^\s*-\s+/, '')).trim();
}

function keysOf(title: string): string[] {
  const subject = title.replace(GENERIC_TAIL_RE, '').trim() || title;
  return subject
    .split(/[、和及与/／,，]/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function tabNamesAt(
  lines: readonly string[],
  at: number,
): { names: string[]; next: number } | null {
  // The names on one line, apart by spaces (「大门票优惠政策 钟表馆、珍宝馆票价优惠政策」).
  const one = lines[at]!.split(/\s+/u).filter(Boolean);
  if (one.length >= 2 && one.length <= 6 && one.every((name) => TAB_NAME_RE.test(name)))
    return { names: one, next: at + 1 };
  // Or one name per line.
  const names: string[] = [];
  let i = at;
  while (i < lines.length && names.length < 6 && TAB_NAME_RE.test(lines[i]!)) {
    names.push(lines[i]!);
    i += 1;
  }
  return names.length >= 2 ? { names, next: i } : null;
}

function numberedLists(lines: readonly string[], from: number): string[][] {
  const lists: string[][] = [];
  let i = from;
  while (i < lines.length) {
    const first = NUMBERED_RE.exec(lines[i]!);
    if (!first || first[1] !== '1') break;
    const list = [lines[i]!];
    let expect = 2;
    i += 1;
    while (i < lines.length) {
      const m = NUMBERED_RE.exec(lines[i]!);
      if (!m || Number(m[1]) !== expect) break;
      list.push(lines[i]!);
      expect += 1;
      i += 1;
    }
    lists.push(list);
  }
  return lists;
}

/** The page's tab groups, each tab with the list under it. */
export function tabSections(pageText: string): TabSection[][] {
  const lines = pageText.split('\n').map(lineText).filter(Boolean);
  const groups: TabSection[][] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const tabs = tabNamesAt(lines, at);
    if (!tabs) continue;
    const lists = numberedLists(lines, tabs.next);
    const k = tabs.names.length;
    if (lists.length < k) continue;
    const same = (a: string[] | undefined, b: string[] | undefined) =>
      Boolean(a && b) && a!.join('\n') === b!.join('\n');
    // A carousel's copies: the first list repeats the last real one.
    const real =
      lists.length === k ? lists : same(lists[0], lists[k]) ? lists.slice(1, k + 1) : null;
    if (!real || real.length !== k) continue;
    // Two tabs over the same list tell nothing apart.
    if (new Set(real.map((list) => list.join('\n'))).size !== k) continue;
    groups.push(
      tabs.names.map((title, i) => ({ title, keys: keysOf(title), text: real[i]!.join('\n') })),
    );
    at = tabs.next;
  }
  return groups;
}

const ANSWER_PRICE_RE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(元|块)(?:\s*\/\s*人)?/gu;
const HEADING_RE = /^\s*(?:#{1,6}\s+|\*\*[^*]+\*\*\s*[：:]?\s*$|[^\n]{1,30}[：:]\s*$)/u;

const tight = (text: string) => text.replace(/\s+/g, '');
const hasPrice = (text: string, amount: string) =>
  new RegExp(`(?<![\\d.])${amount.replace('.', '\\.')}(?:元|块)`, 'u').test(tight(text));

/**
 * The answer's words around a price: the clause it sits in (复审 #1 必须修 3: a 「；」「。」 or a line
 * break ends it — 「学生票 20 元/人；钟表馆学生票 5 元」 names 钟表馆 only for the 5 元), and the
 * heading over that line.
 */
function contextOf(lines: readonly string[], at: number, index: number): string {
  const line = lines[at]!;
  const start = Math.max(...['；', ';', '。'].map((sep) => line.lastIndexOf(sep, index))) + 1;
  const ends = ['；', ';', '。'].map((sep) => line.indexOf(sep, index)).filter((i) => i >= 0);
  const clause = line.slice(start, ends.length ? Math.min(...ends) : line.length);
  const heading = [...lines.slice(0, at)].reverse().find((one) => HEADING_RE.test(one));
  return `${heading ?? ''}\n${clause}`;
}

/**
 * Prices the answer puts under the wrong tab: one contradiction per price, saying where the page
 * has it.
 */
export function misattributedPrices(summary: string, pageTexts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const lines = summary.split('\n');
  for (const page of pageTexts) {
    const groups = tabSections(page);
    if (!groups.length) continue;
    const inGroups = groups.flat().map((section) => section.text);
    // Outside the tab groups, the page's own text.
    let outside = tight(page);
    for (const text of inGroups) outside = outside.split(tight(text)).join(' ');
    lines.forEach((line, at) => {
      for (const m of line.matchAll(ANSWER_PRICE_RE)) {
        const amount = m[1]!;
        const shown = `${amount}${m[2]}`;
        if (seen.has(shown) || hasPrice(outside, amount)) continue;
        for (const group of groups) {
          const holders = group.filter((section) => hasPrice(section.text, amount));
          if (!holders.length || holders.length === group.length) continue;
          const context = contextOf(lines, at, m.index ?? 0);
          const names = (section: TabSection) => section.keys.some((key) => context.includes(key));
          if (holders.some(names)) continue;
          const other = group.find((section) => !holders.includes(section) && names(section));
          if (!other && holders.includes(group[0]!)) continue;
          seen.add(shown);
          out.push(
            `答案里的「${shown}」在页面上属于「${holders[0]!.title}」这一栏，答案却${
              other
                ? `把它写成了「${other.title}」的`
                : `没写明是这一栏的（读起来像「${group[0]!.title}」的）`
            }：请按数字所在的标签页或小节写清楚是哪一项，或者不写这个数字`,
          );
        }
      }
    });
  }
  return out;
}
