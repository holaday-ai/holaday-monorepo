import { describe, expect, it } from 'vitest';
import { PLAN_ADDONS_HASH, shouldScrollPlanAddons } from './plan-page-hash';

describe('plan page hash routing', () => {
  it('recognizes the add-on deep link only', () => {
    expect(PLAN_ADDONS_HASH).toBe('#addons');
    expect(shouldScrollPlanAddons('#addons')).toBe(true);
    expect(shouldScrollPlanAddons('addons')).toBe(false);
    expect(shouldScrollPlanAddons('#plans')).toBe(false);
  });
});
