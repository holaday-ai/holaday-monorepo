/**
 * FIX-54 #2 (Deploy-54 xhs-read): Firecrawl's markdown of a 小红书 note runs the engage bar's
 * three counts together — likes 1568, collects 1,800, comments 24 come out as 「15681,80024」,
 * and the answer said the like count could not be read. The page's own state carries each count
 * as its own field (`noteDetailMap[<note id>].note.interactInfo`), so a note page is also fetched
 * as raw HTML and those fields are read by name. Nothing is guessed: when the note's fields are
 * not there, nothing is added.
 */

const NOTE_PATH = /^\/(?:explore|discovery\/item)\/([0-9a-f]{24})(?:[/?#]|$)/i;

/** The note id of a 小红书 note page, or null. */
export function xhsNoteId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(?:^|\.)(?:xiaohongshu|rednote)\.com$/i.test(u.hostname)) return null;
    return u.pathname.match(NOTE_PATH)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export interface XhsNoteCounts {
  liked?: string;
  collected?: string;
  comments?: string;
  shares?: string;
}

const FIELDS: Array<[keyof XhsNoteCounts, string]> = [
  ['liked', 'likedCount'],
  ['collected', 'collectedCount'],
  ['comments', 'commentCount'],
  ['shares', 'shareCount'],
];
// A count as the page shows it: 1568, 1,800, 1.2万, 10w+.
const COUNT = /^\d[\d,.]*(?:万|w|k)?\+?$/i;

/** The counts of note `noteId` from the page state in `rawHtml`, read field by field. */
export function xhsNoteCounts(rawHtml: string, noteId: string): XhsNoteCounts | null {
  const map = rawHtml.indexOf('"noteDetailMap":{');
  const key = `"${noteId}":{`;
  const at = map < 0 ? -1 : rawHtml.indexOf(key, map);
  if (at < 0) return null;
  // The note's own entry runs to the next note id in the map; interactInfo is a flat object.
  const rest = rawHtml.slice(at + key.length);
  const next = rest.search(/"[0-9a-f]{24}":\{/i);
  const entry = next < 0 ? rest : rest.slice(0, next);
  const note = entry.indexOf('"note":{');
  if (note < 0) return null;
  const info = entry.slice(note).match(/"interactInfo":(\{[^{}]*\})/)?.[1];
  if (!info) return null;
  const counts: XhsNoteCounts = {};
  for (const [key, field] of FIELDS) {
    const value = info.match(new RegExp(`"${field}":"([^"]*)"`))?.[1]?.trim();
    if (value && COUNT.test(value)) counts[key] = value;
  }
  return Object.keys(counts).length ? counts : null;
}

/** A line for the markdown, naming each count. */
export function xhsCountsLine(counts: XhsNoteCounts): string {
  const parts = [
    counts.liked && `点赞 ${counts.liked}`,
    counts.collected && `收藏 ${counts.collected}`,
    counts.comments && `评论 ${counts.comments}`,
    counts.shares && `分享 ${counts.shares}`,
  ].filter(Boolean);
  return `笔记互动数（页面数据逐项读取，非正文拼接）：${parts.join('｜')}`;
}
