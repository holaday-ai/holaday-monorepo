/**
 * FIX-INTENT-ROUTE-BROWSER — a task that names a search engine and asks for its
 * results with links or a count ("Google 搜索「HOLA DAY AI」返回前5条标题和链接")
 * is only answered when the result carries that many real result links. The
 * scrape lane checks its answer against this; when it falls short, the same
 * task is retried once in the browser instead of failing.
 */
export interface SearchResultRequirement {
  engine: string;
  /** Requested number of results, when stated. */
  count: number | null;
  /** The user asked for links / URLs. */
  needsLinks: boolean;
}

const ENGINE =
  /\b(google|bing|baidu|duckduckgo|yahoo|youtube|yandex|sogou)\b|(谷歌|必应|百度|雅虎|油管|搜狗|360\s*搜索)/i;
const SEARCH = /搜索|搜一下|搜一搜|搜|查找|检索|\bsearch\b|\blook\s+up\b/i;
const LINKS = /链接|网址|地址|\burls?\b|\blinks?\b/i;
const CN_NUMBER: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
const COUNT =
  /前\s*(\d{1,2}|[一二两三四五六七八九十])\s*(?:条|个|项|名|篇|位|个视频|条结果)?|\btop\s*(\d{1,2})\b|\bfirst\s+(\d{1,2})\b|(\d{1,2})\s*(?:条|个)(?:结果|搜索结果|标题|视频)/i;

export function searchResultRequirement(intent: string): SearchResultRequirement | null {
  const engine = intent.match(ENGINE)?.[0];
  if (!engine || !SEARCH.test(intent)) return null;
  const countMatch = intent.match(COUNT);
  const raw = countMatch?.slice(1).find((value) => value !== undefined);
  const count = raw === undefined ? null : Number(raw) || CN_NUMBER[raw] || null;
  const needsLinks = LINKS.test(intent);
  if (!needsLinks && count === null) return null;
  return { engine, count, needsLinks };
}

/** Distinct result links in an answer; the engine's own search pages are not results. */
export function resultLinks(text: string): string[] {
  const links = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'（）()\[\]「」【】《》，。；、]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    try {
      const url = new URL(raw);
      const isSearchPage =
        /(^|\.)(google|bing|baidu|duckduckgo|yahoo|yandex|sogou)\./i.test(url.hostname) ||
        (/(^|\.)youtube\.com$/i.test(url.hostname) && url.pathname.startsWith('/results'));
      if (isSearchPage) continue;
      links.add(url.href);
    } catch {
      /* not a URL */
    }
  }
  return [...links];
}

export function searchResultsSatisfy(
  requirement: SearchResultRequirement,
  text: string,
): { ok: true } | { ok: false; reason: string } {
  const required = requirement.count ?? 1;
  if (requirement.needsLinks) {
    const links = resultLinks(text).length;
    if (links < required)
      return { ok: false, reason: `需要 ${required} 条带真实链接的结果，只取得 ${links} 条` };
    return { ok: true };
  }
  const items = text
    .split('\n')
    .filter((line) => /^\s*(?:\d{1,2}[.、)）]|[-*•])\s*\S/.test(line)).length;
  if (items < required) return { ok: false, reason: `需要 ${required} 条结果，只取得 ${items} 条` };
  return { ok: true };
}
