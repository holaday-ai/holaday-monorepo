import { describe, expect, it } from 'vitest';
import {
  formatPartnerCreditCents,
  formatPartnerMoneyCents,
  normalizeAdminPartnerOverview,
  normalizeRiskScore,
  partnerOrderActionLabel,
  partnerReviewStatusToken,
} from './admin-partner-state';

describe('partnerReviewStatusToken', () => {
  it('uses partner-domain labels instead of raw enum names', () => {
    expect(partnerReviewStatusToken('kyc', 'review_required').label).toBe('需复核');
    expect(partnerReviewStatusToken('order', 'pending').label).toBe('待确认');
    expect(partnerReviewStatusToken('withdrawal', 'approved').label).toBe('待出款');
    expect(partnerReviewStatusToken('risk', 'frozen').label).toBe('已冻结');
  });

  it('falls back without exposing unknown backend statuses', () => {
    expect(partnerReviewStatusToken('withdrawal', 'provider_surprise').label).toBe('未知状态');
  });
});

describe('partnerOrderActionLabel', () => {
  it('distinguishes ordinary confirmation from review approval', () => {
    expect(partnerOrderActionLabel('pending')).toBe('确认');
    expect(partnerOrderActionLabel('review_required')).toBe('放行');
  });
});

describe('partner money helpers', () => {
  it('formats CNY cents and Hola Credit cents for operations tables', () => {
    expect(formatPartnerMoneyCents(10_000_00)).toBe('¥10,000');
    expect(formatPartnerMoneyCents(12_345)).toBe('¥123.45');
    expect(formatPartnerCreditCents(600_00)).toBe('600.00 Credit');
  });

  it('clamps malformed risk scores into a displayable 0-100 range', () => {
    expect(normalizeRiskScore(88.6)).toBe(89);
    expect(normalizeRiskScore(-20)).toBe(0);
    expect(normalizeRiskScore(130)).toBe(100);
    expect(normalizeRiskScore('not-a-number')).toBe(0);
  });
});

describe('normalizeAdminPartnerOverview', () => {
  it('preserves disabled state without inventing queues', () => {
    expect(normalizeAdminPartnerOverview({ enabled: false })).toEqual({ enabled: false });
  });

  it('normalizes queue rows defensively', () => {
    const state = normalizeAdminPartnerOverview({
      enabled: true,
      metrics: {
        pendingKycCount: '2',
        pendingOrderCount: 1,
        pendingWithdrawalCount: -5,
        approvedWithdrawalCount: 1,
        overdueWithdrawalCount: 0,
        riskLotCount: 3,
      },
      orders: [
        {
          orderExternalId: 'pay_order_1',
          userExternalId: 'usr_partner',
          status: 'pending',
          amountCnyCents: '1000000',
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal_1',
          riskScore: 120,
        },
      ],
      kycProfiles: 'not-array',
      riskLots: [],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');
    expect(state.metrics.pendingKycCount).toBe(2);
    expect(state.metrics.pendingWithdrawalCount).toBe(0);
    expect(state.orders[0]).toMatchObject({
      orderExternalId: 'pay_order_1',
      amountCnyCents: 1_000_000,
    });
    expect(state.withdrawals[0].riskScore).toBe(100);
    expect(state.kycProfiles).toEqual([]);
  });
});
