import {
  asRecord,
  finiteNumber,
  nonNegativeNumber,
  safeArray,
  safeText,
} from './admin-shared';

export type AdminPartnerStatusKind = 'kyc' | 'order' | 'withdrawal' | 'risk';

export function adminPartnerActionConfirmation(actionLabel: string): {
  title: string;
  description: string;
} {
  const label = actionLabel.trim() || '该审核动作';
  return {
    title: `确认执行“${label}”？`,
    description:
      '该操作会立即写入生产审核或账务状态。请再次核对对象、金额、原因和凭证信息。',
  };
}

interface AdminPartnerStatusToken {
  label: string;
  textClass: string;
  bgClass: string;
}

const FALLBACK_STATUS: AdminPartnerStatusToken = {
  label: '未知状态',
  textClass: 'text-[#595757]',
  bgClass: 'bg-[#EFEFEF]',
};

const STATUS_TOKENS: Record<AdminPartnerStatusKind, Record<string, AdminPartnerStatusToken>> = {
  kyc: {
    pending: {
      label: '待实名',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    passed: {
      label: '已通过',
      textClass: 'text-[#1688AA]',
      bgClass: 'bg-[#42C0EF]/10',
    },
    review_required: {
      label: '需复核',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    rejected: {
      label: '已拒绝',
      textClass: 'text-[#EA1F59]',
      bgClass: 'bg-[#EA1F59]/10',
    },
  },
  order: {
    pending: {
      label: '待确认',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    review_required: {
      label: '需复核',
      textClass: 'text-[#EA1F59]',
      bgClass: 'bg-[#EA1F59]/10',
    },
    completed: {
      label: '已完成',
      textClass: 'text-[#1688AA]',
      bgClass: 'bg-[#42C0EF]/10',
    },
  },
  withdrawal: {
    requested: {
      label: '待复核',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    reviewing: {
      label: '复核中',
      textClass: 'text-[#57479C]',
      bgClass: 'bg-[#57479C]/10',
    },
    approved: {
      label: '待出款',
      textClass: 'text-[#1688AA]',
      bgClass: 'bg-[#42C0EF]/10',
    },
    paid: {
      label: '已出款',
      textClass: 'text-[#1688AA]',
      bgClass: 'bg-[#42C0EF]/10',
    },
    rejected: {
      label: '已拒绝',
      textClass: 'text-[#EA1F59]',
      bgClass: 'bg-[#EA1F59]/10',
    },
    returned: {
      label: '已退回',
      textClass: 'text-[#595757]',
      bgClass: 'bg-[#EFEFEF]',
    },
  },
  risk: {
    normal: {
      label: '正常',
      textClass: 'text-[#1688AA]',
      bgClass: 'bg-[#42C0EF]/10',
    },
    review: {
      label: '需复核',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    review_required: {
      label: '需复核',
      textClass: 'text-[#8A6A00]',
      bgClass: 'bg-[#FFC910]/20',
    },
    frozen: {
      label: '已冻结',
      textClass: 'text-[#EA1F59]',
      bgClass: 'bg-[#EA1F59]/10',
    },
  },
};

export function partnerReviewStatusToken(
  kind: AdminPartnerStatusKind,
  status: unknown,
): AdminPartnerStatusToken {
  const normalized = typeof status === 'string' ? status : '';
  return STATUS_TOKENS[kind][normalized] ?? FALLBACK_STATUS;
}

export function partnerOrderActionLabel(status: unknown): '确认' | '放行' {
  return status === 'review_required' ? '放行' : '确认';
}

export function partnerRiskLotQueueAction(row: {
  readonly status: string;
  readonly riskStatus: string;
}): { action: 'freeze' | 'resume' | 'closed'; label: string; pendingLabel: string; canClose: boolean } {
  if (row.status === 'closed') {
    return { action: 'closed', label: '已关闭', pendingLabel: '已关闭', canClose: false };
  }
  if (row.status === 'frozen' || row.riskStatus === 'frozen') {
    return { action: 'resume', label: '恢复', pendingLabel: '恢复中', canClose: true };
  }
  return { action: 'freeze', label: '冻结', pendingLabel: '冻结中', canClose: false };
}

export type PartnerRiskLotCloseResolutionKind = 'manual' | 'refund' | 'fraud';

export interface PartnerRiskLotCloseResolutionInput {
  readonly resolutionKind?: PartnerRiskLotCloseResolutionKind;
  readonly resolutionRef?: string;
}

export function partnerRiskLotActionPayload(action: 'freeze', operatorNote: string): { reason: string };
export function partnerRiskLotActionPayload(
  action: 'close',
  operatorNote: string,
): { reason: string; resolutionKind: PartnerRiskLotCloseResolutionKind };
export function partnerRiskLotActionPayload(
  action: 'close',
  operatorNote: string,
  resolution: PartnerRiskLotCloseResolutionInput,
): { reason: string; resolutionKind: PartnerRiskLotCloseResolutionKind; resolutionRef?: string };
export function partnerRiskLotActionPayload(action: 'resume', operatorNote: string): { note: string };
export function partnerRiskLotActionPayload(
  action: 'freeze' | 'resume' | 'close',
  operatorNote: string,
  resolution?: PartnerRiskLotCloseResolutionInput,
): { reason: string; resolutionKind?: PartnerRiskLotCloseResolutionKind; resolutionRef?: string } | { note: string } {
  const normalized = operatorNote.trim();
  if (action === 'resume') {
    return { note: normalized || '后台风险恢复' };
  }
  if (action === 'close') {
    const resolutionRef = resolution?.resolutionRef?.trim();
    return {
      reason: normalized || '后台关闭风险批次',
      resolutionKind: resolution?.resolutionKind ?? 'manual',
      ...(resolutionRef ? { resolutionRef } : {}),
    };
  }
  return { reason: normalized || '后台风险冻结' };
}

export function partnerRiskEventTypeLabel(value: unknown): string {
  const type = typeof value === 'string' ? value : '';
  return {
    lot_frozen: '批次冻结',
    lot_resumed: '批次恢复',
    lot_closed: '批次关闭',
  }[type] ?? '风险事件';
}

export function partnerRiskEventSeverityLabel(value: unknown): string {
  const severity = typeof value === 'string' ? value : '';
  return {
    high: '高',
    medium: '中',
    low: '低',
  }[severity] ?? '未知';
}

export function partnerRiskCloseResolutionKindLabel(value: unknown): string {
  const resolutionKind = typeof value === 'string' ? value : '';
  return {
    manual: '人工处理',
    refund: '退款完成',
    fraud: '欺诈关闭',
  }[resolutionKind] ?? '人工处理';
}

export function partnerKycQueueReviewPayload(
  row: {
    readonly userExternalId: string;
    readonly provider: string;
    readonly providerRef: string;
  },
  status: 'passed' | 'rejected',
  note: string,
): {
  userExternalId: string;
  status: 'passed' | 'rejected';
  provider: string;
  providerRef?: string;
  note: string;
} {
  const provider = row.provider.trim() || 'manual';
  const providerRef = row.providerRef.trim();
  return {
    userExternalId: row.userExternalId,
    status,
    provider,
    ...(providerRef ? { providerRef } : {}),
    note,
  };
}

export function formatPartnerMoneyCents(value: unknown): string {
  const cents = Math.round(nonNegativeNumber(value));
  const yuan = cents / 100;
  return `¥${yuan.toLocaleString('zh-CN', {
    minimumFractionDigits: yuan % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPartnerCreditCents(value: unknown): string {
  const cents = Math.round(nonNegativeNumber(value));
  return `${(cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Credit`;
}

export function normalizeRiskScore(value: unknown): number {
  return Math.min(100, Math.max(0, Math.round(finiteNumber(value, 0))));
}

function normalizeWithdrawalOverviewRow(raw: unknown) {
  const row = asRecord(raw);
  return {
    withdrawalExternalId: safeText(row.withdrawalExternalId),
    userExternalId: safeText(row.userExternalId),
    email: safeText(row.email),
    displayName: safeText(row.displayName),
    amountCreditCents: Math.round(nonNegativeNumber(row.amountCreditCents)),
    status: safeText(row.status),
    reviewDueAt: row.reviewDueAt,
    bankAccountFingerprint: safeText(row.bankAccountFingerprint),
    rejectionReason: safeText(row.rejectionReason),
    approvalNote: safeText(row.approvalNote),
    providerPayoutId: safeText(row.providerPayoutId),
    approvedAt: safeText(row.approvedAt),
    rejectedAt: safeText(row.rejectedAt),
    paidAt: safeText(row.paidAt),
    returnedReason: safeText(row.returnedReason),
    returnedAt: safeText(row.returnedAt),
    updatedAt: row.updatedAt,
    riskScore: normalizeRiskScore(row.riskScore),
  };
}

export function normalizeAdminPartnerOverview(value: unknown) {
  const root = asRecord(value);
  if (root.enabled === false) {
    return { enabled: false as const };
  }
  const metrics = asRecord(root.metrics);
  return {
    enabled: true as const,
    metrics: {
      pendingKycCount: Math.round(nonNegativeNumber(metrics.pendingKycCount)),
      pendingOrderCount: Math.round(nonNegativeNumber(metrics.pendingOrderCount)),
      reviewRequiredOrderCount: Math.round(nonNegativeNumber(metrics.reviewRequiredOrderCount)),
      pendingWithdrawalCount: Math.round(nonNegativeNumber(metrics.pendingWithdrawalCount)),
      approvedWithdrawalCount: Math.round(nonNegativeNumber(metrics.approvedWithdrawalCount)),
      paidWithdrawalCount: Math.round(nonNegativeNumber(metrics.paidWithdrawalCount)),
      rejectedWithdrawalCount: Math.round(nonNegativeNumber(metrics.rejectedWithdrawalCount)),
      returnedWithdrawalCount: Math.round(nonNegativeNumber(metrics.returnedWithdrawalCount)),
      overdueWithdrawalCount: Math.round(nonNegativeNumber(metrics.overdueWithdrawalCount)),
      riskLotCount: Math.round(nonNegativeNumber(metrics.riskLotCount)),
      riskEventCount: Math.round(nonNegativeNumber(metrics.riskEventCount)),
    },
    orders: safeArray(root.orders).map((raw) => {
      const row = asRecord(raw);
      return {
        orderExternalId: safeText(row.orderExternalId),
        userExternalId: safeText(row.userExternalId),
        email: safeText(row.email),
        displayName: safeText(row.displayName),
        orderKind: safeText(row.orderKind),
        status: safeText(row.status),
        provider: safeText(row.provider),
        providerCaptureId: safeText(row.providerCaptureId),
        reviewReason: safeText(row.reviewReason),
        reviewErrorName: safeText(row.reviewErrorName),
        reviewErrorMessage: safeText(row.reviewErrorMessage),
        reviewApprovalNote: safeText(row.reviewApprovalNote),
        amountCnyCents: Math.round(nonNegativeNumber(row.amountCnyCents)),
        createdAt: row.createdAt,
      };
    }),
    kycProfiles: safeArray(root.kycProfiles).map((raw) => {
      const row = asRecord(raw);
      return {
        kycExternalId: safeText(row.kycExternalId),
        userExternalId: safeText(row.userExternalId),
        email: safeText(row.email),
        displayName: safeText(row.displayName),
        status: safeText(row.status),
        country: safeText(row.country, 'CN'),
        provider: safeText(row.provider),
        providerRef: safeText(row.providerRef),
        reviewerUserId: Math.round(nonNegativeNumber(row.reviewerUserId)),
        reviewNote: safeText(row.reviewNote),
        reviewSource: safeText(row.reviewSource),
        updatedAt: row.updatedAt,
      };
    }),
    withdrawals: safeArray(root.withdrawals).map(normalizeWithdrawalOverviewRow),
    withdrawalHistory: safeArray(root.withdrawalHistory).map(normalizeWithdrawalOverviewRow),
    riskLots: safeArray(root.riskLots).map((raw) => {
      const row = asRecord(raw);
      return {
        lotExternalId: safeText(row.lotExternalId),
        userExternalId: safeText(row.userExternalId),
        email: safeText(row.email),
        displayName: safeText(row.displayName),
        status: safeText(row.status),
        riskStatus: safeText(row.riskStatus),
        principalCreditCents: Math.round(nonNegativeNumber(row.principalCreditCents)),
        apiUnits: Math.round(nonNegativeNumber(row.apiUnits)),
        riskFrozenByUserId: Math.round(nonNegativeNumber(row.riskFrozenByUserId)),
        riskFrozenAt: safeText(row.riskFrozenAt),
        riskFreezeReason: safeText(row.riskFreezeReason),
        riskResumedByUserId: Math.round(nonNegativeNumber(row.riskResumedByUserId)),
        riskResumedAt: safeText(row.riskResumedAt),
        riskResumeNote: safeText(row.riskResumeNote),
        riskClosedByUserId: Math.round(nonNegativeNumber(row.riskClosedByUserId)),
        riskClosedAt: safeText(row.riskClosedAt),
        riskCloseReason: safeText(row.riskCloseReason),
        riskCloseResolutionKind: safeText(row.riskCloseResolutionKind),
        riskCloseResolutionRef: safeText(row.riskCloseResolutionRef),
        updatedAt: row.updatedAt,
      };
    }),
    riskEvents: safeArray(root.riskEvents).map((raw) => {
      const row = asRecord(raw);
      return {
        riskEventExternalId: safeText(row.riskEventExternalId),
        userExternalId: safeText(row.userExternalId),
        email: safeText(row.email),
        displayName: safeText(row.displayName),
        lotExternalId: safeText(row.lotExternalId),
        eventType: safeText(row.eventType),
        severity: safeText(row.severity),
        status: safeText(row.status),
        reviewerUserId: Math.round(nonNegativeNumber(row.reviewerUserId)),
        riskReason: safeText(row.riskReason),
        riskResolutionKind: safeText(row.riskResolutionKind),
        riskResolutionRef: safeText(row.riskResolutionRef),
        riskNote: safeText(row.riskNote),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  };
}

type AdminPartnerOverviewState = ReturnType<typeof normalizeAdminPartnerOverview>;
type EnabledAdminPartnerOverviewState = Extract<AdminPartnerOverviewState, { enabled: true }>;

export function normalizePartnerReconciliation(value: unknown) {
  const root = asRecord(value);
  if (root.enabled === false) {
    return { enabled: false as const };
  }
  const range = asRecord(root.range);
  const metrics = asRecord(root.metrics);
  return {
    enabled: true as const,
    range: {
      from: safeText(range.from, ''),
      to: safeText(range.to, ''),
      basis: safeText(range.basis, 'updated_at'),
    },
    metrics: {
      orderCount: Math.round(nonNegativeNumber(metrics.orderCount)),
      completedOrderCount: Math.round(nonNegativeNumber(metrics.completedOrderCount)),
      pendingOrderCount: Math.round(nonNegativeNumber(metrics.pendingOrderCount)),
      reviewRequiredOrderCount: Math.round(nonNegativeNumber(metrics.reviewRequiredOrderCount)),
      completedOrderAmountCnyCents: Math.round(nonNegativeNumber(metrics.completedOrderAmountCnyCents)),
      membershipRevenueCnyCents: Math.round(nonNegativeNumber(metrics.membershipRevenueCnyCents)),
      rechargePrincipalCnyCents: Math.round(nonNegativeNumber(metrics.rechargePrincipalCnyCents)),
      withdrawalCount: Math.round(nonNegativeNumber(metrics.withdrawalCount)),
      requestedWithdrawalCount: Math.round(nonNegativeNumber(metrics.requestedWithdrawalCount)),
      approvedWithdrawalCount: Math.round(nonNegativeNumber(metrics.approvedWithdrawalCount)),
      paidWithdrawalCount: Math.round(nonNegativeNumber(metrics.paidWithdrawalCount)),
      rejectedWithdrawalCount: Math.round(nonNegativeNumber(metrics.rejectedWithdrawalCount)),
      returnedWithdrawalCount: Math.round(nonNegativeNumber(metrics.returnedWithdrawalCount)),
      approvedWithdrawalCreditCents: Math.round(nonNegativeNumber(metrics.approvedWithdrawalCreditCents)),
      paidWithdrawalCreditCents: Math.round(nonNegativeNumber(metrics.paidWithdrawalCreditCents)),
      referralCount: Math.round(nonNegativeNumber(metrics.referralCount)),
      rewardedReferralCount: Math.round(nonNegativeNumber(metrics.rewardedReferralCount)),
      pendingReferralCount: Math.round(nonNegativeNumber(metrics.pendingReferralCount)),
      directReferralRewardCreditCents: Math.round(nonNegativeNumber(metrics.directReferralRewardCreditCents)),
      assistedReferralRewardCreditCents: Math.round(nonNegativeNumber(metrics.assistedReferralRewardCreditCents)),
      totalReferralRewardCreditCents: Math.round(nonNegativeNumber(metrics.totalReferralRewardCreditCents)),
    },
    providerBreakdown: safeArray(root.providerBreakdown).map((raw) => {
      const row = asRecord(raw);
      return {
        provider: safeText(row.provider, 'unknown'),
        orderCount: Math.round(nonNegativeNumber(row.orderCount)),
        completedOrderCount: Math.round(nonNegativeNumber(row.completedOrderCount)),
        completedAmountCnyCents: Math.round(nonNegativeNumber(row.completedAmountCnyCents)),
        reviewRequiredOrderCount: Math.round(nonNegativeNumber(row.reviewRequiredOrderCount)),
      };
    }),
    orders: safeArray(root.orders).map((raw) => {
      const row = asRecord(raw);
      return {
        orderExternalId: safeText(row.orderExternalId, ''),
        userExternalId: safeText(row.userExternalId, ''),
        email: safeText(row.email, ''),
        displayName: safeText(row.displayName, ''),
        provider: safeText(row.provider, ''),
        providerCaptureId: safeText(row.providerCaptureId, ''),
        orderKind: safeText(row.orderKind, ''),
        status: safeText(row.status, ''),
        amountCnyCents: Math.round(nonNegativeNumber(row.amountCnyCents)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
    withdrawals: safeArray(root.withdrawals).map((raw) => {
      const row = asRecord(raw);
      return {
        withdrawalExternalId: safeText(row.withdrawalExternalId, ''),
        userExternalId: safeText(row.userExternalId, ''),
        email: safeText(row.email, ''),
        displayName: safeText(row.displayName, ''),
        status: safeText(row.status, ''),
        amountCreditCents: Math.round(nonNegativeNumber(row.amountCreditCents)),
        bankAccountFingerprint: safeText(row.bankAccountFingerprint, ''),
        providerPayoutId: safeText(row.providerPayoutId, ''),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
    referrals: safeArray(root.referrals).map((raw) => {
      const row = asRecord(raw);
      return {
        referralExternalId: safeText(row.referralExternalId, ''),
        inviterExternalId: safeText(row.inviterExternalId, ''),
        inviteeExternalId: safeText(row.inviteeExternalId, ''),
        status: safeText(row.status, ''),
        assisted: row.assisted === true,
        rewardCreditCents: Math.round(nonNegativeNumber(row.rewardCreditCents)),
        rewardRateBps: Math.round(nonNegativeNumber(row.rewardRateBps)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  };
}

export type PartnerReconciliationState = ReturnType<typeof normalizePartnerReconciliation>;

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function partnerReconciliationCsv(state: PartnerReconciliationState): string {
  if (!state.enabled) return '';
  const rows = [
    ['rowType', 'externalId', 'userExternalId', 'status', 'kind', 'provider', 'amountCnyCents', 'amountCreditCents', 'providerRef', 'updatedAt'],
    ...state.orders.map((row) => [
      'order',
      row.orderExternalId,
      row.userExternalId,
      row.status,
      row.orderKind,
      row.provider,
      row.amountCnyCents,
      '',
      row.providerCaptureId,
      row.updatedAt,
    ]),
    ...state.withdrawals.map((row) => [
      'withdrawal',
      row.withdrawalExternalId,
      row.userExternalId,
      row.status,
      'withdrawal',
      '',
      '',
      row.amountCreditCents,
      row.providerPayoutId || row.bankAccountFingerprint,
      row.updatedAt,
    ]),
    ...state.referrals.map((row) => [
      'referral',
      row.referralExternalId,
      row.inviterExternalId,
      row.status,
      row.assisted ? 'assisted_referral' : 'direct_referral',
      '',
      '',
      row.rewardCreditCents,
      row.inviteeExternalId,
      row.updatedAt,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function filterAdminPartnerOverview(
  state: AdminPartnerOverviewState,
  query: string,
): AdminPartnerOverviewState {
  if (!state.enabled) return state;
  const needle = query.trim().toLowerCase();
  if (!needle) return state;

  return {
    ...state,
    orders: state.orders.filter((row) =>
      rowMatches(needle, row, [
        'orderExternalId',
        'userExternalId',
        'email',
        'displayName',
        'orderKind',
        'status',
        'provider',
        'providerCaptureId',
        'reviewReason',
        'reviewErrorName',
        'reviewErrorMessage',
        'reviewApprovalNote',
      ]),
    ),
    kycProfiles: state.kycProfiles.filter((row) =>
      rowMatches(needle, row, [
        'kycExternalId',
        'userExternalId',
        'email',
        'displayName',
        'status',
        'provider',
        'providerRef',
        'reviewNote',
        'reviewSource',
        'reviewerUserId',
      ]),
    ),
    withdrawals: state.withdrawals.filter((row) =>
      rowMatches(needle, row, [
        'withdrawalExternalId',
        'userExternalId',
        'email',
        'displayName',
        'status',
        'bankAccountFingerprint',
        'rejectionReason',
        'approvalNote',
        'providerPayoutId',
      ]),
    ),
    withdrawalHistory: state.withdrawalHistory.filter((row) =>
      rowMatches(needle, row, [
        'withdrawalExternalId',
        'userExternalId',
        'email',
        'displayName',
        'status',
        'bankAccountFingerprint',
        'rejectionReason',
        'approvalNote',
        'providerPayoutId',
        'approvedAt',
        'rejectedAt',
        'paidAt',
        'returnedReason',
        'returnedAt',
      ]),
    ),
    riskLots: state.riskLots.filter((row) =>
      rowMatches(needle, row, [
        'lotExternalId',
        'userExternalId',
        'email',
        'displayName',
        'status',
        'riskStatus',
        'riskFreezeReason',
        'riskFrozenAt',
        'riskResumeNote',
        'riskResumedAt',
        'riskCloseReason',
        'riskCloseResolutionKind',
        'riskCloseResolutionRef',
        'riskClosedAt',
      ]),
    ),
    riskEvents: state.riskEvents.filter((row) =>
      rowMatches(needle, row, [
        'riskEventExternalId',
        'userExternalId',
        'email',
        'displayName',
        'lotExternalId',
        'eventType',
        'severity',
        'status',
        'riskReason',
        'riskResolutionKind',
        'riskResolutionRef',
        'riskNote',
      ]),
    ),
  } satisfies EnabledAdminPartnerOverviewState;
}

function rowMatches<T extends Record<string, unknown>>(
  needle: string,
  row: T,
  keys: ReadonlyArray<keyof T>,
): boolean {
  return keys.some((key) => String(row[key] ?? '').toLowerCase().includes(needle));
}
