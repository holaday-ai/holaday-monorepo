import {
  PARTNER_PLATFORM_POOL_CAP_CNY_CENTS,
  PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS,
  PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS,
  PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS,
  PARTNER_RECHARGE_MIN_CNY_CENTS,
} from '@holaday/shared-types';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function partnerConfig() {
  return {
    enabled: process.env.PARTNER_LEDGER_ENABLED === 'true',
    fxBps: intEnv('PARTNER_FX_BPS', 72_000),
    platformPoolCapCnyCents: intEnv('PARTNER_PLATFORM_POOL_CAP_CNY_CENTS', PARTNER_PLATFORM_POOL_CAP_CNY_CENTS),
    annualRechargeCapCnyCents: intEnv('PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS', PARTNER_RECHARGE_MAX_ANNUAL_CNY_CENTS),
    monthlyRechargeCapCnyCents: intEnv('PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS', PARTNER_RECHARGE_MAX_MONTHLY_CNY_CENTS),
    singleRechargeMinCnyCents: intEnv('PARTNER_RECHARGE_MIN_CNY_CENTS', PARTNER_RECHARGE_MIN_CNY_CENTS),
    singleRechargeMaxCnyCents: intEnv('PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS', PARTNER_RECHARGE_MAX_SINGLE_CNY_CENTS),
    withdrawalMinCreditCents: intEnv('PARTNER_WITHDRAWAL_MIN_CREDIT_CENTS', 500_00),
    withdrawalDailyPlatformCapCreditCents: intEnv('PARTNER_WITHDRAWAL_DAILY_PLATFORM_CAP_CREDIT_CENTS', 200_000_00),
    withdrawalMonthlyUserCapCreditCents: intEnv('PARTNER_WITHDRAWAL_MONTHLY_USER_CAP_CREDIT_CENTS', 100_000_00),
  };
}

export function assertPartnerLedgerWriteEnabled(): void {
  if (!partnerConfig().enabled) {
    throw new Error('partner ledger is disabled');
  }
}
