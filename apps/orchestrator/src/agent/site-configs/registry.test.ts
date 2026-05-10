import { describe, expect, it } from 'vitest';

import {
  _getAllSiteConfigsForTest,
  matchSiteConfig,
} from './registry.js';

describe('matchSiteConfig — domain matching', () => {
  it('exact host match', () => {
    expect(matchSiteConfig('https://xiaohongshu.com/')?.siteId).toBe('xiaohongshu');
  });

  it('www.* subdomain match', () => {
    expect(matchSiteConfig('https://www.xiaohongshu.com/')?.siteId).toBe('xiaohongshu');
    expect(matchSiteConfig('https://www.zhihu.com/question/123')?.siteId).toBe('zhihu');
  });

  it('arbitrary subdomain match (m. / api. / etc.)', () => {
    expect(matchSiteConfig('https://m.weibo.cn/profile')?.siteId).toBe('weibo');
    expect(matchSiteConfig('https://m.zhihu.com/answer/42')?.siteId).toBe('zhihu');
  });

  it('case-insensitive host', () => {
    expect(matchSiteConfig('HTTPS://Xiaohongshu.COM/')?.siteId).toBe('xiaohongshu');
  });

  it('does NOT false-match attacker.com.xiaohongshu.com.evil.com', () => {
    expect(matchSiteConfig('https://xiaohongshu.com.evil.com/')).toBeNull();
    expect(matchSiteConfig('https://taobao.com.attacker.example/')).toBeNull();
  });

  it('multiple alias domains match (taobao + tmall)', () => {
    expect(matchSiteConfig('https://taobao.com/')?.siteId).toBe('taobao');
    expect(matchSiteConfig('https://tmall.com/')?.siteId).toBe('taobao');
    expect(matchSiteConfig('https://tmall.hk/')?.siteId).toBe('taobao');
  });

  it('compass + fxg + buyin all map to douyin-compass', () => {
    expect(matchSiteConfig('https://compass.jinritemai.com/')?.siteId).toBe('douyin-compass');
    expect(matchSiteConfig('https://fxg.jinritemai.com/')?.siteId).toBe('douyin-compass');
    expect(matchSiteConfig('https://buyin.jinritemai.com/')?.siteId).toBe('douyin-compass');
  });

  it('unrelated domain returns null', () => {
    expect(matchSiteConfig('https://example.com/')).toBeNull();
    expect(matchSiteConfig('https://google.com/')).toBeNull();
  });

  it('non-http(s) scheme returns null', () => {
    expect(matchSiteConfig('about:blank')).toBeNull();
    expect(matchSiteConfig('chrome-error://chromewebdata/')).toBeNull();
    expect(matchSiteConfig('data:text/html,<p>x</p>')).toBeNull();
  });

  it('malformed URL returns null', () => {
    expect(matchSiteConfig('not a url')).toBeNull();
    expect(matchSiteConfig('')).toBeNull();
    expect(matchSiteConfig(null)).toBeNull();
    expect(matchSiteConfig(undefined)).toBeNull();
  });
});

describe('SiteConfig registry — shape', () => {
  const all = _getAllSiteConfigsForTest();

  it('5 configs registered', () => {
    expect(all).toHaveLength(5);
    expect(all.map((c) => c.siteId).sort()).toEqual(
      ['douyin-compass', 'taobao', 'weibo', 'xiaohongshu', 'zhihu'].sort(),
    );
  });

  it('every config has at least one domain', () => {
    for (const c of all) {
      expect(c.domains.length).toBeGreaterThan(0);
    }
  });

  it('every config has a siteId distinct across the registry', () => {
    const ids = new Set(all.map((c) => c.siteId));
    expect(ids.size).toBe(all.length);
  });

  it('domain lists do not overlap across configs', () => {
    const seen = new Map<string, string>();
    for (const c of all) {
      for (const d of c.domains) {
        const lower = d.toLowerCase();
        const prev = seen.get(lower);
        if (prev) {
          throw new Error(
            `domain "${lower}" appears in both "${prev}" and "${c.siteId}"`,
          );
        }
        seen.set(lower, c.siteId);
      }
    }
  });

  it('requiresAuth is boolean on every config', () => {
    for (const c of all) {
      expect(typeof c.requiresAuth).toBe('boolean');
    }
  });

  it('xiaohongshu + douyin-compass have requiresAuth=true', () => {
    expect(all.find((c) => c.siteId === 'xiaohongshu')?.requiresAuth).toBe(true);
    expect(all.find((c) => c.siteId === 'douyin-compass')?.requiresAuth).toBe(true);
  });
});
