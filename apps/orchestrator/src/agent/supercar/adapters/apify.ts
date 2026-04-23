/**
 * Apify adapter (Lane 5).
 *
 * Wraps Apify's actor-run API. Used as the "browser is stuck, we have
 * a known scraper for this domain" fallback. Lane activates only when:
 *   1. APIFY_API_TOKEN is configured, AND
 *   2. the task's intent maps to a known actor in the registry below
 *      (`findActorForIntent` returns non-null).
 *
 * We prefer `run-sync-get-dataset-items` which blocks up to the actor's
 * internal timeout and returns the dataset inline — no polling, no
 * second request. Tradeoff: the HTTP call can hang for minutes, so we
 * cap it at 180s with AbortSignal.timeout. Actors that take longer are
 * the wrong fit for this lane anyway; the supercar loop would time out
 * regardless.
 *
 * The registry is keyword-indexed, not ML-matched — cheap and
 * debuggable. Add actors by appending entries; each lists the site
 * keywords that should route here.
 */

export interface ApifyActorMatch {
  readonly actorId: string;
  readonly hostLabel: string;
  readonly buildInput: (intent: string) => Record<string, unknown>;
}

export interface ApifyAdapter {
  /** Find a registered actor for the given intent, or null if none matches. */
  findActorForIntent(intent: string): ApifyActorMatch | null;
  /** Execute an actor synchronously. Returns the dataset items, or an error. */
  run(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<{ readonly items: readonly unknown[] } | { readonly error: string }>;
}

// Registry — keyword → actor. Keywords are lowercased substring matches;
// CJK tokens don't have word boundaries so we rely on substring, same
// approach as the domain classifier. Longer tokens win ties (more
// specific match), enforced by sort order below.
interface ActorEntry {
  readonly actorId: string;
  readonly hostLabel: string;
  readonly keywords: readonly string[];
  readonly buildInput: (intent: string) => Record<string, unknown>;
}

const ACTORS: readonly ActorEntry[] = [
  {
    actorId: 'apify/xiaohongshu-scraper',
    hostLabel: '小红书',
    keywords: ['小红书', 'xiaohongshu', 'rednote'],
    buildInput: (intent) => ({ search: intent.slice(0, 200), maxItems: 20 }),
  },
  {
    actorId: 'apify/douyin-scraper',
    hostLabel: '抖音',
    keywords: ['抖音', 'douyin', 'tiktok'],
    buildInput: (intent) => ({ search: intent.slice(0, 200), maxItems: 20 }),
  },
  {
    actorId: 'apify/zhipin-scraper',
    hostLabel: 'Boss直聘',
    keywords: ['boss直聘', 'zhipin', 'boss 直聘'],
    buildInput: (intent) => ({ query: intent.slice(0, 200), maxResults: 30 }),
  },
  {
    actorId: 'apify/ctrip-hotels-scraper',
    hostLabel: '携程酒店',
    keywords: ['携程', 'ctrip', '酒店'],
    buildInput: (intent) => ({ query: intent.slice(0, 200), maxItems: 20 }),
  },
  {
    actorId: 'apify/jd-product-scraper',
    hostLabel: '京东商品',
    keywords: ['京东', 'jd.com', 'jingdong'],
    buildInput: (intent) => ({ search: intent.slice(0, 200), maxItems: 20 }),
  },
];

export function createApifyAdapter(apiToken: string | null): ApifyAdapter | null {
  if (!apiToken) return null;
  return {
    findActorForIntent(intent) {
      const needle = intent.toLowerCase();
      let best: ActorEntry | null = null;
      let bestLen = 0;
      for (const entry of ACTORS) {
        for (const k of entry.keywords) {
          if (needle.includes(k) && k.length > bestLen) {
            best = entry;
            bestLen = k.length;
          }
        }
      }
      if (!best) return null;
      return {
        actorId: best.actorId,
        hostLabel: best.hostLabel,
        buildInput: best.buildInput,
      };
    },
    async run(actorId, input) {
      try {
        // URL-safe actor id: Apify accepts either slashes or tildes.
        // Tilde form avoids needing to percent-encode in the path.
        const safeId = actorId.replace('/', '~');
        const res = await fetch(
          `https://api.apify.com/v2/acts/${safeId}/run-sync-get-dataset-items`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiToken}`,
            },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(180_000),
          },
        );
        if (!res.ok) {
          return { error: `apify ${res.status}: ${(await res.text()).slice(0, 200)}` };
        }
        const body = await res.json();
        return { items: Array.isArray(body) ? body : [] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
