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
import { logger } from '../../config/logger.js';

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

/**
 * DEPLOY-51 review #1 (#2): the main frame a read is of — its id, URL and the child frames it lists
 * (when it lists them) — to tell which earlier frame reads a reload left behind.
 */
export function mainFrameOf(
  text: string,
): { id: string; url?: string; listed?: string[] } | undefined {
  try {
    const value = JSON.parse(text) as { frameId?: unknown; sourceURL?: unknown; frames?: unknown };
    if (typeof value.frameId !== 'string') return undefined;
    return {
      id: value.frameId,
      url: typeof value.sourceURL === 'string' ? value.sourceURL : undefined,
      listed: Array.isArray(value.frames)
        ? value.frames.flatMap((item) =>
            item && typeof item.frameId === 'string' ? [item.frameId as string] : [],
          )
        : undefined,
    };
  } catch {
    return undefined;
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

/**
 * DEPLOY-51 review #1: 「框架中」 alone is not an iframe (「Next.js 框架中」「欧盟监管框架中」); a
 * 框架 counts only as 子框架 / 内联框架 / 第二个框架, or after 内嵌 / 嵌入 (not 嵌入式).
 */
const IFRAME_WORD_RE =
  /iframe|i-frame|内联框架|子框架|(?:内嵌|嵌入(?!式))[^。，,；;\n]{0,8}?框架|第[一二两三四五六七八九十\d]+个框架/i;
/** 「内容为…」「显示…」「写着…」「iframe：…」: what the iframe holds, said as fact. */
const CONTENT_CLAIM_RE =
  /(?:内容|文本|文字|正文|(?<!标题)原文)\s*(?:为|是|显示为?|写着|[:：])|显示了?(?:为|的是|着)?|写着|里面是|内有|呈现|还有|另有|^(?:i-?frame|[^\s，,]*框架)\s*(?:中|里|内)?\s*[:：]/i;
/** 「iframe：…」: a label, and the sentence after it may have the verb (「iframe：读取到的文本内容为…」). */
const FRAME_LABEL_RE = /^(?:i-?frame|[^\s，,]*框架)\s*(?:中|里|内)?\s*[:：]/i;
/**
 * FIX-51 复审 #1: asked for, 「有」「含」「看到」 and English say what an iframe holds too, in the clause
 * with the iframe as its subject. Only then: of an iframe nobody asked about, 「iframe 有广告」 stays a
 * remark; and 「…/iframe，read_page 返回的列表包含…」 is not about it.
 */
const ASKED_CLAIM_RE = new RegExp(
  String.raw`${CONTENT_CLAIM_RE.source}|另含|含有?|包含|嵌[着有]|存在|看到|见到|(?<!不)可见(?=\s*[^\s，,。；;]{2})|(?<![没所具拥未])有(?![效关时些])|\b(?:contains?|shows?|displays?|has|have|includes?|reads|says)\b|\b(?:content|contents|text)\s+(?:is|are|reads|says)\b|\b(?:text|contents?)\b\s*(?=["“「:：])`,
  'i',
);
/**
 * Between an iframe and the verb, when the task did not ask for it: the iframe is the subject
 * (「广告 iframe 显示…」「iframe（编辑器）里的内容为…」), not 「iframe 下方的价格显示为…」.
 */
const SUBJECT_GAP_RE = /^\s*(?:[（(][^）)]{0,40}[）)])?\s*(?:中|里面?|内|上)?的?\s*$/;
/** 「iframe 为空」「iframe 是空白的」: an empty frame, said as such. */
const BLANK_CLAIM_RE =
  /(?:iframe|框架)[^。！？；;\n]{0,16}?(?:为空|是空的|空白|没有(?:任何)?(?:文字|文本|内容)|无内容|内容为空)|\bempty\b/i;
/** 「跨源错误页」「无法加载」: an iframe said to hold an error, not content. */
const ERROR_CLAIM_RE =
  /(?<![无未没]|没有|\bno\s|\bwithout\s)(?:跨源|跨域|错误|报错|errors?\b|无法(?:加载|显示|读取|访问)|加载失败|拒绝)/i;
/** 「iframe 内容没有读到」: the answer itself says the frame was not read. */
const NOT_READ_RE =
  /没(?:有)?(?:读|读取)到|未(?:能)?读(?:取)?到|无法读(?:取)?|未读取|没有读取|读不到/;

const normal = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const bare = (text: string) =>
  normal(text)
    .replace(/^[\s:：,，。.、"“”「」『』]+/, '')
    .replace(/[\s.。!！?？,，;；:："“”「」『』]+$/, '');
/** A quote of what a frame holds, however short (PR #314 review: a frame reading 「你好」). */
const FRAME_QUOTE_RE = /["“「『]([^"”」』\n]{1,120})["”」』]/g;
/** Length with a Han character counting as two letters. */
const weight = (text: string) => text.length + (text.match(/\p{Script=Han}/gu)?.length ?? 0);

/**
 * DEPLOY-51 review #1 (#5): kinds of iframe an answer names, and how a read frame shows it is
 * one — so the editor's text is not taken from the ad frame.
 */
const FRAME_KINDS: ReadonlyArray<readonly [RegExp, RegExp]> = [
  [
    /编辑器|editor|tinymce|富文本|wysiwyg/i,
    /editor|rich text|tinymce|wysiwyg|\bmce\b|contenteditable/i,
  ],
  [
    /广告|\bads?\b|advert/i,
    /\bads?\b|ads\.|advert|doubleclick|googlesyndication|adservice|sponsor|广告/i,
  ],
  [
    /视频|播放器|video|player|youtube|vimeo|bilibili|b站/i,
    /video|player|youtube|vimeo|bilibili|youku/i,
  ],
  [/地图|\bmaps?\b/i, /\bmaps?\b|amap|gaode|地图/i],
  [/验证码|人机验证|captcha|turnstile/i, /captcha|challenge|turnstile/i],
];
const HOST_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

/** The read frames an answer's account of one iframe is held to (its kind or host, when named). */
function namedFrames(subject: string, frames: readonly FrameRead[]): readonly FrameRead[] {
  const shows = (read: FrameRead) => `${read.sourceURL ?? ''}\n${read.text}`;
  const hosts = [...subject.matchAll(HOST_RE)].map((m) => m[0].toLowerCase());
  const byHost = frames.filter((read) =>
    hosts.some((host) => (read.sourceURL ?? '').toLowerCase().includes(host)),
  );
  if (byHost.length) return byHost;
  const kinds = FRAME_KINDS.filter(([named]) => named.test(subject));
  if (!kinds.length) return frames;
  const ofKind = frames.filter((read) => kinds.some(([, shown]) => shown.test(shows(read))));
  // Named, and no read frame shows that kind: only frames of no other kind can be it.
  return ofKind.length
    ? ofKind
    : frames.filter((read) => !FRAME_KINDS.some(([, shown]) => shown.test(shows(read))));
}

/** A quote holds when a frame has it — a whole text, or most of one, not a word picked out. */
function quoteHolds(quote: string, pieces: readonly string[]): boolean {
  const q = bare(quote);
  if (!q) return true;
  const texts = pieces.map(bare).filter(Boolean);
  if (!texts.join(' ').includes(q) && !normal(pieces.join(' ')).includes(normal(quote)))
    return false;
  return (
    weight(q) >= 12 ||
    texts.some((text) => text === q || (text.includes(q) && weight(q) * 2 >= weight(text)))
  );
}

/**
 * 协调方决定: what an answer can be caught making up is what it names — a quote, an address, a thing
 * a page has, a Latin name. A description naming none of these (「正常展示」「有明确反馈」) is not a
 * made-up thing, and is only logged.
 */
const PAGE_THINGS: readonly RegExp[] = [
  /链接|\blinks?\b/i,
  /按钮|\bbuttons?\b/i,
  /表单|\bforms?\b/i,
  /输入[^，,。；;]{0,8}框|文本框|搜索框|下拉框?|\b(?:input|textbox|textarea|searchbox|rich text)\b/i,
  /入口|\bentr(?:y|ance)\b/i,
  /后台|管理员|\b(?:admin|administrator)\b/i,
  /登录|登陆|\b(?:log[- ]?in|sign[- ]?in)\b/i,
  /注册|\b(?:sign[- ]?up|register)\b/i,
  /账[号户]|密码|\b(?:account|password)\b/i,
  /面板|\bpanel\b/i,
  /菜单|导航栏|侧边栏|\b(?:menu|navbar|sidebar)\b/i,
  /图片|图标|\b(?:img|image|icon)\b/i,
  /表格|\btable\b/i,
  /列表|\blist\b/i,
  /视频|\bvideo\b/i,
  /广告|\bads?\b/i,
  /页脚|页眉|声明|条款|\b(?:footer|header|disclaimer|terms)\b/i,
];
/** 「未执行登录」「无需登录」: not said to be there. */
const NEGATED_RE = /(?:未|没有?|无|不(?![仅但只])|非|\b(?:no|not|without)\s)[^，,。；;]*$/i;
/** Words of the run and of the kind of frame, not names on a page. */
const RUN_NAME_RE =
  /^(?:i-?frame[\w-]*|frame[\w-]*|tab_[\w-]*|\w*url|read_page|snapshot|editor|tinymce|wysiwyg|javascript|an?|the|this|that|it|its)$/i;
const URL_RE = /https?:\/\/[^\s，,。；;）)"”」』]+/g;

/** Latin names: capitalised or code-like (`mce_0_ifr`, Iframe Example). */
function latinNames(text: string, prose: boolean): string[] {
  return [...text.matchAll(/[A-Za-z][\w'-]*/g)].flatMap((m) => {
    const word = m[0];
    if (!/[A-Z_\d]/.test(word) || RUN_NAME_RE.test(word) || /^[A-Z]{1,4}$/.test(word)) return [];
    // In a sentence of its own, an opening capital is no name; after 「内容为」 it is what is said.
    const opens = /^[A-Z][a-z'-]*$/.test(word) && !/[\p{L}\p{N}]/u.test(text.slice(0, m.index));
    return prose && opens ? [] : [word.toLowerCase()];
  });
}

/**
 * What a text (quotes taken out) names is in the reads: addresses in any read; things and Latin names
 * in `within`, unless it says they are not there. A task's other part need not be read here.
 */
function namedHeld(
  text: string,
  within: string,
  both: string,
  others?: readonly string[],
): boolean {
  const urls = text.match(URL_RE) ?? [];
  if (urls.some((url) => !both.includes(url.toLowerCase().replace(/[./]+$/, '')))) return false;
  const rest = text.replace(URL_RE, ' ');
  if ((rest.match(HOST_RE) ?? []).some((host) => !both.includes(host.toLowerCase()))) return false;
  const thingsHeld = PAGE_THINGS.every((thing) => {
    const m = rest.match(thing);
    return !m || thing.test(within) || NEGATED_RE.test(rest.slice(0, m.index));
  });
  return (
    thingsHeld &&
    latinNames(rest, others !== undefined).every((name) => {
      return (
        new RegExp(`(?<![a-z0-9])${name}(?:s|es)?(?![a-z0-9])`).test(within) ||
        (others ?? []).some((other) => name.includes(other))
      );
    })
  );
}

/** A claim holds when the quotes in it hold and what else it names is in the frame's read. */
function claimHolds(
  claim: string,
  pieces: readonly string[],
  frameText: string,
  both: string,
): boolean {
  const quotes = [...claim.matchAll(FRAME_QUOTE_RE)].map((m) => normal(m[1]!));
  return (
    quotes.every((q) => quoteHolds(q, pieces)) &&
    namedHeld(claim.replace(FRAME_QUOTE_RE, ' '), frameText, both)
  );
}

/** 协调方决定: what names nothing and is not the frame's text is logged, not sent back. */
function logUnverified(parts: readonly string[], pieces: readonly string[]): void {
  for (const part of parts) {
    const said = bare(part.replace(FRAME_QUOTE_RE, ' '));
    if (/\p{L}/u.test(said) && !pieces.some((piece) => bare(piece).includes(said)))
      logger.info({ clause: part.trim().slice(0, 40) }, 'iframe 描述未核实');
  }
}

export type FrameGap =
  | { kind: 'unread' }
  | { kind: 'mismatch'; read: string }
  | { kind: 'unstated'; read: string }
  /** DEPLOY-51 review #1 (#3): an iframe the task did not ask for — only these clauses go. */
  | { kind: 'drop'; clauses: string[] };

/**
 * An answer's account of an iframe, held against the frames the run read (the latest read of
 * each; a page that failed and was reopened counts by its last good read).
 * - `unread`: the iframe is asked for, or its content described, and no frame was read (or only an
 *   error page) — no description of it can be right.
 * - `mismatch`: it is described as empty, as an error, by a quote or in words, and the reads (of
 *   the iframe named, when one is) say otherwise.
 * - `unstated`: the iframe is asked for, a frame was read, and the answer says nothing of it.
 * - `drop`: the task did not ask for an iframe, and what a clause says one holds does not hold:
 *   that clause is taken out, the rest of the answer stands — unless it carries what was asked,
 *   or nothing would be left; then it is sent back (`unread` / `mismatch`) like an asked one.
 */
export function iframeContentGap(
  intent: string,
  answer: string,
  reads: readonly FrameRead[],
  framesSeen: boolean,
  pageTexts: readonly string[] = [],
): FrameGap | null {
  const asked = IFRAME_WORD_RE.test(intent);
  const pageText = normal(pageTexts.join(' '));
  const claims = iframeWindows(answer, intent, asked, pageText).flatMap(
    ({ window, parts, around, clause, subject }) => {
      // Not asked: only a sentence with the iframe as its subject says what it holds.
      const verb = window.search(CONTENT_CLAIM_RE);
      if (!asked && verb >= 0) {
        const word = window.match(new RegExp(IFRAME_WORD_RE.source, 'i'))?.[0] ?? '';
        if (verb > 0 && !SUBJECT_GAP_RE.test(window.slice(word.length, verb))) return [];
      }
      return [
        {
          clause,
          subject,
          parts,
          around,
          blank: BLANK_CLAIM_RE.test(window),
          claim: parts.join('，'),
          quotes: parts.flatMap((part) =>
            [...part.matchAll(FRAME_QUOTE_RE)].map((m) => normal(m[1]!)),
          ),
          notRead: NOT_READ_RE.test(window),
        },
      ];
    },
  );
  const said = claims.filter(
    (c) => !c.notRead && (c.blank || c.quotes.length > 0 || bare(c.claim).length > 0),
  );
  const good = reads.filter((read) => !frameErrored(read));
  const failed: typeof said = [];
  let read = '';
  if (!good.length) {
    // No frame read: a quote holds when a read page has it word for word (a reader that puts a
    // frame's text in the page's own read, without frame records); an error or a 「为空」 never
    // holds; other words hold only where no frame was listed unread (nothing to hold them to).
    for (const c of said)
      if (
        c.quotes.length
          ? c.quotes.some((q) => !pageText.includes(q))
          : c.blank ||
            ERROR_CLAIM_RE.test(c.claim) ||
            (framesSeen && !pageText.includes(normal(c.claim)))
      )
        failed.push(c);
    if (!asked) return dropOr(intent, answer, failed, { kind: 'unread' });
    // An iframe the page lists and the question asks for, never read: nothing said of it holds.
    return failed.length || framesSeen ? { kind: 'unread' } : null;
  }
  // PR #314 review: each frame as last read (by its frameId; a page that failed and was reopened
  // counts by its last good read) — not the last frame of the page standing for all of them.
  const current = [...new Map(good.map((r) => [r.key, r] as const)).values()];
  const piecesOf = (frames: readonly FrameRead[]) => frames.flatMap((r) => framePieces(r.text));
  // The read as it stands, and its texts run together (a quote across two of them).
  const textOf = (frames: readonly FrameRead[]) =>
    normal(
      frames
        .map((r) => `${r.sourceURL ?? ''} ${r.text} ${framePieces(r.text).join(' ')}`)
        .join(' '),
    );
  const shownOf = (frames: readonly FrameRead[]) => {
    const filled = frames.filter((r) => framePieces(r.text).length > 0);
    return filled.length ? framePieces(filled.at(-1)!.text).join(' ').slice(0, 160) : '';
  };
  for (const c of said) {
    // DEPLOY-51 review #1 (#5): an iframe named by kind or host is held to that frame's read.
    const frames = namedFrames(c.subject, current);
    const pieces = piecesOf(frames);
    const holds = c.blank
      ? frames.some((r) => framePieces(r.text).length === 0)
      : // DEPLOY-51 review #1 (#1) / #2 (#1): what is said, quoted or not, is the frame's text
        // and no more — the page around it does not hold it.
        !ERROR_CLAIM_RE.test(c.claim) &&
        c.parts.every((part) =>
          claimHolds(part, pieces, textOf(frames), `${textOf(current)} ${pageText}`),
        );
    if (holds) logUnverified(c.parts, pieces);
    else {
      failed.push(c);
      read ||= shownOf(frames.length ? frames : current);
    }
  }
  if (!asked) return dropOr(intent, answer, failed, { kind: 'mismatch', read });
  if (failed.length) return { kind: 'mismatch', read };
  // 复审 #2: what is said right after it, of the page around the iframe, is in some read.
  if (pageText) {
    const others = otherParts(intent);
    const off = claims.find(
      (c) =>
        !c.notRead &&
        c.around.some(
          (part) => !heldAround(part, textOf(namedFrames(c.subject, current)), pageText, others),
        ),
    );
    if (off) return { kind: 'mismatch', read: shownOf(namedFrames(off.subject, current)) };
    for (const c of claims) if (!c.notRead) logUnverified(c.around, piecesOf(current));
  }
  const pieces = piecesOf(current);
  const shown = shownOf(current);
  if (!shown) return said.some((c) => c.blank) ? null : { kind: 'unstated', read: '' };
  const lower = normal(answer).replace(/[“”「」『』"]/g, '');
  const quoted = new Set(said.flatMap((c) => c.quotes));
  const stated = pieces.some((piece) => {
    const text = normal(piece).replace(/[.。!！]$/, '');
    // A short frame text counts when quoted as it stands (「你好」), not as any word in prose.
    return text.length >= 4 ? lower.includes(text) : quoted.has(normal(piece)) || quoted.has(text);
  });
  return stated || said.some((c) => c.blank) ? null : { kind: 'unstated', read: shown };
}

/** Generic words of a task, not what it asks for (「读页面标题」 asks for the 标题, not the 页面). */
const TASK_WORDS =
  /请使用|使用|云端|浏览器|打开|读取|查看|一下|页面|网页|网站|内容|显示|告诉|给出|返回/g;

/**
 * DEPLOY-51 review #2 (#2): an unasked iframe's clauses go only when nothing asked goes with them —
 * no number the rest of the answer lacks, no word of the task — and something is left.
 */
function dropOr(
  intent: string,
  answer: string,
  failed: ReadonlyArray<{ clause: string }>,
  otherwise: FrameGap,
): FrameGap | null {
  if (!failed.length) return null;
  const clauses = [...new Set(failed.map((c) => c.clause))];
  const rest = dropClauses(answer, clauses);
  const asks = intent.replace(TASK_WORDS, ' ').match(/\p{Script=Han}{2,}/gu) ?? [];
  const pairs = asks.flatMap((run) => [...run].slice(1).map((ch, i) => run[i]! + ch));
  const carries = (clause: string) =>
    (clause.match(/\d+(?:[.,]\d+)?/g) ?? []).some((n) => !rest.includes(n)) ||
    pairs.some((pair) => clause.includes(pair));
  return /[\p{L}\p{N}]/u.test(rest) && !clauses.some(carries)
    ? { kind: 'drop', clauses }
    : otherwise;
}

/**
 * DEPLOY-51 review #2 (#2): an answer without these clauses — each the iframe's own, from the
 * comma before it to the one after (「商品价格为 99 元，广告 iframe 显示的是一双鞋。」 keeps the price).
 */
export function dropClauses(answer: string, clauses: readonly string[]): string {
  let out = answer;
  for (const clause of clauses) {
    const at = out.indexOf(clause);
    if (at < 0) continue;
    const before = out.slice(0, at).match(/\s*[，,]\s*$/)?.[0].length ?? 0;
    const after = before
      ? 0
      : (out.slice(at + clause.length).match(/^\s*[，,。！？!?；;]?/)?.[0].length ?? 0);
    out = out.slice(0, at - before) + out.slice(at + clause.length + after);
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .replace(/[，,；;、]$/, '');
}

/** FIX-51 #1: 「编辑器下方还有…」, a sentence of its own about the frame of a task that asks for it. */
const FRAME_ALIAS =
  '(?:该\\s*)?编辑器(?=[^，,]{0,8}?(?:还有|另有|有|显示|写着|内容|含|看到))|(?:the\\s+)?editor(?=\\s+(?:also\\s+)?(?:has|contains|shows|displays|includes)\\b)';
const NEXT_ACTION =
  '导航|打开|访问|点击|跳转|前往|进入|切换|切回|回到|关闭|触发|填写|输入|下载|滚动|返回|处理|完成|操作';
const NEXT_ACTION_EN =
  'navigated|opened|visited|clicked|went|switched|typed|entered|scrolled|returned|completed|handled|triggered|dismissed|accepted';
/**
 * The run's next action, wherever it happens (「，并导航至…」「，并成功在该 iframe 内点击段落元素」
 * 「，输入 "…" 后重新读取」), or the note on what was not verified: the answer has moved on.
 */
const NEXT_STEP_RE = new RegExp(
  String.raw`^\s*(?:未核实|(?:(?:并|然后|接着|随后|接下来|最后|再|之后|另外|同时|and\b|then\b)\s*)?(?:成功|已|也)?\s*(?:在[^，,]{0,10}?[内中里上])?\s*(?:${NEXT_ACTION})|(?:(?:and|then)\s+)*(?:i\s+|we\s+)?(?:${NEXT_ACTION_EN})\b)`,
  'i',
);
/** 协调方决定: 「，随后切回主框架…」「。回到首页…」: still on this page, and what it names is held. */
const BACK_STEP_RE =
  /^\s*(?:(?:并|然后|接着|随后|接下来|最后|再|之后)\s*)*(?:成功|已|也)?\s*(?:切回|回到|关闭)|^\s*(?:(?:and|then)\s+)*(?:i\s+|we\s+)?(?:switched back|returned|closed)\b/i;
/** The page around the iframe (复审 #2: held to what was read, not let go). */
const AROUND_RE =
  /^\s*(?:页面|主页面|父页面|网页|该页|本页|此页|这个页面|整个页面|结果|result\b|标题|(?:the\s+)?(?:page|site)\b|title\b)/i;
/** 复审 #3: what the run makes of it (「，确认 iframe 渲染正常」「，并可点击聚焦该元素」) is not the iframe's content. */
const RUN_NOTE_RE =
  /^\s*(?:(?:并|且|从而|以此|由此)\s*)?(?:确认|证实|证明|表明|说明|验证|(?:浏览器\s*)?(?:可以?|能够?)\s*(?:正常\s*)?(?:点击|聚焦|交互|编辑|访问|操作|呈现|读取))|^\s*(?:which\s+)?(?:confirm(?:s|ing|ed)?|prov(?:es|ing)|verif(?:ies|ying)|indicat(?:es|ing))\b/i;
const LIST_MARK_RE = /^\s*(?:[-*•]|\d+[.)、）])\s*/;
/** 「，alert 按钮旁还有…」: a part of the task named, and something more said to be there. */
const SAID_MORE_RE = /还有|另有|还显示|还嵌|\balso\b/i;
/**
 * FIX-51 复审 #1: saying there is something, with no subject of its own — 「，有一个登录链接」
 * 「。下方还有一个管理员登录链接」「。旁边是一个提交按钮」「, and also…」 — goes on about the iframe, even
 * with a word of the task in it.
 */
const FRAME_CLAIM_OPENER_RE =
  /^\s*(?:(?:此外|另外|同时|而且|并且|并|且|以及|also|and|plus|besides)[\s，,]*)*(?:(?:在|其)?(?:下方|下面|上方|上面|旁边|左侧|右侧|左边|右边|底部|顶部|内部|里面|其中|其下|其内)|(?:还|也|另)?有(?![效关时些])|(?:还|也)?(?:能|可以?)?看到|另含|含有?|包含|below\b|above\b|beside\b|next to\b|underneath\b|there (?:is|are)\b|it (?:also )?(?:has|contains|shows)\b)|^\s*(?:also|plus)\b/i;
/** 「。提交按钮在下方。」「。一个提交按钮也在。」: placed by the frame, with nothing else said. */
const FRAME_PLACED_RE =
  /(?:也在|在(?:其)?(?:下方|下面|上方|上面|旁边|左侧|右侧|底部|顶部|内部|里面|其中))\s*$/;
/** 复审 #1: 「编辑器工具栏（Bold、Italic…）」 is the page around the frame, when the page's read has it. */
const TOOLBAR_RE =
  /^\s*(?:(?:该|其)\s*)?(?:(?:tinymce\s*)?(?:富文本)?\s*编辑器的?\s*)?工具栏|^\s*(?:the\s+)?(?:editor\s+)?toolbar\b/i;
function atParent(part: string, pageText: string): boolean {
  if (!TOOLBAR_RE.test(part)) return false;
  const words = (part.match(/[a-z][a-z-]{2,}/gi) ?? []).filter(
    (word) => !/^(?:the|editor|toolbar|tinymce)$/i.test(word),
  );
  return words.length > 0 && words.every((word) => pageText.includes(word.toLowerCase()));
}

/** 复审 #2: said of where the iframe is, a clause is held to the frame's read alone. */
const LOCATED_RE = /i-?frame|框架|编辑器|\beditor\b|富文本|tinymce|wysiwyg/;
/** 「输入 "Hello"」: what the run typed, not what a page has. */
const TYPED_RE =
  /(?:输入|写入|替换为?|键入|填入|\b(?:typed|entered)\b)(?:文字|文本|内容)?\s*["“「『][^"”」』\n]*["”」』]/gi;
/** 「，未执行任何写入」: nothing said to be there. */
const SAID_ABSENT_RE = /^\s*(?:并\s*)?(?:页面上?\s*)?(?:未|没有|没|无)/;
const LATIN_RUN_RE = /[a-z][\w'-]*(?:\s+[a-z0-9][\w'-]*)+/g;

/** The longest word runs a read has, out of a run of words (a title said in passing). */
function withoutRead(run: string, read: string): string {
  const words = run.split(/\s+/);
  for (let size = words.length; size >= 2; size--)
    for (let at = 0; at + size <= words.length; at++) {
      const piece = words.slice(at, at + size).join(' ');
      if (read.includes(piece))
        return `${withoutRead(words.slice(0, at).join(' '), read)} ${withoutRead(words.slice(at + size).join(' '), read)}`;
    }
  return run;
}

/**
 * 复审 #2: a clause of the page around an iframe holds when what it names is in the reads, the
 * parent's and the frame's (「，页面标题为 An iFrame…」); a clause placed in the iframe by a word of
 * its own, in the frame's. A task's other part does not need reading here.
 */
function heldAround(
  part: string,
  frameText: string,
  pageText: string,
  others: readonly string[],
): boolean {
  const both = `${frameText} ${pageText}`;
  if (SAID_ABSENT_RE.test(part)) return true;
  const said = part.replace(TYPED_RE, ' ');
  const quotes = [...said.matchAll(FRAME_QUOTE_RE)].map((m) => bare(m[1]!));
  if (quotes.some((quote) => !both.includes(quote) && /[\p{L}\p{N}]/u.test(quote))) return false;
  const rest = said.replace(FRAME_QUOTE_RE, ' ');
  // The editor's toolbar is on the page around the frame (复审 #1).
  const located =
    !/工具栏|toolbar/i.test(rest) &&
    LOCATED_RE.test(
      normal(rest.replace(URL_RE, ' ')).replace(LATIN_RUN_RE, (run) => withoutRead(run, both)),
    );
  return namedHeld(rest, located ? frameText : both, both, others);
}

/** Quotes and brackets stay whole when text is cut (「"Hello, world"」「（默认文本，含…）」). */
const KEPT_WHOLE = '"[^"\\n]*"|“[^”\\n]*”|「[^」\\n]*」|『[^』\\n]*』|（[^）\\n]*）|\\([^)\\n]*\\)';
function cutOutside(text: string, separator: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (const m of text.matchAll(new RegExp(`${KEPT_WHOLE}|${separator}`, 'gi'))) {
    if (/^["“「『（(]/.test(m[0])) continue;
    out.push(text.slice(at, m.index));
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}
const SENTENCE_SEP = '[。！？!?；;\\n]|\\.(?=\\s|$)';
const CLAUSE_SEP = `[，,]|\\s+(?:and then|and|then)\\s+(?=(?:i\\s+|we\\s+)?(?:${NEXT_ACTION_EN})\\b|the page\\b|page title\\b)|(?=(?:并|然后|接着|随后)\\s*(?:成功)?\\s*(?:${NEXT_ACTION}))`;

/**
 * The words of the task's other parts (「checkboxes」「alert」): a clause naming one left the iframe.
 * 复审 #1: what the task asks of the iframe itself (「iframe 里的登录链接」) is not another part.
 */
function otherParts(intent: string): string[] {
  const words = intent
    .replace(/\S*\.\S+/g, ' ')
    .replace(
      new RegExp(
        `(?:${IFRAME_WORD_RE.source})\\s*(?:里面|内部|里|内|中)的?\\s*[^\\s，,。；;、和与及]*`,
        'gi',
      ),
      ' ',
    )
    .replace(new RegExp(IFRAME_WORD_RE.source, 'gi'), ' ')
    .replace(TASK_WORDS, ' ');
  return [
    ...(words.match(/[a-z]{4,}/gi) ?? []).map((word) => word.toLowerCase().replace(/s$/, '')),
    ...(words.match(/\p{Script=Han}{2,}/gu) ?? []).flatMap((run) =>
      [...run].slice(1).map((ch, i) => run[i]! + ch),
    ),
  ];
}

/** 复审 #3: 「Iframe：」「Iframe 处理：」, an item's label, and where the item happened: not content. */
const ITEM_LABEL_RE =
  /^(?:i-?frames?|[^\s，,]*框架)\s*(?:部分|处理|交互|读取|验证|测试|操作)?\s*\**\s*[:：]\s*\**\s*/i;
const ITEM_PLACE_RE =
  /^在?\s*(?:https?:\/\/\S+?|\/\S+?|该页|此页|本页)\s*(?:页面)?\s*(?:中|内|上|里)?\s*$/i;
/** 「管理员登录链接位于 iframe 中」「编辑器所在的 iframe」: what is said to be in it comes first. */
const PLACED_IN_RE =
  /^(.*\S)\s*(?:(?:位于|处于|在|所在的?)\s*(?:该|这个|此)?|\b(?:is|are)\s+(?:inside|in|within)\s+(?:the\s+)?)\s*$/i;
/** 「iframe 里管理员链接很明显」: goes on inside it, with no verb of its own. */
const INSIDE_RE = /^\s*(?:的|中|里面?|内(?!容)|上)/;
/** 「iframe 已读取」「The iframe was read」. */
const READ_SAID_RE = /^\s*(?:已?(?:读取|读到)|(?:was|has been)\s+read\b)/i;
/** 「已读取 iframe」: the answer says it read the iframe, and what it read comes next. */
const JUST_READ_RE =
  /(?:读取|读到|读完|进入|查看)了?(?:到|了)?\s*(?:该|这个|内部|嵌套|内嵌|其中)?的?\s*$/;

/**
 * Where an answer speaks of an iframe: from each mention, what it says. FIX-51 #1: asked, every
 * later clause of the sentence too, whatever word it opens with (「，并且有一个管理员登录链接」
 * 「，下方还有提交按钮」), up to the run's next step or the task's other part (「，并导航至
 * /javascript_alerts…」「，checkboxes 已读」), and the sentences right after it with no subject of
 * their own (「。下方还有…」). What is said right after it of the page around it goes in `around`, held
 * to every read (复审 #2: 「，页面上还有…」「。管理员链接很明显。」), and so does what is said on the way
 * to the verb (复审 #3: 「已读取 iframe，管理员链接很明显，内容为…」). Not asked, the clause is the
 * iframe's own (「页面嵌有 iframe，商品价格显示为 99 元」 says nothing of the iframe).
 * `parts` start at the first clause that says what it holds, from its verb; a later clause is held
 * whole. `clause` is the iframe's own, and `subject` the words up to the verb that name which
 * iframe (「编辑器 iframe」「广告 iframe」).
 */
function iframeWindows(
  answer: string,
  intent: string,
  asked: boolean,
  pageText: string,
): Array<{
  window: string;
  parts: string[];
  around: string[];
  clause: string;
  subject: string;
}> {
  const others = asked ? otherParts(intent) : [];
  const mention = new RegExp(
    asked ? `${IFRAME_WORD_RE.source}|${FRAME_ALIAS}` : IFRAME_WORD_RE.source,
    'gi',
  );
  const names = (part: string) => others.some((word) => part.toLowerCase().includes(word));
  // Later clauses, in order: said of the iframe (`claims`), or of the page around it once one has
  // left it (`around`, 复审 #2), up to the next step of the run or another part of the task.
  const sort = (parts: readonly string[], left: boolean) => {
    const claims: string[] = [];
    const around: string[] = [];
    for (const raw of parts) {
      const part = raw.replace(LIST_MARK_RE, '');
      const opener = FRAME_CLAIM_OPENER_RE.test(part);
      const back = !opener && BACK_STEP_RE.test(part);
      if (
        !opener &&
        !back &&
        (NEXT_STEP_RE.test(part) || (names(part) && !SAID_MORE_RE.test(part)))
      )
        return { claims, around, left, moved: true };
      if (atParent(part, pageText)) left = true;
      else if (
        back ||
        left ||
        (!opener && (RUN_NOTE_RE.test(part) || AROUND_RE.test(part) || names(part)))
      ) {
        left = true;
        around.push(part.trim());
      } else claims.push(part);
    }
    return { claims, around, left, moved: false };
  };
  const out: ReturnType<typeof iframeWindows> = [];
  let open: { parts: string[]; around: string[]; left: boolean } | undefined;
  for (const sentence of cutOutside(answer, SENTENCE_SEP)) {
    const mentions = [...sentence.matchAll(mention)];
    if (!mentions.length) {
      // A list number or a blank line, cut off by the sentence split, is nothing said.
      if (!/\p{L}/u.test(sentence) || !open) continue;
      // Goes on about the iframe with no subject of its own; with one, of the page around it.
      const placed = FRAME_CLAIM_OPENER_RE.test(sentence) || FRAME_PLACED_RE.test(sentence);
      const next = sort(cutOutside(sentence, CLAUSE_SEP), open.left || !placed);
      open.parts.push(...next.claims.map((part) => part.trim()));
      open.around.push(...next.around);
      open.left = next.left;
      if (next.moved) open = undefined;
      continue;
    }
    open = undefined;
    const masked = sentence.replace(new RegExp(KEPT_WHOLE.split('|（')[0]!, 'g'), (quote) =>
      ' '.repeat(quote.length),
    );
    for (const m of mentions) {
      // The page's address or name, or a title quoted: 「…/iframe」「iframe 页面」「"An iFrame…"」.
      const named =
        /[/.]$/.test(sentence.slice(0, m.index)) ||
        /^s?\s*页面?/i.test(sentence.slice(m.index + m[0].length)) ||
        masked[m.index] === ' ';
      const ownRe = asked && !named ? ASKED_CLAIM_RE : CONTENT_CLAIM_RE;
      const [whole = '', ...later] = cutOutside(sentence.slice(m.index), CLAUSE_SEP);
      const lead = sentence.slice(0, m.index).split(/[，,]/).at(-1) ?? '';
      const after = sort(asked ? later : [], false);
      const label = asked ? whole.match(ITEM_LABEL_RE)?.[0] : undefined;
      const body = label ? whole.slice(label.length) : '';
      const place = ITEM_PLACE_RE.test(body);
      const own = label && (place || !body || NEXT_STEP_RE.test(body)) ? m[0] : whole;
      const clauses = [own, ...after.claims];
      const window = clauses.join('，');
      // What a quote says is not the verb (「"Your content is here"」).
      const verbAt = (text: string, verbs: RegExp) =>
        text
          .replace(FRAME_QUOTE_RE, (quote) => quote[0] + ' '.repeat(quote.length - 1))
          .search(verbs);
      const first = atParent(own, pageText)
        ? -1
        : clauses.findIndex((part, i) => verbAt(part, i ? CONTENT_CLAIM_RE : ownRe) >= 0);
      const verb = verbAt(window, ownRe);
      const parts =
        first < 0
          ? []
          : clauses.slice(first).map((part, i) => {
              if (i) return part.trim();
              const verbs = first ? CONTENT_CLAIM_RE : ownRe;
              const from = part.slice(verbAt(part, verbs));
              const said = from.replace(verbs, '').trim();
              const next = FRAME_LABEL_RE.test(from) ? verbAt(said, CONTENT_CLAIM_RE) : -1;
              return next < 0 ? said : said.slice(next).replace(CONTENT_CLAIM_RE, '').trim();
            });
      // 复审 #3: on the way to the verb. A clause with a mention of its own is that mention's.
      const before = (part: string, verbs: RegExp) => {
        const at = verbAt(part, verbs);
        return at < 0 ? part : part.slice(0, at);
      };
      const mentioned = new RegExp(IFRAME_WORD_RE.source, 'i');
      const placedIn = named ? null : lead.match(PLACED_IN_RE);
      const inside = own.slice(m[0].length);
      const read =
        !named &&
        (JUST_READ_RE.test(lead)
          ? !inside.replace(/[（(][^）)]*[）)]/g, '').trim()
          : READ_SAID_RE.test(inside));
      const onTheWay =
        named || !asked
          ? []
          : [
              ...(placedIn && !NEXT_STEP_RE.test(placedIn[1]!) ? [`${placedIn[1]} iframe`] : []),
              ...(place ? [body] : []),
              ...(INSIDE_RE.test(inside) || READ_SAID_RE.test(inside)
                ? [before(inside, ownRe)]
                : []),
              ...clauses
                .slice(1, first < 0 ? undefined : first + 1)
                .map((part, i) =>
                  first > 0 && i === first - 1 ? before(part, CONTENT_CLAIM_RE) : part,
                )
                .filter(
                  (part) =>
                    (read || first >= 0 || FRAME_CLAIM_OPENER_RE.test(part)) &&
                    !mentioned.test(part) &&
                    /\p{L}/u.test(part),
                ),
            ];
      const entry = {
        window,
        parts,
        // Right after what the iframe holds is said, or that it was read; a mention alone
        // (「打开 /iframe，…」「向 iframe 写入…」) says nothing.
        around: [
          ...onTheWay.map((part) => part.trim()),
          ...(parts.length || read ? after.around : []),
        ],
        clause: (lead + own).trim(),
        subject: lead + (verb < 0 ? window : window.slice(0, verb)),
      };
      out.push(entry);
      if (asked && !after.moved && (parts.length || read))
        open = { parts: entry.parts, around: entry.around, left: after.left };
    }
  }
  return out;
}
