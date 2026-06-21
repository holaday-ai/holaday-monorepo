import { describe, expect, it } from 'vitest';
import {
  extractBundleHash,
  fetchDeployedBundleHash,
  getLoadedBundleHash,
  isNewVersionAvailable,
} from './version-check';

describe('extractBundleHash', () => {
  it('pulls the index-<hash>.js hash from index.html', () => {
    expect(extractBundleHash('<script src="/assets/index-B8q1wOE7.js"></script>')).toBe('B8q1wOE7');
    expect(extractBundleHash('…index-D6HnnOOe.js…')).toBe('D6HnnOOe');
  });
  it('returns null when no bundle reference is present', () => {
    expect(extractBundleHash('<html><body>no script</body></html>')).toBeNull();
    expect(extractBundleHash('')).toBeNull();
  });
});

describe('isNewVersionAvailable', () => {
  it('true only when both hashes are known AND differ', () => {
    expect(isNewVersionAvailable('AAA', 'BBB')).toBe(true);
  });
  it('false when equal (same deploy)', () => {
    expect(isNewVersionAvailable('AAA', 'AAA')).toBe(false);
  });
  it('false when either side is unknown (never a false positive)', () => {
    expect(isNewVersionAvailable(null, 'BBB')).toBe(false);
    expect(isNewVersionAvailable('AAA', null)).toBe(false);
    expect(isNewVersionAvailable(null, null)).toBe(false);
  });
});

describe('getLoadedBundleHash', () => {
  it('reads the hash off the first index-* script tag', () => {
    const doc = {
      querySelectorAll: () => [
        { src: 'https://holaday.ai/assets/polyfill.js' },
        { src: 'https://holaday.ai/assets/index-Zz9_aA0.js' },
      ],
    } as unknown as Document;
    expect(getLoadedBundleHash(doc)).toBe('Zz9_aA0');
  });
  it('returns null when no index-* script is present', () => {
    const doc = { querySelectorAll: () => [{ src: '/assets/vendor.js' }] } as unknown as Document;
    expect(getLoadedBundleHash(doc)).toBeNull();
  });
});

describe('fetchDeployedBundleHash', () => {
  it('fetches index.html (no-store) and extracts the hash', async () => {
    const calls: Array<{ url: string; cache?: string }> = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, cache: init?.cache });
      return { ok: true, text: async () => '<script src="/assets/index-NEWHASH1.js">' } as Response;
    }) as unknown as typeof fetch;
    expect(await fetchDeployedBundleHash(fakeFetch)).toBe('NEWHASH1');
    expect(calls[0]).toEqual({ url: '/index.html', cache: 'no-store' });
  });
  it('returns null on a non-200 response', async () => {
    const fakeFetch = (async () => ({ ok: false, text: async () => '' }) as Response) as unknown as typeof fetch;
    expect(await fetchDeployedBundleHash(fakeFetch)).toBeNull();
  });
  it('returns null (no throw) on a network error', async () => {
    const fakeFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await fetchDeployedBundleHash(fakeFetch)).toBeNull();
  });
});
