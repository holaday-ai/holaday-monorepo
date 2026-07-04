import { describe, expect, it } from 'vitest';
import {
  clampRechargeAmountCnyCents,
  formatApiUnits,
  formatHolaCreditCents,
  kycStatusLabel,
  membershipStatusLabel,
  normalizePartnerDashboard,
  partnerActionErrorMessage,
  partnerDraftKeyAfterSuccess,
  partnerDraftKeyFor,
  partnerRechargeGate,
  partnerWithdrawalGate,
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
        kycProfile: {
          kycExternalId: ' pay_kyc_1 ',
          status: 'pending',
          country: 'CN',
          provider: 'cn-bankcard',
          providerRef: ' bankcard-flow-123 ',
          reviewedAt: '2026-07-02T10:00:00.000Z',
        },
        ledger: {
          availableCreditCents: -100,
          lockedCreditCents: '1200.9',
          withdrawableCreditCents: 999,
          pendingWithdrawalCreditCents: Number.POSITIVE_INFINITY,
        },
        inviteCode: ' usr_partner ',
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
        orders: [
          {
            orderExternalId: ' pay_order_1 ',
            provider: 'wechat',
            orderKind: 'membership',
            amountCnyCents: '99900',
            status: 'pending',
            createdAt: '2026-07-02T10:00:00.000Z',
          },
          null,
        ],
        withdrawals: [
          {
            withdrawalExternalId: ' pay_withdrawal_1 ',
            amountCreditCents: '60000',
            status: 'reviewing',
            reviewDueAt: 'not-a-date',
            bankAccountFingerprint: ' bank_fp_123 ',
            riskScore: '88.8',
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
      kycProfile: {
        kycExternalId: 'pay_kyc_1',
        status: 'pending',
        statusLabel: '审核中',
        country: 'CN',
        provider: 'cn-bankcard',
        providerRef: 'bankcard-flow-123',
        reviewedAt: '2026-07-02',
        reviewedAtLabel: '2026-07-02',
      },
      inviteCode: 'usr_partner',
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
      orders: [
        {
          key: 'pay_order_1',
          orderExternalId: 'pay_order_1',
          provider: 'wechat',
          orderKind: 'membership',
          amountCnyCents: 99900,
          status: 'pending',
          createdAt: '2026-07-02',
          createdAtLabel: '2026-07-02',
        },
      ],
      withdrawals: [
        {
          key: 'pay_withdrawal_1',
          withdrawalExternalId: 'pay_withdrawal_1',
          amountCreditCents: 60000,
          status: 'reviewing',
          reviewDueAt: null,
          reviewDueAtLabel: '—',
          bankAccountFingerprint: 'bank_fp_123',
          riskScore: 89,
        },
      ],
    });
  });

  it('preserves review-required lot risk status as non-normal copy', () => {
    const state = normalizePartnerDashboard({
      enabled: true,
      inviteCode: '',
      lots: [
        {
          externalId: 'lot_review',
          riskStatus: 'review_required',
        },
      ],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled partner dashboard');
    expect(state.inviteCode).toBe('');
    expect(state.lots[0]?.riskStatus).toBe('review_required');
    expect(state.lots[0]?.riskLabel).toBe('需复核');
    expect(state.lots[0]?.riskLabel).not.toBe('正常');
  });

  it('maps partner action backend errors to safe localized copy', () => {
    expect(partnerActionErrorMessage(new Error('below_minimum'), '充值失败')).toBe(
      '金额低于最低限制',
    );
    expect(partnerActionErrorMessage(new Error('above_single_maximum'), '充值失败')).toBe(
      '金额超过单笔上限',
    );
    expect(partnerActionErrorMessage(new Error('not_whole_cny'), '充值失败')).toBe(
      '金额必须为整元',
    );
    expect(
      partnerActionErrorMessage(new Error('partner membership required'), '充值失败'),
    ).toBe('请先创建并完成年费会员订单');
    expect(
      partnerActionErrorMessage(
        new Error('partner KYC must be passed before recharge'),
        '充值失败',
      ),
    ).toBe('实名通过后才能充值');
    expect(
      partnerActionErrorMessage(
        new Error('partner KYC must be passed before withdrawal'),
        '提现失败',
      ),
    ).toBe('实名通过后才能提现');
    expect(
      partnerActionErrorMessage(new Error('insufficient_available_credit'), '提现失败'),
    ).toBe('可用 HOLA Credit 不足');
    expect(
      partnerActionErrorMessage(new Error('partner referral attribution conflict'), '邀请登记失败'),
    ).toBe('该账号已有邀请归因');
    expect(
      partnerActionErrorMessage(new Error('partner KYC already passed'), '实名提交失败'),
    ).toBe('实名已通过，无需重复提交');
    expect(
      partnerActionErrorMessage(
        new Error('Failed to connect to 127.0.0.1 port 3001'),
        '合伙人账本暂时无法加载',
      ),
    ).toBe('合伙人服务暂时未连接，请确认 orchestrator 已启动后重试');
    expect(
      partnerActionErrorMessage(new Error('partner ledger is disabled'), '操作失败'),
    ).toBe('合伙人账本暂未开放');
    expect(
      partnerActionErrorMessage(
        new Error('SQLSTATE 23000: internal stack trace should not render'),
        '操作失败',
      ),
    ).toBe('操作失败');
  });

  it('summarizes the recharge gate from membership and KYC state', () => {
    const disabled = normalizePartnerDashboard({
      enabled: true,
      membership: null,
      kycStatus: 'not_started',
    });
    expect(disabled.enabled).toBe(true);
    if (!disabled.enabled) throw new Error('expected enabled partner dashboard');
    expect(partnerRechargeGate(disabled)).toEqual({
      blocked: true,
      reason: '完成年度会员后才能充值。',
    });

    const pendingKyc = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'pending',
    });
    expect(pendingKyc.enabled).toBe(true);
    if (!pendingKyc.enabled) throw new Error('expected enabled partner dashboard');
    expect(partnerRechargeGate(pendingKyc)).toEqual({
      blocked: true,
      reason: '实名审核通过后才能充值。',
    });

    const ready = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
    });
    expect(ready.enabled).toBe(true);
    if (!ready.enabled) throw new Error('expected enabled partner dashboard');
    expect(partnerRechargeGate(ready)).toEqual({
      blocked: false,
      reason: '可以创建充值预览和订单。',
    });
  });

  it('summarizes the withdrawal gate from balance, KYC, and bank state', () => {
    const missingMembership = normalizePartnerDashboard({
      enabled: true,
      membership: null,
      kycStatus: 'passed',
      ledger: { withdrawableCreditCents: 10_000_00 },
    });
    expect(missingMembership.enabled).toBe(true);
    if (!missingMembership.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(missingMembership, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '完成年度会员后才能提现。',
    });

    const pendingKyc = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'pending',
      ledger: { withdrawableCreditCents: 10_000_00 },
    });
    expect(pendingKyc.enabled).toBe(true);
    if (!pendingKyc.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(pendingKyc, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '实名审核通过后才能提现。',
    });

    const frozen = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      ledger: { withdrawableCreditCents: 10_000_00, frozenCreditCents: 1_00 },
    });
    expect(frozen.enabled).toBe(true);
    if (!frozen.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(frozen, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '账户存在冻结 HOLA Credit，需完成复核后再提现。',
    });

    const ready = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      ledger: { withdrawableCreditCents: 10_000_00 },
    });
    expect(ready.enabled).toBe(true);
    if (!ready.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(ready, {
        amountCreditCents: 499_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '单次提现最低 500 HOLA Credit。',
    });
    expect(
      partnerWithdrawalGate(ready, {
        amountCreditCents: 11_000_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '提现金额超过可提现 HOLA Credit。',
    });
    expect(
      partnerWithdrawalGate(ready, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: '',
      }),
    ).toEqual({
      blocked: true,
      reason: '请填写银行账户指纹。',
    });
    expect(
      partnerWithdrawalGate(ready, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: false,
      reason: '可以提交提现申请。',
    });
  });

  it('keeps idempotency draft keys stable until draft changes or succeeds', () => {
    const issued: string[] = [];
    const makeKey = (prefix: string) => {
      const key = `${prefix}:${issued.length + 1}`;
      issued.push(key);
      return key;
    };

    const first = partnerDraftKeyFor({
      current: null,
      prefix: 'partner-recharge',
      fingerprint: 'amount=10000',
      makeKey,
    });
    const retry = partnerDraftKeyFor({
      current: first,
      prefix: 'partner-recharge',
      fingerprint: 'amount=10000',
      makeKey,
    });
    const changedDraft = partnerDraftKeyFor({
      current: retry,
      prefix: 'partner-recharge',
      fingerprint: 'amount=20000',
      makeKey,
    });
    const afterSuccess = partnerDraftKeyAfterSuccess({
      prefix: 'partner-recharge',
      fingerprint: 'amount=20000',
      makeKey,
    });

    expect(retry).toBe(first);
    expect(changedDraft.key).not.toBe(first.key);
    expect(changedDraft.fingerprint).toBe('amount=20000');
    expect(afterSuccess.key).not.toBe(changedDraft.key);
    expect(afterSuccess.fingerprint).toBe('amount=20000');
    expect(issued).toEqual([
      'partner-recharge:1',
      'partner-recharge:2',
      'partner-recharge:3',
    ]);
  });
});
