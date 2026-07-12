import { describe, expect, it } from 'vitest';
import {
  calculateApiUnits,
  calculateLotCaps,
  calculateReleaseSlice,
  isWholeCnyAmount,
  selectRechargeTier,
} from './partner-rules.js';

describe('partner rules', () => {
  it('selects the rolling 30-day recharge tier', () => {
    expect(selectRechargeTier(10_000_00).multiplierBps).toBe(10_500);
    expect(selectRechargeTier(50_000_00).multiplierBps).toBe(10_500);
    expect(selectRechargeTier(50_001_00).multiplierBps).toBe(10_800);
    expect(selectRechargeTier(100_001_00).multiplierBps).toBe(11_200);
    expect(selectRechargeTier(200_001_00).multiplierBps).toBe(11_600);
    expect(selectRechargeTier(400_001_00).multiplierBps).toBe(12_000);
    expect(selectRechargeTier(500_001_00).multiplierBps).toBe(12_000);
  });

  it('rejects cent-level recharge amounts for tier selection', () => {
    expect(isWholeCnyAmount(50_000_00)).toBe(true);
    expect(isWholeCnyAmount(50_000_01)).toBe(false);
    expect(isWholeCnyAmount(-100_00)).toBe(false);
    expect(() => selectRechargeTier(50_000_01)).toThrow(RangeError);
    expect(() => selectRechargeTier(-100_00)).toThrow(RangeError);
  });

  it('calculates API Units from principal credit cents and tier basis points', () => {
    expect(calculateApiUnits(10_000_00, 10_500)).toBe(10_500_000);
    expect(calculateApiUnits(200_000_00, 11_600)).toBe(232_000_000);
  });

  it('caps total lot release at 120 percent of principal', () => {
    expect(calculateLotCaps(10_000_00)).toEqual({
      principalCreditCents: 10_000_00,
      bonusCapCreditCents: 2_000_00,
      totalClaimCapCreditCents: 12_000_00,
    });
  });

  it('rejects invalid principal amounts for API unit and lot cap calculations', () => {
    expect(() => calculateApiUnits(-1, 10_500)).toThrow(RangeError);
    expect(() => calculateApiUnits(10_000.5, 10_500)).toThrow(RangeError);
    expect(() => calculateLotCaps(-1)).toThrow(RangeError);
    expect(() => calculateLotCaps(10_000.5)).toThrow(RangeError);
  });

  it('splits full 120 percent claim into twelve monthly releases', () => {
    expect(calculateReleaseSlice({ principalCreditCents: 12_000_00, lockedBonusCreditCents: 2_400_00 })).toEqual({
      principalCreditCents: 1_000_00,
      bonusCreditCents: 200_00,
      totalCreditCents: 1_200_00,
    });
  });

  it('preserves cents across twelve monthly releases for uneven amounts', () => {
    const principalTotal = 10_000_35;
    const bonusTotal = 2_000_05;
    let releasedPrincipalCreditCents = 0;
    let releasedBonusCreditCents = 0;
    let releasedTotalCreditCents = 0;

    for (let remainingReleaseMonths = 12; remainingReleaseMonths > 0; remainingReleaseMonths -= 1) {
      const slice = calculateReleaseSlice({
        principalCreditCents: principalTotal,
        lockedBonusCreditCents: bonusTotal,
        releasedPrincipalCreditCents,
        releasedBonusCreditCents,
        remainingReleaseMonths,
      });

      releasedPrincipalCreditCents += slice.principalCreditCents;
      releasedBonusCreditCents += slice.bonusCreditCents;
      releasedTotalCreditCents += slice.totalCreditCents;
    }

    expect(releasedPrincipalCreditCents).toBe(principalTotal);
    expect(releasedBonusCreditCents).toBe(bonusTotal);
    expect(releasedTotalCreditCents).toBe(principalTotal + bonusTotal);
  });

  it('rejects invalid release state', () => {
    const validInput = {
      principalCreditCents: 10_000_35,
      lockedBonusCreditCents: 2_000_05,
      releasedPrincipalCreditCents: 1_250_01,
      releasedBonusCreditCents: 250_01,
      remainingReleaseMonths: 11,
    };

    const invalidInputs = [
      { ...validInput, releasedPrincipalCreditCents: validInput.principalCreditCents + 1 },
      { ...validInput, releasedBonusCreditCents: validInput.lockedBonusCreditCents + 1 },
      { ...validInput, principalCreditCents: 10_000_00, lockedBonusCreditCents: 2_000_01 },
      { ...validInput, principalCreditCents: -1 },
      { ...validInput, lockedBonusCreditCents: -1 },
      { ...validInput, releasedPrincipalCreditCents: -1 },
      { ...validInput, releasedBonusCreditCents: -1 },
      { ...validInput, principalCreditCents: 10_000.5 },
      { ...validInput, lockedBonusCreditCents: 2_000.5 },
      { ...validInput, releasedPrincipalCreditCents: 1_250.5 },
      { ...validInput, releasedBonusCreditCents: 250.5 },
      { ...validInput, remainingReleaseMonths: 0 },
      { ...validInput, remainingReleaseMonths: -1 },
      { ...validInput, remainingReleaseMonths: 1.5 },
      { ...validInput, remainingReleaseMonths: 13 },
    ];

    for (const invalidInput of invalidInputs) {
      expect(() => calculateReleaseSlice(invalidInput)).toThrow(RangeError);
    }
  });
});
