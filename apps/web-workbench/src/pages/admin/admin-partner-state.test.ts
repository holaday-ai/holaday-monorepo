import { describe, expect, it } from 'vitest';
import {
  formatPartnerCreditCents,
  formatPartnerMoneyCents,
  filterAdminPartnerOverview,
  normalizeAdminPartnerOverview,
  normalizeRiskScore,
  partnerKycQueueReviewPayload,
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

describe('partnerKycQueueReviewPayload', () => {
  it('preserves provider context when queue actions pass or reject KYC rows', () => {
    expect(
      partnerKycQueueReviewPayload(
        {
          userExternalId: 'usr_partner',
          provider: 'cn-bankcard',
          providerRef: 'bankcard-flow-123',
        },
        'passed',
        '后台审核通过',
      ),
    ).toEqual({
      userExternalId: 'usr_partner',
      status: 'passed',
      provider: 'cn-bankcard',
      providerRef: 'bankcard-flow-123',
      note: '后台审核通过',
    });
  });

  it('falls back to manual provider without sending blank providerRef', () => {
    expect(
      partnerKycQueueReviewPayload(
        {
          userExternalId: 'usr_partner',
          provider: '',
          providerRef: '',
        },
        'rejected',
        '后台审核拒绝',
      ),
    ).toEqual({
      userExternalId: 'usr_partner',
      status: 'rejected',
      provider: 'manual',
      note: '后台审核拒绝',
    });
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

  it('filters enabled overview queues by user and queue identifiers', () => {
    const state = normalizeAdminPartnerOverview({
      enabled: true,
      metrics: {
        pendingKycCount: 1,
        pendingOrderCount: 1,
        reviewRequiredOrderCount: 1,
        pendingWithdrawalCount: 1,
        approvedWithdrawalCount: 1,
        overdueWithdrawalCount: 0,
        riskLotCount: 1,
      },
      orders: [
        {
          orderExternalId: 'pay_order_alice',
          userExternalId: 'usr_alice',
          email: 'alice@holaday.local',
          displayName: 'Alice Partner',
          reviewReason: 'annual_recharge_cap_exceeded',
          reviewErrorMessage: 'monthly cap exceeded',
        },
      ],
      kycProfiles: [
        {
          kycExternalId: 'pay_kyc_bob',
          userExternalId: 'usr_bob',
          email: 'bob@holaday.local',
          displayName: 'Bob Partner',
          providerRef: 'bankcard-flow-bob',
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal_cashout',
          userExternalId: 'usr_cash',
          email: 'cash@holaday.local',
          displayName: 'Cash Partner',
          bankAccountFingerprint: 'bank-card-fp-cash',
        },
      ],
      riskLots: [
        {
          lotExternalId: 'lot_risk_1',
          userExternalId: 'usr_risk',
          email: 'risk@holaday.local',
          displayName: 'Risk Partner',
        },
      ],
    });
    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');

    const byUser = filterAdminPartnerOverview(state, 'alice');
    expect(byUser.enabled).toBe(true);
    if (!byUser.enabled) throw new Error('expected enabled state');
    expect(byUser.orders).toHaveLength(1);
    expect(byUser.kycProfiles).toHaveLength(0);
    expect(byUser.withdrawals).toHaveLength(0);
    expect(byUser.riskLots).toHaveLength(0);
    expect(byUser.orders[0]?.reviewReason).toBe('annual_recharge_cap_exceeded');

    const byReviewReason = filterAdminPartnerOverview(state, 'annual_recharge');
    expect(byReviewReason.enabled).toBe(true);
    if (!byReviewReason.enabled) throw new Error('expected enabled state');
    expect(byReviewReason.orders).toHaveLength(1);

    const byWithdrawal = filterAdminPartnerOverview(state, 'cashout');
    expect(byWithdrawal.enabled).toBe(true);
    if (!byWithdrawal.enabled) throw new Error('expected enabled state');
    expect(byWithdrawal.orders).toHaveLength(0);
    expect(byWithdrawal.withdrawals).toHaveLength(1);
    expect(byWithdrawal.withdrawals[0]?.bankAccountFingerprint).toBe('bank-card-fp-cash');

    const byBankFingerprint = filterAdminPartnerOverview(state, 'bank-card-fp');
    expect(byBankFingerprint.enabled).toBe(true);
    if (!byBankFingerprint.enabled) throw new Error('expected enabled state');
    expect(byBankFingerprint.withdrawals).toHaveLength(1);

    const byRiskLot = filterAdminPartnerOverview(state, 'LOT_RISK');
    expect(byRiskLot.enabled).toBe(true);
    if (!byRiskLot.enabled) throw new Error('expected enabled state');
    expect(byRiskLot.riskLots).toHaveLength(1);

    const byProviderRef = filterAdminPartnerOverview(state, 'bankcard-flow');
    expect(byProviderRef.enabled).toBe(true);
    if (!byProviderRef.enabled) throw new Error('expected enabled state');
    expect(byProviderRef.kycProfiles).toHaveLength(1);
    expect(byProviderRef.kycProfiles[0]?.providerRef).toBe('bankcard-flow-bob');

    expect(filterAdminPartnerOverview({ enabled: false }, 'alice')).toEqual({ enabled: false });
  });
});
