import { describe, expect, it } from 'vitest';
import { resolveBrowserHomeAddress, searchUrlFor } from './browser-home-address.js';

describe('resolveBrowserHomeAddress — BROWSER-HOME-1 address bar', () => {
  it('search words become Google (intl) or Baidu (cn) search pages', () => {
    expect(resolveBrowserHomeAddress('北京 天气', 'cn')).toEqual({
      kind: 'search',
      query: '北京 天气',
      url: `https://www.baidu.com/s?wd=${encodeURIComponent('北京 天气')}`,
    });
    expect(resolveBrowserHomeAddress('weather tokyo', 'intl')).toEqual({
      kind: 'search',
      query: 'weather tokyo',
      url: 'https://www.google.com/search?q=weather%20tokyo',
    });
    expect(resolveBrowserHomeAddress('hello', 'intl')?.kind).toBe('search');
    expect(resolveBrowserHomeAddress('c++', 'cn')?.url).toBe('https://www.baidu.com/s?wd=c%2B%2B');
  });

  it('addresses keep or gain https://', () => {
    expect(resolveBrowserHomeAddress('https://example.com/a?b=1', 'cn')).toEqual({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    });
    expect(resolveBrowserHomeAddress('  example.com/path ', 'cn')).toEqual({
      kind: 'url',
      url: 'https://example.com/path',
    });
    expect(resolveBrowserHomeAddress('news.qq.com:8080/x', 'cn')).toEqual({
      kind: 'url',
      url: 'https://news.qq.com:8080/x',
    });
  });

  it('local / private / metadata hosts stay addresses, so the network policy refuses them', () => {
    expect(resolveBrowserHomeAddress('localhost', 'cn')).toEqual({
      kind: 'url',
      url: 'https://localhost',
    });
    expect(resolveBrowserHomeAddress('localhost:3000', 'cn')?.url).toBe('https://localhost:3000');
    expect(resolveBrowserHomeAddress('10.0.0.1', 'cn')?.url).toBe('https://10.0.0.1');
    expect(resolveBrowserHomeAddress('169.254.169.254/latest', 'intl')?.url).toBe(
      'https://169.254.169.254/latest',
    );
    expect(resolveBrowserHomeAddress('[::1]:8080', 'cn')?.url).toBe('https://[::1]:8080');
  });

  it('any other scheme is kept as an address (never turned into a search)', () => {
    expect(resolveBrowserHomeAddress('file:///etc/passwd', 'cn')).toEqual({
      kind: 'url',
      url: 'file:///etc/passwd',
    });
    expect(resolveBrowserHomeAddress('javascript:alert(1)', 'intl')?.kind).toBe('url');
  });

  it('empty input is nothing', () => {
    expect(resolveBrowserHomeAddress('   ', 'cn')).toBeNull();
  });

  it('caps the query length', () => {
    expect(searchUrlFor('a'.repeat(2000), 'intl')).toBe(
      `https://www.google.com/search?q=${'a'.repeat(512)}`,
    );
  });
});
