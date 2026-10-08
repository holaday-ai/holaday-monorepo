import { describe, expect, it } from 'vitest';
import { isHashRoute, stripTrackingFromUrl, urlResourceIdentity } from './url-identity.js';

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
  it('treats anchors, tracking variants, case, www, slash and query order as one resource', () => {
    const id = urlResourceIdentity('https://news.example.test/article/42');
    for (const variant of [
      'https://news.example.test/article/42#s1',
      'https://news.example.test/article/42#s2',
      'http://WWW.News.Example.test/article/42/',
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
