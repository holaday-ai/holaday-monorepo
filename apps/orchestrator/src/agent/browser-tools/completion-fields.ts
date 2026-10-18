import { TEXT_URL_RE } from '../../execution/text-urls.js';

export interface ObservedEvidence {
  text: string;
  tabId?: string;
  sourceURL?: string;
  links?: Array<{ text: string; url: string; kind?: string }>;
}
/**
 * BROWSER-AUTOPILOT-1 — completion integrity, deliberately small.
 *
 * Only hard facts in the answer (titles, names, numbers, dates, prices, links,
 * file names/sizes) are compared with what the browser actually read. Prose —
 * summaries, explanations, notes, the model's `evidence` text — is never
 * checked. A fact found in the read text passes; a fact that contradicts the
 * read pages (or claims content of a page that never loaded) blocks; anything
 * else is delivered and labelled 未核实 instead of being rejected.
 */
const RELATIVE_UNITS: Array<[RegExp, string]> = [
  [/(\d+)\s*years?\s+ago/g, '$1年前'],
  [/(\d+)\s*months?\s+ago/g, '$1个月前'],
  [/(\d+)\s*weeks?\s+ago/g, '$1周前'],
  [/(\d+)\s*days?\s+ago/g, '$1天前'],
  [/(\d+)\s*hours?\s+ago/g, '$1小时前'],
  [/(\d+)\s*minutes?\s+ago/g, '$1分钟前'],
  [/(\d+)\s*月前/g, '$1个月前'],
];

/** Literal `\n` / `\t` that a model double-escaped inside tool arguments. */
export function unescapeLiteralBreaks(value: string): string {
  return value.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, ' ');
}

/** Canonical form for comparison: width, case, quotes, spacing, digits, relative time. */
export function normalizeFact(value: string): string {
  let v = unescapeLiteralBreaks(value).normalize('NFKC').toLocaleLowerCase();
  v = v
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―−]/g, '-');
  v = v.replace(/(\d),(?=\d{3}\b)/g, '$1');
  for (const [pattern, replacement] of RELATIVE_UNITS) v = v.replace(pattern, replacement);
  return v.replace(/\s+/g, ' ').trim();
}

const clean = (value: string) =>
  unescapeLiteralBreaks(value)
    .replace(/^[\s*`#>"'“”「」]+|[\s*`。，,;；"'“”「」]+$/g, '')
    .trim();

/** Only successful content reads enter this store; listings and navigation receipts do not. */
export function observedEvidence(text: string, decoded: string, url?: string): ObservedEvidence {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(text);
  } catch {
    /* Plain accessibility snapshots are supported. */
  }
  const links = Array.isArray(meta.items)
    ? meta.items.filter(
        (item): item is { text: string; url: string; kind?: string } =>
          !!item && typeof item.text === 'string' && typeof item.url === 'string',
      )
    : [];
  return {
    text: decoded,
    links,
    ...(typeof meta.tabId === 'string' ? { tabId: meta.tabId } : {}),
    ...(typeof meta.sourceURL === 'string'
      ? { sourceURL: meta.sourceURL }
      : url
        ? { sourceURL: url }
        : {}),
  };
}

export interface FactAssessment {
  /** Contradicts a read page, or reports a page that never loaded: blocks completion. */
  contradictions: string[];
  /** Not found verbatim, not contradicted: delivered with a 未核实 note. */
  unverified: string[];
  /** Quotes the pages never said, with the closest text they did say (FIX-24). */
  misquoted?: Array<{ quote: string; nearest?: string }>;
  /**
   * FIX-26: facts whose only problem is their source binding — bound to a tab
   * that was never read, or read on another page (named in `where`).
   */
  binding?: Array<{ label: string; kind: 'unread' | 'other_page'; bound: string; where?: string }>;
}

interface Fact {
  name: string;
  value: string;
  tabId?: string;
  sourceURL?: string;
  /** One item of a list (e.g. search results): no single-heading comparison. */
  listItem?: boolean;
  /** A quoted literal: not finding it verbatim means the page never said it. */
  quote?: boolean;
}

const PROSE_FIELD =
  /summary|总结|概述|摘要|说明|备注|注释|^注$|解释|描述|内容|结论|note|remark|explanation|description|overview|reason|原因/i;
/** The page's own title — not a section, chapter or list-item title. */
const TITLE_FIELD = /^(?:视频|页面|网页|文章|商品)?标题$|^(?:page |video )?title$/i;
const NUMERIC_LABEL = /播放量|观看次数|价格|售价|大小|日期|发布时间|views|price|size|published/i;
const FACT_LABELS =
  '标题|频道|作者|播放量|观看次数|发布日期(?:或页面相对日期)?|发布时间|日期|价格|售价|文件名|文件大小|大小|title|channel|author|views|published|price|filename|size|tab\\s*\\d+\\s*title';

function explicitFacts(input: unknown): Fact[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 60).flatMap((field): Fact[] => {
    if (!field || typeof field !== 'object') return [];
    const f = field as Record<string, unknown>;
    const name = typeof f.name === 'string' ? f.name.slice(0, 80) : '字段';
    const value = typeof f.value === 'string' ? clean(f.value) : '';
    // Summaries and explanations are the model's own words, not page facts.
    if (!value || PROSE_FIELD.test(name) || value.length > 300) return [];
    return [
      {
        name,
        value,
        ...(typeof f.tabId === 'string' ? { tabId: f.tabId } : {}),
        ...(typeof f.sourceURL === 'string' ? { sourceURL: f.sourceURL } : {}),
      },
    ];
  });
}

const unclosed = (value: string) =>
  (value.match(/[（(]/g)?.length ?? 0) > (value.match(/[）)]/g)?.length ?? 0);

/** Drop an explanatory parenthetical left unclosed by the field cut ("16年前（说明…"). */
function closeBrackets(value: string): string {
  let depth = 0;
  let open = -1;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if ('（(【['.includes(ch)) {
      if (depth === 0) open = i;
      depth++;
    } else if ('）)】]'.includes(ch)) depth = Math.max(0, depth - 1);
  }
  return depth > 0 && open > 0 ? value.slice(0, open).trim() : value;
}

/** Text up to the first full-width comma that is not inside brackets. */
function beforeOuterComma(value: string): string {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if ('（(【['.includes(ch)) depth++;
    else if ('）)】]'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === '，' && depth === 0) return value.slice(0, i);
  }
  return value;
}

function answerFacts(summary: string, intent = ''): Fact[] {
  const text = unescapeLiteralBreaks(summary);
  const asked = normalizeFact(intent);
  const facts: Fact[] = [];
  const add = (fact: Fact) => {
    if (fact.value && fact.value.length <= 300) facts.push(fact);
  };
  for (const url of text.match(TEXT_URL_RE) ?? []) add({ name: '链接', value: url });
  // A labelled run that lists URLs ("标题：1) https://… → X") is handled per item below;
  // a numeric label whose value has no number is prose ("播放量为页面原样字符串").
  for (const match of text.matchAll(
    new RegExp(`(${FACT_LABELS})\\s*[*\`]*\\s*(?:[:：]|为|是)\\s*([^\\n；;|。]+)`, 'giu'),
  )) {
    if (/https?:\/\//i.test(match[2]!)) continue;
    if (NUMERIC_LABEL.test(match[1]!) && !/\d/.test(match[2]!)) continue;
    // A quoted value is exactly what is inside the quotes; otherwise prose after a
    // full-width comma is not part of the value.
    const raw = match[2]!.trim();
    const quoted = raw.match(/^[“"「『]([^”"」』]+)[”"」』]/u)?.[1];
    // "大小：文件名为 …" — an enumeration header, not this label's value.
    if (!quoted && new RegExp(`^(?:${FACT_LABELS})\\s*(?:为|是|[:：])`, 'iu').test(raw)) continue;
    // A field cut inside a bracket ("16年前（说明；…）") is completed to its
    // closing bracket, so facts inside the note are still checked.
    const end = match.index! + match[0].length;
    const tail = text.slice(end).match(/^[^（）()\n]*[）)]/u)?.[0] ?? '';
    const value = closeBrackets(quoted ?? beforeOuterComma(raw + (unclosed(raw) ? tail : '')));
    // "第3节标题" / "列表标题" — a section or item title, not the page's own title.
    const before = text.slice(Math.max(0, match.index! - 4), match.index!);
    const qualified = /[节章段条项部篇栏]\s*$|列表\s*$|\d\s*$/.test(before);
    add({ name: match[1]!, value: clean(value), ...(qualified ? { listItem: true } : {}) });
  }
  // A quoted string with Latin letters or digits claims literal page text
  // ("You clicked: Ok"); a negated mention ("而非 …") is not a claim.
  // Pair every quote, short ones too: skipping "阴" would pair its closing mark
  // with the next opening one and quote the prose between them (FIX-24).
  for (const match of text.matchAll(/[“"「]([^”"」\n]{1,200})[”"」]/gu)) {
    if (match[1]!.trim().length < 3) continue;
    // "Impedit iure omnis..." quotes the opening of a passage: compare the excerpt.
    const quote = match[1]!.trim().replace(/^(?:\.{3,}|…+)\s*|\s*(?:\.{3,}|…+)$/gu, '');
    const before = text.slice(Math.max(0, match.index! - 12), match.index!);
    if (
      /[A-Za-z]{3,}|\d/.test(quote) &&
      // Short symbol/number snippets ("0/1") are not page-text claims.
      (/[A-Za-z]/.test(quote) || quote.length >= 4) &&
      // The user's own words ("搜索「Playwright tutorial」") are not a page claim.
      !asked.includes(normalizeFact(quote)) &&
      !/而非|不是|并非|并不是|没有|未出现|误引|instead of|rather than|not\s*$/i.test(before) &&
      // A retracted quote ("此前误引的 “…” 并非页面内容") is not a claim either.
      !/^[^。；\n]{0,6}(?:并非|不是|并不是|有误|是误引)/u.test(
        text.slice(match.index! + match[0].length),
      )
    )
      add({ name: '原文引用', value: quote, quote: true });
  }
  let headers: string[] | undefined;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('|')) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(clean);
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
      if (!headers && cells.some((cell) => new RegExp(FACT_LABELS, 'i').test(cell))) {
        headers = cells;
        continue;
      }
      if (headers)
        cells.forEach((cell, i) => {
          if (new RegExp(FACT_LABELS, 'i').test(headers![i] ?? ''))
            add({
              name: headers![i]!,
              value: cell.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
              listItem: true,
            });
        });
    }
    // A numbered "title — URL" item binds the title to that page.
    const item = line.match(/^\s*\d+[.)、]\s+(.+?)\s+[—–-]\s+(https?:\/\/\S+)/u);
    const url = item?.[2]?.match(TEXT_URL_RE)?.[0];
    if (item && url) {
      add({ name: '条目标题', value: clean(item[1]!), sourceURL: url, listItem: true });
      continue;
    }
    // "URL → 标题 X": the title is claimed for that page.
    const arrow = line.match(
      /(https?:\/\/\S+?)\s*(?:→|->|=>)\s*(?:标题\s*[:：]?\s*)?["“「]?([^"”」\n；;]+?)["”」]?\s*(?:[；;。]|$)/u,
    );
    const arrowUrl = arrow?.[1]?.match(TEXT_URL_RE)?.[0];
    if (arrow && arrowUrl) {
      add({ name: '标签标题', value: clean(arrow[2]!), sourceURL: arrowUrl, listItem: true });
      continue;
    }
    // A short numbered list line without prose (e.g. search-result titles).
    const listed = line.match(/^\s*\d+[.)、]\s+(.+)$/u)?.[1];
    if (
      listed &&
      !/[：*]/.test(listed) &&
      clean(listed).length <= 150 &&
      !/https?:\/\//i.test(listed)
    )
      add({ name: '条目', value: clean(listed), listItem: true });
  }
  return facts;
}

/** A value with an explanatory parenthetical: the bare value is the fact. */
function splitNote(value: string): { bare: string; note: string } | null {
  const match = value.match(/^(.+?)\s*[（(]([^（()）]*)[)）]\s*$/u);
  if (!match || !match[1]!.trim()) return null;
  return { bare: match[1]!.trim(), note: match[2]!.trim() };
}
/** The bare value; a parenthetical without numbers is only an explanation. */
function withoutNote(value: string): string | null {
  return splitNote(value)?.bare ?? null;
}

const skeleton = (value: string) => value.replace(/\d+(?:\.\d+)?/g, '#');

function sourceLabel(fact: Fact) {
  return fact.tabId ? `标签 ${fact.tabId}` : (fact.sourceURL ?? '该页面');
}

/**
 * AP4 (Deploy-22 core-01): the page a fact is bound to, allowing for a redirect.
 * Bing appends `rdr`/`rdrig` to the URL the answer cites; the same host and
 * path with every parameter the answer names is the same page.
 */
function sameSource(pageUrl: string | undefined, cited: string): boolean {
  if (!pageUrl) return false;
  if (pageUrl === cited) return true;
  try {
    const page = new URL(pageUrl);
    const want = new URL(cited);
    const host = (url: URL) => url.hostname.replace(/^www\./, '');
    const path = (url: URL) => url.pathname.replace(/\/+$/, '') || '/';
    if (host(page) !== host(want) || path(page) !== path(want)) return false;
    for (const [key, value] of want.searchParams)
      if (page.searchParams.get(key) !== value) return false;
    return true;
  } catch {
    return false;
  }
}

const NOT_READ =
  /^(?:未读到|未读取到|未找到|没有读到|页面未(?:提供|显示|列出)|not (?:shown|found|read)|n\/a)[。.]?$/i;

export function assessCompletionFacts(input: {
  summary: string;
  fields?: unknown;
  /** Successful page reads (never navigation receipts or tab listings). */
  pages: ObservedEvidence[];
  /** Host receipts (download, scroll, form) that may also ground facts. */
  receipts?: string;
  /** Everything the host returned to the model (errors included): grounds quotes only. */
  toolTexts?: string;
  intent?: string;
}): FactAssessment {
  const intent = input.intent ?? '';
  const videoSearch =
    /youtube/i.test(intent) && /视频|videos?/i.test(intent) && /搜索|search/i.test(intent);
  /** The task asks to open the links themselves: a listing is not proof of their pages. */
  const opensLinks = /打开.{0,12}链接|新标签|new tabs?|open .{0,20}links?/i.test(intent);
  const pages = input.pages.map((page) => {
    const lines = unescapeLiteralBreaks(page.text).split('\n').map(normalizeFact);
    return { ...page, lines, norm: lines.join(' ') };
  });
  const receipts = normalizeFact(input.receipts ?? '');
  const contradictions: string[] = [];
  const unverified: string[] = [];
  const misquoted: Array<{ quote: string; nearest?: string }> = [];
  const binding: NonNullable<FactAssessment['binding']> = [];
  const seen = new Set<string>();
  const facts = [...explicitFacts(input.fields), ...answerFacts(input.summary, intent)].flatMap(
    (fact): Fact[] => {
      // A parenthetical that carries numbers is its own fact, checked separately.
      // Titles and list items often carry parentheses as part of the name.
      const split = fact.listItem || TITLE_FIELD.test(fact.name) ? null : splitNote(fact.value);
      if (!split || !/\d/.test(split.note)) return [fact];
      // Only the pieces of the note that carry numbers are facts of their own.
      const pieces = split.note
        .split(/[，,；;、]/)
        .map((piece) => piece.trim())
        .filter((piece) => /\d/.test(piece));
      return [
        fact,
        ...pieces.map((piece) => ({
          ...fact,
          name: `${fact.name}（括注）`,
          value: piece,
          listItem: true,
        })),
      ];
    },
  );
  for (const fact of facts) {
    const key = `${fact.name}|${fact.value}|${fact.tabId ?? ''}|${fact.sourceURL ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // "未读到" declares a value absent: it claims nothing about the page.
    if (NOT_READ.test(fact.value.trim())) continue;
    const quoted = fact.value.match(/[“"「]([^”"」]{1,200})[”"」]/u)?.[1];
    const candidates = [fact.value, withoutNote(fact.value), quoted]
      .filter((v): v is string => Boolean(v))
      .map(normalizeFact);
    const bound = (page: (typeof pages)[number]) =>
      (!fact.tabId || page.tabId === fact.tabId) &&
      (!fact.sourceURL || sameSource(page.sourceURL, fact.sourceURL));
    const eligible = pages.filter(bound);
    const label = `${fact.name}「${fact.value.slice(0, 120)}」`;
    const isVideoKindMismatch =
      videoSearch &&
      pages.some((page) =>
        page.links?.some(
          (link) =>
            ['playlist', 'channel'].includes(link.kind ?? '') &&
            candidates.includes(normalizeFact(link.text)),
        ),
      );
    if (isVideoKindMismatch) {
      contradictions.push(`${label} 在页面上是播放列表/频道，不是视频`);
      continue;
    }
    const grounded = candidates.some(
      (v) =>
        eligible.some(
          (page) =>
            page.norm.includes(v) ||
            (page.sourceURL &&
              (normalizeFact(page.sourceURL) === v || sameSource(page.sourceURL, fact.value))) ||
            page.links?.some((link) => normalizeFact(link.url) === v),
        ) ||
        // Host receipts (download, typed text, scroll) are facts whatever the binding.
        receipts.includes(v) ||
        // A result list ("title — URL") is proven by the listing page's own link,
        // also when the fact names the listing's tab (ACCEPT-283-R5 D16).
        (!opensLinks &&
          !!fact.sourceURL &&
          pages.some(
            (page) =>
              (!fact.tabId || page.tabId === fact.tabId) &&
              (page.links?.some(
                (link) =>
                  normalizeFact(link.url) === normalizeFact(fact.sourceURL!) &&
                  normalizeFact(link.text).includes(v),
              ) ||
                // A snapshot read: the item's link follows its title on the page.
                listedNear(page.norm, v, normalizeFact(fact.sourceURL!))),
          )),
    );
    if (grounded) continue;
    if (fact.quote && candidates.some((v) => normalizeFact(input.toolTexts ?? '').includes(v)))
      continue;
    if (!pages.length) {
      contradictions.push(`${label} 没有成功读取的页面可以支持（页面未加载或未读取）`);
      continue;
    }
    if ((fact.tabId || fact.sourceURL) && !eligible.length) {
      contradictions.push(`${label} 所属页面（${sourceLabel(fact)}）未成功读取`);
      binding.push({ label, kind: 'unread', bound: sourceLabel(fact) });
      continue;
    }
    if (
      (fact.tabId || fact.sourceURL) &&
      // "no" (from "no (only type=time present)") is inside almost any page's words:
      // only a value long enough to be specific can be traced to another page.
      candidates.some(
        (v) =>
          (v.length >= 4 || /\p{Script=Han}{2}/u.test(v)) &&
          pages.some((page) => !bound(page) && page.norm.includes(v)),
      )
    ) {
      contradictions.push(`${label} 来自其他页面，不是 ${sourceLabel(fact)} 的内容`);
      const home = pages.find(
        (page) =>
          !bound(page) &&
          candidates.some(
            (v) => (v.length >= 4 || /\p{Script=Han}{2}/u.test(v)) && page.norm.includes(v),
          ),
      );
      binding.push({
        label,
        kind: 'other_page',
        bound: sourceLabel(fact),
        ...(home?.tabId || home?.sourceURL
          ? { where: home.tabId ? `标签 ${home.tabId}` : home.sourceURL! }
          : {}),
      });
      continue;
    }
    // Same context on the page with a different number (views, dates, prices,
    // sizes) — single labelled values only; list pages repeat such shapes.
    // Compare the bare value (an explanatory note stripped) with the page.
    const value = normalizeFact(withoutNote(fact.value) ?? fact.value);
    const shape = skeleton(value);
    if (!fact.listItem && /\d/.test(value) && shape.replace(/[#\s]/g, '').length >= 2) {
      const conflict = eligible
        .flatMap((page) => page.lines)
        .find((line) => /\d/.test(line) && skeleton(line).includes(shape));
      if (conflict) {
        contradictions.push(`${label} 与页面不符；页面为「${conflict.trim().slice(0, 120)}」`);
        continue;
      }
    }
    // A single page title that differs from the page's own main heading.
    if (fact.quote) {
      contradictions.push(`${label} 不是已读页面中的原文`);
      misquoted.push({ quote: fact.value, nearest: nearestPassage(fact.value, input.pages) });
      continue;
    }
    if (TITLE_FIELD.test(fact.name) && !fact.listItem) {
      const headings = new Set(
        eligible
          .map((page) => page.text.match(/heading "([^"]+)" \[level=1\]/)?.[1])
          .filter((heading): heading is string => Boolean(heading)),
      );
      const heading = headings.size === 1 ? [...headings][0] : undefined;
      // "人工智能 编辑" (h1 with its edit link) vs "人工智能 - 维基百科" (document title)
      // are the same title: compare cores, either way round.
      const main = heading
        ? normalizeFact(heading)
            .replace(/\s*(?:\[?编辑\]?|\[?edit\]?)$/i, '')
            .trim()
        : '';
      if (heading && !candidates.some((v) => v.includes(main) || main.includes(v))) {
        contradictions.push(`${label} 与页面一级标题「${heading.slice(0, 120)}」不符`);
        continue;
      }
    }
    unverified.push(label);
  }
  return {
    contradictions: contradictions.slice(0, 8),
    unverified: unverified.slice(0, 8),
    ...(misquoted.length && misquoted.length === contradictions.length ? { misquoted } : {}),
    ...(binding.length && binding.length === contradictions.length ? { binding } : {}),
  };
}

/** User-visible note for facts that could not be matched word for word. */
export function unverifiedNote(unverified: readonly string[]): string {
  return unverified.length
    ? `未核实：以下内容未能在已读页面中逐字找到，请自行确认——${unverified.join('；')}`
    : '';
}

/** `url` appears on the page right after `title` (the same result entry). */
function listedNear(norm: string, title: string, url: string): boolean {
  if (!title || !url) return false;
  for (let at = norm.indexOf(title); at >= 0; at = norm.indexOf(title, at + 1))
    if (norm.slice(at, at + title.length + 800).includes(url)) return true;
  return false;
}

/**
 * The run of page words most like a misquote ("successfuly" for the page's
 * "successfully"), as the page wrote it — for the model to copy, never to
 * stand in for its answer.
 */
export function nearestPassage(quote: string, pages: ObservedEvidence[]): string | undefined {
  const grams = (text: string) => {
    const flat = normalizeFact(text).replace(/\s+/g, ' ');
    const out = new Map<string, number>();
    for (let i = 0; i < flat.length - 1; i++) {
      const gram = flat.slice(i, i + 2);
      out.set(gram, (out.get(gram) ?? 0) + 1);
    }
    return out;
  };
  const dice = (a: Map<string, number>, b: Map<string, number>) => {
    let shared = 0;
    let total = 0;
    for (const [gram, n] of a) shared += Math.min(n, b.get(gram) ?? 0);
    for (const n of a.values()) total += n;
    for (const n of b.values()) total += n;
    return total ? (2 * shared) / total : 0;
  };
  const target = grams(quote);
  const width = quote.trim().split(/\s+/).length;
  let best: { text: string; score: number } | undefined;
  for (const page of pages)
    for (const line of unescapeLiteralBreaks(page.text).split('\n')) {
      const words = line.trim().split(/\s+/).filter(Boolean);
      for (let size = Math.max(1, width - 1); size <= width + 1; size++)
        for (let start = 0; start + size <= words.length; start++) {
          const text = words
            .slice(start, start + size)
            .join(' ')
            .replace(/^[\["'“「(]+|[\]"'”」),:;.]+$/gu, '');
          const score = dice(target, grams(text));
          if (score > (best?.score ?? 0)) best = { text, score };
        }
    }
  return best && best.score >= 0.7 && normalizeFact(best.text) !== normalizeFact(quote)
    ? best.text
    : undefined;
}
