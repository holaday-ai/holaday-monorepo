import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';

export interface FetchedArticle {
  title: string;
  url: string;
  publishedAt: string;
  content: string;
}

export function articleUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      url.hostname.startsWith('[') ||
      /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
      /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
        url.hostname,
      ) ||
      url.hostname.endsWith('.local') ||
      url.hostname.endsWith('.internal') ||
      /^\/(?:news|search|latest|index(?:\.html)?)?\/?$/.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Only fetched article text with an explicit publication date is evidence. Snippets are not. */
export async function fetchResearchArticles(
  lane: FirecrawlLane,
  intent: string,
  signal: AbortSignal,
): Promise<FetchedArticle[]> {
  const call = <T>(action: () => Promise<T>): Promise<T> => {
    const parent = currentOperationLifetime();
    return parent
      ? startOwnedOperation(parent.drain, 'request', () => action(), {
          parent: parent.owner,
          errorOutcome: 'unknown',
          dispatch: 'immediate',
        }).result
      : action();
  };
  if (signal.aborted) return [];
  const search = await call(() => lane.search(intent, { limit: 5, signal }));
  if (!search.ok || signal.aborted) return [];
  const articles: FetchedArticle[] = [];
  const seen = new Set<string>();
  const fetched = new Set<string>();
  for (const hit of search.results.slice(0, 5)) {
    if (signal.aborted || articles.length >= 3) break;
    const requested = articleUrl(hit.url);
    if (!requested || seen.has(requested)) continue;
    seen.add(requested);
    const page = await call(() => lane.scrape(requested, { signal }));
    if (!page.ok || signal.aborted) continue;
    const url = articleUrl(page.url);
    // A redirected homepage cannot become evidence for the requested article.
    if (!url || fetched.has(url) || new URL(url).origin !== new URL(requested).origin) continue;
    const date = page.markdown.match(
      /(?:发布时间|发表时间|发布于|Published(?:\s+(?:on|at))?|Date)\s*[:：]?\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/i,
    );
    if (!date) continue;
    const publishedAt = `${date[1]}-${date[2]?.padStart(2, '0')}-${date[3]?.padStart(2, '0')}`;
    const parsedDate = new Date(`${publishedAt}T00:00:00Z`);
    if (
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== publishedAt
    )
      continue;
    fetched.add(url);
    articles.push({
      url,
      title: (page.title ?? hit.title ?? new URL(url).hostname).slice(0, 160),
      publishedAt,
      content: page.markdown.slice(0, 6000),
    });
  }
  return articles;
}
