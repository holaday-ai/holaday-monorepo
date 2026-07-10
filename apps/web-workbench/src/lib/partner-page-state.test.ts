import { describe, expect, it } from 'vitest';
import {
  clampRechargeAmountCnyCents,
  formatApiUnits,
  formatHolaCreditCents,
  kycStatusLabel,
  membershipStatusLabel,
  normalizePartnerDashboard,
  normalizePartnerPaymentProvider,
  partnerActionErrorMessage,
  partnerDraftKeyAfterSuccess,
  partnerDraftKeyFor,
  partnerPaymentProviderHint,
  partnerPaymentProviderLabel,
  partnerPaymentIntentDisplay,
  partnerRechargeGate,
  partnerWithdrawalGate,
} from './partner-page-state';

function passedKycProfile(overrides: Record<string, unknown> = {}) {
  return {
    kycExternalId: 'pay_kyc_1',
    status: 'passed',
    country: 'CN',
    provider: 'cn-bankcard',
    providerRef: 'bankcard-flow-123',
    bankCardVerified: true,
    reviewedAt: '2026-07-02T10:00:00.000Z',
    ...overrides,
  };
}

describe('partner page state helpers', () => {
  it('normalizes and labels partner payment providers', () => {
    expect(normalizePartnerPaymentProvider('wechat')).toBe('wechat');
    expect(normalizePartnerPaymentProvider('alipay')).toBe('alipay');
    expect(normalizePartnerPaymentProvider('manual')).toBe('manual');
    expect(normalizePartnerPaymentProvider('surprise')).toBe('manual');
    expect(partnerPaymentProviderLabel('wechat')).toBe('微信支付');
    expect(partnerPaymentProviderLabel('alipay')).toBe('支付宝');
    expect(partnerPaymentProviderLabel('manual')).toBe('人工确认');
    expect(partnerPaymentProviderHint('wechat')).toBe('支付成功后等待渠道回调确认。');
    expect(partnerPaymentProviderHint('manual')).toBe('人工兜底通道，后台确认后生效。');
  });

  it('formats partner payment intent display copy', () => {
    expect(
      partnerPaymentIntentDisplay({
        provider: 'wechat',
        mode: 'qr',
        instructions: '支付成功后等待渠道回调确认。',
      }),
    ).toEqual({
      label: '微信二维码',
      detail: '支付成功后等待渠道回调确认。',
    });
    expect(
      partnerPaymentIntentDisplay({
        provider: 'alipay',
        mode: 'redirect',
        instructions: '支付成功后等待渠道回调确认。',
      }),
    ).toEqual({
      label: '支付宝跳转',
      detail: '支付成功后等待渠道回调确认。',
    });
    expect(partnerPaymentIntentDisplay({ provider: 'manual', mode: 'manual' })).toEqual({
      label: '人工确认',
      detail: '人工确认通道，后台确认后生效。',
    });
    expect(partnerPaymentIntentDisplay(null)).toBeNull();
  });

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
    expect(kycStatusLabel('pending')).toBe('认证中');
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
          bankCardVerified: true,
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
        statusLabel: '认证中',
        country: 'CN',
        provider: 'cn-bankcard',
        providerRef: 'bankcard-flow-123',
        bankCardVerified: true,
        reviewedAt: '2026-07-02',
        reviewedAtLabel: '2026-07-02',
      },
      inviteCode: 'usr_partner',
      activity: {
        activityDate: '',
        checkedInToday: false,
        checkedInLabel: '今日未签到',
        loginDays: 0,
        completedTasks: 0,
        validInvites: 0,
        activityFactorBps: 10_000,
        activityMultiplierLabel: '1.00x',
      },
      ledger: {
        availableCreditCents: 0,
        lockedCreditCents: 1200,
        withdrawableCreditCents: 999,
        pendingWithdrawalCreditCents: 0,
        frozenCreditCents: 0,
      },
      limits: {
        withdrawalMinCreditCents: 500_00,
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
          statusLabel: '待确认',
          statusHelp: '等待支付渠道或后台确认。',
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
          statusLabel: '审核中',
          statusHelp: '提现申请正在复核，请等待处理。',
          reviewDueAt: null,
          reviewDueAtLabel: '—',
          bankAccountFingerprint: 'bank_fp_123',
          rejectionReason: '',
          providerPayoutId: '',
          paidAt: null,
          paidAtLabel: '—',
          riskScore: 89,
        },
      ],
    });
  });

  it('normalizes daily activity summary for check-in display', () => {
    const state = normalizePartnerDashboard({
      enabled: true,
      activity: {
        activityDate: '2026-07-03',
        checkedInToday: true,
        loginDays: 3,
        completedTasks: 1,
        validInvites: 1,
        activityFactorBps: 10_700,
      },
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled partner dashboard');
    expect(state.activity).toEqual({
      activityDate: '2026-07-03',
      checkedInToday: true,
      checkedInLabel: '今日已签到',
      loginDays: 3,
      completedTasks: 1,
      validInvites: 1,
      activityFactorBps: 10_700,
      activityMultiplierLabel: '1.07x',
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

  it('adds user-facing explanations for order and withdrawal workflow states', () => {
    const state = normalizePartnerDashboard({
      enabled: true,
      orders: [
        {
          orderExternalId: 'pay_order_review',
          orderKind: 'recharge',
          amountCnyCents: 10_000_00,
          status: 'review_required',
          reviewErrorMessage: 'monthly cap exceeded',
        },
      ],
      withdrawals: [
        {
          withdrawalExternalId: 'pay_withdrawal_paid',
          amountCreditCents: 600_00,
          status: 'paid',
          providerPayoutId: 'bank-payout-1',
          paidAt: '2026-07-03T06:00:00.000Z',
        },
        {
          withdrawalExternalId: 'pay_withdrawal_rejected',
          amountCreditCents: 700_00,
          status: 'rejected',
          rejectionReason: 'bank mismatch',
        },
      ],
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled partner dashboard');
    expect(state.orders[0]).toMatchObject({
      statusLabel: '待复核',
      statusHelp: '订单进入人工复核：monthly cap exceeded',
    });
    expect(state.withdrawals[0]).toMatchObject({
      statusLabel: '已出款',
      statusHelp: '已完成出款，流水号 bank-payout-1。',
    });
    expect(state.withdrawals[1]).toMatchObject({
      statusLabel: '未通过',
      statusHelp: '提现未通过：bank mismatch',
    });
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
      partnerActionErrorMessage(
        new Error('partner withdrawal is frozen by risk control'),
        '提现失败',
      ),
    ).toBe('账户存在冻结 HOLA Credit，需完成复核后再提现');
    expect(
      partnerActionErrorMessage(
        new Error('partner withdrawal requires a verified bank account'),
        '提现失败',
      ),
    ).toBe('请先完成银行卡实名验证');
    expect(
      partnerActionErrorMessage(
        new Error('partner withdrawal bank account must match KYC bank card'),
        '提现失败',
      ),
    ).toBe('提现银行卡需与实名验证银行卡一致');
    expect(
      partnerActionErrorMessage(
        new Error('partner withdrawal bank account is cooling down'),
        '提现失败',
      ),
    ).toBe('银行卡变更冷却期内暂不能提现');
    expect(
      partnerActionErrorMessage(new Error('insufficient_available_credit'), '提现失败'),
    ).toBe('可用 HOLA Credit 不足');
    expect(
      partnerActionErrorMessage(new Error('insufficient_withdrawable_credit'), '提现失败'),
    ).toBe('可提现 HOLA Credit 不足');
    expect(
      partnerActionErrorMessage(new Error('daily_platform_cap_exceeded'), '提现失败'),
    ).toBe('今日平台提现额度已用完，请明天再试');
    expect(
      partnerActionErrorMessage(new Error('monthly_user_cap_exceeded'), '提现失败'),
    ).toBe('本月提现额度已达上限，请下月再试');
    expect(
      partnerActionErrorMessage(new Error('partner referral attribution conflict'), '邀请登记失败'),
    ).toBe('该账号已有邀请归因');
    expect(
      partnerActionErrorMessage(new Error('partner KYC already passed'), '实名提交失败'),
    ).toBe('实名已通过，无需重复提交');
    expect(
      partnerActionErrorMessage(new Error('partner KYC bank account fingerprint required'), '实名提交失败'),
    ).toBe('请填写银行卡认证指纹');
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
      reason: '实名通过后才能充值。',
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
      reason: '实名通过后才能提现。',
    });

    const frozen = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      kycProfile: passedKycProfile(),
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

    const missingBankCard = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      kycProfile: passedKycProfile({ bankCardVerified: false }),
      ledger: { withdrawableCreditCents: 10_000_00 },
    });
    expect(missingBankCard.enabled).toBe(true);
    if (!missingBankCard.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(missingBankCard, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '请先完成银行卡实名验证。',
    });

    const ready = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      kycProfile: passedKycProfile(),
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

  it('uses configured dashboard withdrawal minimum in the withdrawal gate', () => {
    const state = normalizePartnerDashboard({
      enabled: true,
      membership: { status: 'active', expiresAt: '2027-07-03T00:00:00.000Z' },
      kycStatus: 'passed',
      kycProfile: passedKycProfile(),
      ledger: { withdrawableCreditCents: 1_000_00 },
      limits: { withdrawalMinCreditCents: 750_00 },
    });

    expect(state.enabled).toBe(true);
    if (!state.enabled) throw new Error('expected enabled partner dashboard');
    expect(
      partnerWithdrawalGate(state, {
        amountCreditCents: 600_00,
        bankAccountFingerprint: 'bank_fp_1',
      }),
    ).toEqual({
      blocked: true,
      reason: '单次提现最低 750 HOLA Credit。',
    });
    expect(
      partnerWithdrawalGate(state, {
        amountCreditCents: 750_00,
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
