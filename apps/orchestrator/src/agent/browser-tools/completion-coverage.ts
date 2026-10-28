/**
 * FIX-30 — two answer checks the page facts do not cover.
 *
 * Deploy-30 core-10: 「the-internet.herokuapp.com 的 iframe 与 JavaScript alerts」
 * was delivered with the alerts only — the iframe never opened, never mentioned.
 * Each named target (Latin names joined by 与/和/及 in a Chinese request) must be in
 * the answer; English "and" joins too much ordinary prose to be read this way.
 *
 * BENCH-1 n03: 「最近一周关于 OpenAI 的新闻」 answered with one item from months
 * before. When every date the answer gives is far outside the asked window, it is
 * not the asked content.
 */
const TARGET = String.raw`[A-Za-z][\w.\-/]*(?:\s+[A-Za-z][\w.\-/]*){0,3}`;
const JOINED_RE = new RegExp(`(${TARGET})\\s*(?:与|和|及|以及|跟)\\s*(${TARGET})`, 'g');
const FILLER = /^(?:the|a|an|of|on|in|page|pages|site)$/i;

export function namedTargets(intent: string): string[] {
  const out: string[] = [];
  const text = intent.replace(/https?:\/\/\S+/g, ' ');
  for (const m of text.matchAll(JOINED_RE)) {
    for (const raw of [m[1]!, m[2]!]) {
      const words = raw.split(/\s+/).filter((w) => !FILLER.test(w));
      if (words.length) out.push(words.join(' '));
    }
  }
  return [...new Set(out.map((t) => t.trim()).filter((t) => t.length >= 3))];
}

/** Common names an answer writes in Chinese (「Google 和 Apple 的市值」 → 谷歌/苹果). */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  google: ['谷歌', 'alphabet'],
  apple: ['苹果'],
  microsoft: ['微软'],
  amazon: ['亚马逊'],
  tesla: ['特斯拉'],
  meta: ['facebook', '脸书'],
  nvidia: ['英伟达'],
  netflix: ['奈飞', '网飞'],
  openai: ['open ai'],
  samsung: ['三星'],
  intel: ['英特尔'],
  alibaba: ['阿里巴巴', '阿里'],
  tencent: ['腾讯'],
  baidu: ['百度'],
  youtube: ['油管'],
  wikipedia: ['维基百科', '维基'],
};

/** A target named by its own words, an alias, or its last word's stem (alerts → alert). */
function mentions(text: string, target: string): boolean {
  const lower = text.toLowerCase();
  const t = target.toLowerCase();
  if (lower.includes(t)) return true;
  if ((ALIASES[t] ?? []).some((alias) => lower.includes(alias))) return true;
  const last = t.split(/\s+/).at(-1)!.replace(/s$/, '');
  return last.length >= 4 && lower.includes(last);
}

/** 「iframe 部分未完成」「没能打开 iframe 页」: the part is said to be not done. */
function saidNotDone(answer: string, target: string): boolean {
  const lower = answer.toLowerCase();
  const at = lower.indexOf(target.toLowerCase().split(/\s+/)[0]!);
  if (at < 0) return false;
  // 「该页面本身不包含 iframe」: said to be absent, not claimed as checked.
  if (
    /(?:不包含|未包含|不含|并无|并没有|没有)\s*(?:任何)?\s*$/.test(
      lower.slice(Math.max(0, at - 8), at),
    )
  )
    return true;
  const around = lower.slice(Math.max(0, at - 24), at + target.length + 24);
  return /未完成|没有完成|没完成|未能|没能|无法完成|无法打开|无法读取|做不到|跳过|没有做|未做|not (?:done|completed|opened)|could not|couldn't|skipped/.test(
    around,
  );
}

const QUOTE_RE = /["“「『]([^"”」』\n]{4,120})["”」』]/g;

/**
 * The answer quotes, in a sentence about the target, text found on a read page —
 * an iframe's own content is read through its frame, where the word 「iframe」
 * itself is not in the text.
 */
function quotedFromPage(answer: string, target: string, pageText: string): boolean {
  return answer
    .split(/[。；;\n]/)
    .filter((sentence) => mentions(sentence, target))
    .some((sentence) =>
      [...sentence.matchAll(QUOTE_RE)].some((m) =>
        pageText.includes(m[1]!.trim().replace(/\s+/g, ' ').toLowerCase()),
      ),
    );
}

export type TargetGap = { target: string; kind: 'missing' | 'unread' };

/**
 * Each named target is in the answer — and either in a page the run read (its
 * text or address) or said to be not done. core-10 (FIX-30 f30c) wrote 「iframe 与
 * JavaScript alerts … 均已验证通过」 having opened only the alerts page.
 */
export function uncoveredTargets(
  intent: string,
  answer: string,
  pages?: readonly { text: string; sourceURL?: string }[],
): TargetGap[] {
  const gaps: TargetGap[] = [];
  // With next to no recorded page text, absence from it proves nothing.
  const read = pages?.some((page) => page.text.trim().length >= 40) ? pages : undefined;
  const pageText = (read ?? [])
    .map((page) => page.text)
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  for (const target of namedTargets(intent)) {
    if (!mentions(answer, target)) gaps.push({ target, kind: 'missing' });
    else if (
      read &&
      !saidNotDone(answer, target) &&
      !read.some((page) => mentions(`${page.text} ${page.sourceURL ?? ''}`, target)) &&
      !quotedFromPage(answer, target, pageText)
    )
      gaps.push({ target, kind: 'unread' });
  }
  return gaps;
}

/**
 * FIX-45 (local A/B core-10 B: 「该页面不包含 iframe；…本次仅按用户明确要求的 JavaScript alerts 交互
 * 执行」, delivered as completed): a named target the answer itself says was not done, and that
 * no page the run read has. Honest, so no contradiction — but no completed answer either.
 */
export function declinedTargets(
  intent: string,
  answer: string,
  pages?: readonly { text: string; sourceURL?: string }[],
): string[] {
  return namedTargets(intent).filter(
    (target) =>
      mentions(answer, target) &&
      saidNotDone(answer, target) &&
      !(pages ?? []).some((page) => mentions(`${page.text} ${page.sourceURL ?? ''}`, target)),
  );
}

const RECENT: Array<[RegExp, number]> = [
  [/今天|今日|\btoday\b/i, 3],
  [
    /最近一周|近一周|本周|这周|过去一周|最近7天|近7天|\bthis week\b|\bpast week\b|\blast 7 days\b/i,
    14,
  ],
  [/最近一个月|近一个月|本月|这个月|\bthis month\b|\bpast month\b/i, 45],
];
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

function datedSpans(text: string): Array<{ date: Date; index: number }> {
  const out: Array<{ date: Date; index: number }> = [];
  const push = (y: number, m: number, d: number, index: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ date, index });
  };
  for (const m of text.matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g))
    push(Number(m[1]), Number(m[2]), Number(m[3]), m.index);
  for (const m of text.matchAll(
    new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, 'gi'),
  ))
    push(
      Number(m[3]),
      MONTHS.split('|').indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1,
      Number(m[2]),
      m.index,
    );
  for (const m of text.matchAll(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})[a-z]*\\.?\\s+(20\\d{2})\\b`, 'gi'),
  ))
    push(
      Number(m[3]),
      MONTHS.split('|').indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1,
      Number(m[1]),
      m.index,
    );
  return out;
}

export function answerDates(answer: string): Date[] {
  return datedSpans(answer).map((span) => span.date);
}

/**
 * Dates the answer gives as an item's own date — 「（2025-08-07）」「· 2025-08-08」
 * 「发布于 …」「Published Oct 19, 2026」 or leading an item — not a date the item
 * talks about (「回顾 2024年3月5日 的发布会」).
 */
function publicationDates(answer: string): Date[] {
  return datedSpans(answer)
    .filter(({ index }) => {
      const before = answer.slice(Math.max(0, index - 12), index);
      return (
        /(?:发布|发表|更新|日期|时间|published|posted|updated|date)\s*(?:于|在|时间|日期)?\s*[:：]?\s*$/i.test(
          before,
        ) ||
        /[（(\[·|—–]\s*$|\s[-–]\s*$/.test(before) ||
        /(?:^|\n)\s*(?:[-*•]|\d+[.)、])?\s*$/.test(before)
      );
    })
    .map((span) => span.date);
}

/** Every dated item is older than the asked window (with slack): not recent content. */
export function staleForRecentIntent(
  intent: string,
  answer: string,
  now = new Date(),
  /** The read pages: their newest date is "now" for the asked window, when they have one. */
  pageTexts: readonly string[] = [],
): string | null {
  const window = RECENT.find(([re]) => re.test(intent));
  if (!window) return null;
  // Only an item's own date can show it is old; a date it discusses cannot.
  const dates = publicationDates(answer);
  if (!dates.length) return null;
  const pageDates = pageTexts.flatMap((text) => answerDates(text));
  const anchor = pageDates.length
    ? Math.min(now.getTime(), Math.max(...pageDates.map((d) => d.getTime())))
    : now.getTime();
  const limit = anchor - window[1] * 86_400_000;
  if (dates.some((d) => d.getTime() >= limit)) return null;
  const newest = new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10);
  return `问的是「${intent.match(window[0])![0]}」的内容，但答案里最新的日期是 ${newest}，都不在这个时间范围内；只给这个时间范围内的内容，没有就如实说明`;
}
