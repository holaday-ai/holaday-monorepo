import { describe, expect, it } from 'vitest';
import { isTrustedAuthBridgeSender } from './auth-bridge-trust.js';

describe('isTrustedAuthBridgeSender', () => {
  it('rejects undefined / empty', () => {
    expect(isTrustedAuthBridgeSender(undefined)).toBe(false);
    expect(isTrustedAuthBridgeSender('')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isTrustedAuthBridgeSender('not a url')).toBe(false);
    expect(isTrustedAuthBridgeSender('javascript:void(0)')).toBe(false);
  });

  it('accepts holaday.ai apex', () => {
    expect(isTrustedAuthBridgeSender('https://holaday.ai/dashboard')).toBe(true);
    expect(isTrustedAuthBridgeSender('https://holaday.ai/')).toBe(true);
  });

  it('accepts any *.holaday.ai subdomain', () => {
    expect(isTrustedAuthBridgeSender('https://app.holaday.ai/')).toBe(true);
    expect(isTrustedAuthBridgeSender('https://staging.holaday.ai/x')).toBe(true);
    expect(isTrustedAuthBridgeSender('https://www.holaday.ai/marketing')).toBe(true);
  });

  it('accepts hd-app.orangebench.tech (China route)', () => {
    expect(isTrustedAuthBridgeSender('https://hd-app.orangebench.tech/files')).toBe(true);
  });

  it('accepts localhost + 127.0.0.1 (dev)', () => {
    expect(isTrustedAuthBridgeSender('http://localhost:5173/')).toBe(true);
    expect(isTrustedAuthBridgeSender('http://127.0.0.1:3000/x')).toBe(true);
  });

  it('rejects similar-looking attacker domains', () => {
    expect(isTrustedAuthBridgeSender('https://holaday.ai.evil.com/')).toBe(false);
    expect(isTrustedAuthBridgeSender('https://evil.com/?host=holaday.ai')).toBe(false);
    expect(isTrustedAuthBridgeSender('https://holaday.evil.com/')).toBe(false);
    expect(isTrustedAuthBridgeSender('https://fakelocalhost/')).toBe(false);
  });

  it('rejects holaday.ai when used as path / query of another domain', () => {
    expect(isTrustedAuthBridgeSender('https://example.com/holaday.ai')).toBe(false);
  });

  it('is case-insensitive on host', () => {
    expect(isTrustedAuthBridgeSender('https://HOLADAY.AI/dashboard')).toBe(true);
    expect(isTrustedAuthBridgeSender('https://APP.HOLADAY.AI/')).toBe(true);
  });
});
