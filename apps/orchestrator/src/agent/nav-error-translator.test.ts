import { describe, expect, it } from 'vitest';

import { translateNavError } from './nav-error-translator.js';

describe('translateNavError', () => {
  it('DNS — ERR_NAME_NOT_RESOLVED', () => {
    const r = translateNavError(new Error('net::ERR_NAME_NOT_RESOLVED at https://does-not-exist.example/'));
    expect(r.kind).toBe('dns');
    expect(r.friendly).toContain('无法访问');
    expect(r.friendly).toContain('拼写');
  });

  it('DNS — ENOTFOUND', () => {
    const r = translateNavError(new Error('getaddrinfo ENOTFOUND nope.example.com'));
    expect(r.kind).toBe('dns');
  });

  it('DNS — NXDOMAIN', () => {
    const r = translateNavError(new Error('DNS_PROBE_FINISHED_NXDOMAIN'));
    expect(r.kind).toBe('dns');
  });

  it('SSL — ERR_CERT_AUTHORITY_INVALID', () => {
    const r = translateNavError(new Error('net::ERR_CERT_AUTHORITY_INVALID at https://expired.badssl.com/'));
    expect(r.kind).toBe('ssl');
    expect(r.friendly).toContain('证书');
    expect(r.friendly).toContain('安全');
  });

  it('SSL — ERR_CERT_DATE_INVALID', () => {
    const r = translateNavError(new Error('net::ERR_CERT_DATE_INVALID'));
    expect(r.kind).toBe('ssl');
  });

  it('Timeout — Playwright TimeoutError', () => {
    const r = translateNavError(new Error('page.goto: Timeout 30000ms exceeded'));
    expect(r.kind).toBe('timeout');
    expect(r.friendly).toContain('超时');
    expect(r.friendly).toContain('重试');
  });

  it('Timeout — ERR_TIMED_OUT', () => {
    const r = translateNavError(new Error('net::ERR_TIMED_OUT at https://slow.example/'));
    expect(r.kind).toBe('timeout');
  });

  it('Connection refused — ERR_CONNECTION_REFUSED', () => {
    const r = translateNavError(new Error('net::ERR_CONNECTION_REFUSED'));
    expect(r.kind).toBe('connection_refused');
    expect(r.friendly).toContain('拒绝');
  });

  it('Connection reset — ECONNRESET', () => {
    const r = translateNavError(new Error('ECONNRESET while reading'));
    expect(r.kind).toBe('connection_refused');
  });

  it('Generic fallback — surfaces a one-line hint', () => {
    const r = translateNavError(new Error('Some weird error string that does not match'));
    expect(r.kind).toBe('generic');
    expect(r.friendly).toContain('页面加载失败');
    expect(r.friendly).toContain('Some weird error');
  });

  it('Generic fallback — truncates long messages', () => {
    const long = 'A'.repeat(500);
    const r = translateNavError(new Error(long));
    expect(r.kind).toBe('generic');
    // Friendly version has at most an 80-char hint + boilerplate, not 500+
    expect(r.friendly.length).toBeLessThan(150);
  });

  it('Generic fallback — strips trailing newlines / stack frames', () => {
    const e = new Error('First-line error\n  at FakeStack:1:1\n  at AnotherFrame:2:2');
    const r = translateNavError(e);
    expect(r.kind).toBe('generic');
    expect(r.friendly).toContain('First-line error');
    expect(r.friendly).not.toContain('FakeStack');
  });

  it('Non-Error input (string thrown)', () => {
    const r = translateNavError('net::ERR_NAME_NOT_RESOLVED');
    expect(r.kind).toBe('dns');
  });

  it('rawMessage is preserved (truncated) for logs', () => {
    const r = translateNavError(new Error('net::ERR_NAME_NOT_RESOLVED at https://nope/'));
    expect(r.rawMessage).toContain('net::ERR_NAME_NOT_RESOLVED');
  });
});
