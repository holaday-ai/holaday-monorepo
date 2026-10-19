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

const DURATION_TAIL =
  /\s+(?:\d+\s+(?:hours?|minutes?|seconds?|小时|分钟|秒)[,，\s]*)+(?:\s*(?:Now playing|正在播放))?$/i;

const clean = (text: string) =>
  text.normalize('NFKC').replace(DURATION_TAIL, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Link name → the kinds of URL it points to, from every page the run read. */
function linkKinds(pages: ObservedEvidence[]): Map<string, Set<ItemKind>> {
  const kinds = new Map<string, Set<ItemKind>>();
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
    // An accessibility tree: `- link "Name" [ref=…]:` followed by `- /url: …`;
    // a video link's name may also be repeated in a `- text:` child.
    const lines = page.text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      // A line holding ": " is single-quoted YAML: `- 'link "A : B" [ref=…]':`.
      const quoted = lines[i]!.trimStart().startsWith("- '");
      const raw = lines[i]!.match(/-\s*'?link\s+"((?:[^"\\]|\\.)*)"/)?.[1];
      const name = raw && quoted ? raw.replace(/''/g, "'") : raw;
      if (!name) continue;
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
  return kinds;
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
  const kinds = linkKinds(pages);
  return items.map((line) => {
    const body = line.replace(/^(?:\d{1,2}\s*[.)、．:：]|[-*•])\s*/, '');
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
    const seen = kinds.get(clean(title));
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
): { wanted: number; videos: number; notVideos: AnsweredItem[] } | null {
  const wanted = requestedVideoCount(intent);
  if (!wanted) return null;
  if (/^\s*(?:部分完成|未完成)/.test(summary)) return null;
  const items = answeredItems(summary, pages);
  if (!items.length) return null;
  // Unknown items (a title the reads cannot resolve) are given the benefit of the doubt.
  const videos = items.filter((item) => item.kind === 'video' || item.kind === 'unknown').length;
  const notVideos = items.filter((item) => item.kind === 'playlist' || item.kind === 'channel');
  // Too few items without padding is the general count check's (continue once,
  // then 部分完成); this one is for items that are not videos counted as videos.
  return videos < wanted && notVideos.length ? { wanted, videos, notVideos } : null;
}
