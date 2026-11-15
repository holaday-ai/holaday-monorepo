// G7 / INBOX Q-8 (G3 online network record): the signed-in user's Google avatar
// (`info.picture`, lh3.googleusercontent.com/a/…) was loaded by the user's own browser from
// Google on every page. It now comes through HOLA DAY: `/api/avatar?url=<Google avatar URL>`.
// Only Google profile-photo URLs pass (https, lh3–lh6.googleusercontent.com, an /a/ or /a-/
// path, no query / port / credentials / fragment) — never an open proxy. Images only, at most
// 512 KB, 5 s, no redirects; a small in-memory cache keeps repeat page loads off Google.

const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_TIMEOUT_MS = 5_000;
const AVATAR_CACHE_MAX = 300;
const AVATAR_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

type AvatarFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type AvatarFetchResult =
  | { ok: true; body: Buffer; contentType: string }
  | {
      ok: false;
      status: 400 | 502;
      error:
        | 'untrusted_avatar_url'
        | 'avatar_fetch_failed'
        | 'avatar_response_error'
        | 'invalid_content_type'
        | 'image_too_large'
        | 'empty_image';
    };

/** A Google profile-photo URL as Google sign-in returns it, or undefined. */
export function trustedAvatarUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 1_024) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.search
    )
      return undefined;
    if (!/^lh[3-6]\.googleusercontent\.com$/.test(url.hostname)) return undefined;
    return /^\/a-?\/[A-Za-z0-9._~=-]{10,400}$/.test(url.pathname) ? url : undefined;
  } catch {
    return undefined;
  }
}

const cache = new Map<string, { at: number; body: Buffer; contentType: string }>();

export async function fetchAvatar(
  value: unknown,
  fetcher: AvatarFetcher = fetch,
  now: () => number = Date.now,
): Promise<AvatarFetchResult> {
  const source = trustedAvatarUrl(value);
  if (!source) return { ok: false, status: 400, error: 'untrusted_avatar_url' };
  const key = source.toString();
  const hit = cache.get(key);
  if (hit && now() - hit.at < AVATAR_CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return { ok: true, body: hit.body, contentType: hit.contentType };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_TIMEOUT_MS);
  try {
    const response = await fetcher(key, {
      headers: {
        accept: 'image/webp,image/png,image/jpeg,image/gif',
        'user-agent': 'Holaday-Avatar/1.0',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: 502, error: 'avatar_response_error' };
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType))
      return { ok: false, status: 502, error: 'invalid_content_type' };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES)
      return { ok: false, status: 502, error: 'image_too_large' };
    if (!response.body) return { ok: false, status: 502, error: 'empty_image' };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > AVATAR_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, status: 502, error: 'image_too_large' };
      }
      chunks.push(chunk);
    }
    if (size === 0) return { ok: false, status: 502, error: 'empty_image' };
    const body = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      size,
    );
    cache.set(key, { at: now(), body, contentType });
    while (cache.size > AVATAR_CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return { ok: true, body, contentType };
  } catch {
    return { ok: false, status: 502, error: 'avatar_fetch_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export const __avatarTest = {
  AVATAR_MAX_BYTES,
  AVATAR_CACHE_MAX,
  clear: () => cache.clear(),
  size: () => cache.size,
};
