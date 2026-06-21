/**
 * Proactive new-deploy detection.
 *
 * The SPA bundle is content-hashed (`index-<hash>.js`, referenced in
 * index.html). After a deploy the live index.html points at a NEW hash while a
 * still-open tab keeps running the OLD bundle — that's the stale-tab the BOSS
 * hit during QA. We poll the live index.html (on focus + a slow interval) and
 * compare its hash to the one THIS tab loaded; on mismatch we surface a
 * DISMISSIBLE refresh banner.
 *
 * Never a silent reload — that would drop a half-filled form or an in-flight
 * task. This is the PROACTIVE complement to lazy-load-error.ts, which only
 * fires REACTIVELY once a now-deleted chunk import has already failed.
 */

const BUNDLE_HASH_RE = /index-([A-Za-z0-9_-]+)\.js/;

/** Pull the main bundle hash (`index-<hash>.js`) out of an index.html string. */
export function extractBundleHash(html: string): string | null {
  const m = html.match(BUNDLE_HASH_RE);
  return m ? m[1] : null;
}

/**
 * True when a DIFFERENT bundle is deployed than the one this tab loaded. Both
 * must be known — a null on either side (couldn't read / network blip) means
 * "don't nag", never a false positive.
 */
export function isNewVersionAvailable(
  loaded: string | null,
  deployed: string | null,
): boolean {
  return !!loaded && !!deployed && loaded !== deployed;
}

/** The bundle hash THIS tab loaded — read from its own <script> tags. */
export function getLoadedBundleHash(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
    const hash = extractBundleHash((s as HTMLScriptElement).src);
    if (hash) return hash;
  }
  return null;
}

/** Fetch the live index.html (cache-bypassed) and return its bundle hash. */
export async function fetchDeployedBundleHash(
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl('/index.html', { cache: 'no-store' });
    if (!res.ok) return null;
    return extractBundleHash(await res.text());
  } catch {
    return null;
  }
}
