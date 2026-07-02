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

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

export function calculateReleaseSlice(input: {
  principalCreditCents: number;
  lockedBonusCreditCents: number;
  releasedPrincipalCreditCents?: number;
  releasedBonusCreditCents?: number;
  remainingReleaseMonths?: number;
}) {
  const releasedPrincipalCreditCents = input.releasedPrincipalCreditCents ?? 0;
  const releasedBonusCreditCents = input.releasedBonusCreditCents ?? 0;
  const remainingReleaseMonths = input.remainingReleaseMonths ?? PARTNER_RELEASE_MONTHS;
  assertNonNegativeInteger(input.principalCreditCents, 'principalCreditCents');
  assertNonNegativeInteger(input.lockedBonusCreditCents, 'lockedBonusCreditCents');
  assertNonNegativeInteger(releasedPrincipalCreditCents, 'releasedPrincipalCreditCents');
  assertNonNegativeInteger(releasedBonusCreditCents, 'releasedBonusCreditCents');

  if (
    !Number.isInteger(remainingReleaseMonths) ||
    remainingReleaseMonths < 1 ||
    remainingReleaseMonths > PARTNER_RELEASE_MONTHS
  ) {
    throw new RangeError(`remainingReleaseMonths must be an integer from 1 to ${PARTNER_RELEASE_MONTHS}`);
  }
  if (releasedPrincipalCreditCents > input.principalCreditCents) {
    throw new RangeError('releasedPrincipalCreditCents cannot exceed principalCreditCents');
  }
  if (releasedBonusCreditCents > input.lockedBonusCreditCents) {
    throw new RangeError('releasedBonusCreditCents cannot exceed lockedBonusCreditCents');
  }

  const remainingPrincipalCreditCents = input.principalCreditCents - releasedPrincipalCreditCents;
  const remainingBonusCreditCents = input.lockedBonusCreditCents - releasedBonusCreditCents;
  const principalCreditCents = Math.ceil(remainingPrincipalCreditCents / remainingReleaseMonths);
  const bonusCreditCents = Math.ceil(remainingBonusCreditCents / remainingReleaseMonths);
  return {
    principalCreditCents,
    bonusCreditCents,
    totalCreditCents: principalCreditCents + bonusCreditCents,
  };
}
