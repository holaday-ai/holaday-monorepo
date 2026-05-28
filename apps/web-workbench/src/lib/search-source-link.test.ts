import { describe, expect, it } from 'vitest';
import { buildSearchSourceLink } from './search-source-link';

describe('buildSearchSourceLink', () => {
  it('keeps http and https source URLs clickable', () => {
    expect(buildSearchSourceLink('https://www.example.com/report')).toMatchObject({
      domain: 'example.com',
      pathLabel: 'report',
    });
    expect(buildSearchSourceLink(' http://news.example/path ')?.href).toBe(
      'http://news.example/path',
    );
  });

  it('builds compact path labels without query noise', () => {
    expect(
      buildSearchSourceLink(
        'https://docs.example.com/reports/2026/may?token=secret#section',
      )?.pathLabel,
    ).toBe('reports / 2026');
    expect(buildSearchSourceLink('https://example.com/')?.pathLabel).toBe('首页');
  });

  it('keeps malformed path escapes displayable', () => {
    expect(buildSearchSourceLink('https://example.com/%E0%A4%A')?.pathLabel).toBe(
      '%E0%A4%A',
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
