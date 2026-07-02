export const PARTNER_MEMBERSHIP_PRICE_CNY_CENTS = 999_00;
export const HOLA_CREDIT_CNY_CENTS = 100;
export const API_UNITS_PER_HOLA_CREDIT = 1_000;

export const PARTNER_RECHARGE_MIN_CNY_CENTS = 10_000_00;
export const PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS = 200_000_00;
export const PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS = 500_000_00;
export const PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS = 1_000_000_00;
export const PARTNER_PLATFORM_POOL_CAP_CNY_CENTS = 1_000_000_00;

export const PARTNER_ACCUMULATION_DAYS = 120;
export const PARTNER_RELEASE_MONTHS = 8;
export const PARTNER_TOTAL_RELEASE_BPS = 12_000;
export const PARTNER_BONUS_BPS = 2_000;

export const PARTNER_RECHARGE_TIERS = [
  { minCnyCents: 10_000_00, maxCnyCents: 50_000_00, multiplierBps: 10_500 },
  { minCnyCents: 50_001_00, maxCnyCents: 100_000_00, multiplierBps: 10_800 },
  { minCnyCents: 100_001_00, maxCnyCents: 200_000_00, multiplierBps: 11_200 },
  { minCnyCents: 200_001_00, maxCnyCents: 400_000_00, multiplierBps: 11_600 },
  { minCnyCents: 400_001_00, maxCnyCents: 500_000_00, multiplierBps: 12_000 },
] as const;

export type PartnerMembershipStatus = 'active' | 'expired' | 'cancelled';
export type PartnerKycStatus = 'not_started' | 'pending' | 'passed' | 'review_required' | 'rejected';
export type PartnerLotStatus = 'accumulating' | 'release_pending' | 'releasing' | 'completed' | 'frozen' | 'closed';
export type PartnerLedgerEntryStatus = 'pending' | 'posted' | 'voided';
export type PartnerWithdrawalStatus = 'requested' | 'reviewing' | 'approved' | 'paid' | 'rejected' | 'returned';
