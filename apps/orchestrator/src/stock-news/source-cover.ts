const SOURCE_COVER_MAX_BYTES = 2 * 1024 * 1024;
const SOURCE_COVER_TIMEOUT_MS = 8_000;
const ALLOWED_CONTENT_TYPES = new Set(['image/avif', 'image/jpeg', 'image/png', 'image/webp']);

type SourceCoverFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type SourceCoverFetchResult =
  | {
      ok: true;
      body: Buffer;
      contentType: string;
      etag?: string;
      lastModified?: string;
    }
  | {
      ok: false;
      status: 400 | 502;
      error:
        | 'untrusted_source_url'
        | 'source_fetch_failed'
        | 'source_response_error'
        | 'invalid_content_type'
        | 'image_too_large'
        | 'empty_image';
    };

export function trustedSourceCoverUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 1_024) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
      return undefined;
    }
    if (url.hostname === 'np-newspic.dfcfw.com') {
      if (url.search) return undefined;
      return /^\/download\/[A-Za-z0-9._-]{8,180}\.(?:avif|jpe?g|png|webp)$/i.test(url.pathname)
        ? url
        : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function sourceCoverProxyUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  if (value.startsWith('/')) {
    try {
      const proxy = new URL(value, 'https://holaday.invalid');
      const parameters = [...proxy.searchParams.keys()];
      if (
        proxy.origin !== 'https://holaday.invalid' ||
        proxy.pathname !== '/api/stock-news/source-cover' ||
        proxy.hash ||
        parameters.length !== 1 ||
        parameters[0] !== 'url'
      ) return undefined;
      const source = trustedSourceCoverUrl(proxy.searchParams.get('url'));
      return source
        ? `/api/stock-news/source-cover?url=${encodeURIComponent(source.toString())}`
        : undefined;
    } catch {
      return undefined;
    }
  }

  const source = trustedSourceCoverUrl(value);
  return source
    ? `/api/stock-news/source-cover?url=${encodeURIComponent(source.toString())}`
    : undefined;
}

export async function fetchSourceCover(
  value: unknown,
  fetcher: SourceCoverFetcher = fetch,
): Promise<SourceCoverFetchResult> {
  const source = trustedSourceCoverUrl(value);
  if (!source) return { ok: false, status: 400, error: 'untrusted_source_url' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_COVER_TIMEOUT_MS);
  try {
    const response = await fetcher(source.toString(), {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg',
        'user-agent': 'Holaday-Source-Cover/1.0',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: 502, error: 'source_response_error' };
    }

    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !ALLOWED_CONTENT_TYPES.has(contentType)) {
      return { ok: false, status: 502, error: 'invalid_content_type' };
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > SOURCE_COVER_MAX_BYTES) {
      return { ok: false, status: 502, error: 'image_too_large' };
    }
    if (!response.body) return { ok: false, status: 502, error: 'empty_image' };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      byteLength += chunk.byteLength;
      if (byteLength > SOURCE_COVER_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, status: 502, error: 'image_too_large' };
      }
      chunks.push(chunk);
    }
    if (byteLength === 0) return { ok: false, status: 502, error: 'empty_image' };

    const etag = response.headers.get('etag') ?? undefined;
    const lastModified = response.headers.get('last-modified') ?? undefined;
    return {
      ok: true,
      body: Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        byteLength,
      ),
      contentType,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  } catch {
    return { ok: false, status: 502, error: 'source_fetch_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export const __sourceCoverTest = {
  SOURCE_COVER_MAX_BYTES,
};
