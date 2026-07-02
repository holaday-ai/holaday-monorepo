import {
  API_UNITS_PER_HOLA_CREDIT,
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_BONUS_BPS,
  PARTNER_RECHARGE_TIERS,
  PARTNER_RELEASE_MONTHS,
  PARTNER_TOTAL_RELEASE_BPS,
} from '@holaday/shared-types';

export function selectRechargeTier(rollingThirtyDayCnyCents: number) {
  const tier = [...PARTNER_RECHARGE_TIERS]
    .reverse()
    .find((candidate) => rollingThirtyDayCnyCents >= candidate.minCnyCents);
  return tier ?? PARTNER_RECHARGE_TIERS[0];
}

export function calculateApiUnits(principalCreditCents: number, multiplierBps: number): number {
  return Math.floor(
    (principalCreditCents * API_UNITS_PER_HOLA_CREDIT * multiplierBps) / (HOLA_CREDIT_CNY_CENTS * 10_000),
  );
}

export function calculateLotCaps(principalCreditCents: number) {
  return {
    principalCreditCents,
    bonusCapCreditCents: Math.floor((principalCreditCents * PARTNER_BONUS_BPS) / 10_000),
    totalClaimCapCreditCents: Math.floor((principalCreditCents * PARTNER_TOTAL_RELEASE_BPS) / 10_000),
  };
}

export function calculateReleaseSlice(input: {
  principalCreditCents: number;
  lockedBonusCreditCents: number;
}) {
  const principalCreditCents = Math.floor(input.principalCreditCents / PARTNER_RELEASE_MONTHS);
  const bonusCreditCents = Math.floor(input.lockedBonusCreditCents / PARTNER_RELEASE_MONTHS);
  return {
    principalCreditCents,
    bonusCreditCents,
    totalCreditCents: principalCreditCents + bonusCreditCents,
  };
}
