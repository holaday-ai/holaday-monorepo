import { describe, expect, it } from 'vitest';
import { classifyTaskError, extractDomain } from './learning-helpers.js';

describe('extractDomain', () => {
  it('returns null for empty / null / undefined', () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain('')).toBeNull();
    expect(extractDomain('   ')).toBeNull();
  });

  it('returns null when intent has no URL', () => {
    expect(extractDomain('帮我翻译这段话')).toBeNull();
    expect(extractDomain('summarize the weather today')).toBeNull();
  });

  it('extracts hostname from an embedded https URL', () => {
    expect(extractDomain('去 https://item.taobao.com/abc 看看价格')).toBe(
      'item.taobao.com',
    );
  });

  it('extracts hostname from http (insecure)', () => {
    expect(extractDomain('open http://example.com/path')).toBe('example.com');
  });

  it('strips leading www.', () => {
    expect(extractDomain('查 https://www.jd.com/搜索结果')).toBe('jd.com');
  });

  it('lowercases the hostname', () => {
    expect(extractDomain('go to HTTPS://Amazon.COM/cart')).toBe('amazon.com');
  });

  it('preserves non-www subdomains', () => {
    expect(extractDomain('https://m.weibo.cn/u/123')).toBe('m.weibo.cn');
  });

  it('trims trailing sentence punctuation', () => {
    expect(extractDomain('check out https://github.com/issues.')).toBe('github.com');
    expect(extractDomain('see https://example.com/path,')).toBe('example.com');
  });

  it('returns null for localhost-style URLs (no dot)', () => {
    expect(extractDomain('http://localhost:3000/test')).toBeNull();
  });

  it('returns null for ftp / mailto / other schemes', () => {
    expect(extractDomain('mailto:foo@bar.com')).toBeNull();
    expect(extractDomain('ftp://example.com/file')).toBeNull();
  });
});

describe('classifyTaskError', () => {
  it('returns unknown for empty input', () => {
    expect(classifyTaskError(null, null)).toBe('unknown');
    expect(classifyTaskError('', '')).toBe('unknown');
    expect(classifyTaskError('   ', undefined)).toBe('unknown');
  });

  it('identifies DNS errors', () => {
    expect(classifyTaskError('getaddrinfo ENOTFOUND foo.bar', null)).toBe('dns_error');
    expect(classifyTaskError(null, 'net::ERR_NAME_NOT_RESOLVED')).toBe('dns_error');
    expect(classifyTaskError('网络错误，请稍后重试', null)).toBe('dns_error');
  });

  it('identifies timeouts', () => {
    expect(classifyTaskError('Operation timeout after 30s', null)).toBe('timeout');
    expect(classifyTaskError('页面加载超时', null)).toBe('timeout');
    expect(classifyTaskError(null, 'TIMED_OUT')).toBe('timeout');
  });

  it('identifies auth required', () => {
    expect(classifyTaskError('Sign in required', null)).toBe('auth_required');
    expect(classifyTaskError('需要登录才能访问', null)).toBe('auth_required');
    expect(classifyTaskError(null, '401_UNAUTHORIZED')).toBe('auth_required');
  });

  it('identifies captcha', () => {
    expect(classifyTaskError('Please complete the CAPTCHA', null)).toBe('captcha');
    expect(classifyTaskError('遇到人机验证', null)).toBe('captcha');
    expect(classifyTaskError('Cloudflare challenge', null)).toBe('captcha');
  });

  it('identifies 404 / not found', () => {
    expect(classifyTaskError('404 not found', null)).toBe('not_found');
    expect(classifyTaskError('页面不存在', null)).toBe('not_found');
  });

  it('identifies page-structure / element-not-found', () => {
    expect(classifyTaskError('element not found: .submit-btn', null)).toBe(
      'page_structure',
    );
    expect(classifyTaskError('找不到元素 .checkout', null)).toBe('page_structure');
    expect(classifyTaskError('页面结构变化', null)).toBe('page_structure');
  });

  it('identifies verifier and result-quality failures', () => {
    expect(classifyTaskError('质量校验未通过：缺少来源链接', null)).toBe('quality');
    expect(classifyTaskError('Result verification failed check: missing links', null)).toBe(
      'quality',
    );
    expect(classifyTaskError(null, 'partial_success')).toBe('quality');
  });

  it('returns unknown for unrecognised errors', () => {
    expect(classifyTaskError('Some random error happened', null)).toBe('unknown');
  });

  it('searches both errorCode and errorMessage', () => {
    // Code is structured, message is the user-visible text. Either
    // hitting should return the right category.
    expect(classifyTaskError(null, 'DNS_LOOKUP_FAILED')).toBe('dns_error');
    expect(classifyTaskError('something happened', 'NET_TIMEOUT')).toBe('timeout');
  });
});
