import { PLAN_CATALOGUE, type PlanId, isPaidPlan } from '@holaday/shared-types';

/**
 * Server-side plan helpers — small layer over the shared catalogue
 * that adds the things only the server cares about (charge expiry math,
 * description strings used in PayPal order line-items, etc.).
 */

export { PLAN_CATALOGUE, type PlanId, isPaidPlan };

/**
 * Extend a user's plan-expiry date by one billing cycle. Currently all
 * paid plans are monthly; if/when annual plans land, dispatch on
 * `cadence` here. Re-up from `now` when the user has lapsed; stack on
 * top of the existing expiry when they're still active so they don't
 * lose paid days by re-upgrading early.
 */
export function nextExpiryFor(planId: PlanId, currentExpiry: Date | null): Date {
  const plan = PLAN_CATALOGUE[planId];
  const now = Date.now();
  const base = currentExpiry && currentExpiry.getTime() > now ? currentExpiry.getTime() : now;
  // 30-day months keeps the math simple — calendar months would slip
  // by a day or two over a year, but for "+30 days from now" billing
  // a constant offset matches what users see on the receipt.
  const dayMs = 24 * 60 * 60 * 1000;
  const cycleMs = plan.cadence === 'yearly' ? 365 * dayMs : 30 * dayMs;
  return new Date(base + cycleMs);
}

/** Human-readable order description for PayPal line-items. */
export function describePlanOrder(planId: PlanId): string {
  const plan = PLAN_CATALOGUE[planId];
  return `HOLA DAY ${plan.name} 套餐 — ${plan.cadence === 'monthly' ? '月度' : '年度'}订阅`;
}
