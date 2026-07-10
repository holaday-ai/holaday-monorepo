import {
  formatCny,
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
} from '@holaday/shared-types';
import { pageErrorMessage } from './page-error-copy';

type PartnerMembershipStatus = 'active' | 'expired' | 'cancelled';
type NormalizedMembershipStatus = PartnerMembershipStatus | 'none';
type PartnerKycStatus = 'not_started' | 'pending' | 'passed' | 'review_required' | 'rejected';
type PartnerLotStatus = 'accumulating' | 'release_pending' | 'releasing' | 'completed' | 'frozen' | 'closed';
type PartnerRiskStatus = 'normal' | 'review' | 'review_required' | 'frozen';

export interface PartnerDisabledState {
  readonly enabled: false;
  readonly title: string;
  readonly description: string;
}

export interface PartnerEnabledState {
  readonly enabled: true;
  readonly membership: NormalizedPartnerMembership;
  readonly kycStatus: PartnerKycStatus;
  readonly kycLabel: string;
  readonly kycProfile: PartnerKycProfileState | null;
  readonly limits: PartnerLimitsState;
  readonly inviteCode: string;
  readonly ledger: PartnerLedgerState;
  readonly lots: readonly PartnerLotState[];
  readonly orders: readonly PartnerOrderState[];
  readonly withdrawals: readonly PartnerWithdrawalActivityState[];
}

export interface NormalizedPartnerMembership {
  readonly status: NormalizedMembershipStatus;
  readonly label: string;
  readonly expiresAt: string | null;
  readonly expiresAtLabel: string;
}

export interface PartnerLedgerState {
  readonly availableCreditCents: number;
  readonly lockedCreditCents: number;
  readonly withdrawableCreditCents: number;
  readonly pendingWithdrawalCreditCents: number;
  readonly frozenCreditCents: number;
}

export interface PartnerLimitsState {
  readonly withdrawalMinCreditCents: number;
}

export interface PartnerLotState {
  readonly key: string;
  readonly externalId: string;
  readonly status: PartnerLotStatus;
  readonly statusLabel: string;
  readonly riskStatus: PartnerRiskStatus;
  readonly riskLabel: string;
  readonly principalCreditCents: number;
  readonly lockedBonusCreditCents: number;
  readonly releasedPrincipalCreditCents: number;
  readonly releasedBonusCreditCents: number;
  readonly carryForwardCreditCents: number;
  readonly releaseStartsAt: string | null;
  readonly releaseStartsAtLabel: string;
  readonly releaseEndsAt: string | null;
  readonly releaseEndsAtLabel: string;
}

export interface PartnerKycProfileState {
  readonly kycExternalId: string;
  readonly status: PartnerKycStatus;
  readonly statusLabel: string;
  readonly country: string;
  readonly provider: string;
  readonly providerRef: string | null;
  readonly bankCardVerified: boolean;
  readonly reviewedAt: string | null;
  readonly reviewedAtLabel: string;
}

export interface PartnerOrderState {
  readonly key: string;
  readonly orderExternalId: string;
  readonly provider: string;
  readonly orderKind: string;
  readonly amountCnyCents: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusHelp: string;
  readonly createdAt: string | null;
  readonly createdAtLabel: string;
}

export interface PartnerWithdrawalActivityState {
  readonly key: string;
  readonly withdrawalExternalId: string;
  readonly amountCreditCents: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusHelp: string;
  readonly reviewDueAt: string | null;
  readonly reviewDueAtLabel: string;
  readonly bankAccountFingerprint: string;
  readonly rejectionReason: string;
  readonly providerPayoutId: string;
  readonly paidAt: string | null;
  readonly paidAtLabel: string;
  readonly riskScore: number;
}

export type PartnerPageState = PartnerDisabledState | PartnerEnabledState;

export interface PartnerIdempotencyDraft {
  readonly key: string;
  readonly fingerprint: string;
}

export interface PartnerRechargeGate {
  readonly blocked: boolean;
  readonly reason: string;
}

export interface PartnerWithdrawalGate {
  readonly blocked: boolean;
  readonly reason: string;
}

const PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS = 500_00;

const disabledState: PartnerDisabledState = {
  enabled: false,
  title: '合伙人账本暂未开放',
  description: '当前部署尚未开启 HOLADAY 合伙人账本。你可以稍后再回来查看。',
};

const KYC_LABELS: Record<PartnerKycStatus, string> = {
  not_started: '未开始',
  pending: '审核中',
  passed: '已通过',
  review_required: '需补充材料',
  rejected: '未通过',
};

const LOT_STATUS_LABELS: Record<PartnerLotStatus, string> = {
  accumulating: '累计中',
  release_pending: '待释放',
  releasing: '释放中',
  completed: '已完成',
  frozen: '已冻结',
  closed: '已关闭',
};

const RISK_LABELS: Record<PartnerRiskStatus, string> = {
  normal: '正常',
  review: '复核中',
  review_required: '需复核',
  frozen: '已冻结',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  completed: '已完成',
  review_required: '待复核',
  cancelled: '已取消',
};

const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  requested: '已提交',
  reviewing: '审核中',
  approved: '待出款',
  paid: '已出款',
  rejected: '未通过',
  returned: '已退回',
};

const MEMBERSHIP_STATUSES = new Set<PartnerMembershipStatus>(['active', 'expired', 'cancelled']);
const KYC_STATUSES = new Set<PartnerKycStatus>([
  'not_started',
  'pending',
  'passed',
  'review_required',
  'rejected',
]);
const LOT_STATUSES = new Set<PartnerLotStatus>([
  'accumulating',
  'release_pending',
  'releasing',
  'completed',
  'frozen',
  'closed',
]);
const RISK_STATUSES = new Set<PartnerRiskStatus>(['normal', 'review', 'review_required', 'frozen']);

const PARTNER_ACTION_ERROR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/partner ledger is disabled/i, '合伙人账本暂未开放'],
  [/\bbelow_minimum\b/i, '金额低于最低限制'],
  [/\babove_single_maximum\b/i, '金额超过单笔上限'],
  [/\bnot_whole_cny\b/i, '金额必须为整元'],
  [/partner membership required/i, '请先创建并完成年费会员订单'],
  [/partner KYC must be passed before recharge/i, '实名通过后才能充值'],
  [/partner KYC must be passed before withdrawal/i, '实名通过后才能提现'],
  [/partner KYC already passed/i, '实名已通过，无需重复提交'],
  [/partner withdrawal is frozen by risk control/i, '账户存在冻结 HOLA Credit，需完成复核后再提现'],
  [/partner withdrawal requires a verified bank account/i, '请先完成银行卡实名验证'],
  [/partner withdrawal bank account must match KYC bank card/i, '提现银行卡需与实名验证银行卡一致'],
  [/partner withdrawal bank account is cooling down/i, '银行卡变更冷却期内暂不能提现'],
  [/\binsufficient_withdrawable_credit\b/i, '可提现 HOLA Credit 不足'],
  [/\binsufficient_available_credit\b/i, '可用 HOLA Credit 不足'],
  [/\bdaily_platform_cap_exceeded\b/i, '今日平台提现额度已用完，请明天再试'],
  [/\bmonthly_user_cap_exceeded\b/i, '本月提现额度已达上限，请下月再试'],
  [/partner referral attribution conflict/i, '该账号已有邀请归因'],
  [
    /Failed to fetch|fetch failed|NetworkError|Load failed|ECONNREFUSED|ECONNRESET|Failed to connect|Bad Gateway|Service Unavailable/i,
    '合伙人服务暂时未连接，请确认 orchestrator 已启动后重试',
  ],
];

export function normalizePartnerDashboard(value: unknown): PartnerPageState {
  if (!isRecord(value) || value.enabled !== true) return disabledState;

  const kycStatus = normalizeKycStatus(value.kycStatus);
  return {
    enabled: true,
    membership: normalizeMembership(value.membership),
    kycStatus,
    kycLabel: kycStatusLabel(kycStatus),
    kycProfile: normalizeKycProfile(value.kycProfile),
    limits: normalizeLimits(value.limits),
    inviteCode: normalizeInviteCode(value.inviteCode),
    ledger: normalizeLedger(value.ledger),
    lots: normalizeLots(value.lots),
    orders: normalizeOrders(value.orders),
    withdrawals: normalizeWithdrawals(value.withdrawals),
  };
}

export function formatHolaCreditCents(value: unknown): string {
  const credits = safeCents(value) / 100;
  return `${formatNumber(credits, 2)} HOLA Credit`;
}

export function formatApiUnits(value: unknown): string {
  const amount = safeCents(value);
  if (amount < 1000) return `${amount} API Units`;
  return `${new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount)} API Units`;
}

export function formatPartnerCnyCents(value: unknown): string {
  return formatCny(safeCents(value));
}

export function clampRechargeAmountCnyCents(value: unknown): number {
  const rawCents =
    typeof value === 'string'
      ? Number(value.trim()) * 100
      : typeof value === 'number'
        ? value
        : Number.NaN;
  const wholeCnyCents = Number.isFinite(rawCents) ? Math.floor(rawCents / 100) * 100 : Number.NaN;
  if (!Number.isFinite(wholeCnyCents)) return PARTNER_RECHARGE_MIN_CNY_CENTS;
  return Math.min(
    PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
    Math.max(PARTNER_RECHARGE_MIN_CNY_CENTS, wholeCnyCents),
  );
}

export function membershipStatusLabel(value: unknown): string {
  const membership = normalizeMembership(value);
  return membershipLabel(membership.status, membership.expiresAt);
}

export function kycStatusLabel(value: unknown): string {
  return KYC_LABELS[normalizeKycStatus(value)];
}

export function partnerRechargeGate(state: PartnerEnabledState): PartnerRechargeGate {
  if (state.membership.status !== 'active') {
    return {
      blocked: true,
      reason: '完成年度会员后才能充值。',
    };
  }

  if (state.kycStatus !== 'passed') {
    return {
      blocked: true,
      reason:
        state.kycStatus === 'review_required'
          ? '补充实名材料并通过后才能充值。'
          : state.kycStatus === 'rejected'
            ? '重新提交实名并通过后才能充值。'
            : '实名审核通过后才能充值。',
    };
  }

  return {
    blocked: false,
    reason: '可以创建充值预览和订单。',
  };
}

export function partnerWithdrawalGate(
  state: PartnerEnabledState,
  input: {
    readonly amountCreditCents: number;
    readonly bankAccountFingerprint: string;
  },
): PartnerWithdrawalGate {
  if (state.membership.status !== 'active') {
    return {
      blocked: true,
      reason: '完成年度会员后才能提现。',
    };
  }

  if (state.kycStatus !== 'passed') {
    return {
      blocked: true,
      reason:
        state.kycStatus === 'review_required'
          ? '补充实名材料并通过后才能提现。'
          : state.kycStatus === 'rejected'
            ? '重新提交实名并通过后才能提现。'
            : '实名审核通过后才能提现。',
    };
  }

  if (state.kycProfile?.bankCardVerified !== true) {
    return {
      blocked: true,
      reason: '请先完成银行卡实名验证。',
    };
  }

  if (state.ledger.frozenCreditCents > 0) {
    return {
      blocked: true,
      reason: '账户存在冻结 HOLA Credit，需完成复核后再提现。',
    };
  }

  const withdrawalMinCreditCents = state.limits.withdrawalMinCreditCents;

  if (state.ledger.withdrawableCreditCents < withdrawalMinCreditCents) {
    return {
      blocked: true,
      reason: `可提现 HOLA Credit 低于 ${formatHolaCreditCents(withdrawalMinCreditCents)}。`,
    };
  }

  if (input.amountCreditCents <= 0) {
    return {
      blocked: true,
      reason: '请填写提现金额。',
    };
  }

  if (input.amountCreditCents < withdrawalMinCreditCents) {
    return {
      blocked: true,
      reason: `单次提现最低 ${formatHolaCreditCents(withdrawalMinCreditCents)}。`,
    };
  }

  if (input.amountCreditCents > state.ledger.withdrawableCreditCents) {
    return {
      blocked: true,
      reason: '提现金额超过可提现 HOLA Credit。',
    };
  }

  if (input.bankAccountFingerprint.trim().length === 0) {
    return {
      blocked: true,
      reason: '请填写银行账户指纹。',
    };
  }

  return {
    blocked: false,
    reason: '可以提交提现申请。',
  };
}

export function partnerActionErrorMessage(error: unknown, fallback: string): string {
  const raw = rawErrorText(error);
  if (!raw) return pageErrorMessage(error, fallback);
  for (const [match, copy] of PARTNER_ACTION_ERROR_RULES) {
    if (match.test(raw)) return copy;
  }
  return pageErrorMessage(null, fallback);
}

export function partnerDraftKeyFor({
  current,
  prefix,
  fingerprint,
  makeKey,
}: {
  readonly current: PartnerIdempotencyDraft | null;
  readonly prefix: string;
  readonly fingerprint: string;
  readonly makeKey: (prefix: string) => string;
}): PartnerIdempotencyDraft {
  if (current?.fingerprint === fingerprint) return current;
  return {
    key: makeKey(prefix),
    fingerprint,
  };
}

export function partnerDraftKeyAfterSuccess({
  prefix,
  fingerprint,
  makeKey,
}: {
  readonly prefix: string;
  readonly fingerprint: string;
  readonly makeKey: (prefix: string) => string;
}): PartnerIdempotencyDraft {
  return {
    key: makeKey(prefix),
    fingerprint,
  };
}

function normalizeMembership(value: unknown): NormalizedPartnerMembership {
  if (!isRecord(value) || !isMembershipStatus(value.status)) {
    return {
      status: 'none',
      label: '未开通',
      expiresAt: null,
      expiresAtLabel: '—',
    };
  }

  const expiresAt = dateOnly(value.expiresAt);
  return {
    status: value.status,
    label: membershipLabel(value.status, expiresAt),
    expiresAt,
    expiresAtLabel: expiresAt ?? '—',
  };
}

function membershipLabel(status: NormalizedMembershipStatus, expiresAt: string | null): string {
  if (status === 'active' && expiresAt) return `有效至 ${expiresAt}`;
  if (status === 'active') return '已开通';
  if (status === 'expired') return '已过期';
  if (status === 'cancelled') return '已取消';
  return '未开通';
}

function normalizeKycStatus(value: unknown): PartnerKycStatus {
  return typeof value === 'string' && KYC_STATUSES.has(value as PartnerKycStatus)
    ? (value as PartnerKycStatus)
    : 'not_started';
}

function normalizeInviteCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 64) : '';
}

function normalizeLedger(value: unknown): PartnerLedgerState {
  const ledger = isRecord(value) ? value : {};
  return {
    availableCreditCents: safeCents(ledger.availableCreditCents),
    lockedCreditCents: safeCents(ledger.lockedCreditCents),
    withdrawableCreditCents: safeCents(ledger.withdrawableCreditCents),
    pendingWithdrawalCreditCents: safeCents(ledger.pendingWithdrawalCreditCents),
    frozenCreditCents: safeCents(ledger.frozenCreditCents),
  };
}

function normalizeLimits(value: unknown): PartnerLimitsState {
  const limits = isRecord(value) ? value : {};
  return {
    withdrawalMinCreditCents: safeCents(limits.withdrawalMinCreditCents) || PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS,
  };
}

function normalizeKycProfile(value: unknown): PartnerKycProfileState | null {
  if (!isRecord(value)) return null;
  const kycExternalId = safeTrimmedString(value.kycExternalId);
  if (!kycExternalId) return null;
  const status = normalizeKycStatus(value.status);
  const providerRef = safeTrimmedString(value.providerRef);
  const reviewedAt = dateOnly(value.reviewedAt);
  return {
    kycExternalId,
    status,
    statusLabel: KYC_LABELS[status],
    country: safeTrimmedString(value.country) || 'CN',
    provider: safeTrimmedString(value.provider) || 'manual',
    providerRef: providerRef || null,
    bankCardVerified: value.bankCardVerified === true,
    reviewedAt,
    reviewedAtLabel: reviewedAt ?? '—',
  };
}

function normalizeLots(value: unknown): readonly PartnerLotState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const externalId = safeTrimmedString(entry.externalId) || `lot-${index + 1}`;
    const status = normalizeLotStatus(entry.status);
    const riskStatus = normalizeRiskStatus(entry.riskStatus);
    const releaseStartsAt = dateOnly(entry.releaseStartsAt);
    const releaseEndsAt = dateOnly(entry.releaseEndsAt);
    return [
      {
        key: externalId,
        externalId,
        status,
        statusLabel: LOT_STATUS_LABELS[status],
        riskStatus,
        riskLabel: RISK_LABELS[riskStatus],
        principalCreditCents: safeCents(entry.principalCreditCents),
        lockedBonusCreditCents: safeCents(entry.lockedBonusCreditCents),
        releasedPrincipalCreditCents: safeCents(entry.releasedPrincipalCreditCents),
        releasedBonusCreditCents: safeCents(entry.releasedBonusCreditCents),
        carryForwardCreditCents: safeCents(entry.carryForwardCreditCents),
        releaseStartsAt,
        releaseStartsAtLabel: releaseStartsAt ?? '—',
        releaseEndsAt,
        releaseEndsAtLabel: releaseEndsAt ?? '—',
      },
    ];
  });
}

function normalizeOrders(value: unknown): readonly PartnerOrderState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const orderExternalId = safeTrimmedString(entry.orderExternalId) || `order-${index + 1}`;
    const status = safeTrimmedString(entry.status) || 'pending';
    const reviewDetail = safeTrimmedString(entry.reviewErrorMessage) || safeTrimmedString(entry.reviewReason);
    const createdAt = dateOnly(entry.createdAt);
    return [
      {
        key: orderExternalId,
        orderExternalId,
        provider: safeTrimmedString(entry.provider) || 'manual',
        orderKind: safeTrimmedString(entry.orderKind) || 'recharge',
        amountCnyCents: safeCents(entry.amountCnyCents),
        status,
        statusLabel: orderStatusLabel(status),
        statusHelp: orderStatusHelp(status, reviewDetail),
        createdAt,
        createdAtLabel: createdAt ?? '—',
      },
    ];
  });
}

function normalizeWithdrawals(value: unknown): readonly PartnerWithdrawalActivityState[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const withdrawalExternalId = safeTrimmedString(entry.withdrawalExternalId) || `withdrawal-${index + 1}`;
    const status = safeTrimmedString(entry.status) || 'requested';
    const reviewDueAt = dateOnly(entry.reviewDueAt);
    const paidAt = dateOnly(entry.paidAt);
    const rejectionReason = safeTrimmedString(entry.rejectionReason);
    const providerPayoutId = safeTrimmedString(entry.providerPayoutId);
    return [
      {
        key: withdrawalExternalId,
        withdrawalExternalId,
        amountCreditCents: safeCents(entry.amountCreditCents),
        status,
        statusLabel: withdrawalStatusLabel(status),
        statusHelp: withdrawalStatusHelp(status, {
          rejectionReason,
          providerPayoutId,
        }),
        reviewDueAt,
        reviewDueAtLabel: reviewDueAt ?? '—',
        bankAccountFingerprint: safeTrimmedString(entry.bankAccountFingerprint),
        rejectionReason,
        providerPayoutId,
        paidAt,
        paidAtLabel: paidAt ?? '—',
        riskScore: safeRiskScore(entry.riskScore),
      },
    ];
  });
}

function normalizeLotStatus(value: unknown): PartnerLotStatus {
  return typeof value === 'string' && LOT_STATUSES.has(value as PartnerLotStatus)
    ? (value as PartnerLotStatus)
    : 'accumulating';
}

function normalizeRiskStatus(value: unknown): PartnerRiskStatus {
  return typeof value === 'string' && RISK_STATUSES.has(value as PartnerRiskStatus)
    ? (value as PartnerRiskStatus)
    : 'normal';
}

function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

function orderStatusHelp(status: string, reviewDetail: string): string {
  if (status === 'pending') return '等待支付渠道或后台确认。';
  if (status === 'completed') return '订单已完成，权益或 HOLA Credit 已入账。';
  if (status === 'review_required') {
    return reviewDetail ? `订单进入人工复核：${reviewDetail}` : '订单进入人工复核，请等待后台确认。';
  }
  if (status === 'cancelled') return '订单已取消，不会继续处理。';
  return '订单状态已更新，请刷新查看最新进度。';
}

function withdrawalStatusLabel(status: string): string {
  return WITHDRAWAL_STATUS_LABELS[status] ?? status;
}

function withdrawalStatusHelp(
  status: string,
  detail: {
    readonly rejectionReason: string;
    readonly providerPayoutId: string;
  },
): string {
  if (status === 'requested') return '提现申请已提交，等待后台复核。';
  if (status === 'reviewing') return '提现申请正在复核，请等待处理。';
  if (status === 'approved') return '提现已通过复核，等待出款。';
  if (status === 'paid') {
    return detail.providerPayoutId
      ? `已完成出款，流水号 ${detail.providerPayoutId}。`
      : '已完成出款，请留意到账。';
  }
  if (status === 'rejected') {
    return detail.rejectionReason ? `提现未通过：${detail.rejectionReason}` : '提现未通过，资金已回到可用余额。';
  }
  if (status === 'returned') return '提现已退回，资金会回到可用余额。';
  return '提现状态已更新，请刷新查看最新进度。';
}

function isMembershipStatus(value: unknown): value is PartnerMembershipStatus {
  return typeof value === 'string' && MEMBERSHIP_STATUSES.has(value as PartnerMembershipStatus);
}

function safeCents(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function safeRiskScore(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function safeTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rawErrorText(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === 'string') return error.trim();
  return '';
}

function dateOnly(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
