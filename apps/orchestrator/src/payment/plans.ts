import {
  PLAN_CATALOGUE,
  getPlanPriceCents,
  isPaidPlan,
  type BillingCycle,
  type PaidPlanId,
  type PlanId,
} from '@holaday/shared-types';

/**
 * Server-side plan helpers — small layer over the shared catalogue
 * that adds the things only the server cares about (charge expiry
 * math, description strings used in PayPal order line-items, etc.).
 */

export {
  PLAN_CATALOGUE,
  getPlanPriceCents,
  isPaidPlan,
  type BillingCycle,
  type PaidPlanId,
  type PlanId,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Extend a user's plan-expiry date by the chosen billing cycle. 30
 * days for monthly, 365 for yearly — constant offsets so the receipt
 * date matches what users expect, even though calendar months drift
 * by a day or two over a year.
 *
 * Re-up from `now` when the user has lapsed; stack on top of the
 * existing expiry when they're still active so they don't lose paid
 * days by re-upgrading early.
 */
export function nextExpiryFor(
  // planId kept on the signature for API symmetry with describePlanOrder
  // and to leave room for plan-specific cycle overrides later.
  _planId: PlanId,
  cycle: BillingCycle,
  currentExpiry: Date | null,
): Date {
  const now = Date.now();
  const base = currentExpiry && currentExpiry.getTime() > now ? currentExpiry.getTime() : now;
  const cycleMs = (cycle === 'yearly' ? 365 : 30) * DAY_MS;
  return new Date(base + cycleMs);
}

/** Human-readable order description for PayPal line-items. */
export function describePlanOrder(planId: PlanId, cycle: BillingCycle): string {
  const plan = PLAN_CATALOGUE[planId];
  const cycleLabel = cycle === 'yearly' ? '年度' : '月度';
  return `HOLA DAY ${plan.nameZh} — ${cycleLabel}订阅`;
}
