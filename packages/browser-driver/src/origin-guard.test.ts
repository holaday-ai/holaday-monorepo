import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './origin-guard.js';

describe('isOriginAllowed', () => {
  it('empty allowlist = no restriction', () => {
    expect(isOriginAllowed('https://anywhere.com/page', [])).toBe(true);
  });

  it('bare host match (exact)', () => {
    expect(isOriginAllowed('https://example.com/', ['example.com'])).toBe(true);
    expect(isOriginAllowed('https://foo.example.com/', ['example.com'])).toBe(false);
  });

  it('wildcard subdomain form matches parent and children', () => {
    expect(isOriginAllowed('https://example.com/', ['*.example.com'])).toBe(true);
    expect(isOriginAllowed('https://api.example.com/', ['*.example.com'])).toBe(true);
    expect(isOriginAllowed('https://deeply.nested.example.com/', ['*.example.com'])).toBe(true);
  });

  it('wildcard does NOT match lookalike hosts', () => {
    expect(isOriginAllowed('https://evilexample.com/', ['*.example.com'])).toBe(false);
    expect(isOriginAllowed('https://example.com.attacker.cn/', ['*.example.com'])).toBe(false);
  });

  it('host:port rule requires exact port match', () => {
    expect(isOriginAllowed('https://api.example.com:8443/', ['api.example.com:8443'])).toBe(true);
    expect(isOriginAllowed('https://api.example.com/', ['api.example.com:8443'])).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isOriginAllowed('not a url', ['example.com'])).toBe(false);
  });

  it('matches the douyin + xueqiu Skill allowlists end-to-end', () => {
    const douyin = ['*.jinritemai.com', '*.snssdk.com'];
    expect(isOriginAllowed('https://compass.jinritemai.com/', douyin)).toBe(true);
    expect(isOriginAllowed('https://fxg.jinritemai.com/ffa/mshop/comment/list', douyin)).toBe(true);
    expect(isOriginAllowed('https://passport.snssdk.com/web/login', douyin)).toBe(true);
    expect(isOriginAllowed('https://xueqiu.com/', douyin)).toBe(false);

    const xueqiu = ['xueqiu.com', '*.xueqiu.com', '*.snssdk.com'];
    expect(isOriginAllowed('https://xueqiu.com/', xueqiu)).toBe(true);
    expect(isOriginAllowed('https://hq.xueqiu.com/', xueqiu)).toBe(true);
    expect(isOriginAllowed('https://jinritemai.com/', xueqiu)).toBe(false);
  });
});
