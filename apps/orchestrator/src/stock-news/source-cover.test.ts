import { describe, expect, it, vi } from 'vitest';
import { fetchSourceCover, sourceCoverProxyUrl, trustedSourceCoverUrl } from './source-cover.js';

describe('trusted stock news source covers', () => {
  it('proxies only the publisher-declared Eastmoney cover endpoint', () => {
    const direct = 'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg';
    const proxied =
      '/api/stock-news/source-cover?url=https%3A%2F%2Fnp-newspic.dfcfw.com%2Fdownload%2FD25550525489083947595_w210h154.jpg';

    expect(trustedSourceCoverUrl(direct)?.toString()).toBe(direct);
    expect(sourceCoverProxyUrl(direct)).toBe(proxied);
    expect(sourceCoverProxyUrl(proxied)).toBe(proxied);
  });

  it('rejects arbitrary hosts, credentials, ports, and altered metadata queries', () => {
    expect(trustedSourceCoverUrl('https://example.com/cover.jpg')).toBeUndefined();
    expect(
      trustedSourceCoverUrl(
        'https://user:secret@np-newspic.dfcfw.com/download/D25550525489083947595.jpg',
      ),
    ).toBeUndefined();
    expect(
      trustedSourceCoverUrl('https://np-newspic.dfcfw.com:444/download/D25550525489083947595.jpg'),
    ).toBeUndefined();
    expect(
      trustedSourceCoverUrl(
        'https://np-metadata.eastmoney.com/api/metadata.jpg?event=1&source=3&mode=2&type=1&id=202608093835916746',
      ),
    ).toBeUndefined();
    expect(
      sourceCoverProxyUrl(
        '/api/stock-news/source-cover?url=https%3A%2F%2Fexample.com%2Fcover.jpg',
      ),
    ).toBeUndefined();
    expect(
      sourceCoverProxyUrl(
        '/api/stock-news/source-cover?url=https%3A%2F%2Fnp-newspic.dfcfw.com%2Fdownload%2FD25550525489083947595.jpg&extra=1',
      ),
    ).toBeUndefined();
  });

  it('returns validated image bytes without forwarding a page referrer', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('referer')).toBeNull();
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', etag: 'source-etag' },
      });
    });

    const result = await fetchSourceCover(
      'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg',
      fetcher,
    );

    expect(result).toMatchObject({
      ok: true,
      contentType: 'image/jpeg',
      etag: 'source-etag',
    });
    if (result.ok) expect([...result.body]).toEqual([1, 2, 3]);
  });

  it('rejects non-images and oversized source responses', async () => {
    const htmlResult = await fetchSourceCover(
      'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg',
      async () =>
        new Response('<html>blocked</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    expect(htmlResult).toEqual({ ok: false, status: 502, error: 'invalid_content_type' });

    const oversizedResult = await fetchSourceCover(
      'https://np-newspic.dfcfw.com/download/D25550525489083947595_w210h154.jpg',
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': String(2 * 1024 * 1024 + 1) },
        }),
    );
    expect(oversizedResult).toEqual({ ok: false, status: 502, error: 'image_too_large' });
  });
});
