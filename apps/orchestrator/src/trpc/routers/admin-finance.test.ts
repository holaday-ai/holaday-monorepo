/**
 * Phase 27B — admin-finance helper tests.
 *
 * The query bodies hit too many tables to mock cleanly; covered by
 * manual smoke after deploy. This file pins the conversion math
 * + the server fixed-cost constant so a future tweak to the
 * USD/CNY rate or the Vultr/Aliyun bill is caught at build time.
 */

import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../db/schema/index.js';
import { payments } from '../../db/schema/payments.js';
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

  it('fails closed for an unsupported currency instead of labelling it CNY', () => {
    expect(() => paymentRowCnyCents(123, 'EUR')).toThrow(/unsupported payment currency/i);
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

describe('finance month boundaries', () => {
  it('starts the business month at midnight Beijing time', () => {
    const beijingMonthStartUtc = (
      __financeInternals as unknown as {
        beijingMonthStartUtc?: (at: Date, monthsAgo?: number) => Date;
      }
    ).beijingMonthStartUtc;

    expect(beijingMonthStartUtc).toBeTypeOf('function');
    expect(
      beijingMonthStartUtc?.(new Date('2026-08-31T16:30:00.000Z')).toISOString(),
    ).toBe('2026-08-31T16:00:00.000Z');
    expect(
      beijingMonthStartUtc?.(new Date('2026-08-31T16:30:00.000Z'), 1).toISOString(),
    ).toBe('2026-07-31T16:00:00.000Z');
  });

  it('recognizes completed revenue by immutable completion time', () => {
    const completedPaymentPeriodCondition = (
      __financeInternals as unknown as {
        completedPaymentPeriodCondition?: (start: Date) => unknown;
      }
    ).completedPaymentPeriodCondition;

    expect(completedPaymentPeriodCondition).toBeTypeOf('function');
    if (!completedPaymentPeriodCondition) return;

    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const generated = mockDb
      .select()
      .from(payments)
      .where(
        completedPaymentPeriodCondition(
          new Date('2026-07-31T16:00:00.000Z'),
        ) as never,
      )
      .toSQL();

    expect(generated.sql).toContain('`payments`.`completed_at` >=');
    expect(generated.sql).not.toContain('`payments`.`updated_at` >=');
    expect(generated.sql).not.toContain('`payments`.`created_at` >=');
  });
});

describe('finance revenue products', () => {
  it('keeps add-on and future-plan revenue visible in the breakdown', () => {
    const buildRevenueProductRows = (
      __financeInternals as unknown as {
        buildRevenueProductRows?: (input: {
          userCounts: Array<{ plan: string; count: number }>;
          revenue: Array<{
            kind: string;
            plan: string;
            revenueCnyCents: number;
          }>;
        }) => Array<{
          kind: string;
          plan: string;
          userCount: number;
          monthRevenueCnyCents: number;
        }>;
      }
    ).buildRevenueProductRows;

    expect(buildRevenueProductRows).toBeTypeOf('function');
    expect(
      buildRevenueProductRows?.({
        userCounts: [
          { plan: 'basic', count: 2 },
          { plan: 'enterprise', count: 1 },
        ],
        revenue: [
          { kind: 'subscription', plan: 'basic', revenueCnyCents: 5_800 },
          { kind: 'subscription', plan: 'enterprise', revenueCnyCents: 99_900 },
          { kind: 'addon', plan: 'pack-20', revenueCnyCents: 2_000 },
        ],
      }),
    ).toEqual([
      {
        kind: 'subscription',
        plan: 'free',
        userCount: 0,
        monthRevenueCnyCents: 0,
      },
      {
        kind: 'subscription',
        plan: 'basic',
        userCount: 2,
        monthRevenueCnyCents: 5_800,
      },
      {
        kind: 'subscription',
        plan: 'pro',
        userCount: 0,
        monthRevenueCnyCents: 0,
      },
      {
        kind: 'subscription',
        plan: 'enterprise',
        userCount: 1,
        monthRevenueCnyCents: 99_900,
      },
      {
        kind: 'addon',
        plan: 'pack-20',
        userCount: 0,
        monthRevenueCnyCents: 2_000,
      },
    ]);
  });
});
