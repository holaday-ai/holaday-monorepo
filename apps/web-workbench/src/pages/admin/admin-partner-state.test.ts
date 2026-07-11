import { describe, expect, it } from 'vitest';
import {
  formatPartnerCreditCents,
  formatPartnerMoneyCents,
  partnerReconciliationCsv,
  filterAdminPartnerOverview,
  normalizeAdminPartnerOverview,
  normalizePartnerReconciliation,
  normalizeRiskScore,
  partnerKycQueueReviewPayload,
  partnerOrderActionLabel,
  partnerRiskLotQueueAction,
  partnerReviewStatusToken,
} from './admin-partner-state';

describe('partnerReviewStatusToken', () => {
  it('uses partner-domain labels instead of raw enum names', () => {
    expect(partnerReviewStatusToken('kyc', 'review_required').label).toBe('需复核');
    expect(partnerReviewStatusToken('order', 'pending').label).toBe('待确认');
    expect(partnerReviewStatusToken('withdrawal', 'approved').label).toBe('待出款');
    expect(partnerReviewStatusToken('withdrawal', 'returned').label).toBe('已退回');
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

describe('partnerRiskLotQueueAction', () => {
  it('uses freeze for active risk lots and resume for frozen lots', () => {
    expect(partnerRiskLotQueueAction({ status: 'accumulating', riskStatus: 'review' })).toEqual({
      action: 'freeze',
      label: '冻结',
      pendingLabel: '冻结中',
      canClose: false,
    });
    expect(partnerRiskLotQueueAction({ status: 'frozen', riskStatus: 'frozen' })).toEqual({
      action: 'resume',
      label: '恢复',
      pendingLabel: '恢复中',
      canClose: true,
    });
    expect(partnerRiskLotQueueAction({ status: 'closed', riskStatus: 'frozen' })).toEqual({
      action: 'closed',
      label: '已关闭',
      pendingLabel: '已关闭',
      canClose: false,
    });
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
        paidWithdrawalCount: 2,
        rejectedWithdrawalCount: 3,
        returnedWithdrawalCount: 1,
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
      riskEvents: 'not-array',
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');
    expect(state.metrics.pendingKycCount).toBe(2);
    expect(state.metrics.pendingWithdrawalCount).toBe(0);
    expect(state.metrics.paidWithdrawalCount).toBe(2);
    expect(state.metrics.rejectedWithdrawalCount).toBe(3);
    expect(state.metrics.returnedWithdrawalCount).toBe(1);
    expect(state.orders[0]).toMatchObject({
      orderExternalId: 'pay_order_1',
      amountCnyCents: 1_000_000,
    });
    expect(state.withdrawals[0].riskScore).toBe(100);
    expect(state.kycProfiles).toEqual([]);
    expect(state.riskEvents).toEqual([]);
  });

  it('preserves KYC review audit fields for the admin queue', () => {
    const state = normalizeAdminPartnerOverview({
      enabled: true,
      metrics: {},
      kycProfiles: [
        {
          kycExternalId: 'pay_kyc_bob',
          userExternalId: 'usr_bob',
          status: 'review_required',
          provider: 'cn-bankcard',
          providerRef: 'bankcard-flow-bob',
          reviewerUserId: 77,
          reviewNote: '银行卡四要素通过，证件照待复核',
          reviewSource: 'cn-bankcard',
        },
      ],
      orders: [],
      withdrawals: [],
      riskLots: [],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');
    expect(state.kycProfiles[0]).toMatchObject({
      reviewerUserId: 77,
      reviewNote: '银行卡四要素通过，证件照待复核',
      reviewSource: 'cn-bankcard',
    });
  });

  it('preserves risk lot audit fields for the admin queue', () => {
    const state = normalizeAdminPartnerOverview({
      enabled: true,
      metrics: {},
      orders: [],
      kycProfiles: [],
      withdrawals: [],
      riskLots: [
        {
          lotExternalId: 'pay_risk_lot_1',
          userExternalId: 'usr_risk',
          status: 'frozen',
          riskStatus: 'frozen',
          riskFrozenByUserId: 99,
          riskFrozenAt: '2026-07-03T09:00:00.000Z',
          riskFreezeReason: 'bank dispute signal',
          riskResumedByUserId: 100,
          riskResumedAt: '2026-07-04T10:00:00.000Z',
          riskResumeNote: 'manual review cleared',
          riskClosedByUserId: 101,
          riskClosedAt: '2026-07-05T11:00:00.000Z',
          riskCloseReason: 'provider refund completed',
        },
      ],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');
    expect(state.riskLots[0]).toMatchObject({
      riskFrozenByUserId: 99,
      riskFrozenAt: '2026-07-03T09:00:00.000Z',
      riskFreezeReason: 'bank dispute signal',
      riskResumedByUserId: 100,
      riskResumedAt: '2026-07-04T10:00:00.000Z',
      riskResumeNote: 'manual review cleared',
      riskClosedByUserId: 101,
      riskClosedAt: '2026-07-05T11:00:00.000Z',
      riskCloseReason: 'provider refund completed',
    });
  });

  it('preserves risk event audit fields for the admin queue', () => {
    const state = normalizeAdminPartnerOverview({
      enabled: true,
      metrics: {},
      orders: [],
      kycProfiles: [],
      withdrawals: [],
      riskLots: [],
      riskEvents: [
        {
          riskEventExternalId: 'pay_risk_event_1',
          userExternalId: 'usr_risk',
          lotExternalId: 'pay_risk_lot_1',
          eventType: 'lot_closed',
          severity: 'high',
          status: 'closed',
          reviewerUserId: 101,
          riskReason: 'provider refund completed',
          riskNote: 'manual close after refund',
          createdAt: '2026-07-05T11:00:00.000Z',
        },
      ],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled state');
    expect(state.riskEvents[0]).toMatchObject({
      riskEventExternalId: 'pay_risk_event_1',
      lotExternalId: 'pay_risk_lot_1',
      eventType: 'lot_closed',
      reviewerUserId: 101,
      riskReason: 'provider refund completed',
      riskNote: 'manual close after refund',
    });
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
        paidWithdrawalCount: 1,
        rejectedWithdrawalCount: 1,
        returnedWithdrawalCount: 1,
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
          reviewNote: '银行卡四要素通过，证件照待复核',
          reviewSource: 'cn-bankcard',
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
      withdrawalHistory: [
        {
          withdrawalExternalId: 'pay_withdrawal_paid',
          userExternalId: 'usr_paid',
          email: 'paid@holaday.local',
          displayName: 'Paid Partner',
          status: 'paid',
          providerPayoutId: 'bank-payout-paid-1',
          amountCreditCents: 600_00,
        },
        {
          withdrawalExternalId: 'pay_withdrawal_rejected',
          userExternalId: 'usr_rejected',
          email: 'rejected@holaday.local',
          displayName: 'Rejected Partner',
          status: 'rejected',
          rejectionReason: 'bank mismatch',
          amountCreditCents: 700_00,
        },
        {
          withdrawalExternalId: 'pay_withdrawal_returned',
          userExternalId: 'usr_returned',
          email: 'returned@holaday.local',
          displayName: 'Returned Partner',
          status: 'returned',
          amountCreditCents: 800_00,
        },
      ],
      riskLots: [
        {
          lotExternalId: 'lot_risk_1',
          userExternalId: 'usr_risk',
          email: 'risk@holaday.local',
          displayName: 'Risk Partner',
          status: 'frozen',
          riskStatus: 'normal',
          riskFreezeReason: 'bank dispute signal',
          riskCloseReason: 'provider refund completed',
        },
      ],
      riskEvents: [
        {
          riskEventExternalId: 'pay_risk_event_1',
          userExternalId: 'usr_risk',
          email: 'risk@holaday.local',
          displayName: 'Risk Partner',
          lotExternalId: 'lot_risk_1',
          eventType: 'lot_closed',
          severity: 'high',
          status: 'closed',
          reviewerUserId: 101,
          riskReason: 'provider refund completed',
          riskNote: 'manual close after refund',
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
    expect(byUser.riskEvents).toHaveLength(0);
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
    expect(byWithdrawal.withdrawalHistory).toHaveLength(0);
    expect(byWithdrawal.withdrawals[0]?.bankAccountFingerprint).toBe('bank-card-fp-cash');

    const byBankFingerprint = filterAdminPartnerOverview(state, 'bank-card-fp');
    expect(byBankFingerprint.enabled).toBe(true);
    if (!byBankFingerprint.enabled) throw new Error('expected enabled state');
    expect(byBankFingerprint.withdrawals).toHaveLength(1);

    const byPayout = filterAdminPartnerOverview(state, 'bank-payout-paid');
    expect(byPayout.enabled).toBe(true);
    if (!byPayout.enabled) throw new Error('expected enabled state');
    expect(byPayout.withdrawals).toHaveLength(0);
    expect(byPayout.withdrawalHistory).toHaveLength(1);
    expect(byPayout.withdrawalHistory[0]?.status).toBe('paid');

    const byRejectedReason = filterAdminPartnerOverview(state, 'bank mismatch');
    expect(byRejectedReason.enabled).toBe(true);
    if (!byRejectedReason.enabled) throw new Error('expected enabled state');
    expect(byRejectedReason.withdrawalHistory).toHaveLength(1);
    expect(byRejectedReason.withdrawalHistory[0]?.status).toBe('rejected');

    const byReturned = filterAdminPartnerOverview(state, 'returned');
    expect(byReturned.enabled).toBe(true);
    if (!byReturned.enabled) throw new Error('expected enabled state');
    expect(byReturned.withdrawalHistory).toHaveLength(1);
    expect(byReturned.withdrawalHistory[0]?.status).toBe('returned');

    const byRiskLot = filterAdminPartnerOverview(state, 'LOT_RISK');
    expect(byRiskLot.enabled).toBe(true);
    if (!byRiskLot.enabled) throw new Error('expected enabled state');
    expect(byRiskLot.riskLots).toHaveLength(1);
    expect(byRiskLot.riskLots[0]).toMatchObject({
      status: 'frozen',
      riskStatus: 'normal',
    });

    const byRiskReason = filterAdminPartnerOverview(state, 'dispute signal');
    expect(byRiskReason.enabled).toBe(true);
    if (!byRiskReason.enabled) throw new Error('expected enabled state');
    expect(byRiskReason.riskLots).toHaveLength(1);

    const byCloseReason = filterAdminPartnerOverview(state, 'refund completed');
    expect(byCloseReason.enabled).toBe(true);
    if (!byCloseReason.enabled) throw new Error('expected enabled state');
    expect(byCloseReason.riskLots).toHaveLength(1);
    expect(byCloseReason.riskEvents).toHaveLength(1);

    const byRiskEventNote = filterAdminPartnerOverview(state, 'manual close');
    expect(byRiskEventNote.enabled).toBe(true);
    if (!byRiskEventNote.enabled) throw new Error('expected enabled state');
    expect(byRiskEventNote.riskEvents).toHaveLength(1);

    const byProviderRef = filterAdminPartnerOverview(state, 'bankcard-flow');
    expect(byProviderRef.enabled).toBe(true);
    if (!byProviderRef.enabled) throw new Error('expected enabled state');
    expect(byProviderRef.kycProfiles).toHaveLength(1);
    expect(byProviderRef.kycProfiles[0]?.providerRef).toBe('bankcard-flow-bob');

    const byKycAudit = filterAdminPartnerOverview(state, '四要素');
    expect(byKycAudit.enabled).toBe(true);
    if (!byKycAudit.enabled) throw new Error('expected enabled state');
    expect(byKycAudit.kycProfiles).toHaveLength(1);

    expect(filterAdminPartnerOverview({ enabled: false }, 'alice')).toEqual({ enabled: false });
  });
});

describe('normalizePartnerReconciliation', () => {
  it('normalizes operator reconciliation summaries and CSV rows', () => {
    const state = normalizePartnerReconciliation({
      enabled: true,
      range: { from: '2026-07-01', to: '2026-07-07', basis: 'updated_at' },
      metrics: {
        orderCount: 3,
        completedOrderCount: 2,
        reviewRequiredOrderCount: 1,
        membershipRevenueCnyCents: 999_00,
        rechargePrincipalCnyCents: 10_000_00,
        paidWithdrawalCreditCents: 600_00,
      },
      providerBreakdown: [
        { provider: 'wechat', orderCount: 2, completedOrderCount: 1, completedAmountCnyCents: 999_00 },
      ],
      orders: [
        {
          orderExternalId: 'pay_membership_completed',
          userExternalId: 'usr_partner',
          orderKind: 'membership',
          provider: 'wechat',
          amountCnyCents: 999_00,
          status: 'completed',
          providerCaptureId: 'wx-cap-1',
          updatedAt: '2026-07-02T01:00:00.000Z',
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal_paid',
          userExternalId: 'usr_partner',
          amountCreditCents: 600_00,
          status: 'paid',
          updatedAt: '2026-07-03T01:00:00.000Z',
        },
      ],
    });

    expect(state).toMatchObject({
      enabled: true,
      range: { from: '2026-07-01', to: '2026-07-07', basis: 'updated_at' },
      metrics: {
        orderCount: 3,
        completedOrderCount: 2,
        membershipRevenueCnyCents: 999_00,
        rechargePrincipalCnyCents: 10_000_00,
        paidWithdrawalCreditCents: 600_00,
      },
      providerBreakdown: [
        {
          provider: 'wechat',
          orderCount: 2,
          completedOrderCount: 1,
          completedAmountCnyCents: 999_00,
        },
      ],
    });
    expect(state.enabled && state.orders[0]?.amountCnyCents).toBe(999_00);
    expect(state.enabled && state.withdrawals[0]?.amountCreditCents).toBe(600_00);
    expect(partnerReconciliationCsv(state)).toContain('order,pay_membership_completed,usr_partner');
    expect(partnerReconciliationCsv(state)).toContain('withdrawal,pay_withdrawal_paid,usr_partner');
  });

  it('keeps disabled reconciliation state inert', () => {
    expect(normalizePartnerReconciliation({ enabled: false })).toEqual({ enabled: false });
    expect(partnerReconciliationCsv({ enabled: false })).toBe('');
  });
});
