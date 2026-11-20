/**
 * FIX-41 (Deploy-41 dy-1): the content a task names by address — a video, a note, an item.
 * Esc on douyin.com/video/7507106798919601427 left the page on
 * douyin.com/jingxuan?modal_id=7688783892253347098, another video, and its title was
 * delivered as the answer. A page is the named content when it carries the same content id,
 * wherever the site puts it (/video/<id> and ?modal_id=<id> are the same video).
 */
import { siteOf } from '../../browser-pool/egress-learning.js';

/** A path segment or query value that identifies one piece of content. */
function contentId(value: string, key = ''): string | null {
  const id = value.replace(/\.(?:s?html?|php|aspx?)$/i, '');
  if (/^\d{8,}$/.test(id) || /^[0-9a-f]{16,}$/i.test(id)) return id.toLowerCase();
  // YouTube's ?v= is an 11-character id of letters, digits, - and _.
  if (key === 'v' && /^[\w-]{11}$/.test(id)) return id;
  return null;
}

/** The content ids in an address: from its path segments and its query values. */
export function contentIds(url: string): string[] {
  try {
    const parsed = new URL(url);
    const ids = [
      ...parsed.pathname.split('/').map((segment) => contentId(decodeURIComponent(segment))),
      ...[...parsed.searchParams].map(([key, value]) => contentId(value, key)),
    ];
    return [...new Set(ids.filter((id): id is string => !!id))];
  } catch {
    return [];
  }
}

const site = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return siteOf(host) ?? host;
  } catch {
    return '';
  }
};

/**
 * The address the task names when it is one piece of content to read there, else null.
 * A task that goes on from it (「然后点开作者主页」, 「打开 3 个链接」, a search) is not held to it.
 */
export function namedContentUrl(intent: string): string | null {
  const urls = [...intent.matchAll(/https?:\/\/[^\s，。、；"'「」<>()（）]+/gi)].map((match) =>
    match[0].replace(/[\].,;:]+$/, ''),
  );
  if (urls.length !== 1 || !contentIds(urls[0]!).length) return null;
  if (
    /(?:然后|之后|再|并|接着).{0,6}(?:点击|点开|进入|打开|跳转|搜索|翻页)|主页|链接|评论区|搜索|search|\bthen\b|\blinks?\b/i.test(
      intent,
    )
  )
    return null;
  return urls[0]!;
}

/** False when `current` is on the named site but shows other content than `named`. */
export function onNamedContent(named: string, current: string | undefined): boolean {
  if (!current || !/^https?:/i.test(current)) return true;
  if (site(current) !== site(named)) return true;
  const wanted = contentIds(named);
  const shown = contentIds(current);
  return wanted.some((id) => shown.includes(id));
}
