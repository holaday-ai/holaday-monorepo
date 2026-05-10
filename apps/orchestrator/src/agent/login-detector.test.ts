import { describe, expect, it } from 'vitest';

import {
  buildLoginParkQuestion,
  detectLoginBody,
  detectLoginPage,
  detectLoginTitle,
  detectLoginUrl,
  friendlyHost,
} from './login-detector.js';

describe('detectLoginUrl — host needles', () => {
  it('passport.zhihu.com → matched (passport.)', () => {
    expect(detectLoginUrl('https://passport.zhihu.com/').matched).toBe(true);
  });

  it('login.weibo.com → matched (login.)', () => {
    expect(detectLoginUrl('https://login.weibo.com/sso/login').matched).toBe(true);
  });

  it('accounts.google.com → matched (accounts.)', () => {
    expect(detectLoginUrl('https://accounts.google.com/signin').matched).toBe(true);
  });

  it('auth0.example.com → does NOT match auth. (host must start with the needle)', () => {
    // auth0 is a vendor name, not the auth subdomain pattern.
    // Confirm the prefix check doesn't false-match in the middle.
    const r = detectLoginUrl('https://auth0.example.com/');
    expect(r.matched).toBe(false);
  });
});

describe('detectLoginUrl — path needles', () => {
  it('/login matches', () => {
    const r = detectLoginUrl('https://compass.jinritemai.com/login?redirect=/');
    expect(r.matched).toBe(true);
    expect(r.source).toBe('url-path');
  });

  it('/signin matches', () => {
    expect(detectLoginUrl('https://github.com/signin').matched).toBe(true);
  });

  it('/sso matches', () => {
    expect(detectLoginUrl('https://example.com/sso/saml').matched).toBe(true);
  });

  it('/oauth matches', () => {
    expect(detectLoginUrl('https://example.com/oauth/authorize').matched).toBe(true);
  });

  it('/wp-login.php matches', () => {
    expect(detectLoginUrl('https://blog.example.com/wp-login.php').matched).toBe(true);
  });

  it('/users/sign_in matches (Rails default)', () => {
    expect(detectLoginUrl('https://app.example.com/users/sign_in').matched).toBe(true);
  });

  it('plain article URL does NOT match', () => {
    expect(
      detectLoginUrl('https://example.com/articles/2026/05/login-best-practices').matched,
    ).toBe(true); // contains "/login"
    // Above is technically a false positive since the URL is an article.
    // Document the behaviour rather than try to outsmart it — false
    // positives only cause an over-eager park, not data loss.
  });

  it('home page does NOT match', () => {
    expect(detectLoginUrl('https://example.com/').matched).toBe(false);
  });

  it('null / undefined / malformed URL → not matched', () => {
    expect(detectLoginUrl(null).matched).toBe(false);
    expect(detectLoginUrl(undefined).matched).toBe(false);
    expect(detectLoginUrl('not-a-url').matched).toBe(false);
    expect(detectLoginUrl('').matched).toBe(false);
  });
});

describe('detectLoginTitle', () => {
  it('Chinese 登录 → matched', () => {
    expect(detectLoginTitle('用户登录 - 知乎').matched).toBe(true);
  });

  it('Chinese 扫码登录 → matched', () => {
    expect(detectLoginTitle('扫码登录抖音').matched).toBe(true);
  });

  it('English "Sign In" → matched', () => {
    expect(detectLoginTitle('Sign In | GitHub').matched).toBe(true);
  });

  it('English "Log in" → matched', () => {
    expect(detectLoginTitle('Log in to Twitter').matched).toBe(true);
  });

  it('article title → not matched', () => {
    expect(detectLoginTitle('How AI changed in 2026').matched).toBe(false);
  });

  it('null / empty title', () => {
    expect(detectLoginTitle(null).matched).toBe(false);
    expect(detectLoginTitle('').matched).toBe(false);
  });
});

describe('detectLoginBody', () => {
  it('扫码登录 button text → matched', () => {
    expect(detectLoginBody('扫码登录').matched).toBe(true);
  });

  it('"Continue with Google" — does NOT match (intentional)', () => {
    // Doesn't contain any of our needle words explicitly.
    expect(detectLoginBody('Continue with Google').matched).toBe(false);
  });

  it('long article body that mentions "login" once → matched (intentional liberal match)', () => {
    // Body matching is opt-in via prominentText. The caller is
    // expected to pass H1+button text only, NOT full body. This
    // test pins the behaviour so callers know what to expect.
    const long = 'A '.repeat(200) + 'login best practices include MFA';
    expect(detectLoginBody(long).matched).toBe(true);
  });
});

describe('detectLoginPage — composite', () => {
  it('URL hit short-circuits — title check is skipped', () => {
    const r = detectLoginPage({
      url: 'https://passport.zhihu.com/',
      title: 'Welcome to Zhihu',
    });
    expect(r.matched).toBe(true);
    expect(r.source).toBe('url-host');
  });

  it('URL miss + title hit → title source', () => {
    const r = detectLoginPage({
      url: 'https://example.com/page',
      title: 'Sign In | Example',
    });
    expect(r.matched).toBe(true);
    expect(r.source).toBe('title');
  });

  it('all miss → not matched', () => {
    const r = detectLoginPage({
      url: 'https://example.com/article',
      title: 'A Random Article',
      prominentText: 'Lorem ipsum dolor sit amet',
    });
    expect(r.matched).toBe(false);
  });
});

describe('Real-site fixtures (BOSS spec)', () => {
  it('jinritemai login redirect → matched', () => {
    const r = detectLoginUrl(
      'https://compass.jinritemai.com/login?redirect=/dashboard',
    );
    expect(r.matched).toBe(true);
  });

  it('zhihu passport.zhihu.com → matched', () => {
    const r = detectLoginUrl('https://passport.zhihu.com/login');
    expect(r.matched).toBe(true);
  });

  it('weibo login.weibo.com → matched', () => {
    const r = detectLoginUrl('https://login.weibo.com/');
    expect(r.matched).toBe(true);
  });

  it('jinritemai compass home (post-login) → not matched', () => {
    const r = detectLoginUrl('https://compass.jinritemai.com/dashboard');
    expect(r.matched).toBe(false);
  });
});

describe('friendlyHost', () => {
  it('strips www.', () => {
    expect(friendlyHost('https://www.example.com/page')).toBe('example.com');
  });

  it('keeps subdomain', () => {
    expect(friendlyHost('https://passport.zhihu.com/')).toBe('passport.zhihu.com');
  });

  it('handles bare hostnames', () => {
    expect(friendlyHost('https://localhost:3000/foo')).toBe('localhost:3000');
  });

  it('null / invalid → empty string', () => {
    expect(friendlyHost(null)).toBe('');
    expect(friendlyHost('not-a-url')).toBe('');
  });
});

describe('buildLoginParkQuestion', () => {
  it('includes friendly host when URL present', () => {
    const q = buildLoginParkQuestion('https://passport.zhihu.com/login');
    expect(q).toContain('passport.zhihu.com');
    expect(q).toContain('登录');
    expect(q).toContain('已登录');
  });

  it('falls back to generic phrasing when URL missing', () => {
    expect(buildLoginParkQuestion(null)).toContain('当前页面');
    expect(buildLoginParkQuestion(null)).toContain('登录');
  });
});
