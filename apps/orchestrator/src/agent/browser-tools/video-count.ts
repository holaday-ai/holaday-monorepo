import type { ObservedEvidence } from './completion-fields.js';

/**
 * FIX-28 (Deploy-27 core-04): "YouTube 搜索「Playwright tutorial」返回前5个视频标题"
 * was answered with 3 videos and 2 course cards (the answer's own note said
 * 「（课程/播放列表卡片）」) and delivered as completed. On YouTube a course card is
 * a `yt-lockup-view-model` whose title link is `/watch?v=…&list=…` (or
 * `/playlist?list=…`); only a `/watch?v=` without `list=`, or `/shorts/`, is one
 * video. The answer's items are counted as videos by the links the run read.
 */

/** "前5个视频 / 5个视频 / top 5 videos / first 5 videos" on YouTube: N, else null. */
export function requestedVideoCount(intent: string): number | null {
  if (!/youtube|油管/i.test(intent)) return null;
  const match =
    intent.match(/前\s*(\d{1,2})\s*(?:个|条|部)?\s*(?:视频|影片)/) ??
    intent.match(/(\d{1,2})\s*(?:个|条|部)\s*(?:视频|影片)/) ??
    intent.match(/(?:top|first)\s+(\d{1,2})\s+videos?\b/i);
  const n = match ? Number(match[1]) : Number.NaN;
  return n >= 1 && n <= 50 ? n : null;
}

export type ItemKind = 'video' | 'playlist' | 'channel' | 'unknown';

/** What a YouTube link is, by its own URL. */
export function youtubeLinkKind(url: string): ItemKind | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://www.youtube.com');
  } catch {
    return null;
  }
  if (!/(?:^|\.)youtube\.com$|^youtu\.be$/.test(parsed.hostname)) return null;
  if (parsed.pathname === '/playlist' || parsed.searchParams.has('list')) return 'playlist';
  if (/^\/(?:@|channel\/|c\/|user\/)/.test(parsed.pathname)) return 'channel';
  if (
    (parsed.pathname === '/watch' && parsed.searchParams.has('v')) ||
    parsed.pathname.startsWith('/shorts/') ||
    parsed.hostname === 'youtu.be'
  )
    return 'video';
  return null;
}

/** A video link's name ends with its length: 「… 12 minutes, 18 seconds」「… 12分钟18秒钟」. */
const DURATION_TAIL =
  /(?:\s+(?:\d+\s+(?:hours?|minutes?|seconds?)[,，]?\s*)+|\s*(?:\d+\s*(?:小时|分钟|分|秒钟|秒))+)(?:\s*(?:Now playing|正在播放))?$/i;

/** What may follow a title in a link's name: its length, channel or card kind, not more title. */
const NAME_METADATA =
  /^\s*(?:[·•|,，]|by\s|作者|课程|Course\b|播放列表|Playlist\b|合集|频道|\d+\s*(?:lessons?|videos?|节课|个视频|集|小时|分钟|秒|hours?|minutes?|seconds?))/i;

const clean = (text: string) =>
  text.normalize('NFKC').replace(DURATION_TAIL, '').replace(/\s+/g, ' ').trim().toLowerCase();

const indentOf = (line: string) => line.length - line.trimStart().length;
const HEADING = /^\s*-\s*'?heading\s+"((?:[^"\\]|\\.)*)"/;
const LINK = /^\s*-\s*'?link\s+"((?:[^"\\]|\\.)*)"/;

/**
 * A node that says its card is a course or playlist, as a node of its own:
 * 「16 lessons」「26 节课」「34 videos」「Course」「播放列表」「View full course」.
 * (A title that merely contains 「Course」 is not such a node.)
 */
const COLLECTION_NODE =
  /^(?:\d+\s*(?:lessons?|videos?|节课|个视频|集)|course|课程|playlist|播放列表|合集|mix|合辑|view full (?:course|playlist)|查看完整(?:课程|播放列表|列表))$/i;

/** A tree node's own value: `- generic [ref=e1]: 16 lessons` → 16 lessons; `- link "Course" [ref=e2]` → Course. */
function nodeValue(line: string): string | undefined {
  const m = line.match(
    /^\s*-\s*'?[a-z]+(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s*\[[^\]]*\])*'?\s*(?::\s*(.*))?$/,
  );
  const value = (m?.[2] || m?.[1] || '').replace(/^"(.*)"$/, '$1').trim();
  return value || undefined;
}

function subtreeEnd(lines: string[], i: number): number {
  const own = indentOf(lines[i]!);
  let j = i + 1;
  while (j < lines.length && indentOf(lines[j]!) > own) j += 1;
  return j;
}

/**
 * FIX-28 (local c1/c4/h1): in some YouTube layouts a course card's title links
 * to its first lesson (`/watch?v=…` without `list=`), so only the card says it
 * is a course. A card is the largest ancestor of a heading that holds no other
 * heading; it is a collection when one of its own nodes is a course/playlist
 * mark. Returns the lines of collection cards' headings and their title links.
 */
function collectionTitleLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (!HEADING.test(lines[i]!)) continue;
    let start = i;
    let end = subtreeEnd(lines, i);
    let level = indentOf(lines[i]!);
    for (let k = i - 1; k >= 0; k -= 1) {
      if (indentOf(lines[k]!) >= level) continue;
      const kEnd = subtreeEnd(lines, k);
      let headings = 0;
      for (let j = k; j < kEnd && headings < 2; j += 1) if (HEADING.test(lines[j]!)) headings += 1;
      if (headings > 1) break;
      start = k;
      end = kEnd;
      level = indentOf(lines[k]!);
    }
    const titleEnd = subtreeEnd(lines, i);
    let collection = false;
    for (let j = start; j < end && !collection; j += 1) {
      if (j >= i && j < titleEnd) continue;
      const value = nodeValue(lines[j]!);
      if (value && COLLECTION_NODE.test(value)) collection = true;
    }
    if (!collection) continue;
    for (let j = i; j < titleEnd; j += 1) if (j === i || LINK.test(lines[j]!)) out.add(j);
  }
  return out;
}

/** Link name → the kinds of URL it points to, from every page the run read. */
function linkKinds(pages: ObservedEvidence[]): {
  kinds: Map<string, Set<ItemKind>>;
  collections: Set<string>;
} {
  const kinds = new Map<string, Set<ItemKind>>();
  const collections = new Set<string>();
  const add = (text: string, url: string) => {
    const kind = youtubeLinkKind(url);
    const name = clean(text);
    if (!kind || !name) return;
    const set = kinds.get(name) ?? new Set<ItemKind>();
    set.add(kind);
    kinds.set(name, set);
  };
  for (const page of pages) {
    for (const link of page.links ?? []) add(link.text, link.url);
    // The read's headings, which list every card, with the kind its DOM says.
    for (const card of page.youtubeCards ?? []) {
      if (card.kind === 'playlist') collections.add(clean(card.title));
      else add(card.title, 'https://www.youtube.com/watch?v=card');
    }
    const indent = (line: string) => line.length - line.trimStart().length;
    // An accessibility tree: `- link "Name" [ref=…]:` followed by `- /url: …`;
    // a video link's name may also be repeated in a `- text:` child.
    const lines = page.text.split('\n');
    // Course/playlist cards by their own marks, whatever their title links to.
    for (const j of collectionTitleLines(lines)) {
      const quotedLine = lines[j]!.trimStart().startsWith("- '");
      const raw = lines[j]!.match(HEADING)?.[1] ?? lines[j]!.match(LINK)?.[1];
      if (!raw) continue;
      const title = (quotedLine ? raw.replace(/''/g, "'") : raw).replace(/\\"/g, '"');
      collections.add(clean(title));
    }
    for (let i = 0; i < lines.length; i += 1) {
      // A line holding ": " is single-quoted YAML: `- 'link "A : B" [ref=…]':`.
      const quoted = lines[i]!.trimStart().startsWith("- '");
      const raw = lines[i]!.match(/-\s*'?link\s+"((?:[^"\\]|\\.)*)"/)?.[1];
      const name = raw && quoted ? raw.replace(/''/g, "'") : raw;
      // A card title that is a heading: the first YouTube link inside it.
      const heading = lines[i]!.match(/-\s*'?heading\s+"((?:[^"\\]|\\.)*)"/)?.[1];
      if (heading) {
        const own = indent(lines[i]!);
        for (let j = i + 1; j < Math.min(lines.length, i + 8) && indent(lines[j]!) > own; j += 1) {
          const u = lines[j]!.match(/-\s*\/url:\s*(\S+)/)?.[1];
          if (u && youtubeLinkKind(u)) {
            add((quoted ? heading.replace(/''/g, "'") : heading).replace(/\\"/g, '"'), u);
            break;
          }
        }
      }
      if (!name) continue;
      // The snapshot's own mark on a course/playlist link (markYoutubeCollections).
      if (/\[youtube=playlist\]/.test(lines[i]!))
        add(name.replace(/\\"/g, '"'), 'https://www.youtube.com/playlist?list=marked');
      let url: string | undefined;
      const texts: string[] = [];
      // The link's own children only: its first /url, up to the next link.
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
        if (/-\s*'?link\s+"/.test(lines[j]!)) break;
        const u = lines[j]!.match(/-\s*\/url:\s*(\S+)/)?.[1];
        if (u && !url) url = u;
        const t = lines[j]!.match(/-\s*text:\s*(.+)$/)?.[1];
        if (t) texts.push(t.replace(/^"|"$/g, ''));
      }
      if (!url) continue;
      add(name.replace(/\\"/g, '"'), url);
      for (const t of texts) add(t, url);
    }
  }
  return { kinds, collections };
}

/** The model's own note on an item: 「（课程/播放列表卡片）」「（不是视频）」. */
const NOT_VIDEO_NOTE =
  /[（(【\[][^）)】\]]*(?:课程|播放列表|合集|频道|非(?:单个|独立)?视频|不是视频|不算视频|playlist)[^）)】\]]*[）)】\]]/i;

export interface AnsweredItem {
  line: string;
  title: string;
  kind: ItemKind;
  why?: string;
}

/** The numbered (or bulleted) items of an answer, each with what it is. */
export function answeredItems(summary: string, pages: ObservedEvidence[]): AnsweredItem[] {
  const lines = summary.split('\n').map((line) => line.trim());
  let items = lines.filter((line) => /^\d{1,2}\s*[.)、．:：]/.test(line));
  if (items.length < 2) items = lines.filter((line) => /^[-*•]\s+\S/.test(line));
  const { kinds, collections } = linkKinds(pages);
  return items.map((line) => {
    // A Markdown item (「[Title](https://…)」, 「**Title**」) is read as its text and link;
    // brackets inside a title (「… [6 Hours]」) stay.
    const body = line
      .replace(/^(?:\d{1,2}\s*[.)、．:：]|[-*•])\s*/, '')
      .replace(/\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2')
      .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`/g, '$1$2$3');
    const urls = [...body.matchAll(/https?:\/\/[^\s）)」"'，,；;]+/g)].map((m) => m[0]);
    const title = body
      .replace(/^(?:标题|视频标题|title)\s*[:：]\s*/i, '')
      .split(/[；;]\s*(?:链接|url|link)|\s+[—–-]\s+https?:|\s*[（(]\s*(?:https?:|链接)/i)[0]!
      .replace(/https?:\/\/\S+/g, '')
      .replace(NOT_VIDEO_NOTE, '')
      .replace(/[（(][^）)]*[）)]\s*$/, (note) => (/\d|[a-z]/i.test(note) ? note : ''))
      .replace(/^[「“"]|[」”"]$/g, '')
      .trim();
    if (NOT_VIDEO_NOTE.test(body))
      return { line, title, kind: 'playlist', why: '答案自己注明不是单个视频' };
    for (const url of urls) {
      const kind = youtubeLinkKind(url);
      if (kind && kind !== 'video') return { line, title, kind, why: `链接 ${url}` };
    }
    const key = clean(title);
    // A card that marks itself a course/playlist wins over where its title links.
    if (
      collections.has(key) ||
      (key.length >= 6 &&
        [...collections].some(
          (name) => name.startsWith(key) && NAME_METADATA.test(name.slice(key.length)),
        ))
    )
      return {
        line,
        title,
        kind: 'playlist',
        why: '页面上这张卡片标着课程/播放列表（如「N 节课」「Course」）',
      };
    let seen = kinds.get(key);
    // A link whose name is the title followed by its length, channel or card kind.
    if (!seen && key.length >= 6)
      for (const [name, set] of kinds)
        if (name.startsWith(key) && NAME_METADATA.test(name.slice(key.length)))
          seen = new Set([...(seen ?? []), ...set]);
    if (seen?.has('video')) return { line, title, kind: 'video' };
    if (seen?.size) {
      const kind = [...seen][0]!;
      return { line, title, kind, why: '页面上这个标题的链接是播放列表/课程或频道' };
    }
    return {
      line,
      title,
      kind: urls.some((u) => youtubeLinkKind(u) === 'video') ? 'video' : 'unknown',
    };
  });
}

/**
 * Fewer videos than asked because course cards, playlists or channels were
 * counted as videos, delivered as complete: the items that are not videos and
 * the count. Null when the answer is fine or says 部分完成.
 */
export function videoShortfall(
  intent: string,
  summary: string,
  pages: ObservedEvidence[],
): { wanted: number; videos: number; notVideos: AnsweredItem[]; notOnPage: AnsweredItem[] } | null {
  const wanted = requestedVideoCount(intent);
  if (!wanted) return null;
  if (/^\s*(?:部分完成|未完成)/.test(summary)) return null;
  const items = answeredItems(summary, pages);
  if (!items.length) return null;
  const notVideos = items.filter((item) => item.kind === 'playlist' || item.kind === 'channel');
  // FIX-28 (e4): a title no read of the run contains was not read from the page.
  const read = flat(
    pages
      .map((page) => [page.text, ...(page.links ?? []).map((link) => link.text)].join('\n'))
      .join('\n'),
  );
  const notOnPage = items.filter(
    (item) => item.kind !== 'playlist' && item.kind !== 'channel' && !onPage(item.title, read),
  );
  // An item whose kind the reads cannot resolve, but which is on the page, is
  // given the benefit of the doubt.
  const videos = items.length - notVideos.length - notOnPage.length;
  // Too few items without padding is the general count check's (continue once,
  // then 部分完成); this one is for items that are not videos, or not on the page.
  return videos < wanted && (notVideos.length || notOnPage.length)
    ? { wanted, videos, notVideos, notOnPage }
    : null;
}

const flat = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

/**
 * The title is in what was read — whole, or cut by the page (「…」 right after
 * its first words). A bare prefix is not enough: 「Complete Playwright Course」
 * also opens a playlist's description.
 */
function onPage(title: string, read: string): boolean {
  const t = flat(title).trim();
  if (t.length < 6 || read.includes(t)) return true;
  for (let k = t.length - 1; k >= 20; k -= 1)
    if (
      read.includes(`${t.slice(0, k).trimEnd()}…`) ||
      read.includes(`${t.slice(0, k).trimEnd()}...`)
    )
      return true;
  return false;
}

/**
 * FIX-28: on a YouTube page, a link to a course or playlist is marked in the
 * snapshot (`[youtube=playlist]`), so the model reading the page sees that it
 * is not one video. The mark sits with the link's other attributes; refs and
 * names are untouched.
 */
export function markYoutubeCollections(tree: string): string {
  const lines = tree.split('\n');
  for (const j of collectionTitleLines(lines))
    if (LINK.test(lines[j]!) && !/\[youtube=/.test(lines[j]!))
      lines[j] = lines[j]!.replace(/(\[ref=[^\]]+\])/, '$1 [youtube=playlist]');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*-\s*'?link\b.*\[ref=[^\]]+\]/.test(lines[i]!) || /\[youtube=/.test(lines[i]!))
      continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      if (/^\s*-\s*'?link\b/.test(lines[j]!)) break;
      const url = lines[j]!.match(/-\s*\/url:\s*(\S+)/)?.[1];
      if (!url) continue;
      if (youtubeLinkKind(url) === 'playlist')
        lines[i] = lines[i]!.replace(/(\[ref=[^\]]+\])/, '$1 [youtube=playlist]');
      break;
    }
  }
  return lines.join('\n');
}

/**
 * FIX-28 (local c1/c4/h1/v2): the snapshot tree is cut at 24 000 characters,
 * but its `headings` list carries every result card's title — without a
 * link or a kind — and the model took titles from it, courses included. On a
 * YouTube page each card's own DOM says what it is; this in-page expression
 * returns `{ title, kind }` for the result cards: a course/playlist/mix card
 * (a `list=`/`/playlist` link anywhere in it, or a lessons/course badge) or a
 * single video (`/watch?v=` or `/shorts/`).
 */
export const YOUTUBE_CARD_KINDS_EXPRESSION = `(() => {
  const MARK = /^(?:\\d+\\s*(?:lessons?|videos?|节课|个视频|集)|course|课程|playlist|播放列表|合集|mix|合辑)$/i;
  const out = [];
  const cards = document.querySelectorAll(
    'ytd-video-renderer, ytd-playlist-renderer, ytd-radio-renderer, yt-lockup-view-model, ytd-reel-item-renderer, ytd-grid-video-renderer',
  );
  for (const card of cards) {
    if (card.parentElement && card.parentElement.closest('yt-lockup-view-model, ytd-playlist-renderer')) continue;
    const heading = card.querySelector('h3') || card.querySelector('#video-title');
    const title = ((heading && heading.textContent) || '').replace(/\\s+/g, ' ').trim();
    if (!title) continue;
    const hrefs = Array.from(card.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const marked = Array.from(card.querySelectorAll('span, div, a, p, badge-shape')).some(
      (node) => node.children.length === 0 && MARK.test((node.textContent || '').trim()),
    );
    const collection =
      card.matches('ytd-playlist-renderer, ytd-radio-renderer') ||
      hrefs.some((href) => /[?&]list=|^\\/playlist\\b|youtube\\.com\\/playlist\\b/.test(href)) ||
      marked;
    const video = hrefs.some((href) => /\\/watch\\?v=|\\/shorts\\//.test(href));
    if (collection || video) out.push({ title: title.slice(0, 300), kind: collection ? 'playlist' : 'video' });
    if (out.length >= 200) break;
  }
  return out;
})()`;

/** Headings with the kind of the YouTube card they title (exact or title-plus-length match). */
export function markYoutubeHeadings<T extends { text?: string }>(
  headings: T[],
  cards: Array<{ title: string; kind: string }>,
): Array<T & { youtube?: string }> {
  const byTitle = new Map(cards.map((card) => [clean(card.title), card.kind]));
  return headings.map((heading) => {
    const key = clean(String(heading.text ?? ''));
    const kind = byTitle.get(key);
    return kind ? { ...heading, youtube: kind } : heading;
  });
}
