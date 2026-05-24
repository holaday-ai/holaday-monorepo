import { describe, expect, it } from 'vitest';
import { buildSearchSourceLink } from './search-source-link';

describe('buildSearchSourceLink', () => {
  it('keeps http and https source URLs clickable', () => {
    expect(buildSearchSourceLink('https://www.example.com/report')?.domain).toBe(
      'example.com',
    );
    expect(buildSearchSourceLink(' http://news.example/path ')?.href).toBe(
      'http://news.example/path',
    );
  });

  it('rejects non-web schemes', () => {
    expect(buildSearchSourceLink('javascript:alert(1)')).toBeNull();
    expect(buildSearchSourceLink('data:text/html,<h1>x</h1>')).toBeNull();
    expect(buildSearchSourceLink('file:///etc/passwd')).toBeNull();
  });

  it('rejects relative or malformed source URLs', () => {
    expect(buildSearchSourceLink('/internal/path')).toBeNull();
    expect(buildSearchSourceLink('not a url')).toBeNull();
    expect(buildSearchSourceLink('   ')).toBeNull();
  });
});
