import { describe, expect, it } from 'vitest';
import { isAllowedCookieDomain } from './sync-service.js';

describe('isAllowedCookieDomain — China OTA coverage', () => {
  it('accepts every OTA base domain (login state can reach server Brave)', () => {
    for (const d of ['ctrip.com', 'qunar.com', 'fliggy.com', 'ly.com', 'meituan.com']) {
      expect(isAllowedCookieDomain(d), d).toBe(true);
    }
  });

  it('accepts OTA subdomains and leading-dot forms', () => {
    for (const d of [
      'flights.ctrip.com',
      'hotels.ctrip.com',
      '.ctrip.com',
      'flight.qunar.com',
      'hotel.meituan.com',
      '.ly.com',
    ]) {
      expect(isAllowedCookieDomain(d), d).toBe(true);
    }
  });

  it('rejects off-list and malformed domains (fails closed)', () => {
    for (const d of [
      'evil.com',
      'ctrip.com.attacker.com', // suffix attack — not a real ctrip subdomain
      'notly.com', // must be a subdomain of ly.com, not a substring
      'CTRIP.COM/path',
      'has space.com',
      '',
    ]) {
      expect(isAllowedCookieDomain(d), d).toBe(false);
    }
  });
});
