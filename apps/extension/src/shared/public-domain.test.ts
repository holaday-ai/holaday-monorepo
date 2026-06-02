import { describe, expect, it } from 'vitest';
import { normalizePublicDomain } from './public-domain.js';

describe('normalizePublicDomain', () => {
  it('normalizes public host names', () => {
    expect(normalizePublicDomain(' WWW.Example.COM. ')).toBe('example.com');
    expect(normalizePublicDomain('.sub.example.com')).toBe('sub.example.com');
  });

  it('rejects local, IP, malformed, and secret-shaped values', () => {
    expect(normalizePublicDomain('localhost')).toBeNull();
    expect(normalizePublicDomain('192.168.1.2')).toBeNull();
    expect(normalizePublicDomain('printer.local')).toBeNull();
    expect(normalizePublicDomain('not a url')).toBeNull();
    expect(normalizePublicDomain('token=secret.example.com')).toBeNull();
    expect(normalizePublicDomain('example.com/path')).toBeNull();
  });
});
