import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  isHashRoute,
  isNonDetailUrl,
  stripTrackingFromUrl,
  urlResourceIdentity,
} from './url-identity.js';

describe('stripTrackingFromUrl', () => {
  it('keeps a resource id in the query and drops only tracking parameters', () => {
    expect(
      stripTrackingFromUrl('https://news.example.test/article?id=42&utm_source=feed&spm=a.b.c'),
    ).toBe('https://news.example.test/article?id=42');
    expect(stripTrackingFromUrl('https://shop.example.test/item?sku=100012&gclid=xyz')).toBe(
      'https://shop.example.test/item?sku=100012',
    );
  });

  it('never touches signed-URL parameters and keeps their exact encoding', () => {
    const s3 =
      'https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=ab%2Fcd';
    expect(stripTrackingFromUrl(s3)).toBe(s3);
    const signed = 'https://cdn.example.test/v.mp4?sign=a%2Bb&token=t0&expires=1791400000';
    expect(stripTrackingFromUrl(signed)).toBe(signed);
    expect(stripTrackingFromUrl(`${signed}&utm_medium=share`)).toBe(
      'https://cdn.example.test/v.mp4?sign=a%2Bb&token=t0&expires=1791400000',
    );
  });

  it('keeps SPA hash routes and drops in-page anchors', () => {
    expect(stripTrackingFromUrl('https://app.example.test/#/item/42?tab=spec')).toBe(
      'https://app.example.test/#/item/42?tab=spec',
    );
    expect(stripTrackingFromUrl('https://app.example.test/#!/post/7')).toBe(
      'https://app.example.test/#!/post/7',
    );
    expect(stripTrackingFromUrl('https://news.example.test/article/42#comments')).toBe(
      'https://news.example.test/article/42',
    );
    expect(isHashRoute('#/a')).toBe(true);
    expect(isHashRoute('#section')).toBe(false);
  });

  it('removes a query made only of tracking parameters', () => {
    expect(
      stripTrackingFromUrl(
        'https://example.test/p/1?utm_source=a&utm_medium=b&gclid=c&fbclid=d&share_token=e',
      ),
    ).toBe('https://example.test/p/1');
  });

  it('keeps travel route parameters such as from / to', () => {
    const route = 'https://flights.example.test/search?from=SHA&to=PEK&date=2026-10-20';
    expect(stripTrackingFromUrl(`${route}&utm_source=app`)).toBe(route);
    expect(urlResourceIdentity('https://trains.example.test/list?from=SHA&to=PEK')).not.toBe(
      urlResourceIdentity('https://trains.example.test/list?from=PEK&to=SHA'),
    );
  });

  it('keeps relative forms and accepts a custom tracking list', () => {
    expect(stripTrackingFromUrl('/p/1?spm=x#top')).toBe('/p/1');
    expect(stripTrackingFromUrl('//item.jd.com/1.html?bbtf=1')).toBe('//item.jd.com/1.html?bbtf=1');
    expect(stripTrackingFromUrl('//item.jd.com/1.html?bbtf=1', { params: ['bbtf'] })).toBe(
      '//item.jd.com/1.html',
    );
    expect(stripTrackingFromUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
  });
});

describe('urlResourceIdentity', () => {
  it('treats anchors, tracking variants, host case, www and name order as one resource', () => {
    const id = urlResourceIdentity('https://news.example.test/article/42');
    for (const variant of [
      'https://news.example.test/article/42#s1',
      'https://news.example.test/article/42#s2',
      'http://WWW.News.Example.test/article/42',
      'https://news.example.test/article/42?utm_source=x&spm=y',
    ])
      expect(urlResourceIdentity(variant)).toBe(id);
    expect(urlResourceIdentity('https://a.test/x?b=2&a=1')).toBe(
      urlResourceIdentity('https://a.test/x?a=1&b=2'),
    );
  });

  it('keeps semantic queries and SPA routes distinct', () => {
    expect(urlResourceIdentity('https://a.test/article?id=1')).not.toBe(
      urlResourceIdentity('https://a.test/article?id=2'),
    );
    expect(urlResourceIdentity('https://app.test/#/item/1')).not.toBe(
      urlResourceIdentity('https://app.test/#/item/2'),
    );
    expect(urlResourceIdentity('not a url')).toBeNull();
  });
});

describe('accessible address keeps every byte except tracking tokens (PR #247 review 2, P1-1)', () => {
  // Synthetic HMAC over the raw query (tracking tokens excluded), like a CDN signer.
  const sign = (raw: string) => createHmac('sha256', 'synthetic-fixture').update(raw).digest('hex');
  const server = createServer((req, res) => {
    const raw = req.url ?? '';
    const [unsigned, sig] = raw.split('&sig=');
    res.statusCode = sig && sig === sign(unsigned ?? '') ? 200 : 403;
    res.end();
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it.each([
    ['%20 and lower-case %2f', '/asset?payload=a%20b%2fC&expires=123456'],
    ['repeated parameters', '/asset?tag=b&tag=a&expires=1&a+b=c'],
    ['a tracking token in the middle', '/asset?x=1&utm_source=feed&y=%7e'],
  ])('a signed URL with %s still verifies after stripping', async (_label, path) => {
    const unsigned = path.replace(/&utm_source=feed/, '');
    const signed = `${base}${path}&sig=${sign(unsigned)}&utm_medium=share&gclid=abc`;
    const stripped = stripTrackingFromUrl(signed);
    expect(stripped).toBe(`${base}${unsigned}&sig=${sign(unsigned)}`);
    expect((await fetch(stripped)).status).toBe(200);
  });

  it('strips tracking inside an SPA route without touching the route', () => {
    expect(stripTrackingFromUrl('https://app.test/#/post/42?utm_source=feed&tab=a%20b')).toBe(
      'https://app.test/#/post/42?tab=a%20b',
    );
  });

  it('matches custom tracking names case-insensitively', () => {
    expect(stripTrackingFromUrl('https://a.test/p/1?TRACK=1&id=2', { params: ['TRACK'] })).toBe(
      'https://a.test/p/1?id=2',
    );
    expect(stripTrackingFromUrl('https://a.test/p/1?Ref_Tag=1', { prefixes: ['REF_'] })).toBe(
      'https://a.test/p/1',
    );
  });
});

describe('identity key (dedupe only) — PR #247 review 2, P1-3 / P2-4', () => {
  it('counts SPA route tracking and name-order variants as one source', () => {
    const one = urlResourceIdentity('https://app.example.test/#/post/42');
    for (const variant of [
      'https://app.example.test/#/post/42?utm_source=feed1',
      'https://app.example.test/#/post/42?utm_source=feed2',
      'https://app.example.test/#!/post/42?spm=x',
    ])
      expect(urlResourceIdentity(variant)).toBe(one);
    expect(urlResourceIdentity('https://app.example.test/#/post/42?a=1&b=2')).toBe(
      urlResourceIdentity('https://app.example.test/#/post/42?b=2&a=1'),
    );
    expect(urlResourceIdentity('https://app.example.test/#/post/1')).not.toBe(
      urlResourceIdentity('https://app.example.test/#/post/2'),
    );
    expect(urlResourceIdentity('https://app.example.test/#/post?id=1')).not.toBe(
      urlResourceIdentity('https://app.example.test/#/post?id=2'),
    );
  });

  it('keeps same-name parameter order and trailing slashes significant', () => {
    expect(urlResourceIdentity('https://a.test/d?id=1&id=2')).not.toBe(
      urlResourceIdentity('https://a.test/d?id=2&id=1'),
    );
    expect(urlResourceIdentity('https://a.test/d?id=1&x=0&id=2')).toBe(
      urlResourceIdentity('https://a.test/d?x=0&id=1&id=2'),
    );
    expect(urlResourceIdentity('https://a.test/slash')).not.toBe(
      urlResourceIdentity('https://a.test/slash/'),
    );
  });
});

describe('detail-page judgement (shared by verifier, auto-fix and scorer)', () => {
  it.each([
    ['https://news.example.test/article/42', false],
    ['https://news.example.test/?id=3', false],
    ['https://app.example.test/#/post/7', false],
    ['https://app.example.test/#/', true],
    ['https://app.example.test/#/search?q=x', true],
    ['https://app.example.test/#/post?keyword=x', true],
    ['https://news.example.test/', true],
    ['https://shop.example.test/s?k=1', true],
  ])('%s → non-detail %s', (url, expected) => {
    expect(isNonDetailUrl(url)).toBe(expected);
  });
});
