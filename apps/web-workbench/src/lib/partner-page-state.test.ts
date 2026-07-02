import { describe, expect, it } from 'vitest';
import {
  clampRechargeAmountCnyCents,
  formatApiUnits,
  formatHolaCreditCents,
  kycStatusLabel,
  membershipStatusLabel,
  normalizePartnerDashboard,
} from './partner-page-state';

describe('partner page state helpers', () => {
  it('normalizes a disabled dashboard into a disabled page state', () => {
    expect(normalizePartnerDashboard({ enabled: false })).toEqual({
      enabled: false,
      title: '合伙人账本暂未开放',
      description: '当前部署尚未开启 HOLADAY 合伙人账本。你可以稍后再回来查看。',
    });
  });

  it('formats HOLA Credit balances and API Units safely', () => {
    expect(formatHolaCreditCents(0)).toBe('0 HOLA Credit');
    expect(formatHolaCreditCents(10_000_00)).toBe('10,000 HOLA Credit');
    expect(formatHolaCreditCents(10_000_25)).toBe('10,000.25 HOLA Credit');
    expect(formatHolaCreditCents(-50)).toBe('0 HOLA Credit');
    expect(formatHolaCreditCents(Number.NaN)).toBe('0 HOLA Credit');

    expect(formatApiUnits(0)).toBe('0 API Units');
    expect(formatApiUnits(999)).toBe('999 API Units');
    expect(formatApiUnits(10_800_000)).toBe('10.8M API Units');
    expect(formatApiUnits(Number.POSITIVE_INFINITY)).toBe('0 API Units');
  });

  it('clamps recharge amounts to single-order whole-CNY bounds', () => {
    expect(clampRechargeAmountCnyCents(999_999)).toBe(10_000_00);
    expect(clampRechargeAmountCnyCents(10_000_01)).toBe(10_000_00);
    expect(clampRechargeAmountCnyCents(123_456_78)).toBe(123_456_00);
    expect(clampRechargeAmountCnyCents(250_000_00)).toBe(200_000_00);
    expect(clampRechargeAmountCnyCents('15000')).toBe(15_000_00);
    expect(clampRechargeAmountCnyCents('bad')).toBe(10_000_00);
  });

  it('labels membership and KYC states without exposing raw enum copy', () => {
    expect(membershipStatusLabel(null)).toBe('未开通');
    expect(
      membershipStatusLabel({
        status: 'active',
        expiresAt: '2027-01-01T00:00:00.000Z',
      }),
    ).toBe('有效至 2027-01-01');
    expect(membershipStatusLabel({ status: 'expired', expiresAt: null })).toBe('已过期');
    expect(membershipStatusLabel({ status: 'cancelled', expiresAt: null })).toBe('已取消');
    expect(membershipStatusLabel({ status: 'surprise', expiresAt: null })).toBe('未开通');

    expect(kycStatusLabel('not_started')).toBe('未开始');
    expect(kycStatusLabel('pending')).toBe('审核中');
    expect(kycStatusLabel('passed')).toBe('已通过');
    expect(kycStatusLabel('review_required')).toBe('需补充材料');
    expect(kycStatusLabel('rejected')).toBe('未通过');
    expect(kycStatusLabel('mystery')).toBe('未开始');
  });

  it('normalizes an enabled dashboard with bad or partial values into safe defaults', () => {
    expect(
      normalizePartnerDashboard({
        enabled: true,
        membership: { status: 'surprise', expiresAt: 'not-a-date' },
        kycStatus: 'mystery',
        ledger: {
          availableCreditCents: -100,
          lockedCreditCents: '1200.9',
          withdrawableCreditCents: 999,
          pendingWithdrawalCreditCents: Number.POSITIVE_INFINITY,
        },
        lots: [
          {
            externalId: ' lot_1 ',
            status: 'accumulating',
            riskStatus: 'unknown-risk',
            principalCreditCents: '9999.9',
            lockedBonusCreditCents: -1,
            releaseStartsAt: 'bad-date',
          },
          null,
        ],
      }),
    ).toEqual({
      enabled: true,
      membership: {
        status: 'none',
        label: '未开通',
        expiresAt: null,
        expiresAtLabel: '—',
      },
      kycStatus: 'not_started',
      kycLabel: '未开始',
      ledger: {
        availableCreditCents: 0,
        lockedCreditCents: 1200,
        withdrawableCreditCents: 999,
        pendingWithdrawalCreditCents: 0,
        frozenCreditCents: 0,
      },
      lots: [
        {
          key: 'lot_1',
          externalId: 'lot_1',
          status: 'accumulating',
          statusLabel: '累计中',
          riskStatus: 'normal',
          riskLabel: '正常',
          principalCreditCents: 9999,
          lockedBonusCreditCents: 0,
          releasedPrincipalCreditCents: 0,
          releasedBonusCreditCents: 0,
          carryForwardCreditCents: 0,
          releaseStartsAt: null,
          releaseStartsAtLabel: '—',
          releaseEndsAt: null,
          releaseEndsAtLabel: '—',
        },
      ],
    });
  });

  it('preserves review-required lot risk status as non-normal copy', () => {
    const state = normalizePartnerDashboard({
      enabled: true,
      lots: [
        {
          externalId: 'lot_review',
          riskStatus: 'review_required',
        },
      ],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled partner dashboard');
    expect(state.lots[0]?.riskStatus).toBe('review_required');
    expect(state.lots[0]?.riskLabel).toBe('需复核');
    expect(state.lots[0]?.riskLabel).not.toBe('正常');
  });
});
