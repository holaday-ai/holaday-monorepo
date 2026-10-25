/**
 * FIX-36 (Deploy-36 b-n06): the answer said 「下一个交易日是周一（10 月 27 日）」 — the model
 * did the calendar arithmetic itself and got it wrong (Monday was 10-26). The date facts a
 * market / time-sensitive answer may need are given to it, computed here: today in Beijing
 * with its weekday, and the previous / next trading day from the exchange calendar. A
 * calendar that cannot be read gives no trading-day dates, and the model is told not to
 * work them out.
 *
 * `unsupportedDateSentences` is the check after the answer: a month-day the answer states
 * that no read page, the question or these given dates carry is not delivered.
 */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MAX_CALENDAR_PROBE_DAYS = 15;

/** Market words: an answer about them may talk about trading days. */
const MARKET_INTENT_RE =
  /A股|股价|股票|个股|大盘|指数|上证|深证|创业板|科创|沪深|港股|美股|基金|收盘|开盘|休市|交易日|汇率|中间价|\b(?:stock|index|market|nasdaq|nyse)\b/i;

export function marketIntent(intent: string): boolean {
  return MARKET_INTENT_RE.test(intent);
}

/** `YYYY-MM-DD` of `at` in Beijing time. */
export function beijingDay(at: Date): string {
  return new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function shiftDay(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function weekday(iso: string): string {
  return `星期${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;
}

export interface MarketDates {
  today: string;
  todayTrading: boolean | null;
  previousTradingDay: string | null;
  nextTradingDay: string | null;
}

/** The nearest trading day before / after `from` (exclusive); null when the calendar fails. */
async function nearestTradingDay(
  from: string,
  step: 1 | -1,
  isTradingDay: (iso: string) => Promise<boolean | null>,
): Promise<string | null> {
  for (let i = 1; i <= MAX_CALENDAR_PROBE_DAYS; i++) {
    const iso = shiftDay(from, i * step);
    const known = await isTradingDay(iso);
    if (known === null) return null;
    if (known) return iso;
  }
  return null;
}

export async function marketDates(
  now: Date,
  isTradingDay?: (iso: string) => Promise<boolean | null>,
): Promise<MarketDates> {
  const today = beijingDay(now);
  if (!isTradingDay)
    return { today, todayTrading: null, previousTradingDay: null, nextTradingDay: null };
  const todayTrading = await isTradingDay(today).catch(() => null);
  const safe = (iso: string) => isTradingDay(iso).catch(() => null);
  const [previousTradingDay, nextTradingDay] =
    todayTrading === null
      ? [null, null]
      : await Promise.all([nearestTradingDay(today, -1, safe), nearestTradingDay(today, 1, safe)]);
  return { today, todayTrading, previousTradingDay, nextTradingDay };
}

/** The prompt block: given dates, quoted as they are, never worked out by the model. */
export function marketDatePrompt(dates: MarketDates): string {
  const lines = [
    '## 日期与交易日（系统给出，直接引用，不要自己推算）',
    `今天：${dates.today}（${weekday(dates.today)}，北京时间）`,
  ];
  if (dates.todayTrading === null || !dates.previousTradingDay || !dates.nextTradingDay) {
    lines.push(
      '交易日历本次不可用：不要推算上一个或下一个交易日、休市安排，不写这类具体日期；需要时只写「以交易所公告为准」。',
    );
  } else {
    lines.push(
      `今天${dates.todayTrading ? '是' : '不是'}A股交易日。`,
      `上一个交易日：${dates.previousTradingDay}（${weekday(dates.previousTradingDay)}）`,
      `下一个交易日：${dates.nextTradingDay}（${weekday(dates.nextTradingDay)}）`,
    );
  }
  lines.push('回答里出现的日期只能来自抓取正文、用户的问题或上面给出的日期。');
  return lines.join('\n');
}

/**
 * Month-day mentions: 「2026-10-23」「2026年10月23日」「10 月 27 日」. Without a year it needs
 * 月/日 (「10/27」「12.77」「3.5」 are not taken for dates).
 */
const DATE_RE =
  /(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})\s*(?:日|号)?(?![\d:：])/g;

function monthDays(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    // 「10.5%」「3/4」 as a fraction, a version 「1.2」: only a real calendar shape counts.
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const raw = m[0];
    if (!m[1] && !/[月日号]/.test(raw)) continue;
    out.push(`${month}-${day}`);
  }
  return out;
}

/** Date-like text of a page or label, normalised to `M-D` keys. */
export function knownMonthDays(...texts: ReadonlyArray<string | null | undefined>): Set<string> {
  const known = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const key of monthDays(text)) known.add(key);
    // ISO stamps without 年/月 (「2026-10-23 15:00」) are calendar dates too.
    for (const m of text.matchAll(/\b\d{4}-(\d{1,2})-(\d{1,2})\b/g))
      known.add(`${Number(m[1])}-${Number(m[2])}`);
  }
  return known;
}

/**
 * Sentences of `answer` that state a month-day none of `known` carries. Sentences end at
 * 。！？；, a line break or a list item.
 */
export function unsupportedDateSentences(answer: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const sentence of answer.split(/(?<=[。！？；!?])|\n/)) {
    if (monthDays(sentence).some((key) => !known.has(key))) out.push(sentence);
  }
  return out.filter((s) => s.trim());
}

/** `answer` without those sentences (and without a paragraph they leave empty). */
export function withoutSentences(answer: string, sentences: readonly string[]): string {
  let out = answer;
  for (const sentence of sentences) out = out.replace(sentence, '');
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keys of the dates the system gave the model. */
export function givenMonthDays(dates: MarketDates): string[] {
  return [dates.today, dates.previousTradingDay, dates.nextTradingDay]
    .filter((iso): iso is string => !!iso)
    .map((iso) => `${Number(iso.slice(5, 7))}-${Number(iso.slice(8, 10))}`);
}
