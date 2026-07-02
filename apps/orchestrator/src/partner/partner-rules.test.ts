import { describe, expect, it } from 'vitest';
import {
  calculateApiUnits,
  calculateLotCaps,
  calculateReleaseSlice,
  selectRechargeTier,
} from './partner-rules.js';

describe('partner rules', () => {
  it('selects the rolling 30-day recharge tier', () => {
    expect(selectRechargeTier(10_000_00).multiplierBps).toBe(10_500);
    expect(selectRechargeTier(50_001_00).multiplierBps).toBe(10_800);
    expect(selectRechargeTier(100_001_00).multiplierBps).toBe(11_200);
    expect(selectRechargeTier(200_001_00).multiplierBps).toBe(11_600);
    expect(selectRechargeTier(400_001_00).multiplierBps).toBe(12_000);
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

  it('splits full 120 percent claim into eight equal monthly releases', () => {
    expect(calculateReleaseSlice({ principalCreditCents: 10_000_00, lockedBonusCreditCents: 2_000_00 })).toEqual({
      principalCreditCents: 1_250_00,
      bonusCreditCents: 250_00,
      totalCreditCents: 1_500_00,
    });
  });
});
