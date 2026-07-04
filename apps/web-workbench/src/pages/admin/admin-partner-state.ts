import {
  asRecord,
  finiteNumber,
  nonNegativeNumber,
  safeArray,
  safeText,
} from './admin-shared';

export type AdminPartnerStatusKind = 'kyc' | 'order' | 'withdrawal' | 'risk';

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
      overdueWithdrawalCount: Math.round(nonNegativeNumber(metrics.overdueWithdrawalCount)),
      riskLotCount: Math.round(nonNegativeNumber(metrics.riskLotCount)),
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
        updatedAt: row.updatedAt,
      };
    }),
    withdrawals: safeArray(root.withdrawals).map((raw) => {
      const row = asRecord(raw);
      return {
        withdrawalExternalId: safeText(row.withdrawalExternalId),
        userExternalId: safeText(row.userExternalId),
        email: safeText(row.email),
        displayName: safeText(row.displayName),
        amountCreditCents: Math.round(nonNegativeNumber(row.amountCreditCents)),
        status: safeText(row.status),
        reviewDueAt: row.reviewDueAt,
        riskScore: normalizeRiskScore(row.riskScore),
      };
    }),
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
        updatedAt: row.updatedAt,
      };
    }),
  };
}

type AdminPartnerOverviewState = ReturnType<typeof normalizeAdminPartnerOverview>;
type EnabledAdminPartnerOverviewState = Extract<AdminPartnerOverviewState, { enabled: true }>;

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
      rowMatches(needle, row, ['orderExternalId', 'userExternalId', 'email', 'displayName', 'orderKind', 'status']),
    ),
    kycProfiles: state.kycProfiles.filter((row) =>
      rowMatches(needle, row, ['kycExternalId', 'userExternalId', 'email', 'displayName', 'status', 'provider']),
    ),
    withdrawals: state.withdrawals.filter((row) =>
      rowMatches(needle, row, ['withdrawalExternalId', 'userExternalId', 'email', 'displayName', 'status']),
    ),
    riskLots: state.riskLots.filter((row) =>
      rowMatches(needle, row, ['lotExternalId', 'userExternalId', 'email', 'displayName', 'status', 'riskStatus']),
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
