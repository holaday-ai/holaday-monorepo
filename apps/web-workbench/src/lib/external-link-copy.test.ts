import { describe, expect, it } from 'vitest';
import {
  displayExternalHref,
  externalLinkConfirmDescription,
} from './external-link-copy';

describe('displayExternalHref', () => {
  it('keeps short URLs intact', () => {
    expect(displayExternalHref('https://example.com/report')).toBe(
      'https://example.com/report',
    );
  });

  it('truncates long URLs while preserving the origin and tail', () => {
    const href =
      'https://example.com/reports/2026/very/long/path/with/a/lot/of/segments?utm_source=newsletter&utm_campaign=spring-launch&token=abcdef1234567890#section-12';

    const displayed = displayExternalHref(href);

    expect(displayed.length).toBeLessThanOrEqual(96);
    expect(displayed).toMatch(/^https:\/\/example\.com/);
    expect(displayed).toContain('…');
    expect(displayed).toContain('#section-12');
    expect(displayed).not.toContain('abcdef1234567890');
  });

  it('truncates invalid hrefs without throwing', () => {
    const href = 'not a url '.repeat(20);

    const displayed = displayExternalHref(href);

    expect(displayed.length).toBeLessThanOrEqual(96);
    expect(displayed).toContain('…');
  });
});

describe('externalLinkConfirmDescription', () => {
  it('includes the safety copy and compact href', () => {
    const description = externalLinkConfirmDescription(
      'https://example.com/path?token=very-secret-token'.repeat(4),
    );

    expect(description).toContain('部分外部页面可能需要登录或无法正常访问。确认打开？');
    expect(description).toContain('https://example.com');
    expect(description).toContain('…');
    expect(description).not.toContain('very-secret-token'.repeat(2));
  });
});
