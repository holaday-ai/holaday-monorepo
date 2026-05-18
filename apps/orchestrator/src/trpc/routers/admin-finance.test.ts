/**
 * Phase 27B — admin-finance helper tests.
 *
 * The query bodies hit too many tables to mock cleanly; covered by
 * manual smoke after deploy. This file pins the conversion math
 * + the server fixed-cost constant so a future tweak to the
 * USD/CNY rate or the Vultr/Aliyun bill is caught at build time.
 */

import { describe, expect, it } from 'vitest';
import { __financeInternals } from './admin-finance.js';

const { paymentRowCnyCents, usdToCnyCents, SERVER_FIXED_CNY_CENTS_MONTHLY, USD_TO_CNY } =
  __financeInternals;

describe('paymentRowCnyCents', () => {
  it('passes through CNY amounts unchanged', () => {
    expect(paymentRowCnyCents(2900, 'CNY')).toBe(2900);
    expect(paymentRowCnyCents(2900, 'cny')).toBe(2900);
  });

  it('converts USD cents to CNY cents at the configured rate', () => {
    expect(paymentRowCnyCents(400, 'USD')).toBe(Math.round(400 * USD_TO_CNY));
    expect(paymentRowCnyCents(1370, 'usd')).toBe(Math.round(1370 * USD_TO_CNY));
  });

  it('passes unknown currency through verbatim (defensive)', () => {
    expect(paymentRowCnyCents(123, 'EUR')).toBe(123);
  });
});

describe('usdToCnyCents', () => {
  it('converts USD decimal to CNY cents', () => {
    // $1.50 @ 7.2 = ¥10.80 = 1080 cents
    expect(usdToCnyCents(1.5)).toBe(1080);
    expect(usdToCnyCents('1.5')).toBe(1080);
  });

  it('returns 0 for non-finite or NaN', () => {
    expect(usdToCnyCents(NaN)).toBe(0);
    expect(usdToCnyCents('not-a-number')).toBe(0);
  });

  it('rounds to whole cents', () => {
    // $0.001 @ 7.2 = ¥0.0072 → 1 cent (rounded up)
    expect(usdToCnyCents(0.0014)).toBe(1);
    // $0.0007 @ 7.2 = ¥0.005 → 1 cent (rounded up)
    expect(usdToCnyCents(0.0007)).toBe(1);
    // $0.0003 @ 7.2 = ¥0.00216 → 0 cents
    expect(usdToCnyCents(0.0003)).toBe(0);
  });
});

describe('SERVER_FIXED_CNY_CENTS_MONTHLY', () => {
  it('aggregates Vultr USD + Aliyun CNY', () => {
    // Vultr $12 + Aliyun ¥300 at 7.2 ≈ ¥386.4 → 38640 cents
    const expected = Math.round((12 * USD_TO_CNY + 300) * 100);
    expect(SERVER_FIXED_CNY_CENTS_MONTHLY).toBe(expected);
  });

  it('is positive (a hardcode mismatch would zero it out)', () => {
    expect(SERVER_FIXED_CNY_CENTS_MONTHLY).toBeGreaterThan(0);
  });
});
