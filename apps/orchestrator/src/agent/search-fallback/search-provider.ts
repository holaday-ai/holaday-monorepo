/**
 * CAPTCHA-REDUCE-1 — search results from a sanctioned search API instead of a
 * google.com results page. Google gives a datacenter browser its hardest
 * reCAPTCHA; a search API answers the same query without a wall, and the
 * browser then opens the result pages it needs.
 *
 * Provider-neutral: the runtime only sees `SearchProvider`. Configuration is
 * by environment variable name only; no key is read here unless an operator
 * sets one, and keys never enter logs or results.
 */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}
export interface SearchProvider {
  /** Stable id for metadata (`search-api:brave`). */
  readonly id: string;
  /** Shown to the user: where the results came from. */
  readonly label: string;
  search(
    query: string,
    options: { count: number; signal?: AbortSignal },
  ): Promise<WebSearchResult[]>;
}
type Fetch = typeof fetch;

/** Variable names only (values are read from the environment, never logged). */
export const SEARCH_API_ENV = {
  provider: 'BROWSER_SEARCH_API_PROVIDER',
  braveKey: 'BRAVE_SEARCH_API_KEY',
  /** GOOGLE-WALL-2: the name the early Brave adapter used; the new name wins. */
  braveKeyLegacy: 'BRAVE_API_KEY',
  qwenKey: 'DASHSCOPE_INTL_API_KEY',
  /** GOOGLE-WALL-2: Qwen web search on the mainland (Beijing) endpoint. */
  qwenCnKey: 'DASHSCOPE_CN_API_KEY',
  qwenBaseUrl: 'BROWSER_SEARCH_API_QWEN_BASE_URL',
  qwenModel: 'BROWSER_SEARCH_API_QWEN_MODEL',
} as const;

const clean = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
/** Only public http(s) result links survive; anything else is dropped. */
export function normalizeResults(
  raw: Array<{ title?: unknown; url?: unknown; snippet?: unknown }>,
  count: number,
): WebSearchResult[] {
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const item of raw) {
    const title = clean(item.title, 300);
    let url: URL;
    try {
      url = new URL(String(item.url ?? ''));
    } catch {
      continue;
    }
    if (!title || !['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
    seen.add(url.href);
    const snippet = clean(item.snippet, 500);
    results.push({ title, url: url.href, ...(snippet ? { snippet } : {}) });
    if (results.length >= count) break;
  }
  return results;
}

/** Local stand-in: fixed results per query (tests, audits, offline runs). */
export class StubSearchProvider implements SearchProvider {
  readonly id = 'search-api:stub';
  readonly label = '本地测试搜索接口';
  constructor(
    private readonly fixtures: (query: string) => WebSearchResult[] = (query) =>
      Array.from({ length: 10 }, (_, i) => ({
        title: `${query} result ${i + 1}`,
        url: `https://example.com/${encodeURIComponent(query)}/${i + 1}`,
        snippet: `Fixture result ${i + 1} for ${query}`,
      })),
  ) {}
  async search(query: string, options: { count: number; signal?: AbortSignal }) {
    options.signal?.throwIfAborted();
    return normalizeResults(this.fixtures(query), options.count);
  }
}

/** Brave Search API (independent index): GET /res/v1/web/search. */
export class BraveSearchProvider implements SearchProvider {
  readonly id = 'search-api:brave';
  readonly label = 'Brave 搜索接口';
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly endpoint = 'https://api.search.brave.com/res/v1/web/search',
  ) {}
  async search(query: string, options: { count: number; signal?: AbortSignal }) {
    const url = new URL(this.endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(20, Math.max(1, options.count))));
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`search_api_http_${response.status}`);
    const body = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return normalizeResults(
      (body.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
      options.count,
    );
  }
}

/**
 * Qwen web search on the same Alibaba Cloud account (DashScope native API,
 * `enable_search` + `enable_source`): the sources the search returned, as a
 * result list. The model's own text is not used.
 */
export class QwenWebSearchProvider implements SearchProvider {
  readonly id: string;
  readonly label: string;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = 'https://dashscope-intl.aliyuncs.com',
    private readonly model = 'qwen-flash',
    region: 'intl' | 'cn' = 'intl',
  ) {
    this.id = region === 'cn' ? 'search-api:qwen-cn' : 'search-api:qwen';
    this.label = region === 'cn' ? '通义千问联网搜索接口（大陆）' : '通义千问联网搜索接口';
  }
  async search(query: string, options: { count: number; signal?: AbortSignal }) {
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/+$/, '')}/api/v1/services/aigc/text-generation/generation`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          input: { messages: [{ role: 'user', content: query }] },
          parameters: {
            result_format: 'message',
            max_tokens: 16,
            enable_search: true,
            search_options: { forced_search: true, enable_source: true, search_strategy: 'turbo' },
          },
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    if (!response.ok) throw new Error(`search_api_http_${response.status}`);
    const body = (await response.json()) as {
      output?: { search_info?: { search_results?: Array<{ title?: string; url?: string }> } };
    };
    return normalizeResults(body.output?.search_info?.search_results ?? [], options.count);
  }
}

/**
 * GOOGLE-WALL-2: providers tried in order; the first with results answers.
 * `id`/`label` name the provider that answered the last search, so the user
 * is told where these results came from.
 */
export class ChainSearchProvider implements SearchProvider {
  private answered: SearchProvider;
  constructor(private readonly providers: readonly SearchProvider[]) {
    this.answered = providers[0]!;
  }
  get id() {
    return this.answered.id;
  }
  get label() {
    return this.answered.label;
  }
  async search(query: string, options: { count: number; signal?: AbortSignal }) {
    let failure: unknown;
    for (const provider of this.providers) {
      options.signal?.throwIfAborted();
      try {
        const results = await provider.search(query, options);
        if (results.length) {
          this.answered = provider;
          return results;
        }
      } catch (error) {
        failure = error;
      }
    }
    if (failure) throw failure;
    return [];
  }
}

function providerNamed(
  name: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: Fetch,
): SearchProvider | null {
  switch (name) {
    case 'stub':
      // Fixture results must never reach a real user as search results.
      return env.NODE_ENV === 'production' ? null : new StubSearchProvider();
    case 'brave': {
      const key = env[SEARCH_API_ENV.braveKey] || env[SEARCH_API_ENV.braveKeyLegacy];
      return key ? new BraveSearchProvider(key, fetchImpl) : null;
    }
    case 'qwen':
    case 'qwen-cn': {
      const cn = name === 'qwen-cn';
      const key = env[cn ? SEARCH_API_ENV.qwenCnKey : SEARCH_API_ENV.qwenKey];
      return key
        ? new QwenWebSearchProvider(
            key,
            fetchImpl,
            (cn ? undefined : env[SEARCH_API_ENV.qwenBaseUrl]) ||
              (cn ? 'https://dashscope.aliyuncs.com' : undefined),
            env[SEARCH_API_ENV.qwenModel] || undefined,
            cn ? 'cn' : 'intl',
          )
        : null;
    }
    default:
      return null;
  }
}

/**
 * `BROWSER_SEARCH_API_PROVIDER`: none (default), or one or more of stub |
 * brave | qwen | qwen-cn, comma-separated, tried in order (GOOGLE-WALL-2).
 * A provider without its key is skipped, never a silent default; with none
 * configured the result is null. `engine-fallback` may end the list: the
 * alternate engine always follows when no API answers.
 */
export function searchProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetch = fetch,
): SearchProvider | null {
  const providers = (env[SEARCH_API_ENV.provider] ?? 'none')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name && name !== 'none' && name !== 'engine-fallback')
    .map((name) => providerNamed(name, env, fetchImpl))
    .filter((provider): provider is SearchProvider => provider !== null);
  if (!providers.length) return null;
  return providers.length === 1 ? providers[0]! : new ChainSearchProvider(providers);
}
