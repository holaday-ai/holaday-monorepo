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

/**
 * FIX-50 (Deploy-50 core-10, the rollback): 「该页包含一个 iframe，内容为跨源错误页」, delivered as
 * completed — the iframe held 「Your content goes here.」 and the run never read it. What an answer
 * says is inside an iframe has to be what the run read from that frame.
 */
export type FrameRead = { key: string; sourceURL?: string; text: string };

/** The main frame's own id in a read (to tell a child-frame read by frameId from it). */
export function readFrameId(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as { frameId?: unknown };
    return typeof value.frameId === 'string' ? value.frameId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The frames a read actually read: a child frame read by its own frameId (`child`), or the
 * same-origin child frames a main-frame snapshot reads inline (`frames[].tree`). A frame listed
 * only with a limitation (跨源 / 尚未就绪 / 超过预算) was not read.
 */
export function frameReadsOf(text: string, child: boolean): FrameRead[] {
  let value: {
    frameId?: unknown;
    sourceURL?: unknown;
    tree?: unknown;
    text?: unknown;
    frames?: unknown;
  };
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const url = (item: { sourceURL?: unknown }) =>
    typeof item.sourceURL === 'string' ? item.sourceURL : undefined;
  if (child) {
    const read = typeof value.tree === 'string' ? value.tree : value.text;
    return typeof value.frameId === 'string' && typeof read === 'string'
      ? [{ key: value.frameId, sourceURL: url(value), text: read }]
      : [];
  }
  return (Array.isArray(value.frames) ? value.frames : []).flatMap((item) =>
    item && typeof item.frameId === 'string' && typeof item.tree === 'string'
      ? [{ key: item.frameId, sourceURL: url(item), text: item.tree }]
      : [],
  );
}

/** A read main frame that lists child frames, read or not (an iframe is on the page). */
export function listsFrames(text: string): boolean {
  try {
    const value = JSON.parse(text) as { frames?: unknown };
    return Array.isArray(value.frames) && value.frames.length > 0;
  } catch {
    return false;
  }
}

/** A frame whose document is an error page: not a read of its content. */
const FRAME_ERROR_RE =
  /application error|an error occurred in the application|this page isn[’']t working|refused to connect|拒绝了.{0,6}连接|无法访问此网站|404 not found|502 bad gateway|503 service unavailable/i;
const FRAME_ERROR_URL_RE =
  /^(?:chrome-error|edge-error|about:neterror)|herokucdn\.com\/error-pages/i;

function frameErrored(read: FrameRead): boolean {
  return FRAME_ERROR_RE.test(read.text) || FRAME_ERROR_URL_RE.test(read.sourceURL ?? '');
}

/** The page text of a frame read: names and text, without roles, refs or other annotations. */
function framePieces(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line) => {
      const bare = line.replace(/\[[^\]]*\]/g, ' ').trim();
      const role = bare.match(/^-\s*[\w-]+(?:\s+"((?:[^"\\]|\\.)*)")?\s*(?::\s*(.*))?$/);
      if (!role) return [bare];
      return [role[1] ?? '', (role[2] ?? '').replace(/^"|"$/g, '')];
    })
    .map((piece) => piece.replace(/\s+/g, ' ').trim())
    .filter((piece) => /[\p{L}\p{N}]/u.test(piece) && !/^(?:-\s*)?\/url:/.test(piece));
}

const IFRAME_WORD_RE = /iframe|i-frame|内嵌框架|嵌入(?:的)?框架|内联框架|子框架|框架(?:内|中|里)/i;
/** 「内容为…」「显示…」「写着…」: what the iframe holds, said as fact. */
const CONTENT_CLAIM_RE =
  /(?:内容|文本|文字|正文)\s*(?:为|是|显示为?|写着|[:：])|显示(?:为|的是|着)?|写着|里面是|内有|呈现/;
/** 「iframe 为空」「iframe 是空白的」: an empty frame, said as such. */
const BLANK_CLAIM_RE =
  /(?:iframe|框架)[^。！？；;\n]{0,16}?(?:为空|是空的|空白|没有(?:任何)?(?:文字|文本|内容)|无内容|内容为空)|\bempty\b/i;
/** 「跨源错误页」「无法加载」: an iframe said to hold an error, not content. */
const ERROR_CLAIM_RE = /跨源|跨域|错误|报错|error|无法(?:加载|显示|读取|访问)|加载失败|拒绝/i;
/** 「iframe 内容没有读到」: the answer itself says the frame was not read. */
const NOT_READ_RE =
  /没(?:有)?(?:读|读取)到|未(?:能)?读(?:取)?到|无法读(?:取)?|未读取|没有读取|读不到/;

const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

export type FrameGap =
  | { kind: 'unread' }
  | { kind: 'mismatch'; read: string }
  | { kind: 'unstated'; read: string };

/**
 * An answer's account of an iframe, held against the frames the run read (the latest read of
 * each; a page that failed and was reopened counts by its last good read).
 * - `unread`: the iframe is asked for, or its content described, and no frame was read (or only an
 *   error page) — no description of it can be right.
 * - `mismatch`: it is described as empty, as an error, or by a quote, and the reads say otherwise.
 * - `unstated`: the iframe is asked for, a frame was read, and the answer says nothing of it.
 */
export function iframeContentGap(
  intent: string,
  answer: string,
  reads: readonly FrameRead[],
  framesSeen: boolean,
  pageTexts: readonly string[] = [],
): FrameGap | null {
  const asked = IFRAME_WORD_RE.test(intent);
  const claims = iframeWindows(answer).map((window) => {
    const verb = window.search(CONTENT_CLAIM_RE);
    return {
      blank: BLANK_CLAIM_RE.test(window),
      claim: verb < 0 ? '' : window.slice(verb).replace(CONTENT_CLAIM_RE, '').trim(),
      quotes: [...window.matchAll(QUOTE_RE)].map((m) => normal(m[1]!)),
      notRead: NOT_READ_RE.test(window),
    };
  });
  const said = claims.filter(
    (c) => !c.notRead && (c.blank || c.quotes.length > 0 || c.claim.length > 0),
  );
  const pageText = normal(pageTexts.join(' '));
  const good = reads.filter((read) => !frameErrored(read));
  if (!good.length) {
    // No frame read: a quote holds when a read page has it word for word (a reader that puts a
    // frame's text in the page's own read, without frame records); an error or a 「为空」 never
    // holds; other words hold only where no frame was listed unread (nothing to hold them to).
    const unread = said.some((c) =>
      c.quotes.length
        ? c.quotes.some((q) => !pageText.includes(q))
        : c.blank ||
          ERROR_CLAIM_RE.test(c.claim) ||
          (framesSeen && !pageText.includes(normal(c.claim))),
    );
    // An iframe the page lists and the question asks for, never read: nothing said of it holds.
    return unread || (asked && framesSeen) ? { kind: 'unread' } : null;
  }
  const pieces = good.flatMap((read) => framePieces(read.text));
  // The last good read stands (a page that failed and was reopened).
  const shown = framePieces(good.at(-1)!.text).join(' ').slice(0, 160);
  const readText = normal(pieces.join(' '));
  for (const c of said) {
    if (c.blank) {
      if (shown) return { kind: 'mismatch', read: shown };
      continue;
    }
    if (c.quotes.some((q) => !readText.includes(q) && !pageText.includes(q)))
      return { kind: 'mismatch', read: shown };
    if (!c.quotes.length && ERROR_CLAIM_RE.test(c.claim)) return { kind: 'mismatch', read: shown };
  }
  if (!asked) return null;
  if (!shown) return said.some((c) => c.blank) ? null : { kind: 'unstated', read: '' };
  const lower = normal(answer).replace(/[“”「」『』"]/g, '');
  const stated = pieces.some(
    (piece) => piece.length >= 4 && lower.includes(normal(piece).replace(/[.。!！]$/, '')),
  );
  return stated ? null : { kind: 'unstated', read: shown };
}

/**
 * Where an answer speaks of an iframe: from each mention, its clause and the next one
 * (「该页包含一个 iframe，内容为…」), unless the next one moves on (「，并导航至 /javascript_alerts…」).
 */
function iframeWindows(answer: string): string[] {
  return answer.split(/[。！？!?；;\n]/).flatMap((sentence) =>
    [...sentence.matchAll(new RegExp(IFRAME_WORD_RE.source, 'gi'))].map((m) => {
      const [own = '', next = ''] = sentence.slice(m.index).split(/[，,]/);
      return /^\s*(?:并|然后|接着|随后|再|之后|另外|同时|and\b|then\b)/i.test(next)
        ? own
        : `${own}，${next}`;
    }),
  );
}
