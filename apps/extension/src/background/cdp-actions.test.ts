import { describe, expect, it } from 'vitest';
import { executeCdpAction, normalizeCdpNavigateUrl } from './cdp-actions.js';

describe('normalizeCdpNavigateUrl', () => {
  it('accepts http and https urls after trimming', () => {
    expect(normalizeCdpNavigateUrl(' https://example.com/path ')).toBe(
      'https://example.com/path',
    );
    expect(normalizeCdpNavigateUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects empty, malformed, internal, and oversized urls', () => {
    expect(() => normalizeCdpNavigateUrl('')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl('not a url')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl('chrome://extensions')).toThrow('bad_url');
    expect(() => normalizeCdpNavigateUrl(`https://example.com/${'a'.repeat(2050)}`)).toThrow(
      'bad_url',
    );
  });
});

describe('executeCdpAction', () => {
  it('returns friendly invalid-url copy before attaching the debugger', async () => {
    await expect(
      executeCdpAction(1, { kind: 'navigate', url: 'chrome://extensions' }),
    ).resolves.toEqual({
      ok: false,
      message: '导航地址无效，请检查后重试',
    });
  });
});
