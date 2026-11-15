import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __avatarTest, fetchAvatar, trustedAvatarUrl } from './avatar-proxy.js';

const GOOGLE = 'https://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc=s96-c';
const png = (bytes = 8) =>
  new Response(new Uint8Array(bytes).fill(1), { headers: { 'content-type': 'image/png' } });

describe('G7 / Q-8: avatar proxy only for Google profile photos', () => {
  beforeEach(() => __avatarTest.clear());

  it('accepts a Google profile photo; refuses everything else', () => {
    expect(trustedAvatarUrl(GOOGLE)?.hostname).toBe('lh3.googleusercontent.com');
    expect(
      trustedAvatarUrl('https://lh6.googleusercontent.com/a-/AOh14Gabcdefghijk'),
    ).toBeDefined();
    for (const bad of [
      'http://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc',
      'https://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc?x=1',
      'https://lh3.googleusercontent.com:8443/a/ACg8ocJxYz1234567890abc',
      'https://user@lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc',
      'https://lh3.googleusercontent.com/d/ACg8ocJxYz1234567890abc',
      'https://lh3.googleusercontent.com.evil.example/a/ACg8ocJxYz1234567890abc',
      'https://169.254.169.254/a/ACg8ocJxYz1234567890abc',
      'https://drive.google.com/a/ACg8ocJxYz1234567890abc',
      'file:///etc/passwd',
      42,
    ])
      expect(trustedAvatarUrl(bad)).toBeUndefined();
  });

  it('fetches once with no redirects, then serves from the cache', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => png());
    const first = await fetchAvatar(GOOGLE, fetcher);
    const second = await fetchAvatar(GOOGLE, fetcher);
    expect(first).toMatchObject({ ok: true, contentType: 'image/png' });
    expect(second).toMatchObject({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it('refuses a non-image, an oversized image, an error status and an untrusted URL', async () => {
    expect(
      await fetchAvatar(
        GOOGLE,
        async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      ),
    ).toMatchObject({ ok: false, error: 'invalid_content_type' });
    __avatarTest.clear();
    expect(
      await fetchAvatar(GOOGLE, async () => png(__avatarTest.AVATAR_MAX_BYTES + 1)),
    ).toMatchObject({
      ok: false,
      error: 'image_too_large',
    });
    __avatarTest.clear();
    expect(await fetchAvatar(GOOGLE, async () => new Response('', { status: 404 }))).toMatchObject({
      ok: false,
      error: 'avatar_response_error',
    });
    const fetcher = vi.fn(async () => png());
    expect(await fetchAvatar('https://example.com/a.png', fetcher)).toMatchObject({
      ok: false,
      status: 400,
      error: 'untrusted_avatar_url',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the cache bounded', async () => {
    let t = 0;
    for (let i = 0; i < __avatarTest.AVATAR_CACHE_MAX + 20; i += 1) {
      // A new minute every 50 fetches, so the rate cap does not stop the fill.
      if (i % 50 === 0) t += 61_000;
      await fetchAvatar(
        `https://lh3.googleusercontent.com/a/ACg8oc${String(i).padStart(8, '0')}`,
        async () => png(),
        () => t,
      );
    }
    expect(__avatarTest.size()).toBe(__avatarTest.AVATAR_CACHE_MAX);
  });

  it('复审 P2: bytes cap, failures cached, concurrent requests merged, upstream fetches capped per minute', async () => {
    const big = Math.floor(__avatarTest.AVATAR_MAX_BYTES * 0.9);
    let t = 0;
    for (let i = 0; i < 60; i += 1) {
      if (i % 50 === 0) t += 61_000;
      await fetchAvatar(
        `https://lh3.googleusercontent.com/a/ACg8big${String(i).padStart(6, '0')}`,
        async () => png(big),
        () => t,
      );
    }
    expect(__avatarTest.bytes()).toBeLessThanOrEqual(__avatarTest.AVATAR_CACHE_MAX_BYTES);
    __avatarTest.clear();
    const failing = vi.fn(async () => new Response('', { status: 404 }));
    await fetchAvatar(GOOGLE, failing, () => 1);
    await fetchAvatar(GOOGLE, failing, () => 2);
    expect(failing).toHaveBeenCalledTimes(1);
    __avatarTest.clear();
    const slow = vi.fn(async () => png());
    await Promise.all([fetchAvatar(GOOGLE, slow, () => 1), fetchAvatar(GOOGLE, slow, () => 1)]);
    expect(slow).toHaveBeenCalledTimes(1);
    __avatarTest.clear();
    const many = vi.fn(async () => png());
    const results = [];
    for (let i = 0; i <= __avatarTest.AVATAR_FETCHES_PER_MINUTE; i += 1)
      results.push(
        await fetchAvatar(
          `https://lh3.googleusercontent.com/a/ACg8rate${String(i).padStart(6, '0')}`,
          many,
          () => 5,
        ),
      );
    expect(many).toHaveBeenCalledTimes(__avatarTest.AVATAR_FETCHES_PER_MINUTE);
    expect(results.at(-1)).toMatchObject({ ok: false, status: 503, error: 'avatar_busy' });
  });
});
