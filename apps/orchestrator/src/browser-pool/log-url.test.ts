import { describe, expect, it } from 'vitest';
import { browserUrlForLog } from './log-url.js';

describe('browserUrlForLog', () => {
  it('keeps only the origin and removes userinfo, paths, query parameters, and fragments', () => {
    expect(
      browserUrlForLog('https://alice:secret@example.com/oauth/callback?code=abc&token=xyz#done'),
    ).toBe('https://example.com/');
  });

  it('never echoes opaque or short credential-like path segments', () => {
    expect(
      browserUrlForLog(
        'https://files.example.com/download/eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnopqrstuvwxyz0123456789',
      ),
    ).toBe('https://files.example.com/');
    expect(browserUrlForLog('https://files.example.com/reset/hunter2')).toBe(
      'https://files.example.com/',
    );
  });

  it('does not echo malformed or non-http targets', () => {
    expect(browserUrlForLog('not a url?token=secret')).toBe('[invalid-url]');
    expect(browserUrlForLog('file:///proc/self/environ')).toBe('[non-http-url]');
  });
});
