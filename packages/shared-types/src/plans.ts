/**
 * Plan catalogue — single source of truth shared between the
 * orchestrator (charges + DB writes) and the web UI (pricing card).
 *
 * Prices are stored in *cents* to keep the wire / DB representation
 * in integer math; rendered as decimal in `formatUsd()`. Adding a
 * new plan: extend `PLAN_IDS` and add an entry. The DB column is a
 * loose VARCHAR(32) so no migration is needed for new tiers.
 *
 * Stage-2 (China users) will introduce CNY pricing — add a sibling
 * `cnyAmountCents` field rather than a parallel catalogue, so the
 * code that picks a currency stays in one place.
 */

export const PLAN_IDS = ['free', 'basic', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  /** USD price in cents (0 for free). 990 = $9.90, 2990 = $29.90. */
  readonly usdAmountCents: number;
  /** Billing cadence label rendered next to the price. */
  readonly cadence: 'one-time' | 'monthly' | 'yearly';
}

export const PLAN_CATALOGUE: Readonly<Record<PlanId, PlanDefinition>> = {
  free: { id: 'free', name: 'Free', usdAmountCents: 0, cadence: 'monthly' },
  basic: { id: 'basic', name: 'Basic', usdAmountCents: 990, cadence: 'monthly' },
  pro: { id: 'pro', name: 'Pro', usdAmountCents: 2990, cadence: 'monthly' },
} as const;

export function isPaidPlan(id: string): id is Exclude<PlanId, 'free'> {
  return id === 'basic' || id === 'pro';
}

/** USD cents → "$9.90" string. Two decimal places, no thousands separator. */
export function formatUsd(cents: number): string {
  const whole = Math.floor(cents / 100);
  const frac = (cents % 100).toString().padStart(2, '0');
  return `$${whole}.${frac}`;
}
