import { describe, expect, it } from 'vitest';
import { compactLogErrorReason } from './log-error.js';

describe('compactLogErrorReason', () => {
  it('uses concise error messages for logs', () => {
    expect(compactLogErrorReason(new Error('history_search_timeout'))).toBe(
      'history_search_timeout',
    );
    expect(compactLogErrorReason('cookie_domain_timeout:.github.com')).toBe(
      'cookie_domain_timeout:.github.com',
    );
  });

  it('redacts sensitive key-value fragments and clips long messages', () => {
    const result = compactLogErrorReason(
      new Error(`failed accessToken=secret sessionId=sid ${'x'.repeat(300)}`),
    );

    expect(result).toContain('accessToken=redacted');
    expect(result).toContain('sessionId=redacted');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('sid ');
    expect(result).toHaveLength(163);
  });

  it('falls back for unknown error shapes', () => {
    expect(compactLogErrorReason({ nope: true })).toBe('unknown_error');
  });
});
