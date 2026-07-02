import {
  API_UNITS_PER_HOLA_CREDIT,
  HOLA_CREDIT_CNY_CENTS,
  PARTNER_BONUS_BPS,
  PARTNER_RECHARGE_TIERS,
  PARTNER_RELEASE_MONTHS,
  PARTNER_TOTAL_RELEASE_BPS,
} from '@holaday/shared-types';

export function isWholeCnyAmount(amountCnyCents: number): boolean {
  return Number.isInteger(amountCnyCents) && amountCnyCents % HOLA_CREDIT_CNY_CENTS === 0;
}

export function selectRechargeTier(rollingThirtyDayCnyCents: number) {
  if (!isWholeCnyAmount(rollingThirtyDayCnyCents)) {
    throw new RangeError('Partner recharge tier selection requires a whole CNY amount');
  }

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
  releasedPrincipalCreditCents?: number;
  releasedBonusCreditCents?: number;
  remainingReleaseMonths?: number;
}) {
  const remainingReleaseMonths = input.remainingReleaseMonths ?? PARTNER_RELEASE_MONTHS;
  if (!Number.isInteger(remainingReleaseMonths) || remainingReleaseMonths <= 0) {
    throw new RangeError('remainingReleaseMonths must be a positive integer');
  }

  const remainingPrincipalCreditCents = input.principalCreditCents - (input.releasedPrincipalCreditCents ?? 0);
  const remainingBonusCreditCents = input.lockedBonusCreditCents - (input.releasedBonusCreditCents ?? 0);
  const principalCreditCents = Math.ceil(remainingPrincipalCreditCents / remainingReleaseMonths);
  const bonusCreditCents = Math.ceil(remainingBonusCreditCents / remainingReleaseMonths);
  return {
    principalCreditCents,
    bonusCreditCents,
    totalCreditCents: principalCreditCents + bonusCreditCents,
  };
}
