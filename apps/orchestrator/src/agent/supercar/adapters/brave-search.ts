/**
 * Brave Search adapter (Lane 3).
 *
 * Thin wrapper around Brave's public search API. Only active when
 * BRAVE_API_KEY is present; otherwise `createBraveSearchAdapter` returns
 * null and the router treats the lane as unavailable.
 *
 * API shape (v1): GET https://api.search.brave.com/res/v1/web/search
 *   headers: X-Subscription-Token: <key>, Accept: application/json
 *   query:   q, count (≤20), country (default US), safesearch
 *   returns: { web: { results: [{ title, url, description, ... }] } }
 *
 * We intentionally keep the response tiny (top-10, title + URL +
 * snippet only). Supercar's short-circuit path feeds the whole blob
 * back into the model's summary prompt, so we care about token cost,
 * not SERP richness.
 */

export interface BraveSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface BraveSearchAdapter {
  /** Run a query. Resolves to `{results}` on HTTP 200, `{error}` otherwise — never throws. */
  search(query: string, count?: number): Promise<
    | { readonly results: readonly BraveSearchResult[] }
    | { readonly error: string }
  >;
}

/**
 * Construct an adapter if a key is available; return null otherwise so
 * the router's lane-status check can log "brave unavailable" cleanly at
 * boot instead of discovering it per request.
 */
export function createBraveSearchAdapter(apiKey: string | null): BraveSearchAdapter | null {
  if (!apiKey) return null;
  return {
    async search(query, count = 10) {
      try {
        const params = new URLSearchParams({
          q: query,
          count: String(Math.min(20, Math.max(1, count))),
        });
        const res = await fetch(
          `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
          {
            headers: {
              accept: 'application/json',
              'x-subscription-token': apiKey,
            },
          },
        );
        if (!res.ok) {
          return { error: `brave search ${res.status}: ${(await res.text()).slice(0, 120)}` };
        }
        const body = (await res.json()) as {
          web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
        };
        const raw = body.web?.results ?? [];
        const results: BraveSearchResult[] = raw.slice(0, count).map((r) => ({
          title: (r.title ?? '').trim(),
          url: r.url ?? '',
          snippet: (r.description ?? '').trim(),
        }));
        return { results };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
