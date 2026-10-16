import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EgressLearning, LEARNED_TTL_MS, egressBlockLearner, siteOf } from './egress-learning.js';

/** OPEN-ANY-SITE-1: sites that refused the datacenter egress, for the next launch. */
const file = () => join(mkdtempSync(join(tmpdir(), 'egress-learned-')), 'learned.json');

describe('siteOf', () => {
  it('reduces a host to its registrable site', () => {
    expect(siteOf('www.reddit.com')).toBe('reddit.com');
    expect(siteOf('Old.Reddit.COM.')).toBe('reddit.com');
    expect(siteOf('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteOf('reddit.com')).toBe('reddit.com');
  });
  it('has no site for IPs, local or reserved names', () => {
    for (const host of [
      '127.0.0.1',
      '::1',
      'localhost',
      'search-results.holaday.invalid',
      'box.internal',
      'printer',
    ])
      expect(siteOf(host)).toBeNull();
  });
});

describe('EgressLearning', () => {
  it('keeps sites across restarts and forgets them after the TTL', () => {
    let now = 1_000_000;
    const path = file();
    const store = new EgressLearning({ file: path, now: () => now });
    expect(store.record('www.medium.com', 'http_403')).toBe(true);
    expect(store.record('blog.medium.com', 'captcha')).toBe(false);
    expect(store.sites()).toEqual(['medium.com']);
    const reloaded = new EgressLearning({ file: path, now: () => now });
    expect(reloaded.sites()).toEqual(['medium.com']);
    expect(JSON.parse(readFileSync(path, 'utf8'))['medium.com']).toMatchObject({
      count: 2,
      reason: 'captcha',
    });
    now += LEARNED_TTL_MS + 1;
    expect(reloaded.sites()).toEqual([]);
  });
});

describe('egressBlockLearner', () => {
  const env = (learned: string) => ({
    BROWSER_DOMAIN_PROXY_ENABLED: 'true',
    BROWSER_DOMAIN_PROXY_POOL: 'mobile.example:10001',
    BROWSER_DOMAIN_PROXY_LEARNED_FILE: learned,
  });
  it('is off unless browser-level proxying is configured', () => {
    expect(egressBlockLearner({})).toBeNull();
    expect(egressBlockLearner({ ...env(file()), BROWSER_DOMAIN_PROXY_MODE: 'replay' })).toBeNull();
  });
  it('learns an unlisted site, but not a listed one or its sign-in host', () => {
    const path = file();
    const learn = egressBlockLearner(env(path))!;
    learn('https://www.reddit.com/r/test', 'http_403');
    learn('https://accounts.google.com/signin', 'captcha');
    learn('not a url', 'captcha');
    learn('https://www.zillow.com/homes/', 'http_403');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      'zillow.com': expect.objectContaining({ reason: 'http_403', count: 1 }),
    });
  });
});
