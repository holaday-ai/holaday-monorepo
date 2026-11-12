/**
 * REBUILD-2 bench a1 ruling (live-sh, red line): the web-search interface returned the 11-09 close
 * of the Shanghai index and the answer called it the value 「截至北京时间 13:15 左右」 — 13:15 was
 * the retrieval time printed on every result row, not the data's.
 *
 * For a time-sensitive question (quotes, indices, rates, weather, news, 「现在 / 今天 / 实时」) an
 * interface answer is delivered only when
 *  - the results themselves (retrieval lines left out) carry a date inside the window: today for
 *    quotes and rates, today or later for weather, today or yesterday for news;
 *  - every date and clock time the answer states occurs in those results.
 * Otherwise the task goes to the browser for the live page (the caller says what was found).
 */

/** Quotes, indices, rates, weather, news, and any 「now」 wording. */
const TIME_SENSITIVE_RE =
  /股价|股票|行情|报价|指数|点位|大盘|上证|深证|沪深|创业板|恒生|纳斯达克|道琼斯|标普|涨了|跌了|涨跌|涨幅|跌幅|汇率|兑换|换多少|美元|人民币|欧元|日元|英镑|港币|金价|油价|天气|气温|下雨|降雨|温度|新闻|快讯|资讯|头条|现在|此刻|目前|当前|实时|今天|今日|最新|\b(?:stock|share price|quote|index|exchange rate|forex|weather|forecast|news|headlines?|now|today|current(?:ly)?|latest|live)\b/iu;
const WEATHER_RE = /天气|气温|下雨|降雨|温度|\bweather\b|\bforecast\b/iu;
const NEWS_RE = /新闻|快讯|资讯|头条|\bnews\b|\bheadlines?\b/iu;

export function isTimeSensitive(intent: string): boolean {
  return TIME_SENSITIVE_RE.test(intent);
}

/** Retrieval lines the interface lane prints on every row: they are no data time. */
const RETRIEVAL_LINE_RE = /^.*(?:检索于|检索时间|来源：|Source:|Retrieved).*$/gimu;

const DAY_MS = 86_400_000;

/** Beijing calendar date of `at` as YYYY-MM-DD. */
export function beijingDate(at: Date): string {
  return new Date(at.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Dates a text states (YYYY-MM-DD, 2026年11月12日, 11月12日, 11/12), as YYYY-MM-DD. */
export function datesIn(text: string, now: Date): Set<string> {
  const year = Number(beijingDate(now).slice(0, 4));
  const out = new Set<string>();
  const add = (y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.add(`${y}-${pad(m)}-${pad(d)}`);
  };
  for (const m of text.matchAll(/(20\d{2})[-/.年]\s?(\d{1,2})[-/.月]\s?(\d{1,2})日?/gu))
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/(?<![\d年/.-])(\d{1,2})月(\d{1,2})[日号]/gu))
    add(year, Number(m[1]), Number(m[2]));
  for (const m of text.matchAll(/(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?![\d/])/gu))
    add(year, Number(m[1]), Number(m[2]));
  return out;
}

/** Clock times a text states: 13:15, 13：15, 13点15分. */
export function clockTimesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)([01]?\d|2[0-3])\s?[:：]\s?([0-5]\d)(?![\d])/gu))
    out.add(`${Number(m[1])}:${m[2]}`);
  for (const m of text.matchAll(/(?<!\d)([01]?\d|2[0-3])点([0-5]\d)分/gu))
    out.add(`${Number(m[1])}:${m[2]}`);
  return out;
}

export type FreshnessProblem =
  | { kind: 'stale'; latest: string | null }
  | { kind: 'unsupported_time'; stated: string };

/**
 * Whether an interface answer to a time-sensitive question may be delivered. `results` is the text
 * the interface returned (its rows), `answer` the answer written from it.
 */
export function freshnessProblem(input: {
  intent: string;
  answer: string;
  results: string;
  now?: Date;
}): FreshnessProblem | null {
  if (!isTimeSensitive(input.intent)) return null;
  const now = input.now ?? new Date();
  const data = input.results.replace(RETRIEVAL_LINE_RE, '');
  const today = beijingDate(now);
  const yesterday = beijingDate(new Date(now.getTime() - DAY_MS));
  const dates = [...datesIn(data, now)].sort();
  const weather = WEATHER_RE.test(input.intent);
  const news = NEWS_RE.test(input.intent);
  const fresh = dates.some((d) =>
    weather ? d >= today : news ? d === today || d === yesterday : d === today,
  );
  if (!fresh) return { kind: 'stale', latest: dates.at(-1) ?? null };
  const answer = input.answer.replace(RETRIEVAL_LINE_RE, '');
  const dataDates = new Set(dates);
  // Relative words are the reader's anchor; the dates and times written must be the data's.
  for (const d of datesIn(answer, now))
    if (!dataDates.has(d) && d !== today) return { kind: 'unsupported_time', stated: d };
  const dataTimes = clockTimesIn(data);
  for (const t of clockTimesIn(answer))
    if (!dataTimes.has(t)) return { kind: 'unsupported_time', stated: t };
  return null;
}

/** What the person is told when the task goes to the browser for the live page. */
export function freshnessHandover(problem: FreshnessProblem): string {
  if (problem.kind === 'stale') {
    const latest = problem.latest
      ? `${Number(problem.latest.slice(5, 7))} 月 ${Number(problem.latest.slice(8, 10))} 日`
      : null;
    return latest
      ? `接口最新只查到 ${latest}的数据，已自动改用云端浏览器去页面上取实时数`
      : '接口查到的数据没有写明日期，已自动改用云端浏览器去页面上取实时数';
  }
  return '接口结果里没有答案写的那个时间，已自动改用云端浏览器去页面上取实时数';
}
