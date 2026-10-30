import { TEXT_URL_RE } from '../../execution/text-urls.js';
import { stripInternalRefs } from '../internal-refs.js';
import { staleForRecentIntent, uncoveredTargets } from './completion-coverage.js';
import { assessEngagementClaims } from './engagement-counts.js';

export interface ObservedEvidence {
  text: string;
  tabId?: string;
  sourceURL?: string;
  links?: Array<{ text: string; url: string; kind?: string }>;
  /** FIX-28: YouTube result cards' titles and kinds, from the read's headings. */
  youtubeCards?: Array<{ title: string; kind: string }>;
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

/**
 * Quoted runs in reading order. A 「…」 holding its own paired quotes
 * (「“HOLA DAY AI”的搜索结果」) is one quote; otherwise every opening mark pairs
 * with the next closing one, short quotes too (FIX-24).
 */
const QUOTE_RE = /「((?:[^「」“”"\n]|“[^“”\n]*”|"[^"\n]*")+)」|[“"「]([^”"」\n]{1,200})[”"」]/gu;

function quotedRuns(text: string): Array<{ quote: string; index: number; length: number }> {
  return [...text.matchAll(QUOTE_RE)]
    .map((match) => ({
      quote: match[1] ?? match[2]!,
      index: match.index!,
      length: match[0].length,
    }))
    .filter((run) => run.quote.length <= 200);
}

const OPEN_CLOSE: Record<string, string> = {
  '“': '”',
  '"': '"',
  '「': '」',
  '『': '』',
  '‘': '’',
};

/**
 * A quote with its own wrapping marks, or a stray one at an edge, taken off
 * (「“Powered by …”」 → Powered by …); a pair inside the text stays.
 */
export function stripEdgeQuotes(quote: string): string {
  let q = quote.trim();
  for (;;) {
    const open = q[0] ?? '';
    const close = OPEN_CLOSE[open];
    const last = q[q.length - 1] ?? '';
    if (close && last === close && q.length > 2) q = q.slice(1, -1).trim();
    else if (close && !q.slice(1).includes(close)) q = q.slice(1).trim();
    else if (
      Object.values(OPEN_CLOSE).includes(last) &&
      !Object.entries(OPEN_CLOSE).some(([o, c]) => c === last && q.slice(0, -1).includes(o))
    )
      q = q.slice(0, -1).trim();
    else return q;
  }
}

const clean = (value: string) =>
  unescapeLiteralBreaks(value)
    .replace(/^[\s*`#>"'“”「」]+|[\s*`。，,;；"'“”「」]+$/g, '')
    .trim();

/** Only successful content reads enter this store; listings and navigation receipts do not. */
/** A currency amount as it appears on a page (S$8.90, SGD 11.46, ¥99, $14.99). */
const PRICE_SHAPE_RE = /(?:s\$|us\$|\$|¥|￥|€|£|sgd|usd|rmb|cny)\s*\d[\d,]*(?:\.\d+)?/gi;
/** A price field's name (「价格」「原价」「price」) — PR #312 review: not 「评价数」 or 「价值」. */
const PRICE_FIELD_RE = /价格|[原现售单定标划市均总报]价|^价$|price/i;
/** A number said in yuan, or named a price: 「99 元」「原价 99」「价格：1,299」. */
/** PR #312 review: the price word stays with the amount (「原价 99」), so 「299 reviews」 is no match. */
const CN_PRICE_RE =
  /(?:[原现售定标划市]?价(?:格)?\s*[:：为是]?\s*)?\d[\d,]*(?:\.\d+)?\s*元|[原现售定标划市]?价(?:格)?\s*[:：为是]?\s*\d[\d,]*(?:\.\d+)?/g;
/**
 * FIX-48 #3: the prices a bracket note states — a currency sign or code, or 「元 / 价」 — each as
 * written; a number with neither (「约 2 天送达」「库存 5 件」) is none.
 */
function notePrices(piece: string): string[] {
  const signed = piece.match(PRICE_SHAPE_RE) ?? [];
  const rest = signed.reduce((left, price) => left.replace(price, ' '), piece);
  return [...signed, ...(rest.match(CN_PRICE_RE) ?? []), ...(rest.match(EN_PRICE_RE) ?? [])].map(
    (price) => price.trim(),
  );
}
/**
 * PR #312 review: an English label names a price as plainly (「original price 99」「was 99」「RRP 99」);
 * the label stays with the amount, so another number on the page is no match.
 */
const EN_PRICE_RE =
  /\b(?:(?:original|list|regular|retail|sale|current|typical)\s+)?price\s*[:：]?\s*\d[\d,]*(?:\.\d+)?|\b(?:was|rrp|msrp)\s*[:：]?\s*\d[\d,]*(?:\.\d+)?/gi;

/** Appended to a read whose snapshot was cut at its size budget. */
export const SNAPSHOT_TRUNCATED = '[快照截断：以下内容未读到]';

/**
 * The cut marker goes where the tree was cut, not after the text that follows it (the
 * page's other results and their prices came between the cut item and an end marker).
 */
function markCut(decoded: string, tree: unknown): string {
  const tail = typeof tree === 'string' ? tree.trimEnd().slice(-120) : '';
  const at = tail ? decoded.lastIndexOf(tail) : -1;
  if (at < 0) return `${decoded}\n${SNAPSHOT_TRUNCATED}`;
  const end = at + tail.length;
  return `${decoded.slice(0, end)}\n${SNAPSHOT_TRUNCATED}${decoded.slice(end)}`;
}

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
  const youtubeCards = Array.isArray(meta.headings)
    ? meta.headings.flatMap((heading) =>
        heading &&
        typeof heading.text === 'string' &&
        (heading.youtube === 'playlist' || heading.youtube === 'video')
          ? [{ title: heading.text, kind: heading.youtube as string }]
          : [],
      )
    : [];
  return {
    // FIX-34 (Deploy-34 amazon-sg): a snapshot cut at its budget says so, so 「价格：未获取到」
    // for the item it ends on is the page's truth, not a missed read.
    text: meta.truncated === true ? markCut(decoded, meta.tree) : decoded,
    links,
    ...(youtubeCards.length ? { youtubeCards } : {}),
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
   * FIX-34 (Deploy-34 dy-2): a name the answer hedges (「推断作者为“X”」) that the page
   * shows as a node of its own — to be written plainly. Never blocks completion.
   */
  hedgedNames?: Array<{ label: string; name: string }>;
  /**
   * FIX-26: facts whose only problem is their source binding — bound to a tab
   * that was never read, or read on another page (named in `where`).
   */
  binding?: Array<{
    label: string;
    kind: 'unread' | 'other_page';
    bound: string;
    where?: string;
  }>;
  /**
   * FIX-34: listed prices no read page shows (written for the item a snapshot was cut
   * at) — when they are the only contradictions, they get their own one correction.
   */
  unreadPrices?: string[];
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
/** A field naming the page read (「页面：X - 维基百科」), compared with that page's h1. */
const PAGE_FIELD = /^(?:当前)?(?:页面|网页)(?:名称|标题)?$|^(?:current )?page$/i;
/** A document title's site suffix: 「 - 维基百科」「 - Wikipedia」「 | 知乎」. */
const SITE_SUFFIX_RE = /\s*[-–—|·]\s*[^-–—|·]{1,30}$/;
/** The page's own title — not a section, chapter or list-item title. */
const TITLE_FIELD = /^(?:视频|页面|网页|文章|商品)?标题$|^(?:page |video )?title$/i;
const NUMERIC_LABEL = /播放量|观看次数|价格|售价|大小|日期|发布时间|views|price|size|published/i;
const FACT_LABELS =
  '标题|频道|作者|播放量|观看次数|发布日期(?:或页面相对日期)?|发布时间|日期|价格|售价|文件名|文件大小|大小|title|channel|author|views|published|price|filename|size|tab\\s*\\d+\\s*title';

/**
 * FIX-45 (Deploy-45 dy-1 「- video_title：」, b-d04 「- latest_version：」, core-10 「- js_alert_result：」):
 * a snake_case / camelCase field name reads in Chinese (in the field list and the 未核实 note); a word with no entry keeps its own
 * spelling, the underscores gone.
 */
const FIELD_WORDS: Record<string, string> = {
  video: '视频',
  title: '标题',
  author: '作者',
  name: '名称',
  nickname: '昵称',
  channel: '频道',
  like: '点赞',
  likes: '点赞',
  comment: '评论',
  comments: '评论',
  collect: '收藏',
  favorite: '收藏',
  share: '分享',
  shares: '分享',
  count: '数',
  num: '数',
  views: '播放量',
  view: '播放',
  latest: '最新',
  version: '版本',
  release: '发布',
  publish: '发布',
  published: '发布',
  date: '日期',
  time: '时间',
  result: '结果',
  status: '状态',
  js: 'JS',
  alert: 'Alert',
  confirm: 'Confirm',
  prompt: 'Prompt',
  dialog: '对话框',
  text: '文字',
  macos: 'macOS',
  compatibility: '适用系统',
  download: '下载',
  url: '链接',
  link: '链接',
  file: '文件',
  size: '大小',
  price: '价格',
  rating: '评分',
  review: '评价',
  reviews: '评价',
  stock: '库存',
  original: '起始',
  current: '当前',
  page: '页面',
  tab: '标签页',
  first: '第一',
  second: '第二',
  item: '条目',
  product: '商品',
  description: '描述',
  source: '来源',
  total: '总',
  temperature: '温度',
  humidity: '湿度',
  weather: '天气',
  address: '地址',
  content: '内容',
  snippet: '片段',
  start: '开始',
  end: '结束',
  // FIX-48 #2 (Deploy-48 core-11 「final页面height」, b-d04 「macOS installer描述」).
  final: '最终',
  initial: '初始',
  height: '高度',
  width: '宽度',
  installer: '安装包',
};
export function fieldLabel(name: string): string {
  const trimmed = name.trim();
  // FIX-46 (Deploy-46 core-11 「content snippet start」): an English phrase of plain words reads in
  // Chinese when every word has an entry; otherwise it is left as written.
  if (/^[a-z]+(?: [a-z]+){1,4}$/i.test(trimmed)) {
    const words = trimmed.split(' ').map((word) => FIELD_WORDS[word.toLowerCase()]);
    return words.every(Boolean) ? words.join('') : trimmed;
  }
  if (
    !/^(?:[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|[a-z]{2,}[a-z0-9]*(?:[A-Z][a-z0-9]+)+)$/.test(
      trimmed,
    )
  )
    return trimmed;
  const parts = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split('_')
    .filter(Boolean);
  // FIX-48 #2: a word with no entry would leave half a translation (「final页面height」) — the
  // name then reads as its plain English words instead.
  if (!parts.every((word) => FIELD_WORDS[word.toLowerCase()])) return parts.join(' ');
  const words = parts.map((word) => FIELD_WORDS[word.toLowerCase()] as string);
  return words.reduce(
    (out, word) =>
      !out
        ? word
        : /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(word)
          ? `${out} ${word}`
          : `${out}${word}`,
    '',
  );
}

function explicitFacts(input: unknown): Fact[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 60).flatMap((field): Fact[] => {
    if (!field || typeof field !== 'object') return [];
    const f = field as Record<string, unknown>;
    const name = typeof f.name === 'string' ? f.name.slice(0, 80) : '字段';
    // FIX-38: 「7段占位文本（ref e12…）」 is checked as 「7段占位文本」.
    const value = typeof f.value === 'string' ? clean(stripInternalRefs(f.value)) : '';
    // Summaries and explanations are the model's own words, not page facts; a browser
    // handle (tab / frame id, element ref) is no page fact either (FIX-36 core-07).
    if (!value || PROSE_FIELD.test(name) || value.length > 300 || HANDLE_ONLY_RE.test(value))
      return [];
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

/**
 * Text up to the first full-width comma that is not inside brackets. FIX-44 (Deploy-44
 * core-06 「（章节标题：研究課題），…」): a closing bracket the value never opened ends the
 * field there — the field sat inside the prose's own parenthetical.
 */
function beforeOuterComma(value: string): string {
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if ('（(【['.includes(ch)) depth++;
    else if ('）)】]'.includes(ch)) {
      if (depth === 0) return value.slice(0, i);
      depth--;
    } else if (ch === '，' && depth === 0) return value.slice(0, i);
  }
  return value;
}

// DEPLOY-46 (local A/B, A core-11 「visible_text_blocks_after_5_scrolls：e12, e13, e19…」): a list
// of element refs is a browser handle too.
const HANDLE_ONLY_RE =
  /^\s*(?:(?:tab|frame)_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|ref=e\d+|e\d{1,6}(?:\s*[,，、]\s*e\d{1,6})+)\s*$/;

function answerFacts(summary: string, intent = ''): Fact[] {
  const text = unescapeLiteralBreaks(summary);
  const asked = normalizeFact(intent);
  const facts: Fact[] = [];
  const add = (raw: Fact) => {
    // FIX-36 (core-07): a browser handle (tab id, element ref) is not a page fact to check;
    // FIX-38: nor is one inside a value.
    if (HANDLE_ONLY_RE.test(raw.value)) return;
    const fact = { ...raw, value: stripInternalRefs(raw.value).trim() };
    if (fact.value && fact.value.length <= 300) facts.push(fact);
  };
  for (const url of text.match(TEXT_URL_RE) ?? []) add({ name: '链接', value: url });
  // A labelled run that lists URLs ("标题：1) https://… → X") is handled per item below;
  // a label that ends its line ("读取标题：\n1. …") heads a list, each line checked below;
  // a numeric label whose value has no number is prose ("播放量为页面原样字符串").
  for (const match of text.matchAll(
    new RegExp(`(${FACT_LABELS})\\s*[*\`]*\\s*(?:[:：]|为|是)[ \\t]*([^\\n；;|。]+)`, 'giu'),
  )) {
    if (/https?:\/\//i.test(match[2]!)) continue;
    if (NUMERIC_LABEL.test(match[1]!) && !/\d/.test(match[2]!)) continue;
    // A quoted value is exactly what is inside the quotes; otherwise prose after a
    // full-width comma is not part of the value.
    // "读取标题：1. Safari …；2. …" — the list marker is not part of the value (not "3.15.1").
    const raw = match[2]!.trim().replace(/^\d{1,3}[.)、](?!\d)\s*/u, '');
    const first = quotedRuns(raw)[0];
    const quoted = first?.index === 0 ? first.quote : raw.match(/^『([^』]+)』/u)?.[1];
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
    // A quoted value keeps the pair of marks inside it (「“HOLA DAY AI”的搜索结果」).
    const bare = quoted
      ? stripEdgeQuotes(value).replace(/^[\s*`#>]+|[\s*`。，,;；]+$/g, '')
      : clean(value);
    add({
      name: match[1]!,
      value: bare,
      ...(qualified ? { listItem: true } : {}),
    });
  }
  // A quoted string with Latin letters or digits claims literal page text
  // ("You clicked: Ok"); a negated mention ("而非 …") is not a claim.
  // Pair every quote, short ones too: skipping "阴" would pair its closing mark
  // with the next opening one and quote the prose between them (FIX-24).
  for (const match of quotedRuns(text)) {
    if (match.quote.trim().length < 3) continue;
    // "Impedit iure omnis..." quotes the opening of a passage: compare the excerpt.
    const quote = stripEdgeQuotes(match.quote).replace(/^(?:\.{3,}|…+)\s*|\s*(?:\.{3,}|…+)$/gu, '');
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (
      /[A-Za-z]{3,}|\d/.test(quote) &&
      // Short symbol/number snippets ("0/1") are not page-text claims.
      (/[A-Za-z]/.test(quote) || quote.length >= 4) &&
      // The user's own words ("搜索「Playwright tutorial」") are not a page claim.
      !asked.includes(normalizeFact(quote)) &&
      !/而非|不是|并非|并不是|没有|未出现|误引|instead of|rather than|not\s*$/i.test(before) &&
      // A retracted quote ("此前误引的 “…” 并非页面内容") is not a claim either.
      !/^[^。；\n]{0,6}(?:并非|不是|并不是|有误|是误引)/u.test(
        text.slice(match.index + match.length),
      )
    )
      add({ name: '原文引用', value: quote, quote: true });
  }
  let headers: string[] | undefined;
  /**
   * FIX-42 (Deploy-42 dy-1 / xhs-read): 「| 项目 | 内容 |」 over 「| **标题** | … |」 is a label/value
   * table — its first row is a row, not the header (its labels were checked as 标题 values).
   */
  let keyValue = false;
  let previous: string[] | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) {
      previous = undefined;
      keyValue = false;
    }
    if (line.trim().startsWith('|')) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(clean);
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) {
        // The row over the separator is the header.
        if (
          previous?.length === 2 &&
          !previous.some((cell) => new RegExp(FACT_LABELS, 'i').test(cell))
        ) {
          headers = undefined;
          keyValue = true;
        }
        continue;
      }
      previous = cells;
      if (keyValue) {
        if (cells.length === 2 && new RegExp(FACT_LABELS, 'i').test(cells[0]!))
          add({ name: cells[0]!, value: cells[1]!.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') });
        continue;
      }
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
      add({
        name: '条目标题',
        value: clean(item[1]!),
        sourceURL: url,
        listItem: true,
      });
      continue;
    }
    // "URL → 标题 X": the title is claimed for that page.
    const arrow = line.match(
      /(https?:\/\/\S+?)\s*(?:→|->|=>)\s*(?:标题\s*[:：]?\s*)?["“「]?([^"”」\n；;]+?)["”」]?\s*(?:[；;。]|$)/u,
    );
    const arrowUrl = arrow?.[1]?.match(TEXT_URL_RE)?.[0];
    if (arrow && arrowUrl) {
      add({
        name: '标签标题',
        value: clean(arrow[2]!),
        sourceURL: arrowUrl,
        listItem: true,
      });
      continue;
    }
    // A short numbered list line without prose (e.g. search-result titles).
    const listed = line.match(/^\s*\d+[.)、]\s+(.+)$/u)?.[1];
    // FIX-36 (Deploy-36 b-p02): 「名称 — SGD 11.47」 is a name and its price, each its own
    // node on the page — checked apart, not as one run of text.
    // FIX-47 (Deploy-47 b-p02 「… — S$12.81（从该商品详情页读取）」): a note after the price says where
    // it was read; the name and the price are still the facts. DEPLOY-48 复审 #2: a note with a number
    // or a currency in it (「（原价 S$30）」) states facts of its own, checked below.
    const priced = listed?.match(
      /^(.+?)\s+[—–-]{1,2}\s+((?:s\$|us\$|\$|¥|￥|€|£|sgd|usd|rmb|cny)\s*\d[\d,]*(?:\.\d+)?)\s*(?:[（(]([^（）()\n]{1,40})[)）])?\s*$/iu,
    );
    // …and 「sample.json，大小 95 bytes」 a file name and its size (local core-09).
    const sized = listed?.match(
      /^(.+?)[，,]\s*(?:文件)?大小[：:为]?\s*(\d[\d,]*\s*(?:bytes?|字节|kb|mb|b))\s*$/iu,
    );
    if (sized && !/https?:\/\//i.test(listed!)) {
      add({ name: '条目', value: clean(sized[1]!), listItem: true });
      add({ name: '文件大小', value: clean(sized[2]!), listItem: true });
      continue;
    }
    if (priced && !/[：*]/.test(priced[1]!) && !/https?:\/\//i.test(listed!)) {
      add({ name: '条目', value: clean(priced[1]!), listItem: true });
      add({ name: '价格', value: clean(priced[2]!), listItem: true });
      // PR #311 review: every price in a note is checked (「原价 S$30 现价 S$99」), and what is left
      // with a number in it too.
      // PR #311 review: not at a thousands separator (「S$1,299」 is one price).
      // FIX-48 #3: only a price is checked — a note with a number that is no price (「约 2 天送达」)
      // says nothing the page must show.
      for (const piece of (priced[3] ?? '').split(/[，；;、]|,(?!\d{3}\b)/))
        for (const price of notePrices(piece))
          add({ name: '价格（括注）', value: clean(price), listItem: true });
      continue;
    }
    // FIX-41 (local f41a core-07): 「Safari (web browser) → 新标签，标题为“Safari (web browser) -
    // Wikipedia”」 — prose around a quoted title: the quoted title is what the line claims.
    const quoted = listed
      ? [...listed.matchAll(/[“「"]([^”」"\n]{2,150})[”」"]/gu)].map((match) => clean(match[1]!))
      : [];
    if (quoted.length && !/https?:\/\//i.test(listed!)) {
      for (const value of quoted) add({ name: '条目', value, listItem: true });
      continue;
    }
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

/**
 * FIX-32 (Deploy-32 b-p02): a regional page writes one price as 「S$11.46」 or 「SGD 11.46」.
 * The other spellings of a normalized price value, so either grounds the other.
 */
const CURRENCY_SYMBOLS: Record<string, string[]> = {
  sgd: ['s$'],
  usd: ['us$'],
  hkd: ['hk$'],
  twd: ['nt$'],
  aud: ['a$', 'au$'],
  cad: ['c$', 'ca$'],
  cny: ['¥'],
  rmb: ['¥'],
  jpy: ['¥'],
  eur: ['€'],
  gbp: ['£'],
  krw: ['₩'],
  inr: ['₹'],
};
/**
 * FIX-36 (Deploy-36 core-09): 「1145 字节」 is the download receipt's 「1145 bytes」 /
 * `"sizeBytes":1145` in another language.
 */
function byteForms(value: string): string[] {
  const n = value.match(/^(\d+)\s*(?:字节|bytes?|b)$/)?.[1];
  return n ? [`${n} bytes`, `"sizebytes":${n}`] : [];
}

function currencyForms(value: string): string[] {
  const m = value.match(/^([a-z]{3}|[a-z]{0,2}\$|[¥€£₩₹])\s?(\d+(?:\.\d+)?)$/);
  if (!m) return [];
  const [, unit, amount] = m as unknown as [string, string, string];
  const codes = CURRENCY_SYMBOLS[unit]
    ? [unit]
    : Object.keys(CURRENCY_SYMBOLS).filter((code) => CURRENCY_SYMBOLS[code]!.includes(unit));
  return codes.flatMap((code) =>
    [code, ...CURRENCY_SYMBOLS[code]!].flatMap((form) => [`${form}${amount}`, `${form} ${amount}`]),
  );
}

/**
 * A fee amount, not the item's price (D31 b-p02: 「s$9.53 delivery wed, oct 28」). Only the
 * amount goes: 「price s$14.99, s$9.53 delivery」 still shows the item's own price.
 */
const CURRENCY_MARK = '(?:[a-z]{0,3}\\$|[¥€£₩₹]|\\b[a-z]{3} ?)?';
const FEE_AMOUNT_RE = new RegExp(
  `${CURRENCY_MARK}\\d[\\d.,]*\\s*(?:delivery|shipping|import (?:fees?|charges?)|运费|配送费|邮费|快递费)` +
    `|(?:运费|配送费|邮费|快递费|delivery(?: fee)?|shipping(?: fee)?)\\s*[:：]?\\s*${CURRENCY_MARK}\\d[\\d.,]*`,
  'gi',
);

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

/**
 * FIX-27 (core-02): a page's text values in reading order — an accessibility
 * tree's node values without roles, refs and link targets, a text read's
 * non-empty lines. weather.com shows pressure as two nodes, 「"29.89"」 and
 * 「in」, which only read as 「29.89 in」 side by side.
 */
function pageValues(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (/^-\s*\/url:/.test(line)) continue;
    // FIX-29: a counter's text line carries its kind (`- text [互动=点赞]: "20"`).
    const node = /\[ref=|^-\s*text\b/.test(line)
      ? line.match(/^-\s*[a-z]+(?:\s+"(.*?)")?(?:\s*\[[^\]]*\])*\s*(?::\s*(.*))?$/)
      : null;
    // 「- link "Sauce Labs" [ref=e23]:」 ends in a colon with nothing after it:
    // the node's name is its text (sa2 core-11 footer).
    const value = (node ? node[2] || node[1] || '' : line).replace(/^"(.*)"$/, '$1').trim();
    if (value) out.push(value);
  }
  return out;
}

/**
 * A quote compared across the page's nodes: quote marks as one (a 「」 inside
 * 「…」 is often retyped “”), and no space where nodes meet at Chinese text or
 * punctuation (「…搜索结果页。」「来源：…」 read as one sentence).
 */
function looseQuote(value: string): string {
  return value
    .replace(/[「」『』]/g, '"')
    .replace(/\s+(?=[\p{Script=Han}\p{P}])|(?<=[\p{Script=Han}\p{P}])\s+/gu, '');
}

/**
 * `value` in `text` as a whole token run: 「29.89 in」 is not inside 「129.89 inch」.
 * Chinese text has no word breaks: an edge that is not a Latin letter or digit
 * needs none (with `cjkEdges`).
 */
function containsToken(text: string, value: string, cjkEdges = false): boolean {
  const latin = (ch: string | undefined) => !cjkEdges || /[A-Za-z0-9]/.test(ch ?? '');
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
    const before = text[at - 1] ?? ' ';
    const after = text[at + value.length] ?? ' ';
    if (
      (!latin(value[0]) || !/[\p{L}\p{N}.]/u.test(before)) &&
      (!latin(value[value.length - 1]) || !/[\p{L}\p{N}]/u.test(after))
    )
      return true;
  }
  return false;
}

/**
 * The value printed after the fact's own label (「气压」 → 「29.86 in」) when it
 * has the fact's shape, so a mismatch is told against the right line.
 */
function labelledValue(values: string[], label: string, shape: string): string | undefined {
  const name = label.replace(/[:：]\s*$/, '');
  if (!name) return undefined;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i]!.replace(/[:：]\s*$/, '') !== name) continue;
    for (let j = i + 1; j <= i + 4 && j < values.length; j += 1)
      for (let k = 1; k <= 3 && j + k <= values.length; k += 1) {
        const run = values.slice(j, j + k).join(' ');
        if (/\d/.test(run) && skeleton(run) === shape) return run;
      }
  }
  return undefined;
}

/**
 * The page value a quote is only the label of (「You clicked」 / 「You clicked:」
 * of 「You clicked: Cancel」), when the quote appears nowhere else in full.
 */
function cutQuote(candidates: string[], values: string[]): string | undefined {
  for (const v of candidates) {
    const bare = v.replace(/[:：]\s*$/, '').trim();
    if (bare.length < 3) continue;
    const holding = values.filter((value) => value.includes(v));
    if (!holding.length) continue;
    const cut = (value: string) => {
      const colon = value.search(/[:：]/);
      return (
        colon > 0 && value.slice(0, colon).trim() === bare && /\S/.test(value.slice(colon + 1))
      );
    };
    if (holding.every((value) => value !== v && cut(value))) return holding[0];
  }
  return undefined;
}

const NOT_READ =
  /^(?:未读到|未读取到|未获取到|未找到|没有读到|页面未(?:提供|显示|列出)|not (?:shown|found|read)|n\/a)[。.]?$/i;

const NAME_FIELD = /作者|频道|博主|up\s*主|账号|店铺|author|channel|uploader/i;
const HEDGE_RE =
  /推断|推测|疑似|可能(?:是|为)|相关账号|未(?:显式|直接|明确)?(?:展示|显示|给出|标注)|not (?:explicitly )?shown|likely|appears to be/i;

/** The names a hedged value puts forward: 「“小喵麻麻/喵妈”」 → 小喵麻麻, 喵妈. */
function hedgedCandidates(value: string): string[] {
  return [...value.matchAll(/[“"「『]([^”"」』\n]{1,40})[”"」』]/g)]
    .flatMap((m) => (m[1] ?? '').split(/[/／、]/))
    .map((name) => name.trim().replace(/^[@#]/, ''))
    .filter((name) => name.length >= 2);
}

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
    const values = pageValues(lines);
    const joined = values.join(' ');
    return {
      ...page,
      lines,
      norm: lines.join(' '),
      values,
      joined,
      loose: looseQuote(joined),
    };
  });
  const receipts = normalizeFact(input.receipts ?? '');
  const contradictions: string[] = [];
  const unverified: string[] = [];
  const misquoted: Array<{ quote: string; nearest?: string }> = [];
  const binding: NonNullable<FactAssessment['binding']> = [];
  const hedged: NonNullable<FactAssessment['hedgedNames']> = [];
  const unreadPrices: string[] = [];
  const seen = new Set<string>();
  const facts = [...explicitFacts(input.fields), ...answerFacts(input.summary, intent)].flatMap(
    (fact): Fact[] => {
      // A parenthetical that carries numbers is its own fact, checked separately.
      // Titles and list items often carry parentheses as part of the name.
      const split = fact.listItem || TITLE_FIELD.test(fact.name) ? null : splitNote(fact.value);
      if (!split || !/\d/.test(split.note)) return [fact];
      // Only the pieces of the note that carry numbers are facts of their own — and of a price, only
      // the prices in it (FIX-48 #3: 「S$7.40（约 2 天送达）」 is no second price).
      const pieces = PRICE_FIELD_RE.test(fact.name)
        ? split.note.split(/[，；;、]|,(?!\d{3}\b)/).flatMap(notePrices)
        : split.note
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
    // FIX-34: 「未获取到（快照截断）」 too — the note explains the absence.
    if (NOT_READ.test(fact.value.trim()) || NOT_READ.test((withoutNote(fact.value) ?? '').trim()))
      continue;
    // FIX-34 (dy-2): a hedge about a name says what the page lacks — not a page quote.
    // When the page does show one of its names as a node of its own (the author link),
    // the name is written plainly instead.
    if (NAME_FIELD.test(fact.name) && HEDGE_RE.test(fact.value)) {
      // The answer's field stops at 「；」: the names it puts forward follow on its line.
      const line =
        unescapeLiteralBreaks(input.summary)
          .split('\n')
          .find((l) => l.includes(fact.value)) ?? fact.value;
      const shown = hedgedCandidates(line).find((name) =>
        pages.some((page) => page.values.some((v) => v.replace(/^@\s*/, '') === name)),
      );
      if (shown) hedged.push({ label: `${fact.name}「${fact.value.slice(0, 120)}」`, name: shown });
      continue;
    }
    // The quoted part of a labelled value; a quote's own inner quote is only a piece of it.
    const quoted = fact.quote ? undefined : quotedRuns(fact.value)[0]?.quote;
    const candidates = [fact.value, withoutNote(fact.value), quoted, stripEdgeQuotes(fact.value)]
      .filter((v): v is string => Boolean(v))
      .map(normalizeFact)
      .flatMap((v) => [v, ...currencyForms(v), ...byteForms(v)]);
    const bound = (page: (typeof pages)[number]) =>
      (!fact.tabId || page.tabId === fact.tabId) &&
      (!fact.sourceURL || sameSource(page.sourceURL, fact.sourceURL));
    const eligible = pages.filter(bound);
    const label = `${fieldLabel(fact.name)}「${fact.value.slice(0, 120)}」`;
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
            // A value split over adjacent nodes (「29.89」「in」).
            (/\s/.test(v) && containsToken(page.joined, v)) ||
            // FIX-28 (sa2 core-11, D16): a quote read across adjacent nodes.
            ((fact.quote || /["「」『』]/.test(v)) &&
              containsToken(page.loose, looseQuote(v), true)) ||
            (page.sourceURL &&
              (normalizeFact(page.sourceURL) === v || sameSource(page.sourceURL, fact.value))) ||
            page.links?.some((link) => normalizeFact(link.url) === v),
        ) ||
        // Host receipts (download, typed text, scroll) are facts whatever the binding.
        receipts.includes(v) ||
        // FIX-27 (core-02): the address of a page the run read is that page's own
        // fact, also when the answer files it under the results page that linked
        // to it (Brave's /weather/today/l/… landed on /sg/city/singapore/today).
        (/^https?:\/\//.test(v) &&
          pages.some(
            (page) => !!page.sourceURL && sameSource(page.sourceURL, fact.value.trim()),
          )) ||
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
    // FIX-28 (rb2 core-10): 「You clicked」 is only the front of the page's 「You
    // clicked: Cancel」 — a label quoted without its value is not the page's text.
    const inTools =
      !grounded &&
      fact.quote &&
      candidates.some((v) => normalizeFact(input.toolTexts ?? '').includes(v));
    if ((grounded || inTools) && fact.quote) {
      const cut = cutQuote(
        candidates,
        pages.flatMap((page) => page.values),
      );
      if (cut) {
        contradictions.push(`${label} 只抄了页面原文的前半截`);
        // The page's own casing of the whole text, for the model to copy.
        const escaped = cut.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const whole =
          input.pages
            .map((page) => unescapeLiteralBreaks(page.text).match(new RegExp(escaped, 'i'))?.[0])
            .find(Boolean) ?? cut;
        misquoted.push({ quote: fact.value, nearest: whole });
        continue;
      }
    }
    if (grounded || inTools) continue;
    if (!pages.length) {
      contradictions.push(`${label} 没有成功读取的页面可以支持（页面未加载或未读取）`);
      continue;
    }
    // FIX-34 (Deploy-34 amazon-sg): an item's name or price bound to a tab the run never
    // read is still grounded when a read page shows it beside that same item's title.
    if (
      (fact.tabId || fact.sourceURL) &&
      !eligible.length &&
      candidates.some((v) => itemShownOnPage(input.summary, v, pages))
    )
      continue;
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
      // The value after the fact's own label first; 「0 in」 of rainfall is not
      // the pressure's page value.
      const name = normalizeFact(fact.name);
      // FIX-32: a price is never contradicted by the delivery fee shaped like it.
      const priceValue = currencyForms(value).length > 0 || /价|price/i.test(fact.name);
      const scrub = (run: string) => (priceValue ? run.replace(FEE_AMOUNT_RE, ' ') : run);
      const labelled = eligible
        .map((page) => labelledValue(page.values.map(scrub), name, shape))
        .find((run) => run !== undefined);
      // FIX-34 (Deploy-34 amazon-sg): on a page listing several prices, a price-shaped line
      // (「kitchen bestsellers under s$30」) belongs to another item; only a single-price
      // page (one product) can contradict a price that way.
      const lines = eligible.flatMap((page) => page.lines.map(scrub));
      const listing =
        priceValue && new Set(lines.flatMap((line) => line.match(PRICE_SHAPE_RE) ?? [])).size > 1;
      const conflict =
        labelled ??
        (listing
          ? undefined
          : lines.find((line) => /\d/.test(line) && skeleton(line).includes(shape)));
      if (conflict) {
        contradictions.push(`${label} 与页面不符；页面为「${conflict.trim().slice(0, 120)}」`);
        continue;
      }
      // …but a listed price that no read page shows at all was not read (f34d/f34f: a
      // price written for the item the snapshot was cut at).
      if (
        listing &&
        new RegExp(`^(?:${PRICE_SHAPE_RE.source})$`, 'i').test(
          value.replace(/[。.，,]$/, '').trim(),
        ) &&
        // A value the answer says it read on a given page is that page's question
        // (the binding check asks for the page to be read), not a second contradiction.
        !facts.some(
          (other) =>
            (other.tabId || other.sourceURL) &&
            !pages.some(
              (page) =>
                (!other.tabId || page.tabId === other.tabId) &&
                (!other.sourceURL || sameSource(page.sourceURL, other.sourceURL)),
            ) &&
            normalizeFact(withoutNote(other.value) ?? other.value) === value,
        ) &&
        !pages.some((page) => candidates.some((v) => page.norm.includes(v)))
      ) {
        contradictions.push(
          `${label} 不在任何已读页面上：列表在该商品处截断时写「未获取到」，或打开该商品页读取后再写`,
        );
        unreadPrices.push(label);
        continue;
      }
    }
    // A single page title that differs from the page's own main heading.
    if (fact.quote) {
      contradictions.push(`${label} 不是已读页面中的原文`);
      misquoted.push({
        quote: fact.value,
        nearest: nearestPassage(fact.value, input.pages),
      });
      continue;
    }
    if ((TITLE_FIELD.test(fact.name) || PAGE_FIELD.test(fact.name)) && !fact.listItem) {
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
      if (
        TITLE_FIELD.test(fact.name) &&
        heading &&
        !candidates.some((v) => v.includes(main) || main.includes(v))
      ) {
        contradictions.push(`${label} 与页面一级标题「${heading.slice(0, 120)}」不符`);
        continue;
      }
      // FIX-37 (Deploy-37 core-06): 「页面：中国历史 - 维基百科」 is the read page's document
      // title — its h1 plus the site's suffix — so it is grounded, not 未核实.
      if (main && candidates.some((v) => v.replace(SITE_SUFFIX_RE, '').trim() === main)) continue;
    }
    // FIX-47 (Deploy-47 core-06 「导致大量“AI幻觉案例”」 on the English Wikipedia page): Chinese words
    // for a page with no Chinese text are a translation — no read page could show them verbatim.
    // A Chinese page that lacks them still gets the note. PR #311 review: only a listed or quoted
    // term — a name, title or other labelled value (「作者：张三」) is still checked as written.
    // DEPLOY-48 复审 #1: written as the page's words (in 「」/“”, or after 页面提到 / 原文) it is still
    // noted — as a rendering not checked word for word; only a plain listed term goes unnoted.
    if (
      fact.listItem &&
      !NAME_FIELD.test(fact.name) &&
      !TITLE_FIELD.test(fact.name) &&
      translatedWords(fact.value) &&
      pages.every((page) => englishPage(page.text))
    ) {
      if (quotedAsPage(input.summary, fact.value)) unverified.push(`${label}${TRANSLATED_MARK}`);
      continue;
    }
    unverified.push(label);
  }
  // FIX-30: every named target answered (core-10), and recent means recent (n03).
  for (const gap of uncoveredTargets(intent, input.summary, input.pages))
    contradictions.push(
      gap.kind === 'missing'
        ? `任务要求的「${gap.target}」在答案里没有出现：请完成并写出这一部分，做不到就如实说明，不要只交另一部分`
        : `答案提到了「${gap.target}」，但本次读过的页面里都没有它（没有打开过这一部分）：请打开并读取它再写，做不到就如实写「${gap.target} 部分未完成」，不要说已验证`,
    );
  const stale = staleForRecentIntent(
    intent,
    input.summary,
    new Date(),
    input.pages.map((page) => page.text),
  );
  if (stale) contradictions.push(stale);
  // FIX-29: a like/comment/favourite/share number must be that counter's, not the icon next to it.
  contradictions.push(
    ...assessEngagementClaims(
      input.summary,
      input.pages.map((page) => page.text),
    ),
  );
  return {
    contradictions: contradictions.slice(0, 8),
    unverified: unverified.slice(0, 8),
    ...(misquoted.length && misquoted.length === contradictions.length ? { misquoted } : {}),
    ...(binding.length && binding.length === contradictions.length ? { binding } : {}),
    ...(unreadPrices.length && unreadPrices.length === contradictions.length
      ? { unreadPrices }
      : {}),
    ...(hedged.length ? { hedgedNames: hedged.slice(0, 4) } : {}),
  };
}

/** Marks a translated term in the 未核实 list; `unverifiedNote` gives such terms their own line. */
const TRANSLATED_MARK = '（译述）';
/** The answer gives `value` as the page's own words: in quotes, or after 页面提到 / 原文 / 写道. */
function quotedAsPage(summary: string, value: string): boolean {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `[「“"『]\\s*${v}\\s*[」”"』]|(?:页面|原文|文中|网页)(?:上|中|里)?(?:提到|写道|写着|称|说)?[^。！？\\n]{0,6}${v}`,
  ).test(summary);
}
const latinCount = (text: string) => text.match(/[A-Za-z]/g)?.length ?? 0;
const hanCount = (text: string) => text.match(/\p{Script=Han}/gu)?.length ?? 0;
/**
 * Words mostly written in Chinese characters (「AI幻觉案例」). A number can always be checked
 * as written, so a value with digits is never only a translation.
 */
function translatedWords(value: string): boolean {
  return !/\d/.test(value) && hanCount(value) >= 2 && hanCount(value) >= latinCount(value);
}
/** A page of English text — its language menu's 「中文」 aside; a few lines are not enough to tell. */
function englishPage(text: string): boolean {
  const latin = latinCount(text);
  return latin >= 200 && hanCount(text) * 50 < latin;
}

/** User-visible note for facts that could not be matched word for word. */
export function unverifiedNote(unverified: readonly string[]): string {
  // FIX-38: no element ref in the note; an item that quoted only a ref is no item.
  const quote = /[「“][^」”]*[」”]/u;
  const items = unverified
    .map((item) => [item, stripInternalRefs(item)] as const)
    .filter(([item, kept]) => kept.trim() && (!quote.test(item) || quote.test(kept)))
    .map(([, kept]) => kept);
  // DEPLOY-48 复审 #1: a Chinese rendering of an English page's words gets its own line.
  const translated = items
    .filter((item) => item.endsWith(TRANSLATED_MARK))
    .map((item) => item.slice(0, -TRANSLATED_MARK.length));
  const plain = items.filter((item) => !item.endsWith(TRANSLATED_MARK));
  return [
    plain.length ? `未核实：以下内容未能在已读页面中逐字找到，请自行确认——${plain.join('；')}` : '',
    translated.length
      ? `译述，未逐字核对：以下内容是对英文页面的中文转述，页面上没有这些字，请自行确认——${translated.join('；')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
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

const CARD_PRICE_RE = /(?:s\$|us\$|\$|¥|￥|€|£|sgd|usd|rmb|cny)\s*\d[\d,]*(?:\.\d+)?/gi;
/** A tree node line: 「- role "name" [ref=…]: text」 (an accessibility snapshot). */
const TREE_NODE_RE = /^\s*-\s+'?[a-z]/;
/** A node's own texts: its quoted name and the text after its colon. */
function nodeTexts(line: string): string[] {
  const t = line.trim();
  return [
    t.match(/"([^"]+)"/)?.[1],
    t.match(/\]:\s*(.+)$/)?.[1] ?? t.match(/^-\s*'?[a-z]+:\s*(.+)$/)?.[1],
  ]
    .filter((v): v is string => Boolean(v?.trim()))
    .map((v) => normalizeFact(v));
}

/**
 * The product card around tree line `at` (协调方复审阻塞 2 / 复审 #2): the largest enclosing
 * element (by the snapshot's indentation) that is still one product's — no node naming a
 * different product (any node type; a longer or shorter title is a different one), at most
 * one distinct price and at most one product link. An amazon listitem holds its title
 * link, heading, rating and price; the list around it holds the next items.
 */
function cardAround(lines: string[], at: number, name: string): string[] | null {
  if (!TREE_NODE_RE.test(lines[at]!)) return null;
  const indent = (k: number) => lines[k]!.length - lines[k]!.trimStart().length;
  const blockEnd = (a: number) => {
    let e = a + 1;
    while (e < lines.length && (!lines[e]!.trim() || indent(e) > indent(a))) e++;
    return e;
  };
  const oneProduct = (from: number, to: number) => {
    const block = lines.slice(from, to);
    // A card's struck-through list price (「Was: S$23.93」「原价」) is not a second price.
    const listPrice = new RegExp(
      String.raw`(?:was|list(?:\s*price)?|typical(?:\s*price)?|rrp|原价|划线价)\s*:?\s*(?:${CARD_PRICE_RE.source})`,
      'gi',
    );
    const text = block.map(normalizeFact).join('\n');
    // Its value repeats in nodes of its own (「- generic: S$23.93」): drop it everywhere.
    const listed = new Set(
      [...text.matchAll(listPrice)].flatMap((m) =>
        (m[0].match(CARD_PRICE_RE) ?? []).map(normalizeFact),
      ),
    );
    const prices = new Set(
      (text.match(CARD_PRICE_RE) ?? []).map(normalizeFact).filter((v) => !listed.has(v)),
    );
    // Product links: long link texts that are not a price (「S$8.90 Was: S$23.93」).
    const links = new Set(
      block.flatMap((line) => {
        const m = line.trim().match(/^-\s*'?link\s+"([^"]{20,})"/);
        return m && !new RegExp(CARD_PRICE_RE.source, 'i').test(m[1]!)
          ? [normalizeFact(m[1]!)]
          : [];
      }),
    );
    const other = block.some((line) =>
      nodeTexts(line).some(
        (t) =>
          t !== name &&
          t.length >= 20 &&
          !new RegExp(CARD_PRICE_RE.source, 'i').test(t) &&
          // A different product: shares the title (a longer or shorter one), or is a
          // product link of its own.
          (t.includes(name) || name.includes(t) || /^-\s*'?link\s/.test(line.trim())),
      ),
    );
    return prices.size <= 1 && links.size <= 1 && !other;
  };
  let [start, end] = [at, blockEnd(at)];
  if (!oneProduct(start, end)) return null;
  for (let a = at - 1, level = indent(at); a >= 0 && level > 0; a--) {
    if (!lines[a]!.trim() || indent(a) >= level) continue;
    level = indent(a);
    const e = blockEnd(a);
    if (!oneProduct(a, e)) break;
    [start, end] = [a, e];
  }
  return lines.slice(start, end);
}

/**
 * FIX-34: the answer's row holding `value` (as its name or its price), and a read page
 * whose product card for that row's whole name also shows that price — the same element
 * block, never a character window that runs into the next card (协调方复审阻塞 2).
 */
function itemShownOnPage(
  summary: string,
  value: string,
  pages: ReadonlyArray<{ text: string }>,
): boolean {
  const rows = summary
    .split('\n')
    .map((line) => normalizeFact(line))
    .filter((line) => line.includes(value));
  return rows.some((row) => {
    const price = row.match(new RegExp(CARD_PRICE_RE.source, 'i'))?.[0];
    const name = row
      .replace(/^\s*(?:\d+[.)、]\s*)?(?:名称|商品名?|标题|name)?\s*[:：]?\s*/i, '')
      .split(/[；;]|\s[—–]\s|(?:价格|售价|price)\s*[:：]/i)[0]
      ?.trim();
    if (!price || !name || name.length < 8) return false;
    const want = normalizeFact(price);
    return pages.some((page) => {
      const lines = unescapeLiteralBreaks(page.text).split('\n');
      return lines.some((line, i) => {
        const norm = normalizeFact(line);
        const at = norm.indexOf(name);
        // The whole name: 「…, 2M」 is not the 「…, 1M」 it shares a prefix with.
        if (at < 0 || /[\p{L}\p{N}]/u.test(norm[at + name.length] ?? '')) return false;
        return (cardAround(lines, i, name) ?? []).some((cardLine) =>
          (normalizeFact(cardLine).match(CARD_PRICE_RE) ?? []).some(
            (shown) => normalizeFact(shown) === want,
          ),
        );
      });
    });
  });
}

/** Fields a user names in a read request (「读视频标题、作者，以及点赞数…」). */
const ASKABLE_FIELDS = [
  '标题',
  '作者',
  '频道',
  '点赞数',
  '评论数',
  '收藏数',
  '分享数',
  '播放量',
  '价格',
  '发布日期',
  '回答数',
  '库存',
  '评分',
  '地址',
  '开放时间',
] as const;
/**
 * 「页面未显示」「未获取到（…）」: the answer says the page had no such value. FIX-47 (Deploy-47 dy-1):
 * 「无法确认」 gives no value either.
 */
const DECLARED_ABSENT_RE =
  /^\s*[*_`]*\s*(?:页面(?:上|中)?(?:未|没有)(?:显示|提供|列出|给出)|未(?:在页面(?:上|中)?)?(?:显示|获取到|读到|读取到|找到|展示)|没有读到|(?:无法|不能|未能)(?:确认|确定|判断)|not (?:shown|found|read|displayed)|n\/a)/i;
/** FIX-47: a sentence saying which number is which cannot be told (「没有标签能确认…无法确认各项具体数值」). */
const UNSURE_RE = /(?:无法|不能|未能|没法)(?:确认|确定|判断|对应|区分)|没有标签能?(?:确认|对应)/;

/**
 * FIX-35 0b (Deploy-35 dy-2): fields the user asked for by name that the answer gives as
 * absent. Such an answer is 部分完成, not completed.
 */
/** The fields of ASKABLE_FIELDS a request names (复审 #2: a prose answer's 部分完成 count). */
export function askedFields(intent: string): string[] {
  return ASKABLE_FIELDS.filter((name) => intent.includes(name));
}

/**
 * FIX-45 (Deploy-45 b-p02 「第3条商品在搜索结果页快照中未显示价格，已打开其详情页读取到价格为 S$12.80」):
 * the gap is told and then filled — in the same sentence or the next one the field's value is
 * read after all. Not absent. DEPLOY-46 复审 #1: only a real value (not 「推测是…」「待确认」「谁」
 * 「？」「—」), of the same item (not another one, nor a 推荐 / 相关 / 其他 item), that a page the
 * run read shows. With no pages to check it against, nothing is filled.
 */
function filledAfter(prose: string, at: number, name: string, pages?: readonly string[]): boolean {
  if (!pages?.length) return false;
  const next = prose.slice(at).match(/^[^。！？!?\n]*(?:[。！？!?\n][^。！？!?\n]*)?/)![0];
  const absent = '(?![“"「]?(?:页面(?:上|中)?)?(?:未|没有|无法|不详|空|无))';
  const unsure =
    '(?!(?:推测|估计|大概|可能|也许|疑似|似乎|待确认|待定|待查|不清楚|不确定|不详|未知|谁|什么|哪|[？?—–\\-…]))';
  const filled = new RegExp(
    `(?:(?:读到|读取到|获取到|拿到|找到|补上|补齐)了?(?:其|该|它的)?${name}|${name})\\s*(?:为|是|[：:])\\s*${absent}${unsure}(\\S[^，,。；;\\n]{0,79})`,
  ).exec(next);
  if (!filled) return false;
  // PR #309 review: 「第一个视频未显示作者，第二个视频的作者为张三」 — a value for another item fills
  // nothing. Every item named between the gap and the value is the gap's own item.
  const before = next.slice(0, filled.index + filled[0].length - filled[1]!.length);
  if (/推荐|相关|其他|其余|另一|别的/.test(before)) return false;
  const start = Math.max(
    ...['。', '！', '？', '!', '?', '\n'].map((c) => prose.lastIndexOf(c, at - 1)),
  );
  const own = [...prose.slice(start + 1, at).matchAll(ITEM_RE)].at(-1)?.[0].replace(/\s+/g, '');
  if (![...before.matchAll(ITEM_RE)].every((m) => m[0].replace(/\s+/g, '') === own)) return false;
  // The value is the page's: found on a page the run read.
  const value = normalizeFact(filled[1]!.trim().replace(/^[“"「『]|[”"」』]$/g, ''));
  return /[\p{L}\p{N}]/u.test(value) && pages.some((page) => normalizeFact(page).includes(value));
}

/** An item a sentence is about: 「第3条」「第二个」「另一个」「其他」. */
const ITEM_RE =
  /第\s*[一二三四五六七八九十百\d]+\s*(?:个|条|项|本|篇|款|件|位|首|名|家|部|只)?|另一(?:个|条|项|本|篇|款|件|位)?|其他|其余/g;

export function declaredAbsentFields(
  intent: string,
  summary: string,
  fields?: unknown,
  /** DEPLOY-46 复审 #1: the read pages' text — a gap is filled only by a value they show. */
  pages?: readonly string[],
): string[] {
  const asked = ASKABLE_FIELDS.filter((name) => intent.includes(name));
  if (!asked.length) return [];
  const values = new Map<string, string[]>();
  const add = (name: string, value: string) =>
    values.set(name, [...(values.get(name) ?? []), value]);
  for (const line of unescapeLiteralBreaks(summary).split('\n'))
    for (const m of line.matchAll(/([\p{Script=Han}A-Za-z]{2,6})\s*[*`]*\s*[:：]\s*([^；;\n]+)/gu))
      add(m[1]!, m[2]!);
  for (const f of explicitFacts(fields)) add(f.name, f.value);
  const prose = unescapeLiteralBreaks(summary);
  return asked.filter(
    (name) =>
      // PR #311 review: 「点赞数：无法确认。复核后读到点赞数为20」 — a count the answer ends up giving,
      // for every item it names, is answered whatever it said first.
      countState(prose, name) !== 'value' &&
      ([...values].some(
        ([label, vals]) =>
          (label === name || label.endsWith(name)) && vals.some((v) => DECLARED_ABSENT_RE.test(v)),
      ) ||
        // 「页面未显示作者名称」「作者字段按页面原样写“页面未显示”」 — prose, not a 作者：value line.
        [
          ...prose.matchAll(
            new RegExp(
              `(?:页面(?:上|中)?)?(?:未|没有)(?:显示|提供|列出|给出|找到|读到|获取到)${name}`,
              'g',
            ),
          ),
        ].some((m) => !filledAfter(prose, m.index! + m[0].length, name, pages)) ||
        new RegExp(
          `${name}(?:名称|字段)?[^。；;\\n：:（(]{0,10}?[为写]\\s*[“"「]?(?:页面(?:上|中)?未显示|未显示|未获取到|未读到|未找到)`,
        ).test(prose) ||
        unsureCount(prose, name)),
  );
}

/**
 * FIX-47 (Deploy-47 dy-1, verbatim 「页面上显示了 20、2、10、97 这几个数字，但没有标签能确认它们分别对应
 * 点赞、评论、收藏还是分享，无法确认各项具体数值」): a count the user named, said in prose to be
 * unknown and given no number anywhere, was not obtained. A count with its number (「点赞 4741」
 * 「评论数为 215」) is answered, whatever else the answer cannot confirm.
 */
const CN_NUMERALS = '零一二两三四五六七八九十百千万亿';
/** The absence wordings `declaredAbsentFields` reads elsewhere (「页面未显示」「未获取到」「没有读到」). */
const ABSENT_WORDS =
  '(?:(?:未|没有)(?:显示|提供|列出|给出|获取到?|读到|读取到|找到|展示)|没有读到)';
const DERIVED_METRIC =
  '(?:增长|增幅|趋势|变化|走势|涨跌|历史|排名|占比|来源|原因|对比|分布|构成|口径|速度)';
/** An unsure phrase that is about a metric derived from the count, not its value. */
const DERIVED_DOUBT_RE = new RegExp(
  `(?:无法|不能|未能|没法)(?:确认|确定|判断)[^，,；;。]{0,10}?${DERIVED_METRIC}|${DERIVED_METRIC}[^，,；;。]{0,6}?(?:无法|不能|未能|没法)(?:确认|确定|判断)`,
);
/**
 * DEPLOY-48 复审 #4: a guessed number is no answer (「点赞数可能是 20」「推测为 20」). FIX-48 #3: nor
 * an approximate one (「大约 2 万」「约 2 万」 before it, 「一万以上」「2 万左右」 after it).
 */
const HEDGED_VALUE_RE = /可能|推测|猜测|估计|大概|大约|或许|疑似|应该是|似乎|约\s*$/;
const APPROX_AFTER_RE = /^[\d.,万千百亿wWkK]*\s*[个次人条]?\s*(?:以上|左右|上下)/;
/**
 * DEPLOY-48 复审 #4: 「无法确认各项具体数值」 — every count asked for is unknown. FIX-48 #3: in either
 * order and the usual variants (「各项具体数值无法确认」「无法确认各项的具体数值」「以上数值都无法确认」
 * 「不能确定每一项」「无法逐一确认」). 「各项」「每一项」 need no noun; 「每个」「这些」「以上」 do (「无法确认
 * 每个视频的发布时间」 is about dates). Doubt about freshness or a derived metric (「以上数据无法确认
 * 是否实时」「…的增长趋势」) is no doubt about the values.
 */
const UNSURE_VERB = '(?:无法|不能|未能|没法)(?:逐一|一一|逐项)?(?:确认|确定|判断|对应|区分)';
const ALL_COUNTS =
  '(?:(?:各项|每项|每一项)(?:的)?(?:具体)?(?:数值|数字|计数|数据|数量)?|(?:各个|每个|这些|它们|以上|上述|全部|所有|这几个|这几项)(?:的)?(?:具体)?(?:数值|数字|计数|数据|数量))';
/**
 * PR #312 review: the counts themselves are what is doubted — 「各项数据的采集时间无法确认」 doubts a
 * time. After the verb the collective phrase ends the clause (or says which is which); before it,
 * only an adverb (都 / 均 / 暂时…) stands between them.
 */
/** PR #312 review: doubting the values' accuracy withdraws them too (「…是否准确」「…的准确性」). */
const ALL_COUNTS_ACCURACY = '(?:是否(?:准确|正确|真实|可靠)|的?(?:准确性|真实性|可靠性)|准确与否)';
// PR #312 review: an explanation may follow (「…各项具体数值（页面没有标签）」「…各项数值：…」).
const ALL_COUNTS_END = `(?=[，,；;。！？!?）)（(：:—\\s]|$|分别|对应|是多少|${ALL_COUNTS_ACCURACY})`;
/**
 * PR #312 review: a doubt whose object is freshness (「无法确认是否实时」「…其实时性」), not a freshness word
 * anywhere in the clause (「无法确认各项具体数值（页面实时刷新…）」 still doubts the values).
 */
const FRESHNESS_DOUBT_RE =
  /(?:无法|不能|未能|没法)(?:确认|确定|判断)[^，,；;。（(]{0,8}?(?:实时|最新|时效)|(?:实时|最新|时效)[^，,；;。（(]{0,4}?(?:无法|不能|未能|没法)(?:确认|确定|判断)/;
const ALL_COUNTS_ADVERB = '(?:都|均|也|皆|全都|暂时?|目前|仍然?|还)?';
const ALL_COUNTS_UNSURE_RE = new RegExp(
  `${UNSURE_VERB}(?!是否)[^，,；;。]{0,4}?${ALL_COUNTS}${ALL_COUNTS_END}|${ALL_COUNTS}${ALL_COUNTS_ACCURACY}?${ALL_COUNTS_ADVERB}${UNSURE_VERB}(?!是否)`,
);
function unsureCount(prose: string, name: string): boolean {
  return countState(prose, name) === 'doubt';
}

/**
 * What the answer last says about a count, over every item it names: 'doubt' when some item's
 * last word on it is a doubt, 'value' when every item ends with a value, null when it is not
 * mentioned either way.
 */
function countState(prose: string, name: string): 'value' | 'doubt' | null {
  if (!name.endsWith('数')) return null;
  const stem = name.slice(0, -1);
  // PR #311 review: a value and an unsure phrase are about the counts in their own clause
  // (「点赞数为一万，评论数无法确认」「无法确认点赞数；评论数为215」); 「、」 joins the counts one phrase
  // names. A value in Chinese numerals (「一万」) is a value too — DEPLOY-48 复审 #5: only as a
  // number (followed by a unit, a non-Chinese character or the clause end), not 「十分多」.
  const value = new RegExp(
    `${stem}(?:数|量)?([^\\d、]{0,6}?)(?:\\d|[${CN_NUMERALS}]+(?=[个次人条]|以上|左右|上下|[^\\p{Script=Han}]|$))`,
    'u',
  );
  // PR #311 review: a value fills only its own item's gap (「第一个视频点赞数无法确认。第二个视频点赞数为
  // 215」 leaves the first one missing), and what the answer says last about an item stands
  // (「点赞数为20。复核后无法确认点赞数」 withdraws the 20). The item is the last one named in the
  // sentence so far.
  // The count itself, not a word that starts like it (「回答者」「评论区」).
  const mention = new RegExp(`${stem}(?:数|量|(?=[、和与及或还]|[^\\p{Script=Han}]|$))`, 'u');
  // PR #311 review: the count declared absent (「第一个视频点赞数：页面未显示」), right beside it.
  const absent = new RegExp(
    `${stem}(?:数|量)?[^，,；;。\\d]{0,8}?(?:页面(?:上|中)?)?${ABSENT_WORDS}|${ABSENT_WORDS}${stem}`,
    'u',
  );
  const state = new Map<string, 'value' | 'doubt'>();
  for (const sentence of prose.split(/[。！？!?\n]/)) {
    let item = '';
    for (const clause of sentence.split(/[，,；;]/)) {
      const named = [...clause.matchAll(ITEM_RE)].at(-1)?.[0].replace(/\s+/g, '');
      if (named) item = named;
      const m = value.exec(clause);
      // DEPLOY-48 复审 #4: a number guessed (「可能是 20」) or said to be unsure in its clause
      // (「点赞数20无法确认」) is no value.
      // PR #311 review: doubt about a related metric (「无法确认点赞数的增长趋势」) is no doubt about
      // the count itself.
      const unsure = UNSURE_RE.test(clause) && !DERIVED_DOUBT_RE.test(clause);
      // PR #311 review: the guess may open the clause too (「推测点赞数为20」).
      const hedged =
        !!m &&
        (HEDGED_VALUE_RE.test(`${clause.slice(0, m.index)}${m[1] ?? ''}`) ||
          APPROX_AFTER_RE.test(clause.slice(m.index + m[0].length)));
      // A value given in a clause that doubts it (「…分别为 20、2…（无法确认对应关系）」) is doubted too.
      if (
        ((mention.test(clause) || m) && (unsure || hedged)) ||
        absent.test(clause) ||
        (ALL_COUNTS_UNSURE_RE.test(clause) &&
          !DERIVED_DOUBT_RE.test(clause) &&
          !FRESHNESS_DOUBT_RE.test(clause))
      )
        state.set(item, 'doubt');
      else if (m) state.set(item, 'value');
    }
  }
  const states = [...state.values()];
  return states.includes('doubt') ? 'doubt' : states.length ? 'value' : null;
}
